"""Kitchen tickets print automatically when lines reach preparing; additions never repeat dishes."""

from __future__ import annotations

from datetime import datetime, timezone

from pg_client_mixin import PgClientTestCase
from sqlmodel import select

from app import models, print_service


class TestKitchenAutoPrint(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = models.Tenant(name="Auto Print Cafe")
        self.session.add(self.tenant)
        self.session.commit()
        self.session.refresh(self.tenant)
        self.product = models.Product(tenant_id=self.tenant.id, name="Burger", price_cents=1000)
        self.session.add(self.product)
        self.order = models.Order(tenant_id=self.tenant.id, status=models.OrderStatus.pending)
        self.session.add(self.order)
        self.session.commit()
        self.session.refresh(self.product)
        self.session.refresh(self.order)

    def _add_agent(self) -> None:
        self.session.add(
            models.PrintAgent(
                tenant_id=self.tenant.id, device_id="d1", token_hash="h" * 63 + "x"
            )
        )
        self.session.commit()

    def _item(self, name: str, status=models.OrderItemStatus.pending, **kw) -> models.OrderItem:
        item = models.OrderItem(
            order_id=self.order.id,
            product_id=self.product.id,
            product_name=name,
            quantity=2,
            price_cents=1000,
            status=status,
            **kw,
        )
        self.session.add(item)
        self.session.commit()
        self.session.refresh(item)
        return item

    def _jobs(self) -> list[models.PrintJob]:
        self.session.expire_all()
        return list(
            self.session.exec(
                select(models.PrintJob)
                .where(models.PrintJob.tenant_id == self.tenant.id)
                .order_by(models.PrintJob.id)
            ).all()
        )

    def test_no_agent_means_no_ticket(self) -> None:
        self._item("Taco", models.OrderItemStatus.preparing)
        self.assertEqual(print_service.enqueue_new_kitchen_tickets(self.session), 0)
        self.assertEqual(self._jobs(), [])

    def test_pending_lines_are_not_printed(self) -> None:
        self._add_agent()
        self._item("Taco")
        self.assertEqual(print_service.enqueue_new_kitchen_tickets(self.session), 0)

    def test_preparing_prints_once_then_additions_only_new_lines(self) -> None:
        self._add_agent()
        taco = self._item("Taco", models.OrderItemStatus.preparing)
        self.assertEqual(print_service.enqueue_new_kitchen_tickets(self.session), 1)
        # Nothing new: no second ticket.
        self.assertEqual(print_service.enqueue_new_kitchen_tickets(self.session), 0)

        self._item("Flan", models.OrderItemStatus.preparing)
        self.assertEqual(print_service.enqueue_new_kitchen_tickets(self.session), 1)

        first, second = self._jobs()
        self.assertEqual(first.printer_role, "kitchen")
        self.assertIn("Taco", first.payload["plain_text"])
        self.assertNotIn("ADICION", first.payload["plain_text"])
        self.assertIn("ADICION", second.payload["plain_text"])
        self.assertIn("Flan", second.payload["plain_text"])
        self.assertNotIn("Taco", second.payload["plain_text"])
        self.assertIsNotNone(self.session.get(models.OrderItem, taco.id).kitchen_printed_at)

    def test_already_printed_line_is_skipped(self) -> None:
        self._add_agent()
        self._item(
            "Taco",
            models.OrderItemStatus.preparing,
            kitchen_printed_at=datetime.now(timezone.utc),
        )
        self.assertEqual(print_service.enqueue_new_kitchen_tickets(self.session), 0)
