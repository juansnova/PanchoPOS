"""DELETE /tables/{id} must resolve lang via Depends (not call _get_requested_language(request))."""
from __future__ import annotations

import unittest
from datetime import timedelta
from uuid import uuid4

from pg_client_mixin import PgClientTestCase

from app import models, security


def _bearer_headers(user: models.User) -> dict[str, str]:
    data = {
        "sub": user.email,
        "tenant_id": user.tenant_id,
        "provider_id": getattr(user, "provider_id", None),
        "token_version": user.token_version,
    }
    token = security.create_access_token(data, expires_delta=timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


class TestDeleteTableApi(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        tenant = models.Tenant(name="DelTable Tenant")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)

        owner = models.User(
            email=f"del-table-owner-{uuid4().hex[:8]}@amvara.de",
            hashed_password=security.get_password_hash("x"),
            full_name="Owner",
            tenant_id=tenant.id,
            role=models.UserRole.owner,
        )
        self.session.add(owner)
        self.session.commit()
        self.session.refresh(owner)
        self.owner = owner

        floor = models.Floor(name="Main", sort_order=0, tenant_id=tenant.id)
        self.session.add(floor)
        self.session.commit()
        self.session.refresh(floor)

        table = models.Table(
            name="T-del",
            token=f"tok-del-{uuid4().hex}",
            floor_id=floor.id,
            tenant_id=tenant.id,
            x_position=0,
            y_position=0,
            rotation=0,
            shape="rectangle",
            width=1,
            height=1,
            seat_count=2,
            is_active=False,
        )
        self.session.add(table)
        self.session.commit()
        self.session.refresh(table)
        self.table_id = table.id

    def test_delete_table_not_found_returns_404_not_500(self) -> None:
        h = _bearer_headers(self.owner)
        r = self.client.delete("/tables/999999999", headers=h)
        self.assertEqual(r.status_code, 404, r.text)
        body = r.json()
        self.assertIn("detail", body)

    def test_delete_table_without_orders_returns_200(self) -> None:
        h = _bearer_headers(self.owner)
        r = self.client.delete(f"/tables/{self.table_id}", headers=h)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json().get("status"), "deleted")

    def test_delete_table_succeeds_when_only_soft_deleted_orders_linked(self) -> None:
        """Soft-deleted orders must not block table delete (has_orders / FK unlink)."""
        order = models.Order(
            tenant_id=self.owner.tenant_id,
            table_id=self.table_id,
            status=models.OrderStatus.pending,
        )
        self.session.add(order)
        self.session.commit()
        self.session.refresh(order)

        h = _bearer_headers(self.owner)
        r_del = self.client.delete(f"/orders/{order.id}", headers=h)
        self.assertEqual(r_del.status_code, 200, r_del.text)

        r = self.client.delete(f"/tables/{self.table_id}", headers=h)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json().get("status"), "deleted")


if __name__ == "__main__":
    unittest.main()
