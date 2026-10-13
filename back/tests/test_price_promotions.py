"""Price promotions MVP tests (#322)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from pg_client_mixin import PgClientTestCase
from sqlmodel import select

from app import models, security
from app import promo_service as promo_svc


def _bearer_headers(user: models.User) -> dict[str, str]:
    data = {
        "sub": user.username,
        "tenant_id": user.tenant_id,
        "provider_id": getattr(user, "provider_id", None),
        "token_version": user.token_version,
    }
    token = security.create_access_token(data, expires_delta=timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


class TestPricePromotions(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = models.Tenant(name="Promo Cafe", timezone="UTC")
        self.other = models.Tenant(name="Other Place", timezone="UTC")
        self.session.add(self.tenant)
        self.session.add(self.other)
        self.session.commit()
        self.session.refresh(self.tenant)
        self.session.refresh(self.other)

        pwd = security.get_password_hash("x")
        self.admin = models.User(
            username="promo-admin",
            hashed_password=pwd,
            full_name="Admin",
            role=models.UserRole.owner,
            tenant_id=self.tenant.id,
        )
        self.other_admin = models.User(
            username="promo-other",
            hashed_password=pwd,
            full_name="Other",
            role=models.UserRole.owner,
            tenant_id=self.other.id,
        )
        self.session.add(self.admin)
        self.session.add(self.other_admin)
        self.session.commit()
        self.session.refresh(self.admin)
        self.session.refresh(self.other_admin)

        floor = models.Floor(tenant_id=self.tenant.id, name="Main", sort_order=0)
        self.session.add(floor)
        self.session.commit()
        self.session.refresh(floor)
        self.table = models.Table(
            tenant_id=self.tenant.id,
            floor_id=floor.id,
            name="T1",
            order_code="1234",
            token="promo-t1-token",
            x_position=0,
            y_position=0,
            rotation=0,
            shape="rect",
            width=1,
            height=1,
            seat_count=4,
            is_active=True,
        )
        self.session.add(self.table)
        self.bev = models.Product(
            tenant_id=self.tenant.id,
            name="Cola",
            price_cents=500,
            category="Beverages",
        )
        self.food = models.Product(
            tenant_id=self.tenant.id,
            name="Burger",
            price_cents=1200,
            category="Main Course",
        )
        self.session.add(self.bev)
        self.session.add(self.food)
        self.session.commit()
        self.session.refresh(self.table)
        self.session.refresh(self.bev)
        self.session.refresh(self.food)

    def _create_promo(self, **overrides):
        body = {
            "name": "Happy Hour Bevs",
            "promo_type": "percent_off_category",
            "percent_off": 20,
            "category": "Beverages",
            "enabled": True,
        }
        body.update(overrides)
        r = self.client.post("/promos", json=body, headers=_bearer_headers(self.admin))
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_tenant_isolation(self):
        created = self._create_promo()
        r = self.client.get("/promos", headers=_bearer_headers(self.other_admin))
        self.assertEqual(r.status_code, 200)
        ids = {p["id"] for p in r.json()}
        self.assertNotIn(created["id"], ids)

    def test_apply_percent_and_eligibility_channel(self):
        self._create_promo(channels=["table"])
        applied = promo_svc.resolve_line_price(
            self.session,
            tenant_id=self.tenant.id,
            list_price_cents=500,
            product_category="Beverages",
            channel="table",
        )
        self.assertEqual(applied["price_cents"], 400)
        self.assertEqual(applied["list_price_cents"], 500)
        self.assertEqual(applied["discount_cents"], 100)
        self.assertIsNotNone(applied["promo_id"])

        skip = promo_svc.resolve_line_price(
            self.session,
            tenant_id=self.tenant.id,
            list_price_cents=500,
            product_category="Beverages",
            channel="satisfecho_delivery",
        )
        self.assertEqual(skip["price_cents"], 500)
        self.assertIsNone(skip["promo_id"])

        food = promo_svc.resolve_line_price(
            self.session,
            tenant_id=self.tenant.id,
            list_price_cents=1200,
            product_category="Main Course",
            channel="table",
        )
        self.assertEqual(food["price_cents"], 1200)

    def test_time_window_excludes(self):
        # Far-future window — not eligible now
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        far = (datetime.now(timezone.utc) + timedelta(days=60)).isoformat()
        self._create_promo(starts_at=future, ends_at=far)
        applied = promo_svc.resolve_line_price(
            self.session,
            tenant_id=self.tenant.id,
            list_price_cents=500,
            product_category="Beverages",
            channel="table",
        )
        self.assertIsNone(applied["promo_id"])

    def test_menu_reflects_promo_price(self):
        self._create_promo(percent_off=50)
        r = self.client.get(f"/menu/{self.table.token}")
        self.assertEqual(r.status_code, 200, r.text)
        products = r.json()["products"]
        cola = next(p for p in products if p["name"] == "Cola")
        self.assertEqual(cola["price_cents"], 250)
        self.assertEqual(cola["list_price_cents"], 500)
        self.assertEqual(cola["promo_percent_off"], 50)

    def test_order_line_audit_snapshot(self):
        self._create_promo(percent_off=20)
        r = self.client.post(
            f"/menu/{self.table.token}/order",
            json={
                "session_id": "promo-session-1",
                "table_code": "1234",
                "items": [{"product_id": self.bev.id, "quantity": 2}],
            },
        )
        self.assertIn(r.status_code, (200, 201), r.text)
        order_id = r.json()["order_id"]
        items = self.session.exec(
            select(models.OrderItem).where(models.OrderItem.order_id == order_id)
        ).all()
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(item.price_cents, 400)
        self.assertEqual(item.list_price_cents, 500)
        self.assertEqual(item.discount_cents, 100)
        self.assertIsNotNone(item.promo_id)
        self.assertIsNotNone(item.promo_snapshot)
        self.assertEqual(item.promo_snapshot.get("percent_off"), 20)

    def test_best_percent_wins(self):
        self._create_promo(name="Small", percent_off=10)
        self._create_promo(name="Big", percent_off=30)
        applied = promo_svc.resolve_line_price(
            self.session,
            tenant_id=self.tenant.id,
            list_price_cents=1000,
            product_category="Beverages",
            channel="table",
        )
        self.assertEqual(applied["price_cents"], 700)
        self.assertEqual(applied["promo_snapshot"]["percent_off"], 30)
