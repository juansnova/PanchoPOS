"""Double tap on "Place order" must not add the items twice (request_id dedupe)."""

from __future__ import annotations

from uuid import uuid4

from sqlmodel import select

from pg_client_mixin import PgClientTestCase

from app import models
from app.main import get_redis


class TestMenuOrderDedupe(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        if get_redis() is None:
            self.skipTest("Redis not available")
        self.tenant = models.Tenant(name="Dedupe Cafe")
        self.session.add(self.tenant)
        self.session.commit()
        self.session.refresh(self.tenant)
        floor = models.Floor(tenant_id=self.tenant.id, name="Main", sort_order=0)
        self.session.add(floor)
        self.session.commit()
        self.session.refresh(floor)
        self.table = models.Table(tenant_id=self.tenant.id, floor_id=floor.id, name="T1", is_active=True, order_code="1234")
        self.product = models.Product(tenant_id=self.tenant.id, name="Coffee", price_cents=250)
        self.session.add_all([self.table, self.product])
        self.session.commit()
        self.session.refresh(self.table)
        self.session.refresh(self.product)

    def _post(self, request_id: str | None):
        payload = {
            "items": [{"product_id": self.product.id, "quantity": 1}],
            "session_id": "dedupe-guest-1",
            "table_code": "1234",
        }
        if request_id:
            payload["request_id"] = request_id
        return self.client.post(f"/menu/{self.table.token}/order", json=payload)

    def _ordered_quantity(self) -> int:
        self.session.expire_all()
        orders = self.session.exec(select(models.Order).where(models.Order.table_id == self.table.id)).all()
        items = [
            i
            for o in orders
            for i in self.session.exec(select(models.OrderItem).where(models.OrderItem.order_id == o.id)).all()
        ]
        return sum(i.quantity for i in items)

    def test_same_request_id_is_applied_once(self) -> None:
        rid = str(uuid4())
        r1 = self._post(rid)
        r2 = self._post(rid)
        self.assertEqual(r1.status_code, 200, r1.text)
        self.assertEqual(r2.status_code, 200, r2.text)
        self.assertEqual(r1.json()["order_id"], r2.json()["order_id"])
        self.assertEqual(self._ordered_quantity(), 1)

    def test_different_submits_both_count(self) -> None:
        self.assertEqual(self._post(str(uuid4())).status_code, 200)
        self.assertEqual(self._post(str(uuid4())).status_code, 200)
        self.assertEqual(self._ordered_quantity(), 2)

    def test_without_request_id_still_works(self) -> None:
        self.assertEqual(self._post(None).status_code, 200)
        self.assertEqual(self._ordered_quantity(), 1)
