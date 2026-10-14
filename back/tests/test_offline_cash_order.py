"""Offline cash order sync: tenant isolation and idempotency (#319)."""

from __future__ import annotations

import unittest
from datetime import timedelta

from pg_client_mixin import PgClientTestCase

from sqlmodel import select

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


class TestOfflineCashOrderApi(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = models.Tenant(name="Offline Tenant")
        self.session.add(self.tenant)
        self.session.commit()
        self.session.refresh(self.tenant)

        self.owner = models.User(
            username="owner-offline@test.local",
            hashed_password=security.get_password_hash("x"),
            full_name="Owner",
            tenant_id=self.tenant.id,
            role=models.UserRole.owner,
        )
        self.session.add(self.owner)
        self.session.commit()
        self.session.refresh(self.owner)

        floor = models.Floor(name="Main", sort_order=0, tenant_id=self.tenant.id)
        self.session.add(floor)
        self.session.commit()
        self.session.refresh(floor)

        self.table = models.Table(
            name="Take Away",
            token="tok-offline-ta",
            floor_id=floor.id,
            tenant_id=self.tenant.id,
            x_position=0,
            y_position=0,
            rotation=0,
            shape="rect",
            width=1,
            height=1,
            seat_count=0,
            is_active=True,
        )
        self.session.add(self.table)

        self.product = models.Product(
            name="Coffee",
            price_cents=250,
            tenant_id=self.tenant.id,
        )
        self.session.add(self.product)
        self.session.commit()
        self.session.refresh(self.table)
        self.session.refresh(self.product)

        other = models.Tenant(name="Other Tenant")
        self.session.add(other)
        self.session.commit()
        self.session.refresh(other)
        self.other_owner = models.User(
            username="owner-other-offline@test.local",
            hashed_password=security.get_password_hash("x"),
            full_name="Other",
            tenant_id=other.id,
            role=models.UserRole.owner,
        )
        self.session.add(self.other_owner)
        self.session.commit()
        self.session.refresh(self.other_owner)

    def _payload(self, key: str = "offline-key-001234") -> dict:
        return {
            "idempotency_key": key,
            "table_id": self.table.id,
            "items": [{"product_id": self.product.id, "quantity": 2}],
            "customer_name": "Walk-in",
        }

    def test_create_cash_order_and_idempotent_replay(self) -> None:
        headers = _bearer_headers(self.owner)
        r1 = self.client.post("/orders/offline-cash", json=self._payload(), headers=headers)
        self.assertEqual(r1.status_code, 200, r1.text)
        body1 = r1.json()
        self.assertEqual(body1["status"], "created")
        self.assertEqual(body1["payment_method"], "cash")
        oid = body1["order_id"]

        r2 = self.client.post("/orders/offline-cash", json=self._payload(), headers=headers)
        self.assertEqual(r2.status_code, 200, r2.text)
        body2 = r2.json()
        self.assertEqual(body2["status"], "duplicate")
        self.assertEqual(body2["order_id"], oid)

        order = self.session.get(models.Order, oid)
        assert order is not None
        # Offline cash is paid + all items delivered → completed (#345)
        self.assertEqual(order.status, models.OrderStatus.completed)
        self.assertEqual(order.payment_method, "cash")
        self.assertIsNotNone(order.paid_at)
        items = list(
            self.session.exec(select(models.OrderItem).where(models.OrderItem.order_id == oid)).all()
        )
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].quantity, 2)
        self.assertEqual(items[0].status, models.OrderItemStatus.delivered)

    def test_tenant_isolation(self) -> None:
        headers = _bearer_headers(self.other_owner)
        r = self.client.post("/orders/offline-cash", json=self._payload(), headers=headers)
        self.assertEqual(r.status_code, 404, r.text)

    def test_deferred_card_creates_unpaid_order_idempotent(self) -> None:
        """payment_intent=card → unpaid order; no PAN; replay same order_id (#333)."""
        headers = _bearer_headers(self.owner)
        payload = {
            **self._payload(key="offline-card-key-001"),
            "payment_intent": "card",
        }
        r1 = self.client.post("/orders/offline-cash", json=payload, headers=headers)
        self.assertEqual(r1.status_code, 200, r1.text)
        body1 = r1.json()
        self.assertEqual(body1["status"], "created")
        self.assertEqual(body1["payment_intent"], "card")
        self.assertTrue(body1["needs_payment"])
        self.assertIsNone(body1["paid_at"])
        self.assertIsNone(body1["payment_method"])
        oid = body1["order_id"]

        order = self.session.get(models.Order, oid)
        assert order is not None
        self.assertEqual(order.status, models.OrderStatus.pending)
        self.assertIsNone(order.paid_at)
        self.assertIsNone(order.payment_method)
        self.assertIn("offline-card-intent", order.notes or "")

        items = list(
            self.session.exec(select(models.OrderItem).where(models.OrderItem.order_id == oid)).all()
        )
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].status, models.OrderItemStatus.pending)

        # No payment legs until staff collects card online.
        pays = self.client.get(f"/orders/{oid}/payments", headers=headers)
        self.assertEqual(pays.status_code, 200, pays.text)
        self.assertEqual(pays.json()["amount_paid_cents"], 0)

        r2 = self.client.post("/orders/offline-cash", json=payload, headers=headers)
        self.assertEqual(r2.status_code, 200, r2.text)
        body2 = r2.json()
        self.assertEqual(body2["status"], "duplicate")
        self.assertEqual(body2["order_id"], oid)
        self.assertTrue(body2["needs_payment"])

        # Invalid intent rejected.
        bad = self.client.post(
            "/orders/offline-cash",
            json={**self._payload(key="offline-bad-intent-01"), "payment_intent": "crypto"},
            headers=headers,
        )
        self.assertEqual(bad.status_code, 400, bad.text)


if __name__ == "__main__":
    unittest.main()
