"""Colombia DIAN electronic invoice issuance via certified provider (see docs/0078-dian-invoicing.md).

The provider (Factus) builds the UBL 2.1 XML, CUFE and digital signature and
files with the DIAN. This module only decides *when* to issue, builds the
provider-agnostic payload, and persists the resulting DianInvoice row.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, select

from app import models
from app.dian_providers import (
    LIVE_OK_STATUSES,
    dian_provider_name,
    live_credentials_ready,
    submit_dian_invoice,
)
from app.settings import settings

logger = logging.getLogger(__name__)

_ISSUABLE_STATUSES = frozenset(
    {
        models.OrderStatus.paid,
        models.OrderStatus.completed,
    }
)


def order_dian_amount_cents(session: Session, order: models.Order) -> int:
    items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order.id)).all()
    active = [
        i
        for i in items
        if not i.removed_by_customer
        and i.removed_by_user_id is None
        and i.status != models.OrderItemStatus.cancelled
    ]
    subtotal = sum(i.price_cents * i.quantity for i in active)
    tip = int(order.tip_amount_cents or 0)
    fee = int(getattr(order, "delivery_fee_cents", 0) or 0)
    extra = int(getattr(order, "extra_charge_cents", 0) or 0)
    return max(0, subtotal + tip + fee + extra)


def _order_dian_items(session: Session, order: models.Order) -> list[dict[str, Any]]:
    items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order.id)).all()
    active = [
        i
        for i in items
        if not i.removed_by_customer
        and i.removed_by_user_id is None
        and i.status != models.OrderItemStatus.cancelled
    ]
    out = []
    for i in active:
        out.append(
            {
                "name": i.product_name,
                "quantity": i.quantity,
                "unit_price_cents": i.price_cents,
                "tax_rate_percent": i.tax_rate_percent or 0,
            }
        )
    return out


def order_dian_payment_method(session: Session, order: models.Order) -> str:
    """Dominant payment method of the order (largest split leg), else the order's own."""
    legs = session.exec(
        select(models.OrderPayment).where(models.OrderPayment.order_id == order.id)
    ).all()
    if legs:
        return max(legs, key=lambda p: p.amount_cents or 0).payment_method
    return order.payment_method or "cash"


def build_issue_payload(
    order: models.Order,
    tenant: models.Tenant,
    billing_customer: models.BillingCustomer | None,
    *,
    document_type: str,
    amount_cents: int,
    items: list[dict[str, Any]],
    payment_method: str = "cash",
    cancels_provider_invoice_number: str | None = None,
) -> dict[str, Any]:
    customer = None
    if billing_customer:
        customer = {
            "name": billing_customer.name,
            "company_name": billing_customer.company_name,
            "identification": billing_customer.tax_id,
            "address": billing_customer.address,
            "email": billing_customer.email,
            "phone": billing_customer.phone,
        }
    return {
        "schema": "pos.dian_invoice.v1",
        "document_type": document_type,
        "order_id": order.id,
        "tenant_id": tenant.id,
        "tenant_tax_id": tenant.tax_id,
        "tenant_tax_regime": tenant.dian_tax_regime,
        "numbering_range_id": tenant.dian_numbering_range_id,
        "send_email": bool(tenant.dian_send_email),
        "payment_method": payment_method,
        "amount_cents": amount_cents,
        "items": items,
        "customer": customer,
        "cancels_provider_invoice_number": cancels_provider_invoice_number,
        "disclaimer": (
            "Provider-agnostic POS payload; Factus (or configured provider) maps this to its "
            "own UBL 2.1 create-invoice request. See docs/0078-dian-invoicing.md."
        ),
    }


def get_dian_invoice(
    session: Session, tenant_id: int, order_id: int
) -> models.DianInvoice | None:
    return session.exec(
        select(models.DianInvoice).where(
            models.DianInvoice.tenant_id == tenant_id,
            models.DianInvoice.order_id == order_id,
            models.DianInvoice.document_type == "invoice",
        )
    ).first()


def order_has_active_dian_invoice(session: Session, tenant_id: int, order_id: int) -> bool:
    di = get_dian_invoice(session, tenant_id, order_id)
    return bool(di and di.status not in ("cancelled", "error"))


def assert_order_dian_mutable(session: Session, tenant_id: int, order_id: int) -> None:
    """Block edits/deletes when an issued DIAN invoice exists (use credit note instead)."""
    if order_has_active_dian_invoice(session, tenant_id, order_id):
        raise HTTPException(
            status_code=409,
            detail=(
                "Order has an issued DIAN electronic invoice and cannot be edited or deleted. "
                "Issue a credit note (nota crédito) first."
            ),
        )


def live_mode_allowed() -> bool:
    unlock = bool(getattr(settings, "dian_live_unlock", False))
    return unlock and live_credentials_ready()


def assert_dian_mode_allowed(mode: str) -> None:
    if mode == "live" and not live_mode_allowed():
        raise HTTPException(
            status_code=400,
            detail=(
                "dian_mode live is blocked until DIAN_LIVE_UNLOCK=true and certified provider "
                "credentials are ready (DIAN_PROVIDER=factus with DIAN_PROVIDER_CLIENT_ID/"
                "CLIENT_SECRET/USERNAME/PASSWORD); see docs/0078-dian-invoicing.md"
            ),
        )


def _submit(
    session: Session,
    di: models.DianInvoice,
    tenant: models.Tenant,
    *,
    require_live_success: bool = False,
) -> models.DianInvoice:
    payload = {
        "document_type": di.document_type,
        "request_payload": di.request_payload,
    }
    result = submit_dian_invoice(payload, tenant, mode=di.mode or "test")
    now = datetime.now(timezone.utc)
    status = str(result.get("status") or "provider_error")
    di.submission_status = status
    di.submitted_at = now
    di.response_payload = {**(di.response_payload or {}), "submit": result, "submitted_at": now.isoformat()}
    if status in LIVE_OK_STATUSES:
        di.status = "issued"
        di.provider_invoice_number = result.get("provider_invoice_number") or di.provider_invoice_number
        di.cufe = result.get("cufe") or di.cufe
        di.pdf_url = result.get("pdf_url") or di.pdf_url
    else:
        di.status = "error"
        di.error_message = str(result.get("error") or result.get("body") or status)[:2000]
    session.add(di)
    session.flush()

    if require_live_success and status not in LIVE_OK_STATUSES:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Certified DIAN provider rejected or was unreachable (status={status}). "
                f"Fix provider credentials / connectivity and retry. "
                f"See docs/0078-dian-invoicing.md"
            ),
        )
    return di


def issue_or_get_dian_invoice(
    session: Session,
    tenant: models.Tenant,
    order: models.Order,
) -> models.DianInvoice:
    mode = (tenant.dian_mode or "off").strip().lower()
    if mode == "off":
        raise HTTPException(status_code=400, detail="DIAN invoicing is disabled for this tenant")
    if mode not in ("test", "live"):
        raise HTTPException(status_code=400, detail="Invalid dian_mode")
    if mode == "live":
        assert_dian_mode_allowed("live")

    existing = get_dian_invoice(session, tenant.id, order.id)
    if existing:
        if existing.status != "issued" or (mode == "live" and existing.submission_status not in LIVE_OK_STATUSES):
            _submit(session, existing, tenant, require_live_success=(mode == "live"))
        return existing

    if order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == models.OrderStatus.cancelled:
        raise HTTPException(status_code=400, detail="Cannot issue DIAN invoice for a cancelled order")
    if order.status not in _ISSUABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="Order must be paid or completed before issuing a DIAN invoice",
        )

    billing_customer = None
    if order.billing_customer_id:
        billing_customer = session.get(models.BillingCustomer, order.billing_customer_id)
        if billing_customer and billing_customer.tenant_id != tenant.id:
            billing_customer = None

    tenant_locked = session.exec(
        select(models.Tenant).where(models.Tenant.id == tenant.id).with_for_update()
    ).first()
    if not tenant_locked:
        raise HTTPException(status_code=404, detail="Tenant not found")

    amount_cents = order_dian_amount_cents(session, order)
    items = _order_dian_items(session, order)
    req_payload = build_issue_payload(
        order,
        tenant_locked,
        billing_customer,
        document_type="invoice",
        amount_cents=amount_cents,
        items=items,
        payment_method=order_dian_payment_method(session, order),
    )

    di = models.DianInvoice(
        tenant_id=tenant.id,
        order_id=order.id,
        mode=mode,
        status="pending",
        document_type="invoice",
        amount_cents=amount_cents,
        request_payload=req_payload,
        response_payload={"status": "created_local", "note": "Not yet submitted to provider."},
        provider=dian_provider_name(),
        submission_status="local_only",
    )
    tenant_locked.dian_invoice_next_number = int(tenant_locked.dian_invoice_next_number or 1) + 1
    session.add(di)
    session.add(tenant_locked)
    session.flush()

    _submit(session, di, tenant_locked, require_live_success=(mode == "live"))
    return di


def cancel_dian_invoice(
    session: Session,
    tenant: models.Tenant,
    order: models.Order,
) -> models.DianInvoice:
    """Issue a credit note (nota crédito) cancelling the order's issued DIAN invoice."""
    mode = (tenant.dian_mode or "off").strip().lower()
    if mode == "off":
        raise HTTPException(status_code=400, detail="DIAN invoicing is disabled for this tenant")
    if mode == "live":
        assert_dian_mode_allowed("live")

    original = get_dian_invoice(session, tenant.id, order.id)
    if not original or original.status != "issued":
        raise HTTPException(status_code=404, detail="Issued DIAN invoice not found")

    existing_credit = session.exec(
        select(models.DianInvoice).where(
            models.DianInvoice.tenant_id == tenant.id,
            models.DianInvoice.cancels_dian_invoice_id == original.id,
            models.DianInvoice.document_type == "credit_note",
        )
    ).first()
    if existing_credit:
        if existing_credit.status == "error":
            _submit(session, existing_credit, tenant, require_live_success=(mode == "live"))
            if existing_credit.status == "issued":
                original.status = "cancelled"
                session.add(original)
                session.flush()
        return existing_credit

    billing_customer = None
    if order.billing_customer_id:
        billing_customer = session.get(models.BillingCustomer, order.billing_customer_id)
        if billing_customer and billing_customer.tenant_id != tenant.id:
            billing_customer = None

    amount_cents = int(original.amount_cents or 0)
    req_payload = build_issue_payload(
        order,
        tenant,
        billing_customer,
        document_type="credit_note",
        amount_cents=amount_cents,
        items=_order_dian_items(session, order),
        payment_method=order_dian_payment_method(session, order),
        cancels_provider_invoice_number=original.provider_invoice_number,
    )

    credit = models.DianInvoice(
        tenant_id=tenant.id,
        order_id=order.id,
        mode=mode if mode in ("test", "live") else "test",
        status="pending",
        document_type="credit_note",
        amount_cents=amount_cents,
        request_payload=req_payload,
        response_payload={"status": "created_local", "note": "Not yet submitted to provider."},
        provider=dian_provider_name(),
        submission_status="local_only",
        cancels_dian_invoice_id=original.id,
    )
    session.add(credit)
    session.flush()

    _submit(session, credit, tenant, require_live_success=(mode == "live"))
    if credit.status == "issued":
        original.status = "cancelled"
        session.add(original)
        session.flush()
    return credit


def dian_invoice_public_dict(di: models.DianInvoice) -> dict[str, Any]:
    return {
        "id": di.id,
        "order_id": di.order_id,
        "mode": di.mode,
        "status": di.status,
        "document_type": di.document_type,
        "provider": di.provider,
        "provider_invoice_number": di.provider_invoice_number,
        "cufe": di.cufe,
        "pdf_url": di.pdf_url,
        "amount_cents": int(di.amount_cents or 0),
        "submission_status": di.submission_status,
        "error_message": di.error_message,
        "issued_at": di.issued_at.isoformat() if di.issued_at else None,
        "submitted_at": di.submitted_at.isoformat() if di.submitted_at else None,
        "cancels_dian_invoice_id": di.cancels_dian_invoice_id,
    }
