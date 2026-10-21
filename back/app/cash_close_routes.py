"""End-of-day cash register close: expected takings per payment method vs counted cash."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from . import models
from .db import get_session
from .order_payment_service import list_active_payments, order_due_cents
from .permissions import Permission, require_permission
from .reports_routes import REVENUE_STATUSES, _in_range, _revenue_date

router = APIRouter()

_CARD_METHODS = {"card", "terminal", "stripe", "revolut"}


def _bucket(method: str | None) -> str:
    m = (method or "cash").lower()
    if m == "cash":
        return "cash"
    if m in _CARD_METHODS:
        return "card"
    if m == "transfer":
        return "transfer"
    return "other"


def _day_summary(session: Session, tenant_id: int, day: date) -> dict:
    orders = session.exec(
        select(models.Order)
        .where(models.Order.tenant_id == tenant_id)
        .where(models.Order.deleted_at.is_(None))
        .where(models.Order.status.in_([s.value for s in REVENUE_STATUSES]))
    ).all()
    totals = {"cash": 0, "card": 0, "transfer": 0, "other": 0}
    tips = 0
    count = 0
    for order in orders:
        if not _in_range(_revenue_date(order), day, day):
            continue
        count += 1
        tips += int(order.tip_amount_cents or 0)
        legs = list_active_payments(session, order.id)
        if legs:
            for leg in legs:
                totals[_bucket(leg.payment_method)] += int(leg.amount_cents or 0)
        else:
            totals[_bucket(order.payment_method)] += order_due_cents(session, order)
    return {
        "business_date": day.isoformat(),
        "orders_count": count,
        "expected_cash_cents": totals["cash"],
        "expected_card_cents": totals["card"],
        "expected_transfer_cents": totals["transfer"],
        "expected_other_cents": totals["other"],
        "total_cents": sum(totals.values()),
        "tips_cents": tips,
    }


def _close_dict(c: models.CashClose) -> dict:
    return {
        "id": c.id,
        "business_date": c.business_date.isoformat(),
        "orders_count": c.orders_count,
        "expected_cash_cents": c.expected_cash_cents,
        "expected_card_cents": c.expected_card_cents,
        "expected_transfer_cents": c.expected_transfer_cents,
        "expected_other_cents": c.expected_other_cents,
        "tips_cents": c.tips_cents,
        "opening_float_cents": c.opening_float_cents,
        "counted_cash_cents": c.counted_cash_cents,
        "difference_cents": c.difference_cents,
        "note": c.note,
        "closed_by_user_id": c.closed_by_user_id,
        "closed_at": c.closed_at.isoformat() if c.closed_at else None,
    }


@router.get("/summary")
def cash_close_summary(
    current_user: Annotated[models.User, Depends(require_permission(Permission.REPORT_READ))],
    session: Session = Depends(get_session),
    business_date: date = Query(...),
) -> dict:
    summary = _day_summary(session, current_user.tenant_id, business_date)
    last = session.exec(
        select(models.CashClose)
        .where(models.CashClose.tenant_id == current_user.tenant_id)
        .where(models.CashClose.business_date == business_date)
        .order_by(models.CashClose.closed_at.desc())
    ).first()
    summary["existing_close"] = _close_dict(last) if last else None
    return summary


@router.get("")
def list_cash_closes(
    current_user: Annotated[models.User, Depends(require_permission(Permission.REPORT_READ))],
    session: Session = Depends(get_session),
    limit: int = Query(30, ge=1, le=200),
) -> list[dict]:
    rows = session.exec(
        select(models.CashClose)
        .where(models.CashClose.tenant_id == current_user.tenant_id)
        .order_by(models.CashClose.business_date.desc(), models.CashClose.closed_at.desc())
        .limit(limit)
    ).all()
    return [_close_dict(c) for c in rows]


@router.post("", status_code=201)
def create_cash_close(
    body: models.CashCloseBody,
    current_user: Annotated[models.User, Depends(require_permission(Permission.REPORT_READ))],
    session: Session = Depends(get_session),
) -> dict:
    if body.business_date > date.today():
        raise HTTPException(status_code=400, detail="Business date cannot be in the future")
    s = _day_summary(session, current_user.tenant_id, body.business_date)
    expected_in_drawer = body.opening_float_cents + s["expected_cash_cents"]
    row = models.CashClose(
        tenant_id=current_user.tenant_id,
        business_date=body.business_date,
        orders_count=s["orders_count"],
        expected_cash_cents=s["expected_cash_cents"],
        expected_card_cents=s["expected_card_cents"],
        expected_transfer_cents=s["expected_transfer_cents"],
        expected_other_cents=s["expected_other_cents"],
        tips_cents=s["tips_cents"],
        opening_float_cents=body.opening_float_cents,
        counted_cash_cents=body.counted_cash_cents,
        difference_cents=body.counted_cash_cents - expected_in_drawer,
        note=(body.note or "").strip() or None,
        closed_by_user_id=current_user.id,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _close_dict(row)
