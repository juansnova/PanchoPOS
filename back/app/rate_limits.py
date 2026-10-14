"""
Central SlowAPI rate limiter and key helpers.

Used by main.py and APIRouter modules so included routes get the same limits as top-level routes.
"""

from __future__ import annotations

import logging
import os

from fastapi import Request

from .settings import settings

logger = logging.getLogger(__name__)

try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded

    _SLOWAPI_AVAILABLE = True
except ImportError:
    _SLOWAPI_AVAILABLE = False
    Limiter = None  # type: ignore[misc, assignment]
    RateLimitExceeded = None  # type: ignore[misc, assignment]
    _rate_limit_exceeded_handler = None  # type: ignore[misc, assignment]


def rate_limit_redis_url() -> str:
    """Redis URL for optional custom rate-limit store and manual counters."""
    u = (settings.rate_limit_redis_url or os.getenv("REDIS_URL", "redis://localhost:6379")).strip()
    return u or "redis://localhost:6379"


def rate_limit_key(request: Request) -> str:
    """Client IP for rate limiting: X-Forwarded-For (first hop) when behind proxy, else client host."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def rate_limit_key_user(request: Request) -> str:
    """Per-user rate limit key when authenticated, else IP (for upload/admin limits)."""
    from . import security

    user_key = security.get_rate_limit_user_key(request)
    return user_key if user_key else rate_limit_key(request)


def rate_limit_key_payment_order(request: Request) -> str:
    """Per-order per-IP key for payment attempt limits (e.g. 3/hour per order)."""
    parts = request.url.path.rstrip("/").split("/")
    order_id = "0"
    for i, p in enumerate(parts):
        if p == "orders" and i + 1 < len(parts) and parts[i + 1].isdigit():
            order_id = parts[i + 1]
            break
    return f"po:{order_id}:{rate_limit_key(request)}"


def rate_limit_exceeded_handler_log(request: Request, exc: "RateLimitExceeded"):
    """Log rate limit violations then return 429 (for security monitoring)."""
    logger.warning(
        "Rate limit exceeded: path=%s method=%s client=%s",
        request.url.path,
        request.method,
        rate_limit_key(request),
    )
    if _rate_limit_exceeded_handler is None:
        raise exc
    return _rate_limit_exceeded_handler(request, exc)


class _NoOpLimiter:
    """No-op limiter when slowapi is not installed; allows same decorator pattern."""

    @staticmethod
    def limit(*args, **kwargs):
        def decorator(f):
            return f

        return decorator


if _SLOWAPI_AVAILABLE and Limiter is not None:
    _storage_uri = settings.rate_limit_redis_url or os.getenv("REDIS_URL", "redis://localhost:6379")
    _global_limit = f"{settings.rate_limit_global_per_minute}/minute"
    limiter = Limiter(
        key_func=rate_limit_key,
        default_limits=[_global_limit],
        storage_uri=_storage_uri,
        enabled=settings.rate_limit_enabled,
        headers_enabled=True,
        swallow_errors=True,
        in_memory_fallback_enabled=True,
        in_memory_fallback=[_global_limit],
    )
else:
    limiter = _NoOpLimiter()


def register_rate_limit_exception_handler(app) -> None:
    """Attach SlowAPI exception handler and app.state.limiter when SlowAPI is available."""
    if _SLOWAPI_AVAILABLE and RateLimitExceeded is not None:
        app.state.limiter = limiter
        app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler_log)


def admin_user_limit():
    """Authenticated admin/management routes (per-user key, falls back to IP)."""
    return limiter.limit(
        f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
        key_func=rate_limit_key_user,
    )


def public_menu_ip_limit():
    """Unauthenticated public endpoints (booking, menu discovery, etc.) — per IP."""
    return limiter.limit(
        f"{getattr(settings, 'rate_limit_public_menu_per_minute', 30)}/minute",
        key_func=rate_limit_key,
    )


# Backwards-compatible names for main.py decorators (same functions as historic module-level defs)
_rate_limit_key = rate_limit_key
_rate_limit_key_user = rate_limit_key_user
_rate_limit_key_payment_order = rate_limit_key_payment_order
