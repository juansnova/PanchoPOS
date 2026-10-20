"""
Auto-advance new order lines from "pending" to "preparing" after a short delay.

Runs inside the FastAPI process (like the reservation reminder heartbeat). A line is advanced
only while nobody has touched its status yet (``status_updated_at IS NULL``), so a staff
"reset to pending" is never overridden. Rows are locked with SKIP LOCKED so several workers
never advance/publish the same line twice.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_
from sqlmodel import Session, select

from . import models
from .db import engine

logger = logging.getLogger(__name__)

AUTO_PREPARING_AFTER_SECONDS = 30
TICK_SECONDS = 5


def advance_due_items(session: Session, *, now: datetime | None = None) -> int:
    """Move due pending lines to preparing; publish one update per line. Returns lines moved."""
    # Late import: main imports this module during startup.
    from .main import publish_order_update, recompute_order_status_preserving_payment

    now = now or datetime.now(timezone.utc)
    delays = session.exec(select(models.Tenant.id, models.Tenant.auto_preparing_seconds)).all()
    by_delay: dict[int, list[int]] = {}
    for tenant_id, secs in delays:
        by_delay.setdefault(AUTO_PREPARING_AFTER_SECONDS if secs is None else secs, []).append(tenant_id)
    if not by_delay:
        return 0
    old_enough = or_(
        *(
            and_(models.Order.tenant_id.in_(ids), models.OrderItem.created_at <= now - timedelta(seconds=secs))
            for secs, ids in by_delay.items()
        )
    )
    due = session.exec(
        select(models.OrderItem)
        .join(models.Order, models.Order.id == models.OrderItem.order_id)
        .where(
            models.OrderItem.status == models.OrderItemStatus.pending,
            models.OrderItem.status_updated_at.is_(None),
            models.OrderItem.created_at.is_not(None),
            old_enough,
            models.OrderItem.removed_by_customer == False,  # noqa: E712
            models.OrderItem.removed_by_user_id.is_(None),
            models.Order.deleted_at.is_(None),
            models.Order.paid_at.is_(None),
            models.Order.status.not_in([models.OrderStatus.paid, models.OrderStatus.cancelled]),
        )
        .with_for_update(skip_locked=True, of=models.OrderItem)
    ).all()
    if not due:
        return 0

    by_order: dict[int, list[models.OrderItem]] = {}
    for item in due:
        item.status = models.OrderItemStatus.preparing
        item.status_updated_at = now
        session.add(item)
        by_order.setdefault(item.order_id, []).append(item)

    orders: dict[int, models.Order] = {}
    for order_id in by_order:
        order = session.get(models.Order, order_id)
        if not order:
            continue
        all_items = session.exec(
            select(models.OrderItem).where(models.OrderItem.order_id == order_id)
        ).all()
        recompute_order_status_preserving_payment(order, list(all_items))
        session.add(order)
        orders[order_id] = order
    session.commit()

    for order_id, items in by_order.items():
        order = orders.get(order_id)
        if not order:
            continue
        table = session.get(models.Table, order.table_id) if order.table_id else None
        order_status = order.status.value if hasattr(order.status, "value") else str(order.status)
        for item in items:
            publish_order_update(
                order.tenant_id,
                {
                    "type": "item_status_update",
                    "order_id": order.id,
                    "item_id": item.id,
                    "old_status": models.OrderItemStatus.pending.value,
                    "new_status": models.OrderItemStatus.preparing.value,
                    "status": order_status,
                    "table_name": table.name if table else "Unknown",
                    "auto": True,
                },
                table_id=order.table_id,
            )
    return len(due)


def _tick() -> int:
    from .print_service import enqueue_new_kitchen_tickets

    with Session(engine) as session:
        moved = advance_due_items(session)
        # Also catches lines moved to preparing by staff (manual status changes).
        enqueue_new_kitchen_tickets(session)
        return moved


async def order_auto_preparing_loop(stop: asyncio.Event | None = None) -> None:
    """Background loop: every TICK_SECONDS advance due lines. Stops when ``stop`` is set."""
    stop_ev = stop or asyncio.Event()
    while not stop_ev.is_set():
        try:
            moved = await asyncio.to_thread(_tick)
            if moved:
                logger.info("Auto-preparing: moved %d order line(s) to preparing", moved)
        except Exception as e:
            logger.warning("Auto-preparing tick failed: %s", e, exc_info=True)
        try:
            await asyncio.wait_for(stop_ev.wait(), timeout=TICK_SECONDS)
        except asyncio.TimeoutError:
            pass
