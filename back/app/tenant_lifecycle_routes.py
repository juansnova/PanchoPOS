"""Owner-only tenant data export and irreversible purge."""

from __future__ import annotations

import logging
import re
import zipfile
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlmodel import Session

from .db import get_session
from . import models
from .permissions import require_role
from .rate_limits import admin_user_limit
from .tenant_lifecycle import (
    bundle_to_json_bytes,
    delete_tenant_cascade,
    export_tenant_bundle,
    remove_tenant_files,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"


class TenantPurgeBody(BaseModel):
    """Confirm irreversible delete by typing the exact tenant name."""

    confirm_tenant_name: str = Field(min_length=1, max_length=256)


@router.get("/data-export")
@admin_user_limit()
def download_tenant_data_export(
    request: Request,
    response: Response,
    current_user: models.User = Depends(require_role(models.UserRole.owner)),
    session: Session = Depends(get_session),
):
    """ZIP with `tenant-export.json` — full tenant snapshot (payment/SMTP secrets redacted in tenant row)."""
    if not current_user.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant associated with user")

    tid = current_user.tenant_id
    try:
        bundle = export_tenant_bundle(session, tid)
    except ValueError:
        raise HTTPException(status_code=404, detail="Tenant not found")

    raw = bundle_to_json_bytes(bundle)
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("tenant-export.json", raw)
    payload = buf.getvalue()
    raw_name = ((bundle.get("tenant") or {}).get("name") or "tenant")[:48]
    # ASCII-only filename: Starlette decodes Content-Disposition as UTF-8 bytes.
    safe_slug = re.sub(r"[^A-Za-z0-9._-]+", "_", raw_name).strip("_") or "tenant"
    filename = f"tenant-{tid}-{safe_slug}-export.zip"

    return Response(
        content=payload,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _purge_cleanup_job(tenant_id: int, provider_tokens: list[str]) -> None:
    remove_tenant_files(_UPLOADS_DIR, tenant_id, provider_tokens)


@router.post("/purge")
@admin_user_limit()
def purge_tenant(
    request: Request,
    response: Response,
    body: TenantPurgeBody,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(require_role(models.UserRole.owner)),
    session: Session = Depends(get_session),
):
    """
    Permanently delete this tenant and all related data. Current user row is removed — client must log out.
    Requires `confirm_tenant_name` to match the tenant name exactly (trimmed).
    """
    if not current_user.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant associated with user")

    tid = current_user.tenant_id
    tenant = session.get(models.Tenant, tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    if body.confirm_tenant_name.strip() != tenant.name.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tenant name does not match confirmation",
        )

    operator_id = current_user.id
    operator_username = current_user.username

    try:
        tokens = delete_tenant_cascade(session, tid)
    except ValueError:
        raise HTTPException(status_code=404, detail="Tenant not found")

    session.commit()

    background_tasks.add_task(_purge_cleanup_job, tid, tokens)
    logger.warning(
        "Tenant purge scheduled: tenant_id=%s operator_user_id=%s operator_username=%s",
        tid,
        operator_id,
        operator_username,
    )

    return {
        "message": "Tenant and all related data have been deleted. Your session is no longer valid; sign out.",
        "tenant_id": tid,
    }
