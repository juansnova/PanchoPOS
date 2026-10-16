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

    def test_receipt_payload_has_business_billing_taxes_and_tip(self) -> None:
        self.tenant.address = "Calle 1 #2-3"
        self.tenant.tax_id = "900123"
        self.tenant.tip_tax_rate_percent = 8
        bc = models.BillingCustomer(tenant_id=self.tenant.id, name="Ana", company_name="Ana SAS", tax_id="NIT-9")
        self.session.add(bc)
        self.session.commit()
        self.session.refresh(bc)
        self.order.tip_amount_cents = 1080
        self.order.tip_percent_applied = 10
        self.session.add(self.order)
        self._item("Taco", tax_rate_percent=8, tax_amount_cents=148)

        payload = print_service._build_order_payload(
            self.session, self.order, "receipt", billing_customer_id=bc.id
        )
        self.assertEqual(payload["business"]["name"], "Auto Print Cafe")
        self.assertEqual(payload["business"]["tax_id"], "900123")
        self.assertEqual(payload["billing"]["name"], "Ana SAS")
        self.assertEqual(payload["subtotal_cents"], 2000)
        self.assertEqual(payload["total_cents"], 3080)
        self.assertEqual(payload["lines"][0]["line_total_cents"], 2000)
        # Line tax 148 + tip tax 1080*8/108 = 80
        self.assertEqual(payload["tax_summary"], [{"rate": 8, "cents": 228}])

    def test_beverages_go_to_the_bar_printer_as_a_separate_ticket(self) -> None:
        self._add_agent()
        drink = models.Product(
            tenant_id=self.tenant.id, name="Limonada", price_cents=500, category="Beverages"
        )
        self.session.add(drink)
        self.session.commit()
        self.session.refresh(drink)
        self._item("Taco", models.OrderItemStatus.preparing)
        self.session.add(
            models.OrderItem(
                order_id=self.order.id,
                product_id=drink.id,
                product_name="Limonada",
                quantity=1,
                price_cents=500,
                status=models.OrderItemStatus.preparing,
            )
        )
        self.session.commit()
        self.assertEqual(print_service.enqueue_new_kitchen_tickets(self.session), 2)
        by_role = {j.printer_role: j for j in self._jobs()}
        self.assertEqual(set(by_role), {"kitchen", "bar"})
        self.assertIn("Taco", by_role["kitchen"].payload["plain_text"])
        self.assertNotIn("Limonada", by_role["kitchen"].payload["plain_text"])
        self.assertEqual(by_role["bar"].payload["station_label"], "BARRA")
        self.assertIn("Limonada", by_role["bar"].payload["plain_text"])

        # A new drink is an ADICION for the bar only; a new dish would be for the kitchen.
        self.session.add(
            models.OrderItem(
                order_id=self.order.id,
                product_id=drink.id,
                product_name="Cerveza",
                quantity=1,
                price_cents=500,
                status=models.OrderItemStatus.preparing,
            )
        )
        self.session.commit()
        self.assertEqual(print_service.enqueue_new_kitchen_tickets(self.session), 1)
        newest = self._jobs()[-1]
        self.assertEqual(newest.printer_role, "bar")
        self.assertIn("ADICION", newest.payload["plain_text"])
