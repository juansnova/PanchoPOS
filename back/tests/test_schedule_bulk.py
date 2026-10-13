"""POST /schedule/bulk — apply same shift pattern across a calendar month."""
from __future__ import annotations

import unittest
from datetime import date, timedelta

from pg_client_mixin import PgClientTestCase

from app import models, security


def _bearer_headers(user: models.User) -> dict[str, str]:
    data = {
        "sub": user.email,
        "tenant_id": user.tenant_id,
        "provider_id": getattr(user, "provider_id", None),
        "token_version": user.token_version,
    }
    token = security.create_access_token(data, expires_delta=timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


class TestScheduleBulk(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        tenant = models.Tenant(name="Schedule bulk test")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        self.tenant_id = tenant.id

        self.waiter = models.User(
            email="sb-waiter@test.local",
            hashed_password=security.get_password_hash("secret"),
            full_name="Bulk Waiter",
            tenant_id=self.tenant_id,
            role=models.UserRole.waiter,
        )
        self.session.add(self.waiter)
        self.session.commit()
        self.session.refresh(self.waiter)

        self.admin = models.User(
            email="sb-admin@test.local",
            hashed_password=security.get_password_hash("secret"),
            full_name="Bulk Admin",
            tenant_id=self.tenant_id,
            role=models.UserRole.owner,
        )
        self.session.add(self.admin)
        self.session.commit()
        self.session.refresh(self.admin)

    def test_bulk_weekdays_creates_expected_rows(self) -> None:
        """March 2025: Mon–Fri only → 21 weekdays with shifts."""
        h = _bearer_headers(self.admin)
        body = {
            "user_id": self.waiter.id,
            "year": 2025,
            "month": 3,
            "weekdays": [1, 2, 3, 4, 5],
            "start_time": "10:00",
            "end_time": "18:00",
            "label": "Day",
            "skip_days_with_existing_shift": True,
        }
        r = self.client.post("/schedule/bulk", json=body, headers=h)
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertEqual(data["created_count"], 21)
        self.assertEqual(data["skipped_existing_count"], 0)

        listed = self.client.get(
            "/schedule",
            params={"from_date": "2025-03-01", "to_date": "2025-03-31"},
            headers=h,
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        rows = listed.json()
        self.assertEqual(len(rows), 21)
        for row in rows:
            self.assertEqual(row["user_id"], self.waiter.id)
            self.assertEqual(row["start_time"], "10:00")
            self.assertEqual(row["end_time"], "18:00")
            self.assertEqual(row["label"], "Day")

    def test_bulk_skip_existing(self) -> None:
        h = _bearer_headers(self.admin)
        body = {
            "user_id": self.waiter.id,
            "year": 2025,
            "month": 4,
            "weekdays": [1, 2, 3, 4, 5, 6, 0],
            "start_time": "09:00",
            "end_time": "12:00",
            "skip_days_with_existing_shift": True,
        }
        r1 = self.client.post("/schedule/bulk", json=body, headers=h)
        self.assertEqual(r1.status_code, 200, r1.text)
        c1 = r1.json()["created_count"]
        self.assertGreater(c1, 0)

        r2 = self.client.post("/schedule/bulk", json=body, headers=h)
        self.assertEqual(r2.status_code, 200, r2.text)
        data = r2.json()
        self.assertEqual(data["created_count"], 0)
        self.assertEqual(data["skipped_existing_count"], c1)

    def test_bulk_user_other_tenant(self) -> None:
        other = models.Tenant(name="Other bulk")
        self.session.add(other)
        self.session.commit()
        self.session.refresh(other)
        outsider = models.User(
            email="sb-out@test.local",
            hashed_password=security.get_password_hash("x"),
            tenant_id=other.id,
            role=models.UserRole.waiter,
        )
        self.session.add(outsider)
        self.session.commit()
        self.session.refresh(outsider)

        h = _bearer_headers(self.admin)
        r = self.client.post(
            "/schedule/bulk",
            json={
                "user_id": outsider.id,
                "year": 2025,
                "month": 5,
                "weekdays": [1],
                "start_time": "09:00",
                "end_time": "17:00",
            },
            headers=h,
        )
        self.assertEqual(r.status_code, 400, r.text)


if __name__ == "__main__":
    unittest.main()
