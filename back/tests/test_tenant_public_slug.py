"""Tests for tenant public_slug (name-city) and public tenant resolve (#413)."""

from __future__ import annotations

import unittest

from pg_client_mixin import PgClientTestCase

from app import models
from app.tenant_public_slug import (
    allocate_unique_slug,
    build_name_city_base,
    ensure_tenant_public_slug,
    normalize_public_slug,
    resolve_tenant_by_ref,
    slugify_segment,
)


class TenantPublicSlugUnitTests(unittest.TestCase):
    def test_slugify_strips_accents(self):
        self.assertEqual(slugify_segment("Gustazó"), "gustazo")
        self.assertEqual(slugify_segment("  Bogota  "), "bogota")

    def test_build_name_city(self):
        self.assertEqual(build_name_city_base("Gustazo", "Bogota"), "gustazo-bogota")
        self.assertEqual(build_name_city_base("Demo Pizzeria", None), "demo-pizzeria")

    def test_normalize_public_slug(self):
        self.assertEqual(normalize_public_slug("Gustazo_Bogota"), "gustazo-bogota")
        self.assertIsNone(normalize_public_slug("!!!"))


class TenantPublicSlugApiTests(PgClientTestCase):
    def setUp(self):
        super().setUp()
        tenant = models.Tenant(
            name="Slug Cafe",
            city="Bogota",
            email="pos-slug-test@amvara.de",
        )
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        self.tenant = tenant

    def test_ensure_and_resolve(self):
        slug = ensure_tenant_public_slug(self.session, self.tenant)
        self.session.commit()
        self.assertEqual(slug, "slug-cafe-bogota")
        by_slug = resolve_tenant_by_ref(self.session, slug)
        self.assertIsNotNone(by_slug)
        assert by_slug is not None
        self.assertEqual(by_slug.id, self.tenant.id)
        by_id = resolve_tenant_by_ref(self.session, str(self.tenant.id))
        self.assertIsNotNone(by_id)
        assert by_id is not None
        self.assertEqual(by_id.id, self.tenant.id)

    def test_collision_suffix(self):
        ensure_tenant_public_slug(self.session, self.tenant)
        self.session.commit()
        other = models.Tenant(name="Slug Cafe", city="Bogota")
        self.session.add(other)
        self.session.commit()
        self.session.refresh(other)
        slug2 = ensure_tenant_public_slug(self.session, other)
        self.session.commit()
        self.assertEqual(slug2, "slug-cafe-bogota-2")

    def test_allocate_unique(self):
        ensure_tenant_public_slug(self.session, self.tenant)
        self.session.commit()
        taken = allocate_unique_slug(
            self.session, "slug-cafe-bogota", exclude_tenant_id=None
        )
        self.assertEqual(taken, "slug-cafe-bogota-2")

    def test_get_public_tenant_by_slug_and_id(self):
        ensure_tenant_public_slug(self.session, self.tenant)
        self.session.commit()
        slug = self.tenant.public_slug
        self.assertEqual(slug, "slug-cafe-bogota")

        by_id = self.client.get(f"/public/tenants/{self.tenant.id}")
        self.assertEqual(by_id.status_code, 200, by_id.text)
        data_id = by_id.json()
        self.assertEqual(data_id["public_slug"], slug)
        self.assertEqual(data_id["city"], "Bogota")

        by_slug = self.client.get(f"/public/tenants/{slug}")
        self.assertEqual(by_slug.status_code, 200, by_slug.text)
        data_slug = by_slug.json()
        self.assertEqual(data_slug["id"], self.tenant.id)
        self.assertEqual(data_slug["public_slug"], slug)

        menu = self.client.get(f"/public/tenants/{slug}/menu")
        self.assertEqual(menu.status_code, 200, menu.text)

    def test_list_includes_public_slug(self):
        ensure_tenant_public_slug(self.session, self.tenant)
        self.session.commit()
        response = self.client.get("/public/tenants")
        self.assertEqual(response.status_code, 200, response.text)
        match = next((t for t in response.json() if t["id"] == self.tenant.id), None)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match["public_slug"], "slug-cafe-bogota")
        self.assertEqual(match["city"], "Bogota")


if __name__ == "__main__":
    unittest.main()
