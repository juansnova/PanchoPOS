"""POST /users/me/otp/disable uses account password (logged-in), not OTP code (#401)."""
from __future__ import annotations

import unittest
from datetime import timedelta

import pyotp
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


class TestOtpDisablePassword(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        tenant = models.Tenant(name="OTP disable tenant", address="1 Test St")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        self.tenant_id = tenant.id

        secret = pyotp.random_base32()
        self.password = "otp-owner-secret"
        self.user = models.User(
            email="otp-disable-owner@test.local",
            hashed_password=security.get_password_hash(self.password),
            full_name="OTP Owner",
            tenant_id=self.tenant_id,
            role=models.UserRole.owner,
            otp_secret=secret,
            otp_enabled=True,
        )
        self.session.add(self.user)
        self.session.commit()
        self.session.refresh(self.user)
        self.otp_secret = secret

    def test_disable_without_auth_rejected(self) -> None:
        r = self.client.post("/users/me/otp/disable", json={"password": self.password})
        self.assertIn(r.status_code, (401, 403), r.text)

    def test_disable_with_wrong_password_rejected(self) -> None:
        h = _bearer_headers(self.user)
        r = self.client.post(
            "/users/me/otp/disable",
            headers=h,
            json={"password": "wrong-password"},
        )
        self.assertEqual(r.status_code, 400, r.text)
        d = r.json()["detail"]
        msg = (d.get("message") if isinstance(d, dict) else str(d)).lower()
        self.assertIn("incorrect", msg, r.text)
        self.session.refresh(self.user)
        self.assertTrue(self.user.otp_enabled)
        self.assertEqual(self.user.otp_secret, self.otp_secret)

    def test_disable_with_otp_code_body_rejected(self) -> None:
        """Old clients sending {code} must not disable without password."""
        h = _bearer_headers(self.user)
        code = pyotp.TOTP(self.otp_secret).now()
        r = self.client.post(
            "/users/me/otp/disable",
            headers=h,
            json={"code": code},
        )
        self.assertEqual(r.status_code, 422, r.text)
        self.session.refresh(self.user)
        self.assertTrue(self.user.otp_enabled)

    def test_disable_with_correct_password_ok(self) -> None:
        h = _bearer_headers(self.user)
        r = self.client.post(
            "/users/me/otp/disable",
            headers=h,
            json={"password": self.password},
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body.get("status"), "ok")
        self.assertFalse(body.get("otp_enabled"))
        self.session.refresh(self.user)
        self.assertFalse(self.user.otp_enabled)
        self.assertIsNone(self.user.otp_secret)


if __name__ == "__main__":
    unittest.main()
