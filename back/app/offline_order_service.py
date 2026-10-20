"""Staff offline sale → online sync with idempotency (#319, #333)."""

from __future__ import annotations

from datetime import date, datetime, timezone

from sqlmodel import Session, select

from app import models
from app.delivery_order_service import _add_order_items, _resolve_product_lines

TAKE_AWAY_TABLE_NAMES = ("take away", "home ordering", "takeaway", "take-away")
VALID_PAYMENT_INTENTS = frozenset({"cash", "card", "transfer"})
# Intents that are paid on the spot (card is collected later, online).
PAID_NOW_INTENTS = frozenset({"cash", "transfer"})


def _is_take_away_table(table: models.Table | None) -> bool:
    if not table or not getattr(table, "name", None):
        return False
    return (table.name or "").strip().lower() in TAKE_AWAY_TABLE_NAMES


def create_offline_cash_order(
    session: Session,
    *,
    tenant_id: int,
    user_id: int,
    idempotency_key: str,
    table_id: int,
    lines: list[dict],
    notes: str | None = None,
    customer_name: str | None = None,
    payment_intent: str = "cash",
    send_to_kitchen: bool = False,
) -> tuple[models.Order | None, dict]:
    """
    Sync a staff sale queued while offline.

    payment_intent:
      - cash / transfer: order paid on the spot with that method (idempotent).
      - card: unpaid order; collect card online after reconnect (no PAN/CVV stored).

    send_to_kitchen: cash sale whose items still need to be prepared (e.g. a bar/counter
    quick sale). Items stay pending for kitchen/bar instead of being auto-delivered.

    Idempotent on (tenant_id, idempotency_key): replay returns the existing order.
    lines: [{"product_id": int, "quantity": int, "notes": str|None}].

    Fiscal / VeriFactu numbering is never allocated here — issue invoices online after pay.
    """
    key = (idempotency_key or "").strip()
    if not key or len(key) > 64:
        return None, {"status": "error", "detail": "invalid_idempotency_key"}

    intent = (payment_intent or "cash").strip().lower()
    if intent not in VALID_PAYMENT_INTENTS:
        return None, {"status": "error", "detail": "invalid_payment_intent"}

    existing = session.exec(
        select(models.OfflineOrderIdempotency).where(
            models.OfflineOrderIdempotency.tenant_id == tenant_id,
            models.OfflineOrderIdempotency.idempotency_key == key,
        )
    ).first()
    if existing:
        order = session.get(models.Order, existing.order_id)
        if order and order.tenant_id == tenant_id and order.deleted_at is None:
            return order, {
                "status": "duplicate",
                "order_id": order.id,
                "payment_intent": intent,
                "needs_payment": order.paid_at is None,
            }
        return None, {"status": "error", "detail": "idempotency_orphan"}

    table = session.get(models.Table, table_id)
    if not table or table.tenant_id != tenant_id:
        return None, {"status": "error", "detail": "table_not_found"}

    # Prefer take-away; allow any tenant table that is active (staff may cash-out a walk-in).
    if not _is_take_away_table(table) and not table.is_active:
        return None, {"status": "error", "detail": "table_not_active"}

    resolved_lines, err = _resolve_product_lines(session, tenant_id=tenant_id, lines=lines)
    if err:
        return None, err
    assert resolved_lines is not None

    now = datetime.now(timezone.utc)
    # Card sales stay unpaid (see needs_payment); the order note is only what staff typed.
    combined_notes = (notes or "").strip() or None

    paid_now = intent in PAID_NOW_INTENTS
    if paid_now:
        order = models.Order(
            table_id=table.id,
            tenant_id=tenant_id,
            status=models.OrderStatus.paid,
            session_id=None,
            customer_name=(customer_name or "").strip() or None,
            notes=combined_notes,
            paid_at=now,
            paid_by_user_id=user_id,
            payment_method=intent,
            created_at=now,
        )
    else:
        # Deferred card: open unpaid ticket; no Stripe/Revolut intent offline (#333).
        order = models.Order(
            table_id=table.id,
            tenant_id=tenant_id,
            status=models.OrderStatus.pending,
            session_id=None,
            customer_name=(customer_name or "").strip() or None,
            notes=combined_notes,
            paid_at=None,
            paid_by_user_id=None,
            payment_method=None,
            created_at=now,
        )
    session.add(order)
    session.flush()

    order_date = order.created_at.date() if order.created_at else date.today()
    _add_order_items(
        session,
        order=order,
        tenant_id=tenant_id,
        resolved_lines=resolved_lines,
        order_date=order_date,
    )
    session.flush()

    items = session.exec(
        select(models.OrderItem).where(models.OrderItem.order_id == order.id)
    ).all()
    if paid_now and not send_to_kitchen:
        for item in items:
            if item.status != models.OrderItemStatus.cancelled:
                item.status = models.OrderItemStatus.delivered
                item.status_updated_at = now
                item.delivered_by_user_id = user_id
                session.add(item)
        # Cash takeaway is paid and fully delivered → completed (leaves Active Orders #345).
        order.status = models.OrderStatus.completed
        # Do not leave a paid order as the table's active open ticket.
        if table.active_order_id is None or table.active_order_id == order.id:
            table.active_order_id = None
            session.add(table)
    elif paid_now and send_to_kitchen:
        # Paid up front, but still needs kitchen/bar prep: items stay pending so
        # they show up on /kitchen and /bar like any other order.
        order.status = models.OrderStatus.paid
        if table.active_order_id is None or table.active_order_id == order.id:
            table.active_order_id = None
            session.add(table)
    else:
        # Keep unpaid deferred-card order findable on the take-away table.
        table.active_order_id = order.id
        session.add(table)

    ledger = models.OfflineOrderIdempotency(
        tenant_id=tenant_id,
        idempotency_key=key,
        order_id=order.id,
        created_at=now,
    )
    session.add(ledger)
    session.add(order)

    if paid_now:
        # Audit leg so offline cash matches online mark-paid / split-bill ledger (#318).
        try:
            from app.order_payment_service import ensure_full_payment_leg

            ensure_full_payment_leg(
                session,
                order=order,
                payment_method=intent,
                paid_by_user_id=user_id,
                tip_amount_cents=None,
            )
        except Exception:
            pass

    session.commit()
    session.refresh(order)

    try:
        from app.main import publish_order_update

        event_type = "order_paid" if paid_now else "order_created"
        publish_order_update(
            tenant_id,
            {
                "type": event_type,
                "order_id": order.id,
                "table_name": table.name if table else "Unknown",
                "payment_method": intent if paid_now else None,
                "payment_intent": intent,
                "offline_sync": True,
                "needs_payment": intent == "card",
            },
            table_id=order.table_id,
        )
    except Exception:
        pass

    if paid_now:
        try:
            tenant = session.get(models.Tenant, tenant_id)
            if tenant:
                from app.inventory_service import deduct_inventory_for_order

                deduct_inventory_for_order(session, order, tenant)
                session.commit()
        except Exception:
            pass

    return order, {
        "status": "created",
        "order_id": order.id,
        "payment_intent": intent,
        "needs_payment": intent == "card",
    }
