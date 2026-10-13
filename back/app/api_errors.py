"""Structured API error payloads for HTTPException(detail=...)."""

from __future__ import annotations

from typing import Any

from .messages import get_message


def api_error_payload(code: str, lang: str = "en", **kwargs: Any) -> dict[str, Any]:
    """
    Return JSON detail with stable `code` for client-side i18n and a localized `message`
    for non-browser clients and fallback when the SPA has no matching key.
    When the message uses placeholders, `params` is included for ngx-translate interpolation.
    """
    out: dict[str, Any] = {
        "code": code,
        "message": get_message(code, lang, **kwargs),
    }
    if kwargs:
        out["params"] = {k: v if isinstance(v, (str, int, float, bool)) else str(v) for k, v in kwargs.items()}
    return out
