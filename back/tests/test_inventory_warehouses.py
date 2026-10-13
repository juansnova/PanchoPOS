"""Multi-warehouse inventory MVP (GitHub #320)."""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from pg_client_mixin import PgClientTestCase

from app import models, security
from app.inventory_models import (
    InventoryCategory,
    InventoryItem,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseOrderStatus,
    Supplier,
    UnitOfMeasure,
    Warehouse,
    WarehouseStock,
)
from app.inventory_service import get_or_create_default_warehouse
from app.security import get_password_hash
from sqlmodel import select


def _bearer_headers(user: models.User) -> dict[str, str]:
    data = {
        "sub": user.email,
        "tenant_id": user.tenant_id,
        "provider_id": getattr(user, "provider_id", None),
        "token_version": user.token_version,
    }
    token = security.create_access_token(data, expires_delta=timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


class TestInventoryWarehouses(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = models.Tenant(name="Warehouse Tenant")
        self.session.add(self.tenant)
        self.session.commit()
        self.session.refresh(self.tenant)

        self.owner = models.User(
            email="wh-owner@test.local",
            hashed_password=get_password_hash("secret"),
            full_name="Warehouse Owner",
            tenant_id=self.tenant.id,
            role=models.UserRole.owner,
        )
        self.session.add(self.owner)
        self.session.commit()
        self.session.refresh(self.owner)

        self.item = InventoryItem(
            tenant_id=self.tenant.id,
            sku="WH-SKU-1",
            name="Cold meat",
            unit=UnitOfMeasure.kilogram,
            category=InventoryCategory.ingredients,
            current_quantity=Decimal("0"),
        )
        self.session.add(self.item)
        self.session.commit()
        self.session.refresh(self.item)

        self.headers = _bearer_headers(self.owner)

    def test_list_warehouses_creates_default(self) -> None:
        resp = self.client.get("/inventory/warehouses", headers=self.headers)
        self.assertEqual(resp.status_code, 200)
        rows = resp.json()
        self.assertGreaterEqual(len(rows), 1)
        defaults = [w for w in rows if w["is_default"]]
        self.assertEqual(len(defaults), 1)
        self.assertEqual(defaults[0]["name"], "Main")

    def test_adjust_stock_attributes_warehouse(self) -> None:
        main = get_or_create_default_warehouse(self.session, self.tenant.id)
        cold = Warehouse(
            tenant_id=self.tenant.id,
            name="Cold room",
            code="COLD",
            is_default=False,
        )
        self.session.add(cold)
        self.session.commit()
        self.session.refresh(cold)

        resp = self.client.post(
            f"/inventory/items/{self.item.id}/adjust",
            json={
                "quantity": 5,
                "unit": "kilogram",
                "adjustment_type": "adjustment_add",
                "notes": "into cold",
                "warehouse_id": cold.id,
            },
            headers=self.headers,
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["warehouse_id"], cold.id)

        self.session.expire_all()
        stock = self.session.exec(
            select(WarehouseStock)
            .where(WarehouseStock.warehouse_id == cold.id)
            .where(WarehouseStock.inventory_item_id == self.item.id)
        ).first()
        self.assertIsNotNone(stock)
        self.assertEqual(stock.quantity, Decimal("5"))

        levels = self.client.get(
            f"/inventory/stock-levels?warehouse_id={cold.id}",
            headers=self.headers,
        )
        self.assertEqual(levels.status_code, 200)
        by_sku = {row["sku"]: row for row in levels.json()}
        self.assertEqual(by_sku["WH-SKU-1"]["current_quantity"], 5.0)
        self.assertEqual(by_sku["WH-SKU-1"]["warehouse_id"], cold.id)

        main_levels = self.client.get(
            f"/inventory/stock-levels?warehouse_id={main.id}",
            headers=self.headers,
        ).json()
        main_qty = next(r["current_quantity"] for r in main_levels if r["sku"] == "WH-SKU-1")
        self.assertEqual(main_qty, 0.0)

    def test_receive_goods_to_warehouse(self) -> None:
        get_or_create_default_warehouse(self.session, self.tenant.id)
        cold = Warehouse(
            tenant_id=self.tenant.id,
            name="Cold room",
            code="COLD",
            is_default=False,
        )
        supplier = Supplier(tenant_id=self.tenant.id, name="Butcher Co")
        self.session.add(cold)
        self.session.add(supplier)
        self.session.commit()
        self.session.refresh(cold)
        self.session.refresh(supplier)

        po = PurchaseOrder(
            tenant_id=self.tenant.id,
            order_number="PO-WH-TEST-0001",
            supplier_id=supplier.id,
            status=PurchaseOrderStatus.approved,
            created_by_id=self.owner.id,
            subtotal_cents=1000,
            total_cents=1000,
        )
        self.session.add(po)
        self.session.commit()
        self.session.refresh(po)

        po_item = PurchaseOrderItem(
            purchase_order_id=po.id,
            inventory_item_id=self.item.id,
            quantity_ordered=Decimal("10"),
            quantity_received=Decimal("0"),
            unit=UnitOfMeasure.kilogram,
            unit_cost_cents=100,
            line_total_cents=1000,
        )
        self.session.add(po_item)
        self.session.commit()
        self.session.refresh(po_item)

        resp = self.client.post(
            f"/inventory/purchase-orders/{po.id}/receive",
            json={
                "items": [
                    {
                        "purchase_order_item_id": po_item.id,
                        "quantity_received": 10,
                    }
                ],
                "warehouse_id": cold.id,
                "notes": "to cold room",
            },
            headers=self.headers,
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["warehouse_id"], cold.id)

        self.session.expire_all()
        stock = self.session.exec(
            select(WarehouseStock)
            .where(WarehouseStock.warehouse_id == cold.id)
            .where(WarehouseStock.inventory_item_id == self.item.id)
        ).first()
        self.assertIsNotNone(stock)
        self.assertEqual(stock.quantity, Decimal("10"))

    def test_tenant_isolation(self) -> None:
        other = models.Tenant(name="Other WH Tenant")
        self.session.add(other)
        self.session.commit()
        self.session.refresh(other)
        foreign = Warehouse(
            tenant_id=other.id,
            name="Foreign",
            code="FRN",
            is_default=True,
        )
        self.session.add(foreign)
        self.session.commit()
        self.session.refresh(foreign)

        resp = self.client.post(
            f"/inventory/items/{self.item.id}/adjust",
            json={
                "quantity": 1,
                "unit": "kilogram",
                "adjustment_type": "adjustment_add",
                "warehouse_id": foreign.id,
            },
            headers=self.headers,
        )
        self.assertEqual(resp.status_code, 400)
