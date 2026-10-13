"""Tenant public URL slug helpers (name-city format for /public-menu/{slug})."""

from __future__ import annotations

import re
import unicodedata
from typing import TYPE_CHECKING

from sqlmodel import Session, select

if TYPE_CHECKING:
    from app import models

_SLUG_MAX = 160
_SEGMENT_MAX = 80


def slugify_segment(value: str | None) -> str:
    """URL-safe lowercase segment from a name or city."""
    if not value or not isinstance(value, str):
        return ""
    s = unicodedata.normalize("NFKD", value.strip())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")[:_SEGMENT_MAX]


def build_name_city_base(name: str | None, city: str | None) -> str:
    """
    Build the preferred slug base: ``{name}-{city}`` when city is set,
    otherwise ``{name}`` (city can be filled later in Settings).
    """
    name_part = slugify_segment(name) or "restaurant"
    city_part = slugify_segment(city)
    if city_part:
        return f"{name_part}-{city_part}"[:_SLUG_MAX]
    return name_part[:_SLUG_MAX]


def allocate_unique_slug(
    session: Session,
    base: str,
    *,
    exclude_tenant_id: int | None = None,
) -> str:
    """Return ``base`` or ``base-2``, ``base-3``, … until unique among tenants."""
    from app import models

    clean = slugify_segment(base) or "restaurant"
    clean = clean[:_SLUG_MAX]
    candidate = clean
    n = 2
    while True:
        q = select(models.Tenant).where(models.Tenant.public_slug == candidate)
        if exclude_tenant_id is not None:
            q = q.where(models.Tenant.id != exclude_tenant_id)
        existing = session.exec(q).first()
        if existing is None:
            return candidate
        suffix = f"-{n}"
        candidate = f"{clean[: _SLUG_MAX - len(suffix)]}{suffix}"
        n += 1
        if n > 500:
            # Last resort: include exclude id or a fixed marker
            tid = exclude_tenant_id or 0
            return f"{clean[: _SLUG_MAX - 12]}-{tid}"[:_SLUG_MAX]


def normalize_public_slug(raw: str | None) -> str | None:
    """Validate/normalize a user-supplied slug; empty → None."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        return None
    s = slugify_segment(raw.replace("_", "-"))
    return s or None


def resolve_tenant_by_ref(session: Session, tenant_ref: str) -> models.Tenant | None:
    """Resolve numeric id or public_slug to a Tenant. Digits-only → id lookup."""
    from app import models

    ref = (tenant_ref or "").strip()
    if not ref:
        return None
    if ref.isdigit():
        tid = int(ref)
        if tid < 1:
            return None
        return session.get(models.Tenant, tid)
    slug = normalize_public_slug(ref)
    if not slug:
        return None
    return session.exec(
        select(models.Tenant).where(models.Tenant.public_slug == slug)
    ).first()


def ensure_tenant_public_slug(session: Session, tenant: models.Tenant) -> str:
    """Set ``public_slug`` from name+city when missing; return the slug."""
    current = (getattr(tenant, "public_slug", None) or "").strip()
    if current:
        return current
    base = build_name_city_base(tenant.name, getattr(tenant, "city", None))
    slug = allocate_unique_slug(session, base, exclude_tenant_id=tenant.id)
    tenant.public_slug = slug
    session.add(tenant)
    return slug


def backfill_all_public_slugs(session: Session) -> dict[str, int]:
    """Assign public_slug to every tenant that lacks one. Idempotent."""
    from app import models

    tenants = session.exec(select(models.Tenant).order_by(models.Tenant.id)).all()
    updated = 0
    for t in tenants:
        # Demo restaurant: seed city so slug is name-city (issue #413).
        if t.id == 1 and not (getattr(t, "city", None) or "").strip():
            t.city = "Barcelona"
            session.add(t)
        before = (getattr(t, "public_slug", None) or "").strip()
        # If city exists but slug is still name-only, clear so ensure rebuilds name-city.
        name_only = build_name_city_base(t.name, None)
        city = (getattr(t, "city", None) or "").strip()
        if city and before and before == name_only:
            t.public_slug = None
            session.add(t)
        ensure_tenant_public_slug(session, t)
        after = (t.public_slug or "").strip()
        if after and after != before:
            updated += 1
    if updated:
        session.commit()
    return {"tenants_updated": updated, "tenants_total": len(tenants)}
