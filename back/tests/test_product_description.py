"""Product description: it can be set and cleared on update (it used to be silently ignored)."""
from __future__ import annotations

from datetime import timedelta

from pg_client_mixin import PgClientTestCase

from app import models, security


def _bearer_headers(user: models.User) -> dict[str, str]:
    data = {
        "sub": user.username,
        "tenant_id": user.tenant_id,
        "provider_id": getattr(user, "provider_id", None),
        "token_version": user.token_version,
    }
    token = security.create_access_token(data, expires_delta=timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


class TestProductDescription(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        tenant = models.Tenant(name="Desc test")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        self.owner = models.User(
            username="desc-owner@test.local",
            hashed_password=security.get_password_hash("secret"),
            full_name="Owner",
            tenant_id=tenant.id,
            role=models.UserRole.owner,
        )
        self.product = models.Product(name="Sopa", price_cents=6000, tenant_id=tenant.id)
        self.session.add_all([self.owner, self.product])
        self.session.commit()
        self.session.refresh(self.product)

    def _put(self, body: dict) -> dict:
        r = self.client.put(
            f"/products/{self.product.id}", json=body, headers=_bearer_headers(self.owner)
        )
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_description_is_saved_on_update(self) -> None:
        out = self._put({"description": "  Sopa de res con papa y yuca  "})
        self.assertEqual(out["description"], "Sopa de res con papa y yuca")

    def test_blank_description_clears_it(self) -> None:
        self._put({"description": "Sopa de res"})
        out = self._put({"description": "   "})
        self.assertIsNone(out["description"])

    def test_update_without_description_keeps_it(self) -> None:
        self._put({"description": "Sopa de res"})
        out = self._put({"name": "Sopa del día"})
        self.assertEqual(out["description"], "Sopa de res")
