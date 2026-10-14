"""Public reservation book zones and floor-scoped capacity (GitHub #129)."""

import os
import sys
import unittest
from datetime import date, datetime, time, timezone

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

_back = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _back not in sys.path:
    sys.path.insert(0, _back)

from app import models  # noqa: E402
from app.main import (  # noqa: E402
    _bookable_floors_for_public,
    _demand_for_slot,
    _reservable_capacity_for_tenant,
)


class TestReservationBookZonesPublic(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(
            self.engine,
            tables=[
                models.Tenant.__table__,
                models.Floor.__table__,
                models.Table.__table__,
                models.Reservation.__table__,
                models.Order.__table__,
            ],
        )
        self.session = Session(self.engine)

        self.tenant = models.Tenant(
            name="Zone Test",
            timezone="UTC",
            reservation_average_table_turn_minutes=None,
            reservation_walk_in_tables_reserved=0,
        )
        self.session.add(self.tenant)
        self.session.commit()
        self.session.refresh(self.tenant)

        self.floor_a = models.Floor(name="Main", tenant_id=self.tenant.id, sort_order=0, is_active=True)
        self.floor_b = models.Floor(name="Terrace", tenant_id=self.tenant.id, sort_order=1, is_active=True)
        self.session.add(self.floor_a)
        self.session.add(self.floor_b)
        self.session.commit()
        self.session.refresh(self.floor_a)
        self.session.refresh(self.floor_b)

        for name, seats, fid in [
            ("T1", 4, self.floor_a.id),
            ("T2", 4, self.floor_a.id),
            ("T3", 2, self.floor_b.id),
        ]:
            self.session.add(
                models.Table(name=name, tenant_id=self.tenant.id, seat_count=seats, floor_id=fid)
            )
        self.session.commit()

    def tearDown(self):
        self.session.close()

    def test_bookable_floors_excludes_inactive_and_empty(self):
        floors = _bookable_floors_for_public(self.session, self.tenant.id)
        self.assertEqual({f.name for f in floors}, {"Main", "Terrace"})

        self.floor_b.is_active = False
        self.session.add(self.floor_b)
        self.session.commit()
        floors2 = _bookable_floors_for_public(self.session, self.tenant.id)
        self.assertEqual({f.name for f in floors2}, {"Main"})

    def test_zone_capacity_counts_only_floor_tables(self):
        d = date(2031, 7, 1)
        st = time(12, 0)
        seats_all, tables_all = _reservable_capacity_for_tenant(
            self.session, self.tenant.id, d, self.tenant, st, floor_id=None
        )
        self.assertEqual(tables_all, 3)
        self.assertEqual(seats_all, 10)

        seats_a, tables_a = _reservable_capacity_for_tenant(
            self.session, self.tenant.id, d, self.tenant, st, floor_id=self.floor_a.id
        )
        self.assertEqual(tables_a, 2)
        self.assertEqual(seats_a, 8)

        seats_b, tables_b = _reservable_capacity_for_tenant(
            self.session, self.tenant.id, d, self.tenant, st, floor_id=self.floor_b.id
        )
        self.assertEqual(tables_b, 1)
        self.assertEqual(seats_b, 2)

    def test_zone_demand_counts_preferred_floor_and_seated_table(self):
        d = date(2031, 7, 2)
        st = time(19, 0)
        tbl = self.session.exec(select(models.Table).where(models.Table.name == "T1")).first()
        r1 = models.Reservation(
            tenant_id=self.tenant.id,
            customer_name="a",
            customer_phone="+10000000001",
            reservation_date=d,
            reservation_time=st,
            party_size=2,
            status=models.ReservationStatus.booked,
            preferred_floor_id=self.floor_a.id,
        )
        r2 = models.Reservation(
            tenant_id=self.tenant.id,
            customer_name="b",
            customer_phone="+10000000002",
            reservation_date=d,
            reservation_time=st,
            party_size=2,
            status=models.ReservationStatus.booked,
            preferred_floor_id=None,
            table_id=tbl.id,
        )
        self.session.add(r1)
        self.session.add(r2)
        self.session.commit()

        g_guests, g_parties = _demand_for_slot(self.session, self.tenant.id, d, st, floor_id=None)
        self.assertEqual((g_guests, g_parties), (4, 2))

        a_guests, a_parties = _demand_for_slot(
            self.session, self.tenant.id, d, st, floor_id=self.floor_a.id
        )
        self.assertEqual((a_guests, a_parties), (4, 2))

        b_guests, b_parties = _demand_for_slot(
            self.session, self.tenant.id, d, st, floor_id=self.floor_b.id
        )
        self.assertEqual((b_guests, b_parties), (0, 0))


if __name__ == "__main__":
    unittest.main()
