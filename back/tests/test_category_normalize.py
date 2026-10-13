"""Tests for product category alias normalization."""

from __future__ import annotations

import unittest
from datetime import timedelta

from pg_client_mixin import PgClientTestCase
from sqlmodel import select

from app import models, security
from app.category_codes import (
    CATEGORY_CODES,
    normalize_product_category,
    repair_stored_category_aliases,
)
from app.product_bulk_import import ProductBulkImportItemIn, build_preview, confirm_import
from app.product_bulk_import import ProductBulkImportPreviewRow
from app.tenant_subcategories import tenant_categories_for_ui


def _owner_headers(user: models.User) -> dict[str, str]:
    data = {
        "sub": user.email,
        "tenant_id": user.tenant_id,
        "provider_id": getattr(user, "provider_id", None),
        "token_version": user.token_version,
    }
    token = security.create_access_token(data, expires_delta=timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


class TestCategoryNormalize(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        tenant = models.Tenant(name="Category Norm Test")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        self.tenant_id = tenant.id

        self.owner = models.User(
            email="cat-norm-owner@test.local",
            hashed_password=security.get_password_hash("secret"),
            full_name="Owner",
            tenant_id=self.tenant_id,
            role=models.UserRole.owner,
        )
        self.session.add(self.owner)
        self.session.commit()
        self.session.refresh(self.owner)
        self.headers = _owner_headers(self.owner)

    def test_normalize_spanish_and_catalan_aliases(self):
        self.assertEqual(normalize_product_category("Entrantes"), CATEGORY_CODES["STARTERS"])
        self.assertEqual(normalize_product_category("Plat principal"), CATEGORY_CODES["MAIN_COURSE"])
        self.assertEqual(normalize_product_category("Custom Menu"), "Custom Menu")

    def test_create_product_stores_canonical_category(self):
        r = self.client.post(
            "/products",
            json={
                "name": "Soup",
                "price_cents": 500,
                "category": "Entrantes",
            },
            headers=self.headers,
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["category"], "Starters")

    def test_update_product_normalizes_category(self):
        product = models.Product(
            tenant_id=self.tenant_id, name="Steak", price_cents=2000, category="Starters"
        )
        self.session.add(product)
        self.session.commit()
        self.session.refresh(product)

        r = self.client.put(
            f"/products/{product.id}",
            json={"category": "Plat principal"},
            headers=self.headers,
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["category"], "Main Course")

    def test_bulk_import_preview_normalizes_category(self):
        preview = build_preview(
            self.session,
            self.tenant_id,
            [ProductBulkImportItemIn(name="Paella", price=12.0, category="Entrantes")],
        )
        self.assertTrue(preview.items[0].valid)
        self.assertEqual(preview.items[0].category, "Starters")

    def test_bulk_import_confirm_stores_canonical(self):
        preview = build_preview(
            self.session,
            self.tenant_id,
            [ProductBulkImportItemIn(name="Cake", price=5.0, category="Postres")],
        )
        row = preview.items[0]
        confirm_import(self.session, self.tenant_id, [row])
        product = self.session.exec(
            select(models.Product).where(
                models.Product.tenant_id == self.tenant_id,
                models.Product.name == "Cake",
            )
        ).first()
        self.assertIsNotNone(product)
        self.assertEqual(product.category, "Desserts")

    def test_catalog_categories_lists_standard_once_with_alias_products(self):
        self.session.add(
            models.Product(
                tenant_id=self.tenant_id,
                name="Alias Starter",
                price_cents=400,
                category="Entrantes",
            )
        )
        self.session.add(
            models.Product(
                tenant_id=self.tenant_id,
                name="Canonical Starter",
                price_cents=500,
                category="Starters",
            )
        )
        self.session.commit()
        repair_stored_category_aliases(self.session)

        r = self.client.get("/catalog/categories", headers=self.headers)
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertIn("Starters", body)
        self.assertNotIn("Entrantes", body)
        starter_keys = [k for k in body if k == "Starters"]
        self.assertEqual(len(starter_keys), 1)

    def test_tenant_categories_for_ui_collapses_alias_keys(self):
        tenant = self.session.get(models.Tenant, self.tenant_id)
        tenant.custom_subcategories = {
            "Entrantes": ["House Soup"],
            "Starters": ["Bruschetta"],
        }
        self.session.add(tenant)
        self.session.commit()

        merged = tenant_categories_for_ui(self.session, self.tenant_id)
        self.assertIn("Starters", merged)
        self.assertNotIn("Entrantes", merged)
        self.assertIn("House Soup", merged["Starters"])
        self.assertIn("Bruschetta", merged["Starters"])


if __name__ == "__main__":
    unittest.main()
