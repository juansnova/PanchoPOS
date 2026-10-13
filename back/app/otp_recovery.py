"""Single-use OTP recovery codes (#400).

Plaintext codes are shown once to the user. Only SHA-256 hashes are stored.
Do not log full recovery codes.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone

from sqlmodel import Session, select

from . import models

# Unambiguous alphabet (no 0/O/1/I/L). Displayed as XXXX-XXXX.
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
RECOVERY_CODE_COUNT = 8
_CODE_BODY_LEN = 8


def normalize_recovery_code(raw: str) -> str:
    """Strip spaces/dashes and uppercase for compare/hash."""
    return "".join(c for c in (raw or "").upper() if c.isalnum())


def format_recovery_code(normalized: str) -> str:
    """Display form XXXX-XXXX from an 8-char normalized body."""
    body = normalize_recovery_code(normalized)
    if len(body) != _CODE_BODY_LEN:
        return body
    return f"{body[:4]}-{body[4:]}"


def hash_recovery_code(raw: str) -> str:
    norm = normalize_recovery_code(raw)
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    """Return ``count`` unique display codes (XXXX-XXXX)."""
    codes: list[str] = []
    seen: set[str] = set()
    while len(codes) < count:
        body = "".join(secrets.choice(_ALPHABET) for _ in range(_CODE_BODY_LEN))
        if body in seen:
            continue
        seen.add(body)
        codes.append(format_recovery_code(body))
    return codes


def looks_like_totp_code(raw: str) -> bool:
    """True when the input is a 6-digit authenticator code (not a recovery code)."""
    digits = "".join(c for c in (raw or "") if c.isdigit())
    stripped = (raw or "").strip()
    return len(digits) == 6 and digits == stripped.replace(" ", "")


def delete_recovery_codes_for_user(session: Session, user_id: int) -> None:
    rows = session.exec(
        select(models.UserOtpRecoveryCode).where(
            models.UserOtpRecoveryCode.user_id == user_id
        )
    ).all()
    for row in rows:
        session.delete(row)


def replace_recovery_codes(session: Session, user_id: int, plain_codes: list[str]) -> None:
    """Replace all recovery codes for a user with hashes of ``plain_codes``."""
    delete_recovery_codes_for_user(session, user_id)
    now = datetime.now(timezone.utc)
    for plain in plain_codes:
        session.add(
            models.UserOtpRecoveryCode(
                user_id=user_id,
                code_hash=hash_recovery_code(plain),
                used_at=None,
                created_at=now,
            )
        )


def unused_recovery_code_count(session: Session, user_id: int) -> int:
    rows = session.exec(
        select(models.UserOtpRecoveryCode).where(
            models.UserOtpRecoveryCode.user_id == user_id,
            models.UserOtpRecoveryCode.used_at.is_(None),
        )
    ).all()
    return len(rows)


def try_consume_recovery_code(session: Session, user_id: int, raw: str) -> bool:
    """If ``raw`` matches an unused code, mark it used and return True."""
    norm = normalize_recovery_code(raw)
    if len(norm) != _CODE_BODY_LEN:
        return False
    th = hash_recovery_code(norm)
    row = session.exec(
        select(models.UserOtpRecoveryCode).where(
            models.UserOtpRecoveryCode.user_id == user_id,
            models.UserOtpRecoveryCode.code_hash == th,
            models.UserOtpRecoveryCode.used_at.is_(None),
        )
    ).first()
    if not row:
        return False
    row.used_at = datetime.now(timezone.utc)
    session.add(row)
    return True
