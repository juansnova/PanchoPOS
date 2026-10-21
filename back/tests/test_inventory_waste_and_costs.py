"""Waste report (with reasons) and purchase cost history / price-rise alerts."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from pg_client_mixin import PgClientTestCase

from app import models, security
from app.inventory_models import InventoryBatch, InventoryItem, UnitOfMeasure


def _bearer_headers(user: models.User) -> dict[str, str]:
    data = {
        "sub": user.username,
        "tenant_id": user.tenant_id,
        "provider_id": getattr(user, "provider_id", None),
        "token_version": user.token_version,
    }
    token = security.create_access_token(data, expires_delta=timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


class TestWasteAndCosts(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        tenant = models.Tenant(name="Waste costs test")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        self.tenant = tenant
        self.owner = models.User(
            username="wc-owner@test.local",
            hashed_password=security.get_password_hash("secret"),
            full_name="Owner",
            tenant_id=tenant.id,
            role=models.UserRole.owner,
        )
        self.session.add(self.owner)
        self.session.commit()
        self.session.refresh(self.owner)
        self.item = InventoryItem(
            tenant_id=tenant.id,
            sku="TOM-1",
            name="Tomate",
            unit=UnitOfMeasure.kilogram,
            current_quantity=Decimal("20"),
            average_cost_cents=1000,
        )
        self.session.add(self.item)
        self.session.commit()
        self.session.refresh(self.item)
        self.h = _bearer_headers(self.owner)

    def _adjust(self, qty: str, kind: str, reason: str | None = None):
        return self.client.post(
            f"/inventory/items/{self.item.id}/adjust",
            json={"quantity": qty, "unit": "kilogram", "adjustment_type": kind, "reason": reason},
            headers=self.h,
        )

    def test_waste_report_groups_by_reason(self) -> None:
        self.assertEqual(self._adjust("2", "waste", "spoiled").status_code, 200)
        self.assertEqual(self._adjust("1", "waste", "broken").status_code, 200)
        self.assertEqual(self._adjust("5", "adjustment_subtract").status_code, 200)  # not waste
        today = datetime.now(timezone.utc).date().isoformat()
        r = self.client.get(f"/inventory/waste-report?from_date={today}&to_date={today}", headers=self.h)
        self.assertEqual(r.status_code, 200, r.text)
        j = r.json()
        self.assertEqual(j["events"], 2)
        self.assertEqual(j["total_cost_cents"], 3000)
        self.assertEqual(j["by_reason"][0]["reason"], "spoiled")
        self.assertEqual(j["by_item"][0]["name"], "Tomate")

    def _batch(self, cost: int, days_ago: int) -> None:
        self.session.add(
            InventoryBatch(
                tenant_id=self.tenant.id,
                inventory_item_id=self.item.id,
                received_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
                quantity_received=Decimal("10"),
                quantity_remaining=Decimal("10"),
                cost_per_unit_cents=cost,
            )
        )
        self.session.commit()

    def test_cost_history_and_alert(self) -> None:
        self._batch(1000, 10)
        self._batch(1300, 1)
        r = self.client.get(f"/inventory/items/{self.item.id}/cost-history", headers=self.h)
        self.assertEqual(r.status_code, 200, r.text)
        pts = r.json()["points"]
        self.assertEqual(pts[0]["unit_cost_cents"], 1300)
        self.assertEqual(pts[0]["change_pct"], 30.0)
        self.assertIsNone(pts[1]["change_pct"])
        a = self.client.get("/inventory/cost-alerts?threshold_pct=10", headers=self.h)
        self.assertEqual(a.status_code, 200, a.text)
        self.assertEqual([x["name"] for x in a.json()], ["Tomate"])
        none = self.client.get("/inventory/cost-alerts?threshold_pct=50", headers=self.h)
        self.assertEqual(none.json(), [])
