"""Shift templates: defaults on first read, owner-only management, validation."""
from __future__ import annotations

from datetime import timedelta

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


class TestScheduleTemplates(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        tenant = models.Tenant(name="Shift templates test")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        self.owner = self._user(tenant.id, "tpl-owner@test.local", models.UserRole.owner)
        self.waiter = self._user(tenant.id, "tpl-waiter@test.local", models.UserRole.waiter)

    def _user(self, tenant_id: int, username: str, role: models.UserRole) -> models.User:
        user = models.User(
            username=username,
            hashed_password=security.get_password_hash("secret"),
            full_name=username,
            tenant_id=tenant_id,
            role=role,
        )
        self.session.add(user)
        self.session.commit()
        self.session.refresh(user)
        return user

    def test_defaults_created_on_first_read(self) -> None:
        r = self.client.get("/schedule/templates", headers=_bearer_headers(self.owner))
        self.assertEqual(r.status_code, 200, r.text)
        names = [t["name"] for t in r.json()]
        self.assertEqual(names, ["Apertura", "Cierre", "Partido"])
        partido = r.json()[2]
        self.assertEqual((partido["start_time2"], partido["end_time2"]), ("16:00", "20:00"))
        again = self.client.get("/schedule/templates", headers=_bearer_headers(self.waiter)).json()
        self.assertEqual(len(again), 3)

    def test_owner_manages_waiter_cannot(self) -> None:
        body = {"name": "Mañana", "start_time": "06:30", "end_time": "12:00"}
        self.assertEqual(self.client.post("/schedule/templates", json=body, headers=_bearer_headers(self.waiter)).status_code, 403)
        created = self.client.post("/schedule/templates", json=body, headers=_bearer_headers(self.owner))
        self.assertEqual(created.status_code, 200, created.text)
        tid = created.json()["id"]
        upd = self.client.put(
            f"/schedule/templates/{tid}",
            json={**body, "end_time": "13:00"},
            headers=_bearer_headers(self.owner),
        )
        self.assertEqual(upd.json()["end_time"], "13:00")
        self.assertEqual(self.client.delete(f"/schedule/templates/{tid}", headers=_bearer_headers(self.waiter)).status_code, 403)
        self.assertTrue(self.client.delete(f"/schedule/templates/{tid}", headers=_bearer_headers(self.owner)).json()["deleted"])

    def test_validation(self) -> None:
        h = _bearer_headers(self.owner)
        bad = [
            {"name": "", "start_time": "08:00", "end_time": "12:00"},
            {"name": "x", "start_time": "12:00", "end_time": "08:00"},
            {"name": "x", "start_time": "08:00", "end_time": "12:00", "start_time2": "11:00", "end_time2": "15:00"},
            {"name": "x", "start_time": "08:00", "end_time": "12:00", "start_time2": "14:00"},
            {"name": "x", "start_time": "8am", "end_time": "12:00"},
        ]
        for body in bad:
            self.assertEqual(self.client.post("/schedule/templates", json=body, headers=h).status_code, 400, body)
