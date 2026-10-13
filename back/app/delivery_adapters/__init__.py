"""Pluggable delivery marketplace adapters (provider-specific logic)."""

from __future__ import annotations

from .base import DeliveryAdapter, PROVIDER_REGISTRY
from .stub import StubDeliveryAdapter


def get_adapter(provider_key: str) -> DeliveryAdapter:
    cls = PROVIDER_REGISTRY.get(provider_key)
    if not cls:
        raise KeyError(provider_key)
    return cls()


__all__ = ["DeliveryAdapter", "StubDeliveryAdapter", "get_adapter", "PROVIDER_REGISTRY"]
