"""Inventory is deducted when a dish is delivered, never when the order is placed."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from pg_client_mixin import PgClientTestCase
from sqlmodel import select

from app import models, security
from app.inventory_models import InventoryItem, ProductRecipe, UnitOfMeasure
from app.inventory_service import reconcile_undelivered_deductions


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
        self.owner = models.User(
            username=f"inv-owner-{uuid4().hex[:8]}@amvara.de",
            hashed_password=security.get_password_hash("x"),
            full_name="Owner",
            tenant_id=self.tenant.id,
            role=models.UserRole.owner,
        )
        self.session.add_all([self.table, self.burger, self.soda, self.meat, self.owner])
        self.session.commit()
        for obj in (self.table, self.burger, self.soda, self.meat, self.owner):
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
        token = security.create_access_token(
            {
                "sub": self.owner.username,
                "tenant_id": self.owner.tenant_id,
                "provider_id": None,
                "token_version": self.owner.token_version,
            },
            expires_delta=timedelta(minutes=30),
        )
        self.h = {"Authorization": f"Bearer {token}"}

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

    def _deliver(self, order_id: int, status: str = "delivered"):
        self.session.expire_all()
        items = self.session.exec(
            select(models.OrderItem).where(models.OrderItem.order_id == order_id)
        ).all()
        for row in items:
            r = self.client.put(
                f"/orders/{order_id}/items/{row.id}/status",
                json={"status": status},
                headers=self.h,
            )
            self.assertEqual(r.status_code, 200, r.text)

    def test_placing_an_order_does_not_deduct(self) -> None:
        r = self._order(self.burger.id, qty=2)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self._stock(), Decimal("1000"))

    def test_delivering_deducts_once(self) -> None:
        order_id = self._order(self.burger.id, qty=2).json()["order_id"]
        self._deliver(order_id)
        self.assertEqual(self._stock(), Decimal("600"))
        # Marking it again must not deduct twice
        self._deliver(order_id)
        self.assertEqual(self._stock(), Decimal("600"))

    def test_later_orders_do_not_rededuct_earlier_lines(self) -> None:
        o1 = self._order(self.burger.id).json()["order_id"]
        self._deliver(o1)
        self.assertEqual(self._stock(), Decimal("800"))
        self.assertEqual(self._order(self.soda.id).status_code, 200)
        self.assertEqual(self._stock(), Decimal("800"))
        o2 = self._order(self.burger.id).json()["order_id"]
        self.assertEqual(self._stock(), Decimal("800"))
        self._deliver(o2)
        self.assertEqual(self._stock(), Decimal("600"))

    def test_cancelling_an_undelivered_order_never_touches_stock(self) -> None:
        r1 = self._order(self.burger.id, qty=2)
        self.assertEqual(r1.status_code, 200, r1.text)
        order_id = r1.json()["order_id"]
        r = self.client.delete(f"/menu/{self.table.token}/order/{order_id}")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self._stock(), Decimal("1000"))

    def test_old_upfront_deductions_are_returned_once(self) -> None:
        """Orders placed under the previous rule (deducted at order time) get their stock back."""
        order_id = self._order(self.burger.id, qty=2).json()["order_id"]
        # Simulate the old behaviour: stock already deducted for a pending line
        self.session.expire_all()
        row = self.session.exec(
            select(models.OrderItem).where(models.OrderItem.order_id == order_id)
        ).first()
        row.inventory_deducted_qty = 2
        self.session.add(row)
        meat = self.session.get(InventoryItem, self.meat.id)
        meat.current_quantity = Decimal("600")
        self.session.add(meat)
        self.session.commit()

        self.assertEqual(reconcile_undelivered_deductions(self.session), 1)
        self.assertEqual(self._stock(), Decimal("1000"))
        self.assertEqual(reconcile_undelivered_deductions(self.session), 0)
        self.assertEqual(self._stock(), Decimal("1000"))

    def test_finishing_the_order_delivers_and_deducts(self) -> None:
        order_id = self._order(self.burger.id, qty=1).json()["order_id"]
        self.assertEqual(self._stock(), Decimal("1000"))
        r = self.client.put(
            f"/orders/{order_id}/finish",
            json={"payment_method": "cash"},
            headers=self.h,
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self._stock(), Decimal("800"))
