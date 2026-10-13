"""Floor seating_zone vs reservation seating_preference (issue #139)."""

import os
import sys
import unittest

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

_back = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _back not in sys.path:
    sys.path.insert(0, _back)

from app import models  # noqa: E402
from app.main import (  # noqa: E402
    _bookable_floors_for_public,
    _bookable_floors_matching_seating,
    _floor_matches_seating_preference,
)


class TestReservationFloorSeatingZone(unittest.TestCase):
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
            ],
        )
        self.session = Session(self.engine)

        self.tenant = models.Tenant(
            name="Seating Zone Test",
            timezone="UTC",
            reservation_average_table_turn_minutes=None,
            reservation_walk_in_tables_reserved=0,
        )
        self.session.add(self.tenant)
        self.session.commit()
        self.session.refresh(self.tenant)

        self.floor_in = models.Floor(
            name="Inside",
            tenant_id=self.tenant.id,
            sort_order=0,
            is_active=True,
            seating_zone="indoor",
        )
        self.floor_out = models.Floor(
            name="Terrace",
            tenant_id=self.tenant.id,
            sort_order=1,
            is_active=True,
            seating_zone="outdoor",
        )
        self.session.add(self.floor_in)
        self.session.add(self.floor_out)
        self.session.commit()
        self.session.refresh(self.floor_in)
        self.session.refresh(self.floor_out)

        for name, fid in [("T1", self.floor_in.id), ("T2", self.floor_out.id)]:
            self.session.add(
                models.Table(name=name, tenant_id=self.tenant.id, seat_count=4, floor_id=fid)
            )
        self.session.commit()

    def tearDown(self):
        self.session.close()

    def test_floor_matches_seating_preference(self):
        self.assertTrue(_floor_matches_seating_preference(self.floor_in, "indoor"))
        self.assertFalse(_floor_matches_seating_preference(self.floor_in, "terrace"))
        self.assertTrue(_floor_matches_seating_preference(self.floor_in, "no_preference"))
        self.assertTrue(_floor_matches_seating_preference(self.floor_out, "terrace"))
        self.assertFalse(_floor_matches_seating_preference(self.floor_out, "indoor"))

    def test_bookable_matching_filters_by_preference(self):
        all_b = _bookable_floors_for_public(self.session, self.tenant.id)
        self.assertEqual(len(all_b), 2)

        m_indoor = _bookable_floors_matching_seating(self.session, self.tenant.id, "indoor")
        self.assertEqual({f.name for f in m_indoor}, {"Inside"})

        m_terrace = _bookable_floors_matching_seating(self.session, self.tenant.id, "terrace")
        self.assertEqual({f.name for f in m_terrace}, {"Terrace"})

        m_any = _bookable_floors_matching_seating(self.session, self.tenant.id, "no_preference")
        self.assertEqual(len(m_any), 2)


if __name__ == "__main__":
    unittest.main()
