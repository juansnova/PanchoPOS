"""Abstract adapter interface for delivery marketplace brands."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from sqlmodel import Session

    from app.models import DeliveryMarketplaceIntegration


class DeliveryAdapter(ABC):
    provider_key: str

    @abstractmethod
    def test_connection(self, session: Session, integration: "DeliveryMarketplaceIntegration") -> tuple[bool, str]:
        """Return (ok, message). Uses decrypted credentials server-side only."""

    @abstractmethod
    def parse_webhook_order(self, body: dict[str, Any]) -> dict[str, Any]:
        """
        Normalize webhook JSON into internal shape:
        {
          "external_order_ref": str,
          "customer_name": str | None,
          "lines": [{"external_item_id": str, "quantity": int}],
        }
        Raises ValueError on invalid payload.
        """


class StubDeliveryAdapter(DeliveryAdapter):
    """Sandbox-friendly stub used until real OAuth/API integrations are wired."""

    provider_key = "stub"

    def test_connection(self, session: Session, integration: "DeliveryMarketplaceIntegration") -> tuple[bool, str]:
        _ = session
        from app.delivery_credentials import decrypt_credentials_json

        creds = decrypt_credentials_json(integration.credentials_encrypted)
        if creds and str(creds.get("api_key") or "").strip():
            return True, "Stub: credentials present."
        return False, "Stub: set at least api_key in credentials JSON for a passing test."

    def parse_webhook_order(self, body: dict[str, Any]) -> dict[str, Any]:
        ref = body.get("external_order_ref") or body.get("order_id")
        if not ref:
            raise ValueError("missing external_order_ref")
        lines_in = body.get("lines") or []
        lines: list[dict[str, Any]] = []
        for row in lines_in:
            if not isinstance(row, dict):
                continue
            eid = row.get("external_item_id") or row.get("sku")
            qty = int(row.get("quantity") or row.get("qty") or 1)
            if eid is None:
                continue
            lines.append({"external_item_id": str(eid), "quantity": max(1, min(qty, 99))})
        if not lines:
            raise ValueError("lines required")
        return {
            "external_order_ref": str(ref),
            "customer_name": (body.get("customer_name") or body.get("customer") or None),
            "lines": lines,
        }


def _adapter_class(key: str, label: str):
    class _A(StubDeliveryAdapter):
        provider_key = key

    _A.__doc__ = f"Stub adapter for {label}."
    return _A


PROVIDER_REGISTRY: dict[str, type[DeliveryAdapter]] = {
    "uber_eats": _adapter_class("uber_eats", "Uber Eats"),
    "glovo": _adapter_class("glovo", "Glovo"),
    "deliveroo": _adapter_class("deliveroo", "Deliveroo"),
    "stub": StubDeliveryAdapter,
}
