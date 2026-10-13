"""OTP recovery codes: generate on enable, login consume once (#400)."""
from __future__ import annotations

import unittest
from datetime import timedelta

import pyotp
from pg_client_mixin import PgClientTestCase

from app import models, otp_recovery, security


def _bearer_headers(user: models.User) -> dict[str, str]:
    data = {
        "sub": user.email,
        "tenant_id": user.tenant_id,
        "provider_id": getattr(user, "provider_id", None),
        "token_version": user.token_version,
    }
    token = security.create_access_token(data, expires_delta=timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


class TestOtpRecoveryCodes(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        tenant = models.Tenant(name="OTP recovery tenant", address="1 Test St")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        self.tenant_id = tenant.id

        self.password = "otp-recovery-secret"
        self.user = models.User(
            email="otp-recovery-owner@test.local",
            hashed_password=security.get_password_hash(self.password),
            full_name="OTP Recovery Owner",
            tenant_id=self.tenant_id,
            role=models.UserRole.owner,
            otp_secret=None,
            otp_enabled=False,
        )
        self.session.add(self.user)
        self.session.commit()
        self.session.refresh(self.user)

    def _enable_otp_with_codes(self) -> list[str]:
        h = _bearer_headers(self.user)
        r = self.client.post("/users/me/otp/setup", headers=h)
        self.assertEqual(r.status_code, 200, r.text)
        self.session.refresh(self.user)
        code = pyotp.TOTP(self.user.otp_secret).now()
        r = self.client.post("/users/me/otp/confirm", headers=h, json={"code": code})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body.get("otp_enabled"))
        codes = body.get("recovery_codes") or []
        self.assertEqual(len(codes), otp_recovery.RECOVERY_CODE_COUNT)
        return codes

    def test_confirm_returns_recovery_codes_and_status_count(self) -> None:
        codes = self._enable_otp_with_codes()
        self.assertTrue(all("-" in c for c in codes))
        h = _bearer_headers(self.user)
        r = self.client.get("/users/me/otp/status", headers=h)
        self.assertEqual(r.status_code, 200, r.text)
        st = r.json()
        self.assertTrue(st.get("otp_enabled"))
        self.assertEqual(st.get("recovery_codes_remaining"), len(codes))

    def test_login_with_recovery_code_then_reuse_fails(self) -> None:
        codes = self._enable_otp_with_codes()
        recovery = codes[0]

        r = self.client.post(
            "/token",
            data={
                "username": self.user.email,
                "password": self.password,
                "scope": "tenant",
            },
        )
        self.assertEqual(r.status_code, 403, r.text)
        body = r.json()
        self.assertTrue(body.get("require_otp"))
        temp = body["temp_token"]

        r = self.client.post(
            "/token/otp",
            json={"temp_token": temp, "code": recovery},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json().get("status"), "success")

        # Same code cannot be reused
        r = self.client.post(
            "/token",
            data={
                "username": self.user.email,
                "password": self.password,
                "scope": "tenant",
            },
        )
        self.assertEqual(r.status_code, 403, r.text)
        temp2 = r.json()["temp_token"]
        r = self.client.post(
            "/token/otp",
            json={"temp_token": temp2, "code": recovery},
        )
        self.assertEqual(r.status_code, 401, r.text)

        h = _bearer_headers(self.user)
        st = self.client.get("/users/me/otp/status", headers=h).json()
        self.assertEqual(st.get("recovery_codes_remaining"), len(codes) - 1)

    def test_totp_login_still_works(self) -> None:
        self._enable_otp_with_codes()
        self.session.refresh(self.user)
        r = self.client.post(
            "/token",
            data={
                "username": self.user.email,
                "password": self.password,
                "scope": "tenant",
            },
        )
        self.assertEqual(r.status_code, 403, r.text)
        temp = r.json()["temp_token"]
        totp_code = pyotp.TOTP(self.user.otp_secret).now()
        r = self.client.post(
            "/token/otp",
            json={"temp_token": temp, "code": totp_code},
        )
        self.assertEqual(r.status_code, 200, r.text)

    def test_regenerate_requires_password_and_replaces(self) -> None:
        old_codes = self._enable_otp_with_codes()
        h = _bearer_headers(self.user)
        r = self.client.post(
            "/users/me/otp/recovery-codes/regenerate",
            headers=h,
            json={"password": "wrong"},
        )
        self.assertEqual(r.status_code, 400, r.text)

        r = self.client.post(
            "/users/me/otp/recovery-codes/regenerate",
            headers=h,
            json={"password": self.password},
        )
        self.assertEqual(r.status_code, 200, r.text)
        new_codes = r.json().get("recovery_codes") or []
        self.assertEqual(len(new_codes), otp_recovery.RECOVERY_CODE_COUNT)
        self.assertNotEqual(set(old_codes), set(new_codes))

        # Old code no longer works
        r = self.client.post(
            "/token",
            data={
                "username": self.user.email,
                "password": self.password,
                "scope": "tenant",
            },
        )
        temp = r.json()["temp_token"]
        r = self.client.post(
            "/token/otp",
            json={"temp_token": temp, "code": old_codes[0]},
        )
        self.assertEqual(r.status_code, 401, r.text)

    def test_disable_clears_recovery_codes(self) -> None:
        self._enable_otp_with_codes()
        h = _bearer_headers(self.user)
        r = self.client.post(
            "/users/me/otp/disable",
            headers=h,
            json={"password": self.password},
        )
        self.assertEqual(r.status_code, 200, r.text)
        remaining = otp_recovery.unused_recovery_code_count(self.session, self.user.id)
        self.assertEqual(remaining, 0)


if __name__ == "__main__":
    unittest.main()
