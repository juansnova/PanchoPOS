"""Ingredient shortages notify the admin instead of silently removing dishes from the menu."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from pg_client_mixin import PgClientTestCase

from app import models, security
from app.inventory_models import InventoryItem, ProductRecipe, UnitOfMeasure


class TestInventoryAlerts(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = models.Tenant(name="Stock Alerts Cafe")
        self.session.add(self.tenant)
        self.session.commit()
        self.session.refresh(self.tenant)
        self.owner = models.User(
            username=f"stock-owner-{uuid4().hex[:8]}@amvara.de",
            hashed_password=security.get_password_hash("x"),
            full_name="Owner",
            tenant_id=self.tenant.id,
            role=models.UserRole.owner,
        )
        self.soup = models.Product(tenant_id=self.tenant.id, name="Sopa", price_cents=1500)
        self.chicken = InventoryItem(
            tenant_id=self.tenant.id,
            sku="CH-1",
            name="Pollo",
            unit=UnitOfMeasure.gram,
            current_quantity=Decimal("400"),
        )
        self.session.add_all([self.owner, self.soup, self.chicken])
        self.session.commit()
        for obj in (self.owner, self.soup, self.chicken):
            self.session.refresh(obj)
        self.session.add(
            ProductRecipe(
                tenant_id=self.tenant.id,
                product_id=self.soup.id,
                inventory_item_id=self.chicken.id,
                quantity_required=Decimal("500"),
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

    def _menu_names(self) -> list[str]:
        r = self.client.get(f"/public/tenants/{self.tenant.id}/menu")
        self.assertEqual(r.status_code, 200, r.text)
        return [p["name"] for cat in r.json()["categories"] for p in cat["products"]]

    def _alerts(self) -> dict:
        r = self.client.get("/inventory/alerts", headers=self.h)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_short_ingredient_keeps_dish_on_menu_and_notifies_admin(self) -> None:
        self.assertIn("Sopa", self._menu_names())
        data = self._alerts()
        self.assertEqual(data["attention_count"], 1)
        alert = data["alerts"][0]
        self.assertEqual(alert["kind"], "out")
        self.assertEqual(alert["status"], "open")
        self.assertEqual([p["name"] for p in alert["products"]], ["Sopa"])

    def test_admin_withdraws_then_restock_offers_again(self) -> None:
        alert_id = self._alerts()["alerts"][0]["id"]
        r = self.client.post(f"/inventory/alerts/{alert_id}/withdraw", headers=self.h)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["status"], "withdrawn")
        self.assertNotIn("Sopa", self._menu_names())
        self.assertEqual(self._alerts()["attention_count"], 0)

        # New stock arrives: the admin is asked to offer the dish again
        self.chicken.current_quantity = Decimal("2000")
        self.session.add(self.chicken)
        self.session.commit()
        data = self._alerts()
        self.assertEqual(data["attention_count"], 1)
        self.assertEqual(data["alerts"][0]["status"], "restocked")

        r = self.client.post(f"/inventory/alerts/{alert_id}/offer-again", headers=self.h)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn("Sopa", self._menu_names())
        self.assertEqual(self._alerts()["alerts"], [])

    def test_keep_selling_clears_the_notice_without_touching_the_menu(self) -> None:
        alert_id = self._alerts()["alerts"][0]["id"]
        r = self.client.post(f"/inventory/alerts/{alert_id}/keep", headers=self.h)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["status"], "kept")
        self.assertIn("Sopa", self._menu_names())
        self.assertEqual(self._alerts()["attention_count"], 0)

    def test_low_stock_reminder_and_auto_close_after_restock(self) -> None:
        self.chicken.current_quantity = Decimal("900")
        self.chicken.reorder_level = Decimal("1000")
        self.session.add(self.chicken)
        self.session.commit()
        data = self._alerts()
        self.assertEqual([a["kind"] for a in data["alerts"]], ["low"])
        self.assertEqual(data["alerts"][0]["products"], [])

        self.chicken.current_quantity = Decimal("5000")
        self.session.add(self.chicken)
        self.session.commit()
        self.assertEqual(self._alerts()["alerts"], [])

    def test_out_escalates_a_low_reminder(self) -> None:
        self.chicken.current_quantity = Decimal("900")
        self.chicken.reorder_level = Decimal("1000")
        self.session.add(self.chicken)
        self.session.commit()
        self.assertEqual([a["kind"] for a in self._alerts()["alerts"]], ["low"])
        self.chicken.current_quantity = Decimal("100")
        self.session.add(self.chicken)
        self.session.commit()
        self.assertEqual([a["kind"] for a in self._alerts()["alerts"]], ["out"])

    def test_other_tenant_cannot_decide(self) -> None:
        alert_id = self._alerts()["alerts"][0]["id"]
        other = models.Tenant(name="Other")
        self.session.add(other)
        self.session.commit()
        self.session.refresh(other)
        u = models.User(
            username=f"other-{uuid4().hex[:8]}@amvara.de",
            hashed_password=security.get_password_hash("x"),
            full_name="O",
            tenant_id=other.id,
            role=models.UserRole.owner,
        )
        self.session.add(u)
        self.session.commit()
        self.session.refresh(u)
        tok = security.create_access_token(
            {"sub": u.username, "tenant_id": u.tenant_id, "provider_id": None, "token_version": u.token_version},
            expires_delta=timedelta(minutes=30),
        )
        r = self.client.post(f"/inventory/alerts/{alert_id}/withdraw", headers={"Authorization": f"Bearer {tok}"})
        self.assertEqual(r.status_code, 404, r.text)
