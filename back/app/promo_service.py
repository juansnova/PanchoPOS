"""Price promotions engine (#322): %-off category with time/channel eligibility."""

from __future__ import annotations

from datetime import datetime, time, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlmodel import Session, select

from app import models


PROMO_TYPE_PERCENT_OFF_CATEGORY = "percent_off_category"
VALID_CHANNELS = frozenset(
    {
        models.OrderChannel.table.value,
        models.OrderChannel.satisfecho_delivery.value,
        models.OrderChannel.marketplace.value,
    }
)


def _parse_hhmm(value: str | None) -> time | None:
    if not value or not str(value).strip():
        return None
    parts = str(value).strip().split(":")
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Time must be HH:MM")
    try:
        h, m = int(parts[0]), int(parts[1])
        return time(hour=h, minute=m)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Time must be HH:MM") from exc


def _soft_hhmm(value: str | None) -> time | None:
    try:
        return _parse_hhmm(value)
    except HTTPException:
        return None


def _tenant_now(tenant: models.Tenant | None, now_utc: datetime | None = None) -> datetime:
    now = now_utc or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    tz_name = (tenant.timezone if tenant else None) or "UTC"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = timezone.utc
    return now.astimezone(tz)


def _normalize_category(value: str | None) -> str:
    return (value or "").strip().casefold()


def _categories_match(promo_category: str, product_category: str | None) -> bool:
    return _normalize_category(promo_category) == _normalize_category(product_category)


def _channel_ok(promo: models.PricePromotion, channel: str | None) -> bool:
    ch = (channel or models.OrderChannel.table.value).strip().lower()
    raw = promo.channels
    if raw is None:
        return True
    if isinstance(raw, list) and len(raw) == 0:
        return True
    if not isinstance(raw, list):
        return True
    allowed = {str(c).strip().lower() for c in raw}
    return ch in allowed


def _window_ok(promo: models.PricePromotion, local_now: datetime) -> bool:
    # Absolute UTC window on the promo timestamps
    now_utc = local_now.astimezone(timezone.utc)
    if promo.starts_at is not None:
        start = promo.starts_at
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if now_utc < start.astimezone(timezone.utc):
            return False
    if promo.ends_at is not None:
        end = promo.ends_at
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        if now_utc > end.astimezone(timezone.utc):
            return False

    days = promo.days_of_week
    if isinstance(days, list) and days:
        # Monday=0 … Sunday=6 (Python weekday())
        if local_now.weekday() not in {int(d) for d in days}:
            return False

    start_t = _soft_hhmm(promo.start_time_local)
    end_t = _soft_hhmm(promo.end_time_local)
    if start_t is None and end_t is None:
        return True
    local_t = local_now.timetz().replace(tzinfo=None)
    if start_t is not None and end_t is not None:
        if start_t <= end_t:
            return start_t <= local_t <= end_t
        # Overnight window (e.g. 22:00–02:00)
        return local_t >= start_t or local_t <= end_t
    if start_t is not None:
        return local_t >= start_t
    assert end_t is not None
    return local_t <= end_t


def list_enabled_promos(session: Session, tenant_id: int) -> list[models.PricePromotion]:
    return list(
        session.exec(
            select(models.PricePromotion)
            .where(
                models.PricePromotion.tenant_id == tenant_id,
                models.PricePromotion.enabled == True,  # noqa: E712
            )
            .order_by(models.PricePromotion.id)
        ).all()
    )


def eligible_promos(
    session: Session,
    *,
    tenant_id: int,
    channel: str | None = None,
    now_utc: datetime | None = None,
) -> list[models.PricePromotion]:
    tenant = session.get(models.Tenant, tenant_id)
    local_now = _tenant_now(tenant, now_utc)
    out: list[models.PricePromotion] = []
    for promo in list_enabled_promos(session, tenant_id):
        if promo.promo_type != PROMO_TYPE_PERCENT_OFF_CATEGORY:
            continue
        if not _channel_ok(promo, channel):
            continue
        if not _window_ok(promo, local_now):
            continue
        out.append(promo)
    return out


def pick_best_percent_promo(
    promos: list[models.PricePromotion],
    *,
    product_category: str | None,
) -> models.PricePromotion | None:
    """MVP stack policy: one line promo — highest percent_off; ties by lowest id."""
    matches = [
        p
        for p in promos
        if p.promo_type == PROMO_TYPE_PERCENT_OFF_CATEGORY
        and _categories_match(p.category, product_category)
    ]
    if not matches:
        return None
    matches.sort(key=lambda p: (-int(p.percent_off), int(p.id or 0)))
    return matches[0]


def apply_percent_off(list_price_cents: int, percent_off: int) -> tuple[int, int]:
    """Return (discounted_unit_price, unit_discount_cents)."""
    list_price = max(0, int(list_price_cents))
    pct = max(0, min(100, int(percent_off)))
    discount = round(list_price * pct / 100)
    paid = max(0, list_price - discount)
    return paid, discount


def promo_snapshot(promo: models.PricePromotion) -> dict[str, Any]:
    return {
        "id": promo.id,
        "name": promo.name,
        "promo_type": promo.promo_type,
        "percent_off": promo.percent_off,
        "category": promo.category,
        "stackable": bool(promo.stackable),
    }


def resolve_line_price(
    session: Session,
    *,
    tenant_id: int,
    list_price_cents: int,
    product_category: str | None,
    channel: str | None = None,
    now_utc: datetime | None = None,
    eligible: list[models.PricePromotion] | None = None,
) -> dict[str, Any]:
    """Apply best eligible promo to a unit list price. Returns price + audit fields."""
    promos = eligible if eligible is not None else eligible_promos(
        session, tenant_id=tenant_id, channel=channel, now_utc=now_utc
    )
    best = pick_best_percent_promo(promos, product_category=product_category)
    if best is None:
        return {
            "price_cents": max(0, int(list_price_cents)),
            "list_price_cents": None,
            "discount_cents": 0,
            "promo_id": None,
            "promo_snapshot": None,
            "promo_label": None,
        }
    paid, discount = apply_percent_off(list_price_cents, best.percent_off)
    return {
        "price_cents": paid,
        "list_price_cents": max(0, int(list_price_cents)),
        "discount_cents": discount,
        "promo_id": best.id,
        "promo_snapshot": promo_snapshot(best),
        "promo_label": best.name,
    }


def decorate_menu_product(
    session: Session,
    *,
    tenant_id: int,
    product: dict[str, Any],
    channel: str | None = None,
    eligible: list[models.PricePromotion] | None = None,
) -> dict[str, Any]:
    """Mutate/return menu product dict with live promo pricing fields."""
    list_price = int(product.get("price_cents") or 0)
    category = product.get("category")
    applied = resolve_line_price(
        session,
        tenant_id=tenant_id,
        list_price_cents=list_price,
        product_category=category if isinstance(category, str) else None,
        channel=channel,
        eligible=eligible,
    )
    if applied["promo_id"] is None:
        product["list_price_cents"] = None
        product["promo_label"] = None
        product["promo_percent_off"] = None
        return product
    product["list_price_cents"] = applied["list_price_cents"]
    product["price_cents"] = applied["price_cents"]
    product["promo_label"] = applied["promo_label"]
    snap = applied["promo_snapshot"] or {}
    product["promo_percent_off"] = snap.get("percent_off")
    return product


def promo_to_dict(promo: models.PricePromotion) -> dict[str, Any]:
    return {
        "id": promo.id,
        "tenant_id": promo.tenant_id,
        "name": promo.name,
        "promo_type": promo.promo_type,
        "percent_off": promo.percent_off,
        "category": promo.category,
        "channels": promo.channels,
        "starts_at": promo.starts_at.isoformat() if promo.starts_at else None,
        "ends_at": promo.ends_at.isoformat() if promo.ends_at else None,
        "days_of_week": promo.days_of_week,
        "start_time_local": promo.start_time_local,
        "end_time_local": promo.end_time_local,
        "stackable": bool(promo.stackable),
        "enabled": bool(promo.enabled),
        "created_at": promo.created_at.isoformat() if promo.created_at else None,
        "updated_at": promo.updated_at.isoformat() if promo.updated_at else None,
    }


def _parse_optional_dt(value: datetime | str | None) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        raw = str(value).strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(raw)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid datetime") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def validate_and_apply_body(
    promo: models.PricePromotion,
    body: models.PricePromotionCreate | models.PricePromotionUpdate,
    *,
    creating: bool,
) -> None:
    if creating:
        assert isinstance(body, models.PricePromotionCreate)
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="name is required")
        promo.name = name[:120]
        promo.promo_type = (body.promo_type or PROMO_TYPE_PERCENT_OFF_CATEGORY).strip()
        if promo.promo_type != PROMO_TYPE_PERCENT_OFF_CATEGORY:
            raise HTTPException(
                status_code=400,
                detail=f"promo_type must be {PROMO_TYPE_PERCENT_OFF_CATEGORY}",
            )
        promo.percent_off = body.percent_off
        cat = body.category.strip()
        if not cat:
            raise HTTPException(status_code=400, detail="category is required")
        promo.category = cat[:120]
    else:
        assert isinstance(body, models.PricePromotionUpdate)
        if body.name is not None:
            name = body.name.strip()
            if not name:
                raise HTTPException(status_code=400, detail="name cannot be empty")
            promo.name = name[:120]
        if body.percent_off is not None:
            promo.percent_off = body.percent_off
        if body.category is not None:
            cat = body.category.strip()
            if not cat:
                raise HTTPException(status_code=400, detail="category cannot be empty")
            promo.category = cat[:120]
        if body.enabled is not None:
            promo.enabled = body.enabled
        if body.stackable is not None:
            promo.stackable = body.stackable

    channels = getattr(body, "channels", None)
    if creating or (isinstance(body, models.PricePromotionUpdate) and "channels" in body.model_fields_set):
        if channels is None:
            promo.channels = None
        else:
            cleaned = []
            for c in channels:
                v = str(c).strip().lower()
                if v not in VALID_CHANNELS:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid channel '{c}'. Allowed: {sorted(VALID_CHANNELS)}",
                    )
                cleaned.append(v)
            promo.channels = cleaned or None

    if creating or (isinstance(body, models.PricePromotionUpdate) and "starts_at" in body.model_fields_set):
        promo.starts_at = _parse_optional_dt(getattr(body, "starts_at", None))
    if creating or (isinstance(body, models.PricePromotionUpdate) and "ends_at" in body.model_fields_set):
        promo.ends_at = _parse_optional_dt(getattr(body, "ends_at", None))

    days = getattr(body, "days_of_week", None)
    if creating or (isinstance(body, models.PricePromotionUpdate) and "days_of_week" in body.model_fields_set):
        if days is None:
            promo.days_of_week = None
        else:
            cleaned_days = []
            for d in days:
                di = int(d)
                if di < 0 or di > 6:
                    raise HTTPException(status_code=400, detail="days_of_week must be 0–6 (Mon–Sun)")
                cleaned_days.append(di)
            promo.days_of_week = cleaned_days or None

    if creating or (isinstance(body, models.PricePromotionUpdate) and "start_time_local" in body.model_fields_set):
        st = getattr(body, "start_time_local", None)
        if st is not None and str(st).strip():
            _parse_hhmm(str(st))  # validate
            promo.start_time_local = str(st).strip()[:5]
        else:
            promo.start_time_local = None
    if creating or (isinstance(body, models.PricePromotionUpdate) and "end_time_local" in body.model_fields_set):
        et = getattr(body, "end_time_local", None)
        if et is not None and str(et).strip():
            _parse_hhmm(str(et))
            promo.end_time_local = str(et).strip()[:5]
        else:
            promo.end_time_local = None

    if creating:
        if getattr(body, "stackable", None) is not None:
            promo.stackable = bool(body.stackable)
        if getattr(body, "enabled", None) is not None:
            promo.enabled = bool(body.enabled)

    promo.updated_at = datetime.now(timezone.utc)
