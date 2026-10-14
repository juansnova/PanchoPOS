"""Guest birthday capture on reservations (#324)."""

from __future__ import annotations

from datetime import date, time, timedelta

from pg_client_mixin import PgClientTestCase
from sqlmodel import select

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


class TestGuestBirthday(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = models.Tenant(
            name="Birthday Bistro",
            timezone="UTC",
            opening_hours='{"monday":{"open":"09:00","close":"23:00","closed":false},'
            '"tuesday":{"open":"09:00","close":"23:00","closed":false},'
            '"wednesday":{"open":"09:00","close":"23:00","closed":false},'
            '"thursday":{"open":"09:00","close":"23:00","closed":false},'
            '"friday":{"open":"09:00","close":"23:00","closed":false},'
            '"saturday":{"open":"09:00","close":"23:00","closed":false},'
            '"sunday":{"open":"09:00","close":"23:00","closed":false}}',
        )
        self.other = models.Tenant(name="Other Cafe")
        self.session.add(self.tenant)
        self.session.add(self.other)
        self.session.commit()
        self.session.refresh(self.tenant)
        self.session.refresh(self.other)

        pwd = security.get_password_hash("x")
        self.admin = models.User(
            username="bday-admin@amvara.de",
            hashed_password=pwd,
            full_name="Admin",
            role=models.UserRole.owner,
            tenant_id=self.tenant.id,
        )
        self.other_admin = models.User(
            username="bday-other@amvara.de",
            hashed_password=pwd,
            full_name="Other",
            role=models.UserRole.owner,
            tenant_id=self.other.id,
        )
        self.session.add(self.admin)
        self.session.add(self.other_admin)
        floor = models.Floor(tenant_id=self.tenant.id, name="Main", sort_order=0)
        self.session.add(floor)
        self.session.commit()
        self.session.refresh(self.admin)
        self.session.refresh(self.other_admin)
        self.session.refresh(floor)
        self.table = models.Table(
            tenant_id=self.tenant.id,
            floor_id=floor.id,
            name="T1",
            token="bday-t1-token",
            x_position=0,
            y_position=0,
            rotation=0,
            shape="rect",
            width=1,
            height=1,
            seat_count=8,
            is_active=True,
        )
        self.session.add(self.table)
        self.session.commit()
        self.session.refresh(self.table)

    def _future_date(self) -> str:
        return (date.today() + timedelta(days=7)).isoformat()

    def test_public_tenant_exposes_birthday_settings_defaults(self):
        r = self.client.get(f"/public/tenants/{self.tenant.id}")
        self.assertEqual(r.status_code, 200, r.text)
        d = r.json()
        self.assertTrue(d.get("guest_birthday_capture_enabled"))
        self.assertFalse(d.get("guest_birthday_marketing_enabled"))
        self.assertIsNone(d.get("guest_birthday_consent_text"))

    def test_staff_settings_update_birthday_flags(self):
        h = _bearer_headers(self.admin)
        r = self.client.put(
            "/tenant/settings",
            headers=h,
            json={
                "guest_birthday_capture_enabled": True,
                "guest_birthday_marketing_enabled": True,
                "guest_birthday_consent_text": "We may email birthday offers.",
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        d = r.json()
        self.assertTrue(d.get("guest_birthday_marketing_enabled"))
        self.assertEqual(d.get("guest_birthday_consent_text"), "We may email birthday offers.")

        pub = self.client.get(f"/public/tenants/{self.tenant.id}")
        self.assertEqual(pub.status_code, 200)
        self.assertTrue(pub.json().get("guest_birthday_marketing_enabled"))
        self.assertEqual(pub.json().get("guest_birthday_consent_text"), "We may email birthday offers.")

    def test_staff_create_and_list_birthday(self):
        h = _bearer_headers(self.admin)
        body = {
            "customer_name": "Ana",
            "customer_phone": "+34612345670",
            "reservation_date": self._future_date(),
            "reservation_time": "19:00",
            "party_size": 2,
            "guest_birthday_month": 3,
            "guest_birthday_day": 15,
        }
        r = self.client.post("/reservations", headers=h, json=body)
        self.assertEqual(r.status_code, 200, r.text)
        created = r.json()
        self.assertEqual(created.get("guest_birthday_month"), 3)
        self.assertEqual(created.get("guest_birthday_day"), 15)
        self.assertFalse(created.get("guest_birthday_marketing_consent"))

        listed = self.client.get("/reservations", headers=h)
        self.assertEqual(listed.status_code, 200)
        match = next(x for x in listed.json() if x["id"] == created["id"])
        self.assertEqual(match["guest_birthday_month"], 3)
        self.assertEqual(match["guest_birthday_day"], 15)

    def test_public_create_birthday_and_consent_only_when_marketing_on(self):
        self.tenant.guest_birthday_marketing_enabled = True
        self.session.add(self.tenant)
        self.session.commit()

        body = {
            "tenant_id": self.tenant.id,
            "customer_name": "Guest",
            "customer_phone": "+34612345671",
            "reservation_date": self._future_date(),
            "reservation_time": "20:00",
            "party_size": 2,
            "guest_birthday_month": 12,
            "guest_birthday_day": 31,
            "guest_birthday_marketing_consent": True,
        }
        r = self.client.post("/reservations", json=body)
        self.assertEqual(r.status_code, 200, r.text)
        d = r.json()
        self.assertEqual(d.get("guest_birthday_month"), 12)
        self.assertEqual(d.get("guest_birthday_day"), 31)
        self.assertTrue(d.get("guest_birthday_marketing_consent"))

        # Marketing off → consent forced false
        self.tenant.guest_birthday_marketing_enabled = False
        self.session.add(self.tenant)
        self.session.commit()
        body2 = {
            **body,
            "customer_phone": "+34612345672",
            "guest_birthday_month": 1,
            "guest_birthday_day": 1,
            "guest_birthday_marketing_consent": True,
            "reservation_time": "20:15",
        }
        r2 = self.client.post("/reservations", json=body2)
        self.assertEqual(r2.status_code, 200, r2.text)
        self.assertFalse(r2.json().get("guest_birthday_marketing_consent"))

    def test_public_ignores_birthday_when_capture_disabled(self):
        self.tenant.guest_birthday_capture_enabled = False
        self.session.add(self.tenant)
        self.session.commit()
        body = {
            "tenant_id": self.tenant.id,
            "customer_name": "NoBday",
            "customer_phone": "+34612345673",
            "reservation_date": self._future_date(),
            "reservation_time": "18:00",
            "party_size": 2,
            "guest_birthday_month": 6,
            "guest_birthday_day": 1,
        }
        r = self.client.post("/reservations", json=body)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIsNone(r.json().get("guest_birthday_month"))
        self.assertIsNone(r.json().get("guest_birthday_day"))

    def test_invalid_birthday_rejected(self):
        h = _bearer_headers(self.admin)
        body = {
            "customer_name": "Bad",
            "customer_phone": "+34612345674",
            "reservation_date": self._future_date(),
            "reservation_time": "19:30",
            "party_size": 2,
            "guest_birthday_month": 2,
            "guest_birthday_day": 30,
        }
        r = self.client.post("/reservations", headers=h, json=body)
        self.assertEqual(r.status_code, 400, r.text)

    def test_tenant_isolation_on_list(self):
        h = _bearer_headers(self.admin)
        oh = _bearer_headers(self.other_admin)
        body = {
            "customer_name": "Mine",
            "customer_phone": "+34612345675",
            "reservation_date": self._future_date(),
            "reservation_time": "19:00",
            "party_size": 2,
            "guest_birthday_month": 5,
            "guest_birthday_day": 5,
        }
        r = self.client.post("/reservations", headers=h, json=body)
        self.assertEqual(r.status_code, 200, r.text)
        rid = r.json()["id"]

        other_list = self.client.get("/reservations", headers=oh)
        self.assertEqual(other_list.status_code, 200)
        self.assertFalse(any(x["id"] == rid for x in other_list.json()))

        # Direct get by id as other tenant → 404
        other_get = self.client.get(f"/reservations/{rid}", headers=oh)
        self.assertEqual(other_get.status_code, 404)

    def test_staff_update_clears_birthday(self):
        h = _bearer_headers(self.admin)
        create = self.client.post(
            "/reservations",
            headers=h,
            json={
                "customer_name": "ClearMe",
                "customer_phone": "+34612345676",
                "reservation_date": self._future_date(),
                "reservation_time": "17:00",
                "party_size": 2,
                "guest_birthday_month": 7,
                "guest_birthday_day": 4,
            },
        )
        self.assertEqual(create.status_code, 200, create.text)
        rid = create.json()["id"]
        upd = self.client.put(
            f"/reservations/{rid}",
            headers=h,
            json={"guest_birthday_month": None, "guest_birthday_day": None},
        )
        self.assertEqual(upd.status_code, 200, upd.text)
        self.assertIsNone(upd.json().get("guest_birthday_month"))
        self.assertIsNone(upd.json().get("guest_birthday_day"))
