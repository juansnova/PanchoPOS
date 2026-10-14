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
    content = payload.get("request_payload") if isinstance(payload.get("request_payload"), dict) else {}
    endpoint = "bills/validate" if document_type == "invoice" else "credit-notes/validate"
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
        data = body.get("data") if isinstance(body.get("data"), dict) else body
        bill = data.get("bill") if isinstance(data, dict) and isinstance(data.get("bill"), dict) else data
        return {
            "status": "provider_accepted",
            "http_status": resp.status_code,
            "channel": "factus",
            "provider": PROVIDER_FACTUS,
            "body": body,
            "provider_invoice_number": (bill or {}).get("number") or (bill or {}).get("reference_code"),
            "cufe": (bill or {}).get("cufe"),
            # Factus returns the PDF as base64 content, not a URL; storing a URL needs an
            # upload step (e.g. write to uploads/ and serve statically) — not done here yet.
            "qr_image": (bill or {}).get("qr"),
        }
    except requests.RequestException as exc:
        logger.warning("factus request failed: %s", exc)
        return {
            "status": "provider_unreachable",
            "channel": "factus",
            "provider": PROVIDER_FACTUS,
            "error": str(exc)[:200],
        }


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
