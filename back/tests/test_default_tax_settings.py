"""Tenant default_tax_id save / clear (#371)."""

from __future__ import annotations

from datetime import date, timedelta

from pg_client_mixin import PgClientTestCase
from sqlmodel import select

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


class TestDefaultTaxSettings(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = models.Tenant(name="Tax Cafe", timezone="UTC")
        self.session.add(self.tenant)
        self.session.commit()
        self.session.refresh(self.tenant)

        pwd = security.get_password_hash("x")
        self.admin = models.User(
            username="tax-settings-admin@amvara.de",
            hashed_password=pwd,
            full_name="Admin",
            role=models.UserRole.owner,
            tenant_id=self.tenant.id,
        )
        self.session.add(self.admin)
        self.session.commit()
        self.session.refresh(self.admin)

        self.tax10 = models.Tax(
            tenant_id=self.tenant.id,
            name="IVA 10%",
            rate_percent=10,
            valid_from=date(2020, 1, 1),
        )
        self.tax0 = models.Tax(
            tenant_id=self.tenant.id,
            name="IVA 0%",
            rate_percent=0,
            valid_from=date(2020, 1, 1),
        )
        self.session.add(self.tax10)
        self.session.add(self.tax0)
        self.session.commit()
        self.session.refresh(self.tax10)
        self.session.refresh(self.tax0)

        self.tenant.default_tax_id = self.tax10.id
        self.session.add(self.tenant)
        self.session.commit()
        self.session.refresh(self.tenant)

    def test_put_changes_and_clears_default_tax_id(self) -> None:
        ah = _bearer_headers(self.admin)

        r = self.client.put(
            "/tenant/settings",
            headers=ah,
            json={"default_tax_id": self.tax0.id},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json().get("default_tax_id"), self.tax0.id)

        r2 = self.client.get("/tenant/settings", headers=ah)
        self.assertEqual(r2.status_code, 200, r2.text)
        self.assertEqual(r2.json().get("default_tax_id"), self.tax0.id)

        r3 = self.client.put(
            "/tenant/settings",
            headers=ah,
            json={"default_tax_id": None},
        )
        self.assertEqual(r3.status_code, 200, r3.text)
        self.assertIsNone(r3.json().get("default_tax_id"))

        tenant = self.session.exec(
            select(models.Tenant).where(models.Tenant.id == self.tenant.id)
        ).first()
        self.assertIsNotNone(tenant)
        self.assertIsNone(tenant.default_tax_id)

    def test_put_rejects_foreign_tax_id(self) -> None:
        other = models.Tenant(name="Other Tax Tenant")
        self.session.add(other)
        self.session.commit()
        self.session.refresh(other)
        foreign = models.Tax(
            tenant_id=other.id,
            name="Foreign IVA",
            rate_percent=21,
            valid_from=date(2020, 1, 1),
        )
        self.session.add(foreign)
        self.session.commit()
        self.session.refresh(foreign)

        ah = _bearer_headers(self.admin)
        r = self.client.put(
            "/tenant/settings",
            headers=ah,
            json={"default_tax_id": foreign.id},
        )
        self.assertEqual(r.status_code, 400, r.text)
