"""End-of-day cash close: totals per payment method, difference, permissions."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

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


class TestCashClose(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        tenant = models.Tenant(name="Cash close test")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        self.tenant = tenant
        self.owner = self._user("cc-owner@test.local", models.UserRole.owner)
        self.waiter = self._user("cc-waiter@test.local", models.UserRole.waiter)
        floor = models.Floor(name="Main", tenant_id=tenant.id)
        self.session.add(floor)
        self.session.commit()
        self.session.refresh(floor)
        self.table = models.Table(name="T1", tenant_id=tenant.id, floor_id=floor.id, is_active=True)
        self.session.add(self.table)
        self.session.commit()
        self.session.refresh(self.table)
        self.product = models.Product(name="Coffee", price_cents=1000, tenant_id=tenant.id)
        self.session.add(self.product)
        self.session.commit()
        self.session.refresh(self.product)

    def _user(self, username: str, role: models.UserRole) -> models.User:
        user = models.User(
            username=username,
            hashed_password=security.get_password_hash("secret"),
            full_name=username,
            tenant_id=self.tenant.id,
            role=role,
        )
        self.session.add(user)
        self.session.commit()
        self.session.refresh(user)
        return user

    def _paid_order(self, price: int, method: str, tip: int = 0) -> None:
        order = models.Order(
            table_id=self.table.id,
            tenant_id=self.tenant.id,
            status=models.OrderStatus.paid,
            payment_method=method,
            tip_amount_cents=tip,
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
                quantity=1,
                price_cents=price,
                status=models.OrderItemStatus.pending,
            )
        )
        self.session.commit()

    def test_summary_groups_by_method(self) -> None:
        self._paid_order(1000, "cash")
        self._paid_order(2000, "terminal", tip=200)
        self._paid_order(500, "transfer")
        today = datetime.now(timezone.utc).date().isoformat()
        r = self.client.get(f"/cash-close/summary?business_date={today}", headers=_bearer_headers(self.owner))
        self.assertEqual(r.status_code, 200, r.text)
        j = r.json()
        self.assertEqual(j["orders_count"], 3)
        self.assertEqual(j["expected_cash_cents"], 1000)
        self.assertEqual(j["expected_card_cents"], 2200)
        self.assertEqual(j["expected_transfer_cents"], 500)
        self.assertEqual(j["tips_cents"], 200)

    def test_close_computes_difference(self) -> None:
        self._paid_order(1000, "cash")
        today = datetime.now(timezone.utc).date().isoformat()
        r = self.client.post(
            "/cash-close",
            json={"business_date": today, "counted_cash_cents": 5800, "opening_float_cents": 5000},
            headers=_bearer_headers(self.owner),
        )
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["difference_cents"], -200)
        lst = self.client.get("/cash-close", headers=_bearer_headers(self.owner))
        self.assertEqual(len(lst.json()), 1)

    def test_future_date_rejected(self) -> None:
        future = (date.today() + timedelta(days=3)).isoformat()
        r = self.client.post(
            "/cash-close",
            json={"business_date": future, "counted_cash_cents": 0},
            headers=_bearer_headers(self.owner),
        )
        self.assertEqual(r.status_code, 400)

    def test_waiter_forbidden(self) -> None:
        today = datetime.now(timezone.utc).date().isoformat()
        r = self.client.get(f"/cash-close/summary?business_date={today}", headers=_bearer_headers(self.waiter))
        self.assertEqual(r.status_code, 403)
