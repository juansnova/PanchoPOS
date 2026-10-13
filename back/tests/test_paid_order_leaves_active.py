"""Paid + fully delivered orders become completed (GitHub #345)."""
from __future__ import annotations

import unittest
from datetime import timedelta

from pg_client_mixin import PgClientTestCase
from sqlmodel import select

from app import models, security
from app.security import get_password_hash


def _bearer_headers(user: models.User) -> dict[str, str]:
    data = {
        "sub": user.email,
        "tenant_id": user.tenant_id,
        "provider_id": getattr(user, "provider_id", None),
        "token_version": user.token_version,
    }
    token = security.create_access_token(data, expires_delta=timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


class TestPaidOrderLeavesActive(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        tenant = models.Tenant(name="Active Leave Test", tip_preset_percents=[10])
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)

        self.owner = models.User(
            email="active-leave-owner@test.local",
            hashed_password=get_password_hash("secret"),
            full_name="Owner O",
            tenant_id=tenant.id,
            role=models.UserRole.owner,
        )
        self.session.add(self.owner)
        self.session.commit()
        self.session.refresh(self.owner)

        floor = models.Floor(name="Main", tenant_id=tenant.id)
        self.session.add(floor)
        self.session.commit()
        self.session.refresh(floor)

        table = models.Table(
            name="T1",
            tenant_id=tenant.id,
            floor_id=floor.id,
            is_active=True,
        )
        self.session.add(table)
        self.session.commit()
        self.session.refresh(table)
        self.table = table

        product = models.Product(
            name="Soup",
            price_cents=500,
            tenant_id=tenant.id,
        )
        self.session.add(product)
        self.session.commit()
        self.session.refresh(product)
        self.product = product

    def _order_with_item(self, *, item_status: models.OrderItemStatus) -> models.Order:
        order = models.Order(
            table_id=self.table.id,
            tenant_id=self.owner.tenant_id,
            status=models.OrderStatus.preparing,
        )
        self.session.add(order)
        self.session.commit()
        self.session.refresh(order)
        item = models.OrderItem(
            order_id=order.id,
            product_id=self.product.id,
            product_name=self.product.name,
            quantity=1,
            price_cents=self.product.price_cents,
            status=item_status,
        )
        self.session.add(item)
        self.session.commit()
        self.session.refresh(order)
        return order

    def test_finish_sets_completed_when_all_delivered(self) -> None:
        order = self._order_with_item(item_status=models.OrderItemStatus.preparing)
        h = _bearer_headers(self.owner)
        r = self.client.put(
            f"/orders/{order.id}/finish",
            json={"payment_method": "cash", "tip_percent": None},
            headers=h,
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json().get("status"), "paid")

        self.session.refresh(order)
        self.assertEqual(order.status, models.OrderStatus.completed)
        self.assertIsNotNone(order.paid_at)

        item = self.session.exec(
            select(models.OrderItem).where(models.OrderItem.order_id == order.id)
        ).first()
        assert item is not None
        self.assertEqual(item.status, models.OrderItemStatus.delivered)

    def test_mark_paid_all_delivered_becomes_completed(self) -> None:
        order = self._order_with_item(item_status=models.OrderItemStatus.delivered)
        order.status = models.OrderStatus.completed
        self.session.add(order)
        self.session.commit()

        h = _bearer_headers(self.owner)
        r = self.client.put(
            f"/orders/{order.id}/mark-paid",
            json={"payment_method": "cash", "tip_percent": None},
            headers=h,
        )
        self.assertEqual(r.status_code, 200, r.text)

        self.session.refresh(order)
        self.assertEqual(order.status, models.OrderStatus.completed)
        self.assertIsNotNone(order.paid_at)

    def test_prepay_then_deliver_advances_to_completed(self) -> None:
        order = self._order_with_item(item_status=models.OrderItemStatus.preparing)
        h = _bearer_headers(self.owner)
        r = self.client.put(
            f"/orders/{order.id}/mark-paid",
            json={"payment_method": "cash", "tip_percent": None},
            headers=h,
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.session.refresh(order)
        self.assertEqual(order.status, models.OrderStatus.paid)

        item = self.session.exec(
            select(models.OrderItem).where(models.OrderItem.order_id == order.id)
        ).first()
        assert item is not None
        r2 = self.client.put(
            f"/orders/{order.id}/items/{item.id}/status",
            json={"status": "delivered"},
            headers=h,
        )
        self.assertEqual(r2.status_code, 200, r2.text)
        self.assertEqual(r2.json().get("order_status"), "completed")

        self.session.refresh(order)
        self.assertEqual(order.status, models.OrderStatus.completed)
        self.assertIsNotNone(order.paid_at)


if __name__ == "__main__":
    unittest.main()
