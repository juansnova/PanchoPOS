"""Encrypted JSON blobs for delivery integration API credentials (server-side only)."""

from __future__ import annotations

import base64
import hashlib
import json

from cryptography.fernet import Fernet, InvalidToken

from app.settings import settings


def _delivery_fernet() -> Fernet:
    key = base64.urlsafe_b64encode(
        hashlib.sha256((settings.secret_key + ":delivery_integration_fernet_v1").encode()).digest()
    )
    return Fernet(key)


def encrypt_credentials_json(data: dict | None) -> str | None:
    if not data:
        return None
    raw = json.dumps(data, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return _delivery_fernet().encrypt(raw).decode("ascii")


def decrypt_credentials_json(stored: str | None) -> dict | None:
    if not stored or not stored.strip():
        return None
    try:
        plain = _delivery_fernet().decrypt(stored.strip().encode("ascii")).decode("utf-8")
        out = json.loads(plain)
        return out if isinstance(out, dict) else None
    except (InvalidToken, ValueError, UnicodeError, json.JSONDecodeError):
        return None
