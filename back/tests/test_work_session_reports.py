"""Clock-in history report: restaurant-local day range, manual sessions, audit trail."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from pg_client_mixin import PgClientTestCase

from app import models, security


def _bearer_headers(user: models.User) -> dict[str, str]:
    data = {
        "sub": user.username,
        "tenant_id": user.tenant_id,
        "provider_id": getattr(user, "provider_id", None),
        "token_version": user.token_version,
    }
    token = security.create_access_token(data, expires_delta=timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


class TestWorkSessionReports(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        tenant = models.Tenant(name="WS Report", timezone="America/Bogota")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        self.tenant_id = tenant.id
        self.staff = self._user("wsr-staff@test.local", "Staff Uno", models.UserRole.waiter)
        self.admin = self._user("wsr-admin@test.local", "Dueño", models.UserRole.owner)

    def _user(self, username: str, name: str, role: models.UserRole) -> models.User:
        u = models.User(
            username=username,
            hashed_password=security.get_password_hash("secret"),
            full_name=name,
            tenant_id=self.tenant_id,
            role=role,
        )
        self.session.add(u)
        self.session.commit()
        self.session.refresh(u)
        return u

    def test_range_uses_restaurant_local_days(self) -> None:
        # 22:30 Bogotá on 16 Oct = 03:30 UTC on 17 Oct → still the 16th for the restaurant
        started = datetime(2026, 10, 17, 3, 30, tzinfo=timezone.utc)
        self.session.add(
            models.WorkSession(
                tenant_id=self.tenant_id, user_id=self.staff.id,
                started_at=started, ended_at=started + timedelta(hours=1),
            )
        )
        self.session.commit()
        h = _bearer_headers(self.admin)
        on_16 = self.client.get("/reports/work-sessions", params={"from_date": "2026-10-16", "to_date": "2026-10-16"}, headers=h)
        on_17 = self.client.get("/reports/work-sessions", params={"from_date": "2026-10-17", "to_date": "2026-10-17"}, headers=h)
        self.assertEqual(on_16.status_code, 200, on_16.text)
        self.assertEqual(len(on_16.json()), 1)
        self.assertEqual(len(on_17.json()), 0)

    def test_manual_session_overlap_audit_and_counts(self) -> None:
        h = _bearer_headers(self.admin)
        start = datetime(2026, 10, 10, 13, 0, tzinfo=timezone.utc)
        body = {
            "user_id": self.staff.id,
            "started_at": start.isoformat(),
            "ended_at": (start + timedelta(hours=8)).isoformat(),
            "note": "Olvidó fichar",
        }
        r = self.client.post("/reports/work-sessions", json=body, headers=h)
        self.assertEqual(r.status_code, 201, r.text)
        sid = r.json()["id"]
        self.assertEqual(r.json()["duration_minutes"], 480)
        # same slot again → 409
        self.assertEqual(self.client.post("/reports/work-sessions", json=body, headers=h).status_code, 409)
        # end before start → 400
        bad = {**body, "started_at": body["ended_at"], "ended_at": body["started_at"]}
        self.assertEqual(self.client.post("/reports/work-sessions", json=bad, headers=h).status_code, 400)
        # audit trail + counter in the list
        adj = self.client.get(f"/reports/work-sessions/{sid}/adjustments", headers=h)
        self.assertEqual(adj.status_code, 200, adj.text)
        self.assertEqual(adj.json()[0]["note"], "Olvidó fichar")
        self.assertEqual(adj.json()[0]["actor_name"], "Dueño")
        lst = self.client.get("/reports/work-sessions", params={"from_date": "2026-10-10", "to_date": "2026-10-10"}, headers=h)
        self.assertEqual(lst.json()[0]["adjusted_count"], 1)

    def test_manual_session_other_tenant_user_404(self) -> None:
        other = models.Tenant(name="Other")
        self.session.add(other)
        self.session.commit()
        self.session.refresh(other)
        stranger = models.User(
            username="wsr-x@test.local", hashed_password=security.get_password_hash("secret"),
            full_name="X", tenant_id=other.id, role=models.UserRole.waiter,
        )
        self.session.add(stranger)
        self.session.commit()
        self.session.refresh(stranger)
        start = datetime(2026, 10, 10, 13, 0, tzinfo=timezone.utc)
        r = self.client.post(
            "/reports/work-sessions",
            json={"user_id": stranger.id, "started_at": start.isoformat(), "ended_at": (start + timedelta(hours=2)).isoformat()},
            headers=_bearer_headers(self.admin),
        )
        self.assertEqual(r.status_code, 404)
