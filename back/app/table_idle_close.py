"""
Close dine-in tables that were activated but never received an order.

Runs inside the FastAPI process (like the order auto-preparing worker). A table is closed only when
it has been active for IDLE_CLOSE_AFTER_MINUTES, has no open order and no seated reservation; the
take-away counter is never touched. Rows are locked with SKIP LOCKED so several workers never close
the same table twice.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from . import models
from .db import engine

logger = logging.getLogger(__name__)

IDLE_CLOSE_AFTER_MINUTES = 10
TICK_SECONDS = 30


def close_idle_tables(session: Session, *, now: datetime | None = None) -> int:
    """Close active tables with no order after the idle window. Returns tables closed."""
    # Late import: main imports this module during startup.
    from .main import _close_table_session, _is_take_away_table

    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=IDLE_CLOSE_AFTER_MINUTES)
    candidates = session.exec(
        select(models.Table)
        .where(
            models.Table.is_active == True,  # noqa: E712
            models.Table.active_order_id.is_(None),
            models.Table.activated_at.is_not(None),
            models.Table.activated_at <= cutoff,
        )
        .with_for_update(skip_locked=True)
    ).all()

    closed = 0
    for table in candidates:
        if _is_take_away_table(table):
            continue
        open_order = session.exec(
            select(models.Order.id).where(
                models.Order.table_id == table.id,
                models.Order.deleted_at.is_(None),
                models.Order.paid_at.is_(None),
                models.Order.status.not_in([models.OrderStatus.paid, models.OrderStatus.cancelled]),
            )
        ).first()
        if open_order is not None:
            continue
        seated = session.exec(
            select(models.Reservation.id).where(
                models.Reservation.table_id == table.id,
                models.Reservation.status == models.ReservationStatus.seated,
            )
        ).first()
        if seated is not None:
            continue
        _close_table_session(session, table, table.tenant_id)
        closed += 1
    return closed


def _tick() -> int:
    with Session(engine) as session:
        return close_idle_tables(session)


async def table_idle_close_loop(stop: asyncio.Event | None = None) -> None:
    """Background loop: every TICK_SECONDS close idle tables. Stops when ``stop`` is set."""
    stop_ev = stop or asyncio.Event()
    while not stop_ev.is_set():
        try:
            closed = await asyncio.to_thread(_tick)
            if closed:
                logger.info("Idle tables: closed %d table(s) with no order after %d min", closed, IDLE_CLOSE_AFTER_MINUTES)
        except Exception as e:
            logger.warning("Idle table close tick failed: %s", e, exc_info=True)
        try:
            await asyncio.wait_for(stop_ev.wait(), timeout=TICK_SECONDS)
        except asyncio.TimeoutError:
            pass
