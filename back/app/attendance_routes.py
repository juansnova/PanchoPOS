"""
Employee attendance report (Colombia): monthly Excel built from clock-in/out sessions.
"""

from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
from io import BytesIO
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlmodel import Session, col, select

from . import models
from .attendance_colombia import DEFAULT_TZ, build_attendance_workbook
from .db import get_session
from .permissions import Permission, require_permission
from .rate_limits import admin_user_limit

router = APIRouter()


@router.get("/attendance-excel")
@admin_user_limit()
def export_attendance_excel(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.REPORT_READ))],
    session: Session = Depends(get_session),
    year: int = Query(..., description="Year (YYYY)"),
    month: int = Query(..., ge=1, le=12, description="Month (1-12)"),
    staff_ids: Annotated[list[int] | None, Query(description="Optional staff user IDs (tenant must match)")] = None,
) -> StreamingResponse:
    """
    Monthly attendance workbook for Colombia: hours per employee split day/night, Sunday and holiday
    hours, weekly overtime, calendar grid, session detail, weekly control and alerts.
    Omit **staff_ids** to include all staff with sessions in the month; repeat the param for several IDs.
    """
    if current_user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Tenant required")
    tenant_id = current_user.tenant_id
    tenant = session.get(models.Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    if staff_ids is not None:
        unique_ids = list(dict.fromkeys(staff_ids))
        if not unique_ids:
            raise HTTPException(
                status_code=400,
                detail="staff_ids cannot be empty when provided; omit the parameter to export all staff",
            )
        rows = session.exec(
            select(models.User)
            .where(models.User.tenant_id == tenant_id)
            .where(col(models.User.id).in_(unique_ids))
        ).all()
        if {u.id for u in rows} != set(unique_ids):
            raise HTTPException(
                status_code=400,
                detail="One or more staff_ids are not valid users in this tenant",
            )
    else:
        try:
            tz = ZoneInfo((tenant.timezone or DEFAULT_TZ).strip() or DEFAULT_TZ)
        except Exception:
            tz = ZoneInfo(DEFAULT_TZ)
        first = date(year, month, 1)
        nxt = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        start_utc = datetime.combine(first, time.min, tzinfo=tz).astimezone(timezone.utc)
        end_utc = datetime.combine(nxt, time.min, tzinfo=tz).astimezone(timezone.utc)
        uids = list(
            session.exec(
                select(models.WorkSession.user_id)
                .where(models.WorkSession.tenant_id == tenant_id)
                .where(models.WorkSession.started_at >= start_utc)
                .where(models.WorkSession.started_at < end_utc)
                .distinct()
            ).all()
        )
        if not uids:
            raise HTTPException(status_code=404, detail="No attendance records found for this period")
        rows = session.exec(
            select(models.User)
            .where(models.User.tenant_id == tenant_id)
            .where(col(models.User.id).in_(uids))
        ).all()
    users = sorted(rows, key=lambda u: ((u.full_name or u.username or "").lower(), u.id or 0))

    wb = build_attendance_workbook(session, tenant, users, year, month)
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=asistencia_{year}_{month:02d}.xlsx"},
    )
