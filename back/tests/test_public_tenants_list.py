"""
Test GET /public/tenants — unauthenticated tenant discovery (landing, picker).
"""
import unittest

from pg_client_mixin import PgClientTestCase

from app import models


class TestPublicTenantsList(PgClientTestCase):
    def setUp(self):
        super().setUp()
        tenant = models.Tenant(
            name="Public List Test",
            email="pos-public-list-test@amvara.de",
        )
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        self.tenant_id = tenant.id

    def test_list_public_tenants_returns_200_and_shape(self):
        response = self.client.get("/public/tenants")
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertIsInstance(data, list)
        self.assertGreaterEqual(len(data), 1)
        match = next((t for t in data if t["id"] == self.tenant_id), None)
        self.assertIsNotNone(match, "Created tenant must appear in list")
        self.assertEqual(match["name"], "Public List Test")
        self.assertEqual(match["email"], "pos-public-list-test@amvara.de")
        for key in (
            "id",
            "name",
            "logo_filename",
            "whatsapp",
            "take_away_table_token",
            "terms_of_service_url",
            "privacy_policy_url",
            "timezone",
            "reservation_max_guests_per_slot",
            "website",
        ):
            self.assertIn(key, match, f"TenantSummary must include {key!r}")


if __name__ == "__main__":
    unittest.main()
