"""Inventory is deducted once per ordered unit and returned when the line is cancelled."""

from __future__ import annotations

from decimal import Decimal

from pg_client_mixin import PgClientTestCase

from app import models
from app.inventory_models import InventoryItem, ProductRecipe, UnitOfMeasure


class TestInventoryOrderSync(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = models.Tenant(name="Inventory Sync Cafe")
        self.session.add(self.tenant)
        self.session.commit()
        self.session.refresh(self.tenant)
        floor = models.Floor(tenant_id=self.tenant.id, name="Main", sort_order=0)
        self.session.add(floor)
        self.session.commit()
        self.session.refresh(floor)
        self.table = models.Table(
            tenant_id=self.tenant.id, floor_id=floor.id, name="T1", is_active=True, order_code="1234"
        )
        self.burger = models.Product(tenant_id=self.tenant.id, name="Burger", price_cents=900)
        self.soda = models.Product(tenant_id=self.tenant.id, name="Soda", price_cents=200)
        self.meat = InventoryItem(
            tenant_id=self.tenant.id,
            sku="MEAT-1",
            name="Beef",
            unit=UnitOfMeasure.gram,
            current_quantity=Decimal("1000"),
        )
        self.session.add_all([self.table, self.burger, self.soda, self.meat])
        self.session.commit()
        for obj in (self.table, self.burger, self.soda, self.meat):
            self.session.refresh(obj)
        self.session.add(
            ProductRecipe(
                tenant_id=self.tenant.id,
                product_id=self.burger.id,
                inventory_item_id=self.meat.id,
                quantity_required=Decimal("200"),
                unit=UnitOfMeasure.gram,
            )
        )
        self.session.commit()

    def _order(self, product_id: int, qty: int = 1):
        return self.client.post(
            f"/menu/{self.table.token}/order",
            json={
                "items": [{"product_id": product_id, "quantity": qty}],
                "session_id": "inv-sync-guest",
                "table_code": "1234",
            },
        )

    def _stock(self) -> Decimal:
        self.session.expire_all()
        return self.session.get(InventoryItem, self.meat.id).current_quantity

    def test_later_orders_do_not_rededuct_earlier_lines(self) -> None:
        r1 = self._order(self.burger.id)
        self.assertEqual(r1.status_code, 200, r1.text)
        self.assertEqual(self._stock(), Decimal("800"))
        self.assertEqual(self._order(self.soda.id).status_code, 200)
        self.assertEqual(self._order(self.soda.id).status_code, 200)
        self.assertEqual(self._stock(), Decimal("800"))
        self.assertEqual(self._order(self.burger.id).status_code, 200)
        self.assertEqual(self._stock(), Decimal("600"))

    def test_cancelling_order_returns_stock(self) -> None:
        r1 = self._order(self.burger.id, qty=2)
        self.assertEqual(r1.status_code, 200, r1.text)
        self.assertEqual(self._stock(), Decimal("600"))
        order_id = r1.json()["order_id"]
        r = self.client.delete(f"/menu/{self.table.token}/order/{order_id}")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self._stock(), Decimal("1000"))
