"""Tests for DELETE /products/all (bulk delete tenant products)."""

from __future__ import annotations

import unittest
from datetime import timedelta

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


class TestProductsDeleteAll(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.t_a = models.Tenant(name="Delete All A")
        self.t_b = models.Tenant(name="Delete All B")
        self.session.add(self.t_a)
        self.session.add(self.t_b)
        self.session.commit()
        self.session.refresh(self.t_a)
        self.session.refresh(self.t_b)

        self.owner_a = models.User(
            email="delete-all-owner-a@test.local",
            hashed_password=security.get_password_hash("secret"),
            full_name="Owner A",
            tenant_id=self.t_a.id,
            role=models.UserRole.owner,
        )
        self.owner_b = models.User(
            email="delete-all-owner-b@test.local",
            hashed_password=security.get_password_hash("secret"),
            full_name="Owner B",
            tenant_id=self.t_b.id,
            role=models.UserRole.owner,
        )
        self.kitchen_a = models.User(
            email="delete-all-kitchen-a@test.local",
            hashed_password=security.get_password_hash("secret"),
            full_name="Kitchen A",
            tenant_id=self.t_a.id,
            role=models.UserRole.kitchen,
        )
        self.session.add(self.owner_a)
        self.session.add(self.owner_b)
        self.session.add(self.kitchen_a)
        self.session.commit()
        self.session.refresh(self.owner_a)
        self.session.refresh(self.owner_b)
        self.session.refresh(self.kitchen_a)

        self.headers_a = _bearer_headers(self.owner_a)
        self.headers_b = _bearer_headers(self.owner_b)
        self.headers_kitchen_a = _bearer_headers(self.kitchen_a)

    def _add_products(self, tenant_id: int, names: list[str]) -> None:
        for name in names:
            self.session.add(
                models.Product(tenant_id=tenant_id, name=name, price_cents=1000)
            )
        self.session.commit()

    def test_delete_all_removes_multiple_products(self) -> None:
        self._add_products(self.t_a.id, ["Soup", "Salad", "Steak"])
        r = self.client.delete("/products/all", headers=self.headers_a)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["count"], 3)

        listed = self.client.get("/products", headers=self.headers_a)
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(len(listed.json()), 0)

    def test_delete_all_empty_tenant_returns_zero(self) -> None:
        r = self.client.delete("/products/all", headers=self.headers_a)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["count"], 0)

    def test_delete_all_does_not_touch_other_tenant(self) -> None:
        self._add_products(self.t_a.id, ["Tenant A Dish"])
        self._add_products(self.t_b.id, ["Tenant B Dish"])

        r = self.client.delete("/products/all", headers=self.headers_a)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["count"], 1)

        listed_b = self.client.get("/products", headers=self.headers_b)
        self.assertEqual(len(listed_b.json()), 1)
        self.assertEqual(listed_b.json()[0]["name"], "Tenant B Dish")

    def test_delete_all_requires_product_write(self) -> None:
        self._add_products(self.t_a.id, ["Protected"])
        r = self.client.delete("/products/all", headers=self.headers_kitchen_a)
        self.assertEqual(r.status_code, 403, r.text)

        listed = self.client.get("/products", headers=self.headers_a)
        self.assertEqual(len(listed.json()), 1)

    def test_delete_all_unlinks_tenant_product_fk(self) -> None:
        product = models.Product(tenant_id=self.t_a.id, name="Linked Dish", price_cents=1200)
        self.session.add(product)
        self.session.commit()
        self.session.refresh(product)

        catalog = models.ProductCatalog(
            name="Delete All Catalog",
            normalized_name="delete all catalog",
            category="Food",
        )
        self.session.add(catalog)
        self.session.commit()
        self.session.refresh(catalog)

        tp = models.TenantProduct(
            tenant_id=self.t_a.id,
            catalog_id=catalog.id,
            product_id=product.id,
            name="Linked Dish",
            price_cents=1200,
        )
        self.session.add(tp)
        self.session.commit()
        self.session.refresh(tp)

        r = self.client.delete("/products/all", headers=self.headers_a)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["count"], 1)

        tp_id = tp.id
        self.assertIsNone(self.session.get(models.TenantProduct, tp_id))

        listed = self.client.get("/products", headers=self.headers_a)
        self.assertEqual(len(listed.json()), 0)


if __name__ == "__main__":
    unittest.main()
