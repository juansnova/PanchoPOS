"""Staff settling the bill closes the table session so the next guests start empty."""

from __future__ import annotations

from datetime import timedelta

from pg_client_mixin import PgClientTestCase

from app import models, security


def _bearer_headers(user: models.User) -> dict[str, str]:
    data = {"sub": user.username, "tenant_id": user.tenant_id, "token_version": user.token_version}
    token = security.create_access_token(data, expires_delta=timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


class TestTableCloseOnPaid(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = models.Tenant(name="Close On Paid Cafe")
        self.session.add(self.tenant)
        self.session.commit()
        self.session.refresh(self.tenant)

        self.waiter = models.User(
            username="close-on-paid-waiter",
            hashed_password=security.get_password_hash("x"),
            role=models.UserRole.waiter,
            tenant_id=self.tenant.id,
        )
        self.session.add(self.waiter)
        floor = models.Floor(tenant_id=self.tenant.id, name="Main", sort_order=0)
        self.session.add(floor)
        self.session.commit()
        self.session.refresh(self.waiter)
        self.session.refresh(floor)
        self.floor_id = floor.id

        self.product = models.Product(tenant_id=self.tenant.id, name="Burger", price_cents=1000)
        self.session.add(self.product)
        self.session.commit()
        self.session.refresh(self.product)

    def _table_with_open_order(self, name: str) -> tuple[models.Table, models.Order]:
        table = models.Table(
            tenant_id=self.tenant.id,
            floor_id=self.floor_id,
            name=name,
            is_active=True,
            order_code="1234",
        )
        self.session.add(table)
        self.session.commit()
        self.session.refresh(table)
        order = models.Order(
            tenant_id=self.tenant.id,
            table_id=table.id,
            status=models.OrderStatus.pending,
            session_id="close-on-paid-session",
        )
        self.session.add(order)
        self.session.commit()
        self.session.refresh(order)
        self.session.add(
            models.OrderItem(
                order_id=order.id,
                product_id=self.product.id,
                product_name=self.product.name,
                quantity=1,
                price_cents=self.product.price_cents,
            )
        )
        table.active_order_id = order.id
        self.session.add(table)
        self.session.commit()
        return table, order

    def test_mark_paid_closes_table_and_hides_current_order(self) -> None:
        table, order = self._table_with_open_order("T1")
        r = self.client.put(
            f"/orders/{order.id}/mark-paid",
            json={"payment_method": "cash"},
            headers=_bearer_headers(self.waiter),
        )
        self.assertEqual(r.status_code, 200, r.text)

        self.session.expire_all()
        table = self.session.get(models.Table, table.id)
        self.assertFalse(table.is_active)
        self.assertIsNone(table.active_order_id)

        # Next guest scanning the table's QR self-activates it fresh (no old order carried over).
        r = self.client.get(f"/menu/{table.token}")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIsNone(r.json().get("active_order_id"))
        r = self.client.get(f"/menu/{table.token}/order", params={"session_id": "next-guest-session"})
        self.assertIsNone(r.json().get("order"))

    def test_finish_closes_table(self) -> None:
        table, order = self._table_with_open_order("T2")
        r = self.client.put(
            f"/orders/{order.id}/finish",
            json={"payment_method": "cash"},
            headers=_bearer_headers(self.waiter),
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.session.expire_all()
        self.assertFalse(self.session.get(models.Table, table.id).is_active)

    def test_take_away_table_stays_open(self) -> None:
        table, order = self._table_with_open_order("Take away")
        r = self.client.put(
            f"/orders/{order.id}/mark-paid",
            json={"payment_method": "cash"},
            headers=_bearer_headers(self.waiter),
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.session.expire_all()
        self.assertTrue(self.session.get(models.Table, table.id).is_active)

    def test_order_requires_table_code(self) -> None:
        table, _ = self._table_with_open_order("T6")
        body = {"items": [{"product_id": self.product.id, "quantity": 1}], "session_id": "code-guest-1"}
        self.assertTrue(self.client.get(f"/menu/{table.token}").json()["requires_order_code"])
        self.assertEqual(self.client.post(f"/menu/{table.token}/order", json=body).status_code, 403)
        wrong = self.client.post(f"/menu/{table.token}/order", json={**body, "table_code": "000000"})
        self.assertEqual(wrong.status_code, 403, wrong.text)
        ok = self.client.post(f"/menu/{table.token}/order", json={**body, "table_code": "1234"})
        self.assertEqual(ok.status_code, 200, ok.text)

    def test_logged_in_waiter_skips_table_code(self) -> None:
        table, _ = self._table_with_open_order("T7")
        body = {"items": [{"product_id": self.product.id, "quantity": 1}], "session_id": "staff-1"}
        headers = _bearer_headers(self.waiter)
        self.assertFalse(self.client.get(f"/menu/{table.token}", headers=headers).json()["requires_order_code"])
        ok = self.client.post(f"/menu/{table.token}/order", json=body, headers=headers)
        self.assertEqual(ok.status_code, 200, ok.text)

    def _idle_table(self, name: str, *, minutes_active: int) -> models.Table:
        from datetime import datetime, timedelta, timezone

        table = models.Table(
            tenant_id=self.tenant.id,
            floor_id=self.floor_id,
            name=name,
            is_active=True,
            order_code="1234",
            activated_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_active),
        )
        self.session.add(table)
        self.session.commit()
        self.session.refresh(table)
        return table

    def test_idle_table_closes_after_ten_minutes_without_order(self) -> None:
        from app.table_idle_close import close_idle_tables

        stale = self._idle_table("IDLE1", minutes_active=11)
        fresh = self._idle_table("IDLE2", minutes_active=3)
        with_order, _ = self._table_with_open_order("IDLE3")
        with_order.activated_at = stale.activated_at
        self.session.add(with_order)
        self.session.commit()

        close_idle_tables(self.session)
        self.session.expire_all()
        self.assertFalse(self.session.get(models.Table, stale.id).is_active)
        self.assertIsNone(self.session.get(models.Table, stale.id).order_code)
        self.assertTrue(self.session.get(models.Table, fresh.id).is_active)
        self.assertTrue(self.session.get(models.Table, with_order.id).is_active)

    def test_staff_sees_code_and_close_rotates_it(self) -> None:
        table, _ = self._table_with_open_order("T7")
        h = _bearer_headers(self.waiter)
        rows = self.client.get("/tables/with-status", headers=h).json()
        row = next(r for r in rows if r["id"] == table.id)
        self.assertEqual(row["order_code"], "1234")
        self.assertEqual(self.client.post(f"/tables/{table.id}/close", headers=h).status_code, 200)
        self.session.expire_all()
        self.assertIsNone(self.session.get(models.Table, table.id).order_code)
        self.assertEqual(self.client.post(f"/tables/{table.id}/activate", headers=h).status_code, 200)
        self.session.expire_all()
        fresh = self.session.get(models.Table, table.id).order_code
        self.assertRegex(fresh or "", r"^\d{4}$")

    def test_guest_orders_only_on_active_table(self) -> None:
        table, _ = self._table_with_open_order("T4")
        payload = {
            "items": [{"product_id": self.product.id, "quantity": 1}],
            "session_id": "no-pin-guest-1",
            "table_code": "1234",
        }
        r = self.client.post(f"/menu/{table.token}/order", json=payload)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotIn("table_requires_pin", self.client.get(f"/menu/{table.token}").json())

        table = self.session.get(models.Table, table.id)
        table.is_active = False
        self.session.add(table)
        self.session.commit()
        r = self.client.post(f"/menu/{table.token}/order", json=payload)
        self.assertEqual(r.status_code, 403, r.text)

    def test_pin_endpoints_removed(self) -> None:
        table, _ = self._table_with_open_order("T5")
        h = _bearer_headers(self.waiter)
        r = self.client.post(f"/tables/{table.id}/activate", headers=h)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotIn("pin", r.json())
        self.assertEqual(self.client.post(f"/tables/{table.id}/regenerate-pin", headers=h).status_code, 404)
        self.assertEqual(self.client.get(f"/tables/{table.id}/staff-menu-token", headers=h).status_code, 404)

    def test_order_history_endpoint_removed(self) -> None:
        table, _ = self._table_with_open_order("T3")
        r = self.client.get(
            f"/menu/{table.token}/order-history", params={"session_id": "abcdefgh-session"}
        )
        self.assertEqual(r.status_code, 404)
