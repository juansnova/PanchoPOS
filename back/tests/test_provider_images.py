"""Tests for provider image URL helpers and orphan cleanup."""
from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from uuid import uuid4

from pg_client_mixin import PgClientTestCase

from app import models
from app import provider_images
from app.provider_images import (
    clear_orphan_provider_product_images,
    provider_product_image_url,
    provider_product_stored_image_path,
)


class TestProviderImageUrlHelpers(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.mkdtemp()
        self._uploads = Path(self._tmpdir)
        self._patcher = mock.patch.object(provider_images, "UPLOADS_DIR", self._uploads)
        self._patcher.start()
        self.token = "test-provider-token"
        self.products_dir = self._uploads / "providers" / self.token / "products"
        self.products_dir.mkdir(parents=True)

    def tearDown(self) -> None:
        self._patcher.stop()
        shutil.rmtree(self._tmpdir, ignore_errors=True)

    def test_url_none_when_filename_missing(self) -> None:
        self.assertIsNone(provider_product_image_url(self.token, None))
        self.assertIsNone(provider_product_image_url(self.token, ""))

    def test_url_none_when_file_absent(self) -> None:
        self.assertIsNone(provider_product_image_url(self.token, "missing.jpg"))

    def test_url_when_file_present(self) -> None:
        (self.products_dir / "ok.jpg").write_bytes(b"fake")
        self.assertEqual(
            provider_product_image_url(self.token, "ok.jpg"),
            f"/uploads/providers/{self.token}/products/ok.jpg",
        )

    def test_stored_path_none_when_absent(self) -> None:
        self.assertIsNone(provider_product_stored_image_path(self.token, "gone.jpg"))

    def test_rejects_path_traversal_filename(self) -> None:
        self.assertIsNone(provider_product_image_url(self.token, "../x.jpg"))
        self.assertIsNone(provider_product_stored_image_path(self.token, "a/b.jpg"))


class TestClearOrphanProviderProductImages(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        self._tmpdir = tempfile.mkdtemp()
        self._uploads = Path(self._tmpdir)
        self._patcher = mock.patch.object(provider_images, "UPLOADS_DIR", self._uploads)
        self._patcher.start()

        self.provider = models.Provider(
            name="Orphan Img Provider",
            token=f"orphan-{uuid4().hex[:12]}",
        )
        self.session.add(self.provider)
        self.session.commit()
        self.session.refresh(self.provider)

        self.catalog = models.ProductCatalog(
            name=f"Orphan Wine {uuid4().hex[:8]}",
            category="Bebidas",
            subcategory="Vinos",
        )
        self.session.add(self.catalog)
        self.session.commit()
        self.session.refresh(self.catalog)

        products_dir = (
            self._uploads / "providers" / self.provider.token / "products"
        )
        products_dir.mkdir(parents=True)
        (products_dir / "present.jpg").write_bytes(b"ok")

        self.pp_ok = models.ProviderProduct(
            provider_id=self.provider.id,
            catalog_id=self.catalog.id,
            external_id=f"ok-{uuid4().hex[:8]}",
            name="Has File",
            price_cents=1000,
            image_filename="present.jpg",
        )
        self.pp_orphan = models.ProviderProduct(
            provider_id=self.provider.id,
            catalog_id=self.catalog.id,
            external_id=f"orphan-{uuid4().hex[:8]}",
            name="Missing File",
            price_cents=1100,
            image_filename="absent.jpg",
        )
        self.session.add(self.pp_ok)
        self.session.add(self.pp_orphan)
        self.session.commit()
        self.session.refresh(self.pp_ok)
        self.session.refresh(self.pp_orphan)

    def tearDown(self) -> None:
        self._patcher.stop()
        shutil.rmtree(self._tmpdir, ignore_errors=True)
        super().tearDown()

    def test_clears_only_missing_files(self) -> None:
        stats = clear_orphan_provider_product_images(self.session)
        # Shared DB may have other ProviderProducts; under mocked UPLOADS_DIR they
        # look orphaned too. Assert our fixtures and that at least one clear ran.
        self.assertGreaterEqual(stats["provider_products_cleared"], 1)
        self.session.refresh(self.pp_ok)
        self.session.refresh(self.pp_orphan)
        self.assertEqual(self.pp_ok.image_filename, "present.jpg")
        self.assertIsNone(self.pp_orphan.image_filename)

        # Idempotent for our orphan row
        clear_orphan_provider_product_images(self.session)
        self.session.refresh(self.pp_orphan)
        self.assertIsNone(self.pp_orphan.image_filename)


if __name__ == "__main__":
    unittest.main()
