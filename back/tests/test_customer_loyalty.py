"""Billing customers list exposes visits / spent / last visit (loyalty tiers are derived in the UI)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from pg_client_mixin import PgClientTestCase

from app import models, security


def _bearer_headers(user: models.User) -> dict[str, str]:
    data = {
        "sub": user.username,
        "tenant_id": user.tenant_id,
        "provider_id": getattr(user, "provider_id", None),
        "token_version": user.token_version,
    }
    token = security.create_access_token(data, expires_delta=timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


class TestCustomerLoyalty(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        tenant = models.Tenant(name="Loyalty test")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        self.tenant = tenant
        self.owner = models.User(
            username="loy-owner@test.local",
            hashed_password=security.get_password_hash("secret"),
            full_name="Owner",
            tenant_id=tenant.id,
            role=models.UserRole.owner,
        )
        self.session.add(self.owner)
        floor = models.Floor(name="Main", tenant_id=tenant.id)
        self.session.add(floor)
        self.session.commit()
        self.session.refresh(floor)
        self.table = models.Table(name="T1", tenant_id=tenant.id, floor_id=floor.id, is_active=True)
        self.product = models.Product(name="Coffee", price_cents=1000, tenant_id=tenant.id)
        self.regular = models.BillingCustomer(tenant_id=tenant.id, name="Ana")
        self.fresh = models.BillingCustomer(tenant_id=tenant.id, name="Beto")
        self.session.add_all([self.table, self.product, self.regular, self.fresh])
        self.session.commit()
        for obj in (self.table, self.product, self.regular, self.fresh):
            self.session.refresh(obj)

    def _order(self, status: models.OrderStatus, qty: int) -> None:
        order = models.Order(
            table_id=self.table.id,
            tenant_id=self.tenant.id,
            status=status,
            billing_customer_id=self.regular.id,
            paid_at=datetime.now(timezone.utc),
        )
        self.session.add(order)
        self.session.commit()
        self.session.refresh(order)
        self.session.add(
            models.OrderItem(
                order_id=order.id,
                product_id=self.product.id,
                product_name="Coffee",
                quantity=qty,
                price_cents=1000,
                status=models.OrderItemStatus.pending,
            )
        )
        self.session.commit()

    def test_visits_and_spent_only_count_paid_orders(self) -> None:
        self._order(models.OrderStatus.paid, 2)
        self._order(models.OrderStatus.paid, 1)
        self._order(models.OrderStatus.pending, 5)
        r = self.client.get("/billing-customers", headers=_bearer_headers(self.owner))
        self.assertEqual(r.status_code, 200, r.text)
        by_name = {c["name"]: c for c in r.json()}
        self.assertEqual(by_name["Ana"]["visits"], 2)
        self.assertEqual(by_name["Ana"]["total_spent_cents"], 3000)
        self.assertIsNotNone(by_name["Ana"]["last_visit"])
        self.assertEqual(by_name["Beto"]["visits"], 0)
        self.assertEqual(by_name["Beto"]["total_spent_cents"], 0)
