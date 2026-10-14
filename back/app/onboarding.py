"""Restaurant signup helpers."""

from __future__ import annotations


def assign_maps_url(tenant, maps_url: str | None) -> None:
    """Store a single maps share link on the tenant (Google or OpenStreetMap)."""
    if not maps_url or not str(maps_url).strip():
        return
    url = str(maps_url).strip()
    lower = url.lower()
    if "openstreetmap" in lower:
        tenant.public_openstreetmap_url = url
    else:
        tenant.public_google_maps_url = url
