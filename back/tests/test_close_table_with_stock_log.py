"""Closing a table whose empty order has stock movements must not hit the FK (was a 500)."""
from __future__ import annotations

import unittest
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from pg_client_mixin import PgClientTestCase

from app import inventory_models, models, security


class TestCloseTableWithStockLog(PgClientTestCase):
    def test_close_keeps_order_cancelled_when_stock_movements_reference_it(self) -> None:
        tenant = models.Tenant(name="CloseStock Tenant")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        owner = models.User(
            username=f"close-stock-{uuid4().hex[:8]}@amvara.de",
            hashed_password=security.get_password_hash("x"),
            full_name="Owner",
            tenant_id=tenant.id,
            role=models.UserRole.owner,
        )
        floor = models.Floor(name="Main", sort_order=0, tenant_id=tenant.id)
        self.session.add_all([owner, floor])
        self.session.commit()
        self.session.refresh(owner)
        self.session.refresh(floor)
        table = models.Table(
            name="T-stock", token=f"tok-{uuid4().hex}", floor_id=floor.id, tenant_id=tenant.id,
            x_position=0, y_position=0, rotation=0, shape="rectangle", width=1, height=1,
            seat_count=4, is_active=True,
        )
        self.session.add(table)
        self.session.commit()
        self.session.refresh(table)
        order = models.Order(tenant_id=tenant.id, table_id=table.id)
        self.session.add(order)
        self.session.commit()
        self.session.refresh(order)
        table.active_order_id = order.id
        item = inventory_models.InventoryItem(tenant_id=tenant.id, sku=f"S-{uuid4().hex[:6]}", name="Arroz")
        self.session.add_all([table, item])
        self.session.commit()
        self.session.refresh(item)
        self.session.add(
            inventory_models.InventoryTransaction(
                tenant_id=tenant.id,
                inventory_item_id=item.id,
                transaction_type=inventory_models.TransactionType.sale,
                quantity=Decimal("-1"),
                unit=item.unit,
                balance_after=Decimal("0"),
                order_id=order.id,
            )
        )
        self.session.commit()

        token = security.create_access_token(
            {"sub": owner.username, "tenant_id": owner.tenant_id, "provider_id": None,
             "token_version": owner.token_version},
            expires_delta=timedelta(minutes=30),
        )
        r = self.client.post(f"/tables/{table.id}/close", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(r.status_code, 200, r.text)
        self.session.expire_all()
        kept = self.session.get(models.Order, order.id)
        self.assertIsNotNone(kept)
        self.assertEqual(kept.status, models.OrderStatus.cancelled)


if __name__ == "__main__":
    unittest.main()
