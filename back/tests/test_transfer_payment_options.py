"""Guest menu transfer options (Nequi / QR / Bre-B llave): informational only."""

from __future__ import annotations

import base64
from datetime import timedelta

from pg_client_mixin import PgClientTestCase

from app import models, security

# 1x1 white PNG
_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"
)


def _bearer_headers(user: models.User) -> dict[str, str]:
    data = {"sub": user.email, "tenant_id": user.tenant_id, "token_version": user.token_version}
    token = security.create_access_token(data, expires_delta=timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


class TestTransferPaymentOptions(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = models.Tenant(name="Transfer Options Cafe")
        self.session.add(self.tenant)
        self.session.commit()
        self.session.refresh(self.tenant)
        self.owner = models.User(
            email="transfer-owner@amvara.de",
            hashed_password=security.get_password_hash("x"),
            role=models.UserRole.owner,
            tenant_id=self.tenant.id,
        )
        self.waiter = models.User(
            email="transfer-waiter@amvara.de",
            hashed_password=security.get_password_hash("x"),
            role=models.UserRole.waiter,
            tenant_id=self.tenant.id,
        )
        floor = models.Floor(tenant_id=self.tenant.id, name="Main", sort_order=0)
        self.session.add_all([self.owner, self.waiter, floor])
        self.session.commit()
        self.session.refresh(self.owner)
        self.session.refresh(self.waiter)
        self.table = models.Table(tenant_id=self.tenant.id, floor_id=floor.id, name="T1", is_active=True)
        self.session.add(self.table)
        self.session.commit()
        self.session.refresh(self.table)

    def test_owner_sets_details_and_menu_shows_them(self) -> None:
        h = _bearer_headers(self.owner)
        r = self.client.put(
            "/tenant/settings",
            json={
                "payment_nequi_number": " 3001234567 ",
                "payment_llave": "@mi-restaurante",
                "payment_account_holder": "Mi Restaurante SAS",
            },
            headers=h,
        )
        self.assertEqual(r.status_code, 200, r.text)

        r = self.client.post(
            "/tenant/payment-qr", files={"file": ("qr.png", _PNG, "image/png")}, headers=h
        )
        self.assertEqual(r.status_code, 200, r.text)
        qr = r.json()["payment_qr_filename"]
        self.assertTrue(qr)
        r = self.client.get(f"/uploads/{self.tenant.id}/payment_qr/{qr}")
        self.assertEqual(r.status_code, 200)

        menu = self.client.get(f"/menu/{self.table.token}").json()
        self.assertEqual(menu["tenant_payment_nequi_number"], "3001234567")
        self.assertEqual(menu["tenant_payment_llave"], "@mi-restaurante")
        self.assertEqual(menu["tenant_payment_account_holder"], "Mi Restaurante SAS")
        self.assertEqual(menu["tenant_payment_qr_filename"], qr)
        self.assertNotIn("tenant_stripe_publishable_key", menu)

        # Empty string clears; QR delete works
        r = self.client.put("/tenant/settings", json={"payment_llave": ""}, headers=h)
        self.assertEqual(r.status_code, 200, r.text)
        r = self.client.delete("/tenant/payment-qr", headers=h)
        self.assertEqual(r.status_code, 200, r.text)
        menu = self.client.get(f"/menu/{self.table.token}").json()
        self.assertIsNone(menu["tenant_payment_llave"])
        self.assertIsNone(menu["tenant_payment_qr_filename"])
        self.assertEqual(menu["tenant_payment_nequi_number"], "3001234567")

    def test_waiter_cannot_change_payment_details(self) -> None:
        r = self.client.post(
            "/tenant/payment-qr",
            files={"file": ("qr.png", _PNG, "image/png")},
            headers=_bearer_headers(self.waiter),
        )
        self.assertEqual(r.status_code, 403, r.text)
