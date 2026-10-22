"""Stock notices for the administrator (ingredient out / running low).

Replaces the old behaviour where a dish silently disappeared from the menu as soon as one
ingredient ran short. Stock can be wrong (a delivery arrived and was not registered yet), so the
system only raises a notice and the admin decides what to do.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlmodel import Session, select

from . import models
from .inventory_models import InventoryAlert, InventoryItem, ProductRecipe
from .inventory_service import convert_to_base_unit

LIVE_STATUSES = ("open", "kept", "withdrawn", "restocked")
ATTENTION_STATUSES = ("open", "restocked")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _recipe_rows(session: Session, tenant_id: int):
    return session.exec(
        select(ProductRecipe, InventoryItem)
        .join(InventoryItem, InventoryItem.id == ProductRecipe.inventory_item_id)
        .where(ProductRecipe.tenant_id == tenant_id)
        .where(InventoryItem.is_deleted == False)  # noqa: E712
    ).all()


def blocked_products_by_item(session: Session, tenant_id: int) -> dict[int, set[int]]:
    """Per ingredient: ids of dishes whose one-portion need exceeds what is in stock."""
    blocked: dict[int, set[int]] = {}
    for recipe, item in _recipe_rows(session, tenant_id):
        try:
            per_portion = convert_to_base_unit(recipe.quantity_required, recipe.unit, item)
        except Exception:
            continue
        waste = Decimal(recipe.waste_percentage or 0) / Decimal(100)
        needed = per_portion * (Decimal(1) + waste)
        if Decimal(item.current_quantity or 0) < needed:
            blocked.setdefault(item.id, set()).add(recipe.product_id)
    return blocked


def _item_state(item: InventoryItem, blocked: dict[int, set[int]]) -> str | None:
    if blocked.get(item.id):
        return "out"
    level = Decimal(item.reorder_level or 0)
    if level > 0 and Decimal(item.current_quantity or 0) <= level:
        return "low"
    return None


def sync_alerts(session: Session, tenant_id: int) -> None:
    """Create / update / close notices so they match the current stock. Idempotent."""
    blocked = blocked_products_by_item(session, tenant_id)
    items = session.exec(
        select(InventoryItem)
        .where(InventoryItem.tenant_id == tenant_id)
        .where(InventoryItem.is_deleted == False)  # noqa: E712
        .where(InventoryItem.is_active == True)  # noqa: E712
    ).all()
    live = session.exec(
        select(InventoryAlert)
        .where(InventoryAlert.tenant_id == tenant_id)
        .where(InventoryAlert.status.in_(LIVE_STATUSES))
    ).all()
    live_by_item: dict[int, list[InventoryAlert]] = {}
    for a in live:
        live_by_item.setdefault(a.inventory_item_id, []).append(a)

    now = _now()
    item_ids = set()
    for item in items:
        item_ids.add(item.id)
        state = _item_state(item, blocked)
        alerts = live_by_item.get(item.id, [])
        matched = None
        for a in alerts:
            if state is not None and a.kind == state:
                matched = a
                continue
            # The situation changed: close the notice (or ask the admin to offer the dishes again)
            if a.status == "withdrawn" or (a.status == "restocked" and a.withdrawn_product_ids):
                if a.status != "restocked":
                    a.status = "restocked"
                    a.updated_at = now
                    session.add(a)
            else:
                a.status = "resolved"
                a.resolved_at = now
                a.updated_at = now
                session.add(a)
        if state is None:
            continue
        qty = Decimal(item.current_quantity or 0)
        if matched is None:
            session.add(
                InventoryAlert(
                    tenant_id=tenant_id,
                    inventory_item_id=item.id,
                    kind=state,
                    status="open",
                    quantity_snapshot=qty,
                    product_ids=sorted(blocked.get(item.id, set())) if state == "out" else [],
                )
            )
        else:
            matched.quantity_snapshot = qty
            if state == "out":
                matched.product_ids = sorted(blocked.get(item.id, set()))
            # Ingredient ran out again while dishes were still withdrawn: back to "withdrawn"
            if matched.status == "restocked":
                matched.status = "withdrawn"
            matched.updated_at = now
            session.add(matched)
    # Ingredients deleted / deactivated: close their notices
    for a in live:
        if a.inventory_item_id not in item_ids and a.status in LIVE_STATUSES:
            a.status = "resolved"
            a.resolved_at = now
            session.add(a)
    session.commit()


def _set_products_out_of_stock(session: Session, tenant_id: int, product_ids: list[int], value: bool) -> None:
    if not product_ids:
        return
    for pid in product_ids:
        product = session.get(models.Product, pid)
        if product is not None and product.tenant_id == tenant_id:
            product.out_of_stock = value
            session.add(product)
    tps = session.exec(
        select(models.TenantProduct)
        .where(models.TenantProduct.tenant_id == tenant_id)
        .where(models.TenantProduct.product_id.in_(product_ids))
    ).all()
    for tp in tps:
        tp.out_of_stock = value
        session.add(tp)


def withdraw_products(session: Session, alert: InventoryAlert, user_id: int | None) -> InventoryAlert:
    """Admin decision: take the affected dishes off the menu."""
    ids = list(alert.product_ids or [])
    _set_products_out_of_stock(session, alert.tenant_id, ids, True)
    alert.withdrawn_product_ids = ids
    alert.status = "withdrawn"
    alert.decided_at = _now()
    alert.decided_by_user_id = user_id
    alert.updated_at = _now()
    session.add(alert)
    session.commit()
    session.refresh(alert)
    return alert


def keep_selling(session: Session, alert: InventoryAlert, user_id: int | None) -> InventoryAlert:
    """Admin decision: keep the dishes on the menu (or acknowledge a low-stock reminder)."""
    alert.status = "kept"
    alert.decided_at = _now()
    alert.decided_by_user_id = user_id
    alert.updated_at = _now()
    session.add(alert)
    session.commit()
    session.refresh(alert)
    return alert


def offer_again(session: Session, alert: InventoryAlert, user_id: int | None) -> InventoryAlert:
    """Admin decision: put the withdrawn dishes back on the menu."""
    ids = list(alert.withdrawn_product_ids or [])
    _set_products_out_of_stock(session, alert.tenant_id, ids, False)
    alert.withdrawn_product_ids = []
    if alert.status == "restocked":
        alert.status = "resolved"
        alert.resolved_at = _now()
    else:
        alert.status = "kept"
    alert.decided_at = _now()
    alert.decided_by_user_id = user_id
    alert.updated_at = _now()
    session.add(alert)
    session.commit()
    session.refresh(alert)
    return alert


def alert_to_dict(session: Session, alert: InventoryAlert) -> dict:
    item = session.get(InventoryItem, alert.inventory_item_id)
    ids = sorted(set(alert.product_ids or []) | set(alert.withdrawn_product_ids or []))
    products = []
    if ids:
        for p in session.exec(select(models.Product).where(models.Product.id.in_(ids))).all():
            products.append(
                {
                    "id": p.id,
                    "name": p.name,
                    "withdrawn": p.id in set(alert.withdrawn_product_ids or []),
                }
            )
    current = float(item.current_quantity) if item else 0.0
    level = float(item.reorder_level) if item else 0.0
    reorder_qty = float(item.reorder_quantity) if item else 0.0
    return {
        "id": alert.id,
        "kind": alert.kind,
        "status": alert.status,
        "needs_attention": alert.status in ATTENTION_STATUSES,
        "created_at": alert.created_at.isoformat() if alert.created_at else None,
        "item": {
            "id": alert.inventory_item_id,
            "name": item.name if item else "?",
            "unit": item.unit.value if item and item.unit else "piece",
            "current_quantity": current,
            "reorder_level": level,
            "suggested_order_quantity": max(0.0, level - current + reorder_qty),
        },
        "products": sorted(products, key=lambda x: x["name"].lower()),
    }


def list_alerts(session: Session, tenant_id: int) -> list[dict]:
    sync_alerts(session, tenant_id)
    rows = session.exec(
        select(InventoryAlert)
        .where(InventoryAlert.tenant_id == tenant_id)
        .where(InventoryAlert.status.in_(LIVE_STATUSES))
        .order_by(InventoryAlert.created_at.desc())
    ).all()
    out = [alert_to_dict(session, a) for a in rows]
    # Needs-attention first, "out" before "low"
    out.sort(key=lambda a: (not a["needs_attention"], a["kind"] != "out"))
    return out
