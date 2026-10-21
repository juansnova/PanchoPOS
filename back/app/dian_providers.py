"""Certified DIAN electronic-invoicing provider adapters (Colombia).

Chosen primary: Factus (see docs/0078-dian-invoicing.md).
Never build UBL 2.1 XML / CUFE / digital signature in-app — that is the certified
provider's job. Field mapping below follows Factus's public API docs
(developers.factus.com.co) and must be re-verified against real sandbox responses
once tenant credentials exist; do not assume it is production-exact.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

import requests

from app import models
from app.settings import settings

logger = logging.getLogger(__name__)

PROVIDER_MOCK = "mock"
PROVIDER_FACTUS = "factus"
_VALID = frozenset({PROVIDER_MOCK, PROVIDER_FACTUS})

FACTUS_TEST_BASE = "https://api-sandbox.factus.com.co/v2"
FACTUS_LIVE_BASE = "https://api.factus.com.co/v2"

# Statuses that satisfy the live issuance path
LIVE_OK_STATUSES = frozenset({"provider_accepted", "mock_accepted"})


def dian_provider_name() -> str:
    raw = (getattr(settings, "dian_provider", None) or PROVIDER_MOCK).strip().lower()
    return raw if raw in _VALID else PROVIDER_MOCK


def _client_id() -> str:
    return (getattr(settings, "dian_provider_client_id", None) or "").strip()


def _client_secret() -> str:
    return (getattr(settings, "dian_provider_client_secret", None) or "").strip()


def _username() -> str:
    return (getattr(settings, "dian_provider_username", None) or "").strip()


def _password() -> str:
    return (getattr(settings, "dian_provider_password", None) or "").strip()


def factus_base_url(*, live: bool) -> str:
    configured = (getattr(settings, "dian_provider_base_url", None) or "").strip().rstrip("/")
    if configured:
        return configured
    return FACTUS_LIVE_BASE if live else FACTUS_TEST_BASE


def live_credentials_ready() -> bool:
    """True when unlock may allow dian_mode=live for the configured provider."""
    name = dian_provider_name()
    if name == PROVIDER_MOCK:
        # Mock is for local development / tests only — never production.
        return not bool(getattr(settings, "is_production", False))
    return bool(_client_id() and _client_secret() and _username() and _password())


def provider_status() -> dict[str, Any]:
    """Read-only summary for the Settings screen. Never includes credential values."""
    name = dian_provider_name()
    return {
        "provider": name,
        "credentials_ready": live_credentials_ready(),
        "live_unlocked": bool(getattr(settings, "dian_live_unlock", False)) and live_credentials_ready(),
    }


def submit_dian_invoice(
    payload: dict[str, Any],
    tenant: models.Tenant,
    *,
    mode: str,
) -> dict[str, Any]:
    """Submit invoice/credit-note via the configured provider. Returns normalized result dict."""
    name = dian_provider_name()
    if name == PROVIDER_FACTUS:
        return _submit_factus(payload, tenant, mode=mode)
    return _submit_mock(payload, tenant, mode=mode)


def _submit_mock(
    payload: dict[str, Any],
    tenant: models.Tenant,
    *,
    mode: str,
) -> dict[str, Any]:
    document_type = str(payload.get("document_type") or "invoice")
    return {
        "status": "mock_accepted",
        "channel": "mock",
        "provider": PROVIDER_MOCK,
        "http_status": 200,
        "body": {
            "schema": "pos.dian.mock.v1",
            "disclaimer": (
                "In-process mock DIAN provider — not a real DIAN submission. "
                "Use only for local development / automated tests."
            ),
            "tenant_id": tenant.id,
            "document_type": document_type,
            "mode": mode,
            "provider_invoice_number": f"MOCK-{uuid.uuid4().hex[:10]}",
            "cufe": f"mock-cufe-{uuid.uuid4().hex}",
            "dian_submission": "simulated",
        },
    }


def _submit_factus(
    payload: dict[str, Any],
    tenant: models.Tenant,
    *,
    mode: str,
) -> dict[str, Any]:
    """Map POS order → Factus `POST /bills/validate` (invoice) create call."""
    if not (_client_id() and _client_secret() and _username() and _password()):
        return {
            "status": "provider_error",
            "channel": "factus",
            "provider": PROVIDER_FACTUS,
            "error": (
                "DIAN_PROVIDER_CLIENT_ID, DIAN_PROVIDER_CLIENT_SECRET, DIAN_PROVIDER_USERNAME "
                "and DIAN_PROVIDER_PASSWORD are required"
            ),
        }

    base = factus_base_url(live=(mode == "live"))
    token = _factus_auth(base, mode=mode)
    if not token:
        return {
            "status": "provider_unreachable",
            "channel": "factus",
            "provider": PROVIDER_FACTUS,
            "error": "Factus OAuth2 authentication failed",
        }

    document_type = str(payload.get("document_type") or "invoice")
    pos_payload = payload.get("request_payload") if isinstance(payload.get("request_payload"), dict) else {}
    if document_type == "invoice":
        content, endpoint = _factus_bill_payload(pos_payload), "bills/validate"
    else:
        content, endpoint = _factus_credit_note_payload(pos_payload), "credit-notes/validate"
    url = f"{base}/{endpoint}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    try:
        resp = requests.post(url, json=content, headers=headers, timeout=20)
        body = _parse_json_body(resp)
        if resp.status_code >= 400:
            logger.warning("factus HTTP %s: %s", resp.status_code, body)
            return {
                "status": "provider_error",
                "http_status": resp.status_code,
                "channel": "factus",
                "provider": PROVIDER_FACTUS,
                "body": body,
            }
        bill = body.get("data") if isinstance(body.get("data"), dict) else {}
        links = bill.get("links") if isinstance(bill.get("links"), dict) else {}
        return {
            "status": "provider_accepted" if bill.get("is_validated") else "provider_error",
            "http_status": resp.status_code,
            "channel": "factus",
            "provider": PROVIDER_FACTUS,
            "body": body,
            "provider_invoice_number": bill.get("number") or bill.get("reference_code"),
            "cufe": bill.get("cufe"),
            "qr_url": links.get("qr"),
            "pdf_url": links.get("public_url"),
        }
    except requests.RequestException as exc:
        logger.warning("factus request failed: %s", exc)
        return {
            "status": "provider_unreachable",
            "channel": "factus",
            "provider": PROVIDER_FACTUS,
            "error": str(exc)[:200],
        }


# POS payment_method -> Factus payment_method_code (10 cash, 47 transfer, 48 credit card, ZZZ other)
_FACTUS_PAYMENT_CODES = {
    "cash": "10",
    "transfer": "47",
    "terminal": "48",
    "card_terminal": "48",
    "card": "48",
    "stripe": "48",
    "revolut": "48",
}


def _money(cents: float) -> str:
    return f"{cents / 100:.2f}"


def _factus_customer(customer: dict[str, Any] | None) -> dict[str, Any]:
    tax_id = str((customer or {}).get("identification") or "").strip()
    if not customer or not tax_id:
        # DIAN "consumidor final" generic buyer
        return {
            "identification_document_code": "13",
            "identification": "222222222222",
            "legal_organization_code": "2",
            "names": "Consumidor Final",
        }
    company = str(customer.get("company_name") or "").strip()
    digits = "".join(ch for ch in tax_id.split("-")[0] if ch.isdigit())
    out: dict[str, Any] = {
        "identification_document_code": "31" if company else "13",
        "identification": digits or tax_id,
        "legal_organization_code": "1" if company else "2",
    }
    if company:
        out["company"] = company
    else:
        out["names"] = str(customer.get("name") or "Cliente").strip()
    for src, dst in (("address", "address"), ("email", "email"), ("phone", "phone")):
        if customer.get(src):
            out[dst] = str(customer[src]).strip()
    return out


def _factus_items_and_payment(pos: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Items and a single payment detail shared by invoices and credit notes.

    Item prices are tax-inclusive in the POS. Under `responsable_iva` the net price is
    sent with IVA (code 01); otherwise items go out as excluded (0%).
    Tips are not part of the invoice; the payment amount is the items total, paid with
    the order's dominant payment method.
    """
    iva_regime = pos.get("tenant_tax_regime") == "responsable_iva"
    items = []
    total_cents = 0
    for idx, it in enumerate(pos.get("items") or [], start=1):
        qty = int(it.get("quantity") or 1)
        gross = int(it.get("unit_price_cents") or 0)
        rate = float(it.get("tax_rate_percent") or 0)
        total_cents += gross * qty
        if iva_regime and rate > 0:
            net = gross / (1 + rate / 100)
            tax = {"code": "01", "rate": f"{rate:.2f}"}
        else:
            net = gross
            tax = {"code": "01", "rate": "0.00", "is_excluded": True}
        items.append(
            {
                "code_reference": f"P{idx}",
                "name": str(it.get("name") or "Producto")[:250],
                "quantity": f"{qty:.2f}",
                "price": _money(net),
                "unit_measure_code": "94",
                "standard_code": "999",
                "taxes": [tax],
            }
        )
    method = _FACTUS_PAYMENT_CODES.get(str(pos.get("payment_method") or "cash").lower(), "ZZZ")
    payments = [{"payment_form": "1", "payment_method_code": method, "amount": _money(total_cents)}]
    return items, payments


def _factus_bill_payload(pos: dict[str, Any]) -> dict[str, Any]:
    """Translate the provider-agnostic POS payload into Factus `POST /v2/bills/validate`."""
    items, payments = _factus_items_and_payment(pos)
    content: dict[str, Any] = {
        "reference_code": f"POS-{pos.get('tenant_id')}-{pos.get('order_id')}",
        "payment_details": payments,
        "send_email": bool(pos.get("send_email")),
        "customer": _factus_customer(pos.get("customer")),
        "items": items,
    }
    if pos.get("numbering_range_id"):
        content["numbering_range_id"] = int(pos["numbering_range_id"])
    return content


def _factus_credit_note_payload(pos: dict[str, Any]) -> dict[str, Any]:
    """Factus `POST /v2/credit-notes/validate`: full annulment (concept 2) of an issued invoice.

    Docs say `customer` is optional, but the sandbox rejects the note without it, so the
    same customer as on the invoice is sent.
    """
    items, payments = _factus_items_and_payment(pos)
    for it in items:
        it["note"] = "Anulación de factura"
    content: dict[str, Any] = {
        "reference_code": f"POS-{pos.get('tenant_id')}-{pos.get('order_id')}-NC",
        "correction_concept_code": "2",
        "customization_id": "20",
        "bill_number": pos.get("cancels_provider_invoice_number"),
        "payment_details": payments,
        "customer": {**_factus_customer(pos.get("customer")), "responsibilities": ["R-99-PN"]},
        "items": items,
    }
    return content


def _factus_auth(base: str, *, mode: str) -> str | None:
    root = base.rstrip("/")
    if root.endswith("/v2"):
        root = root[: -len("/v2")]
    url = f"{root}/oauth/token"
    try:
        resp = requests.post(
            url,
            json={
                "grant_type": "password",
                "client_id": _client_id(),
                "client_secret": _client_secret(),
                "username": _username(),
                "password": _password(),
            },
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            timeout=12,
        )
        body = _parse_json_body(resp)
        if resp.status_code >= 400:
            logger.warning("factus auth HTTP %s: %s", resp.status_code, body)
            return None
        token = body.get("access_token")
        return str(token) if token else None
    except requests.RequestException as exc:
        logger.warning("factus auth failed: %s", exc)
        return None


def _parse_json_body(resp: requests.Response) -> dict[str, Any]:
    try:
        parsed = resp.json()
        return parsed if isinstance(parsed, dict) else {"raw": parsed}
    except Exception:
        return {"raw": (resp.text or "")[:500]}
