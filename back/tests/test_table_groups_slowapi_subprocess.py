"""
Regression: POST/DELETE /table-groups must return Starlette Response when SlowAPI is enabled.

Plain dict returns trigger slowapi's wrapper to call _inject_headers(kwargs.get("response"), …)
with no Response (500: parameter `response` must be an instance of …).
See agents/tasks UNTESTED-*-delete-table-groups-500-slowapi-response-parameter.md
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

_BACK_ROOT = Path(__file__).resolve().parent.parent


_SUBPROCESS = r"""
import os
import sys
from datetime import timedelta

os.environ["RATE_LIMIT_ENABLED"] = "true"

sys.path.insert(0, r"%s")

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app import models, security
from app.db import engine
from app.main import app


def main() -> int:
    session = Session(engine)
    user = session.exec(
        select(models.User).where(
            models.User.tenant_id == 1,
            models.User.role == models.UserRole.owner,
        )
    ).first()
    if not user:
        print("skip: no tenant-1 owner")
        return 0
    inactive = session.exec(
        select(models.Table).where(
            models.Table.tenant_id == 1,
            models.Table.is_active == False,  # noqa: E712
            models.Table.table_group_id == None,  # noqa: E711
            models.Table.floor_id != None,  # noqa: E711
        )
    ).all()
    by_floor: dict[int, list] = {}
    for t in inactive:
        if t.floor_id is not None and t.id is not None:
            by_floor.setdefault(t.floor_id, []).append(t)
    pair = None
    for _fid, ts in by_floor.items():
        if len(ts) >= 2:
            pair = (ts[0].id, ts[1].id)
            break
    if not pair:
        print("skip: no two inactive tables on same floor")
        return 0

    def _headers(u: models.User) -> dict[str, str]:
        data = {
            "sub": u.email,
            "tenant_id": u.tenant_id,
            "provider_id": None,
            "token_version": u.token_version,
        }
        tok = security.create_access_token(data, expires_delta=timedelta(minutes=30))
        return {"Authorization": f"Bearer {tok}"}

    h = _headers(user)
    client = TestClient(app)
    tid1, tid2 = pair
    r = client.post("/table-groups", json={"table_ids": [tid1, tid2]}, headers=h)
    if r.status_code != 201:
        print("POST failed", r.status_code, r.text)
        return 1
    gid = r.json()["id"]
    r2 = client.delete(f"/table-groups/{gid}", headers=h)
    session.close()
    if r2.status_code != 200:
        print("DELETE failed", r2.status_code, r2.text)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
""" % (
    str(_BACK_ROOT).replace("\\", "\\\\"),
)


def test_table_groups_post_delete_with_slowapi_enabled_subprocess() -> None:
    """Fresh interpreter so app loads with RATE_LIMIT_ENABLED=true (limiter.enabled)."""
    r = subprocess.run(
        [sys.executable, "-c", _SUBPROCESS],
        cwd=str(_BACK_ROOT),
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert r.returncode == 0, f"stderr={r.stderr!r} stdout={r.stdout!r}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
