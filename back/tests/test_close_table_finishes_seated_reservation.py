"""POST /tables/{id}/close finishes seated reservations so /tables/with-status matches tiles."""
from __future__ import annotations

import unittest
from datetime import date, time, timedelta
from uuid import uuid4

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


class TestCloseTableFinishesSeatedReservation(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        tenant = models.Tenant(name="CloseTable Tenant")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)

        owner = models.User(
            email=f"close-table-owner-{uuid4().hex[:8]}@amvara.de",
            hashed_password=security.get_password_hash("x"),
            full_name="Owner",
            tenant_id=tenant.id,
            role=models.UserRole.owner,
        )
        self.session.add(owner)
        self.session.commit()
        self.session.refresh(owner)
        self.owner = owner

        floor = models.Floor(name="Main", sort_order=0, tenant_id=tenant.id)
        self.session.add(floor)
        self.session.commit()
        self.session.refresh(floor)

        table = models.Table(
            name="T-close",
            token=f"tok-close-{uuid4().hex}",
            floor_id=floor.id,
            tenant_id=tenant.id,
            x_position=0,
            y_position=0,
            rotation=0,
            shape="rectangle",
            width=1,
            height=1,
            seat_count=4,
            is_active=True,
        )
        self.session.add(table)
        self.session.commit()
        self.session.refresh(table)
        self.table_id = table.id

        today = date.today()
        res = models.Reservation(
            tenant_id=tenant.id,
            customer_name="Party",
            customer_phone="+1000000000",
            reservation_date=today,
            reservation_time=time(12, 0),
            party_size=2,
            status=models.ReservationStatus.seated,
            table_id=table.id,
            token=f"tok-res-{uuid4().hex}",
        )
        self.session.add(res)
        self.session.commit()
        self.session.refresh(res)
        self.reservation_id = res.id

    def test_close_table_finishes_seated_reservation_and_clears_occupied_status(self) -> None:
        h = _bearer_headers(self.owner)

        r_close = self.client.post(f"/tables/{self.table_id}/close", headers=h)
        self.assertEqual(r_close.status_code, 200, r_close.text)

        self.session.expire_all()
        res_row = self.session.get(models.Reservation, self.reservation_id)
        self.assertIsNotNone(res_row)
        assert res_row is not None
        self.assertEqual(res_row.status, models.ReservationStatus.finished)
        self.assertIsNone(res_row.table_id)
        self.assertIsNone(res_row.seated_at)

        r_status = self.client.get("/tables/with-status", headers=h)
        self.assertEqual(r_status.status_code, 200, r_status.text)
        rows = r_status.json()
        row = next(x for x in rows if x["id"] == self.table_id)
        self.assertEqual(row["status"], "available")
        self.assertEqual(row["operational_status"], "available")


if __name__ == "__main__":
    unittest.main()
