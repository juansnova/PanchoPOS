"""New order lines move from pending to preparing automatically after one minute."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from pg_client_mixin import PgClientTestCase

from app import models
from app.order_auto_preparing import advance_due_items


class TestOrderAutoPreparing(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = models.Tenant(name="Auto Preparing Cafe")
        self.session.add(self.tenant)
        self.session.commit()
        self.session.refresh(self.tenant)
        self.product = models.Product(tenant_id=self.tenant.id, name="Burger", price_cents=1000)
        self.session.add(self.product)
        self.session.commit()
        self.session.refresh(self.product)
        self.now = datetime.now(timezone.utc)

    def _order_with_item(self, *, age_seconds: int, **item_kw) -> tuple[models.Order, models.OrderItem]:
        order_kw = {k: item_kw.pop(k) for k in ("paid_at", "order_status") if k in item_kw}
        order = models.Order(
            tenant_id=self.tenant.id,
            status=order_kw.get("order_status", models.OrderStatus.pending),
            paid_at=order_kw.get("paid_at"),
        )
        self.session.add(order)
        self.session.commit()
        self.session.refresh(order)
        item = models.OrderItem(
            order_id=order.id,
            product_id=self.product.id,
            product_name=self.product.name,
            quantity=1,
            price_cents=1000,
            created_at=self.now - timedelta(seconds=age_seconds),
            **item_kw,
        )
        self.session.add(item)
        self.session.commit()
        self.session.refresh(item)
        return order, item

    def _reload(self, obj):
        self.session.expire_all()
        return self.session.get(type(obj), obj.id)

    def test_pending_line_older_than_a_minute_becomes_preparing(self) -> None:
        order, item = self._order_with_item(age_seconds=90)
        # The live background worker may advance it first; either way the end state must match.
        advance_due_items(self.session, now=self.now)
        self.assertEqual(self._reload(item).status, models.OrderItemStatus.preparing)
        self.assertEqual(self._reload(order).status, models.OrderStatus.preparing)

    def test_recent_line_waits(self) -> None:
        _, item = self._order_with_item(age_seconds=20)
        advance_due_items(self.session, now=self.now)
        self.assertEqual(self._reload(item).status, models.OrderItemStatus.pending)

    def test_staff_reset_to_pending_is_respected(self) -> None:
        _, item = self._order_with_item(age_seconds=300, status_updated_at=self.now - timedelta(seconds=30))
        advance_due_items(self.session, now=self.now)
        self.assertEqual(self._reload(item).status, models.OrderItemStatus.pending)

    def test_paid_order_and_removed_line_untouched(self) -> None:
        _, paid_item = self._order_with_item(
            age_seconds=300, paid_at=self.now, order_status=models.OrderStatus.paid
        )
        _, removed_item = self._order_with_item(age_seconds=300, removed_by_customer=True)
        advance_due_items(self.session, now=self.now)
        self.assertEqual(self._reload(paid_item).status, models.OrderItemStatus.pending)
        self.assertEqual(self._reload(removed_item).status, models.OrderItemStatus.pending)

    def test_legacy_line_without_created_at_untouched(self) -> None:
        _, item = self._order_with_item(age_seconds=300)
        item = self._reload(item)
        item.created_at = None
        self.session.add(item)
        self.session.commit()
        advance_due_items(self.session, now=self.now)
        self.assertEqual(self._reload(item).status, models.OrderItemStatus.pending)
