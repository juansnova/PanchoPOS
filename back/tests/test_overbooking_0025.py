"""
0025 overbooking: one-empty-table and full-slot scenarios (pytest, seed-independent).

Creates its own tenant, floor, and 10 tables (5×4 + 5×2 = 30 seats). Does not use
tenant 1 or seed_demo_tables. Ops checker `python -m app.seeds.check_overbooking_0025`
stays the seed-aware path for demo tenant 1.

Run: docker compose exec back python3 -m pytest tests/test_overbooking_0025.py -q
"""

from __future__ import annotations

from datetime import date, time, timedelta
from uuid import uuid4

from pg_client_mixin import PgClientTestCase

from app import models, security
from app.seeds.check_overbooking_0025 import (
    _run_assertions,
    _run_assertions_full_slot,
    capacity_for_tenant,
    demand_for_slot,
)

SLOT_EMPTY = time(20, 0)
SLOT_FULL = time(21, 0)
TEST_CUSTOMER = "test-0025-overbooking-isolated"


def _bearer_headers(user: models.User) -> dict[str, str]:
    data = {
        "sub": user.email,
        "tenant_id": user.tenant_id,
        "provider_id": getattr(user, "provider_id", None),
        "token_version": user.token_version,
    }
    token = security.create_access_token(data, expires_delta=timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


class TestOverbooking0025(PgClientTestCase):
    """Scenario 1: N-1 parties → tables_left=1; 10th allowed, 11th over.
    Scenario 2: N parties → tables_left=0; next would be over."""

    def setUp(self) -> None:
        super().setUp()
        suffix = uuid4().hex[:8]
        self.tenant = models.Tenant(
            name=f"Overbooking 0025 {suffix}",
            timezone="UTC",
            opening_hours='{"monday":{"open":"09:00","close":"23:00","closed":false},'
            '"tuesday":{"open":"09:00","close":"23:00","closed":false},'
            '"wednesday":{"open":"09:00","close":"23:00","closed":false},'
            '"thursday":{"open":"09:00","close":"23:00","closed":false},'
            '"friday":{"open":"09:00","close":"23:00","closed":false},'
            '"saturday":{"open":"09:00","close":"23:00","closed":false},'
            '"sunday":{"open":"09:00","close":"23:00","closed":false}}',
        )
        self.session.add(self.tenant)
        self.session.commit()
        self.session.refresh(self.tenant)

        owner = models.User(
            email=f"overbooking-0025-{suffix}@amvara.de",
            hashed_password=security.get_password_hash("x"),
            full_name="Owner",
            role=models.UserRole.owner,
            tenant_id=self.tenant.id,
        )
        self.session.add(owner)
        floor = models.Floor(tenant_id=self.tenant.id, name="Main", sort_order=0)
        self.session.add(floor)
        self.session.commit()
        self.session.refresh(owner)
        self.session.refresh(floor)
        self.owner = owner

        tables: list[models.Table] = []
        for i in range(1, 11):
            seat_count = 4 if i <= 5 else 2
            t = models.Table(
                tenant_id=self.tenant.id,
                floor_id=floor.id,
                name=f"T{i:02d}",
                token=f"tok-0025-{suffix}-{i}",
                x_position=float(i),
                y_position=0,
                rotation=0,
                shape="rect",
                width=1,
                height=1,
                seat_count=seat_count,
                is_active=True,
            )
            self.session.add(t)
            tables.append(t)
        self.session.commit()
        for t in tables:
            self.session.refresh(t)
        self.tables = tables
        self.slot_date = date.today() + timedelta(days=1)

    def _add_seated(self, n: int, slot_time: time) -> None:
        for i, table in enumerate(self.tables[:n]):
            r = models.Reservation(
                tenant_id=self.tenant.id,
                customer_name=TEST_CUSTOMER,
                customer_phone="+49000000000",
                customer_email=None,
                reservation_date=self.slot_date,
                reservation_time=slot_time,
                party_size=2,
                status=models.ReservationStatus.seated,
                table_id=table.id,
                token=f"tok-res-0025-{uuid4().hex}",
            )
            self.session.add(r)
        self.session.commit()

    def test_one_empty_table_and_full_slot(self) -> None:
        tenant_id = self.tenant.id
        assert tenant_id is not None

        total_seats, total_tables = capacity_for_tenant(self.session, tenant_id)
        self.assertEqual(total_tables, 10)
        self.assertEqual(total_seats, 30)

        self._add_seated(total_tables - 1, SLOT_EMPTY)
        reserved_guests, reserved_parties = demand_for_slot(
            self.session, tenant_id, self.slot_date, SLOT_EMPTY
        )
        errors = _run_assertions(
            self.slot_date,
            SLOT_EMPTY,
            total_seats,
            total_tables,
            reserved_guests,
            reserved_parties,
        )
        self.assertIsNone(errors, errors)

        self._add_seated(total_tables, SLOT_FULL)
        rg2, rp2 = demand_for_slot(self.session, tenant_id, self.slot_date, SLOT_FULL)
        err2 = _run_assertions_full_slot(
            self.slot_date, SLOT_FULL, total_seats, total_tables, rg2, rp2
        )
        self.assertIsNone(err2, err2)

        # Live API: 10th party on the one-empty-table slot is allowed; 11th is 400.
        h = _bearer_headers(self.owner)
        date_str = self.slot_date.isoformat()
        cap = self.client.get(
            "/reservations/slot-capacity",
            headers=h,
            params={"date_str": date_str, "time_str": "20:00"},
        )
        self.assertEqual(cap.status_code, 200, cap.text)
        body = cap.json()
        self.assertEqual(body["total_tables"], 10)
        self.assertEqual(body["total_seats"], 30)
        self.assertEqual(body["reserved_parties"], 9)
        self.assertEqual(body["tables_left"], 1)

        tenth = self.client.post(
            "/reservations",
            headers=h,
            json={
                "customer_name": "Tenth party",
                "customer_phone": "+34600000010",
                "reservation_date": date_str,
                "reservation_time": "20:00",
                "party_size": 2,
            },
        )
        self.assertEqual(tenth.status_code, 200, tenth.text)

        eleventh = self.client.post(
            "/reservations",
            headers=h,
            json={
                "customer_name": "Eleventh party",
                "customer_phone": "+34600000011",
                "reservation_date": date_str,
                "reservation_time": "20:00",
                "party_size": 2,
            },
        )
        self.assertEqual(eleventh.status_code, 400, eleventh.text)
        self.assertIn("over capacity", eleventh.text.lower())
