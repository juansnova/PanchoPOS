"""Tests for CSV product migration import (#321)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pg_client_mixin import PgClientTestCase

from app import models, security
from app.product_bulk_import import (
    build_preview,
    confirm_import,
    parse_products_csv,
)
from app.seeds import import_products_csv as cli


SAMPLE_CSV = """name,price,category,subcategory,description,ingredients,cost
House Salad,6.50,Starters,Salads,Fresh greens,lettuce tomato,2.00
Espresso,2.20,Beverages,Hot Drinks,Single shot,coffee,0.40
"""

INVALID_CSV = """name,price,category
,5.00,Starters
Valid Dish,0,Main Course
Another,4.50,Desserts
"""


class TestParseProductsCsv(unittest.TestCase):
    def test_happy_path(self):
        items = parse_products_csv(SAMPLE_CSV)
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0].name, "House Salad")
        self.assertEqual(items[0].price, 6.5)
        self.assertEqual(items[0].category, "Starters")
        self.assertEqual(items[1].name, "Espresso")

    def test_bom_and_case_insensitive_headers(self):
        text = "\ufeffName,Price,Category\nSoup,5.5,Starters\n"
        items = parse_products_csv(text)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].name, "Soup")
        self.assertEqual(items[0].price, 5.5)

    def test_price_cents_column(self):
        items = parse_products_csv("name,price_cents,category\nTea,250,Beverages\n")
        self.assertEqual(items[0].price_cents, 250)
        self.assertIsNone(items[0].price)

    def test_missing_name_column(self):
        with self.assertRaises(ValueError) as ctx:
            parse_products_csv("price,category\n5.0,Starters\n")
        self.assertIn("missing_name_column", str(ctx.exception))

    def test_unknown_column(self):
        with self.assertRaises(ValueError) as ctx:
            parse_products_csv("name,price,sku\nA,1.0,X\n")
        self.assertIn("unknown_csv_columns", str(ctx.exception))

    def test_empty_csv(self):
        with self.assertRaises(ValueError) as ctx:
            parse_products_csv("name,price\n")
        self.assertIn("empty_csv", str(ctx.exception))

    def test_comma_decimal(self):
        items = parse_products_csv('name,price\nCake,"6,50"\n')
        self.assertEqual(items[0].price, 6.5)

    def test_header_aliases_locale(self):
        text = "producto,precio,categoria\nGazpacho,4.5,Starters\n"
        items = parse_products_csv(text)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].name, "Gazpacho")
        self.assertEqual(items[0].price, 4.5)
        self.assertEqual(items[0].category, "Starters")

    def test_tsv_delimiter(self):
        text = "name\tprice\tcategory\nSoup\t5.5\tStarters\n"
        items = parse_products_csv(text)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].name, "Soup")
        self.assertEqual(items[0].price, 5.5)

    def test_explicit_header_map_drops_sku(self):
        text = "Dish,Retail Price,SKU\nTea,2.5,X1\n"
        items = parse_products_csv(
            text,
            header_map={"Dish": "name", "Retail Price": "price", "SKU": ""},
        )
        self.assertEqual(items[0].name, "Tea")
        self.assertEqual(items[0].price, 2.5)


class TestImportProductsCsvPipeline(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        tenant = models.Tenant(name="CSV Import Tenant")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        self.tenant_id = tenant.id

        self.owner = models.User(
            email="csv-import-owner@test.local",
            hashed_password=security.get_password_hash("secret"),
            full_name="Owner",
            tenant_id=self.tenant_id,
            role=models.UserRole.owner,
        )
        self.session.add(self.owner)
        self.session.commit()

    def test_preview_marks_invalid_without_writes(self):
        items = parse_products_csv(INVALID_CSV)
        preview = build_preview(self.session, self.tenant_id, items)
        self.assertEqual(preview.summary.total, 3)
        self.assertEqual(preview.summary.invalid, 2)
        self.assertEqual(preview.summary.valid, 1)
        self.assertEqual(preview.summary.create, 1)
        # No products persisted from preview
        from sqlmodel import select

        count = len(
            self.session.exec(
                select(models.Product).where(models.Product.tenant_id == self.tenant_id)
            ).all()
        )
        self.assertEqual(count, 0)

    def test_confirm_happy_path_and_idempotent_update(self):
        items = parse_products_csv(SAMPLE_CSV)
        preview = build_preview(self.session, self.tenant_id, items)
        self.assertEqual(preview.summary.invalid, 0)
        result = confirm_import(self.session, self.tenant_id, preview.items)
        self.assertEqual(result.created, 2)

        # Second pass: same names → update
        again = parse_products_csv(
            "name,price,category\nHouse Salad,7.00,Starters\nEspresso,2.20,Beverages\n"
        )
        preview2 = build_preview(self.session, self.tenant_id, again)
        self.assertEqual(preview2.summary.update, 2)
        result2 = confirm_import(self.session, self.tenant_id, preview2.items)
        self.assertEqual(result2.updated, 2)
        self.assertEqual(result2.created, 0)

        from sqlmodel import select

        salad = self.session.exec(
            select(models.Product).where(
                models.Product.tenant_id == self.tenant_id,
                models.Product.name == "House Salad",
            )
        ).first()
        self.assertIsNotNone(salad)
        self.assertEqual(salad.price_cents, 700)

    def test_cli_dry_run_and_apply(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "menu.csv"
            path.write_text(SAMPLE_CSV, encoding="utf-8")

            code = cli.run(
                tenant_id=self.tenant_id, csv_path=path, apply=False, session=self.session
            )
            self.assertEqual(code, 0)

            from sqlmodel import select

            before = len(
                self.session.exec(
                    select(models.Product).where(
                        models.Product.tenant_id == self.tenant_id
                    )
                ).all()
            )
            self.assertEqual(before, 0)

            code = cli.run(
                tenant_id=self.tenant_id, csv_path=path, apply=True, session=self.session
            )
            self.assertEqual(code, 0)
            self.session.expire_all()
            after = len(
                self.session.exec(
                    select(models.Product).where(
                        models.Product.tenant_id == self.tenant_id
                    )
                ).all()
            )
            self.assertEqual(after, 2)

    def test_cli_refuses_apply_on_invalid(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.csv"
            path.write_text(INVALID_CSV, encoding="utf-8")
            code = cli.run(
                tenant_id=self.tenant_id, csv_path=path, apply=True, session=self.session
            )
            self.assertEqual(code, 1)

            from sqlmodel import select

            self.session.expire_all()
            count = len(
                self.session.exec(
                    select(models.Product).where(
                        models.Product.tenant_id == self.tenant_id
                    )
                ).all()
            )
            self.assertEqual(count, 0)

    def test_cli_missing_tenant(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "menu.csv"
            path.write_text(SAMPLE_CSV, encoding="utf-8")
            code = cli.run(
                tenant_id=999999, csv_path=path, apply=False, session=self.session
            )
            self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
