import asyncio
import base64
from contextlib import asynccontextmanager
import hashlib
import hmac
import json
import logging
import math
import os
import re
import secrets
import time as _time
from calendar import monthrange
from datetime import date, timedelta, datetime, time, timezone

import requests
from zoneinfo import ZoneInfo
import csv
from io import BytesIO, StringIO
from pathlib import Path
from typing import Annotated, Any, Dict, List, Tuple
from urllib.parse import quote
from uuid import uuid4

from PIL import Image
import redis
from fastapi import BackgroundTasks, Body, Depends, FastAPI, HTTPException, UploadFile, File, status, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel as _BaseModel, Field
from sqlalchemy import event, exists, or_
from sqlalchemy.exc import IntegrityError, InvalidRequestError, OperationalError, StatementError
from sqlmodel import Session, select

from . import models, security
from . import otp_recovery
from .db import check_db_connection, create_db_and_tables, get_session, engine
from .provider_images import (
    provider_product_image_url,
    provider_product_stored_image_path,
    repair_product_image_filename,
)
from .settings import settings
from .inventory_routes import router as inventory_router
from .pricing_routes import router as pricing_router
from .product_bulk_import_routes import router as product_bulk_import_router
from .tenant_subcategory_routes import router as tenant_subcategory_router
from .reports_routes import router as reports_router
from .attendance_routes import router as attendance_router
from .tenant_lifecycle_routes import router as tenant_lifecycle_router
from .delivery_integration_routes import (
    router as delivery_integration_router,
    public_router as delivery_public_router,
)
from .print_routes import staff_router as print_staff_router, agent_router as print_agent_router
from .work_session_serialization import serialize_work_session, work_session_net_duration_minutes
from .clock_qr_util import (
    clock_qr_tokens_equal,
    decrypt_clock_qr_token_from_storage,
    encrypt_clock_qr_token_for_storage,
    generate_clock_qr_token,
    hash_clock_qr_token,
)
from .dian_invoice_service import (
    assert_dian_mode_allowed,
    cancel_dian_invoice,
    dian_invoice_public_dict,
    get_dian_invoice,
    issue_or_get_dian_invoice,
)
from .inventory_service import deduct_inventory_for_order
from . import inventory_models
from . import table_cart as table_cart_svc
from .messages import get_message
from .api_errors import api_error_payload

# Minimum advance booking for public (unauthenticated) reservations
RESERVATION_PUBLIC_MIN_LEAD_MINUTES = 10
from .permissions import Permission, require_permission, require_role, has_permission, can_manage_all_schedules
from . import email_service as email_svc
from .reservation_email_template import MAX_BODY_LEN, MAX_SUBJECT_LEN
from . import whatsapp_service as whatsapp_svc
from .phone_utils import normalize_phone_to_e164
from .contact_validation import normalize_email_address, normalize_phone_e164, normalize_username
from . import promo_service as promo_svc
from . import order_payment_service as order_pay_svc
from .tenant_ui_modules import (
    merge_tenant_ui_modules_patch,
    new_tenant_ui_modules_stored,
    resolve_tenant_ui_modules,
)
from .line_modifiers import (
    line_modifiers_equal,
    validate_and_normalize_line_modifiers,
)
from .order_notes import normalize_order_note, order_notes_equal
from .kitchen_stations_util import (
    normalize_display_route,
    resolve_order_item_kds,
    validate_kitchen_station_belongs,
)
from .schedule_export_i18n import planned_vs_export_labels, schedule_export_labels
from .opening_hours_effective import (
    effective_weekly_json_preview,
    opening_service_windows_for_date as _opening_service_windows_for_date,
)

from .rate_limits import (
    _rate_limit_key,
    _rate_limit_key_payment_order,
    _rate_limit_key_user,
    limiter,
    public_menu_ip_limit,
    rate_limit_redis_url,
    register_rate_limit_exception_handler,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def _enforce_reservation_delay_notice_rate_limit(request: Request, reservation_id: int) -> None:
    """Limit delay-notice submissions per IP per reservation (rolling 1h window)."""
    if not settings.rate_limit_enabled:
        return
    limit = settings.rate_limit_reservation_delay_per_hour
    if limit <= 0:
        return
    key = f"rl:delay_notice:{reservation_id}:{_rate_limit_key(request)}"
    try:
        r = redis.Redis.from_url(
            rate_limit_redis_url(),
            decode_responses=True,
            socket_connect_timeout=1.0,
            socket_timeout=1.0,
        )
        n = r.incr(key)
        if n == 1:
            r.expire(key, 3600)
        if n > limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many delay notices. Please try again later.",
            )
    except HTTPException:
        raise
    except redis.RedisError as e:
        logger.warning("Reservation delay-notice rate limit Redis error (allowing request): %s", e)



def _get_requested_language(
    request: Request,
    lang: str | None = Query(None, description="Language code (e.g. en, es, zh-CN)"),
    accept_language_query: str | None = Query(
        None,
        alias="accept-language",
        description="Legacy: same format as Accept-Language, passed as a query param",
    ),
) -> str:
    """
    Determine the requested language: ?lang=, then HTTP Accept-Language, then ?accept-language=.
    Returns normalized language code or 'en' as fallback.
    """
    from .language_service import normalize_language_code

    def _first_supported_from_accept_language(value: str) -> str | None:
        for part in value.split(","):
            lang_part = part.strip().split(";")[0].strip()
            if not lang_part:
                continue
            normalized = normalize_language_code(lang_part)
            if normalized:
                return normalized
        return None

    if lang:
        normalized = normalize_language_code(lang)
        if normalized:
            return normalized

    header = request.headers.get("accept-language")
    if header:
        parsed = _first_supported_from_accept_language(header)
        if parsed:
            return parsed

    if accept_language_query:
        parsed = _first_supported_from_accept_language(accept_language_query)
        if parsed:
            return parsed

    return "en"


# Backend always serves the spec at /openapi.json (HAProxy strips /api before forwarding).
# When behind a proxy at ROOT_PATH=/api, Swagger UI must fetch the spec from /api/openapi.json
# so the browser request goes through HAProxy correctly; we pass that via swagger_ui_parameters.
_swagger_ui_params = {"faviconUrl": "/favicon.ico"}
if settings.root_path:
    _swagger_ui_params["url"] = f"{settings.root_path.rstrip('/')}/openapi.json"


@asynccontextmanager
async def _app_lifespan(app: FastAPI):
    logger.info("Starting application...")
    create_db_and_tables()
    try:
        from .migrate import MigrationRunner
        from pathlib import Path

        migrations_dir = Path(__file__).parent.parent / "migrations"
        runner = MigrationRunner(migrations_dir)
        db_version = runner.run_migrations()
        logger.info(f"Database schema version: {db_version}")
    except Exception as e:
        logger.warning(f"Migration check failed: {e}", exc_info=True)

    try:
        with Session(engine) as session:
            for tenant in session.exec(select(models.Tenant)).all():
                ensure_take_away_table(session, tenant.id)
    except Exception as e:
        logger.warning(f"Take Away table check failed: {e}", exc_info=True)

    from .reservation_reminder_heartbeat import reservation_reminder_heartbeat_loop

    stop_heartbeat = asyncio.Event()
    heartbeat_task = asyncio.create_task(
        reservation_reminder_heartbeat_loop(stop=stop_heartbeat)
    )
    app.state.reservation_reminder_stop = stop_heartbeat
    app.state.reservation_reminder_task = heartbeat_task
    logger.info("Reservation reminder heartbeat started (runs every 5 minutes)")

    from .order_auto_preparing import order_auto_preparing_loop

    stop_auto_prep = asyncio.Event()
    auto_prep_task = asyncio.create_task(order_auto_preparing_loop(stop=stop_auto_prep))
    app.state.auto_preparing_stop = stop_auto_prep
    app.state.auto_preparing_task = auto_prep_task
    logger.info("Order auto-preparing worker started (pending -> preparing after 30 seconds)")

    from .table_idle_close import IDLE_CLOSE_AFTER_MINUTES, table_idle_close_loop

    stop_idle_tables = asyncio.Event()
    idle_tables_task = asyncio.create_task(table_idle_close_loop(stop=stop_idle_tables))
    app.state.idle_tables_stop = stop_idle_tables
    app.state.idle_tables_task = idle_tables_task
    logger.info("Idle table worker started (closes tables with no order after %d minutes)", IDLE_CLOSE_AFTER_MINUTES)

    yield

    stop_it = getattr(app.state, "idle_tables_stop", None)
    task_it = getattr(app.state, "idle_tables_task", None)
    if stop_it:
        stop_it.set()
    if task_it and not task_it.done():
        task_it.cancel()
        try:
            await task_it
        except asyncio.CancelledError:
            pass

    stop_ap = getattr(app.state, "auto_preparing_stop", None)
    task_ap = getattr(app.state, "auto_preparing_task", None)
    if stop_ap:
        stop_ap.set()
    if task_ap and not task_ap.done():
        task_ap.cancel()
        try:
            await task_ap
        except asyncio.CancelledError:
            pass

    stop = getattr(app.state, "reservation_reminder_stop", None)
    task = getattr(app.state, "reservation_reminder_task", None)
    if stop:
        stop.set()
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    logger.info("Reservation reminder heartbeat stopped")


app = FastAPI(
    title="POS API",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    root_path=settings.root_path,
    swagger_ui_parameters=_swagger_ui_params,
    lifespan=_app_lifespan,
)

# Parse CORS origins from environment (comma-separated)
cors_origins_list = [
    origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()
]
# Add wildcard for public menu access if not already present
# if "*" not in cors_origins_list:
#     cors_origins_list.append("*")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """Baseline response headers; uploads (user-supplied SVG) are sandboxed so scripts cannot run."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/uploads/"):
        response.headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    return response


register_rate_limit_exception_handler(app)


def _is_connection_or_pool_operational_failure(exc: BaseException) -> bool:
    """True when the failure is DB connectivity / server crash (503), not bad SQL or constraints."""
    if isinstance(exc, OperationalError):
        return True
    if isinstance(exc, StatementError):
        orig = getattr(exc, "orig", None)
        if isinstance(orig, OperationalError):
            return True
        # Psycopg (and other drivers) sometimes surface as the wrapped orig only
        if orig is not None:
            tn = type(orig).__name__
            if tn == "OperationalError" or "OperationalError" in tn:
                return True
    return False


@app.exception_handler(OperationalError)
async def database_operational_error_handler(request: Request, exc: OperationalError):
    logger.error("Database operational error on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": "Database temporarily unavailable. Try again shortly."},
    )


@app.exception_handler(StatementError)
async def database_statement_error_handler(request: Request, exc: StatementError):
    if _is_connection_or_pool_operational_failure(exc):
        logger.error(
            "Database statement/connection error on %s %s: %s",
            request.method,
            request.url.path,
            exc,
        )
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": "Database temporarily unavailable. Try again shortly."},
        )
    raise exc


# Uploads directory for product images
UPLOADS_DIR = Path(__file__).parent.parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/avif"}
MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5MB (optimized after upload via optimize_image)

# Image optimization settings
MAX_IMAGE_WIDTH = 1920  # Maximum width in pixels
MAX_IMAGE_HEIGHT = 1920  # Maximum height in pixels
JPEG_QUALITY = 85  # JPEG quality (1-100, 85 is a good balance)
PNG_OPTIMIZE = True  # Enable PNG optimization
WEBP_QUALITY = 85  # WebP quality (1-100)
AVIF_QUALITY = 85  # AVIF quality (1-100)

# Static files directory for favicon and other assets
STATIC_DIR = Path(__file__).parent.parent
STATIC_DIR.mkdir(exist_ok=True)

# Serve tenant logos via explicit route so path resolution is reliable (StaticFiles 404 in some setups)
@app.get("/uploads/{tenant_id}/logo/{filename}", include_in_schema=False)
def serve_tenant_logo(tenant_id: int, filename: str):
    """Serve a tenant logo file. Filename must be a single path component (no slashes)."""
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=404, detail="Invalid filename")
    path = UPLOADS_DIR / str(tenant_id) / "logo" / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Logo not found")
    media_type = "image/svg+xml" if filename.lower().endswith(".svg") else None
    return FileResponse(path, media_type=media_type)


@app.get("/uploads/{tenant_id}/header/{filename}", include_in_schema=False)
def serve_tenant_header_background(tenant_id: int, filename: str):
    """Serve tenant header background image. Filename must be a single path component (no slashes)."""
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=404, detail="Invalid filename")
    path = UPLOADS_DIR / str(tenant_id) / "header" / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Header image not found")
    media_type = "image/svg+xml" if filename.lower().endswith(".svg") else None
    return FileResponse(path, media_type=media_type)


@app.get("/uploads/{tenant_id}/payment_qr/{filename}", include_in_schema=False)
def serve_tenant_payment_qr(tenant_id: int, filename: str):
    """Serve the tenant payment QR shown on the guest menu. Single path component only."""
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=404, detail="Invalid filename")
    path = UPLOADS_DIR / str(tenant_id) / "payment_qr" / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="QR image not found")
    return FileResponse(path)


# Serve provider product images via explicit route (StaticFiles often 404s on nested paths behind a proxy)
@app.get("/uploads/providers/{provider_token}/products/{filename}", include_in_schema=False)
def serve_provider_product_image(provider_token: str, filename: str):
    """Serve a provider product image. Filename must be a single path component (no slashes)."""
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=404, detail="Invalid filename")
    path = UPLOADS_DIR / "providers" / provider_token / "products" / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path)


# Serve tenant product images (StaticFiles often 404s on nested paths behind a proxy)
@app.get("/uploads/{tenant_id}/products/{filename}", include_in_schema=False)
def serve_tenant_product_image(tenant_id: int, filename: str):
    """Serve a tenant product image. Filename must be a single path component (no slashes)."""
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=404, detail="Invalid filename")
    path = UPLOADS_DIR / str(tenant_id) / "products" / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path)


@app.get("/uploads/{tenant_id}/contracts/{filename}", include_in_schema=False)
def deny_public_staff_contract_uploads(tenant_id: int, filename: str):
    """
    Staff contract PDFs must only be served via authenticated GET /staff-contracts/{id}/document.
    Without this route, the /uploads StaticFiles mount would expose uploads/{tenant_id}/contracts/*.
    """
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=404, detail="Invalid filename")
    raise HTTPException(
        status_code=403,
        detail="Staff contract files are not available at this URL",
    )


# Mount static files for serving images (fallback for any other uploads paths)
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# Register Inventory API router
app.include_router(inventory_router, prefix="/inventory", tags=["Inventory"])
app.include_router(pricing_router, prefix="/pricing", tags=["Pricing"])
app.include_router(
    product_bulk_import_router,
    prefix="/products/bulk-import",
    tags=["Products"],
)
app.include_router(
    tenant_subcategory_router,
    prefix="/tenant/subcategories",
    tags=["Products"],
)
# Reports (sales / revenue analysis)
app.include_router(reports_router, prefix="/reports", tags=["Reports"])
app.include_router(attendance_router, prefix="/reports", tags=["Reports"])
# Owner-only data export & tenant purge (GitHub #96)
app.include_router(tenant_lifecycle_router, prefix="/tenant", tags=["Tenant lifecycle"])
app.include_router(delivery_integration_router, prefix="/tenant", tags=["Delivery integrations"])
app.include_router(delivery_public_router, tags=["Delivery integrations"])
app.include_router(print_staff_router, tags=["Print jobs"])
app.include_router(print_agent_router, tags=["Print agent"])


# ============ IMAGE OPTIMIZATION ============


def get_file_size(file_path: Path) -> int | None:
    """Get file size in bytes. Returns None if file doesn't exist."""
    try:
        if file_path.exists():
            return file_path.stat().st_size
    except Exception:
        pass
    return None


def format_file_size(size_bytes: int | None) -> str:
    """Format file size in human-readable format."""
    if size_bytes is None:
        return "Unknown"
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"


def optimize_image(image_data: bytes, content_type: str) -> bytes:
    """
    Optimize image locally using Pillow.
    - Resizes if too large
    - Compresses JPEG/WebP with quality settings
    - Optimizes PNG files
    Returns optimized image data.
    """
    try:
        # Open image from bytes
        image = Image.open(BytesIO(image_data))
        original_format = image.format
        original_size = len(image_data)

        # Formats below that support an alpha channel must keep it; only the
        # JPEG output path needs transparency flattened first.
        target_is_jpeg = content_type == "image/jpeg" or original_format == "JPEG"
        target_keeps_alpha = (
            content_type in ("image/png", "image/webp", "image/avif")
            or original_format in ("PNG", "WEBP", "AVIF")
        )

        # Convert RGBA to RGB for JPEG (JPEG doesn't support transparency)
        if target_is_jpeg and image.mode in ("RGBA", "LA", "P"):
            # Create white background
            background = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode == "P":
                image = image.convert("RGBA")
            background.paste(
                image, mask=image.split()[-1] if image.mode == "RGBA" else None
            )
            image = background
        elif target_keeps_alpha and image.mode == "P":
            # Palette images may carry transparency info; expand it before saving
            # to a format that supports alpha, instead of losing it below.
            image = image.convert("RGBA")
        elif not target_keeps_alpha and image.mode not in ("RGB", "L"):
            # Bug fix: this used to run unconditionally for any non-RGB/L mode,
            # which flattened transparent PNG/WebP/AVIF uploads (e.g. logos)
            # onto a BLACK background via Pillow's default RGBA->RGB conversion.
            image = image.convert("RGB")

        # Resize if image is too large
        width, height = image.size
        if width > MAX_IMAGE_WIDTH or height > MAX_IMAGE_HEIGHT:
            # Calculate new dimensions maintaining aspect ratio
            ratio = min(MAX_IMAGE_WIDTH / width, MAX_IMAGE_HEIGHT / height)
            new_width = int(width * ratio)
            new_height = int(height * ratio)
            image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
            logger.info(f"Image resized: {width}x{height} -> {new_width}x{new_height}")

        # Save optimized image to bytes
        output = BytesIO()

        if content_type == "image/jpeg" or original_format == "JPEG":
            image.save(output, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        elif content_type == "image/webp" or original_format == "WEBP":
            image.save(output, format="WEBP", quality=WEBP_QUALITY, method=6)
        elif content_type == "image/png" or original_format == "PNG":
            # PNG optimization
            image.save(output, format="PNG", optimize=PNG_OPTIMIZE)
        elif content_type == "image/avif" or original_format == "AVIF":
            image.save(output, format="AVIF", quality=AVIF_QUALITY)
        else:
            # Default to JPEG
            image.save(output, format="JPEG", quality=JPEG_QUALITY, optimize=True)

        optimized_data = output.getvalue()
        optimized_size = len(optimized_data)
        reduction = ((original_size - optimized_size) / original_size) * 100

        logger.info(
            f"Image optimized: {original_size / 1024:.1f}KB -> "
            f"{optimized_size / 1024:.1f}KB ({reduction:.1f}% reduction)"
        )

        return optimized_data

    except Exception as e:
        logger.warning(f"Error optimizing image: {e}, using original image")
        return image_data


# Serve favicon for API docs (blue icon to distinguish from frontend)
@app.get("/favicon.ico", include_in_schema=False)
@app.head("/favicon.ico", include_in_schema=False)
async def favicon():
    from fastapi.responses import FileResponse, Response

    favicon_path = STATIC_DIR / "favicon.svg"
    if favicon_path.exists():
        response = FileResponse(
            str(favicon_path),
            media_type="image/svg+xml",
            headers={
                "Cache-Control": "public, max-age=3600",
                "X-Favicon-Source": "backend",
            },
        )
        return response
    raise HTTPException(status_code=404)


# Redis client for pub/sub
redis_client: redis.Redis | None = None


def get_redis() -> redis.Redis | None:
    global redis_client
    if redis_client is None:
        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        try:
            redis_client = redis.from_url(redis_url)
            redis_client.ping()
        except Exception:
            redis_client = None
    return redis_client


def publish_order_update(tenant_id: int, order_data: dict, table_id: int | None = None) -> None:
    """Publish order update to Redis for WebSocket bridge.
    
    Publishes to both:
    - orders:tenant:{tenant_id} - for restaurant owners (all tenant orders)
    - orders:table:{table_id} - for customers (table-specific orders, if table_id provided)
    """
    r = get_redis()
    if r:
        try:
            # Always publish to tenant channel for restaurant owners
            r.publish(f"orders:tenant:{tenant_id}", json.dumps(order_data))
            
            # Also publish to table channel if table_id is provided (for customers)
            if table_id is not None:
                r.publish(f"orders:table:{table_id}", json.dumps(order_data))
        except Exception:
            pass  # Fail silently if Redis unavailable


def publish_reservation_update(tenant_id: int, reservation_data: dict) -> None:
    """Publish reservation update to Redis for WebSocket bridge.
    Channel: reservations:tenant:{tenant_id} (for restaurant owners).
    """
    r = get_redis()
    if r:
        try:
            r.publish(f"reservations:tenant:{tenant_id}", json.dumps(reservation_data))
        except Exception:
            pass  # Fail silently if Redis unavailable


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/health/db")
def health_db(session: Session = Depends(get_session)) -> dict:
    """Check database connection and version."""
    try:
        check_db_connection()

        # Get database schema version
        try:
            from .migrate import MigrationRunner
            from pathlib import Path

            migrations_dir = Path(__file__).parent.parent / "migrations"
            runner = MigrationRunner(migrations_dir)
            db_version = runner.get_current_version(session)
        except Exception:
            db_version = None

        return {"status": "ok", "database": "connected", "schema_version": db_version}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Database error: {e}")


# ============ PUBLIC TENANTS (no auth) ============


class TenantSummary(_BaseModel):
    """Public tenant info for landing page / tenant picker / book page."""

    id: int
    name: str
    logo_filename: str | None = None
    header_background_filename: str | None = None
    description: str | None = None
    phone: str | None = None
    email: str | None = None
    whatsapp: str | None = None
    address: str | None = None
    city: str | None = None
    public_slug: str | None = None
    opening_hours: str | None = None
    public_background_color: str | None = None
    public_primary_color: str | None = None
    take_away_table_token: str | None = None  # Token for take-away/home ordering if a table is configured
    # Reservation rules (for book page and reservation view)
    reservation_prepayment_cents: int | None = None
    reservation_prepayment_text: str | None = None
    reservation_cancellation_policy: str | None = None
    reservation_arrival_tolerance_minutes: int | None = None
    reservation_dress_code: str | None = None
    public_google_review_url: str | None = None
    public_google_maps_url: str | None = None
    public_openstreetmap_url: str | None = None
    public_facebook_url: str | None = None
    public_instagram_url: str | None = None
    # Restaurant website (http(s) only; normalized)
    website: str | None = None
    # Effective legal links: tenant URL if set, else PUBLIC_* from server config
    terms_of_service_url: str | None = None
    privacy_policy_url: str | None = None
    # IANA timezone (e.g. Europe/Madrid) for public book page date/time UX
    timezone: str | None = None
    # Optional cap on guests per slot (for UI max party hint)
    reservation_max_guests_per_slot: int | None = None
    # Guest birthday capture (public book): show optional month/day + marketing consent when enabled
    guest_birthday_capture_enabled: bool = True
    guest_birthday_marketing_enabled: bool = False
    guest_birthday_consent_text: str | None = None


TAKE_AWAY_TABLE_NAMES = ("take away", "home ordering", "takeaway", "take-away")


def _is_take_away_table(table) -> bool:
    """True if table name indicates take-away/home ordering (shared by many orders; never auto-closed)."""
    if not table or not getattr(table, "name", None):
        return False
    return (table.name or "").strip().lower() in TAKE_AWAY_TABLE_NAMES


def ensure_take_away_table(session: Session, tenant_id: int) -> None:
    """Make sure every tenant has a 'Take Away' table, so Venta en barra always works out of the box."""
    tables = session.exec(select(models.Table).where(models.Table.tenant_id == tenant_id)).all()
    if any(_is_take_away_table(t) for t in tables):
        return

    floor = session.exec(
        select(models.Floor)
        .where(models.Floor.tenant_id == tenant_id)
        .order_by(models.Floor.sort_order)
    ).first()
    if not floor:
        floor = models.Floor(name="Principal", tenant_id=tenant_id)
        session.add(floor)
        session.commit()
        session.refresh(floor)

    session.add(models.Table(name="Take Away", tenant_id=tenant_id, floor_id=floor.id))
    session.commit()


# Public Satisfecho Delivery checkout + track: signed token covers pay and track (24h)
PUBLIC_DELIVERY_ORDER_TOKEN_EXPIRY = 86400  # 24 hours


def _sign_public_delivery_order_token(order_id: int, tenant_id: int) -> str:
    """Signed token proving guest ownership of a public Satisfecho Delivery order for pay/track."""
    expiry = int(_time.time()) + PUBLIC_DELIVERY_ORDER_TOKEN_EXPIRY
    payload = f"sd:{order_id}:{tenant_id}:{expiry}"
    sig = hmac.new(
        settings.secret_key.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return (
        base64.urlsafe_b64encode(payload.encode("utf-8") + b"." + sig)
        .decode("ascii")
        .rstrip("=")
    )


def _verify_public_delivery_order_token(order_id: int, tenant_id: int, token: str) -> bool:
    if not token or order_id is None or tenant_id is None:
        return False
    try:
        padded = token + "=" * (4 - len(token) % 4) if len(token) % 4 else token
        raw = base64.urlsafe_b64decode(padded)
        # Payload is ASCII "sd:oid:tid:exp" (no dots). Split on the FIRST "." —
        # rpartition breaks when the HMAC digest contains 0x2e.
        payload_b, sep, sig_b = raw.partition(b".")
        if sep != b"." or not payload_b or not sig_b:
            return False
        payload = payload_b.decode("utf-8")
        prefix, oid_str, tid_str, exp_str = payload.split(":", 3)
        if prefix != "sd":
            return False
        if int(oid_str) != int(order_id) or int(tid_str) != int(tenant_id):
            return False
        if int(exp_str) < _time.time():
            return False
        expected = hmac.new(
            settings.secret_key.encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        return hmac.compare_digest(sig_b, expected)
    except Exception:
        return False


def _sync_order_inventory(session: Session, order: models.Order) -> None:
    """Put back (or deduct) inventory after an order line was cancelled, removed or changed."""
    try:
        session.refresh(order)
        tenant = session.get(models.Tenant, order.tenant_id)
        if tenant:
            deduct_inventory_for_order(session, order, tenant)
            session.commit()
    except Exception as e:
        session.rollback()
        logger.warning(f"Inventory sync warning for order #{getattr(order, 'id', None)}: {e}")


def _new_order_code() -> str:
    """Random 4-digit code (leading zeros allowed) guests enter to place an order."""
    return f"{secrets.randbelow(10_000):04d}"


def _table_requires_order_code(table) -> bool:
    """Dine-in tables need the code; the shared take-away counter has no waiter to hand one out."""
    return not _is_take_away_table(table)


def _ensure_table_order_code(session: Session, table) -> str:
    """Return the table's code, creating it if missing (e.g. table activated before this feature)."""
    if not table.order_code or len(table.order_code) != 4:  # also upgrades old 6-digit codes
        table.order_code = _new_order_code()
        session.add(table)
        session.commit()
        session.refresh(table)
    return table.order_code


def _take_away_table_token(session: Session, tenant_id: int) -> str | None:
    """Return token of the first active table named 'Take away' or 'Home ordering' (case-insensitive) for tenant."""
    tables = session.exec(
        select(models.Table).where(models.Table.tenant_id == tenant_id).where(models.Table.is_active == True)
    ).all()
    for t in tables:
        if _is_take_away_table(t):
            return t.token
    return None


def _config_public_http_url(raw: str | None) -> str | None:
    """Normalize optional legal URL from app settings (env)."""
    if not raw or not isinstance(raw, str):
        return None
    s = raw.replace("\x00", "").strip()
    return _normalize_public_http_url(s) if s else None


def _public_url_from_app_base(suffix: str) -> str | None:
    """If PUBLIC_APP_BASE_URL is a valid http(s) URL, return it joined with suffix (e.g. /terms)."""
    raw = settings.public_app_base_url
    if not raw or not isinstance(raw, str):
        return None
    base = _normalize_public_http_url(raw.replace("\x00", "").strip())
    if not base:
        return None
    path = suffix if suffix.startswith("/") else f"/{suffix}"
    return base.rstrip("/") + path


def _global_terms_url() -> str | None:
    explicit = _config_public_http_url(settings.public_terms_of_service_url)
    if explicit:
        return explicit
    return _public_url_from_app_base("/terms")


def _global_privacy_url() -> str | None:
    explicit = _config_public_http_url(settings.public_privacy_policy_url)
    if explicit:
        return explicit
    return _public_url_from_app_base("/privacy")


def _legal_urls_effective(tenant: models.Tenant) -> tuple[str | None, str | None]:
    g_tos = _global_terms_url()
    g_priv = _global_privacy_url()
    t_tos = _normalize_public_http_url(tenant.public_terms_of_service_url)
    t_priv = _normalize_public_http_url(tenant.public_privacy_policy_url)
    return (t_tos or g_tos, t_priv or g_priv)


def _tenant_to_summary(t: models.Tenant, session: Session) -> TenantSummary:
    take_away_token = _take_away_table_token(session, t.id)
    tos, priv = _legal_urls_effective(t)
    return TenantSummary(
        id=t.id,
        name=t.name,
        logo_filename=t.logo_filename,
        header_background_filename=t.header_background_filename,
        description=t.description,
        phone=t.phone,
        email=t.email,
        whatsapp=t.whatsapp,
        address=t.address,
        city=getattr(t, "city", None),
        public_slug=getattr(t, "public_slug", None),
        opening_hours=t.opening_hours,
        public_background_color=t.public_background_color,
        public_primary_color=getattr(t, "public_primary_color", None),
        take_away_table_token=take_away_token,
        reservation_prepayment_cents=t.reservation_prepayment_cents,
        reservation_prepayment_text=t.reservation_prepayment_text,
        reservation_cancellation_policy=t.reservation_cancellation_policy,
        reservation_arrival_tolerance_minutes=t.reservation_arrival_tolerance_minutes,
        reservation_dress_code=t.reservation_dress_code,
        public_google_review_url=t.public_google_review_url,
        public_google_maps_url=t.public_google_maps_url,
        public_openstreetmap_url=t.public_openstreetmap_url,
        public_facebook_url=t.public_facebook_url,
        public_instagram_url=t.public_instagram_url,
        website=_normalize_public_http_url(t.website),
        terms_of_service_url=tos,
        privacy_policy_url=priv,
        timezone=t.timezone,
        reservation_max_guests_per_slot=t.reservation_max_guests_per_slot,
        guest_birthday_capture_enabled=bool(
            getattr(t, "guest_birthday_capture_enabled", True)
        ),
        guest_birthday_marketing_enabled=bool(
            getattr(t, "guest_birthday_marketing_enabled", False)
        ),
        guest_birthday_consent_text=getattr(t, "guest_birthday_consent_text", None),
    )


def _normalize_public_http_url(raw: str | None) -> str | None:
    """Allow only http(s) URLs for public tenant links (review, maps); bounded length."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        return None
    s = raw.replace("\x00", "").strip()
    if not s:
        return None
    if len(s) > 2048:
        s = s[:2048]
    low = s.lower()
    if not (low.startswith("https://") or low.startswith("http://")):
        return None
    return s


@app.get("/public/tenants", response_model=list[TenantSummary])
@public_menu_ip_limit()
def list_public_tenants(
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> list:
    """List all tenants (id, name, logo, description, phone, email). Public, no authentication."""
    tenants = session.exec(select(models.Tenant).order_by(models.Tenant.name)).all()
    return [_tenant_to_summary(t, session) for t in tenants]


@app.get("/public/legal-urls")
@public_menu_ip_limit()
def get_public_legal_urls(
    request: Request,
    response: Response,
) -> dict[str, str | None]:
    """Product-wide terms and privacy URLs from server config (for landing/auth when no tenant context)."""
    return {
        "terms_of_service_url": _global_terms_url(),
        "privacy_policy_url": _global_privacy_url(),
    }


@app.get("/public/tenants/{tenant_ref}")
@public_menu_ip_limit()
def get_public_tenant(
    request: Request,
    response: Response,
    tenant_ref: str,
    session: Session = Depends(get_session),
    lang: str = Depends(_get_requested_language),
) -> JSONResponse:
    """Get one tenant's public info for book page (name, logo, phone, email, whatsapp, opening_hours). Public, no authentication.

    ``tenant_ref`` may be the numeric id or ``public_slug`` (name-city).
    """
    from .tenant_public_slug import ensure_tenant_public_slug, resolve_tenant_by_ref

    tenant = resolve_tenant_by_ref(session, tenant_ref)
    if not tenant:
        raise HTTPException(status_code=404, detail=api_error_payload("tenant_not_found", lang))
    had_slug = (tenant.public_slug or "").strip()
    ensure_tenant_public_slug(session, tenant)
    if (tenant.public_slug or "").strip() != had_slug:
        session.commit()
    summary = _tenant_to_summary(tenant, session)
    # Return explicit JSON so whatsapp is always present (same tenant as /tenant/settings)
    body = {
        "id": summary.id,
        "name": summary.name,
        "logo_filename": summary.logo_filename,
        "header_background_filename": summary.header_background_filename,
        "description": summary.description,
        "phone": summary.phone,
        "email": summary.email,
        "whatsapp": summary.whatsapp,
        "address": summary.address,
        "city": summary.city,
        "public_slug": summary.public_slug,
        "opening_hours": summary.opening_hours,
        "public_background_color": summary.public_background_color,
        "public_primary_color": summary.public_primary_color,
        "take_away_table_token": summary.take_away_table_token,
        "reservation_prepayment_cents": summary.reservation_prepayment_cents,
        "reservation_prepayment_text": summary.reservation_prepayment_text,
        "reservation_cancellation_policy": summary.reservation_cancellation_policy,
        "reservation_arrival_tolerance_minutes": summary.reservation_arrival_tolerance_minutes,
        "reservation_dress_code": summary.reservation_dress_code,
        "public_google_review_url": summary.public_google_review_url,
        "public_google_maps_url": summary.public_google_maps_url,
        "public_openstreetmap_url": summary.public_openstreetmap_url,
        "public_facebook_url": summary.public_facebook_url,
        "public_instagram_url": summary.public_instagram_url,
        "website": summary.website,
        "terms_of_service_url": summary.terms_of_service_url,
        "privacy_policy_url": summary.privacy_policy_url,
        "timezone": summary.timezone,
        "reservation_max_guests_per_slot": summary.reservation_max_guests_per_slot,
        "guest_birthday_capture_enabled": summary.guest_birthday_capture_enabled,
        "guest_birthday_marketing_enabled": summary.guest_birthday_marketing_enabled,
        "guest_birthday_consent_text": summary.guest_birthday_consent_text,
    }
    return JSONResponse(content=body)


@app.get(
    "/public/tenants/{tenant_ref}/menu",
    summary="Public tenant menu for marketing websites",
    tags=["Public"],
)
@public_menu_ip_limit()
def get_public_tenant_menu(
    request: Request,
    response: Response,
    tenant_ref: str,
    session: Session = Depends(get_session),
    lang: str = Depends(_get_requested_language),
) -> dict:
    """
    Read-only grouped menu for a tenant (no auth).

    Used by external marketing sites. Reuses product visibility rules from
    ``GET /menu/{table_token}`` (active catalog items, availability window).
    ``tenant_ref`` may be numeric id or ``public_slug``.
    """
    from .public_tenant_menu import build_public_tenant_menu
    from .tenant_public_slug import resolve_tenant_by_ref

    tenant = resolve_tenant_by_ref(session, tenant_ref)
    if tenant is None or tenant.id is None:
        raise HTTPException(status_code=404, detail=api_error_payload("tenant_not_found", lang))
    body = build_public_tenant_menu(session, tenant.id, lang)
    if body is None:
        raise HTTPException(status_code=404, detail=api_error_payload("tenant_not_found", lang))
    return body


@app.get(
    "/public/tenants/{tenant_id}/satisfecho-delivery-config",
    summary="Public Satisfecho Delivery fee and coverage config",
    tags=["Public"],
)
@public_menu_ip_limit()
def get_public_satisfecho_delivery_config(
    request: Request,
    response: Response,
    tenant_id: int,
    session: Session = Depends(get_session),
) -> dict:
    """Unauthenticated: fee + coverage hints for public checkout (no secrets)."""
    tenant = session.get(models.Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    from app.delivery_order_service import (
        parse_delivery_postal_codes,
        tenant_delivery_fee_cents,
    )

    postal = parse_delivery_postal_codes(getattr(tenant, "delivery_postal_codes", None))
    radius = getattr(tenant, "delivery_radius_meters", None)
    has_center = tenant.latitude is not None and tenant.longitude is not None
    radius_active = (
        radius is not None and int(radius) > 0 and has_center
    )
    return {
        "delivery_fee_cents": tenant_delivery_fee_cents(tenant),
        "delivery_radius_meters": int(radius) if radius_active else None,
        "postal_codes_required": bool(postal),
        "postal_codes": postal if postal else [],
        "restaurant_latitude": float(tenant.latitude) if radius_active else None,
        "restaurant_longitude": float(tenant.longitude) if radius_active else None,
        "currency_code": "COP",
        "currency": "$",
    }


@app.get(
    "/public/orders/{order_id}/delivery-status",
    summary="Public Satisfecho Delivery order track status",
    tags=["Public"],
)
@public_menu_ip_limit()
def get_public_delivery_order_status(
    request: Request,
    response: Response,
    order_id: int,
    public_order_token: str,
    session: Session = Depends(get_session),
) -> dict:
    """Token-gated coarse live status for customer track page (no maps)."""
    order = session.exec(
        select(models.Order).where(models.Order.id == order_id)
    ).first()
    if (
        not order
        or order.deleted_at is not None
        or _order_channel_value(order) != models.OrderChannel.satisfecho_delivery.value
        or order.table_id is not None
    ):
        raise HTTPException(status_code=404, detail="Order not found")
    if not _verify_public_delivery_order_token(
        order.id, order.tenant_id, (public_order_token or "").strip()
    ):
        raise HTTPException(status_code=404, detail="Order not found")

    items = session.exec(
        select(models.OrderItem).where(models.OrderItem.order_id == order.id)
    ).all()
    from app.delivery_order_service import (
        customer_delivery_track_status,
        order_delivery_fee_cents,
    )

    active_items = [
        i for i in items if not i.removed_by_customer and i.removed_by_user_id is None
    ]
    subtotal = sum((item.price_cents or 0) * item.quantity for item in active_items)
    fee = order_delivery_fee_cents(order)
    tenant = session.get(models.Tenant, order.tenant_id)
    return {
        "order_id": order.id,
        "tenant_id": order.tenant_id,
        "tenant_name": tenant.name if tenant else None,
        "status": customer_delivery_track_status(order, list(items)),
        "order_status": order.status.value if hasattr(order.status, "value") else str(order.status),
        "paid": order.paid_at is not None,
        "delivery_address": order.delivery_address,
        "items": [
            {
                "product_name": i.product_name,
                "quantity": i.quantity,
                "price_cents": i.price_cents,
            }
            for i in active_items
        ],
        "subtotal_cents": subtotal,
        "delivery_fee_cents": fee,
        "total_cents": subtotal + fee,
        "currency_code": "COP",
        "currency": "$",
        "google_review_url": tenant.public_google_review_url if tenant else None,
        "google_maps_url": tenant.public_google_maps_url if tenant else None,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "updated_hint": order.paid_at.isoformat() if order.paid_at else (
            order.created_at.isoformat() if order.created_at else None
        ),
    }


@app.post(
    "/public/tenants/{tenant_id}/satisfecho-delivery",
    summary="Public Satisfecho Delivery checkout create",
    tags=["Public"],
)
@public_menu_ip_limit()
def create_public_satisfecho_delivery_order(
    request: Request,
    response: Response,
    tenant_id: int,
    body: models.PublicSatisfechoDeliveryOrderCreate,
    session: Session = Depends(get_session),
) -> dict:
    """
    Unauthenticated: create a Satisfecho Delivery order (no table) for guest checkout.
    Kitchen is notified only after successful payment (via public_order_token pay endpoints).
    """
    tenant = session.get(models.Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if not body.items:
        raise HTTPException(status_code=400, detail="Order must have at least one item")
    address = (body.delivery_address or "").strip()
    if not address:
        raise HTTPException(status_code=400, detail="delivery_address is required")
    raw_phone = (body.customer_phone or "").strip()
    if not raw_phone:
        raise HTTPException(status_code=400, detail="customer_phone is required")
    try:
        phone = normalize_phone_e164(raw_phone, settings.default_phone_country)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid customer_phone")

    from app.delivery_order_service import (
        create_satisfecho_delivery_order,
        order_delivery_fee_cents,
        tenant_delivery_fee_cents,
        validate_delivery_coverage,
    )

    coverage_err = validate_delivery_coverage(
        tenant,
        postal_code=body.postal_code,
        delivery_latitude=body.delivery_latitude,
        delivery_longitude=body.delivery_longitude,
    )
    if coverage_err == "postal_code_required":
        raise HTTPException(status_code=400, detail="postal_code is required for delivery")
    if coverage_err == "outside_delivery_zone":
        raise HTTPException(
            status_code=400, detail="Address is outside the delivery zone"
        )
    if coverage_err == "delivery_location_required":
        raise HTTPException(
            status_code=400,
            detail="Delivery location is required to check delivery radius",
        )
    if coverage_err == "delivery_location_invalid":
        raise HTTPException(status_code=400, detail="Invalid delivery location")
    if coverage_err == "outside_delivery_radius":
        raise HTTPException(
            status_code=400, detail="Address is outside the delivery radius"
        )
    if coverage_err:
        raise HTTPException(status_code=400, detail=str(coverage_err))

    lines = [
        {"product_id": it.product_id, "quantity": it.quantity, "notes": it.notes}
        for it in body.items
    ]
    fee = tenant_delivery_fee_cents(tenant)
    # Payment is cash/transfer at delivery (courier confirms it there), so notify the kitchen
    # right away.
    order, outcome = create_satisfecho_delivery_order(
        session,
        tenant_id=tenant_id,
        lines=lines,
        delivery_address=address,
        customer_phone=phone,
        customer_name=body.customer_name,
        notes=body.notes,
        courier_user_id=None,
        notify_kitchen=True,
        delivery_fee_cents=fee,
    )
    if not order:
        detail = outcome.get("detail", "create_failed")
        if detail == "delivery_address_required":
            raise HTTPException(status_code=400, detail="delivery_address is required")
        if detail == "no_lines":
            raise HTTPException(status_code=400, detail="Order must have at least one item")
        if str(detail).startswith("product_not_found"):
            raise HTTPException(
                status_code=400, detail=f"Product not found: {detail.split(':', 1)[-1]}"
            )
        raise HTTPException(status_code=400, detail=str(detail))

    items = session.exec(
        select(models.OrderItem).where(models.OrderItem.order_id == order.id)
    ).all()
    subtotal_cents = sum((item.price_cents or 0) * item.quantity for item in items)
    delivery_fee = order_delivery_fee_cents(order)
    total_cents = subtotal_cents + delivery_fee

    return {
        "id": order.id,
        "status": order.status.value,
        "order_channel": _order_channel_value(order),
        "delivery_address": order.delivery_address,
        "customer_phone": order.customer_phone,
        "customer_name": order.customer_name,
        "notes": order.notes,
        "table_id": order.table_id,
        "subtotal_cents": subtotal_cents,
        "delivery_fee_cents": delivery_fee,
        "total_cents": total_cents,
        "public_order_token": _sign_public_delivery_order_token(order.id, tenant_id),
        "created_at": order.created_at.isoformat() if order.created_at else None,
    }


@app.get("/public/tenants/{tenant_id}/reservation-book-zones")
@public_menu_ip_limit()
def get_public_reservation_book_zones(
    request: Request,
    response: Response,
    tenant_id: int,
    session: Session = Depends(get_session),
    lang: str = Depends(_get_requested_language),
) -> dict:
    """Public: active floors/zones that have at least one table (for /book location selector)."""
    tenant = session.get(models.Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail=api_error_payload("tenant_not_found", lang))
    floors = _bookable_floors_for_public(session, tenant_id)
    return {
        "floors": [
            {
                "id": f.id,
                "name": f.name,
                "sort_order": f.sort_order,
                "seating_zone": _normalize_floor_seating_zone_value(getattr(f, "seating_zone", None)),
            }
            for f in floors
            if f.id is not None
        ]
    }


@app.get("/public/table-lookup")
@limiter.limit("60/hour", key_func=_rate_limit_key)  # bound remote table-name enumeration
@limiter.limit(
    f"{getattr(settings, 'rate_limit_public_menu_per_minute', 30)}/minute",
    key_func=_rate_limit_key,
)
def public_table_lookup(
    request: Request,
    response: Response,
    q: str = Query(
        ...,
        min_length=1,
        max_length=80,
        description="Menu URL token (from QR) or printed table name, e.g. T01",
    ),
    session: Session = Depends(get_session),
) -> dict:
    """Resolve printed table name or full token to the table's menu token (GitHub #38). Public, no auth."""
    from sqlalchemy import func

    raw = str(q).replace("\x00", "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Query required")

    by_token = session.exec(select(models.Table).where(models.Table.token == raw)).first()
    if by_token:
        return {"table_token": by_token.token, "ambiguous": False, "choices": []}

    key = raw.casefold()
    stmt = (
        select(models.Table, models.Tenant)
        .join(models.Tenant, models.Table.tenant_id == models.Tenant.id)
        .where(func.lower(func.trim(models.Table.name)) == key)
    )
    rows = list(session.exec(stmt).all())
    if not rows:
        raise HTTPException(status_code=404, detail="Table not found")
    if len(rows) == 1:
        table, _tenant = rows[0]
        return {"table_token": table.token, "ambiguous": False, "choices": []}

    choices = [
        {
            "table_token": table.token,
            "tenant_id": tenant.id,
            "tenant_name": tenant.name,
            "table_name": table.name,
        }
        for table, tenant in rows
    ]
    choices.sort(key=lambda c: (c["tenant_name"].casefold(), c["table_name"].casefold()))
    return {"table_token": None, "ambiguous": True, "choices": choices}


@app.post("/public/tenants/{tenant_id}/guest-feedback")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_guest_feedback_per_hour', 15)}/hour",
    key_func=_rate_limit_key,
)
def submit_public_guest_feedback(
    request: Request,
    response: Response,
    tenant_id: int,
    body: models.GuestFeedbackCreate,
    session: Session = Depends(get_session),
    lang: str = Depends(_get_requested_language),
) -> dict:
    """Anonymous guest feedback (rating + optional comment and contact). Optional reservation_token must match this tenant."""
    tenant = session.get(models.Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail=api_error_payload("tenant_not_found", lang))

    comment = None
    if body.comment is not None and str(body.comment).strip():
        comment = str(body.comment).replace("\x00", "").strip()[:4000]

    cname = None
    if body.contact_name is not None and str(body.contact_name).strip():
        cname = str(body.contact_name).replace("\x00", "").strip()[:200]

    cemail = None
    if body.contact_email is not None and str(body.contact_email).strip():
        try:
            cemail = normalize_email_address(body.contact_email)
        except ValueError:
            raise HTTPException(status_code=400, detail=api_error_payload("invalid_email", lang))

    cphone = None
    if body.contact_phone is not None and str(body.contact_phone).strip():
        try:
            cphone = normalize_phone_e164(body.contact_phone, settings.default_phone_country)
        except ValueError:
            raise HTTPException(status_code=400, detail=api_error_payload("invalid_phone", lang))

    reservation_id = None
    if body.reservation_token is not None and str(body.reservation_token).strip():
        tok = str(body.reservation_token).strip()[:128]
        res = session.exec(
            select(models.Reservation).where(
                models.Reservation.tenant_id == tenant_id,
                models.Reservation.token == tok,
            )
        ).first()
        if not res:
            raise HTTPException(status_code=400, detail=api_error_payload("invalid_reservation_token", lang))
        reservation_id = res.id

    client_ip = _client_ip_from_request(request)
    user_agent = (request.headers.get("user-agent") or "")[:512]

    row = models.GuestFeedback(
        tenant_id=tenant_id,
        rating=body.rating,
        comment=comment,
        contact_name=cname,
        contact_email=cemail,
        contact_phone=cphone,
        reservation_id=reservation_id,
        client_ip=client_ip,
        client_user_agent=user_agent or None,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return {"ok": True, "id": row.id}


@app.post("/public/tenants/{tenant_id}/waiting-list")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_waiting_list_per_hour', 10)}/hour",
    key_func=_rate_limit_key,
)
def submit_public_waiting_list(
    request: Request,
    response: Response,
    tenant_id: int,
    body: models.WaitingListEntryCreate,
    session: Session = Depends(get_session),
    lang: str = Depends(_get_requested_language),
) -> dict:
    """Public waiting-list signup: name, party size, phone (no login)."""
    tenant = session.get(models.Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail=api_error_payload("tenant_not_found", lang))

    name = str(body.customer_name or "").replace("\x00", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail=api_error_payload("customer_name_required", lang))
    if len(name) > 200:
        name = name[:200]

    try:
        phone_e164 = normalize_phone_e164(body.customer_phone, settings.default_phone_country)
    except ValueError:
        raise HTTPException(status_code=400, detail=api_error_payload("invalid_phone", lang))

    party_size = int(body.party_size)
    if party_size < 1 or party_size > 99:
        raise HTTPException(status_code=400, detail=api_error_payload("invalid_party_size", lang))

    client_ip = _client_ip_from_request(request)
    user_agent = (request.headers.get("user-agent") or "")[:512]
    now = datetime.now(timezone.utc)

    row = models.WaitingListEntry(
        tenant_id=tenant_id,
        customer_name=name,
        customer_phone=phone_e164,
        party_size=party_size,
        status=models.WaitingListStatus.waiting,
        client_ip=client_ip,
        client_user_agent=user_agent or None,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    out = _waiting_list_entry_to_dict(row, include_client_tech=False)
    publish_reservation_update(tenant_id, {"type": "waiting_list_update", "entry": out})
    return out


def _guest_feedback_to_dict(session: Session, gf: models.GuestFeedback) -> dict:
    out: dict = {
        "id": gf.id,
        "created_at": gf.created_at.isoformat() if gf.created_at else None,
        "rating": gf.rating,
        "comment": gf.comment,
        "contact_name": gf.contact_name,
        "contact_email": gf.contact_email,
        "contact_phone": gf.contact_phone,
        "reservation_id": gf.reservation_id,
        "client_ip": gf.client_ip,
        "client_user_agent": gf.client_user_agent,
    }
    if gf.reservation_id:
        r = session.get(models.Reservation, gf.reservation_id)
        if r and r.tenant_id == gf.tenant_id:
            out["reservation_date"] = str(r.reservation_date)
            out["reservation_time"] = str(r.reservation_time)
            out["reservation_customer_name"] = r.customer_name
    return out


def _waiting_list_entry_to_dict(
    entry: models.WaitingListEntry, include_client_tech: bool = False
) -> dict:
    out = {
        "id": entry.id,
        "tenant_id": entry.tenant_id,
        "customer_name": entry.customer_name,
        "customer_phone": entry.customer_phone,
        "party_size": entry.party_size,
        "status": entry.status.value,
        "notified_at": entry.notified_at.isoformat() if entry.notified_at else None,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
    }
    if include_client_tech:
        out["client_ip"] = entry.client_ip
        out["client_user_agent"] = entry.client_user_agent
    return out


@app.get("/tenant/guest-feedback")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def list_tenant_guest_feedback(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_READ))],
    session: Session = Depends(get_session),
    limit: int = Query(200, ge=1, le=500),
) -> list[dict]:
    """List guest feedback for the current tenant (newest first)."""
    rows = session.exec(
        select(models.GuestFeedback)
        .where(models.GuestFeedback.tenant_id == current_user.tenant_id)
        .order_by(models.GuestFeedback.created_at.desc())
        .limit(limit)
    ).all()
    return [_guest_feedback_to_dict(session, gf) for gf in rows]


def _guest_feedback_cutoff(days: int | None) -> datetime | None:
    """UTC lower bound for created_at when days is set; None means all time."""
    if days is None:
        return None
    return datetime.now(timezone.utc) - timedelta(days=int(days))


def _guest_feedback_rows_for_tenant(
    session: Session,
    tenant_id: int,
    *,
    days: int | None = None,
    limit: int | None = None,
) -> list[models.GuestFeedback]:
    q = select(models.GuestFeedback).where(models.GuestFeedback.tenant_id == tenant_id)
    cutoff = _guest_feedback_cutoff(days)
    if cutoff is not None:
        q = q.where(models.GuestFeedback.created_at >= cutoff)
    q = q.order_by(models.GuestFeedback.created_at.desc())
    if limit is not None:
        q = q.limit(limit)
    return list(session.exec(q).all())


def _guest_feedback_summary_payload(rows: list[models.GuestFeedback], days: int | None) -> dict:
    """Aggregate counts / averages / daily trend from in-memory rows (tenant-scoped)."""
    rating_counts = {str(i): 0 for i in range(1, 6)}
    total = len(rows)
    rating_sum = 0
    with_comment = 0
    with_contact = 0
    by_day_map: dict[str, list[int]] = {}

    for gf in rows:
        r = int(gf.rating)
        if 1 <= r <= 5:
            rating_counts[str(r)] = rating_counts.get(str(r), 0) + 1
            rating_sum += r
        if gf.comment and str(gf.comment).strip():
            with_comment += 1
        if gf.contact_name or gf.contact_email or gf.contact_phone:
            with_contact += 1
        if gf.created_at:
            day_key = gf.created_at.astimezone(timezone.utc).date().isoformat()
            by_day_map.setdefault(day_key, []).append(r)

    by_day = [
        {
            "date": day,
            "count": len(ratings),
            "average_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
        }
        for day, ratings in sorted(by_day_map.items())
    ]

    return {
        "days": days,
        "total_count": total,
        "average_rating": round(rating_sum / total, 2) if total else None,
        "rating_counts": rating_counts,
        "with_comment_count": with_comment,
        "with_contact_count": with_contact,
        "by_day": by_day,
    }


@app.get("/tenant/guest-feedback/summary")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def guest_feedback_summary(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_READ))],
    session: Session = Depends(get_session),
    days: int = Query(90, ge=1, le=730, description="Lookback window in days (UTC)"),
) -> dict:
    """Staff analytics: averages, star histogram, and daily counts for the lookback window."""
    if current_user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Tenant required")
    rows = _guest_feedback_rows_for_tenant(session, current_user.tenant_id, days=days)
    return _guest_feedback_summary_payload(rows, days)


@app.get("/tenant/guest-feedback/export")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def export_tenant_guest_feedback(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_READ))],
    session: Session = Depends(get_session),
    days: int | None = Query(
        None,
        ge=1,
        le=730,
        description="Optional lookback window in days (UTC). Omit for all rows (capped).",
    ),
    limit: int = Query(5000, ge=1, le=10000),
) -> StreamingResponse:
    """CSV export of guest feedback for the current tenant (UTF-8 BOM for Excel)."""
    if current_user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Tenant required")
    rows = _guest_feedback_rows_for_tenant(
        session, current_user.tenant_id, days=days, limit=limit
    )
    # Oldest first for readable exports
    rows = list(reversed(rows))

    keys = [
        "id",
        "created_at",
        "rating",
        "comment",
        "contact_name",
        "contact_email",
        "contact_phone",
        "reservation_id",
        "reservation_date",
        "reservation_time",
        "reservation_customer_name",
    ]
    header = [
        "id",
        "created_at",
        "rating",
        "comment",
        "contact_name",
        "contact_email",
        "contact_phone",
        "reservation_id",
        "reservation_date",
        "reservation_time",
        "reservation_customer_name",
    ]
    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    for gf in rows:
        d = _guest_feedback_to_dict(session, gf)
        writer.writerow([d.get(k) if d.get(k) is not None else "" for k in keys])

    payload = buf.getvalue().encode("utf-8-sig")
    fn = f"guest-feedback-{current_user.tenant_id}.csv"
    return StreamingResponse(
        iter([payload]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fn}"'},
    )


# ============ PRICE PROMOTIONS (#322) ============


@app.get("/promos")
def list_promos(
    current_user: Annotated[models.User, Depends(require_permission(Permission.PROMO_READ))],
    session: Session = Depends(get_session),
    include_disabled: bool = Query(default=True),
) -> list[dict]:
    q = select(models.PricePromotion).where(
        models.PricePromotion.tenant_id == current_user.tenant_id
    )
    if not include_disabled:
        q = q.where(models.PricePromotion.enabled == True)  # noqa: E712
    rows = session.exec(q.order_by(models.PricePromotion.id.desc())).all()
    return [promo_svc.promo_to_dict(p) for p in rows]


@app.post("/promos")
def create_promo(
    body: models.PricePromotionCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PROMO_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    promo = models.PricePromotion(
        tenant_id=current_user.tenant_id,
        name="",
        percent_off=1,
        category="",
    )
    promo_svc.validate_and_apply_body(promo, body, creating=True)
    session.add(promo)
    session.commit()
    session.refresh(promo)
    return promo_svc.promo_to_dict(promo)


@app.put("/promos/{promo_id}")
def update_promo(
    promo_id: int,
    body: models.PricePromotionUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PROMO_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    promo = session.get(models.PricePromotion, promo_id)
    if not promo or promo.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Promo not found")
    promo_svc.validate_and_apply_body(promo, body, creating=False)
    session.add(promo)
    session.commit()
    session.refresh(promo)
    return promo_svc.promo_to_dict(promo)


@app.delete("/promos/{promo_id}")
def delete_promo(
    promo_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PROMO_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    promo = session.get(models.PricePromotion, promo_id)
    if not promo or promo.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Promo not found")
    # Soft-disable so order_item.promo_id FK stays valid
    promo.enabled = False
    promo.updated_at = datetime.now(timezone.utc)
    session.add(promo)
    session.commit()
    return {"ok": True, "id": promo_id, "enabled": False}


# ============ AUTH ============


SINGLE_RESTAURANT_NAME = "Pancho Panza"


@app.post("/register")
@limiter.limit(f"{getattr(settings, 'rate_limit_register_per_hour', 3)}/hour")
def register(
    request: Request,
    tenant_name: str,
    username: str,
    password: str,
    full_name: str | None = None,
    address: str | None = None,
    phone: str | None = None,
    maps_url: str | None = None,
    lang: str = Depends(_get_requested_language),
    session: Session = Depends(get_session),
) -> JSONResponse:
    try:
        username = normalize_username(username)
    except ValueError:
        raise HTTPException(status_code=400, detail=api_error_payload("invalid_username", lang))
    existing_user = session.exec(
        select(models.User).where(models.User.username == username)
    ).first()
    if existing_user:
        raise HTTPException(
            status_code=400, detail=api_error_payload("username_already_registered", lang)
        )

    # Single-restaurant app (Pancho Panza): registration only works until the restaurant has an owner.
    tenant_count = session.exec(select(models.Tenant)).all()
    user_count = session.exec(select(models.User)).all()

    if len(user_count) > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is closed: this app serves a single restaurant.",
        )

    if len(tenant_count) == 1:
        tenant = tenant_count[0]
        tenant.name = SINGLE_RESTAURANT_NAME
    else:
        tenant = models.Tenant(
            name=SINGLE_RESTAURANT_NAME,
            ui_modules=new_tenant_ui_modules_stored(),
        )
        session.add(tenant)
        session.commit()
        session.refresh(tenant)

    if address and str(address).strip():
        tenant.address = str(address).strip()
    if phone and str(phone).strip():
        try:
            tenant.phone = normalize_phone_e164(phone, settings.default_phone_country)
        except ValueError:
            raise HTTPException(status_code=400, detail=api_error_payload("invalid_phone", lang))
    if maps_url and str(maps_url).strip():
        from .onboarding import assign_maps_url

        normalized_maps = _normalize_public_http_url(str(maps_url).strip())
        if normalized_maps:
            assign_maps_url(tenant, normalized_maps)
    session.add(tenant)
    session.commit()
    session.refresh(tenant)

    hashed_password = security.get_password_hash(password)
    user = models.User(
        username=username,
        hashed_password=hashed_password,
        full_name=full_name,
        tenant_id=tenant.id,
        role=models.UserRole.owner,  # First user of a tenant is always the owner
    )
    session.add(user)
    session.commit()

    ensure_take_away_table(session, tenant.id)

    # JSONResponse so slowapi can inject rate-limit headers (sync + headers_enabled)
    return JSONResponse(
        content={"status": "created", "tenant_id": tenant.id, "username": username},
        status_code=status.HTTP_201_CREATED,
    )


def _token_data_for_user(user: models.User) -> dict:
    """Build JWT payload for a tenant user."""
    return {
        "sub": user.username,
        "tenant_id": user.tenant_id,
        "token_version": user.token_version,
    }


@app.post("/token")
@limiter.limit(f"{getattr(settings, 'rate_limit_login_per_15min', 5)}/15 minutes")
def login_for_access_token(
    request: Request,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    tenant_id: int | None = Query(None, description="Optional tenant id from tenant picker"),
    scope: str | None = Query(None, description="Login scope: 'courier' for courier portal"),
    lang: str = Depends(_get_requested_language),
    session: Session = Depends(get_session),
) -> dict:
    statement = select(models.User).where(models.User.username == form_data.username.strip().lower())
    if scope == "courier":
        statement = statement.where(
            models.User.role == models.UserRole.courier,
            models.User.tenant_id.is_not(None),
        )
    elif tenant_id is not None:
        statement = statement.where(models.User.tenant_id == tenant_id)
    user = session.exec(statement).first()

    if not user or not security.verify_password(
        form_data.password, user.hashed_password
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=api_error_payload("incorrect_username_or_password", lang),
            headers={"WWW-Authenticate": "Bearer"},
        )

    # If OTP is enabled, require second factor; do not issue tokens yet
    if getattr(user, "otp_enabled", False) and getattr(user, "otp_secret", None):
        token_data = _token_data_for_user(user)
        temp_token = security.create_otp_pending_token(token_data)
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={
                "detail": api_error_payload("otp_required", lang),
                "require_otp": True,
                "temp_token": temp_token,
            },
        )

    token_data = _token_data_for_user(user)

    access_token = security.create_access_token(
        data=token_data,
        expires_delta=security.timedelta(minutes=settings.access_token_expire_minutes),
    )
    
    refresh_token = security.create_refresh_token(
        data=token_data,
        expires_delta=security.timedelta(days=settings.refresh_token_expire_days),
    )

    response = JSONResponse(content={"status": "success", "message": "Logged in"})
    
    # Set access token (short-lived, for all paths)
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=settings.is_production,  # Only enforce HTTPS in production
        samesite="lax",
        path="/",  # Ensure cookie is sent with all API requests
        max_age=settings.access_token_expire_minutes * 60,
    )
    
    # Set refresh token (long-lived)
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path="/",  # Send to all paths so it works with proxy prefixes like /api/refresh
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
    )
    
    return response


class OTPVerifyBody(_BaseModel):
    """Body for POST /token/otp: exchange temp token + OTP code for real tokens."""
    temp_token: str
    code: str


@app.post("/token/otp")
@limiter.limit(f"{getattr(settings, 'rate_limit_login_per_15min', 5)}/15 minutes")
def login_with_otp(
    request: Request,
    body: OTPVerifyBody,
    session: Session = Depends(get_session),
    lang: str = Depends(_get_requested_language),
) -> JSONResponse:
    """After password login returned require_otp, submit OTP code to get access and refresh tokens."""
    try:
        payload = security.decode_otp_pending_token(body.temp_token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=api_error_payload("otp_session_expired", lang),
        )
    username = payload.get("sub")
    tenant_id = payload.get("tenant_id")
    if not username or tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=api_error_payload("otp_token_invalid", lang),
        )
    statement = select(models.User).where(
        models.User.username == username, models.User.tenant_id == tenant_id
    )
    user = session.exec(statement).first()
    if not user or not getattr(user, "otp_secret", None) or not getattr(user, "otp_enabled", False):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=api_error_payload("otp_session_invalid", lang),
        )
    import pyotp

    code_ok = False
    raw_code = (body.code or "").strip()
    if otp_recovery.looks_like_totp_code(raw_code):
        totp = pyotp.TOTP(user.otp_secret)
        code_ok = bool(totp.verify(raw_code, valid_window=1))
    else:
        # Single-use recovery code (#400); mark consumed only on success path below.
        code_ok = otp_recovery.try_consume_recovery_code(session, user.id, raw_code)
        if code_ok:
            session.commit()
    if not code_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=api_error_payload("invalid_otp_code", lang),
        )
    token_data = _token_data_for_user(user)
    access_token = security.create_access_token(
        data=token_data,
        expires_delta=security.timedelta(minutes=settings.access_token_expire_minutes),
    )
    refresh_token = security.create_refresh_token(
        data=token_data,
        expires_delta=security.timedelta(days=settings.refresh_token_expire_days),
    )
    response = JSONResponse(content={"status": "success", "message": "Logged in"})
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path="/",
        max_age=settings.access_token_expire_minutes * 60,
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path="/",
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
    )
    return response


def _refresh_denylist_key(token: str) -> str:
    import hashlib

    return "revoked_refresh:" + hashlib.sha256(token.encode("utf-8")).hexdigest()


@app.post("/logout")
def logout(request: Request):
    # Revoke the refresh token server-side so a stolen cookie cannot mint new access tokens.
    refresh_cookie = request.cookies.get("refresh_token")
    if refresh_cookie:
        r = get_redis()
        if r:
            try:
                r.setex(
                    _refresh_denylist_key(refresh_cookie),
                    settings.refresh_token_expire_days * 86400,
                    "1",
                )
            except Exception:
                logger.warning("Could not record refresh token revocation")
    response = JSONResponse(content={"status": "success", "message": "Logged out"})
    # Clear both access and refresh tokens
    response.delete_cookie(key="access_token", path="/")
    response.delete_cookie(key="refresh_token", path="/")
    return response


@app.post("/refresh")
def refresh_access_token(
    request: Request,
    session: Session = Depends(get_session),
) -> JSONResponse:
    """
    Exchange a valid refresh token for a new access token.
    The refresh token remains valid until it expires or is revoked.
    """
    refresh_token = request.cookies.get("refresh_token")
    
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token provided",
        )
    
    r = get_redis()
    if r:
        try:
            if r.exists(_refresh_denylist_key(refresh_token)):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Refresh token revoked",
                )
        except HTTPException:
            raise
        except Exception:
            pass  # Redis unavailable: fail open rather than lock everyone out
    # Validate refresh token and get user
    user = security.validate_refresh_token(refresh_token, session)
    token_data = _token_data_for_user(user)
    
    access_token = security.create_access_token(
        data=token_data,
        expires_delta=security.timedelta(minutes=settings.access_token_expire_minutes),
    )
    
    response = JSONResponse(content={"status": "success", "message": "Token refreshed"})
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path="/",
        max_age=settings.access_token_expire_minutes * 60,
    )
    
    return response


@app.get("/ws-token")
def get_ws_token(
    request: Request,
    current_user: Annotated[models.User, Depends(security.get_current_user)],
) -> dict:
    """Return the current access token for WebSocket auth (query param). Cookie may not be sent on WS upgrade from some origins."""
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No access token")
    return {"access_token": token}


@app.get("/users/me", response_model=models.User | None, response_model_exclude={"hashed_password", "token_version"})
def read_users_me(
    current_user: Annotated[models.User | None, Depends(security.get_current_user_optional)],
) -> models.User | None:
    """Current user when a valid session cookie is present; **200 with JSON `null`** when anonymous (no 401 noise for SPA bootstrap)."""
    return current_user


# ============ USER OTP (optional two-factor) ============


@app.get("/users/me/otp/status")
def get_otp_status(
    current_user: Annotated[models.User, Depends(security.get_current_user)],
    session: Session = Depends(get_session),
) -> dict:
    """Return whether OTP is enabled and how many unused recovery codes remain (#400)."""
    enabled = getattr(current_user, "otp_enabled", False)
    remaining = 0
    if enabled and current_user.id is not None:
        remaining = otp_recovery.unused_recovery_code_count(session, current_user.id)
    return {
        "otp_enabled": enabled,
        "recovery_codes_remaining": remaining,
    }


class OTPConfirmBody(_BaseModel):
    code: str


class OTPDisableBody(_BaseModel):
    """Disable OTP for the authenticated user by re-entering the account password (#401)."""

    password: str = Field(..., min_length=1, max_length=256)


class OTPRecoveryRegenerateBody(_BaseModel):
    """Regenerate recovery codes; requires account password (#400)."""

    password: str = Field(..., min_length=1, max_length=256)


@app.post("/users/me/otp/setup")
def otp_setup(
    current_user: Annotated[models.User, Depends(security.get_current_user)],
    session: Session = Depends(get_session),
) -> dict:
    """Generate a new OTP secret and return provisioning URI and secret for QR. OTP is not enabled until confirm is called."""
    import pyotp
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    issuer = "POS"
    label = current_user.username or "user"
    provisioning_uri = totp.provisioning_uri(name=label, issuer_name=issuer)
    # Store secret but do not enable OTP until user confirms with a code
    user = session.get(models.User, current_user.id)
    if user and user.otp_enabled:
        # Re-enrolling would let a bare session replace the second factor; disabling needs the password.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OTP already enabled; disable it first")
    if user:
        user.otp_secret = secret
        user.otp_enabled = False
        otp_recovery.delete_recovery_codes_for_user(session, user.id)
        session.add(user)
        session.commit()
    return {"secret": secret, "provisioning_uri": provisioning_uri}


@app.post("/users/me/otp/confirm")
def otp_confirm(
    body: OTPConfirmBody,
    current_user: Annotated[models.User, Depends(security.get_current_user)],
    session: Session = Depends(get_session),
) -> dict:
    """Verify the OTP code, enable OTP, and return one-time recovery codes (#400)."""
    import pyotp
    user = session.get(models.User, current_user.id)
    if not user or not getattr(user, "otp_secret", None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Run setup first")
    totp = pyotp.TOTP(user.otp_secret)
    if not totp.verify(body.code, valid_window=1):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired code")
    plain_codes = otp_recovery.generate_recovery_codes()
    otp_recovery.replace_recovery_codes(session, user.id, plain_codes)
    user.otp_enabled = True
    session.add(user)
    session.commit()
    return {
        "status": "ok",
        "otp_enabled": True,
        "recovery_codes": plain_codes,
    }


@app.post("/users/me/otp/recovery-codes/regenerate")
def otp_regenerate_recovery_codes(
    body: OTPRecoveryRegenerateBody,
    current_user: Annotated[models.User, Depends(security.get_current_user)],
    session: Session = Depends(get_session),
    lang: str = Depends(_get_requested_language),
) -> dict:
    """Replace unused recovery codes after password re-entry. Plaintext returned once (#400)."""
    user = session.get(models.User, current_user.id)
    if not user or not getattr(user, "otp_enabled", False) or not getattr(user, "otp_secret", None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP is not enabled",
        )
    if not security.verify_password(body.password.strip(), user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=api_error_payload("incorrect_actor_password", lang),
        )
    plain_codes = otp_recovery.generate_recovery_codes()
    otp_recovery.replace_recovery_codes(session, user.id, plain_codes)
    session.commit()
    return {
        "status": "ok",
        "recovery_codes": plain_codes,
        "recovery_codes_remaining": len(plain_codes),
    }


@app.post("/users/me/otp/disable")
def otp_disable(
    body: OTPDisableBody,
    current_user: Annotated[models.User, Depends(security.get_current_user)],
    session: Session = Depends(get_session),
    lang: str = Depends(_get_requested_language),
) -> dict:
    """Disable OTP for the current user after password re-entry (logged-in session; #401).

    Does not require a working authenticator code so lost-device lockout does not block disable.
    Unauthenticated callers still cannot reach this endpoint (get_current_user).
    """
    user = session.get(models.User, current_user.id)
    if not user or not getattr(user, "otp_secret", None):
        return {"status": "ok", "otp_enabled": False}
    if not security.verify_password(body.password.strip(), user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=api_error_payload("incorrect_actor_password", lang),
        )
    otp_recovery.delete_recovery_codes_for_user(session, user.id)
    user.otp_secret = None
    user.otp_enabled = False
    session.add(user)
    session.commit()
    return {"status": "ok", "otp_enabled": False}


# ============ STAFF WORK SESSION (clock in / out) ============


class WorkSessionClockBody(_BaseModel):
    """Optional venue QR token and GPS for clock actions when the tenant requires them."""

    clock_qr: str | None = None
    latitude: float | None = None
    longitude: float | None = None


def _tenant_requires_clock_qr(tenant: models.Tenant) -> bool:
    return bool((tenant.clock_qr_token_hash or "").strip())


def _verify_clock_qr_token(tenant: models.Tenant, body: WorkSessionClockBody | None) -> None:
    if not _tenant_requires_clock_qr(tenant):
        return
    token = (body.clock_qr if body else None) or None
    if not clock_qr_tokens_equal(tenant.clock_qr_token_hash, token):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or missing venue QR token",
        )


def _verify_clock_location_if_required(
    tenant: models.Tenant,
    body: WorkSessionClockBody | None,
) -> None:
    if not tenant.clock_qr_location_verify:
        return
    if tenant.latitude is None or tenant.longitude is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Venue coordinates must be set in Settings to require GPS for clock actions",
        )
    lat = body.latitude if body else None
    lon = body.longitude if body else None
    if lat is None or lon is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Location permission required for clock at this venue",
        )
    distance = haversine_distance(
        float(tenant.latitude),
        float(tenant.longitude),
        float(lat),
        float(lon),
    )
    radius = float(tenant.location_radius_meters or 100)
    if distance > radius:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Clock action blocked: location is outside the venue radius",
        )


def _close_open_break_for_session(
    session: Session,
    ws: models.WorkSession,
    *,
    end_at: datetime,
) -> None:
    """End in-progress break row and clear break_started_at (e.g. before clock-out)."""
    if ws.break_started_at is None:
        return
    open_br = session.exec(
        select(models.WorkSessionBreak)
        .where(models.WorkSessionBreak.work_session_id == ws.id)
        .where(models.WorkSessionBreak.ended_at.is_(None))
    ).first()
    if open_br:
        open_br.ended_at = end_at
        session.add(open_br)
    ws.break_started_at = None
    session.add(ws)


def _require_tenant_staff_for_work_session(user: models.User) -> None:
    if user.tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Work sessions are only for restaurant staff accounts",
        )


@app.get("/users/me/clock-qr-status")
def get_my_clock_qr_status(
    current_user: Annotated[models.User, Depends(security.get_current_user)],
    session: Session = Depends(get_session),
) -> dict:
    """Whether venue QR / GPS is required for clock actions (no secrets exposed)."""
    _require_tenant_staff_for_work_session(current_user)
    assert current_user.tenant_id is not None
    tenant = session.get(models.Tenant, current_user.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {
        "clock_qr_required": _tenant_requires_clock_qr(tenant),
        "clock_qr_location_verify": bool(tenant.clock_qr_location_verify),
    }


@app.get("/users/me/work-session")
def get_my_open_work_session(
    current_user: Annotated[models.User, Depends(security.get_current_user)],
    session: Session = Depends(get_session),
) -> dict | None:
    """Current open clock-in for this user, or null if not on shift."""
    _require_tenant_staff_for_work_session(current_user)
    open_row = session.exec(
        select(models.WorkSession).where(
            models.WorkSession.user_id == current_user.id,
            models.WorkSession.ended_at.is_(None),
        )
    ).first()
    if not open_row:
        return None
    name = current_user.full_name or current_user.username or ""
    return serialize_work_session(open_row, name, session=session)


@app.post("/users/me/work-session/start")
def start_my_work_session(
    request: Request,
    current_user: Annotated[models.User, Depends(security.get_current_user)],
    session: Session = Depends(get_session),
    body: WorkSessionClockBody | None = Body(default=None),
) -> dict:
    """Clock in: start a work session. At most one open session per user."""
    _require_tenant_staff_for_work_session(current_user)
    assert current_user.tenant_id is not None
    payload = body or WorkSessionClockBody()
    tenant = session.get(models.Tenant, current_user.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    _verify_clock_qr_token(tenant, payload)
    _verify_clock_location_if_required(tenant, payload)

    existing = session.exec(
        select(models.WorkSession).where(
            models.WorkSession.user_id == current_user.id,
            models.WorkSession.ended_at.is_(None),
        )
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already clocked in; clock out first",
        )
    ip = _client_ip_from_request(request)
    ws = models.WorkSession(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        started_at=datetime.now(timezone.utc),
        start_ip=ip,
    )
    session.add(ws)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not start session (already clocked in?)",
        )
    session.refresh(ws)
    name = current_user.full_name or current_user.username or ""
    return serialize_work_session(ws, name, session=session)


@app.post("/users/me/work-session/end")
def end_my_work_session(
    request: Request,
    current_user: Annotated[models.User, Depends(security.get_current_user)],
    session: Session = Depends(get_session),
    body: WorkSessionClockBody | None = Body(default=None),
) -> dict:
    """Clock out: close the current open work session."""
    _require_tenant_staff_for_work_session(current_user)
    assert current_user.tenant_id is not None
    payload = body or WorkSessionClockBody()
    tenant = session.get(models.Tenant, current_user.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    _verify_clock_qr_token(tenant, payload)
    _verify_clock_location_if_required(tenant, payload)

    open_row = session.exec(
        select(models.WorkSession).where(
            models.WorkSession.user_id == current_user.id,
            models.WorkSession.ended_at.is_(None),
        )
    ).first()
    if not open_row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No open work session to end",
        )
    now = datetime.now(timezone.utc)
    _close_open_break_for_session(session, open_row, end_at=now)
    open_row.ended_at = now
    open_row.end_ip = _client_ip_from_request(request)
    session.add(open_row)
    session.commit()
    session.refresh(open_row)
    name = current_user.full_name or current_user.username or ""
    return serialize_work_session(open_row, name, session=session)


@app.post("/users/me/work-session/break/start")
def start_my_work_session_break(
    request: Request,
    current_user: Annotated[models.User, Depends(security.get_current_user)],
    session: Session = Depends(get_session),
) -> dict:
    """Start a break (pause work timer). No venue QR required."""
    _require_tenant_staff_for_work_session(current_user)
    open_row = session.exec(
        select(models.WorkSession).where(
            models.WorkSession.user_id == current_user.id,
            models.WorkSession.ended_at.is_(None),
        )
    ).first()
    if not open_row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No open work session to pause",
        )
    if open_row.break_started_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already on break",
        )
    now = datetime.now(timezone.utc)
    br = models.WorkSessionBreak(
        tenant_id=open_row.tenant_id,
        work_session_id=open_row.id,
        started_at=now,
        ended_at=None,
    )
    open_row.break_started_at = now
    session.add(br)
    session.add(open_row)
    session.commit()
    session.refresh(open_row)
    name = current_user.full_name or current_user.username or ""
    return serialize_work_session(open_row, name, session=session)


@app.post("/users/me/work-session/break/end")
def end_my_work_session_break(
    request: Request,
    current_user: Annotated[models.User, Depends(security.get_current_user)],
    session: Session = Depends(get_session),
    body: WorkSessionClockBody | None = Body(default=None),
) -> dict:
    """End break (resume work timer). Requires venue QR when the tenant has clock QR enabled."""
    _require_tenant_staff_for_work_session(current_user)
    assert current_user.tenant_id is not None
    payload = body or WorkSessionClockBody()
    tenant = session.get(models.Tenant, current_user.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    _verify_clock_qr_token(tenant, payload)
    _verify_clock_location_if_required(tenant, payload)

    open_row = session.exec(
        select(models.WorkSession).where(
            models.WorkSession.user_id == current_user.id,
            models.WorkSession.ended_at.is_(None),
        )
    ).first()
    if not open_row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No open work session",
        )
    if open_row.break_started_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not on break",
        )
    now = datetime.now(timezone.utc)
    open_br = session.exec(
        select(models.WorkSessionBreak)
        .where(models.WorkSessionBreak.work_session_id == open_row.id)
        .where(models.WorkSessionBreak.ended_at.is_(None))
    ).first()
    if open_br:
        open_br.ended_at = now
        session.add(open_br)
    open_row.break_started_at = None
    session.add(open_row)
    session.commit()
    session.refresh(open_row)
    name = current_user.full_name or current_user.username or ""
    return serialize_work_session(open_row, name, session=session)


@app.get("/users/me/work-sessions")
def list_my_work_sessions(
    current_user: Annotated[models.User, Depends(security.get_current_user)],
    session: Session = Depends(get_session),
    from_date: str = Query(..., description="Start date YYYY-MM-DD (UTC day)"),
    to_date: str = Query(..., description="End date YYYY-MM-DD (UTC day, inclusive)"),
) -> list[dict]:
    """List this user's completed and open sessions in a date range (by started_at, UTC calendar days)."""
    _require_tenant_staff_for_work_session(current_user)
    try:
        fd = datetime.strptime(from_date, "%Y-%m-%d").date()
        td = datetime.strptime(to_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format; use YYYY-MM-DD")
    if fd > td:
        raise HTTPException(status_code=400, detail="from_date must be <= to_date")
    start_utc = datetime.combine(fd, time.min, tzinfo=timezone.utc)
    end_exclusive = datetime.combine(td + timedelta(days=1), time.min, tzinfo=timezone.utc)
    rows = session.exec(
        select(models.WorkSession)
        .where(models.WorkSession.user_id == current_user.id)
        .where(models.WorkSession.started_at >= start_utc)
        .where(models.WorkSession.started_at < end_exclusive)
        .order_by(models.WorkSession.started_at.desc())
    ).all()
    name = current_user.full_name or current_user.username or ""
    return [serialize_work_session(r, name, session=session) for r in rows]


# ============ USER MANAGEMENT ============


@app.get("/users")
def list_users(
    current_user: Annotated[models.User, Depends(require_permission(Permission.USER_READ))],
    session: Session = Depends(get_session),
) -> list[models.UserResponse]:
    """List all users in the tenant."""
    users = session.exec(
        select(models.User).where(models.User.tenant_id == current_user.tenant_id)
    ).all()
    return [
        models.UserResponse(
            id=u.id,
            username=u.username,
            full_name=u.full_name,
            role=u.role,
            tenant_id=u.tenant_id,
        )
        for u in users
    ]


@app.get("/users/couriers")
def list_courier_users(
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_READ))],
    session: Session = Depends(get_session),
) -> list[models.UserResponse]:
    """List courier-role users in the tenant (for Satisfecho Delivery assign)."""
    users = session.exec(
        select(models.User).where(
            models.User.tenant_id == current_user.tenant_id,
            models.User.role == models.UserRole.courier,
        )
    ).all()
    return [
        models.UserResponse(
            id=u.id,
            username=u.username,
            full_name=u.full_name,
            role=u.role,
            tenant_id=u.tenant_id,
        )
        for u in users
    ]


@app.post("/users")
def create_user(
    user_data: models.UserCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.USER_CREATE))],
    session: Session = Depends(get_session),
) -> models.UserResponse:
    """Create a new user in the tenant."""
    from .permissions import can_manage_user
    
    # Check if current user can create users with the specified role
    if not can_manage_user(current_user, user_data.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Cannot create user with role '{user_data.role.value}'"
        )
    
    try:
        norm_username = normalize_username(user_data.username)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid username",
        )

    # Check if username already exists
    existing = session.exec(
        select(models.User).where(models.User.username == norm_username)
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken"
        )

    # Create the user
    new_user = models.User(
        username=norm_username,
        hashed_password=security.get_password_hash(user_data.password),
        full_name=user_data.full_name,
        role=user_data.role,
        tenant_id=current_user.tenant_id,
    )
    session.add(new_user)
    session.commit()
    session.refresh(new_user)

    return models.UserResponse(
        id=new_user.id,
        username=new_user.username,
        full_name=new_user.full_name,
        role=new_user.role,
        tenant_id=new_user.tenant_id,
    )


@app.put("/users/{user_id}")
def update_user(
    user_id: int,
    user_data: models.UserUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.USER_UPDATE))],
    session: Session = Depends(get_session),
    lang: str = Depends(_get_requested_language),
) -> models.UserResponse:
    """Update a user's details."""
    from .permissions import can_modify_user, can_manage_user
    
    # Get the target user
    target_user = session.exec(
        select(models.User).where(
            models.User.id == user_id,
            models.User.tenant_id == current_user.tenant_id
        )
    ).first()
    
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if current user can modify this user
    if not can_modify_user(current_user, target_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot modify this user"
        )
    
    # Check if trying to change role
    if user_data.role is not None and user_data.role != target_user.role:
        # Verify can assign this role
        if not can_manage_user(current_user, user_data.role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Cannot assign role '{user_data.role.value}'"
            )
        
        # Prevent owner from demoting themselves
        if current_user.id == target_user.id and current_user.role == models.UserRole.owner:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot demote yourself from owner role"
            )
        
        target_user.role = user_data.role
    
    # Update other fields
    if user_data.username is not None:
        try:
            norm_username = normalize_username(user_data.username)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid username",
            )
        # Check if username is already taken
        existing = session.exec(
            select(models.User).where(
                models.User.username == norm_username,
                models.User.id != user_id
            )
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already taken"
            )
        target_user.username = norm_username

    if user_data.full_name is not None:
        target_user.full_name = user_data.full_name

    new_password = (
        user_data.password.strip() if user_data.password is not None else None
    )
    if new_password:
        target_user.hashed_password = security.get_password_hash(new_password)
        # Increment token version to invalidate existing tokens
        target_user.token_version += 1
    
    session.add(target_user)
    session.commit()
    session.refresh(target_user)
    
    return models.UserResponse(
        id=target_user.id,
        username=target_user.username,
        full_name=target_user.full_name,
        role=target_user.role,
        tenant_id=target_user.tenant_id,
    )


@app.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.USER_DELETE))],
    session: Session = Depends(get_session),
) -> dict:
    """Delete a user (owner only)."""
    # Get the target user
    target_user = session.exec(
        select(models.User).where(
            models.User.id == user_id,
            models.User.tenant_id == current_user.tenant_id
        )
    ).first()
    
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Cannot delete yourself
    if target_user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete yourself"
        )
    
    # Cannot delete another owner
    if target_user.role == models.UserRole.owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete an owner"
        )
    
    session.delete(target_user)
    session.commit()
    
    return {"message": "User deleted successfully"}


# ============ TENANT SETTINGS ============


@app.get("/tenant/branding")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def get_tenant_branding(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(security.get_current_user)],
    session: Session = Depends(get_session),
) -> dict:
    """Basic branding (name + logo) for the staff app chrome (sidebar, mobile
    header). Any authenticated tenant user can read this — unlike
    /tenant/settings, it is not gated by Permission.SETTINGS_READ, so
    non-admin roles (waiter, kitchen) still see the restaurant's logo."""
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {"name": tenant.name, "logo_filename": tenant.logo_filename}


def _parse_bank_accounts(tenant) -> list[dict]:
    """Bank transfer accounts are stored as a JSON array in a text column."""
    raw = getattr(tenant, "payment_bank_accounts", None) if tenant else None
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except ValueError:
        return []
    return data if isinstance(data, list) else []


@app.get("/tenant/settings")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def get_tenant_settings(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_READ))],
    session: Session = Depends(get_session),
) -> dict:
    """Get tenant/business profile settings."""
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()

    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Get logo file size if exists
    logo_size = None
    if tenant.logo_filename:
        logo_path = (
            UPLOADS_DIR / str(current_user.tenant_id) / "logo" / tenant.logo_filename
        )
        logo_size = get_file_size(logo_path)

    # Convert tenant to dict and add file size (ensure id is present for client logo URL)
    # Exclude relationship to avoid serialization issues (users list)
    tenant_dict = tenant.model_dump(exclude={"users"})
    tenant_dict["id"] = tenant.id
    tenant_dict["payment_bank_accounts"] = _parse_bank_accounts(tenant)
    tenant_dict["logo_size_bytes"] = logo_size
    tenant_dict["logo_size_formatted"] = format_file_size(logo_size)

    # Don't expose full secret key - only show last 4 characters for verification
    if tenant_dict.get("stripe_secret_key"):
        secret_key = tenant_dict["stripe_secret_key"]
        tenant_dict["stripe_secret_key"] = (
            f"{secret_key[:7]}...{secret_key[-4:]}" if len(secret_key) > 11 else "***"
        )
    if tenant_dict.get("revolut_merchant_secret"):
        sk = tenant_dict["revolut_merchant_secret"]
        tenant_dict["revolut_merchant_secret"] = (
            f"{sk[:7]}...{sk[-4:]}" if len(sk) > 11 else "***"
        )
    # Don't expose SMTP password; indicate if configured
    if tenant_dict.get("smtp_password"):
        tenant_dict["smtp_password"] = "********"

    tenant_dict["currency_code"] = "COP"
    tenant_dict["currency"] = "$"
    tenant_dict["ui_modules"] = resolve_tenant_ui_modules(tenant.ui_modules)

    tenant_dict.pop("clock_qr_token_hash", None)
    tenant_dict.pop("clock_qr_token_encrypted", None)
    tenant_dict["clock_qr_active"] = bool(tenant.clock_qr_token_hash)
    tenant_dict["clock_qr_downloadable"] = bool(
        tenant.clock_qr_token_hash and (tenant.clock_qr_token_encrypted or "").strip()
    )

    return tenant_dict


@app.put("/tenant/settings")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def update_tenant_settings(
    request: Request,
    response: Response,
    tenant_update: models.TenantUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Update tenant/business profile settings."""
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()

    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Update fields if provided (convert empty strings to None)
    if tenant_update.name is not None:
        tenant.name = (
            tenant_update.name.strip()
            if isinstance(tenant_update.name, str)
            else tenant_update.name
        )
    if tenant_update.business_type is not None:
        tenant.business_type = (
            tenant_update.business_type if tenant_update.business_type else None
        )
    if tenant_update.description is not None:
        tenant.description = (
            tenant_update.description.strip() if tenant_update.description else None
        )
    if tenant_update.phone is not None:
        tenant.phone = tenant_update.phone.strip() if tenant_update.phone else None
    if tenant_update.whatsapp is not None:
        tenant.whatsapp = (
            tenant_update.whatsapp.strip() if tenant_update.whatsapp else None
        )
    if tenant_update.email is not None:
        tenant.email = tenant_update.email.strip() if tenant_update.email else None
    if tenant_update.address is not None:
        tenant.address = (
            tenant_update.address.strip() if tenant_update.address else None
        )
    if tenant_update.city is not None:
        tenant.city = (
            tenant_update.city.strip()[:120] if tenant_update.city else None
        )
    if tenant_update.public_slug is not None:
        from .tenant_public_slug import normalize_public_slug

        raw_slug = (
            tenant_update.public_slug.strip()
            if isinstance(tenant_update.public_slug, str)
            else ""
        )
        if not raw_slug:
            # Empty clears so ensure can regenerate from name+city below
            tenant.public_slug = None
        else:
            norm = normalize_public_slug(raw_slug)
            if not norm:
                raise HTTPException(
                    status_code=400,
                    detail="public_slug must be a URL-safe slug (letters, numbers, hyphens)",
                )
            taken = session.exec(
                select(models.Tenant).where(
                    models.Tenant.public_slug == norm,
                    models.Tenant.id != tenant.id,
                )
            ).first()
            if taken:
                raise HTTPException(
                    status_code=400,
                    detail="public_slug is already in use by another restaurant",
                )
            tenant.public_slug = norm
    if tenant_update.website is not None:
        tenant.website = (
            tenant_update.website.strip() if tenant_update.website else None
        )
    if tenant_update.tax_id is not None:
        tenant.tax_id = (
            tenant_update.tax_id.strip() if tenant_update.tax_id else None
        )
    if tenant_update.cif is not None:
        tenant.cif = (
            tenant_update.cif.strip() if tenant_update.cif else None
        )
    if tenant_update.ccc is not None:
        tenant.ccc = (
            tenant_update.ccc.strip() if tenant_update.ccc else None
        )
    if tenant_update.opening_hours is not None:
        tenant.opening_hours = (
            tenant_update.opening_hours.strip() if tenant_update.opening_hours else None
        )
    if tenant_update.immediate_payment_required is not None:
        tenant.immediate_payment_required = tenant_update.immediate_payment_required
    # Use model_fields_set so explicit null clears the default (None alone is the unset default).
    if "default_tax_id" in tenant_update.model_fields_set:
        if tenant_update.default_tax_id:
            tax = session.get(models.Tax, tenant_update.default_tax_id)
            if not tax or tax.tenant_id != current_user.tenant_id:
                raise HTTPException(status_code=400, detail="Invalid default tax")
        tenant.default_tax_id = tenant_update.default_tax_id or None

    if tenant_update.timezone is not None:
        tz_val = (
            tenant_update.timezone.strip()
            if isinstance(tenant_update.timezone, str)
            else None
        )
        if tz_val:
            try:
                ZoneInfo(tz_val)
            except (KeyError, ValueError):
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid timezone: {tz_val}. Use IANA format (e.g. America/Mazatlan)",
                )
            tenant.timezone = tz_val
        else:
            tenant.timezone = None

    if tenant_update.country_code is not None:
        cc_raw = (
            tenant_update.country_code.strip().upper()
            if isinstance(tenant_update.country_code, str)
            else None
        )
        if cc_raw:
            if len(cc_raw) != 2 or not cc_raw.isalpha():
                raise HTTPException(
                    status_code=400,
                    detail="country_code must be a 2-letter ISO 3166-1 code (e.g. ES, IN)",
                )
            tenant.country_code = cc_raw
        else:
            tenant.country_code = None

    for _pay_field in ("payment_nequi_number", "payment_llave", "payment_account_holder"):
        if _pay_field in tenant_update.model_fields_set:
            _val = getattr(tenant_update, _pay_field)
            setattr(tenant, _pay_field, _val.strip() or None if isinstance(_val, str) else None)

    if "payment_bank_accounts" in tenant_update.model_fields_set:
        _accounts = []
        for _acc in (tenant_update.payment_bank_accounts or [])[:10]:
            _clean = {
                k: str(_acc.get(k) or "").strip()[:120]
                for k in ("bank", "account_type", "account_number", "holder")
            }
            if _clean["bank"] and _clean["account_number"]:
                _accounts.append(_clean)
        tenant.payment_bank_accounts = json.dumps(_accounts, ensure_ascii=False) if _accounts else None

    if tenant_update.dian_mode is not None:
        dm = tenant_update.dian_mode.strip().lower() if isinstance(tenant_update.dian_mode, str) else ""
        if dm in ("off", "test", "live"):
            assert_dian_mode_allowed(dm)
            tenant.dian_mode = dm
        elif dm == "":
            tenant.dian_mode = "off"
        else:
            raise HTTPException(status_code=400, detail="dian_mode must be off, test, or live")
    if tenant_update.dian_tax_regime is not None:
        dr = (
            tenant_update.dian_tax_regime.strip().lower()
            if isinstance(tenant_update.dian_tax_regime, str)
            else ""
        )
        if dr in ("responsable_iva", "regimen_simple"):
            tenant.dian_tax_regime = dr
        elif dr == "":
            tenant.dian_tax_regime = None
        else:
            raise HTTPException(
                status_code=400,
                detail="dian_tax_regime must be responsable_iva or regimen_simple",
            )
    if tenant_update.dian_client_id is not None:
        dcid = (
            tenant_update.dian_client_id.strip()
            if isinstance(tenant_update.dian_client_id, str)
            else ""
        )
        tenant.dian_client_id = dcid[:128] if dcid else None

    # Per-tenant SMTP / email (optional; fallback to global config)
    if tenant_update.smtp_host is not None:
        tenant.smtp_host = (
            tenant_update.smtp_host.strip()
            if isinstance(tenant_update.smtp_host, str) and tenant_update.smtp_host.strip()
            else None
        )
    if tenant_update.smtp_port is not None:
        tenant.smtp_port = tenant_update.smtp_port if tenant_update.smtp_port > 0 else None
    if tenant_update.smtp_use_tls is not None:
        tenant.smtp_use_tls = tenant_update.smtp_use_tls
    if tenant_update.smtp_user is not None:
        tenant.smtp_user = (
            tenant_update.smtp_user.strip()
            if isinstance(tenant_update.smtp_user, str) and tenant_update.smtp_user.strip()
            else None
        )
    if tenant_update.smtp_password is not None and isinstance(tenant_update.smtp_password, str):
        # Only update if non-empty (empty = keep existing)
        if tenant_update.smtp_password.strip():
            tenant.smtp_password = tenant_update.smtp_password.strip()
    if tenant_update.email_from is not None:
        tenant.email_from = (
            tenant_update.email_from.strip()
            if isinstance(tenant_update.email_from, str) and tenant_update.email_from.strip()
            else None
        )
    if tenant_update.email_from_name is not None:
        tenant.email_from_name = (
            tenant_update.email_from_name.strip()
            if isinstance(tenant_update.email_from_name, str)
            and tenant_update.email_from_name.strip()
            else None
        )

    if tenant_update.reservation_confirmation_email_subject is not None:
        raw = tenant_update.reservation_confirmation_email_subject
        if isinstance(raw, str):
            s = raw.replace("\x00", "").strip()
            tenant.reservation_confirmation_email_subject = s[:MAX_SUBJECT_LEN] if s else None
        else:
            tenant.reservation_confirmation_email_subject = None
    if tenant_update.reservation_confirmation_email_body is not None:
        raw = tenant_update.reservation_confirmation_email_body
        if isinstance(raw, str):
            s = raw.replace("\x00", "").strip()
            tenant.reservation_confirmation_email_body = s[:MAX_BODY_LEN] if s else None
        else:
            tenant.reservation_confirmation_email_body = None

    if tenant_update.public_background_color is not None:
        val = (
            tenant_update.public_background_color.strip()
            if isinstance(tenant_update.public_background_color, str)
            else None
        )
        if val:
            if not val.startswith("#"):
                val = "#" + val
            if len(val) <= 20 and all(c in "0123456789abcdefABCDEF#" for c in val):
                tenant.public_background_color = val
            else:
                tenant.public_background_color = None
        else:
            tenant.public_background_color = None

    if tenant_update.public_primary_color is not None:
        val = (
            tenant_update.public_primary_color.strip()
            if isinstance(tenant_update.public_primary_color, str)
            else None
        )
        if val:
            if not val.startswith("#"):
                val = "#" + val
            if len(val) <= 20 and all(c in "0123456789abcdefABCDEF#" for c in val):
                tenant.public_primary_color = val
            else:
                tenant.public_primary_color = None
        else:
            tenant.public_primary_color = None

    if tenant_update.public_google_review_url is not None:
        tenant.public_google_review_url = _normalize_public_http_url(
            tenant_update.public_google_review_url
        )
    if tenant_update.public_google_maps_url is not None:
        tenant.public_google_maps_url = _normalize_public_http_url(
            tenant_update.public_google_maps_url
        )
    if tenant_update.public_openstreetmap_url is not None:
        tenant.public_openstreetmap_url = _normalize_public_http_url(
            tenant_update.public_openstreetmap_url
        )
    if tenant_update.public_terms_of_service_url is not None:
        tenant.public_terms_of_service_url = _normalize_public_http_url(
            tenant_update.public_terms_of_service_url
        )
    if tenant_update.public_privacy_policy_url is not None:
        tenant.public_privacy_policy_url = _normalize_public_http_url(
            tenant_update.public_privacy_policy_url
        )
    if tenant_update.public_facebook_url is not None:
        tenant.public_facebook_url = _normalize_public_http_url(
            tenant_update.public_facebook_url
        )
    if tenant_update.public_instagram_url is not None:
        tenant.public_instagram_url = _normalize_public_http_url(
            tenant_update.public_instagram_url
        )

    # Reservation options (pre-payment, policies, reminders)
    if tenant_update.reservation_prepayment_cents is not None:
        v = tenant_update.reservation_prepayment_cents
        tenant.reservation_prepayment_cents = v if v >= 0 else None
    if tenant_update.reservation_prepayment_text is not None:
        tenant.reservation_prepayment_text = (
            tenant_update.reservation_prepayment_text.strip()
            if isinstance(tenant_update.reservation_prepayment_text, str)
            and tenant_update.reservation_prepayment_text.strip()
            else None
        )
    if tenant_update.reservation_cancellation_policy is not None:
        tenant.reservation_cancellation_policy = (
            tenant_update.reservation_cancellation_policy.strip()
            if isinstance(tenant_update.reservation_cancellation_policy, str)
            and tenant_update.reservation_cancellation_policy.strip()
            else None
        )
    if tenant_update.reservation_arrival_tolerance_minutes is not None:
        v = tenant_update.reservation_arrival_tolerance_minutes
        tenant.reservation_arrival_tolerance_minutes = v if v >= 0 else None
    if tenant_update.reservation_average_table_turn_minutes is not None:
        v = tenant_update.reservation_average_table_turn_minutes
        if v <= 0:
            tenant.reservation_average_table_turn_minutes = None
        elif v > 24 * 60:
            raise HTTPException(
                status_code=400,
                detail="reservation_average_table_turn_minutes must be between 1 and 1440",
            )
        else:
            tenant.reservation_average_table_turn_minutes = v
    if tenant_update.reservation_slot_minutes is not None:
        v = tenant_update.reservation_slot_minutes
        if v <= 0:
            tenant.reservation_slot_minutes = None
        elif v < 5 or v > 120:
            raise HTTPException(
                status_code=400,
                detail="reservation_slot_minutes must be between 5 and 120, or 0 to use default (15)",
            )
        else:
            tenant.reservation_slot_minutes = int(v)
    if tenant_update.reservation_max_guests_per_slot is not None:
        v = tenant_update.reservation_max_guests_per_slot
        if v is None or v <= 0:
            tenant.reservation_max_guests_per_slot = None
        elif v > 500:
            raise HTTPException(
                status_code=400,
                detail="reservation_max_guests_per_slot must be between 1 and 500, or 0 to clear",
            )
        else:
            tenant.reservation_max_guests_per_slot = int(v)
    if tenant_update.reservation_walk_in_tables_reserved is not None:
        w = tenant_update.reservation_walk_in_tables_reserved
        tenant.reservation_walk_in_tables_reserved = max(0, int(w))
    if tenant_update.reservation_dress_code is not None:
        tenant.reservation_dress_code = (
            tenant_update.reservation_dress_code.strip()
            if isinstance(tenant_update.reservation_dress_code, str)
            and tenant_update.reservation_dress_code.strip()
            else None
        )
    if tenant_update.reservation_reminder_24h_enabled is not None:
        tenant.reservation_reminder_24h_enabled = tenant_update.reservation_reminder_24h_enabled
    if tenant_update.reservation_reminder_2h_enabled is not None:
        tenant.reservation_reminder_2h_enabled = tenant_update.reservation_reminder_2h_enabled
    if tenant_update.guest_birthday_capture_enabled is not None:
        tenant.guest_birthday_capture_enabled = bool(
            tenant_update.guest_birthday_capture_enabled
        )
    if tenant_update.guest_birthday_marketing_enabled is not None:
        tenant.guest_birthday_marketing_enabled = bool(
            tenant_update.guest_birthday_marketing_enabled
        )
    if tenant_update.guest_birthday_consent_text is not None:
        raw_consent = tenant_update.guest_birthday_consent_text
        if isinstance(raw_consent, str):
            stripped = raw_consent.strip()
            tenant.guest_birthday_consent_text = stripped or None
        else:
            tenant.guest_birthday_consent_text = None

    # Satisfecho Delivery fee + coverage
    if tenant_update.delivery_fee_cents is not None:
        fee = int(tenant_update.delivery_fee_cents)
        if fee < 0:
            raise HTTPException(status_code=400, detail="delivery_fee_cents must be non-negative")
        tenant.delivery_fee_cents = fee
    if tenant_update.delivery_radius_meters is not None:
        r = int(tenant_update.delivery_radius_meters)
        if r < 0:
            raise HTTPException(
                status_code=400, detail="delivery_radius_meters must be non-negative"
            )
        # 0 clears radius restriction
        tenant.delivery_radius_meters = r if r > 0 else None
    if tenant_update.delivery_postal_codes is not None:
        from app.delivery_order_service import (
            parse_delivery_postal_codes,
            serialize_delivery_postal_codes,
        )

        raw = tenant_update.delivery_postal_codes
        if isinstance(raw, str) and raw.strip() == "":
            tenant.delivery_postal_codes = None
        else:
            # Accept JSON array string or newline/comma-separated list for convenience
            codes: list[str] = []
            if isinstance(raw, str):
                stripped = raw.strip()
                if stripped.startswith("["):
                    codes = parse_delivery_postal_codes(stripped)
                else:
                    parts = re.split(r"[\n,;]+", stripped)
                    codes = [p for p in parts if p.strip()]
            tenant.delivery_postal_codes = serialize_delivery_postal_codes(codes)

    if tenant_update.tip_preset_percents is not None:
        tenant.tip_preset_percents = _tip_presets_from_request(
            tenant_update.tip_preset_percents
        )
    if tenant_update.tip_tax_rate_percent is not None:
        tenant.tip_tax_rate_percent = max(
            0, min(100, int(tenant_update.tip_tax_rate_percent))
        )
    if tenant_update.tip_entry_mode is not None:
        m = (tenant_update.tip_entry_mode or "preset").strip().lower()
        if m not in ("preset", "overpayment"):
            raise HTTPException(
                status_code=400,
                detail="tip_entry_mode must be preset or overpayment",
            )
        tenant.tip_entry_mode = m

    # Kitchen/Bar display timer thresholds (minutes)
    if tenant_update.kitchen_display_timer_yellow_minutes is not None:
        tenant.kitchen_display_timer_yellow_minutes = max(0, tenant_update.kitchen_display_timer_yellow_minutes)
    if tenant_update.kitchen_display_timer_orange_minutes is not None:
        tenant.kitchen_display_timer_orange_minutes = max(0, tenant_update.kitchen_display_timer_orange_minutes)
    if tenant_update.kitchen_display_timer_red_minutes is not None:
        tenant.kitchen_display_timer_red_minutes = max(0, tenant_update.kitchen_display_timer_red_minutes)

    if tenant_update.ui_modules is not None:
        if not isinstance(tenant_update.ui_modules, dict):
            raise HTTPException(status_code=400, detail="ui_modules must be an object")
        tenant.ui_modules = merge_tenant_ui_modules_patch(
            tenant.ui_modules, tenant_update.ui_modules
        )

    # Venue GPS (clock QR location verify, public order location checks, etc.)
    if tenant_update.latitude is not None:
        lat = float(tenant_update.latitude)
        if not math.isfinite(lat) or lat < -90.0 or lat > 90.0:
            raise HTTPException(
                status_code=400,
                detail="latitude must be a finite number between -90 and 90",
            )
        tenant.latitude = lat
    if tenant_update.longitude is not None:
        lon = float(tenant_update.longitude)
        if not math.isfinite(lon) or lon < -180.0 or lon > 180.0:
            raise HTTPException(
                status_code=400,
                detail="longitude must be a finite number between -180 and 180",
            )
        tenant.longitude = lon
    if tenant_update.location_radius_meters is not None:
        r = tenant_update.location_radius_meters
        if r < 0:
            raise HTTPException(
                status_code=400,
                detail="location_radius_meters must be non-negative",
            )
        tenant.location_radius_meters = int(r)
    if tenant_update.location_check_enabled is not None:
        tenant.location_check_enabled = tenant_update.location_check_enabled

    if tenant_update.clock_qr_location_verify is not None:
        tenant.clock_qr_location_verify = tenant_update.clock_qr_location_verify

    from .tenant_public_slug import ensure_tenant_public_slug

    ensure_tenant_public_slug(session, tenant)

    session.add(tenant)
    session.commit()
    session.refresh(tenant)

    # Get logo file size if exists
    logo_size = None
    if tenant.logo_filename:
        logo_path = (
            UPLOADS_DIR / str(current_user.tenant_id) / "logo" / tenant.logo_filename
        )
        logo_size = get_file_size(logo_path)

    # Convert tenant to dict and add file size (ensure id for client logo URL)
    # Exclude relationship to avoid serialization issues (users list)
    tenant_dict = tenant.model_dump(exclude={"users"})
    tenant_dict["id"] = tenant.id
    tenant_dict["logo_size_bytes"] = logo_size
    tenant_dict["logo_size_formatted"] = format_file_size(logo_size)

    # Don't expose full secret key - only show last 4 characters for verification
    if tenant_dict.get("stripe_secret_key"):
        secret_key = tenant_dict["stripe_secret_key"]
        tenant_dict["stripe_secret_key"] = (
            f"{secret_key[:7]}...{secret_key[-4:]}" if len(secret_key) > 11 else "***"
        )
    if tenant_dict.get("revolut_merchant_secret"):
        sk = tenant_dict["revolut_merchant_secret"]
        tenant_dict["revolut_merchant_secret"] = (
            f"{sk[:7]}...{sk[-4:]}" if len(sk) > 11 else "***"
        )
    # Don't expose SMTP password; indicate if configured
    if tenant_dict.get("smtp_password"):
        tenant_dict["smtp_password"] = "********"

    tenant_dict["currency_code"] = "COP"
    tenant_dict["currency"] = "$"
    tenant_dict["ui_modules"] = resolve_tenant_ui_modules(tenant.ui_modules)

    tenant_dict.pop("clock_qr_token_hash", None)
    tenant_dict.pop("clock_qr_token_encrypted", None)
    tenant_dict["clock_qr_active"] = bool(tenant.clock_qr_token_hash)
    tenant_dict["clock_qr_downloadable"] = bool(
        tenant.clock_qr_token_hash and (tenant.clock_qr_token_encrypted or "").strip()
    )

    return tenant_dict


@app.post("/tenant/settings/clock-qr/regenerate")
def regenerate_tenant_clock_qr(
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Generate a new venue clock QR token (plain token returned once)."""
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    token = generate_clock_qr_token()
    tenant.clock_qr_token_hash = hash_clock_qr_token(token)
    tenant.clock_qr_token_encrypted = encrypt_clock_qr_token_for_storage(token)
    session.add(tenant)
    session.commit()
    return {"token": token, "clock_qr_active": True, "clock_qr_downloadable": True}


@app.get("/tenant/settings/clock-qr/token")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def get_tenant_clock_qr_token(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Return the venue clock QR plain token for printing (decrypted server-side; requires settings update)."""
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if not tenant.clock_qr_token_hash:
        raise HTTPException(status_code=404, detail="clock_qr_not_active")
    plain = decrypt_clock_qr_token_from_storage(tenant.clock_qr_token_encrypted)
    if not plain or not clock_qr_tokens_equal(tenant.clock_qr_token_hash, plain):
        raise HTTPException(
            status_code=409,
            detail="clock_qr_regenerate_required",
        )
    return {"token": plain, "clock_qr_active": True, "clock_qr_downloadable": True}


@app.delete("/tenant/settings/clock-qr")
def disable_tenant_clock_qr(
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Disable venue QR requirement for clock actions."""
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    tenant.clock_qr_token_hash = None
    tenant.clock_qr_token_encrypted = None
    session.add(tenant)
    session.commit()
    return {"status": "ok", "clock_qr_active": False, "clock_qr_downloadable": False}


def _validate_weekly_opening_hours_json(raw: str | None, *, required: bool) -> str | None:
    if raw is None or not str(raw).strip():
        if required:
            raise HTTPException(status_code=400, detail="opening_hours JSON is required")
        return None
    s = str(raw).strip()
    try:
        obj = json.loads(s)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="opening_hours must be valid JSON") from None
    if not isinstance(obj, dict):
        raise HTTPException(status_code=400, detail="opening_hours must be a JSON object")
    return s


@app.get("/tenant/opening-hours/schedule")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def list_opening_hours_schedule(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_READ))],
    session: Session = Depends(get_session),
) -> dict:
    """List baseline schedules and date overrides for the tenant (planned opening hours)."""
    tid = current_user.tenant_id
    baselines = session.exec(
        select(models.OpeningHoursBaselineSchedule)
        .where(models.OpeningHoursBaselineSchedule.tenant_id == tid)
        .order_by(models.OpeningHoursBaselineSchedule.effective_from.asc())
    ).all()
    overrides = session.exec(
        select(models.OpeningHoursDateOverride)
        .where(models.OpeningHoursDateOverride.tenant_id == tid)
        .order_by(models.OpeningHoursDateOverride.date_from.asc(), models.OpeningHoursDateOverride.id.asc())
    ).all()
    return {
        "baselines": [
            {
                "id": b.id,
                "effective_from": b.effective_from.isoformat(),
                "opening_hours": b.opening_hours,
                "note": b.note,
                "created_at": b.created_at.isoformat() if b.created_at else None,
            }
            for b in baselines
            if b.id is not None
        ],
        "overrides": [
            {
                "id": o.id,
                "date_from": o.date_from.isoformat(),
                "date_to": o.date_to.isoformat(),
                "closed": o.closed,
                "opening_hours": o.opening_hours,
                "note": o.note,
                "created_at": o.created_at.isoformat() if o.created_at else None,
            }
            for o in overrides
            if o.id is not None
        ],
    }


@app.post("/tenant/opening-hours/baselines")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def create_opening_hours_baseline(
    request: Request,
    response: Response,
    body: models.OpeningHoursBaselineCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Schedule a weekly opening-hours pattern from effective_from onward."""
    oh = _validate_weekly_opening_hours_json(body.opening_hours, required=True)
    row = models.OpeningHoursBaselineSchedule(
        tenant_id=current_user.tenant_id,
        effective_from=body.effective_from,
        opening_hours=oh or "",
        note=(body.note or "").strip() or None,
    )
    session.add(row)
    try:
        session.commit()
        session.refresh(row)
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="A baseline for this effective_from date already exists.",
        ) from None
    return {"id": row.id}


@app.delete("/tenant/opening-hours/baselines/{baseline_id}")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def delete_opening_hours_baseline(
    baseline_id: int,
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Remove a planned baseline schedule row."""
    row = session.exec(
        select(models.OpeningHoursBaselineSchedule).where(
            models.OpeningHoursBaselineSchedule.id == baseline_id,
            models.OpeningHoursBaselineSchedule.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Baseline not found")
    session.delete(row)
    session.commit()
    return {"status": "ok"}


@app.post("/tenant/opening-hours/overrides")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def create_opening_hours_override(
    request: Request,
    response: Response,
    body: models.OpeningHoursOverrideCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Date-range override (closed or alternate weekly-style hours)."""
    if body.date_to < body.date_from:
        raise HTTPException(status_code=400, detail="date_to must be on or after date_from")
    oh: str | None = None
    if body.closed:
        if body.opening_hours is not None and str(body.opening_hours).strip():
            raise HTTPException(status_code=400, detail="closed overrides must not include opening_hours")
    else:
        oh = _validate_weekly_opening_hours_json(body.opening_hours, required=True)
    row = models.OpeningHoursDateOverride(
        tenant_id=current_user.tenant_id,
        date_from=body.date_from,
        date_to=body.date_to,
        closed=bool(body.closed),
        opening_hours=None if body.closed else oh,
        note=(body.note or "").strip() or None,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return {"id": row.id}


@app.delete("/tenant/opening-hours/overrides/{override_id}")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def delete_opening_hours_override(
    override_id: int,
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Remove a date-range override."""
    row = session.exec(
        select(models.OpeningHoursDateOverride).where(
            models.OpeningHoursDateOverride.id == override_id,
            models.OpeningHoursDateOverride.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Override not found")
    session.delete(row)
    session.commit()
    return {"status": "ok"}


@app.get("/tenant/opening-hours/effective-preview")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def preview_opening_hours_effective(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_READ))],
    session: Session = Depends(get_session),
    on_date: str = Query(..., description="Calendar date YYYY-MM-DD"),
) -> dict:
    """Weekly JSON effective for tenant settings preview on a calendar date."""
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    try:
        d = _parse_reservation_date(on_date.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    preview = effective_weekly_json_preview(session, tenant, d)
    return {"date": d.isoformat(), "opening_hours": preview}


# Kitchen/Bar display timer settings (read/update by anyone with order access)
@app.get("/tenant/kitchen-display-settings")
def get_kitchen_display_settings(
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_READ))],
    session: Session = Depends(get_session),
) -> dict:
    """Get kitchen/bar display timer thresholds (minutes). Used for wait-time card colors."""
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {
        "yellow_minutes": tenant.kitchen_display_timer_yellow_minutes if tenant.kitchen_display_timer_yellow_minutes is not None else 5,
        "orange_minutes": tenant.kitchen_display_timer_orange_minutes if tenant.kitchen_display_timer_orange_minutes is not None else 10,
        "red_minutes": tenant.kitchen_display_timer_red_minutes if tenant.kitchen_display_timer_red_minutes is not None else 15,
        "auto_preparing_seconds": tenant.auto_preparing_seconds,
    }


@app.put("/tenant/kitchen-display-settings")
def update_kitchen_display_settings(
    body: dict,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_READ))],
    session: Session = Depends(get_session),
) -> dict:
    """Update kitchen/bar display timer thresholds (minutes)."""
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    yellow = body.get("yellow_minutes")
    orange = body.get("orange_minutes")
    red = body.get("red_minutes")
    if yellow is not None:
        tenant.kitchen_display_timer_yellow_minutes = max(0, int(yellow))
    if orange is not None:
        tenant.kitchen_display_timer_orange_minutes = max(0, int(orange))
    if red is not None:
        tenant.kitchen_display_timer_red_minutes = max(0, int(red))
    auto_secs = body.get("auto_preparing_seconds")
    if auto_secs is not None:
        tenant.auto_preparing_seconds = min(3600, max(0, int(auto_secs)))
    session.add(tenant)
    session.commit()
    session.refresh(tenant)
    return {
        "yellow_minutes": tenant.kitchen_display_timer_yellow_minutes or 5,
        "orange_minutes": tenant.kitchen_display_timer_orange_minutes or 10,
        "red_minutes": tenant.kitchen_display_timer_red_minutes or 15,
        "auto_preparing_seconds": tenant.auto_preparing_seconds,
    }


# Kitchen / bar prep stations (KDS filtering, product mapping)
@app.get("/tenant/kitchen-stations")
def list_kitchen_stations(
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_READ))],
    session: Session = Depends(get_session),
) -> list[dict]:
    rows = session.exec(
        select(models.KitchenStation)
        .where(models.KitchenStation.tenant_id == current_user.tenant_id)
        .order_by(models.KitchenStation.sort_order, models.KitchenStation.id)
    ).all()
    return [
        {
            "id": r.id,
            "tenant_id": r.tenant_id,
            "name": r.name,
            "sort_order": r.sort_order,
            "display_route": r.display_route,
        }
        for r in rows
    ]


@app.get("/tenant/kitchen-station-defaults")
def get_kitchen_station_defaults(
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_READ))],
    session: Session = Depends(get_session),
) -> dict:
    tenant = session.get(models.Tenant, current_user.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {
        "default_kitchen_station_id": tenant.default_kitchen_station_id,
        "default_bar_station_id": tenant.default_bar_station_id,
    }


@app.put("/tenant/kitchen-station-defaults")
def update_kitchen_station_defaults(
    body: models.KitchenStationDefaultsUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    tenant = session.get(models.Tenant, current_user.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    data = body.model_dump(exclude_unset=True)
    if "default_kitchen_station_id" in data:
        val = data["default_kitchen_station_id"]
        if val:
            try:
                validate_kitchen_station_belongs(session, int(val), current_user.tenant_id)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid default kitchen station")
        tenant.default_kitchen_station_id = val
    if "default_bar_station_id" in data:
        val = data["default_bar_station_id"]
        if val:
            try:
                validate_kitchen_station_belongs(session, int(val), current_user.tenant_id)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid default bar station")
        tenant.default_bar_station_id = val
    session.add(tenant)
    session.commit()
    session.refresh(tenant)
    return {
        "default_kitchen_station_id": tenant.default_kitchen_station_id,
        "default_bar_station_id": tenant.default_bar_station_id,
    }


@app.post("/tenant/kitchen-stations")
def create_kitchen_station(
    body: models.KitchenStationCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    try:
        route = normalize_display_route(body.display_route)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    row = models.KitchenStation(
        tenant_id=current_user.tenant_id,
        name=body.name.strip() or "Station",
        sort_order=int(body.sort_order),
        display_route=route,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "sort_order": row.sort_order,
        "display_route": row.display_route,
    }


@app.put("/tenant/kitchen-stations/{station_id}")
def update_kitchen_station(
    station_id: int,
    body: models.KitchenStationUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    row = session.exec(
        select(models.KitchenStation).where(
            models.KitchenStation.id == station_id,
            models.KitchenStation.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Station not found")
    if body.name is not None:
        row.name = body.name.strip() or row.name
    if body.sort_order is not None:
        row.sort_order = int(body.sort_order)
    if body.display_route is not None:
        try:
            row.display_route = normalize_display_route(body.display_route)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    session.add(row)
    session.commit()
    session.refresh(row)
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "sort_order": row.sort_order,
        "display_route": row.display_route,
    }


@app.delete("/tenant/kitchen-stations/{station_id}")
def delete_kitchen_station(
    station_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    row = session.exec(
        select(models.KitchenStation).where(
            models.KitchenStation.id == station_id,
            models.KitchenStation.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Station not found")
    tenant = session.get(models.Tenant, current_user.tenant_id)
    if tenant:
        if tenant.default_kitchen_station_id == station_id:
            tenant.default_kitchen_station_id = None
            session.add(tenant)
        if tenant.default_bar_station_id == station_id:
            tenant.default_bar_station_id = None
            session.add(tenant)
    for p in session.exec(
        select(models.Product).where(
            models.Product.tenant_id == current_user.tenant_id,
            models.Product.kitchen_station_id == station_id,
        )
    ).all():
        p.kitchen_station_id = None
        session.add(p)
    session.delete(row)
    session.commit()
    return {"status": "deleted", "id": station_id}


# ============ TAXES (IVA) ============


@app.get("/taxes")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def list_taxes(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_READ))],
    session: Session = Depends(get_session),
    current_only: bool = Query(True, description="If true, only return taxes valid today"),
) -> list[dict]:
    """List taxes for the current tenant. Optionally filter to those valid today."""
    # Auto-seed default Spanish IVA taxes when a tenant has none yet.
    # This prevents Settings dropdowns from rendering as an empty list.
    has_any = session.exec(
        select(models.Tax.id).where(models.Tax.tenant_id == current_user.tenant_id).limit(1)
    ).first()
    if not has_any:
        from app.seeds.seed_spanish_taxes import seed_spanish_taxes

        seed_spanish_taxes(tenant_id=current_user.tenant_id, set_default=True)

    query = select(models.Tax).where(models.Tax.tenant_id == current_user.tenant_id)
    if current_only:
        today = date.today()
        query = query.where(models.Tax.valid_from <= today).where(
            (models.Tax.valid_to.is_(None)) | (models.Tax.valid_to >= today)
        )
    taxes = session.exec(query.order_by(models.Tax.valid_from.desc())).all()
    return [
        {
            "id": t.id,
            "tenant_id": t.tenant_id,
            "name": t.name,
            "rate_percent": t.rate_percent,
            "valid_from": t.valid_from.isoformat() if t.valid_from else None,
            "valid_to": t.valid_to.isoformat() if t.valid_to else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in taxes
    ]


@app.post("/taxes")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def create_tax(
    request: Request,
    response: Response,
    data: models.TaxCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Create a tax rate for the tenant."""
    if data.valid_to is not None and data.valid_from > data.valid_to:
        raise HTTPException(status_code=400, detail="valid_from must be before valid_to")
    tax = models.Tax(
        tenant_id=current_user.tenant_id,
        name=data.name,
        rate_percent=data.rate_percent,
        valid_from=data.valid_from,
        valid_to=data.valid_to,
    )
    session.add(tax)
    session.commit()
    session.refresh(tax)
    return {
        "id": tax.id,
        "tenant_id": tax.tenant_id,
        "name": tax.name,
        "rate_percent": tax.rate_percent,
        "valid_from": tax.valid_from.isoformat(),
        "valid_to": tax.valid_to.isoformat() if tax.valid_to else None,
        "created_at": tax.created_at.isoformat() if tax.created_at else None,
    }


@app.put("/taxes/{tax_id}")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def update_tax(
    request: Request,
    response: Response,
    tax_id: int,
    data: models.TaxUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Update a tax (e.g. set valid_to when rate changes)."""
    tax = session.exec(
        select(models.Tax).where(
            models.Tax.id == tax_id,
            models.Tax.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not tax:
        raise HTTPException(status_code=404, detail="Tax not found")
    if data.name is not None:
        tax.name = data.name
    if data.rate_percent is not None:
        tax.rate_percent = data.rate_percent
    if data.valid_from is not None:
        tax.valid_from = data.valid_from
    if data.valid_to is not None:
        tax.valid_to = data.valid_to
    if tax.valid_to is not None and tax.valid_from > tax.valid_to:
        raise HTTPException(status_code=400, detail="valid_from must be before valid_to")
    session.add(tax)
    session.commit()
    session.refresh(tax)
    return {
        "id": tax.id,
        "tenant_id": tax.tenant_id,
        "name": tax.name,
        "rate_percent": tax.rate_percent,
        "valid_from": tax.valid_from.isoformat(),
        "valid_to": tax.valid_to.isoformat() if tax.valid_to else None,
        "created_at": tax.created_at.isoformat() if tax.created_at else None,
    }


@app.delete("/taxes/{tax_id}")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def delete_tax(
    request: Request,
    response: Response,
    tax_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Delete a tax. Fails if it is the tenant default or used by products."""
    tax = session.exec(
        select(models.Tax).where(
            models.Tax.id == tax_id,
            models.Tax.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not tax:
        raise HTTPException(status_code=404, detail="Tax not found")
    tenant = session.get(models.Tenant, current_user.tenant_id)
    if tenant and getattr(tenant, "default_tax_id", None) == tax_id:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the default tax. Set another tax as default first.",
        )
    session.delete(tax)
    session.commit()
    return {"status": "deleted", "id": tax_id}


def _infer_content_type_from_filename(filename: str | None) -> str | None:
    """Infer image content type from file extension when client does not send Content-Type."""
    if not filename:
        return None
    ext = Path(filename).suffix.lower()
    mapping = {
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".avif": "image/avif",
    }
    return mapping.get(ext)


def _resolve_raster_image_content_type(file: UploadFile, contents: bytes) -> str | None:
    """Resolve Content-Type when the client omits it or sends application/octet-stream (GitHub #40)."""
    ct = file.content_type
    if ct in ALLOWED_IMAGE_TYPES:
        return ct
    inferred = _infer_content_type_from_filename(file.filename)
    if inferred in ALLOWED_IMAGE_TYPES:
        return inferred
    try:
        image = Image.open(BytesIO(contents))
        fmt = (image.format or "").upper()
        pil_to_mime = {
            "JPEG": "image/jpeg",
            "PNG": "image/png",
            "WEBP": "image/webp",
            "AVIF": "image/avif",
        }
        return pil_to_mime.get(fmt)
    except Exception:
        return None


def _delete_product_image_on_disk(image_filename: str | None, tenant_id: int) -> None:
    """Remove prior image file; handles tenant-owned files and catalog paths under providers/ (GitHub #40)."""
    if not image_filename:
        return
    fn = image_filename.replace("\\", "/").strip("/")
    uploads_root = UPLOADS_DIR.resolve()
    try:
        if fn.startswith("providers/"):
            if ".." in fn.split("/"):
                return
            path = (UPLOADS_DIR / fn).resolve()
        else:
            safe_name = Path(fn).name
            path = (UPLOADS_DIR / str(tenant_id) / "products" / safe_name).resolve()
        if path.is_relative_to(uploads_root) and path.is_file():
            path.unlink()
    except (OSError, ValueError):
        pass


@app.post("/tenant/logo")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_upload_per_hour', 10)}/hour",
    key_func=_rate_limit_key_user,
)
async def upload_tenant_logo(
    request: Request,
    response: Response,
    file: Annotated[UploadFile, File()],
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Upload a logo for the tenant/business."""
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()

    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Validate content type (logo allows SVG in addition to raster images)
    # Some clients do not send Content-Type for multipart file; infer from filename
    allowed_logo_types = ALLOWED_IMAGE_TYPES | {"image/svg+xml"}
    content_type = file.content_type or _infer_content_type_from_filename(file.filename)
    if content_type not in allowed_logo_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(sorted(allowed_logo_types))}",
        )

    # Read file and check size
    contents = await file.read()
    if len(contents) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Max size: {MAX_IMAGE_SIZE // (1024 * 1024)}MB",
        )

    is_svg = content_type == "image/svg+xml"
    if not is_svg:
        # Optimize raster image locally (SVG is stored as-is)
        contents = optimize_image(contents, content_type)

    # Create tenant logo directory
    tenant_dir = UPLOADS_DIR / str(current_user.tenant_id) / "logo"
    tenant_dir.mkdir(parents=True, exist_ok=True)

    # Delete old logo if exists
    if tenant.logo_filename:
        old_path = tenant_dir / tenant.logo_filename
        if old_path.exists():
            old_path.unlink()

    # Generate unique filename
    ext = Path(file.filename or ("logo.svg" if is_svg else "logo.jpg")).suffix.lower()
    if is_svg:
        if ext != ".svg":
            ext = ".svg"
    elif ext not in [".jpg", ".jpeg", ".png", ".webp", ".avif"]:
        ext = ".jpg"
    new_filename = f"{uuid4()}{ext}"

    # Save file
    file_path = tenant_dir / new_filename
    file_path.write_bytes(contents)

    # Update tenant
    tenant.logo_filename = new_filename
    session.add(tenant)
    session.commit()
    session.refresh(tenant)

    # Get file size for response (ensure id for client logo URL)
    # Exclude relationship to avoid serialization issues (users list)
    logo_size = get_file_size(file_path)
    tenant_dict = tenant.model_dump(exclude={"users"})
    tenant_dict["id"] = tenant.id
    tenant_dict["logo_size_bytes"] = logo_size
    tenant_dict["logo_size_formatted"] = format_file_size(logo_size)

    # Don't expose full secret key - only show last 4 characters for verification
    if tenant_dict.get("stripe_secret_key"):
        secret_key = tenant_dict["stripe_secret_key"]
        tenant_dict["stripe_secret_key"] = (
            f"{secret_key[:7]}...{secret_key[-4:]}" if len(secret_key) > 11 else "***"
        )
    if tenant_dict.get("revolut_merchant_secret"):
        sk = tenant_dict["revolut_merchant_secret"]
        tenant_dict["revolut_merchant_secret"] = (
            f"{sk[:7]}...{sk[-4:]}" if len(sk) > 11 else "***"
        )
    # Don't expose SMTP password; indicate if configured
    if tenant_dict.get("smtp_password"):
        tenant_dict["smtp_password"] = "********"

    return tenant_dict


@app.post("/tenant/payment-qr")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_upload_per_hour', 10)}/hour",
    key_func=_rate_limit_key_user,
)
async def upload_tenant_payment_qr(
    request: Request,
    response: Response,
    file: Annotated[UploadFile, File()],
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Upload the payment QR image guests see on the menu (Nequi / bank QR)."""
    tenant = session.get(models.Tenant, current_user.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    content_type = file.content_type or _infer_content_type_from_filename(file.filename)
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(sorted(ALLOWED_IMAGE_TYPES))}",
        )
    contents = await file.read()
    if len(contents) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Max size: {MAX_IMAGE_SIZE // (1024 * 1024)}MB",
        )
    # Keep the QR pixels intact (no lossy optimisation) so it stays scannable.
    qr_dir = UPLOADS_DIR / str(current_user.tenant_id) / "payment_qr"
    qr_dir.mkdir(parents=True, exist_ok=True)
    if tenant.payment_qr_filename:
        old_path = qr_dir / tenant.payment_qr_filename
        if old_path.exists():
            old_path.unlink()
    ext = Path(file.filename or "qr.png").suffix.lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp", ".avif"]:
        ext = ".png"
    new_filename = f"{uuid4()}{ext}"
    (qr_dir / new_filename).write_bytes(contents)
    tenant.payment_qr_filename = new_filename
    session.add(tenant)
    session.commit()
    return {"payment_qr_filename": new_filename}


@app.delete("/tenant/payment-qr")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def delete_tenant_payment_qr(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Remove the payment QR image."""
    tenant = session.get(models.Tenant, current_user.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if tenant.payment_qr_filename:
        path = UPLOADS_DIR / str(current_user.tenant_id) / "payment_qr" / tenant.payment_qr_filename
        if path.exists():
            path.unlink()
        tenant.payment_qr_filename = None
        session.add(tenant)
        session.commit()
    return {"payment_qr_filename": None}


@app.delete("/tenant/logo")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def delete_tenant_logo(
    request: Request,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Remove the tenant logo image."""
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()

    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    if tenant.logo_filename:
        tenant_dir = UPLOADS_DIR / str(current_user.tenant_id) / "logo"
        path = tenant_dir / tenant.logo_filename
        if path.exists():
            path.unlink()
        tenant.logo_filename = None
        session.add(tenant)
        session.commit()
        session.refresh(tenant)

    tenant_dict = tenant.model_dump(mode="json", exclude={"users"})
    tenant_dict["id"] = tenant.id
    tenant_dict["logo_size_bytes"] = None
    tenant_dict["logo_size_formatted"] = format_file_size(None)

    if tenant_dict.get("stripe_secret_key"):
        secret_key = tenant_dict["stripe_secret_key"]
        tenant_dict["stripe_secret_key"] = (
            f"{secret_key[:7]}...{secret_key[-4:]}" if len(secret_key) > 11 else "***"
        )
    if tenant_dict.get("revolut_merchant_secret"):
        sk = tenant_dict["revolut_merchant_secret"]
        tenant_dict["revolut_merchant_secret"] = (
            f"{sk[:7]}...{sk[-4:]}" if len(sk) > 11 else "***"
        )
    if tenant_dict.get("smtp_password"):
        tenant_dict["smtp_password"] = "********"
    return JSONResponse(content=tenant_dict)


@app.post("/tenant/header-background")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_upload_per_hour', 10)}/hour",
    key_func=_rate_limit_key_user,
)
async def upload_tenant_header_background(
    request: Request,
    file: Annotated[UploadFile, File()],
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Upload a header background image for public-facing pages (book, menu, reservation view)."""
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()

    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    content_type = file.content_type or _infer_content_type_from_filename(file.filename)
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(sorted(ALLOWED_IMAGE_TYPES))}",
        )

    contents = await file.read()
    if len(contents) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Max size: {MAX_IMAGE_SIZE // (1024 * 1024)}MB",
        )

    contents = optimize_image(contents, content_type)

    tenant_dir = UPLOADS_DIR / str(current_user.tenant_id) / "header"
    tenant_dir.mkdir(parents=True, exist_ok=True)

    if tenant.header_background_filename:
        old_path = tenant_dir / tenant.header_background_filename
        if old_path.exists():
            old_path.unlink()

    ext = Path(file.filename or "header.jpg").suffix.lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp", ".avif"]:
        ext = ".jpg"
    new_filename = f"{uuid4()}{ext}"

    file_path = tenant_dir / new_filename
    file_path.write_bytes(contents)

    tenant.header_background_filename = new_filename
    session.add(tenant)
    session.commit()
    session.refresh(tenant)

    tenant_dict = tenant.model_dump(mode="json", exclude={"users"})
    tenant_dict["id"] = tenant.id
    if tenant_dict.get("stripe_secret_key"):
        secret_key = tenant_dict["stripe_secret_key"]
        tenant_dict["stripe_secret_key"] = (
            f"{secret_key[:7]}...{secret_key[-4:]}" if len(secret_key) > 11 else "***"
        )
    if tenant_dict.get("revolut_merchant_secret"):
        sk = tenant_dict["revolut_merchant_secret"]
        tenant_dict["revolut_merchant_secret"] = (
            f"{sk[:7]}...{sk[-4:]}" if len(sk) > 11 else "***"
        )
    if tenant_dict.get("smtp_password"):
        tenant_dict["smtp_password"] = "********"
    return JSONResponse(content=tenant_dict)


@app.delete("/tenant/header-background")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def delete_tenant_header_background(
    request: Request,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SETTINGS_UPDATE))],
    session: Session = Depends(get_session),
) -> dict:
    """Remove the tenant header background image."""
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()

    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    if tenant.header_background_filename:
        tenant_dir = UPLOADS_DIR / str(current_user.tenant_id) / "header"
        path = tenant_dir / tenant.header_background_filename
        if path.exists():
            path.unlink()
        tenant.header_background_filename = None
        session.add(tenant)
        session.commit()
        session.refresh(tenant)

    tenant_dict = tenant.model_dump(mode="json", exclude={"users"})
    tenant_dict["id"] = tenant.id
    if tenant_dict.get("stripe_secret_key"):
        secret_key = tenant_dict["stripe_secret_key"]
        tenant_dict["stripe_secret_key"] = (
            f"{secret_key[:7]}...{secret_key[-4:]}" if len(secret_key) > 11 else "***"
        )
    if tenant_dict.get("revolut_merchant_secret"):
        sk = tenant_dict["revolut_merchant_secret"]
        tenant_dict["revolut_merchant_secret"] = (
            f"{sk[:7]}...{sk[-4:]}" if len(sk) > 11 else "***"
        )
    if tenant_dict.get("smtp_password"):
        tenant_dict["smtp_password"] = "********"
    return JSONResponse(content=tenant_dict)


# ============ PRODUCTS ============


@app.get("/products")
def list_products(
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_READ))],
    session: Session = Depends(get_session),
) -> list[models.Product]:
    """List all products for the tenant.
    
    Returns all Product entries. Also:
    1. Creates Product entries for TenantProducts that don't have a linked Product entry
    2. Updates existing Product entries that are missing images but have a linked TenantProduct with provider_product
    """
    products = session.exec(
        select(models.Product).where(models.Product.tenant_id == current_user.tenant_id)
    ).all()
    
    # Get TenantProducts that don't have a linked Product entry
    tenant_products_without_product = session.exec(
        select(models.TenantProduct).where(
            models.TenantProduct.tenant_id == current_user.tenant_id,
            models.TenantProduct.product_id.is_(None)
        )
    ).all()
    
    # Create Product entries for TenantProducts that don't have one
    for tp in tenant_products_without_product:
        # Get catalog item for category/subcategory
        catalog_item = session.exec(
            select(models.ProductCatalog).where(models.ProductCatalog.id == tp.catalog_id)
        ).first()
        
        # Get image from TenantProduct or provider product
        image_filename = tp.image_filename
        if not image_filename and tp.provider_product_id:
            # Try to get image from provider product
            provider_product = session.exec(
                select(models.ProviderProduct).where(models.ProviderProduct.id == tp.provider_product_id)
            ).first()
            if provider_product and provider_product.image_filename:
                provider = session.exec(
                    select(models.Provider).where(models.Provider.id == provider_product.provider_id)
                ).first()
                if provider:
                    image_filename = provider_product_stored_image_path(
                        provider.token, provider_product.image_filename
                    )

        sell_price = tp.price_cents
        if sell_price is None:
            sell_price = _price_cents_from_tenant_product_row(session, tp)
        if sell_price is None:
            continue

        # Create Product entry
        product = models.Product(
            tenant_id=tp.tenant_id,
            name=tp.name,
            price_cents=sell_price,
            description=catalog_item.description if catalog_item else None,
            image_filename=image_filename,
            ingredients=tp.ingredients,
            category=catalog_item.category if catalog_item else None,
            subcategory=catalog_item.subcategory if catalog_item else None,
        )
        session.add(product)
        session.flush()  # Flush to get the ID
        session.refresh(product)
        
        # Link TenantProduct to the new Product
        tp.product_id = product.id
        session.add(tp)
        
        products.append(product)
    
    # Update existing Product entries that are missing images or descriptions
    updated_count = 0
    for product in products:
        # Find linked TenantProduct
        tenant_product = session.exec(
            select(models.TenantProduct).where(
                models.TenantProduct.product_id == product.id,
                models.TenantProduct.tenant_id == current_user.tenant_id
            )
        ).first()

        if tenant_product:
            # Backfill description from catalog if missing
            if not product.description and tenant_product.catalog_id:
                catalog_item = session.exec(
                    select(models.ProductCatalog).where(models.ProductCatalog.id == tenant_product.catalog_id)
                ).first()
                if catalog_item and catalog_item.description:
                    product.description = catalog_item.description
                    session.add(product)
                    updated_count += 1

            # Repair image only when missing/orphan; never overwrite valid custom uploads
            repaired = repair_product_image_filename(session, product, tenant_product)
            if repaired != product.image_filename:
                product.image_filename = repaired
                session.add(product)
                updated_count += 1
    
    # Commit all changes
    if tenant_products_without_product or updated_count > 0:
        session.commit()
        # Refresh products to get updated image_filename
        for product in products:
            session.refresh(product)
    
    return products


@app.post("/products")
def create_product(
    product: models.Product,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> models.Product:
    product.tenant_id = current_user.tenant_id
    product.image_filename = None  # set only via the image upload endpoint
    if product.category is not None:
        from .category_codes import normalize_product_category

        product.category = normalize_product_category(product.category)
    if getattr(product, "kitchen_station_id", None):
        try:
            validate_kitchen_station_belongs(
                session, product.kitchen_station_id, current_user.tenant_id
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid kitchen station")
    if getattr(product, "stock_qty", 0) is not None and int(product.stock_qty) < 0:
        raise HTTPException(status_code=400, detail="stock_qty must be >= 0")
    if getattr(product, "stock_alert_level", 0) is not None and int(product.stock_alert_level) < 0:
        raise HTTPException(status_code=400, detail="stock_alert_level must be >= 0")
    product.stock_alert_enabled = bool(getattr(product, "stock_alert_enabled", False))
    product.stock_qty = int(getattr(product, "stock_qty", 0) or 0)
    product.stock_alert_level = int(getattr(product, "stock_alert_level", 0) or 0)
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


@app.put("/products/{product_id}")
def update_product(
    product_id: int,
    product_update: models.ProductUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> models.Product:
    product = session.exec(
        select(models.Product).where(
            models.Product.id == product_id,
            models.Product.tenant_id == current_user.tenant_id,
        )
    ).first()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    if product_update.name is not None:
        product.name = product_update.name
    if product_update.price_cents is not None:
        product.price_cents = product_update.price_cents
    if product_update.cost_cents is not None:
        product.cost_cents = product_update.cost_cents
    if product_update.ingredients is not None:
        product.ingredients = product_update.ingredients
    if product_update.category is not None:
        from .category_codes import normalize_product_category

        product.category = normalize_product_category(product_update.category)
    if product_update.subcategory is not None:
        product.subcategory = product_update.subcategory
    if product_update.tax_id is not None:
        if product_update.tax_id:
            tax = session.get(models.Tax, product_update.tax_id)
            if not tax or tax.tenant_id != current_user.tenant_id:
                raise HTTPException(status_code=400, detail="Invalid tax")
        product.tax_id = product_update.tax_id or None
    if product_update.available_from is not None:
        product.available_from = product_update.available_from
    if product_update.available_until is not None:
        product.available_until = product_update.available_until

    pu = product_update.model_dump(exclude_unset=True)
    if "kitchen_station_id" in pu:
        val = pu["kitchen_station_id"]
        if val is None:
            product.kitchen_station_id = None
        else:
            try:
                validate_kitchen_station_belongs(session, int(val), current_user.tenant_id)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid kitchen station")
            product.kitchen_station_id = int(val)
    if "stock_alert_enabled" in pu:
        product.stock_alert_enabled = bool(pu["stock_alert_enabled"])
    if "stock_qty" in pu:
        qty = int(pu["stock_qty"] if pu["stock_qty"] is not None else 0)
        if qty < 0:
            raise HTTPException(status_code=400, detail="stock_qty must be >= 0")
        product.stock_qty = qty
    if "stock_alert_level" in pu:
        level = int(pu["stock_alert_level"] if pu["stock_alert_level"] is not None else 0)
        if level < 0:
            raise HTTPException(status_code=400, detail="stock_alert_level must be >= 0")
        product.stock_alert_level = level

    session.add(product)
    # Sync availability dates to linked TenantProduct(s) so customer menu stays consistent
    if product_update.available_from is not None or product_update.available_until is not None:
        linked = session.exec(
            select(models.TenantProduct).where(
                models.TenantProduct.product_id == product.id,
                models.TenantProduct.tenant_id == current_user.tenant_id,
            )
        ).all()
        for tp in linked:
            if product_update.available_from is not None:
                tp.available_from = product_update.available_from
            if product_update.available_until is not None:
                tp.available_until = product_update.available_until
            session.add(tp)
    session.commit()
    session.refresh(product)
    return product


def _clear_product_references_before_delete(
    session: Session,
    tenant_id: int,
    product_ids: list[int],
) -> None:
    """Unlink or remove rows that reference product before delete (DB FKs may lack ON DELETE)."""
    if not product_ids:
        return
    for tp in session.exec(
        select(models.TenantProduct).where(
            models.TenantProduct.tenant_id == tenant_id,
            models.TenantProduct.product_id.in_(product_ids),
        )
    ).all():
        session.delete(tp)
    for recipe in session.exec(
        select(inventory_models.ProductRecipe).where(
            inventory_models.ProductRecipe.tenant_id == tenant_id,
            inventory_models.ProductRecipe.product_id.in_(product_ids),
        )
    ).all():
        session.delete(recipe)


@app.delete("/products/all")
def delete_all_products(
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    """Delete every product for the current tenant."""
    products = session.exec(
        select(models.Product).where(models.Product.tenant_id == current_user.tenant_id)
    ).all()
    product_ids = [p.id for p in products if p.id is not None]
    count = len(products)
    _clear_product_references_before_delete(session, current_user.tenant_id, product_ids)
    for product in products:
        session.delete(product)
    session.commit()
    return {"status": "deleted", "count": count}


@app.delete("/products/{product_id}")
def delete_product(
    product_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    product = session.exec(
        select(models.Product).where(
            models.Product.id == product_id,
            models.Product.tenant_id == current_user.tenant_id,
        )
    ).first()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    _clear_product_references_before_delete(session, current_user.tenant_id, [product_id])
    session.delete(product)
    session.commit()
    return {"status": "deleted", "id": product_id}


@app.post("/products/{product_id}/image")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_upload_per_hour', 10)}/hour",
    key_func=_rate_limit_key_user,
)
async def upload_product_image(
    request: Request,
    product_id: int,
    file: Annotated[UploadFile, File()],
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> JSONResponse:
    """Upload an image for a product. Validates file type and size."""
    product = session.exec(
        select(models.Product).where(
            models.Product.id == product_id,
            models.Product.tenant_id == current_user.tenant_id,
        )
    ).first()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Read file and check size (before content-type sniff; GitHub #40)
    contents = await file.read()
    if len(contents) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Max size: {MAX_IMAGE_SIZE // (1024 * 1024)}MB",
        )

    content_type = _resolve_raster_image_content_type(file, contents)
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(sorted(ALLOWED_IMAGE_TYPES))}",
        )

    # Optimize image locally
    contents = optimize_image(contents, content_type)

    # Create tenant upload directory
    tenant_dir = UPLOADS_DIR / str(current_user.tenant_id) / "products"
    tenant_dir.mkdir(parents=True, exist_ok=True)

    # Delete old image if exists (tenant path or catalog providers/... path)
    _delete_product_image_on_disk(product.image_filename, current_user.tenant_id)

    # Generate unique filename
    ext = Path(file.filename or "image.jpg").suffix.lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp", ".avif"]:
        ext = ".jpg"
    new_filename = f"{uuid4()}{ext}"

    # Save file
    file_path = tenant_dir / new_filename
    file_path.write_bytes(contents)

    # Update product
    product.image_filename = new_filename
    session.add(product)
    session.commit()
    session.refresh(product)

    # Get file size for response
    image_size = get_file_size(file_path)
    product_dict = product.model_dump(mode="json")
    product_dict["image_size_bytes"] = image_size
    product_dict["image_size_formatted"] = format_file_size(image_size)

    # JSONResponse so slowapi can inject rate-limit headers (requires a Response instance)
    return JSONResponse(content=product_dict, status_code=status.HTTP_200_OK)



# ============ PROVIDERS ============


@app.get("/providers")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def list_providers(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.CATALOG_READ))],
    session: Session = Depends(get_session),
    active_only: bool = True,
) -> list[models.Provider]:
    """List product providers: global (tenant_id is null) and this tenant's personal providers."""
    query = select(models.Provider).where(
        (models.Provider.tenant_id.is_(None)) | (models.Provider.tenant_id == current_user.tenant_id)
    )
    if active_only:
        query = query.where(models.Provider.is_active == True)
    return session.exec(query.order_by(models.Provider.name)).all()


@app.get("/providers/{provider_id}")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def get_provider(
    request: Request,
    response: Response,
    provider_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.CATALOG_READ))],
    session: Session = Depends(get_session),
) -> models.Provider:
    """Get a specific provider (global or owned by current tenant)."""
    provider = session.exec(
        select(models.Provider).where(models.Provider.id == provider_id)
    ).first()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    if provider.tenant_id is not None and provider.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Provider not found")
    return provider


@app.post("/providers")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def create_provider(
    request: Request,
    response: Response,
    body: models.ProviderCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.CATALOG_WRITE))],
    session: Session = Depends(get_session),
) -> models.Provider:
    """Create a personal provider for the current tenant (owner/admin). Name is unique per tenant."""
    if current_user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Tenant required")
    existing = session.exec(
        select(models.Provider).where(
            models.Provider.tenant_id == current_user.tenant_id,
            models.Provider.name == body.name,
        )
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="A provider with this name already exists")
    provider = models.Provider(
        tenant_id=current_user.tenant_id,
        name=body.name,
        url=body.url,
        full_company_name=body.full_company_name,
        address=body.address,
        tax_number=body.tax_number,
        phone=body.phone,
        email=body.email,
    )
    session.add(provider)
    session.commit()
    session.refresh(provider)
    return provider


@app.patch("/providers/{provider_id}")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def update_personal_provider(
    request: Request,
    response: Response,
    provider_id: int,
    body: models.PersonalProviderUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.CATALOG_WRITE))],
    session: Session = Depends(get_session),
) -> models.Provider:
    """Update a tenant-owned (personal) provider. Global/catalog providers cannot be edited here."""
    if current_user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Tenant required")
    provider = session.exec(
        select(models.Provider).where(models.Provider.id == provider_id)
    ).first()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    if provider.tenant_id is None:
        raise HTTPException(
            status_code=403,
            detail="Catalog providers cannot be edited from restaurant settings",
        )
    if provider.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Provider not found")

    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        new_name = (data["name"] or "").strip()
        if not new_name:
            raise HTTPException(status_code=422, detail="Name cannot be empty")
        if new_name != provider.name:
            existing = session.exec(
                select(models.Provider).where(
                    models.Provider.tenant_id == current_user.tenant_id,
                    models.Provider.name == new_name,
                    models.Provider.id != provider.id,
                )
            ).first()
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail="A provider with this name already exists",
                )
        provider.name = new_name
    str_fields = (
        "url",
        "full_company_name",
        "address",
        "tax_number",
        "phone",
        "email",
    )
    for key in str_fields:
        if key not in data:
            continue
        val = data[key]
        if val is None:
            setattr(provider, key, None)
        else:
            s = str(val).strip()
            setattr(provider, key, s or None)
    if "is_active" in data and data["is_active"] is not None:
        provider.is_active = bool(data["is_active"])

    session.add(provider)
    session.commit()
    session.refresh(provider)
    return provider


# ============ PRODUCT CATALOG ============


@app.get("/catalog")
async def list_catalog(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.CATALOG_READ))],
    session: Session = Depends(get_session),
    category: str | None = None,
    subcategory: str | None = None,
    search: str | None = None,
):
    """List products from catalog with price comparison across providers."""
    query = select(models.ProductCatalog)

    if category:
        query = query.where(models.ProductCatalog.category == category)
    if subcategory:
        query = query.where(models.ProductCatalog.subcategory == subcategory)
    if search:
        search_term = f"%{search.lower()}%"
        query = query.where(
            (models.ProductCatalog.name.ilike(search_term))
            | (models.ProductCatalog.description.ilike(search_term))
        )

    catalog_items = session.exec(query.order_by(models.ProductCatalog.name)).all()

    result = []
    for item in catalog_items:
        # Get all provider products for this catalog item
        provider_products = session.exec(
            select(models.ProviderProduct).where(
                models.ProviderProduct.catalog_id == item.id,
                models.ProviderProduct.availability == True,
            )
        ).all()

        # Get provider info
        providers_data = []
        for pp in provider_products:
            provider = session.exec(
                select(models.Provider).where(models.Provider.id == pp.provider_id)
            ).first()
            if provider and provider.tenant_id in (None, current_user.tenant_id):
                # Local images only; omit URL when file is missing (avoids catalog 404s)
                image_url = provider_product_image_url(provider.token, pp.image_filename)

                providers_data.append(
                    {
                        "provider_id": provider.id,
                        "provider_name": provider.name,
                        "provider_product_id": pp.id,
                        "price_cents": pp.price_cents,
                        "image_url": image_url,
                        "country": pp.country,
                        "region": pp.region,
                        "grape_variety": pp.grape_variety,
                        "volume_ml": pp.volume_ml,
                        "unit": pp.unit,
                        "detailed_description": pp.detailed_description,
                        "wine_style": pp.wine_style,
                        "vintage": pp.vintage,
                        "winery": pp.winery,
                        "aromas": pp.aromas,
                        "elaboration": pp.elaboration,
                    }
                )

        # Sort providers by price (lowest first)
        providers_data.sort(
            key=lambda x: x["price_cents"] if x["price_cents"] else float("inf")
        )

        # Get main image from first provider (if available)
        main_image_url = None
        if providers_data and providers_data[0].get("image_url"):
            main_image_url = providers_data[0]["image_url"]

        # Get origin (country/region) and detailed info from first provider - this is product-level info
        origin_country = None
        origin_region = None
        detailed_description = None
        wine_style = None
        vintage = None
        winery = None
        grape_variety = None
        aromas = None
        elaboration = None

        if providers_data:
            # Use first provider's data (most common case)
            origin_country = providers_data[0].get("country")
            origin_region = providers_data[0].get("region")
            detailed_description = providers_data[0].get("detailed_description")
            wine_style = providers_data[0].get("wine_style")
            vintage = providers_data[0].get("vintage")
            winery = providers_data[0].get("winery")
            grape_variety = providers_data[0].get("grape_variety")
            aromas = providers_data[0].get("aromas")
            elaboration = providers_data[0].get("elaboration")

        result.append(
            {
                "id": item.id,
                "name": item.name,
                "description": item.description,
                "detailed_description": detailed_description,
                "category": item.category,
                "subcategory": item.subcategory,
                "barcode": item.barcode,
                "brand": item.brand,
                "image_url": main_image_url,
                "country": origin_country,
                "region": origin_region,
                "wine_style": wine_style,
                "vintage": vintage,
                "winery": winery,
                "grape_variety": grape_variety,
                "aromas": aromas,
                "elaboration": elaboration,
                "providers": providers_data,
                "min_price_cents": min(
                    [p["price_cents"] for p in providers_data if p["price_cents"]],
                    default=None,
                ),
                "max_price_cents": max(
                    [p["price_cents"] for p in providers_data if p["price_cents"]],
                    default=None,
                ),
            }
        )

    return JSONResponse(content=result)


@app.get("/catalog/categories")
async def get_catalog_categories(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.CATALOG_READ))],
    session: Session = Depends(get_session),
) -> dict:
    """Get categories and subcategories: catalog + tenant custom + product-derived."""
    from .tenant_subcategories import tenant_categories_for_ui

    return JSONResponse(
        content=tenant_categories_for_ui(session, current_user.tenant_id)
    )


@app.get("/tenant/categories/labels")
def get_tenant_category_labels(
    current_user: Annotated[models.User, Depends(require_permission(Permission.CATALOG_READ))],
    session: Session = Depends(get_session),
) -> dict[str, str]:
    """Tenant-chosen display name overrides for standard categories (e.g. renamed 'Main Course')."""
    from .tenant_subcategories import category_label_overrides

    return category_label_overrides(session, current_user.tenant_id)


class CategoryRenameBody(_BaseModel):
    old_name: str = Field(max_length=128)
    new_name: str = Field(max_length=128)


@app.put("/tenant/categories")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def rename_tenant_category(
    request: Request,
    response: Response,
    body: CategoryRenameBody,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> dict[str, list[str]]:
    """Rename any category (standard or custom). See tenant_subcategories.rename_category."""
    from .tenant_subcategories import rename_category

    try:
        return rename_category(session, current_user.tenant_id, body.old_name, body.new_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


class CategoryDeleteBody(_BaseModel):
    name: str = Field(max_length=128)


@app.delete("/tenant/categories")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def delete_tenant_category(
    request: Request,
    response: Response,
    body: CategoryDeleteBody,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> dict[str, list[str]]:
    """Delete a custom category. See tenant_subcategories.delete_category."""
    from .tenant_subcategories import delete_category

    try:
        return delete_category(session, current_user.tenant_id, body.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


# ============ PROVIDER PRODUCTS ============


@app.get("/providers/{provider_id}/products")
def list_provider_products(
    provider_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.CATALOG_READ))],
    session: Session = Depends(get_session),
) -> list[models.ProviderProduct]:
    """List all products from a specific provider (global or owned by current tenant)."""
    provider = session.exec(
        select(models.Provider).where(models.Provider.id == provider_id)
    ).first()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    if provider.tenant_id is not None and provider.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Provider not found")

    return session.exec(
        select(models.ProviderProduct)
        .where(models.ProviderProduct.provider_id == provider_id)
        .order_by(models.ProviderProduct.name)
    ).all()


@app.post("/providers/{provider_id}/products")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def create_provider_product_for_tenant(
    request: Request,
    provider_id: int,
    body: models.ProviderProductCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.CATALOG_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    """Create a product on a tenant-owned (personal) provider. Only allowed when provider.tenant_id == current tenant."""
    provider = session.exec(
        select(models.Provider).where(models.Provider.id == provider_id)
    ).first()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    if provider.tenant_id is None or provider.tenant_id != current_user.tenant_id:
        raise HTTPException(
            status_code=403,
            detail="You can only add products to providers you created",
        )
    try:
        catalog_id = body.catalog_id
        if catalog_id is not None:
            catalog_item = session.get(models.ProductCatalog, catalog_id)
            if not catalog_item:
                raise HTTPException(status_code=404, detail="Catalog item not found")
            name = body.name or catalog_item.name
        else:
            normalized = _catalog_normalized_name(body.name)
            existing = session.exec(
                select(models.ProductCatalog).where(
                    models.ProductCatalog.normalized_name == normalized
                )
            ).first()
            if existing:
                catalog_item = existing
                name = body.name or catalog_item.name
            else:
                catalog_item = models.ProductCatalog(
                    name=body.name,
                    normalized_name=normalized,
                    category=body.category,
                    subcategory=body.subcategory,
                    description=body.description,
                    brand=body.brand,
                    barcode=body.barcode,
                )
                session.add(catalog_item)
                session.commit()
                session.refresh(catalog_item)
                name = body.name
            catalog_id = catalog_item.id
        external_id = body.external_id or f"pp-{provider.id}-{uuid4().hex[:12]}"
        pp = models.ProviderProduct(
            catalog_id=catalog_id,
            provider_id=provider.id,
            external_id=external_id,
            name=name,
            price_cents=body.price_cents,
            availability=body.availability,
            country=body.country,
            region=body.region,
            grape_variety=body.grape_variety,
            volume_ml=body.volume_ml,
            unit=body.unit,
            detailed_description=body.detailed_description,
            wine_style=body.wine_style,
            vintage=body.vintage,
            winery=body.winery,
            aromas=body.aromas,
            elaboration=body.elaboration,
        )
        session.add(pp)
        session.commit()
        session.refresh(pp)
        return pp.model_dump(mode="json")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        session.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create product: {e!s}",
        ) from e


def _catalog_normalized_name(name: str) -> str:
    """Normalize product name for catalog matching."""
    return " ".join(name.lower().strip().split())


# ============ COURIER PORTAL (courier-scoped auth) ============


@app.get("/courier/me")
def courier_me(
    current_user: Annotated[models.User, Depends(security.get_current_courier_user)],
    session: Session = Depends(get_session),
) -> dict:
    """Return current courier profile and tenant context."""
    tenant = session.get(models.Tenant, current_user.tenant_id) if current_user.tenant_id else None
    return {
        "id": current_user.id,
        "username": current_user.username,
        "full_name": current_user.full_name,
        "role": current_user.role.value,
        "tenant_id": current_user.tenant_id,
        "tenant_name": tenant.name if tenant else None,
    }


def _courier_active_order_items(items: list[models.OrderItem]) -> list[models.OrderItem]:
    return [
        item
        for item in items
        if not item.removed_by_customer
        and item.removed_by_user_id is None
        and item.status != models.OrderItemStatus.cancelled
    ]


def _courier_item_summary(items: list[models.OrderItem]) -> str:
    active = _courier_active_order_items(items)
    return ", ".join(f"{item.quantity}× {item.product_name}" for item in active)


def _courier_effective_order_status(
    order: models.Order, all_items: list[models.OrderItem]
) -> models.OrderStatus:
    # Preserve terminal and courier-in-transit statuses; otherwise derive from items.
    if order.status in (
        models.OrderStatus.paid,
        models.OrderStatus.cancelled,
        models.OrderStatus.out_for_delivery,
    ):
        return order.status
    return compute_order_status_from_items(all_items)


_COURIER_OPEN_STATUSES = frozenset(
    {
        models.OrderStatus.pending,
        models.OrderStatus.preparing,
        models.OrderStatus.ready,
        models.OrderStatus.out_for_delivery,
        models.OrderStatus.partially_delivered,
    }
)


def _courier_allowed_actions(
    order: models.Order,
    *,
    courier_user_id: int,
    status: models.OrderStatus,
) -> list[str]:
    """Which courier mutations the current courier may run on this order."""
    if status not in _COURIER_OPEN_STATUSES:
        return []
    assigned = getattr(order, "courier_user_id", None)
    if assigned is None:
        return [models.CourierOrderActionType.accept.value]
    if assigned != courier_user_id:
        return []
    actions: list[str] = []
    # Decline assignment only before leaving the restaurant.
    if status != models.OrderStatus.out_for_delivery:
        actions.append(models.CourierOrderActionType.reject.value)
    # "Picked up" (-> out_for_delivery) is offered any time before it's already in transit,
    # since kitchen item statuses (pending/preparing/ready) aren't always kept up to date.
    if status in (
        models.OrderStatus.pending,
        models.OrderStatus.preparing,
        models.OrderStatus.ready,
    ):
        actions.append(models.CourierOrderActionType.picked_up.value)
    # Delivered only once the order is actually in transit (or partially delivered, to
    # finish off any remaining items) — the courier must confirm "on the way" first.
    if status in (
        models.OrderStatus.out_for_delivery,
        models.OrderStatus.partially_delivered,
    ):
        actions.append(models.CourierOrderActionType.delivered.value)
    return actions


def _courier_load_delivery_order(
    session: Session, tenant_id: int, order_id: int
) -> models.Order | None:
    return session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == tenant_id,
            models.Order.deleted_at.is_(None),
            or_(
                models.Order.delivery_integration_id.is_not(None),
                models.Order.order_channel == models.OrderChannel.satisfecho_delivery,
            ),
        )
    ).first()


def _courier_pickup_context(session: Session, tenant_id: int) -> tuple[str | None, str | None]:
    tenant = session.get(models.Tenant, tenant_id)
    if not tenant:
        return None, None
    return tenant.name, tenant.address


def _courier_order_base_query(tenant_id: int):
    """Marketplace (integration) or first-party Satisfecho Delivery orders."""
    return (
        select(models.Order)
        .where(
            models.Order.tenant_id == tenant_id,
            models.Order.deleted_at.is_(None),
            or_(
                models.Order.delivery_integration_id.is_not(None),
                models.Order.order_channel == models.OrderChannel.satisfecho_delivery,
            ),
        )
        .order_by(models.Order.created_at.desc())
    )


def _order_channel_value(order: models.Order) -> str:
    ch = getattr(order, "order_channel", None)
    if ch is None:
        if getattr(order, "delivery_integration_id", None):
            return models.OrderChannel.marketplace.value
        return models.OrderChannel.table.value
    return ch.value if hasattr(ch, "value") else str(ch)


def _serialize_courier_order_summary(
    session: Session,
    order: models.Order,
    *,
    pickup_name: str | None,
    pickup_address: str | None,
    courier_user_id: int | None = None,
) -> dict:
    all_items = session.exec(
        select(models.OrderItem).where(models.OrderItem.order_id == order.id)
    ).all()
    active_items = _courier_active_order_items(all_items)
    if not active_items:
        return {}
    status = _courier_effective_order_status(order, all_items)
    total_cents = sum(item.price_cents * item.quantity for item in active_items)
    tenant = session.get(models.Tenant, order.tenant_id)
    row = {
        "id": order.id,
        "status": status.value,
        "customer_name": order.customer_name,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "item_summary": _courier_item_summary(all_items),
        "pickup_name": pickup_name,
        "pickup_address": pickup_address,
        "delivery_address": getattr(order, "delivery_address", None),
        "customer_phone": getattr(order, "customer_phone", None),
        "courier_user_id": getattr(order, "courier_user_id", None),
        "order_channel": _order_channel_value(order),
        "total_cents": total_cents,
        "currency_code": "COP",
        "currency": "$",
    }
    if courier_user_id is not None:
        row["allowed_actions"] = _courier_allowed_actions(
            order, courier_user_id=courier_user_id, status=status
        )
    return row


def _serialize_courier_order_detail(
    session: Session,
    order: models.Order,
    *,
    pickup_name: str | None,
    pickup_address: str | None,
    courier_user_id: int | None = None,
) -> dict:
    all_items = session.exec(
        select(models.OrderItem).where(models.OrderItem.order_id == order.id)
    ).all()
    active_items = _courier_active_order_items(all_items)
    if not active_items:
        return {}
    status = _courier_effective_order_status(order, all_items)
    total_cents = sum(item.price_cents * item.quantity for item in active_items)
    tenant = session.get(models.Tenant, order.tenant_id)
    items_json = [
        {
            "product_name": item.product_name,
            "quantity": item.quantity,
            "notes": item.notes,
        }
        for item in active_items
    ]
    detail = {
        "id": order.id,
        "status": status.value,
        "customer_name": order.customer_name,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "item_summary": _courier_item_summary(all_items),
        "pickup_name": pickup_name,
        "pickup_address": pickup_address,
        "delivery_notes": order.notes,
        "delivery_address": getattr(order, "delivery_address", None),
        "customer_phone": getattr(order, "customer_phone", None),
        "order_channel": _order_channel_value(order),
        "courier_user_id": getattr(order, "courier_user_id", None),
        "external_order_ref": order.external_order_ref,
        "total_cents": total_cents,
        "currency_code": "COP",
        "currency": "$",
        "items": items_json,
    }
    if courier_user_id is not None:
        detail["allowed_actions"] = _courier_allowed_actions(
            order, courier_user_id=courier_user_id, status=status
        )
    return detail


@app.get("/courier/orders")
def courier_list_orders(
    current_user: Annotated[models.User, Depends(security.get_current_courier_user)],
    session: Session = Depends(get_session),
) -> list[dict]:
    """List delivery orders for the courier's tenant.

    Includes assignment fields (`courier_user_id`, address, phone, totals) so the
    courier UI can split Available / Mine / Completed. Tenant-scoped only.
    """
    tenant_id = current_user.tenant_id
    assert tenant_id is not None
    pickup_name, pickup_address = _courier_pickup_context(session, tenant_id)
    orders = session.exec(_courier_order_base_query(tenant_id)).all()
    result: list[dict] = []
    for order in orders:
        row = _serialize_courier_order_summary(
            session,
            order,
            pickup_name=pickup_name,
            pickup_address=pickup_address,
            courier_user_id=current_user.id,
        )
        if row:
            result.append(row)
    return result


@app.get("/courier/orders/{order_id}")
def courier_get_order(
    order_id: int,
    current_user: Annotated[models.User, Depends(security.get_current_courier_user)],
    session: Session = Depends(get_session),
) -> dict:
    """Return one delivery order for the courier's tenant."""
    tenant_id = current_user.tenant_id
    assert tenant_id is not None
    order = _courier_load_delivery_order(session, tenant_id, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    pickup_name, pickup_address = _courier_pickup_context(session, tenant_id)
    detail = _serialize_courier_order_detail(
        session,
        order,
        pickup_name=pickup_name,
        pickup_address=pickup_address,
        courier_user_id=current_user.id,
    )
    if not detail:
        raise HTTPException(status_code=404, detail="Order not found")
    return detail


@app.post("/courier/orders/{order_id}/actions")
def courier_order_action(
    order_id: int,
    body: models.CourierOrderAction,
    current_user: Annotated[models.User, Depends(security.get_current_courier_user)],
    session: Session = Depends(get_session),
) -> dict:
    """Courier fulfillment actions: accept, reject, picked_up, delivered.

    Updates Order / OrderItem consistently with kitchen semantics:
    - accept: claim unassigned open delivery (`courier_user_id`)
    - reject: clear own assignment before pickup
    - picked_up: ready → out_for_delivery (items stay ready)
    - delivered: mark active items delivered → order completed
    """
    tenant_id = current_user.tenant_id
    assert tenant_id is not None
    assert current_user.id is not None
    order = _courier_load_delivery_order(session, tenant_id, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    all_items = session.exec(
        select(models.OrderItem).where(models.OrderItem.order_id == order.id)
    ).all()
    active_items = _courier_active_order_items(all_items)
    if not active_items:
        raise HTTPException(status_code=404, detail="Order not found")

    status = _courier_effective_order_status(order, all_items)
    allowed = _courier_allowed_actions(
        order, courier_user_id=current_user.id, status=status
    )
    action = body.action.value if hasattr(body.action, "value") else str(body.action)
    if action not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Action '{action}' not allowed for this order (status={status.value})",
        )

    if action == models.CourierOrderActionType.delivered.value and body.payment_method is None:
        raise HTTPException(
            status_code=400,
            detail="payment_method is required ('cash' or 'transfer') to mark an order as delivered",
        )

    now = datetime.now(timezone.utc)
    if action == models.CourierOrderActionType.accept.value:
        order.courier_user_id = current_user.id
    elif action == models.CourierOrderActionType.reject.value:
        order.courier_user_id = None
    elif action == models.CourierOrderActionType.picked_up.value:
        order.status = models.OrderStatus.out_for_delivery
    elif action == models.CourierOrderActionType.delivered.value:
        payment_method = (
            body.payment_method.value
            if hasattr(body.payment_method, "value")
            else str(body.payment_method)
        )
        for item in active_items:
            if item.status != models.OrderItemStatus.delivered:
                item.status = models.OrderItemStatus.delivered
                item.status_updated_at = now
                item.delivered_by_user_id = current_user.id
                session.add(item)
        order.status = compute_order_status_from_items(list(all_items))
        session.add(order)
        session.flush()

        # Cash-on-delivery / transfer-on-delivery: the courier just collected the payment,
        # so settle the order's remaining balance now instead of leaving it "unpaid" until
        # staff manually confirms it in Pedidos.
        due = order_pay_svc.order_due_cents(session, order, include_tip=True)
        already_paid = order_pay_svc.amount_paid_cents(session, order.id)
        remaining = max(0, due - already_paid)
        if remaining > 0:
            order_pay_svc.record_payment(
                session,
                order=order,
                amount_cents=remaining,
                payment_method=payment_method,
                paid_by_user_id=current_user.id,
                note="Courier delivery settlement",
                settle_if_covered=True,
            )
            session.refresh(order)
        elif order.paid_at is None:
            order.paid_at = now
            order.paid_by_user_id = current_user.id
            order.payment_method = payment_method
            order.status = order_pay_svc.status_after_full_payment(session, order)
            session.add(order)

    session.add(order)
    session.commit()
    session.refresh(order)

    publish_order_update(
        tenant_id,
        {
            "type": "courier_action",
            "order_id": order.id,
            "action": action,
            "status": order.status.value,
            "courier_user_id": order.courier_user_id,
            "table_name": "Domicilio"
            if _order_channel_value(order) == models.OrderChannel.satisfecho_delivery.value
            else "Delivery",
        },
        table_id=order.table_id,
    )

    pickup_name, pickup_address = _courier_pickup_context(session, tenant_id)
    detail = _serialize_courier_order_detail(
        session,
        order,
        pickup_name=pickup_name,
        pickup_address=pickup_address,
        courier_user_id=current_user.id,
    )
    if not detail:
        raise HTTPException(status_code=404, detail="Order not found")
    return detail


# ============ TENANT PRODUCTS ============


@app.get("/tenant-products")
def list_tenant_products(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_READ))],
    session: Session = Depends(get_session),
    active_only: bool = True,
) -> list[dict]:
    """List products selected by the tenant (restaurant)."""
    query = select(models.TenantProduct).where(
        models.TenantProduct.tenant_id == current_user.tenant_id
    )

    if active_only:
        query = query.where(models.TenantProduct.is_active == True)

    tenant_products = session.exec(query.order_by(models.TenantProduct.name)).all()

    result = []
    for tp in tenant_products:
        # Get catalog item info
        catalog_item = session.exec(
            select(models.ProductCatalog).where(
                models.ProductCatalog.id == tp.catalog_id
            )
        ).first()

        # Get provider product info if linked
        provider_info = None
        if tp.provider_product_id:
            provider_product = session.exec(
                select(models.ProviderProduct).where(
                    models.ProviderProduct.id == tp.provider_product_id
                )
            ).first()
            if provider_product:
                provider = session.exec(
                    select(models.Provider).where(
                        models.Provider.id == provider_product.provider_id
                    )
                ).first()
                if provider:
                    provider_info = {
                        "provider_id": provider.id,
                        "provider_name": provider.name,
                        "provider_price_cents": provider_product.price_cents,
                    }

        result.append(
            {
                "id": tp.id,
                "name": tp.name,
                "price_cents": tp.price_cents,
                "image_filename": tp.image_filename,
                "ingredients": tp.ingredients,
                "is_active": tp.is_active,
                "catalog_id": tp.catalog_id,
                "catalog_name": catalog_item.name if catalog_item else None,
                "provider_info": provider_info,
                "product_id": tp.product_id,  # For backward compatibility
                "available_from": tp.available_from.isoformat() if tp.available_from else None,
                "available_until": tp.available_until.isoformat() if tp.available_until else None,
                "tenant_id": tp.tenant_id,
                "is_shared": tp.tenant_id != current_user.tenant_id,
            }
        )

    return JSONResponse(content=result)


@app.post("/tenant-products")
def create_tenant_product(
    product_data: models.TenantProductCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> models.TenantProduct:
    """Add a product from catalog to tenant's menu.

    This creates BOTH:
    1. A Product entry (shows on /products page)
    2. A TenantProduct entry (links to catalog for metadata)
    """
    # Get catalog item
    catalog_item = session.exec(
        select(models.ProductCatalog).where(
            models.ProductCatalog.id == product_data.catalog_id
        )
    ).first()
    if not catalog_item:
        raise HTTPException(status_code=404, detail="Catalog item not found")

    # Get provider product for additional info if specified
    provider_product = None
    if product_data.provider_product_id:
        provider_product = session.exec(
            select(models.ProviderProduct).where(
                models.ProviderProduct.id == product_data.provider_product_id,
                models.ProviderProduct.catalog_id == product_data.catalog_id,
            )
        ).first()
        if not provider_product:
            raise HTTPException(
                status_code=404,
                detail="Provider product not found or doesn't match catalog",
            )
        _owner = session.get(models.Provider, provider_product.provider_id)
        if _owner is None or _owner.tenant_id not in (None, current_user.tenant_id):
            raise HTTPException(
                status_code=404,
                detail="Provider product not found or doesn't match catalog",
            )

    # Use catalog name if name not provided
    product_name = product_data.name or catalog_item.name

    # Determine price
    price_cents = product_data.price_cents
    if price_cents is None and provider_product:
        price_cents = provider_product.price_cents
    if price_cents is None:
        raise HTTPException(status_code=400, detail="Price is required")
    # Cost: optional; default from provider price when adding from catalog
    cost_cents = product_data.cost_cents
    if cost_cents is None and provider_product and provider_product.price_cents is not None:
        cost_cents = provider_product.price_cents

    # Determine category and subcategory from catalog
    category = catalog_item.category
    subcategory = catalog_item.subcategory

    # Get image from provider product if available (only when file exists on disk)
    image_filename = None
    if provider_product and provider_product.image_filename:
        provider = session.exec(
            select(models.Provider).where(
                models.Provider.id == provider_product.provider_id
            )
        ).first()
        if provider:
            image_filename = provider_product_stored_image_path(
                provider.token, provider_product.image_filename
            )

    # 1. Create the actual Product (shows on /products page)
    product = models.Product(
        tenant_id=current_user.tenant_id,
        name=product_name,
        price_cents=price_cents,
        cost_cents=cost_cents,
        description=catalog_item.description,
        image_filename=image_filename,
        category=category,
        subcategory=subcategory,
        available_from=product_data.available_from,
        available_until=product_data.available_until,
    )
    session.add(product)
    session.commit()
    session.refresh(product)

    # 2. Create TenantProduct (links to catalog for metadata tracking)
    tenant_product = models.TenantProduct(
        tenant_id=current_user.tenant_id,
        catalog_id=product_data.catalog_id,
        provider_product_id=product_data.provider_product_id,
        product_id=product.id,  # Link to the actual Product
        name=product_name,
        price_cents=price_cents,
        cost_cents=cost_cents,
        available_from=product_data.available_from,
        available_until=product_data.available_until,
    )

    session.add(tenant_product)
    session.commit()
    session.refresh(tenant_product)

    # 3. Create or find inventory Supplier from Provider (if provider selected)
    inventory_supplier_id = None
    if provider_product:
        provider = session.exec(
            select(models.Provider).where(
                models.Provider.id == provider_product.provider_id
            )
        ).first()
        if provider:
            # Check if Supplier already exists for this provider+tenant
            existing_supplier = session.exec(
                select(inventory_models.Supplier).where(
                    inventory_models.Supplier.tenant_id == current_user.tenant_id,
                    inventory_models.Supplier.code == f"PROV-{provider.id}",
                    inventory_models.Supplier.is_deleted == False,
                )
            ).first()

            if existing_supplier:
                inventory_supplier_id = existing_supplier.id
            else:
                # Create new Supplier from Provider
                new_supplier = inventory_models.Supplier(
                    tenant_id=current_user.tenant_id,
                    name=provider.name,
                    code=f"PROV-{provider.id}",
                    notes=f"Auto-created from catalog provider: {provider.name}",
                )
                session.add(new_supplier)
                session.commit()
                session.refresh(new_supplier)
                inventory_supplier_id = new_supplier.id

    # 4. Create InventoryItem for this product (if inventory tracking enabled)
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()

    if tenant:
        # Generate SKU from catalog info
        sku_base = catalog_item.name[:20].upper().replace(" ", "-").replace(".", "")
        sku = f"CAT-{catalog_item.id}-{sku_base}"

        # Check if InventoryItem already exists (by SKU)
        existing_item = session.exec(
            select(inventory_models.InventoryItem).where(
                inventory_models.InventoryItem.tenant_id == current_user.tenant_id,
                inventory_models.InventoryItem.sku == sku,
                inventory_models.InventoryItem.is_deleted == False,
            )
        ).first()

        if not existing_item:
            # Map catalog category to inventory category
            inv_category = "other"
            if category:
                cat_lower = category.lower()
                if (
                    "wine" in cat_lower
                    or "beverage" in cat_lower
                    or "drink" in cat_lower
                ):
                    inv_category = "beverages"
                elif (
                    "food" in cat_lower or "main" in cat_lower or "starter" in cat_lower
                ):
                    inv_category = "ingredients"

            # Create InventoryItem
            inventory_item = inventory_models.InventoryItem(
                tenant_id=current_user.tenant_id,
                sku=sku,
                name=product_name,
                description=catalog_item.description,
                unit="piece",  # Default to piece for catalog items
                category=inv_category,
                reorder_level=5,  # Default reorder level
                reorder_quantity=10,  # Default reorder quantity
                default_supplier_id=inventory_supplier_id,
                current_quantity=0,  # Start with 0 stock
                average_cost_cents=provider_product.price_cents
                if provider_product and provider_product.price_cents
                else 0,
            )
            session.add(inventory_item)
            session.commit()

    return tenant_product


@app.put("/tenant-products/{tenant_product_id}")
def update_tenant_product(
    tenant_product_id: int,
    product_update: models.TenantProductUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> models.TenantProduct:
    """Update a tenant product."""
    tenant_product = session.exec(
        select(models.TenantProduct).where(
            models.TenantProduct.id == tenant_product_id,
            models.TenantProduct.tenant_id == current_user.tenant_id,
        )
    ).first()

    if not tenant_product:
        raise HTTPException(status_code=404, detail="Tenant product not found")

    partial = product_update.model_dump(exclude_unset=True)
    if product_update.name is not None:
        tenant_product.name = product_update.name
    # DB column is NOT NULL; explicit JSON null must not clear the selling price.
    if "price_cents" in partial and partial["price_cents"] is not None:
        tenant_product.price_cents = partial["price_cents"]
    if product_update.cost_cents is not None:
        tenant_product.cost_cents = product_update.cost_cents
    if product_update.is_active is not None:
        tenant_product.is_active = product_update.is_active
    if product_update.tax_id is not None:
        if product_update.tax_id:
            tax = session.get(models.Tax, product_update.tax_id)
            if not tax or tax.tenant_id != current_user.tenant_id:
                raise HTTPException(status_code=400, detail="Invalid tax")
        tenant_product.tax_id = product_update.tax_id or None
    if product_update.available_from is not None:
        tenant_product.available_from = product_update.available_from
    if product_update.available_until is not None:
        tenant_product.available_until = product_update.available_until

    session.add(tenant_product)
    session.commit()
    session.refresh(tenant_product)
    return tenant_product


@app.delete("/tenant-products/{tenant_product_id}")
def delete_tenant_product(
    tenant_product_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    """Delete a tenant product."""
    tenant_product = session.exec(
        select(models.TenantProduct).where(
            models.TenantProduct.id == tenant_product_id,
            models.TenantProduct.tenant_id == current_user.tenant_id,
        )
    ).first()

    if not tenant_product:
        raise HTTPException(status_code=404, detail="Tenant product not found")

    session.delete(tenant_product)
    session.commit()
    return {"status": "deleted", "id": tenant_product_id}


# ============ FLOORS ============


@app.get("/floors")
def list_floors(
    current_user: Annotated[models.User, Depends(require_permission(Permission.FLOOR_READ))],
    session: Session = Depends(get_session),
) -> list[dict]:
    """List all floors for this tenant, including default waiter info."""
    floors = session.exec(
        select(models.Floor)
        .where(models.Floor.tenant_id == current_user.tenant_id)
        .order_by(models.Floor.sort_order, models.Floor.name)
    ).all()

    # Collect waiter IDs to resolve names in one query
    waiter_ids = {f.default_waiter_id for f in floors if f.default_waiter_id}
    waiter_map: dict[int, str] = {}
    if waiter_ids:
        waiters = session.exec(
            select(models.User).where(models.User.id.in_(waiter_ids))
        ).all()
        waiter_map = {w.id: (w.full_name or w.username) for w in waiters}

    result = []
    for f in floors:
        d = f.model_dump()
        d["default_waiter_name"] = waiter_map.get(f.default_waiter_id) if f.default_waiter_id else None
        result.append(d)
    return result


@app.post("/floors")
def create_floor(
    floor_data: models.FloorCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.FLOOR_WRITE))],
    session: Session = Depends(get_session),
) -> models.Floor:
    """Create a new floor/zone."""
    # Auto-assign sort_order if not provided
    sort_order = floor_data.sort_order
    if sort_order is None:
        max_order = session.exec(
            select(models.Floor.sort_order)
            .where(models.Floor.tenant_id == current_user.tenant_id)
            .order_by(models.Floor.sort_order.desc())
        ).first()
        sort_order = (max_order or 0) + 1

    sz = (
        _parse_floor_seating_zone_for_write(floor_data.seating_zone)
        if floor_data.seating_zone is not None
        else "any"
    )
    floor = models.Floor(
        name=floor_data.name,
        sort_order=sort_order,
        tenant_id=current_user.tenant_id,
        is_active=floor_data.is_active if floor_data.is_active is not None else True,
        seating_zone=sz,
    )
    session.add(floor)
    session.commit()
    session.refresh(floor)
    return floor


@app.put("/floors/{floor_id}")
def update_floor(
    floor_id: int,
    floor_update: models.FloorUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.FLOOR_WRITE))],
    session: Session = Depends(get_session),
) -> models.Floor:
    """Update a floor."""
    floor = session.exec(
        select(models.Floor).where(
            models.Floor.id == floor_id,
            models.Floor.tenant_id == current_user.tenant_id,
        )
    ).first()

    if not floor:
        raise HTTPException(status_code=404, detail="Floor not found")

    if floor_update.name is not None:
        floor.name = floor_update.name
    if floor_update.sort_order is not None:
        floor.sort_order = floor_update.sort_order
    if floor_update.default_waiter_id is not None:
        if floor_update.default_waiter_id == 0:
            floor.default_waiter_id = None
        else:
            waiter = session.exec(
                select(models.User).where(
                    models.User.id == floor_update.default_waiter_id,
                    models.User.tenant_id == current_user.tenant_id,
                    models.User.role == models.UserRole.waiter,
                )
            ).first()
            if not waiter:
                raise HTTPException(status_code=400, detail="Waiter not found")
            floor.default_waiter_id = waiter.id
    if floor_update.is_active is not None:
        floor.is_active = floor_update.is_active
    if floor_update.seating_zone is not None:
        floor.seating_zone = _parse_floor_seating_zone_for_write(floor_update.seating_zone)

    session.add(floor)
    session.commit()
    session.refresh(floor)
    return floor


@app.delete("/floors/{floor_id}")
def delete_floor(
    floor_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.FLOOR_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    """Delete a floor. Tables on this floor will have floor_id set to null."""
    floor = session.exec(
        select(models.Floor).where(
            models.Floor.id == floor_id,
            models.Floor.tenant_id == current_user.tenant_id,
        )
    ).first()

    if not floor:
        raise HTTPException(status_code=404, detail="Floor not found")

    session.delete(floor)
    session.commit()
    return {"status": "deleted", "id": floor_id}


@app.put("/floors/{floor_id}/assign-waiter")
def assign_waiter_to_floor(
    floor_id: int,
    body: dict,
    current_user: Annotated[models.User, Depends(require_permission(Permission.TABLE_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    """Assign a default waiter to a floor. Send waiter_id=null to unassign."""
    floor = session.exec(
        select(models.Floor).where(
            models.Floor.id == floor_id,
            models.Floor.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not floor:
        raise HTTPException(status_code=404, detail="Floor not found")

    waiter_id = body.get("waiter_id")
    if waiter_id is not None:
        waiter = session.exec(
            select(models.User).where(
                models.User.id == waiter_id,
                models.User.tenant_id == current_user.tenant_id,
                models.User.role == models.UserRole.waiter,
            )
        ).first()
        if not waiter:
            raise HTTPException(status_code=400, detail="Waiter not found or not a waiter role")
        floor.default_waiter_id = waiter.id
    else:
        floor.default_waiter_id = None

    session.add(floor)
    session.commit()
    session.refresh(floor)

    # Resolve waiter name for response
    waiter_name = None
    if floor.default_waiter_id:
        w = session.get(models.User, floor.default_waiter_id)
        waiter_name = w.full_name or w.username if w else None

    return {
        "floor_id": floor.id,
        "default_waiter_id": floor.default_waiter_id,
        "default_waiter_name": waiter_name,
    }


# ============ WORKING PLAN (SCHEDULE) ============

def _shift_to_dict(shift: models.Shift, user_name: str, user_role: str) -> dict:
    """Build shift response with user name and role."""
    return {
        "id": shift.id,
        "tenant_id": shift.tenant_id,
        "user_id": shift.user_id,
        "user_name": user_name,
        "user_role": user_role,
        "date": shift.shift_date.isoformat() if shift.shift_date else None,
        "start_time": shift.start_time.strftime("%H:%M") if shift.start_time else None,
        "end_time": shift.end_time.strftime("%H:%M") if shift.end_time else None,
        "label": shift.label,
        "created_at": shift.created_at.isoformat() if shift.created_at else None,
        "updated_at": shift.updated_at.isoformat() if shift.updated_at else None,
    }


def _mark_working_plan_updated(session: Session, tenant_id: int) -> None:
    """Set tenant.working_plan_updated_at so owner sees the '*' in nav."""
    tenant = session.get(models.Tenant, tenant_id)
    if tenant:
        tenant.working_plan_updated_at = datetime.now(timezone.utc)
        session.add(tenant)


def _mark_working_plan_seen_by_owner(session: Session, tenant_id: int) -> None:
    """Set tenant.working_plan_owner_seen_at when owner views the working plan."""
    tenant = session.get(models.Tenant, tenant_id)
    if tenant:
        tenant.working_plan_owner_seen_at = datetime.now(timezone.utc)
        session.add(tenant)


@app.get("/schedule/notification")
def schedule_notification(
    current_user: Annotated[models.User, Depends(security.get_current_user)],
    session: Session = Depends(get_session),
) -> dict:
    """Return whether the owner has unseen working plan updates (for '*' in nav). Only owners get has_updates."""
    if current_user.tenant_id is None or current_user.role != models.UserRole.owner:
        return {"has_updates": False}
    tenant = session.get(models.Tenant, current_user.tenant_id)
    if not tenant or not tenant.working_plan_updated_at:
        return {"has_updates": False}
    if not tenant.working_plan_owner_seen_at:
        return {"has_updates": True}
    return {"has_updates": tenant.working_plan_updated_at > tenant.working_plan_owner_seen_at}


@app.get("/schedule")
def list_schedule(
    current_user: Annotated[models.User, Depends(require_permission(Permission.SCHEDULE_READ))],
    session: Session = Depends(get_session),
    from_date: str = Query(..., description="Start date YYYY-MM-DD"),
    to_date: str = Query(..., description="End date YYYY-MM-DD"),
) -> list[dict]:
    """List shifts for the tenant in the given date range (inclusive)."""
    from datetime import datetime as dt_parse
    try:
        fd = dt_parse.strptime(from_date, "%Y-%m-%d").date()
        td = dt_parse.strptime(to_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format; use YYYY-MM-DD")
    if fd > td:
        raise HTTPException(status_code=400, detail="from_date must be <= to_date")
    shifts = session.exec(
        select(models.Shift)
        .where(models.Shift.tenant_id == current_user.tenant_id)
        .where(models.Shift.shift_date >= fd)
        .where(models.Shift.shift_date <= td)
    ).all()
    user_ids = {s.user_id for s in shifts}
    user_map: dict[int, tuple[str, str]] = {}
    if user_ids:
        users = session.exec(
            select(models.User).where(models.User.id.in_(user_ids))
        ).all()
        for u in users:
            user_map[u.id] = (u.full_name or u.username or "", u.role.value if u.role else "")
    if current_user.role == models.UserRole.owner and current_user.tenant_id:
        _mark_working_plan_seen_by_owner(session, current_user.tenant_id)
        session.commit()
    return [_shift_to_dict(s, user_map.get(s.user_id, ("", ""))[0], user_map.get(s.user_id, ("", ""))[1]) for s in shifts]


_SCHEDULE_PLAN_USER_ROLES = frozenset(
    {
        models.UserRole.owner,
        models.UserRole.kitchen,
        models.UserRole.waiter,
    }
)


def _require_schedule_shift_access(actor: models.User, shift_user_id: int) -> None:
    """Non-owner/admin callers may only write shifts assigned to themselves."""
    if can_manage_all_schedules(actor):
        return
    if shift_user_id != actor.id:
        raise HTTPException(status_code=403, detail="Permission denied")


@app.get("/schedule/export")
def export_schedule_month(
    current_user: Annotated[models.User, Depends(require_permission(Permission.SCHEDULE_READ))],
    session: Session = Depends(get_session),
    user_id: int = Query(..., description="Scheduled worker (must belong to tenant)"),
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    lang: str | None = Query(None, description="UI language for column headers (e.g. en, de, es)"),
) -> StreamingResponse:
    """Export one worker's shifts for a calendar month as Excel. Dates/times match the schedule API (tenant calendar day + local times)."""
    if current_user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Tenant required")
    target = session.exec(
        select(models.User).where(
            models.User.id == user_id,
            models.User.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not target:
        raise HTTPException(status_code=400, detail="User not found")
    if target.role not in _SCHEDULE_PLAN_USER_ROLES:
        raise HTTPException(status_code=400, detail="User cannot be scheduled on the working plan")
    fd = date(year, month, 1)
    ld = date(year, month, monthrange(year, month)[1])
    shifts = session.exec(
        select(models.Shift)
        .where(models.Shift.tenant_id == current_user.tenant_id)
        .where(models.Shift.user_id == user_id)
        .where(models.Shift.shift_date >= fd)
        .where(models.Shift.shift_date <= ld)
        .order_by(models.Shift.shift_date.asc(), models.Shift.start_time.asc())
    ).all()
    L = schedule_export_labels(lang)
    try:
        from openpyxl import Workbook
    except ImportError:
        raise HTTPException(status_code=500, detail="Excel export requires openpyxl")
    wb = Workbook()
    ws = wb.active
    title_base = f"{L['sheet']} {year}-{month:02d}"
    ws.title = title_base[:31]
    worker_name = target.full_name or target.username or str(user_id)
    user_role = target.role.value if target.role else ""
    ws.append(
        [
            L["date"],
            L["start_time"],
            L["end_time"],
            L["label"],
            L["employee"],
            L["role"],
        ]
    )
    for s in shifts:
        ws.append(
            [
                s.shift_date.isoformat(),
                s.start_time.strftime("%H:%M") if s.start_time else "",
                s.end_time.strftime("%H:%M") if s.end_time else "",
                (s.label or ""),
                worker_name,
                user_role,
            ]
        )
    start_dt = datetime.combine(fd, time.min, tzinfo=timezone.utc)
    end_dt = datetime.combine(ld, time.max, tzinfo=timezone.utc)
    tip_orders = session.exec(
        select(models.Order)
        .where(models.Order.tenant_id == current_user.tenant_id)
        .where(models.Order.tip_attributed_user_id == user_id)
        .where(models.Order.status == models.OrderStatus.paid)
        .where(models.Order.deleted_at.is_(None))
        .where(models.Order.paid_at >= start_dt)
        .where(models.Order.paid_at <= end_dt)
    ).all()
    tip_total = sum(int(o.tip_amount_cents or 0) for o in tip_orders)
    ws.append([])
    ws.append(
        [
            L["tips_month"],
            "",
            "",
            "",
            "",
            str(tip_total),
        ]
    )
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    fn = f"working-plan-{user_id}-{year}-{month:02d}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fn}"'},
    )


@app.get("/schedule/plan-users", response_model=list[models.UserResponse])
def list_schedule_plan_users(
    current_user: Annotated[models.User, Depends(require_permission(Permission.SCHEDULE_READ))],
    session: Session = Depends(get_session),
) -> list[models.UserResponse]:
    """Staff who may be assigned shifts (same role set as Excel export). Uses SCHEDULE_READ only so kitchen/bar/waiters can load the worker list without user:read."""
    if current_user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Tenant required")
    rows = session.exec(
        select(models.User).where(models.User.tenant_id == current_user.tenant_id)
    ).all()
    out: list[models.UserResponse] = []
    for u in rows:
        if u.role in _SCHEDULE_PLAN_USER_ROLES:
            out.append(
                models.UserResponse(
                    id=u.id,
                    username=u.username,
                    full_name=u.full_name,
                    role=u.role,
                    tenant_id=u.tenant_id,
                )
            )
    out.sort(key=lambda r: ((r.full_name or r.username or "").lower(), r.id))
    return out


def _shift_duration_minutes(start_t: time, end_t: time) -> int:
    sm = start_t.hour * 60 + start_t.minute
    em = end_t.hour * 60 + end_t.minute
    return max(0, em - sm)


def _format_hours_minutes_for_export(total_minutes: int) -> str:
    if total_minutes == 0:
        return "0"
    h, m = divmod(total_minutes, 60)
    if m:
        return f"{h}h {m}m"
    return f"{h}h"


def _format_hours_minutes_signed_for_export(total_minutes: int) -> str:
    if total_minutes == 0:
        return "0"
    sign = "+" if total_minutes > 0 else "−"
    return sign + _format_hours_minutes_for_export(abs(total_minutes))


def _schedule_planned_vs_actual_row_dicts(
    session: Session,
    tenant_id: int,
    fd: date,
    td: date,
    user_id_filter: int | None = None,
) -> list[dict]:
    """Planned shift minutes vs clocked net minutes per user per day (UTC day for actual)."""
    shifts = session.exec(
        select(models.Shift)
        .where(models.Shift.tenant_id == tenant_id)
        .where(models.Shift.shift_date >= fd)
        .where(models.Shift.shift_date <= td)
    ).all()
    start_utc = datetime.combine(fd, time.min, tzinfo=timezone.utc)
    end_exclusive = datetime.combine(td + timedelta(days=1), time.min, tzinfo=timezone.utc)
    q = (
        select(models.WorkSession)
        .where(models.WorkSession.tenant_id == tenant_id)
        .where(models.WorkSession.started_at >= start_utc)
        .where(models.WorkSession.started_at < end_exclusive)
    )
    rows_ws = session.exec(q).all()

    planned: dict[tuple[int, date], int] = {}
    actual: dict[tuple[int, date], int] = {}
    user_ids: set[int] = set()

    for s in shifts:
        key = (s.user_id, s.shift_date)
        planned[key] = planned.get(key, 0) + _shift_duration_minutes(s.start_time, s.end_time)
        user_ids.add(s.user_id)

    for ws in rows_ws:
        if ws.ended_at is None:
            continue
        nm = work_session_net_duration_minutes(ws, session)
        if nm is None:
            continue
        d = ws.started_at.date()
        key = (ws.user_id, d)
        actual[key] = actual.get(key, 0) + nm
        user_ids.add(ws.user_id)

    all_keys = set(planned.keys()) | set(actual.keys())
    names: dict[int, str] = {}
    if user_ids:
        users = session.exec(select(models.User).where(models.User.id.in_(user_ids))).all()
        for u in users:
            names[u.id] = u.full_name or u.username or ""

    out_rows: list[dict] = []
    for user_id, day in sorted(all_keys, key=lambda x: (x[1], x[0])):
        p = planned.get((user_id, day), 0)
        a = actual.get((user_id, day), 0)
        out_rows.append(
            {
                "user_id": user_id,
                "user_name": names.get(user_id, ""),
                "date": day.isoformat(),
                "planned_minutes": p,
                "actual_minutes": a,
                "variance_minutes": a - p,
            }
        )
    if user_id_filter is not None:
        out_rows = [r for r in out_rows if r["user_id"] == user_id_filter]
    return out_rows


def _week_start_monday(d: date) -> date:
    """Monday as first day of week (Python Monday=0)."""
    return d - timedelta(days=d.weekday())


@app.post("/schedule/copy-week")
def copy_schedule_week(
    body: models.ShiftWeekCopy,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SCHEDULE_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    """Copy all planned shifts from one Mon–Sun week to another (e.g. repeat rota). Both week starts must be Mondays."""
    from datetime import datetime as dt_parse

    if current_user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Tenant required")
    try:
        src = dt_parse.strptime(body.source_week_start, "%Y-%m-%d").date()
        tgt = dt_parse.strptime(body.target_week_start, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format; use YYYY-MM-DD")
    if src.weekday() != 0 or tgt.weekday() != 0:
        raise HTTPException(status_code=400, detail="source_week_start and target_week_start must be Mondays")
    if src == tgt:
        raise HTTPException(status_code=400, detail="Source and target week must differ")
    delta_days = (tgt - src).days
    src_end = src + timedelta(days=6)
    stmt = (
        select(models.Shift)
        .where(models.Shift.tenant_id == current_user.tenant_id)
        .where(models.Shift.shift_date >= src)
        .where(models.Shift.shift_date <= src_end)
    )
    if not can_manage_all_schedules(current_user):
        stmt = stmt.where(models.Shift.user_id == current_user.id)
    shifts = session.exec(stmt).all()
    created_count = 0
    skipped_existing_count = 0
    for s in shifts:
        new_date = s.shift_date + timedelta(days=delta_days)
        if body.skip_days_with_existing_shift:
            existing = session.exec(
                select(models.Shift)
                .where(models.Shift.tenant_id == current_user.tenant_id)
                .where(models.Shift.user_id == s.user_id)
                .where(models.Shift.shift_date == new_date)
                .limit(1)
            ).first()
            if existing is not None:
                skipped_existing_count += 1
                continue
        new_shift = models.Shift(
            tenant_id=current_user.tenant_id,
            user_id=s.user_id,
            shift_date=new_date,
            start_time=s.start_time,
            end_time=s.end_time,
            label=s.label,
        )
        session.add(new_shift)
        created_count += 1
    if created_count:
        _mark_working_plan_updated(session, current_user.tenant_id)
    session.commit()
    return {"created_count": created_count, "skipped_existing_count": skipped_existing_count}


@app.get("/schedule/planned-vs-actual")
def schedule_planned_vs_actual(
    current_user: Annotated[models.User, Depends(require_permission(Permission.SCHEDULE_READ))],
    session: Session = Depends(get_session),
    from_date: str = Query(..., description="Start date YYYY-MM-DD"),
    to_date: str = Query(..., description="End date YYYY-MM-DD (inclusive)"),
    user_id: int | None = Query(None, description="If set, only this tenant user’s rows (same tenant)"),
) -> dict:
    """Compare planned shift minutes (working plan) to clocked net minutes (UTC day by started_at)."""
    try:
        fd = datetime.strptime(from_date, "%Y-%m-%d").date()
        td = datetime.strptime(to_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format; use YYYY-MM-DD")
    if fd > td:
        raise HTTPException(status_code=400, detail="from_date must be <= to_date")
    if current_user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Tenant required")
    if user_id is not None:
        target = session.exec(
            select(models.User).where(
                models.User.id == user_id,
                models.User.tenant_id == current_user.tenant_id,
            )
        ).first()
        if not target:
            raise HTTPException(status_code=400, detail="User not found")
    if current_user.role == models.UserRole.owner and current_user.tenant_id:
        _mark_working_plan_seen_by_owner(session, current_user.tenant_id)
        session.commit()

    out_rows = _schedule_planned_vs_actual_row_dicts(session, current_user.tenant_id, fd, td, user_id)
    return {"rows": out_rows}


@app.get("/schedule/planned-vs-actual/export")
def export_schedule_planned_vs_actual(
    current_user: Annotated[models.User, Depends(require_permission(Permission.SCHEDULE_READ))],
    session: Session = Depends(get_session),
    from_date: str = Query(..., description="Start date YYYY-MM-DD"),
    to_date: str = Query(..., description="End date YYYY-MM-DD (inclusive)"),
    user_id: int | None = Query(None, description="If set, only this tenant user’s rows (same tenant)"),
    lang: str | None = Query(None, description="UI language for column headers (e.g. en, de, es)"),
) -> StreamingResponse:
    """Export planned vs clocked table for the date range as Excel (.xlsx); columns match the working-plan UI."""
    try:
        fd = datetime.strptime(from_date, "%Y-%m-%d").date()
        td = datetime.strptime(to_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format; use YYYY-MM-DD")
    if fd > td:
        raise HTTPException(status_code=400, detail="from_date must be <= to_date")
    if current_user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Tenant required")
    if current_user.role == models.UserRole.owner and current_user.tenant_id:
        _mark_working_plan_seen_by_owner(session, current_user.tenant_id)
        session.commit()

    target: models.User | None = None
    if user_id is not None:
        target = session.exec(
            select(models.User).where(
                models.User.id == user_id,
                models.User.tenant_id == current_user.tenant_id,
            )
        ).first()
        if not target:
            raise HTTPException(status_code=400, detail="User not found")

    raw_rows = _schedule_planned_vs_actual_row_dicts(session, current_user.tenant_id, fd, td, user_id)
    rows = [r for r in raw_rows if r["planned_minutes"] > 0 or r["actual_minutes"] > 0]

    L = planned_vs_export_labels(lang)
    totals_scope = L["scope_all"]
    if user_id is not None and target is not None:
        totals_scope = target.full_name or target.username or str(user_id)
    try:
        from openpyxl import Workbook
    except ImportError:
        raise HTTPException(status_code=500, detail="Excel export requires openpyxl")

    wb = Workbook()
    ws = wb.active
    title = f"{L['sheet']} {from_date}_{to_date}"
    ws.title = title[:31]
    ws.append([L["date"], L["staff"], L["planned"], L["clocked"], L["variance"]])
    total_p = 0
    total_a = 0
    for r in rows:
        total_p += int(r["planned_minutes"])
        total_a += int(r["actual_minutes"])
        ws.append(
            [
                r["date"],
                r["user_name"],
                _format_hours_minutes_for_export(int(r["planned_minutes"])),
                _format_hours_minutes_for_export(int(r["actual_minutes"])),
                _format_hours_minutes_signed_for_export(int(r["variance_minutes"])),
            ]
        )
    ws.append([])
    ws.append(
        [
            L["totals"],
            totals_scope,
            _format_hours_minutes_for_export(total_p),
            _format_hours_minutes_for_export(total_a),
            _format_hours_minutes_signed_for_export(total_a - total_p),
        ]
    )

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    fn = f"planned-vs-clocked-{from_date}-to-{to_date}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fn}"'},
    )


@app.get("/schedule/compliance-summary")
def schedule_compliance_summary(
    current_user: Annotated[models.User, Depends(require_permission(Permission.SCHEDULE_READ))],
    session: Session = Depends(get_session),
    from_date: str = Query(..., description="Start date YYYY-MM-DD"),
    to_date: str = Query(..., description="End date YYYY-MM-DD (inclusive)"),
    max_weekly_minutes: int = Query(
        2400,
        ge=60,
        le=10080,
        description="Flag weekly planned total above this (default 40h)",
    ),
    min_rest_minutes: int = Query(
        660,
        ge=0,
        le=1440,
        description="Minimum gap between end of one shift and start of next (default 11h)",
    ),
    yearly_warn_minutes: int = Query(
        108000,
        ge=60,
        description="Warn when yearly planned minutes exceed this (default 1800h)",
    ),
) -> dict:
    """Heuristic compliance checks on planned shifts: weekly load, rest between shifts, yearly threshold."""
    try:
        fd = datetime.strptime(from_date, "%Y-%m-%d").date()
        td = datetime.strptime(to_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format; use YYYY-MM-DD")
    if fd > td:
        raise HTTPException(status_code=400, detail="from_date must be <= to_date")
    if current_user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Tenant required")
    if current_user.role == models.UserRole.owner and current_user.tenant_id:
        _mark_working_plan_seen_by_owner(session, current_user.tenant_id)
        session.commit()

    shifts = session.exec(
        select(models.Shift)
        .where(models.Shift.tenant_id == current_user.tenant_id)
        .where(models.Shift.shift_date >= fd)
        .where(models.Shift.shift_date <= td)
    ).all()
    warnings: list[dict] = []

    # Weekly planned totals per user per ISO week (Monday start)
    weekly: dict[tuple[int, date], int] = {}
    for s in shifts:
        wk = _week_start_monday(s.shift_date)
        key = (s.user_id, wk)
        weekly[key] = weekly.get(key, 0) + _shift_duration_minutes(s.start_time, s.end_time)

    user_ids = {s.user_id for s in shifts}
    names: dict[int, str] = {}
    if user_ids:
        users = session.exec(select(models.User).where(models.User.id.in_(user_ids))).all()
        for u in users:
            names[u.id] = u.full_name or u.username or ""

    for (uid, wk), minutes in weekly.items():
        if minutes > max_weekly_minutes:
            warnings.append(
                {
                    "code": "weekly_planned_over_limit",
                    "user_id": uid,
                    "user_name": names.get(uid, ""),
                    "week_start": wk.isoformat(),
                    "planned_minutes": minutes,
                    "limit_minutes": max_weekly_minutes,
                }
            )

    # Rest between consecutive shifts (per user, chronological)
    by_user: dict[int, list[models.Shift]] = {}
    for s in shifts:
        by_user.setdefault(s.user_id, []).append(s)
    for uid, lst in by_user.items():
        lst.sort(key=lambda x: (x.shift_date, x.start_time))
        for i in range(len(lst) - 1):
            a, b = lst[i], lst[i + 1]
            end_a = datetime.combine(a.shift_date, a.end_time)
            start_b = datetime.combine(b.shift_date, b.start_time)
            gap_min = (start_b - end_a).total_seconds() / 60.0
            if gap_min >= 0 and gap_min < min_rest_minutes:
                warnings.append(
                    {
                        "code": "rest_between_shifts",
                        "user_id": uid,
                        "user_name": names.get(uid, ""),
                        "after_shift_id": a.id,
                        "before_shift_id": b.id,
                        "gap_minutes": int(gap_min),
                        "required_min_rest_minutes": min_rest_minutes,
                    }
                )

    # Calendar-year planned totals (full year per calendar year overlapping the query range)
    years = list(range(fd.year, td.year + 1))
    yearly: dict[tuple[int, int], int] = {}
    for y in years:
        y_shifts = session.exec(
            select(models.Shift)
            .where(models.Shift.tenant_id == current_user.tenant_id)
            .where(models.Shift.shift_date >= date(y, 1, 1))
            .where(models.Shift.shift_date <= date(y, 12, 31))
        ).all()
        for s in y_shifts:
            key = (s.user_id, y)
            yearly[key] = yearly.get(key, 0) + _shift_duration_minutes(s.start_time, s.end_time)
            user_ids.add(s.user_id)

    if user_ids:
        users = session.exec(select(models.User).where(models.User.id.in_(user_ids))).all()
        for u in users:
            names[u.id] = u.full_name or u.username or ""

    for (uid, year), minutes in yearly.items():
        if minutes >= yearly_warn_minutes:
            warnings.append(
                {
                    "code": "yearly_planned_hours_threshold",
                    "user_id": uid,
                    "user_name": names.get(uid, ""),
                    "year": year,
                    "planned_minutes": minutes,
                    "warn_at_minutes": yearly_warn_minutes,
                }
            )

    return {
        "warnings": warnings,
        "params": {
            "max_weekly_minutes": max_weekly_minutes,
            "min_rest_minutes": min_rest_minutes,
            "yearly_warn_minutes": yearly_warn_minutes,
        },
    }


@app.get("/schedule/{shift_id}")
def get_shift(
    shift_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SCHEDULE_READ))],
    session: Session = Depends(get_session),
) -> dict:
    """Get one shift by id."""
    shift = session.exec(
        select(models.Shift).where(
            models.Shift.id == shift_id,
            models.Shift.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    user = session.get(models.User, shift.user_id)
    user_name = (user.full_name or user.username or "") if user else ""
    user_role = user.role.value if user and user.role else ""
    return _shift_to_dict(shift, user_name, user_role)


@app.post("/schedule")
def create_shift(
    body: models.ShiftCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SCHEDULE_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    """Create a shift. User must belong to tenant and have role owner, admin, kitchen, bartender, waiter, or receptionist."""
    from datetime import datetime as dt_parse
    if current_user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Tenant required")
    user = session.exec(
        select(models.User).where(
            models.User.id == body.user_id,
            models.User.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")
    _require_schedule_shift_access(current_user, body.user_id)
    if user.role not in _SCHEDULE_PLAN_USER_ROLES:
        raise HTTPException(status_code=400, detail="User must have role owner, kitchen, or waiter")
    try:
        shift_date = dt_parse.strptime(body.date, "%Y-%m-%d").date()
        start_time = dt_parse.strptime(body.start_time[:5], "%H:%M").time()
        end_time = dt_parse.strptime(body.end_time[:5], "%H:%M").time()
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid date or time format; use YYYY-MM-DD and HH:MM")
    if start_time >= end_time:
        raise HTTPException(status_code=400, detail="start_time must be before end_time")
    shift = models.Shift(
        tenant_id=current_user.tenant_id,
        user_id=body.user_id,
        shift_date=shift_date,
        start_time=start_time,
        end_time=end_time,
        label=body.label,
    )
    session.add(shift)
    _mark_working_plan_updated(session, current_user.tenant_id)
    session.commit()
    session.refresh(shift)
    user_name = user.full_name or user.username or ""
    return _shift_to_dict(shift, user_name, user.role.value)


def _date_to_js_weekday(d: date) -> int:
    """Match JavaScript Date.getDay(): Sunday=0 .. Saturday=6."""
    return (d.weekday() + 1) % 7


@app.post("/schedule/bulk")
def create_shifts_bulk(
    body: models.ShiftBulkCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SCHEDULE_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    """Create the same shift on selected weekdays for every day in a calendar month.

    When skip_days_with_existing_shift is true, days where the user already has any shift are left unchanged
    so single-day edits and exceptions stay intact.
    """
    from datetime import datetime as dt_parse

    if current_user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Tenant required")
    weekday_set = set(body.weekdays)
    if not weekday_set.issubset(range(7)):
        raise HTTPException(status_code=400, detail="weekdays must be integers 0–6 (Sunday=0 .. Saturday=6)")
    user = session.exec(
        select(models.User).where(
            models.User.id == body.user_id,
            models.User.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")
    _require_schedule_shift_access(current_user, body.user_id)
    if user.role not in _SCHEDULE_PLAN_USER_ROLES:
        raise HTTPException(
            status_code=400,
            detail="User must have role owner, kitchen, or waiter",
        )
    try:
        start_time = dt_parse.strptime(body.start_time[:5], "%H:%M").time()
        end_time = dt_parse.strptime(body.end_time[:5], "%H:%M").time()
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid start_time or end_time; use HH:MM")
    if start_time >= end_time:
        raise HTTPException(status_code=400, detail="start_time must be before end_time")

    first = date(body.year, body.month, 1)
    last_day = monthrange(body.year, body.month)[1]
    created_count = 0
    skipped_existing_count = 0

    for dom in range(1, last_day + 1):
        shift_date = date(body.year, body.month, dom)
        if _date_to_js_weekday(shift_date) not in weekday_set:
            continue
        if body.skip_days_with_existing_shift:
            existing = session.exec(
                select(models.Shift)
                .where(models.Shift.tenant_id == current_user.tenant_id)
                .where(models.Shift.user_id == body.user_id)
                .where(models.Shift.shift_date == shift_date)
                .limit(1)
            ).first()
            if existing is not None:
                skipped_existing_count += 1
                continue
        shift = models.Shift(
            tenant_id=current_user.tenant_id,
            user_id=body.user_id,
            shift_date=shift_date,
            start_time=start_time,
            end_time=end_time,
            label=body.label,
        )
        session.add(shift)
        created_count += 1

    if created_count:
        _mark_working_plan_updated(session, current_user.tenant_id)
    session.commit()
    return {
        "created_count": created_count,
        "skipped_existing_count": skipped_existing_count,
    }


@app.put("/schedule/{shift_id}")
def update_shift(
    shift_id: int,
    body: models.ShiftUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SCHEDULE_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    """Update a shift."""
    shift = session.exec(
        select(models.Shift).where(
            models.Shift.id == shift_id,
            models.Shift.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    _require_schedule_shift_access(current_user, shift.user_id)
    from datetime import datetime as dt_parse
    if body.user_id is not None:
        _require_schedule_shift_access(current_user, body.user_id)
        user = session.exec(
            select(models.User).where(
                models.User.id == body.user_id,
                models.User.tenant_id == current_user.tenant_id,
            )
        ).first()
        if not user:
            raise HTTPException(status_code=400, detail="User not found")
        if user.role not in _SCHEDULE_PLAN_USER_ROLES:
            raise HTTPException(status_code=400, detail="User must have role owner, kitchen, or waiter")
        shift.user_id = body.user_id
    if body.date is not None:
        try:
            shift.shift_date = dt_parse.strptime(body.date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format; use YYYY-MM-DD")
    if body.start_time is not None:
        try:
            shift.start_time = dt_parse.strptime(body.start_time[:5], "%H:%M").time()
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid start_time; use HH:MM")
    if body.end_time is not None:
        try:
            shift.end_time = dt_parse.strptime(body.end_time[:5], "%H:%M").time()
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid end_time; use HH:MM")
    if body.label is not None:
        shift.label = body.label
    if shift.start_time >= shift.end_time:
        raise HTTPException(status_code=400, detail="start_time must be before end_time")
    shift.updated_at = datetime.now(timezone.utc)
    session.add(shift)
    _mark_working_plan_updated(session, current_user.tenant_id)
    session.commit()
    session.refresh(shift)
    user = session.get(models.User, shift.user_id)
    user_name = (user.full_name or user.username or "") if user else ""
    user_role = user.role.value if user and user.role else ""
    return _shift_to_dict(shift, user_name, user_role)


@app.delete("/schedule/{shift_id}")
def delete_shift(
    shift_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.SCHEDULE_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    """Delete a shift."""
    shift = session.exec(
        select(models.Shift).where(
            models.Shift.id == shift_id,
            models.Shift.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    _require_schedule_shift_access(current_user, shift.user_id)
    _mark_working_plan_updated(session, current_user.tenant_id)
    session.delete(shift)
    session.commit()
    return {"deleted": True, "id": shift_id}


# ============ TABLES ============


@app.get("/tables")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def list_tables(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.TABLE_READ))],
    session: Session = Depends(get_session),
) -> list[dict]:
    tables = session.exec(
        select(models.Table).where(models.Table.tenant_id == current_user.tenant_id)
    ).all()

    # Resolve assigned waiter names (table-level and floor-level fallback)
    waiter_ids = set()
    floor_ids = set()
    for t in tables:
        if t.assigned_waiter_id:
            waiter_ids.add(t.assigned_waiter_id)
        if t.floor_id:
            floor_ids.add(t.floor_id)

    # Get floors for fallback waiter
    floor_waiter_map: dict[int, int | None] = {}
    if floor_ids:
        floors = session.exec(
            select(models.Floor).where(models.Floor.id.in_(floor_ids), models.Floor.tenant_id == current_user.tenant_id)
        ).all()
        for f in floors:
            floor_waiter_map[f.id] = f.default_waiter_id
            if f.default_waiter_id:
                waiter_ids.add(f.default_waiter_id)

    waiter_map: dict[int, str] = {}
    if waiter_ids:
        waiters = session.exec(
            select(models.User).where(models.User.id.in_(waiter_ids))
        ).all()
        waiter_map = {w.id: (w.full_name or w.username) for w in waiters}

    result = []
    for t in tables:
        if t.is_active and _table_requires_order_code(t):
            _ensure_table_order_code(session, t)
        d = t.model_dump()
        effective_waiter_id = t.assigned_waiter_id or floor_waiter_map.get(t.floor_id)
        d["assigned_waiter_name"] = waiter_map.get(t.assigned_waiter_id) if t.assigned_waiter_id else None
        d["effective_waiter_id"] = effective_waiter_id
        d["effective_waiter_name"] = waiter_map.get(effective_waiter_id) if effective_waiter_id else None
        _append_table_group_fields(session, current_user.tenant_id, t, d)
        result.append(d)
    return result


@app.get("/tables/with-status")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def list_tables_with_status(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.TABLE_READ))],
    session: Session = Depends(get_session),
) -> list[dict]:
    """List tables with computed status: available, reserved, or occupied.

    Each row includes ``operational_status`` for table **surface fill** (service pipeline only):
    available, reserved, occupied (seated/session without an in-flight kitchen order),
    open_order (active order not yet kitchen-ready), or ready_to_serve (order ``ready`` or
    ``completed`` — kitchen/service done; payment may still be pending).
    Payment/collection is separate: ``payment_status`` is ``none``, ``pending`` (bill or
    payment requested on the active order), or ``paid`` (table still links to a paid order
    while staff clears the session — chip only; often absent once the table is released).
    Reserved tables may include ``upcoming_reservation`` when the booking is still in the future.
    """
    tables = session.exec(
        select(models.Table).where(models.Table.tenant_id == current_user.tenant_id)
    ).all()
    today_utc = datetime.now(timezone.utc).date()
    now_utc = datetime.now(timezone.utc).time()

    waiter_ids = set()
    floor_ids = set()
    for t in tables:
        if t.assigned_waiter_id:
            waiter_ids.add(t.assigned_waiter_id)
        if t.floor_id:
            floor_ids.add(t.floor_id)

    floor_waiter_map: dict[int, int | None] = {}
    if floor_ids:
        floors = session.exec(
            select(models.Floor).where(models.Floor.id.in_(floor_ids), models.Floor.tenant_id == current_user.tenant_id)
        ).all()
        for f in floors:
            floor_waiter_map[f.id] = f.default_waiter_id
            if f.default_waiter_id:
                waiter_ids.add(f.default_waiter_id)

    waiter_map: dict[int, str] = {}
    if waiter_ids:
        waiters = session.exec(
            select(models.User).where(models.User.id.in_(waiter_ids))
        ).all()
        waiter_map = {w.id: (w.full_name or w.username) for w in waiters}

    _in_flight_order_statuses = (
        models.OrderStatus.pending,
        models.OrderStatus.preparing,
        models.OrderStatus.ready,
        models.OrderStatus.partially_delivered,
        models.OrderStatus.completed,
    )

    result = []
    for table in tables:
        # Prefer the table's shared session order (same as get_current_order); a bare
        # .first() can pick another row when multiple in-flight orders exist on the table.
        active_order = None
        if table.active_order_id:
            cand = session.get(models.Order, table.active_order_id)
            if (
                cand
                and cand.table_id == table.id
                and cand.deleted_at is None
                and cand.status in _in_flight_order_statuses
            ):
                active_order = cand
        if active_order is None:
            active_order = session.exec(
                select(models.Order)
                .where(
                    models.Order.table_id == table.id,
                    models.Order.deleted_at.is_(None),
                    models.Order.status.in_(_in_flight_order_statuses),
                )
                .order_by(models.Order.id.desc())
            ).first()
        seated_here = session.exec(
            select(models.Reservation).where(
                models.Reservation.table_id == table.id,
                models.Reservation.status == models.ReservationStatus.seated,
            )
        ).first()
        upcoming_reservation = None
        payment_status = "none"
        if table.is_active or active_order or seated_here:
            status = "occupied"
            if active_order:
                # Service-only fill: kitchen phase, not payment/bill state.
                if active_order.status in (
                    models.OrderStatus.ready,
                    models.OrderStatus.completed,
                ):
                    operational_status = "ready_to_serve"
                else:
                    operational_status = "open_order"
                if active_order.bill_requested_at is not None:
                    payment_status = "pending"
            else:
                operational_status = "occupied"
        else:
            reserved_here = session.exec(
                select(models.Reservation).where(
                    models.Reservation.table_id == table.id,
                    models.Reservation.status == models.ReservationStatus.booked,
                    models.Reservation.reservation_date >= today_utc,
                )
            ).first()
            status = "reserved" if reserved_here else "available"
            operational_status = "reserved" if reserved_here else "available"
            if reserved_here and (
                reserved_here.reservation_date > today_utc or reserved_here.reservation_time > now_utc
            ):
                upcoming_reservation = {
                    "reservation_id": reserved_here.id,
                    "reservation_time": reserved_here.reservation_time.strftime("%H:%M"),
                    "customer_name": reserved_here.customer_name or "",
                }
        effective_waiter_id = table.assigned_waiter_id or floor_waiter_map.get(table.floor_id)

        if payment_status == "none" and table.active_order_id:
            linked = session.get(models.Order, table.active_order_id)
            if linked and linked.tenant_id == current_user.tenant_id and linked.deleted_at is None:
                if linked.status == models.OrderStatus.paid and linked.paid_at is not None:
                    payment_status = "paid"
                elif linked.bill_requested_at is not None and linked.status not in (
                    models.OrderStatus.paid,
                    models.OrderStatus.cancelled,
                ):
                    payment_status = "pending"

        row = {
            "id": table.id,
            "name": table.name,
            "token": table.token,
            "tenant_id": table.tenant_id,
            "floor_id": table.floor_id,
            "x_position": table.x_position,
            "y_position": table.y_position,
            "rotation": table.rotation,
            "shape": table.shape,
            "width": table.width,
            "height": table.height,
            "seat_count": table.seat_count,
            "status": status,
            "operational_status": operational_status,
            "payment_status": payment_status,
            "is_active": table.is_active,
            "active_order_id": table.active_order_id,
            "activated_at": table.activated_at.isoformat() if table.activated_at else None,
            "order_code": (
                _ensure_table_order_code(session, table)
                if table.is_active and _table_requires_order_code(table)
                else None
            ),
            "assigned_waiter_id": table.assigned_waiter_id,
            "assigned_waiter_name": waiter_map.get(table.assigned_waiter_id) if table.assigned_waiter_id else None,
            "effective_waiter_id": effective_waiter_id,
            "effective_waiter_name": waiter_map.get(effective_waiter_id) if effective_waiter_id else None,
        }
        if upcoming_reservation is not None:
            row["upcoming_reservation"] = upcoming_reservation
        _append_table_group_fields(session, current_user.tenant_id, table, row)
        result.append(row)

    # Merge status across joined tables so the canvas shows one coherent party state.
    group_to_indices: dict[int, list[int]] = {}
    for i, table in enumerate(tables):
        if table.id is None or not table.table_group_id:
            continue
        group_to_indices.setdefault(table.table_group_id, []).append(i)

    for _gid, indices in group_to_indices.items():
        if len(indices) < 2:
            continue
        op_stats = [result[i]["operational_status"] for i in indices]
        st_stats = [result[i]["status"] for i in indices]
        pay_stats = [result[i].get("payment_status", "none") for i in indices]
        merged_op = _merge_operational_statuses(op_stats)
        merged_st = _merge_table_statuses(st_stats)
        merged_pay = _merge_payment_statuses(pay_stats)
        upcoming_list = [result[i].get("upcoming_reservation") for i in indices]
        merged_up = next((u for u in upcoming_list if u), None)
        any_active = any(result[i].get("is_active") for i in indices)
        active_oid = next(
            (result[i].get("active_order_id") for i in indices if result[i].get("active_order_id")),
            None,
        )
        for i in indices:
            result[i]["operational_status"] = merged_op
            result[i]["status"] = merged_st
            result[i]["payment_status"] = merged_pay
            result[i]["is_active"] = any_active
            if active_oid is not None:
                result[i]["active_order_id"] = active_oid
            if merged_up is not None:
                result[i]["upcoming_reservation"] = merged_up
            elif merged_st != "reserved":
                result[i].pop("upcoming_reservation", None)

    return result


def _require_own_floor(session: Session, floor_id: int | None, tenant_id: int) -> None:
    if floor_id is None:
        return
    floor = session.get(models.Floor, floor_id)
    if floor is None or floor.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Floor not found")


@app.post("/tables")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def create_table(
    request: Request,
    table_data: models.TableCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.TABLE_WRITE))],
    session: Session = Depends(get_session),
) -> JSONResponse:
    _require_own_floor(session, getattr(table_data, "floor_id", None), current_user.tenant_id)
    table = models.Table(
        name=table_data.name,
        tenant_id=current_user.tenant_id,
        floor_id=table_data.floor_id,
    )
    session.add(table)
    session.commit()
    session.refresh(table)
    # Return JSONResponse so slowapi can inject rate-limit headers (it requires a Response instance)
    return JSONResponse(
        content=table.model_dump(mode="json"),
        status_code=status.HTTP_201_CREATED,
    )


@app.put("/tables/{table_id}")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def update_table(
    request: Request,
    table_id: int,
    table_update: models.TableUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.TABLE_WRITE))],
    session: Session = Depends(get_session),
) -> JSONResponse:
    """Update table properties including canvas layout."""
    table = session.exec(
        select(models.Table).where(
            models.Table.id == table_id,
            models.Table.tenant_id == current_user.tenant_id,
        )
    ).first()

    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    _require_own_floor(session, table_update.floor_id, current_user.tenant_id)

    # Update all provided fields
    if table_update.name is not None:
        table.name = table_update.name
    if table_update.floor_id is not None and table.table_group_id:
        raise HTTPException(
            status_code=400,
            detail="Unjoin the table group before moving this table to another floor",
        )
    if table_update.floor_id is not None:
        table.floor_id = table_update.floor_id
    if table_update.x_position is not None:
        table.x_position = table_update.x_position
    if table_update.y_position is not None:
        table.y_position = table_update.y_position
    if table_update.rotation is not None:
        table.rotation = table_update.rotation
    if table_update.shape is not None:
        table.shape = table_update.shape
    if table_update.width is not None:
        table.width = table_update.width
    if table_update.height is not None:
        table.height = table_update.height
    if table_update.seat_count is not None:
        table.seat_count = table_update.seat_count

    session.add(table)
    session.commit()
    session.refresh(table)
    # Return JSONResponse so slowapi can inject rate-limit headers (it requires a Response instance)
    return JSONResponse(
        content=table.model_dump(mode="json"),
        status_code=status.HTTP_200_OK,
    )


@app.post("/table-groups")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def create_table_group(
    request: Request,
    body: models.TableGroupCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.TABLE_WRITE))],
    session: Session = Depends(get_session),
) -> JSONResponse:
    """Join N tables into one logical group (same floor, no open orders or blocking reservations)."""
    ids = sorted({int(x) for x in body.table_ids})
    if len(ids) < 2:
        raise HTTPException(status_code=400, detail="At least two tables are required")
    tables = session.exec(
        select(models.Table).where(
            models.Table.id.in_(ids),
            models.Table.tenant_id == current_user.tenant_id,
        )
    ).all()
    if len(tables) != len(ids):
        raise HTTPException(status_code=404, detail="One or more tables not found")
    if any(t.table_group_id for t in tables):
        raise HTTPException(
            status_code=400,
            detail="A selected table is already in a group; unjoin it first",
        )
    floor_ids = {t.floor_id for t in tables}
    if len(floor_ids) != 1:
        raise HTTPException(status_code=400, detail="Tables must be on the same floor to join")
    for t in tables:
        if t.is_active:
            raise HTTPException(
                status_code=400,
                detail="Close active table sessions before joining",
            )
        ao = session.exec(
            select(models.Order).where(
                models.Order.table_id == t.id,
                models.Order.deleted_at.is_(None),
                models.Order.status.in_(
                    [
                        models.OrderStatus.pending,
                        models.OrderStatus.preparing,
                        models.OrderStatus.ready,
                        models.OrderStatus.partially_delivered,
                    ]
                ),
            )
        ).first()
        if ao:
            raise HTTPException(
                status_code=400,
                detail="Finish or clear open orders on all selected tables before joining",
            )
        seated = session.exec(
            select(models.Reservation).where(
                models.Reservation.table_id == t.id,
                models.Reservation.status == models.ReservationStatus.seated,
            )
        ).first()
        if seated:
            raise HTTPException(
                status_code=400,
                detail="Finish seated reservations on all selected tables before joining",
            )
        booked = session.exec(
            select(models.Reservation).where(
                models.Reservation.table_id == t.id,
                models.Reservation.status == models.ReservationStatus.booked,
            )
        ).first()
        if booked:
            raise HTTPException(
                status_code=400,
                detail="Resolve booked reservations on all selected tables before joining",
            )

    g = models.TableGroup(tenant_id=current_user.tenant_id)
    session.add(g)
    session.commit()
    session.refresh(g)
    for t in tables:
        t.table_group_id = g.id
        session.add(t)
    session.commit()
    # JSONResponse so slowapi can inject rate-limit headers (requires a Response instance)
    return JSONResponse(
        content={
            "id": g.id,
            "table_ids": ids,
            "tenant_id": current_user.tenant_id,
        },
        status_code=status.HTTP_201_CREATED,
    )


@app.delete("/table-groups/{group_id}")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def delete_table_group(
    request: Request,
    group_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.TABLE_WRITE))],
    session: Session = Depends(get_session),
) -> JSONResponse:
    """Dissolve a table group; physical tables and tokens are unchanged."""
    g = session.exec(
        select(models.TableGroup).where(
            models.TableGroup.id == group_id,
            models.TableGroup.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not g:
        raise HTTPException(status_code=404, detail="Table group not found")
    members = _tables_in_group(session, current_user.tenant_id, group_id)
    member_ids = [m.id for m in members if m.id is not None]
    for t in members:
        t.table_group_id = None
        session.add(t)
    session.delete(g)
    session.commit()
    return JSONResponse(
        content={"dissolved": True, "id": group_id, "table_ids": member_ids},
        status_code=status.HTTP_200_OK,
    )


@app.delete("/tables/{table_id}")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def delete_table(
    request: Request,
    table_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.TABLE_WRITE))],
    session: Session = Depends(get_session),
    lang: str = Depends(_get_requested_language),
    reassign_to_table_id: int | None = Query(None, description="Reassign orders and reservations to this table before deleting"),
) -> JSONResponse:
    table = session.exec(
        select(models.Table).where(
            models.Table.id == table_id,
            models.Table.tenant_id == current_user.tenant_id,
        )
    ).first()

    if not table:
        raise HTTPException(status_code=404, detail=api_error_payload("table_not_found", lang))

    has_orders = session.exec(
        select(models.Order).where(
            models.Order.tenant_id == current_user.tenant_id,
            models.Order.table_id == table_id,
            models.Order.deleted_at.is_(None),
        )
    ).first() is not None

    if has_orders and not reassign_to_table_id:
        raise HTTPException(
            status_code=400,
            detail=api_error_payload("table_has_orders", lang),
        )

    if reassign_to_table_id is not None:
        if reassign_to_table_id == table_id:
            raise HTTPException(
                status_code=400,
                detail=api_error_payload("reassign_target_must_differ", lang),
            )
        target = session.exec(
            select(models.Table).where(
                models.Table.id == reassign_to_table_id,
                models.Table.tenant_id == current_user.tenant_id,
            )
        ).first()
        if not target:
            raise HTTPException(
                status_code=404,
                detail=api_error_payload("reassign_target_not_found", lang),
            )
        # Reassign active orders only (soft-deleted are unlinked or have no table)
        orders_linked = session.exec(
            select(models.Order).where(
                models.Order.tenant_id == current_user.tenant_id,
                models.Order.table_id == table_id,
                models.Order.deleted_at.is_(None),
            )
        ).all()
        for order in orders_linked:
            order.table_id = reassign_to_table_id
            session.add(order)
        # Reassign reservations (optional link)
        reservations_linked = session.exec(
            select(models.Reservation).where(
                models.Reservation.tenant_id == current_user.tenant_id,
                models.Reservation.table_id == table_id,
            )
        ).all()
        for res in reservations_linked:
            res.table_id = reassign_to_table_id
            res.updated_at = datetime.now(timezone.utc)
            session.add(res)
    else:
        # No orders: just unlink reservations (set to null) before delete
        reservations_linked = session.exec(
            select(models.Reservation).where(
                models.Reservation.tenant_id == current_user.tenant_id,
                models.Reservation.table_id == table_id,
            )
        ).all()
        for res in reservations_linked:
            res.table_id = None
            res.updated_at = datetime.now(timezone.utc)
            session.add(res)

    gid = table.table_group_id
    others_in_group: list[models.Table] = []
    if gid:
        others_in_group = list(
            session.exec(
                select(models.Table).where(
                    models.Table.tenant_id == current_user.tenant_id,
                    models.Table.table_group_id == gid,
                    models.Table.id != table_id,
                )
            ).all()
        )

    session.delete(table)

    if gid:
        grp = session.get(models.TableGroup, gid)
        if grp and grp.tenant_id == current_user.tenant_id:
            if len(others_in_group) == 0:
                session.delete(grp)
            elif len(others_in_group) == 1:
                lone = others_in_group[0]
                lone.table_group_id = None
                session.add(lone)
                session.delete(grp)

    session.commit()
    return JSONResponse(
        content={"status": "deleted", "id": table_id},
        status_code=status.HTTP_200_OK,
    )


# ============ RESERVATIONS ============


def _parse_reservation_date(s: str) -> date:
    """Parse YYYY-MM-DD to date. Accepts full ISO datetime strings (takes first 10 chars)."""
    s = s.strip()
    if len(s) < 10:
        raise ValueError(f"Invalid date format: {s!r}. Use YYYY-MM-DD.")
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError as e:
        raise ValueError(f"Invalid date format: {s[:10]!r}. Use YYYY-MM-DD.") from e


def _parse_reservation_time(s: str) -> time:
    """Parse HH:MM or HH:MM:SS to time. Accepts longer strings (takes first 8 chars for HH:MM:SS)."""
    s = s.strip()
    if len(s) < 5:
        raise ValueError(f"Invalid time format: {s!r}. Use HH:MM or HH:MM:SS.")
    try:
        if len(s) <= 5:
            return datetime.strptime(s[:5], "%H:%M").time()
        return datetime.strptime(s[:8], "%H:%M:%S").time()
    except ValueError as e:
        raise ValueError(f"Invalid time format: {s[:8]!r}. Use HH:MM or HH:MM:SS.") from e


def _filter_windows_by_service(
    windows: List[Tuple[time, time]], service: str | None
) -> List[Tuple[time, time]]:
    """Keep lunch (first segment) or dinner (last segment) when the day has a lunch/dinner split."""
    if not windows:
        return []
    s = (service or "").strip().lower()
    if s in ("", "all", "any"):
        return windows
    if s == "lunch":
        return [windows[0]] if len(windows) >= 1 else []
    if s == "dinner":
        return [windows[-1]] if len(windows) >= 2 else windows
    return windows


def _raise_if_reservation_time_invalid_for_opening_hours(
    session: Session,
    tenant: models.Tenant,
    res_date: date,
    res_time: time,
    service: str | None = None,
) -> None:
    windows = _opening_service_windows_for_date(session, tenant, res_date)
    if windows is None:
        return
    if len(windows) == 0:
        raise HTTPException(status_code=400, detail="Restaurant is closed on that day")
    windows = _filter_windows_by_service(windows, service)
    if len(windows) == 0:
        raise HTTPException(status_code=400, detail="Restaurant is closed for this service")
    for open_t, close_t in windows:
        if res_time < open_t:
            continue
        if _reservation_time_allowed_before_closing(res_time, close_t):
            return
    raise HTTPException(
        status_code=400,
        detail="Reservation time is outside opening hours or too close to closing.",
    )


def _effective_reservation_slot_minutes(tenant: models.Tenant) -> int:
    """Minutes between bookable start times on the public grid; null/invalid → 15 (legacy)."""
    v = tenant.reservation_slot_minutes
    if v is None or v <= 0:
        return 15
    return int(v)


def _grid_slot_times_for_windows(
    windows: List[Tuple[time, time]], slot_step_minutes: int
) -> List[time]:
    """Start times on a fixed minute grid within each window, strictly before close, respecting 1h-before-close rule."""
    step = max(1, min(120, int(slot_step_minutes)))
    seen: set[int] = set()
    out: List[time] = []
    for open_t, close_t in windows:
        om = open_t.hour * 60 + open_t.minute
        cm = close_t.hour * 60 + close_t.minute
        t = ((om + step - 1) // step) * step
        while t < cm:
            slot = time(t // 60, t % 60)
            if _reservation_time_allowed_before_closing(slot, close_t):
                key = slot.hour * 60 + slot.minute
                if key not in seen:
                    seen.add(key)
                    out.append(slot)
            t += step
    out.sort(key=lambda x: x.hour * 60 + x.minute)
    return out


def _closing_time_for_date(session: Session, tenant: models.Tenant, res_date: date) -> time | None:
    """Last segment closing time for the day, or None if not configured / closed / unparseable."""
    windows = _opening_service_windows_for_date(session, tenant, res_date)
    if not windows:
        return None
    return windows[-1][1]


def _reservation_time_allowed_before_closing(reservation_time: time, closing_time: time) -> bool:
    """True if reservation_time is at least 1 hour before closing_time."""
    close_mins = closing_time.hour * 60 + closing_time.minute
    last_mins = (close_mins - 60) % (24 * 60)
    res_mins = reservation_time.hour * 60 + reservation_time.minute
    return res_mins <= last_mins


def _reservation_to_dict(
    r: models.Reservation, session: Session | None = None, include_client_tech: bool = False
) -> dict:
    """Serialize reservation for JSON (date/time as ISO strings). Includes table_name when table_id set if session provided.
    include_client_tech: when True (staff), include client_ip, user_agent, fingerprint, screen; never expose to public."""
    out = {
        "id": r.id,
        "tenant_id": r.tenant_id,
        "customer_name": r.customer_name,
        "customer_phone": r.customer_phone,
        "customer_email": r.customer_email,
        "reservation_date": r.reservation_date.isoformat() if r.reservation_date else None,
        "reservation_time": r.reservation_time.strftime("%H:%M") if r.reservation_time else None,
        "party_size": r.party_size,
        "status": r.status.value,
        "table_id": r.table_id,
        "seated_at": r.seated_at.isoformat() if r.seated_at else None,
        "token": r.token,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        "client_notes": r.client_notes,
        "customer_notes": getattr(r, "customer_notes", None),
        "owner_notes": r.owner_notes,
        "delay_notice": getattr(r, "delay_notice", None),
        "service_type": getattr(r, "service_type", None),
        "seating_preference": getattr(r, "seating_preference", None),
        "allergies_has": bool(getattr(r, "allergies_has", False)),
        "allergies_detail": getattr(r, "allergies_detail", None),
        "preferred_floor_id": getattr(r, "preferred_floor_id", None),
        "locale": getattr(r, "locale", None),
        "guest_birthday_month": getattr(r, "guest_birthday_month", None),
        "guest_birthday_day": getattr(r, "guest_birthday_day", None),
        "guest_birthday_marketing_consent": bool(
            getattr(r, "guest_birthday_marketing_consent", False)
        ),
    }
    pfid = getattr(r, "preferred_floor_id", None)
    if pfid is not None and session:
        fl = session.get(models.Floor, pfid)
        out["preferred_floor_name"] = fl.name if fl else None
    else:
        out["preferred_floor_name"] = None
    if session and r.table_id is not None:
        table = session.get(models.Table, r.table_id)
        out["table_name"] = table.name if table else None
    else:
        out["table_name"] = None
    if include_client_tech:
        out["client_ip"] = r.client_ip
        out["client_user_agent"] = r.client_user_agent
        out["client_fingerprint"] = r.client_fingerprint
        out["client_screen_width"] = r.client_screen_width
        out["client_screen_height"] = r.client_screen_height
    return out


def _capacity_for_tenant(session: Session, tenant_id: int) -> tuple[int, int]:
    """Return (total_seats, total_tables) for the tenant."""
    tables = session.exec(
        select(models.Table).where(models.Table.tenant_id == tenant_id)
    ).all()
    total_seats = sum(t.seat_count for t in tables)
    return (total_seats, len(tables))


def _tables_in_group(
    session: Session, tenant_id: int, group_id: int
) -> list[models.Table]:
    return list(
        session.exec(
            select(models.Table).where(
                models.Table.tenant_id == tenant_id,
                models.Table.table_group_id == group_id,
            )
        ).all()
    )


def _group_total_seats(session: Session, tenant_id: int, table: models.Table) -> int:
    if not table.table_group_id:
        return table.seat_count
    members = _tables_in_group(session, tenant_id, table.table_group_id)
    return sum(m.seat_count for m in members)


def _group_member_table_ids(session: Session, tenant_id: int, table: models.Table) -> list[int]:
    if not table.table_group_id:
        return [table.id] if table.id is not None else []
    return sorted(
        tid
        for tid in (
            m.id for m in _tables_in_group(session, tenant_id, table.table_group_id)
        )
        if tid is not None
    )


def _table_group_display_label(session: Session, tenant_id: int, table: models.Table) -> str | None:
    if not table.table_group_id:
        return None
    members = _tables_in_group(session, tenant_id, table.table_group_id)
    names = sorted((m.name or "") for m in members)
    return " + ".join(names) if names else None


def _append_table_group_fields(
    session: Session,
    tenant_id: int,
    table: models.Table,
    row: dict,
) -> None:
    """Mutates row with group_member_ids, group_seat_total, table_group_id."""
    row["table_group_id"] = table.table_group_id
    if not table.table_group_id or table.id is None:
        row["group_member_ids"] = None
        row["group_seat_total"] = None
        return
    members = _tables_in_group(session, tenant_id, table.table_group_id)
    ids = sorted(m.id for m in members if m.id is not None)
    row["group_member_ids"] = ids
    row["group_seat_total"] = sum(m.seat_count for m in members)


_OP_STATUS_RANK = {
    "available": 1,
    "reserved": 2,
    "occupied": 3,
    "open_order": 4,
    "ready_to_serve": 5,
}


def _merge_payment_statuses(statuses: list[str]) -> str:
    if any(s == "pending" for s in statuses):
        return "pending"
    if any(s == "paid" for s in statuses):
        return "paid"
    return "none"


def _merge_operational_statuses(statuses: list[str]) -> str:
    best = "available"
    best_r = 0
    for s in statuses:
        r = _OP_STATUS_RANK.get(s, 0)
        if r > best_r:
            best_r = r
            best = s
    return best


def _merge_table_statuses(statuses: list[str]) -> str:
    if any(s == "occupied" for s in statuses):
        return "occupied"
    if any(s == "reserved" for s in statuses):
        return "reserved"
    return "available"


def _ensure_aware_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _slot_datetime_utc(res_date: date, slot_time: time, tenant: models.Tenant) -> datetime:
    tz = ZoneInfo(tenant.timezone) if tenant.timezone else timezone.utc
    local = datetime.combine(res_date, slot_time, tzinfo=tz)
    return local.astimezone(timezone.utc)


def _table_busy_interval_turn(
    table: models.Table,
    seated: models.Reservation | None,
    order: models.Order | None,
    turn_minutes: int,
    now_utc: datetime,
) -> tuple[datetime, datetime] | None:
    """Single busy window [start, end) from earliest relevant signal."""
    starts: list[datetime] = []
    if seated is not None:
        s = seated.seated_at or seated.updated_at or seated.created_at
        starts.append(_ensure_aware_utc(s))
    if order is not None:
        starts.append(_ensure_aware_utc(order.created_at))
    if table.is_active and table.activated_at is not None:
        starts.append(_ensure_aware_utc(table.activated_at))
    if table.is_active and not starts:
        starts.append(now_utc)
    if not starts:
        return None
    st = min(starts)
    return (st, st + timedelta(minutes=turn_minutes))


def _bookable_floors_for_public(session: Session, tenant_id: int) -> list[models.Floor]:
    """Active floors that have at least one table on that floor (public zone list)."""
    floors = session.exec(
        select(models.Floor)
        .where(models.Floor.tenant_id == tenant_id, models.Floor.is_active.is_(True))
        .order_by(models.Floor.sort_order, models.Floor.name)
    ).all()
    out: list[models.Floor] = []
    for f in floors:
        if f.id is None:
            continue
        one = session.exec(
            select(models.Table)
            .where(models.Table.tenant_id == tenant_id, models.Table.floor_id == f.id)
            .limit(1)
        ).first()
        if one is not None:
            out.append(f)
    return out


def _table_blocks_reservation_slot(
    table: models.Table,
    seated: models.Reservation | None,
    order: models.Order | None,
    res_date: date,
    slot_time: time,
    tenant: models.Tenant,
    now_utc: datetime,
) -> bool:
    """True if this table cannot be counted for reservations at (res_date, slot_time)."""
    turn = tenant.reservation_average_table_turn_minutes
    tz = ZoneInfo(tenant.timezone) if tenant.timezone else timezone.utc
    today_local = now_utc.astimezone(tz).date()
    slot_utc = _slot_datetime_utc(res_date, slot_time, tenant)

    if turn is None or turn <= 0:
        if res_date != today_local:
            return False
        if seated is not None or order is not None or table.is_active:
            return True
        return False

    interval = _table_busy_interval_turn(table, seated, order, turn, now_utc)
    if interval is None:
        return False
    start, end = interval
    return start <= slot_utc < end


def _reservable_capacity_for_tenant(
    session: Session,
    tenant_id: int,
    res_date: date,
    tenant: models.Tenant,
    slot_time: time,
    *,
    _now_utc: datetime | None = None,
    floor_id: int | None = None,
) -> tuple[int, int]:
    """Seats and table count in the reservation pool for one slot.

    Excludes tables busy at that slot (turn-time windows when configured; else same-day block).
    Then drops the smallest ``reservation_walk_in_tables_reserved`` tables from the pool for walk-ins.

    When ``floor_id`` is set, only tables on that floor are counted (``Table.floor_id == floor_id``).
    Tables with ``floor_id`` null are never counted for a zone-specific pool — they only contribute
    to venue-wide capacity (``floor_id`` None).
    """
    now_utc = _now_utc or datetime.now(timezone.utc)
    tables = session.exec(
        select(models.Table).where(models.Table.tenant_id == tenant_id)
    ).all()
    if floor_id is not None:
        tables = [t for t in tables if t.floor_id == floor_id]
    if not tables:
        return (0, 0)
    table_ids = [t.id for t in tables if t.id is not None]
    if not table_ids:
        return (0, 0)

    seated_rows = session.exec(
        select(models.Reservation).where(
            models.Reservation.tenant_id == tenant_id,
            models.Reservation.table_id.in_(table_ids),
            models.Reservation.status == models.ReservationStatus.seated,
        )
    ).all()
    seated_by_table: dict[int, models.Reservation] = {
        r.table_id: r for r in seated_rows if r.table_id is not None
    }

    orders_all = session.exec(
        select(models.Order).where(
            models.Order.table_id.in_(table_ids),
            models.Order.status.in_(
                [
                    models.OrderStatus.pending,
                    models.OrderStatus.preparing,
                    models.OrderStatus.ready,
                    models.OrderStatus.partially_delivered,
                ]
            ),
        )
    ).all()
    orders_by_table: dict[int, models.Order] = {}
    for o in orders_all:
        tid = o.table_id
        if tid not in orders_by_table or o.created_at < orders_by_table[tid].created_at:
            orders_by_table[tid] = o

    blocked: set[int] = set()
    for t in tables:
        if t.id is None:
            continue
        if _table_blocks_reservation_slot(
            t,
            seated_by_table.get(t.id),
            orders_by_table.get(t.id),
            res_date,
            slot_time,
            tenant,
            now_utc,
        ):
            blocked.add(t.id)

    seen_group: set[int] = set()
    for t in tables:
        if t.id is None or not t.table_group_id:
            continue
        if t.table_group_id in seen_group:
            continue
        seen_group.add(t.table_group_id)
        member_ids = [
            x.id for x in tables if x.table_group_id == t.table_group_id and x.id is not None
        ]
        if any(mid in blocked for mid in member_ids):
            blocked.update(member_ids)

    # Reservation pool units: standalone tables or one unit per table group (combined seats).
    units: list[tuple[int, int]] = []  # (seat_weight, sort_id)
    seen_group = set()
    for t in tables:
        if t.id is None:
            continue
        if t.table_group_id:
            if t.table_group_id in seen_group:
                continue
            seen_group.add(t.table_group_id)
            members = [x for x in tables if x.table_group_id == t.table_group_id]
            member_ids = [m.id for m in members if m.id is not None]
            if any(mid in blocked for mid in member_ids):
                continue
            w = sum(m.seat_count for m in members)
            rid = min(member_ids)
            units.append((w, rid))
        else:
            if t.id in blocked:
                continue
            units.append((t.seat_count, t.id))

    units.sort(key=lambda u: (u[0], u[1]))
    walk = max(0, tenant.reservation_walk_in_tables_reserved or 0)
    if walk >= len(units):
        return (0, 0)
    pool = units[walk:]
    total_seats = sum(u[0] for u in pool)
    n_tables = len(pool)
    cap = tenant.reservation_max_guests_per_slot
    if cap is not None and cap > 0:
        total_seats = min(total_seats, cap)
    return (total_seats, n_tables)


def _normalize_floor_seating_zone_value(raw: str | None) -> str:
    if raw is None or not str(raw).strip():
        return "any"
    s = str(raw).strip().lower()
    if s in ("indoor", "outdoor", "any"):
        return s
    return "any"


def _parse_floor_seating_zone_for_write(raw: str | None) -> str:
    """Validate API input for Floor.seating_zone (indoor | outdoor | any)."""
    if raw is None or not str(raw).strip():
        return "any"
    s = str(raw).strip().lower()
    if s in ("indoor", "outdoor", "any"):
        return s
    raise HTTPException(status_code=400, detail="Invalid seating_zone")


def _floor_matches_seating_preference(floor: models.Floor, seating_pref: str | None) -> bool:
    """Whether a floor's seating_zone is compatible with reservation seating_preference."""
    zone = _normalize_floor_seating_zone_value(getattr(floor, "seating_zone", None))
    sp = (seating_pref or "no_preference").strip().lower()
    if sp in ("", "no_preference"):
        return True
    if zone == "any":
        return True
    if sp == "indoor":
        return zone == "indoor"
    if sp == "terrace":
        return zone == "outdoor"
    return True


def _bookable_floors_matching_seating(
    session: Session, tenant_id: int, seating_pref: str | None
) -> list[models.Floor]:
    """Active public book zones whose seating_zone matches the guest's seating preference."""
    bookable = _bookable_floors_for_public(session, tenant_id)
    return [f for f in bookable if _floor_matches_seating_preference(f, seating_pref)]


def _validate_floor_seating_pair_or_raise(
    floor: models.Floor | None, seating_pref: str | None, lang: str
) -> None:
    if floor is None:
        return
    if not _floor_matches_seating_preference(floor, seating_pref):
        raise HTTPException(
            status_code=400, detail=api_error_payload("reservation_seating_floor_mismatch", lang)
        )


def _demand_for_slot(
    session: Session,
    tenant_id: int,
    slot_date: date,
    slot_time: time,
    exclude_reservation_id: int | None = None,
    floor_id: int | None = None,
) -> tuple[int, int]:
    """Return (reserved_guests, reserved_parties) for the slot. Active = booked, seated.

    Venue-wide (floor_id None): all reservations on the slot count.

    Zone-scoped (floor_id set): counts reservations with ``preferred_floor_id == floor_id``, plus
    reservations with no preferred floor but a seated table on that floor (``table.floor_id``).
    Booked parties without preferred floor and without a table do not consume zone capacity (they
    only count venue-wide).
    """
    q = select(models.Reservation).where(
        models.Reservation.tenant_id == tenant_id,
        models.Reservation.reservation_date == slot_date,
        models.Reservation.reservation_time == slot_time,
        models.Reservation.status.in_([models.ReservationStatus.booked, models.ReservationStatus.seated]),
    )
    if exclude_reservation_id is not None:
        q = q.where(models.Reservation.id != exclude_reservation_id)
    reservations = session.exec(q).all()
    if floor_id is None:
        reserved_guests = sum(r.party_size for r in reservations)
        return (reserved_guests, len(reservations))
    table_ids = [r.table_id for r in reservations if r.table_id]
    tables_map: dict[int, models.Table] = {}
    if table_ids:
        tbls = session.exec(select(models.Table).where(models.Table.id.in_(table_ids))).all()
        tables_map = {t.id: t for t in tbls if t.id is not None}
    included: list[models.Reservation] = []
    for r in reservations:
        pf = getattr(r, "preferred_floor_id", None)
        if pf == floor_id:
            included.append(r)
        elif pf is None and r.table_id:
            t = tables_map.get(r.table_id)
            if t and t.floor_id == floor_id:
                included.append(r)
    reserved_guests = sum(r.party_size for r in included)
    return (reserved_guests, len(included))


def _normalize_reservation_service_type(raw: str | None) -> str | None:
    if raw is None or not str(raw).strip():
        return None
    s = str(raw).strip().lower()
    if s in ("all", "any"):
        return None
    if s in ("lunch", "dinner"):
        return s
    raise HTTPException(status_code=400, detail="Invalid service_type")


def _normalize_seating_preference(raw: str | None) -> str | None:
    if raw is None or not str(raw).strip():
        return None
    s = str(raw).strip().lower()
    if s in ("indoor", "terrace", "no_preference"):
        return s
    raise HTTPException(status_code=400, detail="Invalid seating_preference")


def _normalize_allergies_for_booking(
    allergies_has: bool | None, allergies_detail: str | None
) -> tuple[bool, str | None]:
    has = bool(allergies_has) if allergies_has is not None else False
    detail = (allergies_detail or "").strip() if allergies_detail else None
    if has and not detail:
        raise HTTPException(
            status_code=400,
            detail="Allergies detail is required when allergies are indicated",
        )
    if not has:
        return (False, None)
    return (True, detail)


def _normalize_guest_birthday(
    month: int | None,
    day: int | None,
    *,
    lang: str,
) -> tuple[int | None, int | None]:
    """Validate optional month/day pair (no year). Empty = clear. Both required when either set."""
    if month is None and day is None:
        return None, None
    if month is None or day is None:
        raise HTTPException(
            status_code=400,
            detail=api_error_payload("invalid_guest_birthday", lang),
        )
    try:
        m = int(month)
        d = int(day)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail=api_error_payload("invalid_guest_birthday", lang),
        )
    if m < 1 or m > 12 or d < 1 or d > 31:
        raise HTTPException(
            status_code=400,
            detail=api_error_payload("invalid_guest_birthday", lang),
        )
    try:
        # Leap year so 29 Feb is allowed without collecting year of birth.
        date(2000, m, d)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=api_error_payload("invalid_guest_birthday", lang),
        )
    return m, d


@app.get("/reservations/slot-capacity")
def get_slot_capacity(
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_READ))],
    session: Session = Depends(get_session),
    date_str: str = Query(..., description="Date YYYY-MM-DD"),
    time_str: str = Query(..., description="Time HH:MM"),
    exclude_reservation_id: int | None = Query(None, description="Exclude this reservation (for edit)"),
    floor_id: int | None = Query(None, description="Optional zone: capacity for that floor only"),
) -> dict:
    """Capacity and demand for one slot (for create/edit form). Staff only."""
    try:
        d = _parse_reservation_date(date_str)
        slot_time = _parse_reservation_time(time_str)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    tenant_id = current_user.tenant_id
    tenant = session.get(models.Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    total_seats, total_tables = _reservable_capacity_for_tenant(
        session, tenant_id, d, tenant, slot_time, floor_id=floor_id
    )
    reserved_guests, reserved_parties = _demand_for_slot(
        session, tenant_id, d, slot_time, exclude_reservation_id=exclude_reservation_id, floor_id=floor_id
    )
    return {
        "total_seats": total_seats,
        "total_tables": total_tables,
        "reserved_guests": reserved_guests,
        "reserved_parties": reserved_parties,
        "seats_left": max(0, total_seats - reserved_guests),
        "tables_left": max(0, total_tables - reserved_parties),
    }


@app.get("/reservations/upcoming-no-table-count")
def get_upcoming_reservations_no_table_count(
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_READ))],
    session: Session = Depends(get_session),
    date_str: str = Query(..., description="Date YYYY-MM-DD (e.g. reservation date for seat modal)"),
    reservation_id: int | None = Query(None, description="If seating this reservation, exclude it and count others at same time or later"),
) -> dict:
    """Count of other booked reservations on the given date with no table assigned (for seat modal warning). Staff only."""
    try:
        d = _parse_reservation_date(date_str)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    tenant_id = current_user.tenant_id

    q = select(models.Reservation).where(
        models.Reservation.tenant_id == tenant_id,
        models.Reservation.reservation_date == d,
        models.Reservation.status == models.ReservationStatus.booked,
        models.Reservation.table_id.is_(None),
    )
    if reservation_id is not None:
        res = session.exec(
            select(models.Reservation).where(
                models.Reservation.id == reservation_id,
                models.Reservation.tenant_id == tenant_id,
            )
        ).first()
        if res:
            q = q.where(models.Reservation.id != reservation_id)
            q = q.where(models.Reservation.reservation_time >= res.reservation_time)
        # else reservation not found; count all
    else:
        today_utc = datetime.now(timezone.utc).date()
        now_utc = datetime.now(timezone.utc).time()
        if d == today_utc:
            q = q.where(models.Reservation.reservation_time > now_utc)

    count = len(session.exec(q).all())
    return {"count": count}


@app.get("/reservations/overbooking-report")
def get_reservations_overbooking_report(
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_READ))],
    session: Session = Depends(get_session),
    date_str: str = Query(..., description="Date YYYY-MM-DD"),
    time_from: str | None = Query(None, description="Start time HH:MM (optional)"),
    time_to: str | None = Query(None, description="End time HH:MM (optional)"),
) -> dict:
    """Per-slot overbooking metrics for the given date. Staff only."""
    try:
        d = _parse_reservation_date(date_str)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    tenant_id = current_user.tenant_id
    tenant = session.get(models.Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Collect slot times: distinct reservation times on that date, or default 08:00–23:00 in 15-min steps
    reservations_on_date = session.exec(
        select(models.Reservation.reservation_time).where(
            models.Reservation.tenant_id == tenant_id,
            models.Reservation.reservation_date == d,
            models.Reservation.status.in_([models.ReservationStatus.booked, models.ReservationStatus.seated]),
        ).distinct()
    ).all()
    slot_times_set: set[time] = set(reservations_on_date)
    if not slot_times_set:
        slot_step = _effective_reservation_slot_minutes(tenant)
        for st in _grid_slot_times_for_windows([(time(8, 0), time(23, 0))], slot_step):
            slot_times_set.add(st)
    slot_times = sorted(slot_times_set)

    time_from_parsed: time | None = None
    time_to_parsed: time | None = None
    if time_from:
        try:
            time_from_parsed = _parse_reservation_time(time_from)
        except ValueError:
            pass
    if time_to:
        try:
            time_to_parsed = _parse_reservation_time(time_to)
        except ValueError:
            pass
    if time_from_parsed is not None:
        slot_times = [t for t in slot_times if t >= time_from_parsed]
    if time_to_parsed is not None:
        slot_times = [t for t in slot_times if t <= time_to_parsed]

    slots = []
    for st in slot_times:
        total_seats, total_tables = _reservable_capacity_for_tenant(
            session, tenant_id, d, tenant, st
        )
        reserved_guests, reserved_parties = _demand_for_slot(session, tenant_id, d, st)
        over_seats = reserved_guests > total_seats
        over_tables = reserved_parties > total_tables
        slots.append({
            "reservation_time": st.strftime("%H:%M"),
            "total_seats": total_seats,
            "total_tables": total_tables,
            "reserved_guests": reserved_guests,
            "reserved_parties": reserved_parties,
            "over_seats": over_seats,
            "over_tables": over_tables,
        })
    phys_seats, phys_tables = _capacity_for_tenant(session, tenant_id)
    return {
        "date": d.isoformat(),
        "total_seats": phys_seats,
        "total_tables": phys_tables,
        "slots": slots,
    }


def _client_ip_from_request(request: Request) -> str | None:
    """Client IP: X-Forwarded-For (first hop) or request.client.host."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def _send_reservation_confirmation_background(tenant_id: int, reservation_id: int) -> None:
    """Background task: load tenant and reservation, send confirmation email if customer_email is set."""
    with Session(engine) as session:
        tenant = session.get(models.Tenant, tenant_id)
        reservation = session.get(models.Reservation, reservation_id)
        if not tenant or not reservation:
            logger.warning("Reservation confirmation skipped: tenant_id=%s reservation_id=%s not found", tenant_id, reservation_id)
            return
        if not (reservation.customer_email and reservation.customer_email.strip()):
            logger.info("Reservation confirmation skipped: reservation_id=%s has no customer_email", reservation_id)
            return
        # Use tenant SMTP if configured; else fall back to global config.env SMTP
        has_tenant_smtp = bool(tenant.smtp_user and tenant.smtp_password)
        has_global_smtp = bool(settings.smtp_user and settings.smtp_password)
        if not has_tenant_smtp and not has_global_smtp:
            logger.warning(
                "Reservation confirmation skipped: tenant_id=%s (name=%s) has no SMTP and global SMTP not set. "
                "Configure Settings → Email for this tenant or set SMTP_* in config.env.",
                tenant_id,
                tenant.name,
            )
            return
        smtp_tenant = tenant if has_tenant_smtp else None  # None => email_svc uses global config
        view_url = None
        if settings.public_app_base_url and reservation.token:
            view_url = f"{settings.public_app_base_url.rstrip('/')}/reservation?token={reservation.token}"
        date_str = reservation.reservation_date.isoformat() if reservation.reservation_date else ""
        time_str = reservation.reservation_time.strftime("%H:%M") if reservation.reservation_time else ""
        try:
            asyncio.run(
                email_svc.send_reservation_confirmation(
                    to_email=reservation.customer_email.strip(),
                    customer_name=reservation.customer_name,
                    reservation_date=date_str,
                    reservation_time=time_str,
                    party_size=reservation.party_size,
                    tenant=tenant,
                    view_url=view_url,
                    smtp_tenant=smtp_tenant,
                    reservation=reservation,
                )
            )
            logger.info("Reservation confirmation email sent for reservation_id=%s to %s", reservation_id, reservation.customer_email.strip())
        except Exception as e:
            logger.exception("Reservation confirmation email failed for reservation_id=%s: %s", reservation_id, e)


@app.post("/reservations")
@limiter.limit("30/hour")
def create_reservation(
    request: Request,
    body: models.ReservationCreate,
    current_user: Annotated[models.User | None, Depends(security.get_current_user_optional)],
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    lang: str = Depends(_get_requested_language),
) -> dict:
    """Create a reservation. Authenticated: tenant from user. Public: tenant_id required in body."""
    if current_user:
        tenant_id = current_user.tenant_id
        data = body
    else:
        if body.tenant_id is None:
            raise HTTPException(
                status_code=400,
                detail=api_error_payload("tenant_id_required_for_booking", lang),
            )
        tenant_id = body.tenant_id
        data = body
    # Validate tenant exists
    tenant = session.get(models.Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail=api_error_payload("tenant_not_found", lang))
    try:
        res_date = _parse_reservation_date(data.reservation_date)
        res_time = _parse_reservation_time(data.reservation_time)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=api_error_payload("invalid_reservation_datetime", lang),
        )
    # Reject past date/time (use business timezone if configured, else UTC)
    tz = ZoneInfo(tenant.timezone) if tenant.timezone else timezone.utc
    now_local = datetime.now(tz)
    if res_date < now_local.date():
        raise HTTPException(
            status_code=400,
            detail=api_error_payload("reservation_date_must_be_today_or_future", lang),
        )
    max_ahead_date = now_local.date() + timedelta(days=366)
    if res_date > max_ahead_date:
        raise HTTPException(status_code=400, detail=api_error_payload("reservation_date_too_far", lang))
    res_dt = datetime.combine(res_date, res_time, tzinfo=tz)
    if not current_user:
        min_dt = now_local + timedelta(minutes=RESERVATION_PUBLIC_MIN_LEAD_MINUTES)
        if res_dt < min_dt:
            raise HTTPException(
                status_code=400,
                detail=api_error_payload(
                    "reservation_min_lead_time",
                    lang,
                    minutes=RESERVATION_PUBLIC_MIN_LEAD_MINUTES,
                ),
            )
    else:
        if res_dt <= now_local:
            raise HTTPException(
                status_code=400,
                detail=api_error_payload("reservation_time_must_be_future", lang),
            )
    service_type = _normalize_reservation_service_type(getattr(data, "service_type", None))
    seating_pref = _normalize_seating_preference(getattr(data, "seating_preference", None))
    ah_raw = getattr(data, "allergies_has", None)
    ad_raw = getattr(data, "allergies_detail", None)
    allergies_has, allergies_detail = _normalize_allergies_for_booking(ah_raw, ad_raw)
    bday_month: int | None = None
    bday_day: int | None = None
    bday_consent = False
    allow_public_birthday = current_user is not None or bool(
        getattr(tenant, "guest_birthday_capture_enabled", True)
    )
    if allow_public_birthday:
        raw_bm = getattr(data, "guest_birthday_month", None)
        raw_bd = getattr(data, "guest_birthday_day", None)
        if raw_bm is not None or raw_bd is not None:
            bday_month, bday_day = _normalize_guest_birthday(raw_bm, raw_bd, lang=lang)
        raw_consent = getattr(data, "guest_birthday_marketing_consent", None)
        marketing_on = bool(getattr(tenant, "guest_birthday_marketing_enabled", False))
        bday_consent = bool(raw_consent) if marketing_on and bday_month is not None else False
    _raise_if_reservation_time_invalid_for_opening_hours(
        session, tenant, res_date, res_time, service_type
    )
    bookable = _bookable_floors_for_public(session, tenant_id)
    matching = _bookable_floors_matching_seating(session, tenant_id, seating_pref)
    matching_ids = {f.id for f in matching if f.id is not None}
    bookable_ids = {f.id for f in bookable if f.id is not None}
    raw_pf = getattr(data, "preferred_floor_id", None)
    eff_floor: int | None = None
    if current_user:
        if raw_pf is not None:
            fl = session.exec(
                select(models.Floor).where(
                    models.Floor.id == raw_pf,
                    models.Floor.tenant_id == tenant_id,
                )
            ).first()
            if not fl:
                raise HTTPException(status_code=400, detail=api_error_payload("floor_not_found", lang))
            _validate_floor_seating_pair_or_raise(fl, seating_pref, lang)
            eff_floor = raw_pf
    else:
        if raw_pf is not None:
            if raw_pf not in bookable_ids:
                raise HTTPException(status_code=400, detail=api_error_payload("reservation_invalid_seating_area", lang))
            if raw_pf not in matching_ids:
                raise HTTPException(status_code=400, detail=api_error_payload("reservation_invalid_seating_area", lang))
            eff_floor = raw_pf
        elif len(matching) == 1:
            eff_floor = matching[0].id
        elif len(matching) >= 2:
            raise HTTPException(status_code=400, detail=api_error_payload("reservation_location_required", lang))
        elif len(bookable) >= 1 and len(matching) == 0:
            raise HTTPException(
                status_code=400, detail=api_error_payload("reservation_seating_no_matching_zone", lang)
            )
        else:
            eff_floor = None
    total_seats, total_tables = _reservable_capacity_for_tenant(
        session, tenant_id, res_date, tenant, res_time, floor_id=eff_floor
    )
    reserved_guests, reserved_parties = _demand_for_slot(
        session, tenant_id, res_date, res_time, exclude_reservation_id=None, floor_id=eff_floor
    )
    if reserved_guests + data.party_size > total_seats or reserved_parties + 1 > total_tables:
        raise HTTPException(
            status_code=400,
            detail=f"Slot is over capacity: {reserved_guests + data.party_size} guests / {reserved_parties + 1} parties for this time (max {total_seats} seats, {total_tables} tables).",
        )
    try:
        phone_e164 = normalize_phone_e164(data.customer_phone, settings.default_phone_country)
    except ValueError:
        raise HTTPException(status_code=400, detail=api_error_payload("invalid_phone", lang))
    cust_email = None
    if data.customer_email is not None and str(data.customer_email).strip():
        try:
            cust_email = normalize_email_address(data.customer_email)
        except ValueError:
            raise HTTPException(status_code=400, detail=api_error_payload("invalid_email", lang))
    token_str = str(uuid4())
    client_ip = _client_ip_from_request(request)
    user_agent = (request.headers.get("user-agent") or "")[:512]
    reservation = models.Reservation(
        tenant_id=tenant_id,
        customer_name=data.customer_name,
        customer_phone=phone_e164,
        customer_email=cust_email,
        reservation_date=res_date,
        reservation_time=res_time,
        party_size=data.party_size,
        status=models.ReservationStatus.booked,
        token=token_str,
        client_notes=data.client_notes,
        customer_notes=getattr(data, "customer_notes", None),
        owner_notes=None,
        client_ip=client_ip,
        client_user_agent=user_agent or None,
        client_fingerprint=data.client_fingerprint,
        client_screen_width=data.client_screen_width,
        client_screen_height=data.client_screen_height,
        service_type=service_type,
        seating_preference=seating_pref,
        allergies_has=allergies_has,
        allergies_detail=allergies_detail,
        preferred_floor_id=eff_floor,
        locale=lang,
        guest_birthday_month=bday_month,
        guest_birthday_day=bday_day,
        guest_birthday_marketing_consent=bday_consent,
    )
    session.add(reservation)
    session.commit()
    session.refresh(reservation)
    # Send confirmation whenever customer email is present (staff or public; token only adds view/cancel link)
    if reservation.customer_email and reservation.customer_email.strip():
        background_tasks.add_task(_send_reservation_confirmation_background, tenant_id, reservation.id)
    out = _reservation_to_dict(reservation, session, include_client_tech=current_user is not None)
    publish_reservation_update(tenant_id, {"type": "new_reservation", "reservation": out})
    return out


@app.get("/reservations")
def list_reservations(
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_READ))],
    session: Session = Depends(get_session),
    reservation_date: str | None = Query(None, description="Filter by date YYYY-MM-DD"),
    status: str | None = Query(None, description="Filter by status"),
    phone: str | None = Query(None, description="Search by phone (partial)"),
) -> list[dict]:
    """List reservations for the tenant. Staff only."""
    q = select(models.Reservation).where(models.Reservation.tenant_id == current_user.tenant_id)
    if reservation_date:
        try:
            d = _parse_reservation_date(reservation_date)
            q = q.where(models.Reservation.reservation_date == d)
        except ValueError:
            pass
    if status:
        q = q.where(models.Reservation.status == status)
    if phone and phone.strip():
        q = q.where(models.Reservation.customer_phone.contains(phone.strip()))
    q = q.order_by(models.Reservation.reservation_date, models.Reservation.reservation_time)
    reservations = session.exec(q).all()
    return [_reservation_to_dict(r, session, include_client_tech=True) for r in reservations]


@app.get("/waiting-list")
def list_waiting_list(
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_READ))],
    session: Session = Depends(get_session),
    status: str | None = Query(None, description="Filter by status"),
    phone: str | None = Query(None, description="Search by phone (partial)"),
    active_only: bool = Query(True, description="When true, exclude seated/cancelled/no_show"),
) -> list[dict]:
    """List waiting-list entries for the tenant. Staff only."""
    q = select(models.WaitingListEntry).where(
        models.WaitingListEntry.tenant_id == current_user.tenant_id
    )
    if status:
        q = q.where(models.WaitingListEntry.status == status)
    elif active_only:
        q = q.where(
            models.WaitingListEntry.status.in_(
                [
                    models.WaitingListStatus.waiting,
                    models.WaitingListStatus.notified,
                ]
            )
        )
    if phone and phone.strip():
        q = q.where(models.WaitingListEntry.customer_phone.contains(phone.strip()))
    q = q.order_by(models.WaitingListEntry.created_at)
    rows = session.exec(q).all()
    return [_waiting_list_entry_to_dict(r, include_client_tech=True) for r in rows]


@app.post("/waiting-list")
def create_waiting_list_entry_staff(
    request: Request,
    body: models.WaitingListEntryCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_WRITE))],
    session: Session = Depends(get_session),
    lang: str = Depends(_get_requested_language),
) -> dict:
    """Staff creates a waiting-list entry."""
    name = str(body.customer_name or "").replace("\x00", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail=api_error_payload("customer_name_required", lang))
    try:
        phone_e164 = normalize_phone_e164(body.customer_phone, settings.default_phone_country)
    except ValueError:
        raise HTTPException(status_code=400, detail=api_error_payload("invalid_phone", lang))
    party_size = int(body.party_size)
    if party_size < 1 or party_size > 99:
        raise HTTPException(status_code=400, detail=api_error_payload("invalid_party_size", lang))
    now = datetime.now(timezone.utc)
    row = models.WaitingListEntry(
        tenant_id=current_user.tenant_id,
        customer_name=name[:200],
        customer_phone=phone_e164,
        party_size=party_size,
        status=models.WaitingListStatus.waiting,
        client_ip=_client_ip_from_request(request),
        client_user_agent=(request.headers.get("user-agent") or "")[:512] or None,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    out = _waiting_list_entry_to_dict(row, include_client_tech=True)
    publish_reservation_update(current_user.tenant_id, {"type": "waiting_list_update", "entry": out})
    return out


@app.put("/waiting-list/{entry_id}/status")
def update_waiting_list_status(
    entry_id: int,
    body: models.WaitingListStatusUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    """Update waiting-list entry status. Staff only."""
    entry = session.exec(
        select(models.WaitingListEntry).where(
            models.WaitingListEntry.id == entry_id,
            models.WaitingListEntry.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Waiting list entry not found")
    now = datetime.now(timezone.utc)
    entry.status = body.status
    if body.status == models.WaitingListStatus.notified:
        entry.notified_at = now
    entry.updated_at = now
    session.add(entry)
    session.commit()
    session.refresh(entry)
    out = _waiting_list_entry_to_dict(entry, include_client_tech=True)
    publish_reservation_update(current_user.tenant_id, {"type": "waiting_list_update", "entry": out})
    return out


@app.get("/reservations/prefill-by-phone")
def get_reservation_prefill_by_phone(
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_READ))],
    session: Session = Depends(get_session),
    phone: str = Query(..., min_length=1, description="Customer phone (partial match)"),
) -> dict:
    """Return the most recent reservation for this tenant matching the phone, for pre-filling a new reservation form. Staff only."""
    if not phone or not phone.strip():
        raise HTTPException(status_code=400, detail="Phone is required")
    q = (
        select(models.Reservation)
        .where(models.Reservation.tenant_id == current_user.tenant_id)
        .where(models.Reservation.customer_phone.contains(phone.strip()))
        .order_by(
            models.Reservation.reservation_date.desc(),
            models.Reservation.reservation_time.desc(),
        )
        .limit(1)
    )
    r = session.exec(q).first()
    if not r:
        raise HTTPException(status_code=404, detail="No previous reservation found for this phone")
    return _reservation_to_dict(r, session, include_client_tech=False)


@app.get("/reservations/book-calendar")
def get_reservation_book_calendar(
    tenant_id: int = Query(...),
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    session: Session = Depends(get_session),
) -> dict:
    """Public: per-day open/closed for a month from tenant opening hours (for book page calendar)."""
    tenant = session.get(models.Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    _, last_day = monthrange(year, month)
    days: list[dict] = []
    for dom in range(1, last_day + 1):
        d = date(year, month, dom)
        windows = _opening_service_windows_for_date(session, tenant, d)
        if windows is None:
            state = "open"
        elif len(windows) == 0:
            state = "closed"
        else:
            state = "open"
        days.append({"date": d.isoformat(), "state": state})

    return {"year": year, "month": month, "days": days}


def _public_book_slot_cells_for_single_date(
    session: Session,
    tenant_id: int,
    tenant: models.Tenant,
    d: date,
    party_size: int,
    exclude_reservation_id: int | None,
    svc: str | None,
    tz: ZoneInfo,
    now_local: datetime,
    today_local: date,
    min_dt: datetime,
    max_book: date,
    floor_id: int | None = None,
) -> dict[str, str]:
    """Per time-slot state for one calendar day (same rules as book-week-slots)."""
    slot_step = _effective_reservation_slot_minutes(tenant)
    windows = _opening_service_windows_for_date(session, tenant, d)
    if windows is None:
        windows = [(time(8, 0), time(23, 0))]
    windows_f = _filter_windows_by_service(windows, svc)
    day_closed = len(windows) == 0 or len(windows_f) == 0
    allowed_times: set[time] = set()
    if not day_closed:
        allowed_times = set(_grid_slot_times_for_windows(windows_f, slot_step))
    times_sorted = sorted(allowed_times, key=lambda x: x.hour * 60 + x.minute)
    cells: dict[str, str] = {}
    for st in times_sorted:
        key = st.strftime("%H:%M")
        if d > max_book:
            cells[key] = "out_of_range"
            continue
        if day_closed:
            cells[key] = "closed_day"
            continue
        if st not in allowed_times:
            cells[key] = "out_of_hours"
            continue
        if d < today_local:
            cells[key] = "past"
            continue
        slot_dt = datetime.combine(d, st, tzinfo=tz)
        if slot_dt < min_dt:
            cells[key] = "past"
            continue
        total_seats, total_tables = _reservable_capacity_for_tenant(
            session, tenant_id, d, tenant, st, floor_id=floor_id
        )
        if total_tables < 1 or total_seats < party_size:
            cells[key] = "full"
            continue
        reserved_guests, reserved_parties = _demand_for_slot(
            session, tenant_id, d, st, exclude_reservation_id=exclude_reservation_id, floor_id=floor_id
        )
        if reserved_guests + party_size <= total_seats and reserved_parties + 1 <= total_tables:
            cells[key] = "available"
        else:
            cells[key] = "full"
    return cells


def _aggregate_public_day_slot_state(cells: dict[str, str]) -> str:
    """Single UI state for a day cell from per-slot states."""
    if not cells:
        return "closed_day"
    vals = set(cells.values())
    if "available" in vals:
        return "available"
    if vals == {"closed_day"}:
        return "closed_day"
    if vals == {"out_of_range"}:
        return "out_of_range"
    if "full" in vals:
        return "full"
    if vals <= {"past"}:
        return "past"
    if "past" in vals:
        return "past"
    return "out_of_hours"


def _monday_on_or_before(d: date) -> date:
    """ISO weekday: Monday=0 … Sunday=6."""
    return d - timedelta(days=d.weekday())


@app.get("/reservations/book-week-slots")
def get_reservation_book_week_slots(
    tenant_id: int = Query(...),
    week_anchor: str | None = Query(
        None,
        alias="week_anchor",
        description="Any date YYYY-MM-DD in the target week; Mon–Sun grid (tenant calendar). Omit = week containing today",
    ),
    party_size: int = Query(2, ge=1, le=100),
    exclude_reservation_id: int | None = Query(
        None,
        description="Exclude this reservation from demand (staff edit: current booking)",
    ),
    service: str | None = Query(
        None,
        description="Optional lunch|dinner to show only that service window when opening hours have a break",
    ),
    floor_id: int | None = Query(
        None,
        description="Optional seating zone: capacity and demand for that floor only",
    ),
    session: Session = Depends(get_session),
) -> dict:
    """Public: per-slot availability for a Mon–Sun grid (party size and capacity)."""
    tenant = session.get(models.Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    svc: str | None = None
    if service and str(service).strip():
        svc = _normalize_reservation_service_type(str(service).strip())

    tz = ZoneInfo(tenant.timezone) if tenant.timezone else timezone.utc
    now_local = datetime.now(tz)
    today_local = now_local.date()
    min_dt = now_local + timedelta(minutes=RESERVATION_PUBLIC_MIN_LEAD_MINUTES)
    max_book = today_local + timedelta(days=366)

    if week_anchor and str(week_anchor).strip():
        try:
            anchor_day = _parse_reservation_date(str(week_anchor).strip())
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    else:
        anchor_day = today_local

    anchor_monday = _monday_on_or_before(anchor_day)

    slot_step = _effective_reservation_slot_minutes(tenant)
    all_slot_times: set[time] = set()
    for i in range(7):
        d = anchor_monday + timedelta(days=i)
        windows = _opening_service_windows_for_date(session, tenant, d)
        if windows is None:
            windows = [(time(8, 0), time(23, 0))]
        if len(windows) == 0:
            continue
        windows = _filter_windows_by_service(windows, svc)
        if len(windows) == 0:
            continue
        for st in _grid_slot_times_for_windows(windows, slot_step):
            all_slot_times.add(st)

    times_sorted = sorted(all_slot_times, key=lambda x: x.hour * 60 + x.minute)
    time_strings = [t.strftime("%H:%M") for t in times_sorted]

    days_out: list[dict] = []
    for i in range(7):
        d = anchor_monday + timedelta(days=i)
        cells: dict[str, str] = {}
        windows = _opening_service_windows_for_date(session, tenant, d)
        if windows is None:
            windows = [(time(8, 0), time(23, 0))]
        windows_f = _filter_windows_by_service(windows, svc)
        day_closed = len(windows) == 0 or len(windows_f) == 0
        allowed_times = set()
        if not day_closed:
            allowed_times = set(_grid_slot_times_for_windows(windows_f, slot_step))

        for st in times_sorted:
            key = st.strftime("%H:%M")
            if d > max_book:
                cells[key] = "out_of_range"
                continue
            if day_closed:
                cells[key] = "closed_day"
                continue
            if st not in allowed_times:
                cells[key] = "out_of_hours"
                continue
            if d < today_local:
                cells[key] = "past"
                continue
            slot_dt = datetime.combine(d, st, tzinfo=tz)
            if slot_dt < min_dt:
                cells[key] = "past"
                continue

            total_seats, total_tables = _reservable_capacity_for_tenant(
                session, tenant_id, d, tenant, st, floor_id=floor_id
            )
            if total_tables < 1 or total_seats < party_size:
                cells[key] = "full"
                continue

            reserved_guests, reserved_parties = _demand_for_slot(
                session, tenant_id, d, st, exclude_reservation_id=exclude_reservation_id, floor_id=floor_id
            )
            if reserved_guests + party_size <= total_seats and reserved_parties + 1 <= total_tables:
                cells[key] = "available"
            else:
                cells[key] = "full"

        days_out.append({"date": d.isoformat(), "cells": cells})

    earliest_week_monday = _monday_on_or_before(today_local)

    return {
        "week_start": anchor_monday.isoformat(),
        "earliest_week_monday": earliest_week_monday.isoformat(),
        "times": time_strings,
        "days": days_out,
    }


@app.get("/reservations/book-month-day-states")
def get_reservation_book_month_day_states(
    tenant_id: int = Query(...),
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    party_size: int = Query(2, ge=1, le=100),
    exclude_reservation_id: int | None = Query(
        None,
        description="Exclude this reservation from demand (staff edit: current booking)",
    ),
    service: str | None = Query(
        None,
        description="Optional lunch|dinner when opening hours have a break",
    ),
    floor_id: int | None = Query(
        None,
        description="Optional seating zone: capacity for that floor only",
    ),
    session: Session = Depends(get_session),
) -> dict:
    """Public: per-day aggregate slot state for a month (month calendar cells)."""
    tenant = session.get(models.Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    svc: str | None = None
    if service and str(service).strip():
        svc = _normalize_reservation_service_type(str(service).strip())

    tz = ZoneInfo(tenant.timezone) if tenant.timezone else timezone.utc
    now_local = datetime.now(tz)
    today_local = now_local.date()
    min_dt = now_local + timedelta(minutes=RESERVATION_PUBLIC_MIN_LEAD_MINUTES)
    max_book = today_local + timedelta(days=366)

    _, last_day = monthrange(year, month)
    days_out: list[dict] = []
    for dom in range(1, last_day + 1):
        d = date(year, month, dom)
        cells = _public_book_slot_cells_for_single_date(
            session,
            tenant_id,
            tenant,
            d,
            party_size,
            exclude_reservation_id,
            svc,
            tz,
            now_local,
            today_local,
            min_dt,
            max_book,
            floor_id=floor_id,
        )
        days_out.append({"date": d.isoformat(), "state": _aggregate_public_day_slot_state(cells)})

    return {"year": year, "month": month, "days": days_out}


@app.get("/reservations/book-day-slots")
def get_reservation_book_day_slots(
    tenant_id: int = Query(...),
    date_str: str = Query(..., alias="date", description="Reservation date YYYY-MM-DD"),
    party_size: int = Query(2, ge=1, le=100),
    exclude_reservation_id: int | None = Query(
        None,
        description="Exclude this reservation from demand (staff edit: current booking)",
    ),
    service: str | None = Query(
        None,
        description="Optional lunch|dinner when opening hours have a break",
    ),
    floor_id: int | None = Query(
        None,
        description="Optional seating zone: capacity for that floor only",
    ),
    session: Session = Depends(get_session),
) -> dict:
    """Public: time rows for one day (dropdown after date pick on book page)."""
    tenant = session.get(models.Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    svc: str | None = None
    if service and str(service).strip():
        svc = _normalize_reservation_service_type(str(service).strip())

    try:
        d = _parse_reservation_date(str(date_str).strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    tz = ZoneInfo(tenant.timezone) if tenant.timezone else timezone.utc
    now_local = datetime.now(tz)
    today_local = now_local.date()
    min_dt = now_local + timedelta(minutes=RESERVATION_PUBLIC_MIN_LEAD_MINUTES)
    max_book = today_local + timedelta(days=366)

    cells = _public_book_slot_cells_for_single_date(
        session,
        tenant_id,
        tenant,
        d,
        party_size,
        exclude_reservation_id,
        svc,
        tz,
        now_local,
        today_local,
        min_dt,
        max_book,
        floor_id=floor_id,
    )
    times_sorted = sorted(cells.keys(), key=lambda k: int(k[:2]) * 60 + int(k[3:5]))
    return {"date": d.isoformat(), "times": times_sorted, "cells": cells}


@app.get("/reservations/next-available")
def get_next_available_reservation_time(
    tenant_id: int = Query(...),
    date_str: str = Query(..., alias="date"),
    party_size: int = Query(2, ge=1, le=100, description="Party size for capacity check"),
    min_lead_minutes: int = Query(
        10,
        ge=0,
        le=240,
        description="Earliest slot must be at least this many minutes from now (use 0 for staff tools)",
    ),
    service: str | None = Query(None, description="Optional lunch|dinner for split opening hours"),
    floor_id: int | None = Query(None, description="Optional seating zone: capacity for that floor only"),
    session: Session = Depends(get_session),
) -> dict:
    """Public: find the next slot with capacity (by seats and table count)."""
    tenant = session.get(models.Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    svc: str | None = None
    if service and str(service).strip():
        svc = _normalize_reservation_service_type(str(service).strip())

    tz = ZoneInfo(tenant.timezone) if tenant.timezone else timezone.utc
    now_local = datetime.now(tz)
    min_dt = now_local + timedelta(minutes=min_lead_minutes)

    try:
        check_date = _parse_reservation_date(date_str)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    slot_step = _effective_reservation_slot_minutes(tenant)
    for day_offset in range(8):
        d = check_date + timedelta(days=day_offset)
        windows = _opening_service_windows_for_date(session, tenant, d)
        if windows is None:
            windows = [(time(8, 0), time(23, 0))]
        if len(windows) == 0:
            continue
        windows = _filter_windows_by_service(windows, svc)
        if len(windows) == 0:
            continue

        for slot_time in _grid_slot_times_for_windows(windows, slot_step):
            slot_dt = datetime.combine(d, slot_time, tzinfo=tz)
            if slot_dt < min_dt:
                continue

            total_seats, total_tables = _reservable_capacity_for_tenant(
                session, tenant_id, d, tenant, slot_time, floor_id=floor_id
            )
            if total_tables < 1 or total_seats < party_size:
                continue

            reserved_guests, reserved_parties = _demand_for_slot(
                session, tenant_id, d, slot_time, exclude_reservation_id=None, floor_id=floor_id
            )
            if reserved_guests + party_size <= total_seats and reserved_parties + 1 <= total_tables:
                return {
                    "date": d.isoformat(),
                    "time": slot_time.strftime("%H:%M"),
                }

    raise HTTPException(status_code=404, detail="No available time slots found")


@app.get("/reservations/by-token")
def get_reservation_by_token(
    token: str = Query(..., description="Reservation token from booking confirmation"),
    session: Session = Depends(get_session),
) -> dict:
    """Public: get one reservation by token (for view/cancel)."""
    reservation = session.exec(
        select(models.Reservation).where(models.Reservation.token == token)
    ).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    return _reservation_to_dict(reservation, session)


@app.get("/reservations/{reservation_id}")
def get_reservation(
    reservation_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_READ))],
    session: Session = Depends(get_session),
) -> dict:
    """Get one reservation by id. Staff only."""
    reservation = session.exec(
        select(models.Reservation).where(
            models.Reservation.id == reservation_id,
            models.Reservation.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    return _reservation_to_dict(reservation, session, include_client_tech=True)


@app.put("/reservations/{reservation_id}")
def update_reservation(
    reservation_id: int,
    body: models.ReservationUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_WRITE))],
    session: Session = Depends(get_session),
    lang: str = Depends(_get_requested_language),
) -> dict:
    """Update reservation. Only when status is booked. Staff only."""
    reservation = session.exec(
        select(models.Reservation).where(
            models.Reservation.id == reservation_id,
            models.Reservation.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    if reservation.status != models.ReservationStatus.booked:
        raise HTTPException(status_code=400, detail="Can only edit reservations that are booked")
    if body.customer_name is not None:
        reservation.customer_name = body.customer_name
    if body.customer_phone is not None:
        try:
            reservation.customer_phone = normalize_phone_e164(
                body.customer_phone, settings.default_phone_country
            )
        except ValueError:
            raise HTTPException(status_code=400, detail=api_error_payload("invalid_phone", lang))
    if body.customer_email is not None:
        if not str(body.customer_email).strip():
            reservation.customer_email = None
        else:
            try:
                reservation.customer_email = normalize_email_address(body.customer_email)
            except ValueError:
                raise HTTPException(status_code=400, detail=api_error_payload("invalid_email", lang))
    if body.client_notes is not None:
        reservation.client_notes = body.client_notes
    if body.customer_notes is not None:
        reservation.customer_notes = body.customer_notes
    if body.owner_notes is not None:
        reservation.owner_notes = body.owner_notes
    if body.delay_notice is not None:
        reservation.delay_notice = body.delay_notice
    if body.reservation_date is not None:
        reservation.reservation_date = _parse_reservation_date(body.reservation_date)
    if body.reservation_time is not None:
        reservation.reservation_time = _parse_reservation_time(body.reservation_time)
    if body.party_size is not None:
        reservation.party_size = body.party_size
    upd = body.model_dump(exclude_unset=True)
    if "service_type" in upd:
        reservation.service_type = (
            _normalize_reservation_service_type(body.service_type) if body.service_type else None
        )
    if "seating_preference" in upd:
        reservation.seating_preference = (
            _normalize_seating_preference(body.seating_preference) if body.seating_preference else None
        )
    if "allergies_has" in upd:
        reservation.allergies_has = bool(body.allergies_has)
    if "allergies_detail" in upd:
        reservation.allergies_detail = (body.allergies_detail or "").strip() or None
    if "preferred_floor_id" in upd:
        if body.preferred_floor_id is None:
            reservation.preferred_floor_id = None
        else:
            fl = session.exec(
                select(models.Floor).where(
                    models.Floor.id == body.preferred_floor_id,
                    models.Floor.tenant_id == current_user.tenant_id,
                )
            ).first()
            if not fl:
                raise HTTPException(status_code=400, detail=api_error_payload("floor_not_found", lang))
            _validate_floor_seating_pair_or_raise(fl, reservation.seating_preference, lang)
            reservation.preferred_floor_id = body.preferred_floor_id
    if (
        "guest_birthday_month" in upd
        or "guest_birthday_day" in upd
        or "guest_birthday_marketing_consent" in upd
    ):
        bm = (
            body.guest_birthday_month
            if "guest_birthday_month" in upd
            else reservation.guest_birthday_month
        )
        bd = (
            body.guest_birthday_day
            if "guest_birthday_day" in upd
            else reservation.guest_birthday_day
        )
        if "guest_birthday_month" in upd and "guest_birthday_day" in upd:
            bm, bd = body.guest_birthday_month, body.guest_birthday_day
        elif "guest_birthday_month" in upd and body.guest_birthday_month is None:
            bm, bd = None, None
        elif "guest_birthday_day" in upd and body.guest_birthday_day is None:
            bm, bd = None, None
        nm, nd = _normalize_guest_birthday(bm, bd, lang=lang)
        reservation.guest_birthday_month = nm
        reservation.guest_birthday_day = nd
        tenant_for_bday = session.get(models.Tenant, reservation.tenant_id)
        marketing_on = bool(
            getattr(tenant_for_bday, "guest_birthday_marketing_enabled", False)
            if tenant_for_bday
            else False
        )
        if "guest_birthday_marketing_consent" in upd:
            reservation.guest_birthday_marketing_consent = (
                bool(body.guest_birthday_marketing_consent)
                if marketing_on and nm is not None
                else False
            )
        elif not marketing_on or nm is None:
            reservation.guest_birthday_marketing_consent = False
    ah_ok, ad_ok = _normalize_allergies_for_booking(
        reservation.allergies_has, reservation.allergies_detail
    )
    reservation.allergies_has = ah_ok
    reservation.allergies_detail = ad_ok
    # Drop zone if it no longer matches seating (e.g. staff changed indoor/terrace without sending preferred_floor_id).
    if reservation.preferred_floor_id is not None:
        fl_pf = session.get(models.Floor, reservation.preferred_floor_id)
        if not fl_pf or fl_pf.tenant_id != current_user.tenant_id:
            reservation.preferred_floor_id = None
        elif not _floor_matches_seating_preference(fl_pf, reservation.seating_preference):
            reservation.preferred_floor_id = None
    tenant = session.get(models.Tenant, reservation.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    tz = ZoneInfo(tenant.timezone) if tenant.timezone else timezone.utc
    now_local = datetime.now(tz)
    max_ahead_date = now_local.date() + timedelta(days=366)
    if reservation.reservation_date and reservation.reservation_date > max_ahead_date:
        raise HTTPException(status_code=400, detail=api_error_payload("reservation_date_too_far", lang))
    _raise_if_reservation_time_invalid_for_opening_hours(
        session,
        tenant,
        reservation.reservation_date,
        reservation.reservation_time,
        reservation.service_type,
    )
    cap_floor = reservation.preferred_floor_id
    total_seats, total_tables = _reservable_capacity_for_tenant(
        session,
        current_user.tenant_id,
        reservation.reservation_date,
        tenant,
        reservation.reservation_time,
        floor_id=cap_floor,
    )
    reserved_guests, reserved_parties = _demand_for_slot(
        session,
        current_user.tenant_id,
        reservation.reservation_date,
        reservation.reservation_time,
        exclude_reservation_id=reservation_id,
        floor_id=cap_floor,
    )
    if reserved_guests + reservation.party_size > total_seats or reserved_parties + 1 > total_tables:
        raise HTTPException(
            status_code=400,
            detail=f"Slot is over capacity: {reserved_guests + reservation.party_size} guests / {reserved_parties + 1} parties for this time (max {total_seats} seats, {total_tables} tables).",
        )
    reservation.updated_at = datetime.now(timezone.utc)
    session.add(reservation)
    session.commit()
    session.refresh(reservation)
    out = _reservation_to_dict(reservation, session, include_client_tech=True)
    publish_reservation_update(current_user.tenant_id, {"type": "reservation_updated", "reservation": out})
    return out


@app.put("/reservations/{reservation_id}/status")
def update_reservation_status(
    reservation_id: int,
    body: models.ReservationStatusUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    """Update reservation status (e.g. cancel, seat, finish). Staff only."""
    reservation = session.exec(
        select(models.Reservation).where(
            models.Reservation.id == reservation_id,
            models.Reservation.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    if body.status == models.ReservationStatus.cancelled:
        reservation.status = models.ReservationStatus.cancelled
        reservation.table_id = None
        reservation.seated_at = None
    elif body.status == models.ReservationStatus.no_show:
        reservation.status = models.ReservationStatus.no_show
        reservation.table_id = None
        reservation.seated_at = None
    elif body.status == models.ReservationStatus.finished:
        _mark_reservation_finished(reservation)
    else:
        reservation.status = body.status
    reservation.updated_at = datetime.now(timezone.utc)
    session.add(reservation)
    session.commit()
    session.refresh(reservation)
    out = _reservation_to_dict(reservation, session, include_client_tech=True)
    publish_reservation_update(current_user.tenant_id, {"type": "reservation_status", "reservation": out})
    return out


@app.put("/reservations/{reservation_id}/seat")
def seat_reservation(
    reservation_id: int,
    body: models.ReservationSeat,
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_WRITE))],
    session: Session = Depends(get_session),
    lang: str = Depends(_get_requested_language),
) -> dict:
    """Assign table to reservation (seat the party). Staff only."""
    reservation = session.exec(
        select(models.Reservation).where(
            models.Reservation.id == reservation_id,
            models.Reservation.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    if reservation.status != models.ReservationStatus.booked:
        raise HTTPException(status_code=400, detail="Reservation must be booked to seat")
    table = session.exec(
        select(models.Table).where(
            models.Table.id == body.table_id,
            models.Table.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    group_total = _group_total_seats(session, current_user.tenant_id, table)
    if group_total < reservation.party_size:
        raise HTTPException(status_code=400, detail="Table capacity is less than party size")
    if table.floor_id is not None:
        fl = session.get(models.Floor, table.floor_id)
        if fl and fl.tenant_id == current_user.tenant_id:
            _validate_floor_seating_pair_or_raise(fl, getattr(reservation, "seating_preference", None), lang)
    member_ids = _group_member_table_ids(session, current_user.tenant_id, table)
    if any((mt := session.get(models.Table, mid)) and mt.is_active for mid in member_ids):
        raise HTTPException(
            status_code=400,
            detail="Table has an active ordering session; close the table or finish orders before seating a reservation here.",
        )
    # Check no member table already occupied or reserved by another
    for mid in member_ids:
        active_order = session.exec(
            select(models.Order).where(
                models.Order.table_id == mid,
                models.Order.status.in_(
                    [
                        models.OrderStatus.pending,
                        models.OrderStatus.preparing,
                        models.OrderStatus.ready,
                        models.OrderStatus.partially_delivered,
                    ]
                ),
            )
        ).first()
        if active_order:
            raise HTTPException(status_code=400, detail="Table is already occupied")
        other_reserved = session.exec(
            select(models.Reservation).where(
                models.Reservation.table_id == mid,
                models.Reservation.status == models.ReservationStatus.booked,
                models.Reservation.id != reservation_id,
            )
        ).first()
        if other_reserved:
            raise HTTPException(status_code=400, detail="Table is already reserved")
    reservation.table_id = body.table_id
    reservation.status = models.ReservationStatus.seated
    reservation.seated_at = datetime.now(timezone.utc)
    reservation.updated_at = reservation.seated_at
    session.add(reservation)
    session.commit()
    session.refresh(reservation)
    out = _reservation_to_dict(reservation, session, include_client_tech=True)
    publish_reservation_update(current_user.tenant_id, {"type": "reservation_seated", "reservation": out})
    return out


def _mark_reservation_finished(reservation: models.Reservation) -> None:
    """Set reservation to finished and clear table assignment. Caller commits and publishes."""
    reservation.status = models.ReservationStatus.finished
    reservation.table_id = None
    reservation.seated_at = None
    reservation.updated_at = datetime.now(timezone.utc)


@app.put("/reservations/{reservation_id}/finish")
def finish_reservation(
    reservation_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    """Clear table assignment and mark reservation finished. Staff only."""
    reservation = session.exec(
        select(models.Reservation).where(
            models.Reservation.id == reservation_id,
            models.Reservation.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    _mark_reservation_finished(reservation)
    session.add(reservation)
    session.commit()
    session.refresh(reservation)
    out = _reservation_to_dict(reservation, session, include_client_tech=True)
    publish_reservation_update(current_user.tenant_id, {"type": "reservation_finished", "reservation": out})
    return out


@app.put("/reservations/{reservation_id}/cancel")
def cancel_reservation_public(
    reservation_id: int,
    token: str = Query(..., description="Reservation token"),
    session: Session = Depends(get_session),
) -> dict:
    """Public: cancel reservation with token."""
    reservation = session.exec(
        select(models.Reservation).where(
            models.Reservation.id == reservation_id,
            models.Reservation.token == token,
        )
    ).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    if reservation.status == models.ReservationStatus.cancelled:
        return _reservation_to_dict(reservation, session)
    reservation.status = models.ReservationStatus.cancelled
    reservation.table_id = None
    reservation.seated_at = None
    reservation.updated_at = datetime.now(timezone.utc)
    session.add(reservation)
    session.commit()
    session.refresh(reservation)
    out = _reservation_to_dict(reservation, session)
    publish_reservation_update(reservation.tenant_id, {"type": "reservation_cancelled", "reservation": out})
    return out


@app.put("/reservations/{reservation_id}/public")
def update_reservation_public(
    request: Request,
    reservation_id: int,
    token: str = Query(..., description="Reservation token from booking confirmation"),
    body: models.PublicReservationUpdate | None = Body(None),
    session: Session = Depends(get_session),
) -> dict:
    """Public: update reservation by token (delay notice, reservation notes, customer notes). Only when status is booked."""
    reservation = session.exec(
        select(models.Reservation).where(
            models.Reservation.id == reservation_id,
            models.Reservation.token == token,
        )
    ).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    if reservation.status != models.ReservationStatus.booked:
        raise HTTPException(status_code=400, detail="Can only update a booked reservation")
    if body:
        if body.delay_notice is not None:
            _dn = body.delay_notice.strip() if isinstance(body.delay_notice, str) else ""
            if _dn:
                _enforce_reservation_delay_notice_rate_limit(request, reservation_id)
            reservation.delay_notice = _dn if _dn else None
        if body.client_notes is not None:
            reservation.client_notes = body.client_notes.strip() if isinstance(body.client_notes, str) and body.client_notes.strip() else None
        if body.customer_notes is not None:
            reservation.customer_notes = body.customer_notes.strip() if isinstance(body.customer_notes, str) and body.customer_notes.strip() else None
    reservation.updated_at = datetime.now(timezone.utc)
    session.add(reservation)
    session.commit()
    session.refresh(reservation)
    out = _reservation_to_dict(reservation, session)
    publish_reservation_update(reservation.tenant_id, {"type": "reservation_updated", "reservation": out})
    return out


@app.post("/reservations/{reservation_id}/send-reminder")
async def send_reservation_reminder(
    reservation_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.RESERVATION_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    """Send a reminder for an upcoming reservation via email and/or WhatsApp. Staff only.
    Requires at least one of customer_email or customer_phone (when WhatsApp is configured)."""
    reservation = session.exec(
        select(models.Reservation).where(
            models.Reservation.id == reservation_id,
            models.Reservation.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    if reservation.status != models.ReservationStatus.booked:
        raise HTTPException(status_code=400, detail="Can only send reminders for booked reservations")

    has_email = bool(reservation.customer_email and reservation.customer_email.strip())
    has_phone = bool(reservation.customer_phone and reservation.customer_phone.strip())
    whatsapp_ok = whatsapp_svc.is_whatsapp_configured()

    if not has_email and not (has_phone and whatsapp_ok):
        raise HTTPException(
            status_code=400,
            detail="Reservation has no email address and no phone for WhatsApp reminder (or WhatsApp is not configured)",
        )

    tenant = session.get(models.Tenant, reservation.tenant_id)
    tenant_name = tenant.name if tenant else "Restaurant"
    date_str = reservation.reservation_date.isoformat() if reservation.reservation_date else ""
    time_str = reservation.reservation_time.strftime("%H:%M") if reservation.reservation_time else ""
    default_country = settings.default_phone_country or "CO"
    if tenant and tenant.timezone:
        # Optional: derive country from timezone (e.g. Europe/Madrid -> ES); for now use global default
        pass

    email_sent = False
    whatsapp_sent = False
    to_email = reservation.customer_email.strip() if has_email else None
    to_phone = None

    if has_email:
        view_url = None
        if reservation.token and settings.public_app_base_url:
            base = settings.public_app_base_url.rstrip("/")
            view_url = f"{base}/reservation?token={reservation.token}"
        ok = await email_svc.send_reservation_reminder(
            to_email=reservation.customer_email.strip(),
            customer_name=reservation.customer_name,
            reservation_date=date_str,
            reservation_time=time_str,
            party_size=reservation.party_size,
            tenant_name=tenant_name,
            view_url=view_url,
            tenant=tenant,
            reservation=reservation,
        )
        email_sent = ok

    if has_phone and whatsapp_ok:
        ok_wa = await whatsapp_svc.send_reservation_reminder_whatsapp_async(
            to_phone=reservation.customer_phone.strip(),
            customer_name=reservation.customer_name,
            reservation_date=date_str,
            reservation_time=time_str,
            party_size=reservation.party_size,
            tenant_name=tenant_name,
            default_country=default_country,
        )
        whatsapp_sent = ok_wa
        if ok_wa:
            normalized = normalize_phone_to_e164(reservation.customer_phone.strip(), default_country)
            to_phone = normalized

    attempted_email = has_email
    attempted_wa = bool(has_phone and whatsapp_ok)
    delivered = email_sent or whatsapp_sent
    if (attempted_email or attempted_wa) and not delivered:
        raise HTTPException(
            status_code=503,
            detail=email_svc.reminder_send_failure_message(
                attempted_email,
                email_sent,
                attempted_wa,
                whatsapp_sent,
                tenant,
            ),
        )

    # Mark both reminder slots as sent so the autonomous heartbeat won't send again
    now_utc = datetime.now(timezone.utc)
    reservation.reminder_24h_sent_at = now_utc
    reservation.reminder_2h_sent_at = now_utc
    session.add(reservation)
    session.commit()

    return {
        "email_sent": email_sent,
        "whatsapp_sent": whatsapp_sent,
        "to_email": to_email,
        "to_phone": to_phone,
    }


# ============ TABLE SESSION MANAGEMENT ============


def _auto_assign_waiter_to_table(
    session: Session,
    table: "models.Table",
    tenant_id: int,
    activator: "models.User | None",
) -> None:
    """Assign a waiter to a just-activated table if it doesn't already have one.

    If a waiter is the one activating it, they become the default. Otherwise
    (e.g. staff/admin activation, or a customer self-activating via QR) a
    waiter is picked at random from the tenant's waiters, so tables never sit
    without an owner during peak hours."""
    if table.assigned_waiter_id is not None:
        return
    if activator is not None and activator.role == models.UserRole.waiter:
        table.assigned_waiter_id = activator.id
        return
    tenant_waiters = session.exec(
        select(models.User).where(
            models.User.tenant_id == tenant_id,
            models.User.role == models.UserRole.waiter,
        )
    ).all()
    if tenant_waiters:
        table.assigned_waiter_id = secrets.choice(tenant_waiters).id


@app.post("/tables/{table_id}/activate")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def activate_table(
    request: Request,
    table_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.TABLE_ACTIVATE))],
    session: Session = Depends(get_session),
) -> dict:
    """
    Activate a table for ordering.
    No order is created until the first item is added via the menu.
    """
    table = session.exec(
        select(models.Table).where(
            models.Table.id == table_id,
            models.Table.tenant_id == current_user.tenant_id,
        )
    ).first()

    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    # Activate table only; order is created when customer adds first items via POST /menu/.../order
    table.is_active = True
    table.active_order_id = None
    table.activated_at = datetime.now(timezone.utc)
    table.order_code = _new_order_code() if _table_requires_order_code(table) else None

    _auto_assign_waiter_to_table(session, table, current_user.tenant_id, activator=current_user)

    session.add(table)
    session.commit()
    session.refresh(table)

    publish_order_update(
        tenant_id=current_user.tenant_id,
        order_data={"type": "table_activated", "table_id": table.id},
        table_id=table.id,
    )

    waiter_name = None
    if table.assigned_waiter_id:
        w = session.get(models.User, table.assigned_waiter_id)
        waiter_name = w.full_name or w.username if w else None

    return JSONResponse(content={
        "id": table.id,
        "name": table.name,
        "is_active": True,
        "active_order_id": None,
        "activated_at": table.activated_at.isoformat() if table.activated_at else None,
        "assigned_waiter_id": table.assigned_waiter_id,
        "assigned_waiter_name": waiter_name,
    })


def _close_table_session(
    session: Session, table: models.Table, tenant_id: int, *, delete_empty_order: bool = True
) -> None:
    """End the guest session on a table: deactivate, finish seated reservations,
    drop the shared cart and tell open /menu pages (WebSocket ``table_closed``)."""
    # If there is an active order with no (active) items, delete it so we don't keep empty orders
    if delete_empty_order and table.active_order_id:
        order = session.get(models.Order, table.active_order_id)
        if order:
            all_items = session.exec(
                select(models.OrderItem).where(models.OrderItem.order_id == order.id)
            ).all()
            active_count = sum(
                1 for it in all_items
                if not it.removed_by_customer and it.removed_by_user_id is None and it.status != models.OrderItemStatus.cancelled
            )
            if active_count == 0:
                for it in all_items:
                    session.delete(it)
                session.delete(order)

    # Clear session data, including the waiter auto-assigned on activation so the
    # next activation starts fresh (picks/assigns a waiter again from scratch)
    table.is_active = False
    table.active_order_id = None
    table.assigned_waiter_id = None
    table.order_code = None

    seated_at_table = session.exec(
        select(models.Reservation).where(
            models.Reservation.tenant_id == tenant_id,
            models.Reservation.table_id == table.id,
            models.Reservation.status == models.ReservationStatus.seated,
        )
    ).all()
    finished_reservation_ids: list[int] = []
    for res in seated_at_table:
        _mark_reservation_finished(res)
        session.add(res)
        if res.id is not None:
            finished_reservation_ids.append(res.id)

    session.commit()
    session.refresh(table)

    for rid in finished_reservation_ids:
        r = session.get(models.Reservation, rid)
        if r:
            out = _reservation_to_dict(r, session, include_client_tech=True)
            publish_reservation_update(
                tenant_id, {"type": "reservation_finished", "reservation": out}
            )

    # Drop ephemeral shared draft cart for this table
    table_cart_svc.clear_cart(get_redis(), table.id)

    # Notify connected customers via WebSocket that the table has been closed
    publish_order_update(
        tenant_id=tenant_id,
        order_data={"type": "table_closed", "table_id": table.id},
        table_id=table.id,
    )


def _close_table_after_full_payment(session: Session, order: models.Order, tenant_id: int) -> None:
    """Staff settled the bill: close the table so the next guests start with an empty order.
    Take-away / home-ordering tables stay open (they are shared by many orders)."""
    if not order.paid_at or order.table_id is None:
        return
    table = session.get(models.Table, order.table_id)
    if not table or not table.is_active or _is_take_away_table(table):
        return
    if table.active_order_id not in (None, order.id):
        return
    _close_table_session(session, table, tenant_id, delete_empty_order=False)


@app.post("/tables/{table_id}/close")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def close_table(
    request: Request,
    table_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.TABLE_ACTIVATE))],
    session: Session = Depends(get_session),
) -> dict:
    """
    Close a table session.
    Deactivates the table. Deletes the active order if it has no items.
    Finishes any seated reservation on this table so floor status matches staff closing the session.
    """
    table = session.exec(
        select(models.Table).where(
            models.Table.id == table_id,
            models.Table.tenant_id == current_user.tenant_id,
        )
    ).first()

    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    _close_table_session(session, table, current_user.tenant_id)

    return JSONResponse(content={
        "id": table.id,
        "name": table.name,
        "is_active": False,
        "message": "Table closed successfully",
    })


@app.put("/tables/{table_id}/assign-waiter")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_admin_per_minute', 30)}/minute",
    key_func=_rate_limit_key_user,
)
def assign_waiter_to_table(
    request: Request,
    table_id: int,
    body: dict,
    current_user: Annotated[models.User, Depends(require_permission(Permission.TABLE_WRITE))],
    session: Session = Depends(get_session),
) -> dict:
    """Assign a waiter to a specific table. Send waiter_id=null to unassign."""
    table = session.exec(
        select(models.Table).where(
            models.Table.id == table_id,
            models.Table.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    waiter_id = body.get("waiter_id")
    if waiter_id is not None:
        waiter = session.exec(
            select(models.User).where(
                models.User.id == waiter_id,
                models.User.tenant_id == current_user.tenant_id,
                models.User.role == models.UserRole.waiter,
            )
        ).first()
        if not waiter:
            raise HTTPException(status_code=400, detail="Waiter not found or not a waiter role")
        table.assigned_waiter_id = waiter.id
    else:
        table.assigned_waiter_id = None

    session.add(table)
    session.commit()
    session.refresh(table)

    # Resolve waiter name for response
    waiter_name = None
    if table.assigned_waiter_id:
        w = session.get(models.User, table.assigned_waiter_id)
        waiter_name = w.full_name or w.username if w else None

    return JSONResponse(content={
        "table_id": table.id,
        "assigned_waiter_id": table.assigned_waiter_id,
        "assigned_waiter_name": waiter_name,
    })


# ============ INTERNAL VALIDATION (for ws-bridge) ============

@app.get("/internal/validate-table/{table_token}")
@public_menu_ip_limit()
def validate_table_token(
    request: Request,
    response: Response,
    table_token: str,
    session: Session = Depends(get_session),
) -> dict:
    """Internal endpoint for ws-bridge to validate table tokens."""
    table = session.exec(select(models.Table).where(models.Table.token == table_token)).first()
    
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    
    return {
        "table_id": table.id,
        "tenant_id": table.tenant_id,
        "valid": True
    }


# ============ PUBLIC MENU ============


@app.get("/menu/{table_token}")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_public_menu_per_minute', 30)}/minute"
)
def get_menu(
    request: Request,
    table_token: str,
    lang: str = Depends(_get_requested_language),
    session: Session = Depends(get_session),
    current_user: Annotated[models.User | None, Depends(security.get_current_user_optional)] = None,
) -> dict:
    """Public endpoint - get menu for a table by its token."""
    # Use raw SQL to avoid SQLAlchemy model issues
    from sqlalchemy import text

    try:
        result = session.execute(
            text("""
            SELECT id, tenant_id, name, token, is_active, active_order_id
            FROM "table"
            WHERE token = :token
        """),
            {"token": table_token},
        )
        table_row = result.fetchone()
        logger.debug("get_menu table query token=%s row=%s", table_token[:8] + "...", table_row)
    except Exception as e:
        logger.exception("get_menu table query failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail=api_error_payload("database_error", lang),
        )

    if not table_row:
        logger.debug("get_menu: no table for token prefix=%s", table_token[:8] + "...")
        raise HTTPException(status_code=404, detail=api_error_payload("table_not_found", lang))

    # Create a simple object with the needed attributes
    class TableData:
        def __init__(self, id, tenant_id, name, token, is_active, active_order_id):
            self.id = id
            self.tenant_id = tenant_id
            self.name = name
            self.token = token
            self.is_active = is_active or False
            self.active_order_id = active_order_id

    table = TableData(
        table_row[0],
        table_row[1],
        table_row[2],
        table_row[3],
        table_row[4],
        table_row[5],
    )

    if not table.is_active:
        # Customer scanned the table's QR: self-activate the table so they can
        # order right away without waiting for staff, and auto-assign a waiter.
        real_table = session.exec(
            select(models.Table).where(models.Table.token == table_token)
        ).first()
        if not real_table:
            raise HTTPException(status_code=404, detail=api_error_payload("table_not_found", lang))

        real_table.is_active = True
        real_table.active_order_id = None
        real_table.activated_at = datetime.now(timezone.utc)
        real_table.order_code = _new_order_code() if _table_requires_order_code(real_table) else None
        _auto_assign_waiter_to_table(session, real_table, real_table.tenant_id, activator=None)
        session.add(real_table)
        session.commit()
        session.refresh(real_table)

        publish_order_update(
            tenant_id=real_table.tenant_id,
            order_data={"type": "table_activated", "table_id": real_table.id},
            table_id=real_table.id,
        )

        table.is_active = True
        table.active_order_id = real_table.active_order_id

    # Get products from TenantProduct (new catalog system) and Product (legacy)
    tenant_products = session.exec(
        select(models.TenantProduct).where(
            models.TenantProduct.tenant_id == table.tenant_id,
            models.TenantProduct.is_active == True,
        )
    ).all()

    legacy_products = session.exec(
        select(models.Product).where(models.Product.tenant_id == table.tenant_id)
    ).all()

    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == table.tenant_id)
    ).first()

    # Customer-facing: only show products available today (within available_from..available_until)
    try:
        tz = ZoneInfo(tenant.timezone) if tenant and tenant.timezone else timezone.utc
    except Exception:
        tz = timezone.utc
    today = datetime.now(tz).date()
    def _is_available(available_from, available_until):
        if available_from is not None and available_from > today:
            return False
        if available_until is not None and available_until < today:
            return False
        return True
    tenant_products = [tp for tp in tenant_products if _is_available(tp.available_from, tp.available_until)]
    legacy_products = [p for p in legacy_products if _is_available(p.available_from, p.available_until)]

    linked_legacy_product_ids = {
        tp.product_id for tp in tenant_products if tp.product_id is not None
    }

    # Combine products from both sources
    products_list = []

    # Add TenantProducts (from catalog)
    for tp in tenant_products:
        # Get image from provider product if available, otherwise use tenant product image
        image_filename = tp.image_filename
        provider_product = None
        catalog_item = None

        # Get catalog item for description
        catalog_item = session.exec(
            select(models.ProductCatalog).where(
                models.ProductCatalog.id == tp.catalog_id
            )
        ).first()

        # Get provider product for detailed wine info
        if tp.provider_product_id:
            provider_product = session.exec(
                select(models.ProviderProduct).where(
                    models.ProviderProduct.id == tp.provider_product_id
                )
            ).first()
            if provider_product and provider_product.image_filename:
                provider = session.exec(
                    select(models.Provider).where(
                        models.Provider.id == provider_product.provider_id
                    )
                ).first()
                if provider:
                    stored = provider_product_stored_image_path(
                        provider.token, provider_product.image_filename
                    )
                    if stored:
                        image_filename = stored

        # Build product data with detailed wine information
        product_data = {
            "id": tp.id,
            "name": tp.name or "",
            "price_cents": tp.price_cents,
            "image_filename": image_filename,
            "tenant_id": tp.tenant_id,
            "ingredients": tp.ingredients,
            "_source": "tenant_product",  # Indicate this is from TenantProduct table
        }

        # Get the actual product record to check for customized description / stock alert
        if tp.product_id:
            custom_product = session.get(models.Product, tp.product_id)
            if custom_product:
                if custom_product.description:
                    product_data["description"] = custom_product.description
                from .product_stock import product_stock_alert_payload

                product_data.update(product_stock_alert_payload(custom_product))

        # Add catalog category, subcategory and description
        # Use codes for internationalization
        if catalog_item:
            if catalog_item.category:
                from .category_codes import get_category_code

                product_data["category"] = catalog_item.category
                product_data["category_code"] = get_category_code(catalog_item.category)
            if catalog_item.subcategory:
                product_data["subcategory"] = catalog_item.subcategory
            if catalog_item.description and not product_data.get("description"):
                product_data["description"] = catalog_item.description

        # Extract wine type - use API category ID first, but check description for conflicts
        wine_type = None
        description_wine_type = None

        # Get description text first to check for conflicts
        description_text = ""
        if provider_product and provider_product.detailed_description:
            description_text = provider_product.detailed_description.lower()
        elif catalog_item and catalog_item.description:
            description_text = catalog_item.description.lower()

        # Extract wine type from description
        if description_text:
            if "vino blanco" in description_text:
                description_wine_type = "White Wine"
            elif "vino tinto" in description_text:
                description_wine_type = "Red Wine"
            elif "espumoso" in description_text or "cava" in description_text:
                description_wine_type = "Sparkling Wine"
            elif "rosado" in description_text or "rosé" in description_text:
                description_wine_type = "Rosé Wine"

        # First, use the category ID from provider product (direct from API)
        category_wine_type = None
        if provider_product and provider_product.wine_category_id:
            from app.seeds.wine_import import get_category_name

            category_wine_type = get_category_name(
                provider_product.wine_category_id, None
            )
            # If we got a valid wine type, use it
            if category_wine_type and category_wine_type == "Wine":
                category_wine_type = None

        # If description explicitly contradicts category, trust description (more reliable)
        if description_wine_type and category_wine_type:
            if description_wine_type != category_wine_type:
                # Description contradicts category - trust description
                wine_type = description_wine_type
            else:
                # They match - use category (from API)
                wine_type = category_wine_type
        elif description_wine_type:
            # Only description available
            wine_type = description_wine_type
        elif category_wine_type:
            # Only category available
            wine_type = category_wine_type

        # If still no wine type, try subcategory as last resort
        if not wine_type and catalog_item and catalog_item.subcategory:
            # Subcategory format: "Red Wine - D.O. Empordà - Wine by Glass"
            # Extract first part before first " - "
            subcategory_parts = catalog_item.subcategory.split(" - ")
            first_part = subcategory_parts[0].strip()
            # Check if it's a known wine type
            wine_types = [
                "Red Wine",
                "White Wine",
                "Sparkling Wine",
                "Rosé Wine",
                "Sweet Wine",
                "Fortified Wine",
            ]
            if first_part in wine_types:
                wine_type = first_part
            # Also check for Spanish terms
            elif "Red" in first_part or "Tinto" in first_part or "Tintos" in first_part:
                wine_type = "Red Wine"
            elif (
                "White" in first_part
                or "Blanco" in first_part
                or "Blancos" in first_part
            ):
                wine_type = "White Wine"
            elif (
                "Sparkling" in first_part
                or "Espumoso" in first_part
                or "Cava" in first_part
            ):
                wine_type = "Sparkling Wine"
            elif "Rosé" in first_part or "Rosado" in first_part:
                wine_type = "Rosé Wine"

        # Now build subcategory_codes AFTER wine_type is determined
        # This ensures wine_type takes precedence over subcategory string
        subcategory_codes = []

        # First, extract all non-wine-type codes from subcategory (e.g., WINE_BY_GLASS)
        if catalog_item and catalog_item.subcategory:
            from .category_codes import (
                get_all_subcategory_codes,
                extract_wine_type_code,
            )

            all_codes = get_all_subcategory_codes(catalog_item.subcategory)
            # Remove wine type codes - we'll add the correct one based on wine_type
            wine_type_codes = [
                "WINE_RED",
                "WINE_WHITE",
                "WINE_SPARKLING",
                "WINE_ROSE",
                "WINE_SWEET",
                "WINE_FORTIFIED",
            ]
            for code in all_codes:
                if code not in wine_type_codes:
                    subcategory_codes.append(code)

        # Add the correct wine type code based on determined wine_type
        if wine_type:
            product_data["wine_type"] = wine_type
            from .category_codes import extract_wine_type_code

            wine_type_code = extract_wine_type_code(wine_type)
            if wine_type_code and wine_type_code not in subcategory_codes:
                subcategory_codes.append(wine_type_code)

        # Set subcategory_codes if we have any
        if subcategory_codes:
            product_data["subcategory_codes"] = subcategory_codes

        # Add detailed wine information from provider product
        if provider_product:
            if provider_product.detailed_description:
                product_data["detailed_description"] = (
                    provider_product.detailed_description
                )
            if provider_product.country:
                product_data["country"] = provider_product.country
            if provider_product.region:
                product_data["region"] = provider_product.region
            if provider_product.wine_style:
                product_data["wine_style"] = provider_product.wine_style
            if provider_product.vintage:
                product_data["vintage"] = provider_product.vintage
            if provider_product.winery:
                product_data["winery"] = provider_product.winery
            if provider_product.grape_variety:
                product_data["grape_variety"] = provider_product.grape_variety
            if provider_product.aromas:
                product_data["aromas"] = provider_product.aromas
            if provider_product.elaboration:
                product_data["elaboration"] = provider_product.elaboration

        products_list.append(product_data)

    # Add legacy Products (skip rows already represented via TenantProduct.product_id)
    for lp in legacy_products:
        if lp.id in linked_legacy_product_ids:
            continue
        from .product_stock import product_stock_alert_payload

        product_data = {
            "id": lp.id,
            "name": lp.name,
            "price_cents": lp.price_cents,
            "description": lp.description,
            "image_filename": lp.image_filename,
            "tenant_id": lp.tenant_id,
            "ingredients": lp.ingredients,
            "category": lp.category,
            "subcategory": lp.subcategory,
            "_source": "product",
            **product_stock_alert_payload(lp),
        }

        # Add category and subcategory if they exist
        if lp.category:
            product_data["category"] = lp.category
            from .category_codes import get_category_code

            product_data["category_code"] = get_category_code(lp.category)

        if lp.subcategory:
            product_data["subcategory"] = lp.subcategory
            from .category_codes import get_all_subcategory_codes

            subcategory_codes = get_all_subcategory_codes(lp.subcategory)
            if subcategory_codes:
                product_data["subcategory_codes"] = subcategory_codes

        products_list.append(product_data)

    # Live promo prices for QR menu (#322)
    eligible_promos = promo_svc.eligible_promos(
        session,
        tenant_id=table.tenant_id,
        channel=models.OrderChannel.table.value,
    )
    for product_data in products_list:
        promo_svc.decorate_menu_product(
            session,
            tenant_id=table.tenant_id,
            product=product_data,
            channel=models.OrderChannel.table.value,
            eligible=eligible_promos,
        )

    # Build tenant response data
    tenant_data = {
        "table_name": table.name,
        "table_id": table.id,
        "requires_order_code": _table_requires_order_code(table)
        and not _is_staff_for_tenant(current_user, table.tenant_id),
        "is_staff": _is_staff_for_tenant(current_user, table.tenant_id),
        "tenant_id": table.tenant_id,  # For WebSocket connection
        "tenant_name": tenant.name if tenant else "Unknown",
        "tenant_logo": tenant.logo_filename if tenant else None,
        "tenant_header_background_filename": tenant.header_background_filename if tenant else None,
        "tenant_description": tenant.description if tenant else None,
        "tenant_phone": tenant.phone if tenant else None,
        "tenant_whatsapp": tenant.whatsapp if tenant else None,
        "tenant_address": tenant.address if tenant else None,
        "tenant_website": tenant.website if tenant else None,
        "tenant_currency_code": "COP",
        "tenant_currency": "$",
        "tenant_payment_nequi_number": tenant.payment_nequi_number if tenant else None,
        "tenant_payment_llave": tenant.payment_llave if tenant else None,
        "tenant_payment_account_holder": tenant.payment_account_holder if tenant else None,
        "tenant_payment_qr_filename": tenant.payment_qr_filename if tenant else None,
        "tenant_payment_bank_accounts": _parse_bank_accounts(tenant),
        "tenant_immediate_payment_required": tenant.immediate_payment_required
        if tenant
        else False,
        "tenant_public_background_color": tenant.public_background_color if tenant else None,
        "tenant_public_primary_color": getattr(tenant, "public_primary_color", None) if tenant else None,
        "tenant_location_check_enabled": bool(
            tenant and tenant.location_check_enabled and tenant.latitude and tenant.longitude
        ),
        "table_is_active": table.is_active,
        "active_order_id": table.active_order_id,
        # Shared draft cart: dine-in activated tables only (not take-away). Needs Redis.
        "table_shared_cart": bool(table.is_active and not _is_take_away_table(table)),
        "products": products_list,
    }

    return JSONResponse(content=tenant_data)


# ============ PUBLIC: SHARED TABLE DRAFT CART (#349) ============


class TableCartItemCreate(_BaseModel):
    session_id: str = Field(min_length=8, max_length=128)
    customer_name: str | None = Field(default=None, max_length=120)
    product_id: int
    quantity: int = Field(default=1, ge=1, le=99)
    notes: str | None = Field(default=None, max_length=500)
    source: str | None = None


class TableCartItemUpdate(_BaseModel):
    session_id: str = Field(min_length=8, max_length=128)
    quantity: int | None = Field(default=None, ge=0, le=99)
    notes: str | None = Field(default=None, max_length=500)


def _table_allows_shared_cart(table: models.Table) -> bool:
    return bool(table.is_active and not _is_take_away_table(table))


def _resolve_menu_cart_product(
    session: Session, tenant_id: int, product_id: int, source: str | None
) -> tuple[str, int]:
    """Return (product_name, price_cents) for a menu cart line. Raises HTTPException if missing."""
    if source == "tenant_product" or source is None:
        tp = session.exec(
            select(models.TenantProduct).where(
                models.TenantProduct.id == product_id,
                models.TenantProduct.tenant_id == tenant_id,
            )
        ).first()
        if tp:
            price = tp.price_cents
            if price is None and tp.product_id:
                linked = session.get(models.Product, tp.product_id)
                price = linked.price_cents if linked else None
            if price is None:
                raise HTTPException(status_code=400, detail=f"Menu item «{tp.name}» has no price.")
            return tp.name, int(price)
        if source == "tenant_product":
            raise HTTPException(status_code=400, detail=f"TenantProduct {product_id} not found")

    product = session.exec(
        select(models.Product).where(
            models.Product.id == product_id,
            models.Product.tenant_id == tenant_id,
        )
    ).first()
    if not product:
        raise HTTPException(status_code=400, detail=f"Product {product_id} not found")
    return product.name, int(product.price_cents)


def _cart_response(shared: bool, cart: dict, *, reason: str | None = None) -> JSONResponse:
    payload: dict[str, Any] = {
        "shared": shared,
        "items": cart.get("items") or [] if shared else [],
        "updated_at": cart.get("updated_at"),
    }
    if reason:
        payload["reason"] = reason
    return JSONResponse(content=payload)


def _publish_cart_updated(table: models.Table) -> None:
    publish_order_update(
        table.tenant_id,
        {"type": "cart_updated", "table_id": table.id},
        table_id=table.id,
    )


@app.get("/menu/{table_token}/cart")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_public_menu_per_minute', 30)}/minute"
)
def get_table_cart(
    request: Request,
    table_token: str,
    session: Session = Depends(get_session),
) -> dict:
    """Shared draft cart for an activated dine-in table (Redis). Local-only when disabled."""
    table = session.exec(select(models.Table).where(models.Table.token == table_token)).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    if not _table_allows_shared_cart(table):
        return _cart_response(False, {}, reason="local_only")
    r = get_redis()
    if r is None:
        return _cart_response(False, {}, reason="redis_unavailable")
    return _cart_response(True, table_cart_svc.load_cart(r, table.id))


@app.post("/menu/{table_token}/cart/items")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_public_menu_per_minute', 30)}/minute"
)
def add_table_cart_item(
    request: Request,
    table_token: str,
    body: TableCartItemCreate,
    session: Session = Depends(get_session),
) -> dict:
    table = session.exec(select(models.Table).where(models.Table.token == table_token)).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    if not _table_allows_shared_cart(table):
        raise HTTPException(status_code=400, detail="Shared cart is not available for this table")
    r = get_redis()
    if r is None:
        raise HTTPException(status_code=503, detail="Shared cart temporarily unavailable")

    name, price = _resolve_menu_cart_product(
        session, table.tenant_id, body.product_id, body.source
    )
    cart = table_cart_svc.add_item(
        r,
        table.id,
        session_id=body.session_id.strip(),
        customer_name=(body.customer_name or "").strip() or None,
        product_id=body.product_id,
        product_name=name,
        price_cents=price,
        quantity=body.quantity,
        notes=body.notes,
        source=body.source,
    )
    _publish_cart_updated(table)
    return _cart_response(True, cart)


@app.put("/menu/{table_token}/cart/items/{line_id}")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_public_menu_per_minute', 30)}/minute"
)
def update_table_cart_item(
    request: Request,
    table_token: str,
    line_id: str,
    body: TableCartItemUpdate,
    session: Session = Depends(get_session),
) -> dict:
    table = session.exec(select(models.Table).where(models.Table.token == table_token)).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    if not _table_allows_shared_cart(table):
        raise HTTPException(status_code=400, detail="Shared cart is not available for this table")
    r = get_redis()
    if r is None:
        raise HTTPException(status_code=503, detail="Shared cart temporarily unavailable")

    cart = table_cart_svc.update_item(
        r,
        table.id,
        line_id,
        session_id=body.session_id.strip(),
        quantity=body.quantity,
        notes=body.notes,
    )
    if cart is None:
        raise HTTPException(status_code=404, detail="Cart line not found or not owned by this session")
    _publish_cart_updated(table)
    return _cart_response(True, cart)


@app.delete("/menu/{table_token}/cart/items/{line_id}")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_public_menu_per_minute', 30)}/minute"
)
def delete_table_cart_item(
    request: Request,
    table_token: str,
    line_id: str,
    session_id: str = Query(..., min_length=8, max_length=128),
    session: Session = Depends(get_session),
) -> dict:
    table = session.exec(select(models.Table).where(models.Table.token == table_token)).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    if not _table_allows_shared_cart(table):
        raise HTTPException(status_code=400, detail="Shared cart is not available for this table")
    r = get_redis()
    if r is None:
        raise HTTPException(status_code=503, detail="Shared cart temporarily unavailable")

    cart = table_cart_svc.remove_item(
        r, table.id, line_id, session_id=session_id.strip()
    )
    if cart is None:
        raise HTTPException(status_code=404, detail="Cart line not found or not owned by this session")
    _publish_cart_updated(table)
    return _cart_response(True, cart)


@app.get("/menu/{table_token}/order")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_public_menu_per_minute', 30)}/minute"
)
def get_current_order(
    request: Request,
    table_token: str,
    session_id: str | None = Query(None, description="Session identifier for order isolation"),
    session: Session = Depends(get_session),
) -> dict:
    """Public endpoint - get current active order for a table (if any)."""
    table = session.exec(
        select(models.Table).where(models.Table.token == table_token)
    ).first()

    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    active_order = None

    # Prefer the table's shared active order (created when staff activates the table).
    # This is the canonical order for the table's shared-order model.
    if table.active_order_id:
        shared_order = session.get(models.Order, table.active_order_id)
        if (
            shared_order
            and shared_order.status
            not in (models.OrderStatus.paid, models.OrderStatus.cancelled)
            and "[PAID:" not in (shared_order.notes or "")
        ):
            active_order = shared_order

    # Fallback: search by session_id or any open order (not paid/cancelled; backward
    # compatibility for tables activated before the shared-order model was introduced).
    if not active_order:
        _not_closed = ~models.Order.status.in_(
            [models.OrderStatus.paid, models.OrderStatus.cancelled]
        )
        if session_id:
            potential_orders = session.exec(
                select(models.Order).where(
                    models.Order.table_id == table.id,
                    models.Order.session_id == session_id,
                    models.Order.deleted_at.is_(None),
                    _not_closed,
                ).order_by(models.Order.created_at.desc())
            ).all()
        else:
            potential_orders = session.exec(
                select(models.Order).where(
                    models.Order.table_id == table.id,
                    models.Order.deleted_at.is_(None),
                    _not_closed,
                ).order_by(models.Order.created_at.desc())
            ).all()

        for order in potential_orders:
            if "[PAID:" not in (order.notes or ""):
                active_order = order
                break

    # Table shared order: when no order matched session_id, use table's active order so customer sees current order
    if not active_order and table.active_order_id:
        active_order = session.get(models.Order, table.active_order_id)
        if active_order and active_order.status in (
            models.OrderStatus.paid,
            models.OrderStatus.cancelled,
        ):
            active_order = None
        if active_order and "[PAID:" in (active_order.notes or ""):
            active_order = None

    if not active_order:
        return JSONResponse(content={"order": None})

    # Get order items (exclude removed items for customer view)
    # Order by ID descending so newest items appear first (for customer view)
    items = session.exec(
        select(models.OrderItem).where(
            models.OrderItem.order_id == active_order.id,
            models.OrderItem.removed_by_customer == False
        ).order_by(models.OrderItem.id.desc())
    ).all()
    
    # Compute order status from items
    all_items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == active_order.id)).all()
    computed_status = compute_order_status_from_items(all_items)

    payload = {
        "order": {
            "id": active_order.id,
            "status": computed_status.value,
            "notes": active_order.notes,
            "session_id": active_order.session_id,
            "customer_name": active_order.customer_name,
            "created_at": active_order.created_at.isoformat(),
            "items": [
                {
                    "id": item.id,
                    "product_id": item.product_id,
                    "product_name": item.product_name,
                    "quantity": item.quantity,
                    "price_cents": item.price_cents,
                    "notes": item.notes,
                    "line_modifiers": getattr(item, "line_modifiers", None) or None,
                    "line_modifiers_summary": getattr(item, "line_modifiers_summary", None) or None,
                    "status": item.status.value if hasattr(item.status, "value") else str(item.status),
                    "tax_rate_percent": getattr(item, "tax_rate_percent", None),
                    "tax_amount_cents": getattr(item, "tax_amount_cents", None),
                }
                for item in items
            ],
            "extra_charge_cents": int(active_order.extra_charge_cents or 0),
            "extra_charge_note": active_order.extra_charge_note,
            "total_cents": sum(item.price_cents * item.quantity for item in items)
            + int(active_order.extra_charge_cents or 0),
        }
    }
    return JSONResponse(content=payload)


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the distance in meters between two GPS coordinates using Haversine formula."""
    import math
    R = 6371000  # Earth's radius in meters
    
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c


def _get_effective_tax(
    session: Session,
    tenant_id: int,
    product_tax_id: int | None,
    as_of: date | None = None,
) -> models.Tax | None:
    """
    Resolve the tax to apply for a product: product override or tenant default, valid at as_of date.
    Returns the Tax row or None (meaning 0% / exempt).
    """
    as_of = as_of or date.today()
    tax_id = product_tax_id
    if not tax_id:
        tenant = session.get(models.Tenant, tenant_id)
        if tenant and getattr(tenant, "default_tax_id", None):
            tax_id = tenant.default_tax_id
    if not tax_id:
        return None
    tax = session.get(models.Tax, tax_id)
    if not tax or tax.tenant_id != tenant_id:
        return None
    if tax.valid_from and as_of < tax.valid_from:
        return None
    if tax.valid_to is not None and as_of > tax.valid_to:
        return None
    return tax


def _price_cents_from_tenant_product_row(
    session: Session, tp: models.TenantProduct
) -> int | None:
    """Resolve selling price when tenant_product.price_cents is missing (legacy NULL rows)."""
    if tp.price_cents is not None:
        return tp.price_cents
    if tp.provider_product_id:
        pp = session.get(models.ProviderProduct, tp.provider_product_id)
        if pp is not None and pp.price_cents is not None:
            return pp.price_cents
    if tp.product_id:
        p = session.get(models.Product, tp.product_id)
        if p is not None and p.price_cents is not None:
            return p.price_cents
    return None


def _finalize_menu_order_line_price_cents(
    session: Session,
    *,
    tenant_id: int,
    request_product_id: int,
    effective_product_id: int,
    line_tenant_product: models.TenantProduct | None,
    price_cents: int | None,
    product_name: str | None,
) -> int:
    """Ensure order lines never insert NULL price_cents (DB NOT NULL on orderitem)."""
    if price_cents is not None:
        return price_cents
    if line_tenant_product is not None:
        resolved = _price_cents_from_tenant_product_row(session, line_tenant_product)
        if resolved is not None:
            return resolved
    p = session.get(models.Product, effective_product_id)
    if p is not None and p.price_cents is not None:
        return p.price_cents
    tp_by_request = session.exec(
        select(models.TenantProduct).where(
            models.TenantProduct.id == request_product_id,
            models.TenantProduct.tenant_id == tenant_id,
        )
    ).first()
    if tp_by_request is not None:
        resolved = _price_cents_from_tenant_product_row(session, tp_by_request)
        if resolved is not None:
            return resolved
    tp_linked = session.exec(
        select(models.TenantProduct).where(
            models.TenantProduct.tenant_id == tenant_id,
            models.TenantProduct.product_id == effective_product_id,
            models.TenantProduct.is_active == True,
        )
    ).first()
    if tp_linked is not None:
        resolved = _price_cents_from_tenant_product_row(session, tp_linked)
        if resolved is not None:
            return resolved
    raise HTTPException(
        status_code=400,
        detail=(
            f"Cannot add «{product_name or 'item'}»: no selling price is set. "
            "Set a price on the menu or product, or link a supplier price."
        ),
    )


@event.listens_for(Session, "before_flush")
def _tenantproduct_price_cents_guard(
    session: Session, flush_context: object, instances: object | None
) -> None:
    """Never persist tenantproduct.price_cents = NULL (column is NOT NULL). Coalesce from provider/product."""
    for obj in session.new.union(session.dirty):
        if not isinstance(obj, models.TenantProduct):
            continue
        if obj.price_cents is not None:
            continue
        resolved = _price_cents_from_tenant_product_row(session, obj)
        if resolved is not None:
            obj.price_cents = resolved
            continue
        raise InvalidRequestError(
            "tenantproduct.price_cents cannot be NULL; set a menu price or link a supplier/product price."
        )


def _tax_amount_cents_inclusive(price_cents: int, quantity: int, rate_percent: int) -> int:
    """Tax amount from tax-inclusive price. rate_percent e.g. 10, 21, 0."""
    if rate_percent <= 0:
        return 0
    total_incl = price_cents * quantity
    return round(total_incl * rate_percent / (100 + rate_percent))


@app.post("/menu/{table_token}/order")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_public_menu_per_minute', 30)}/minute"
)
def create_order(
    table_token: str,
    order_data: models.OrderCreate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: Annotated[models.User | None, Depends(security.get_current_user_optional)] = None,
) -> dict:
    """Public endpoint - add items to the table's shared order.

    A repeated submit with the same ``request_id`` (double tap, network retry) does not add
    the items twice: it gets the first response back (or 409 while the first is in flight).
    """
    request_id = (order_data.request_id or "").strip()[:64]
    redis_conn = get_redis() if request_id else None
    dedupe_key = f"menu_order_req:{table_token}:{request_id}"
    if redis_conn:
        try:
            if not redis_conn.set(dedupe_key, "pending", nx=True, ex=MENU_ORDER_REQUEST_TTL_SECONDS):
                previous = redis_conn.get(dedupe_key)
                if previous and previous != b"pending":
                    return JSONResponse(content=json.loads(previous))
                raise HTTPException(status_code=409, detail="Order already being submitted")
        except HTTPException:
            raise
        except Exception:
            redis_conn = None  # Redis hiccup: fall back to normal (non-deduplicated) submit
    try:
        response = _create_menu_order(table_token, order_data, request, session, current_user)
    except Exception:
        if redis_conn:
            redis_conn.delete(dedupe_key)  # allow a genuine retry after a failure
        raise
    if redis_conn:
        try:
            redis_conn.set(dedupe_key, response.body, ex=MENU_ORDER_REQUEST_TTL_SECONDS)
        except Exception:
            pass
    return response


MENU_ORDER_REQUEST_TTL_SECONDS = 120


_ORDER_CODE_MAX_FAILURES = 8
_ORDER_CODE_LOCK_SECONDS = 900


def _is_staff_for_tenant(user, tenant_id: int) -> bool:
    """True for a logged-in owner/waiter of the given restaurant."""
    return (
        user is not None
        and user.tenant_id == tenant_id
        and user.role in (models.UserRole.owner, models.UserRole.waiter)
    )


def _check_table_order_code(session: Session, table, supplied: str | None) -> None:
    """Raise 403 unless `supplied` matches the table's code; lock the table after repeated misses."""
    r = get_redis()
    fail_key = f"table_code_fail:{table.id}"
    if r:
        try:
            fails = r.get(fail_key)
            if fails is not None and int(fails) >= _ORDER_CODE_MAX_FAILURES:
                raise HTTPException(status_code=429, detail="too_many_code_attempts")
        except HTTPException:
            raise
        except Exception:
            r = None
    expected = _ensure_table_order_code(session, table)
    given = (supplied or "").strip()
    if not given or not hmac.compare_digest(given.encode("utf-8"), expected.encode("utf-8")):
        if r:
            try:
                n = r.incr(fail_key)
                if n == 1:
                    r.expire(fail_key, _ORDER_CODE_LOCK_SECONDS)
            except Exception:
                pass
        raise HTTPException(status_code=403, detail="invalid_table_code")
    if r:
        try:
            r.delete(fail_key)
        except Exception:
            pass


def _create_menu_order(
    table_token: str,
    order_data: models.OrderCreate,
    request: Request,
    session: Session,
    current_user: models.User | None = None,
) -> JSONResponse:
    table = session.exec(
        select(models.Table).where(models.Table.token == table_token)
    ).first()

    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    if not order_data.items:
        raise HTTPException(status_code=400, detail="Order must have at least one item")

    # Get tenant for location verification
    tenant = session.get(models.Tenant, table.tenant_id)

    # ============ TABLE ACTIVATION ============
    # Check if table is active (staff has opened it)
    if not table.is_active:
        raise HTTPException(
            status_code=403, 
            detail="Table is not accepting orders. Please ask staff to activate the table."
        )

    # ============ ORDER CODE ============
    # Browsing the menu is open; placing an order needs the 4-digit code staff see on the Tables grid.
    # Logged-in staff (owner/waiter of this restaurant) skip the code; customers cannot.
    if _table_requires_order_code(table) and not _is_staff_for_tenant(current_user, table.tenant_id):
        _check_table_order_code(session, table, order_data.table_code)

    # ============ GET OR CREATE SHARED ORDER ============
    # Order is created when table is activated only as a slot; we create it on first item add.
    # If no active order yet, we will create one below (requires at least one item).
    order = None
    if table.active_order_id:
        order = session.get(models.Order, table.active_order_id)
        if order and order.status in (
            models.OrderStatus.paid,
            models.OrderStatus.cancelled,
        ):
            order = None  # Will create a new order below if we have items

    if order is None:
        # No order yet, or previous shared order was paid/cancelled: create new order only if customer is adding items
        if not order_data.items or len(order_data.items) == 0:
            raise HTTPException(
                status_code=400,
                detail="Add at least one product to place an order.",
            )
        new_order = models.Order(
            table_id=table.id,
            tenant_id=table.tenant_id,
            status=models.OrderStatus.pending,
            session_id=None,
        )
        session.add(new_order)
        session.flush()
        table.active_order_id = new_order.id
        session.add(table)
        session.flush()
        order = new_order
        is_new_order = True
    else:
        is_new_order = False

    logger.debug(
        "POST /menu/.../order table_id=%s name=%s active=%s order_id=%s new=%s",
        table.id,
        table.name,
        table.is_active,
        order.id,
        is_new_order,
    )

    # ============ LOCATION VERIFICATION ============
    location_flagged = False
    if tenant and tenant.location_check_enabled and tenant.latitude and tenant.longitude:
        if order_data.latitude is not None and order_data.longitude is not None:
            distance = haversine_distance(
                tenant.latitude, tenant.longitude,
                order_data.latitude, order_data.longitude
            )
            logger.debug(
                "Location check: lat=%s lon=%s distance_m=%.0f radius_m=%s",
                order_data.latitude,
                order_data.longitude,
                distance,
                tenant.location_radius_meters,
            )

            if distance > tenant.location_radius_meters:
                location_flagged = True
                order.flagged_for_review = True
                order.flag_reason = f"Order placed from {distance:.0f}m away (limit: {tenant.location_radius_meters}m)"
                logger.debug("Order flagged for review: %s", order.flag_reason)
        else:
            logger.debug("Location check enabled but customer did not send coordinates")
    
    # Update customer name if provided (for display purposes)
    if order_data.customer_name and not order.customer_name:
        order.customer_name = order_data.customer_name

    # Append notes if provided
    order_note = normalize_order_note(order_data.notes)
    if order_note:
        order.notes = f"{order.notes or ''}\n{order_note}".strip()

    # Add order items
    order_date = order.created_at.date() if order.created_at else date.today()
    for item in order_data.items:
        # Use source indicator if provided, otherwise try TenantProduct first, then legacy Product
        product_name = None
        price_cents = None
        cost_cents: int | None = None
        product_tax_id: int | None = None
        effective_product_id: int  # Must be Product.id (OrderItem.product_id FK references product.id)
        line_tenant_product: models.TenantProduct | None = None

        if item.source == "tenant_product":
            # Explicitly look up TenantProduct (menu sends TenantProduct.id as product_id)
            tenant_product = session.exec(
                select(models.TenantProduct).where(
                    models.TenantProduct.id == item.product_id,
                    models.TenantProduct.tenant_id == table.tenant_id
                )
            ).first()
            if not tenant_product:
                raise HTTPException(status_code=400, detail=f"TenantProduct {item.product_id} not found")
            line_tenant_product = tenant_product
            product_name = tenant_product.name
            price_cents = tenant_product.price_cents
            cost_cents = getattr(tenant_product, "cost_cents", None)
            product_tax_id = getattr(tenant_product, "tax_id", None)
            if tenant_product.product_id is not None:
                effective_product_id = tenant_product.product_id
            else:
                # TenantProduct not yet linked to Product (e.g. catalog-only) - create Product and link
                link_price = _price_cents_from_tenant_product_row(session, tenant_product)
                if link_price is None:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Menu item «{tenant_product.name}» has no selling price. "
                            "Set a price in the menu or link a supplier product with a price."
                        ),
                    )
                new_product = models.Product(
                    name=tenant_product.name,
                    price_cents=link_price,
                    cost_cents=cost_cents,
                    tenant_id=table.tenant_id,
                )
                session.add(new_product)
                session.flush()
                effective_product_id = new_product.id
                tenant_product.product_id = new_product.id
                if tenant_product.price_cents is None:
                    tenant_product.price_cents = link_price
                session.add(tenant_product)
                price_cents = link_price
        elif item.source == "product":
            # Explicitly look up legacy Product
            product = session.exec(
                select(models.Product).where(
                    models.Product.id == item.product_id,
                    models.Product.tenant_id == table.tenant_id,
                )
            ).first()
            if not product:
                raise HTTPException(status_code=400, detail=f"Product {item.product_id} not found")
            product_name = product.name
            price_cents = product.price_cents
            cost_cents = getattr(product, "cost_cents", None)
            product_tax_id = getattr(product, "tax_id", None)
            effective_product_id = product.id
        else:
            # No source specified - try TenantProduct first, then fallback to legacy Product
            tenant_product = session.exec(
                select(models.TenantProduct).where(
                    models.TenantProduct.id == item.product_id,
                    models.TenantProduct.tenant_id == table.tenant_id
                )
            ).first()

            if tenant_product:
                line_tenant_product = tenant_product
                product_name = tenant_product.name
                price_cents = tenant_product.price_cents
                cost_cents = getattr(tenant_product, "cost_cents", None)
                product_tax_id = getattr(tenant_product, "tax_id", None)
                if tenant_product.product_id is not None:
                    effective_product_id = tenant_product.product_id
                else:
                    link_price = _price_cents_from_tenant_product_row(session, tenant_product)
                    if link_price is None:
                        raise HTTPException(
                            status_code=400,
                            detail=(
                                f"Menu item «{tenant_product.name}» has no selling price. "
                                "Set a price in the menu or link a supplier product with a price."
                            ),
                        )
                    new_product = models.Product(
                        name=tenant_product.name,
                        price_cents=link_price,
                        cost_cents=cost_cents,
                        tenant_id=table.tenant_id,
                    )
                    session.add(new_product)
                    session.flush()
                    effective_product_id = new_product.id
                    tenant_product.product_id = new_product.id
                    if tenant_product.price_cents is None:
                        tenant_product.price_cents = link_price
                    session.add(tenant_product)
                    price_cents = link_price
            else:
                # Fallback to legacy Product table
                product = session.exec(
                    select(models.Product).where(
                        models.Product.id == item.product_id,
                        models.Product.tenant_id == table.tenant_id
                    )
                ).first()
                if not product:
                    raise HTTPException(status_code=400, detail=f"Product {item.product_id} not found")
                product_name = product.name
                price_cents = product.price_cents
                cost_cents = getattr(product, "cost_cents", None)
                product_tax_id = getattr(product, "tax_id", None)
                effective_product_id = product.id

        price_cents = _finalize_menu_order_line_price_cents(
            session,
            tenant_id=table.tenant_id,
            request_product_id=item.product_id,
            effective_product_id=effective_product_id,
            line_tenant_product=line_tenant_product,
            price_cents=price_cents,
            product_name=product_name,
        )

        # Apply eligible line promo (#322) — discount tax-inclusive list price, recompute tax
        product_category = None
        eff_product = session.get(models.Product, effective_product_id)
        if eff_product and eff_product.category:
            product_category = eff_product.category
        elif line_tenant_product is not None:
            catalog_item = session.get(models.ProductCatalog, line_tenant_product.catalog_id)
            if catalog_item and catalog_item.category:
                product_category = catalog_item.category
        promo_applied = promo_svc.resolve_line_price(
            session,
            tenant_id=table.tenant_id,
            list_price_cents=price_cents,
            product_category=product_category,
            channel=models.OrderChannel.table.value,
        )
        list_price_cents = promo_applied["list_price_cents"]
        unit_discount_cents = promo_applied["discount_cents"]
        promo_id = promo_applied["promo_id"]
        promo_snapshot = promo_applied["promo_snapshot"]
        price_cents = promo_applied["price_cents"]

        # Resolve tax for this line (product override or tenant default)
        effective_tax = _get_effective_tax(session, table.tenant_id, product_tax_id, order_date)
        tax_id = effective_tax.id if effective_tax else None
        tax_rate = effective_tax.rate_percent if effective_tax else 0
        line_tax_cents = _tax_amount_cents_inclusive(price_cents, item.quantity, tax_rate) if effective_tax else 0

        # Check if this product already exists in the order with same modifiers (only active, non-removed items)
        raw_lm = getattr(item, "line_modifiers", None)
        norm_modifiers, lm_summary = validate_and_normalize_line_modifiers(raw_lm)
        existing_items = session.exec(
            select(models.OrderItem).where(
                models.OrderItem.order_id == order.id,
                models.OrderItem.product_id == effective_product_id,
                models.OrderItem.removed_by_customer == False,
                models.OrderItem.status != models.OrderItemStatus.delivered
            )
        ).all()
        existing_item = None
        item_note = normalize_order_note(item.notes)
        for ei in existing_items:
            if (
                line_modifiers_equal(getattr(ei, "line_modifiers", None), norm_modifiers)
                and order_notes_equal(ei.notes, item_note)
                and (getattr(ei, "promo_id", None) == promo_id)
                and (getattr(ei, "price_cents", None) == price_cents)
            ):
                existing_item = ei
                break

        if existing_item:
            existing_item.quantity += item.quantity
            if location_flagged:
                existing_item.location_flagged = True
            # Recompute tax for new total quantity
            existing_item.tax_id = tax_id
            existing_item.tax_rate_percent = tax_rate if effective_tax else None
            existing_item.tax_amount_cents = _tax_amount_cents_inclusive(
                price_cents, existing_item.quantity, tax_rate
            ) if effective_tax else None
            session.add(existing_item)
        else:
            order_item = models.OrderItem(
                order_id=order.id,
                product_id=effective_product_id,
                product_name=product_name,
                quantity=item.quantity,
                price_cents=price_cents,
                cost_cents=cost_cents,
                notes=item_note,
                line_modifiers=norm_modifiers,
                line_modifiers_summary=lm_summary,
                status=models.OrderItemStatus.pending,
                added_by_session=order_data.session_id,
                location_flagged=location_flagged,
                tax_id=tax_id,
                tax_rate_percent=tax_rate if effective_tax else None,
                tax_amount_cents=line_tax_cents if effective_tax else None,
                list_price_cents=list_price_cents,
                discount_cents=unit_discount_cents,
                promo_id=promo_id,
                promo_snapshot=promo_snapshot,
            )
            session.add(order_item)
    
    # After adding items, recompute order status (paid orders may leave completed → paid if new work)
    all_items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order.id)).all()
    recompute_order_status_preserving_payment(order, list(all_items))
    logger.debug("Recomputed order status from items: %s", order.status.value)
    
    session.commit()
    session.refresh(order)

    # Auto-deduct inventory for any product that has a recipe (BOM) configured.
    # Products without a recipe are simply skipped inside deduct_inventory_for_order.
    tenant = session.get(models.Tenant, table.tenant_id)
    if tenant:
        try:
            deduct_inventory_for_order(session, order, tenant)
            session.commit()
            logger.info(f"Inventory deducted for order #{order.id}")
        except Exception as e:
            # Log but don't fail the order - inventory can go negative
            logger.warning(f"Inventory deduction warning for order #{order.id}: {e}")

    # Publish to Redis for real-time updates
    publish_order_update(table.tenant_id, {
        "type": "new_order" if is_new_order else "items_added",
        "order_id": order.id,
        "table_name": table.name,
        "status": order.status.value,
        "created_at": order.created_at.isoformat()
    }, table_id=table.id)

    # Remove this device's draft cart lines after they were submitted to the shared order
    if order_data.session_id and _table_allows_shared_cart(table):
        table_cart_svc.remove_session_items(get_redis(), table.id, order_data.session_id.strip())
        _publish_cart_updated(table)

    return JSONResponse(content={
        "status": "created" if is_new_order else "updated",
        "order_id": order.id,
        "session_id": order.session_id,
        "customer_name": order.customer_name,
    })


# ============ PUBLIC: PAYMENT REQUEST & CALL WAITER ============


class PaymentRequest(_BaseModel):
    payment_method: str  # 'cash', 'card_terminal'
    message: str | None = None  # Optional message/observation from customer


@app.post("/menu/{table_token}/order/{order_id}/request-payment")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_public_menu_per_minute', 30)}/minute"
)
def request_payment(
    request: Request,
    table_token: str,
    order_id: int,
    payment_request: PaymentRequest,
    session: Session = Depends(get_session),
) -> dict:
    """
    Public endpoint - customer requests payment via cash or card terminal.
    Notifies staff via WebSocket so they can come to the table.
    """
    table = session.exec(
        select(models.Table).where(models.Table.token == table_token)
    ).first()

    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    if not table.is_active:
        raise HTTPException(status_code=403, detail="Table is not active.")

    order = session.get(models.Order, order_id)
    if not order or order.table_id != table.id:
        raise HTTPException(status_code=404, detail="Order not found for this table.")

    if order.status == models.OrderStatus.paid:
        raise HTTPException(status_code=400, detail="Order is already paid.")

    if order.bill_requested_at is None:
        order.bill_requested_at = datetime.now(timezone.utc)

    # Store the requested payment method on the order
    order.payment_method = payment_request.payment_method

    # Append customer message to notes if provided
    if payment_request.message:
        order.notes = f"{order.notes or ''}\n[CUSTOMER NOTE] {payment_request.message}".strip()

    session.commit()
    session.refresh(order)

    # Resolve assigned waiter (table-level, then floor-level fallback)
    effective_waiter_id = table.assigned_waiter_id
    effective_waiter_name = None
    if not effective_waiter_id and table.floor_id:
        floor = session.get(models.Floor, table.floor_id)
        if floor:
            effective_waiter_id = floor.default_waiter_id
    if effective_waiter_id:
        waiter = session.get(models.User, effective_waiter_id)
        if waiter:
            effective_waiter_name = waiter.full_name or waiter.username

    # Notify staff via WebSocket
    publish_order_update(table.tenant_id, {
        "type": "payment_requested",
        "order_id": order.id,
        "table_name": table.name,
        "table_id": table.id,
        "payment_method": payment_request.payment_method,
        "message": payment_request.message,
        "assigned_waiter_id": effective_waiter_id,
        "assigned_waiter_name": effective_waiter_name,
    }, table_id=table.id)

    return JSONResponse(content={
        "status": "payment_requested",
        "order_id": order.id,
        "payment_method": payment_request.payment_method,
    })


class CallWaiterRequest(_BaseModel):
    message: str | None = None  # Optional message/reason


@app.post("/menu/{table_token}/call-waiter")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_public_menu_per_minute', 30)}/minute"
)
def call_waiter(
    request: Request,
    table_token: str,
    waiter_request: CallWaiterRequest,
    session: Session = Depends(get_session),
) -> dict:
    """
    Public endpoint - customer requests a waiter to come to the table.
    Sends a real-time notification to staff via WebSocket.
    """
    table = session.exec(
        select(models.Table).where(models.Table.token == table_token)
    ).first()

    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    if not table.is_active:
        raise HTTPException(status_code=403, detail="Table is not active.")

    # Resolve assigned waiter (table-level, then floor-level fallback)
    effective_waiter_id = table.assigned_waiter_id
    effective_waiter_name = None
    if not effective_waiter_id and table.floor_id:
        floor = session.get(models.Floor, table.floor_id)
        if floor:
            effective_waiter_id = floor.default_waiter_id
    if effective_waiter_id:
        waiter = session.get(models.User, effective_waiter_id)
        if waiter:
            effective_waiter_name = waiter.full_name or waiter.username

    # Notify staff via WebSocket
    publish_order_update(table.tenant_id, {
        "type": "call_waiter",
        "table_name": table.name,
        "table_id": table.id,
        "message": waiter_request.message,
        "assigned_waiter_id": effective_waiter_id,
        "assigned_waiter_name": effective_waiter_name,
    }, table_id=table.id)

    return JSONResponse(content={
        "status": "waiter_called",
        "table_name": table.name,
    })


# ============ ORDERS (Protected) ============


def _tip_presets_from_request(raw: Any) -> list[int]:
    """Validate owner-submitted tip presets: 0–4 unique integers 0–100."""
    if not isinstance(raw, list):
        raise HTTPException(
            status_code=400, detail="tip_preset_percents must be a JSON array"
        )
    out: list[int] = []
    for x in raw:
        try:
            v = int(x)
        except (TypeError, ValueError):
            continue
        if 0 <= v <= 100:
            out.append(v)
    seen: set[int] = set()
    uniq: list[int] = []
    for v in out:
        if v not in seen:
            seen.add(v)
            uniq.append(v)
    if len(uniq) > 4:
        raise HTTPException(
            status_code=400, detail="At most 4 tip percentages are allowed"
        )
    return uniq


def _allowed_tip_presets(tenant: models.Tenant) -> list[int]:
    """Presets offered at checkout; None in DB means legacy default 5/10/15/20."""
    raw = tenant.tip_preset_percents
    if raw is None:
        return [5, 10, 15, 20]
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return []
    if not isinstance(raw, list):
        return []
    try:
        return _tip_presets_from_request(raw)
    except HTTPException:
        return []


def _active_order_subtotal_cents(session: Session, order_id: int) -> int:
    items = session.exec(
        select(models.OrderItem).where(models.OrderItem.order_id == order_id)
    ).all()
    active = [
        i
        for i in items
        if not i.removed_by_customer
        and i.removed_by_user_id is None
        and i.status != models.OrderItemStatus.cancelled
    ]
    order = session.get(models.Order, order_id)
    extra = int(getattr(order, "extra_charge_cents", 0) or 0)
    return sum(i.price_cents * i.quantity for i in active) + extra


def _tenant_tip_entry_mode(tenant: models.Tenant) -> str:
    raw = getattr(tenant, "tip_entry_mode", None) or "preset"
    if raw not in ("preset", "overpayment"):
        return "preset"
    return raw


def _effective_waiter_for_tip(session: Session, order: models.Order) -> int | None:
    if order.table_id is None:
        return None
    table = session.get(models.Table, order.table_id)
    if not table:
        return None
    if table.assigned_waiter_id:
        return table.assigned_waiter_id
    if table.floor_id:
        floor = session.get(models.Floor, table.floor_id)
        if floor and floor.default_waiter_id:
            return floor.default_waiter_id
    return None


def _resolve_tip_for_mark_paid(
    session: Session,
    tenant: models.Tenant,
    order_id: int,
    payment_data: models.OrderMarkPaid,
) -> tuple[int | None, int]:
    """Returns (tip_percent_applied, tip_amount_cents)."""
    mode = _tenant_tip_entry_mode(tenant)
    if mode == "overpayment":
        if payment_data.tip_amount_cents is None:
            raise HTTPException(
                status_code=400,
                detail="tip_amount_cents is required when tip entry mode is overpayment",
            )
        tip_amt = int(payment_data.tip_amount_cents)
        if tip_amt < 0:
            raise HTTPException(status_code=400, detail="Invalid tip_amount_cents")
        if tip_amt > 100_000_000:
            raise HTTPException(status_code=400, detail="tip_amount_cents too large")
        subtotal = _active_order_subtotal_cents(session, order_id)
        if subtotal <= 0 and tip_amt > 0:
            raise HTTPException(status_code=400, detail="Cannot add a tip to an empty order")
        if payment_data.amount_paid_cents is not None:
            ap = int(payment_data.amount_paid_cents)
            if ap < subtotal + tip_amt:
                raise HTTPException(
                    status_code=400,
                    detail="amount_paid_cents must cover subtotal and tip",
                )
        return None, tip_amt
    if payment_data.tip_amount_cents is not None:
        raise HTTPException(
            status_code=400,
            detail="tip_amount_cents is only used when tip entry mode is overpayment",
        )
    if payment_data.amount_paid_cents is not None:
        raise HTTPException(
            status_code=400,
            detail="amount_paid_cents is only used when tip entry mode is overpayment",
        )
    return _resolve_tip_on_mark_paid(
        session, tenant, order_id, payment_data.tip_percent
    )


def _resolve_tip_on_mark_paid(
    session: Session,
    tenant: models.Tenant,
    order_id: int,
    tip_percent: int | None,
) -> tuple[int | None, int]:
    """Returns (tip_percent_applied, tip_amount_cents)."""
    subtotal = _active_order_subtotal_cents(session, order_id)
    tp = 0 if tip_percent is None else int(tip_percent)
    if tp < 0 or tp > 100:
        raise HTTPException(status_code=400, detail="Invalid tip_percent")
    if tp == 0:
        return None, 0
    allowed = _allowed_tip_presets(tenant)
    if not allowed:
        raise HTTPException(
            status_code=400, detail="Tips are disabled for this restaurant"
        )
    if tp not in allowed:
        raise HTTPException(
            status_code=400, detail="Tip percent is not allowed for this restaurant"
        )
    if subtotal <= 0:
        raise HTTPException(status_code=400, detail="Cannot add a tip to an empty order")
    amt = (subtotal * tp + 50) // 100
    return tp, amt


def compute_order_status_from_items(items: list[models.OrderItem]) -> models.OrderStatus:
    """Compute order status from item statuses (single source of truth)."""
    if not items:
        return models.OrderStatus.pending
    
    # Filter out removed items for status computation (removed by customer OR staff)
    active_items = [item for item in items if not item.removed_by_customer and item.removed_by_user_id is None]
    if not active_items:
        return models.OrderStatus.cancelled
    
    # Check if all items are delivered
    all_delivered = all(item.status == models.OrderItemStatus.delivered for item in active_items)
    if all_delivered:
        return models.OrderStatus.completed
    
    # Check if some items are delivered (partial delivery)
    any_delivered = any(item.status == models.OrderItemStatus.delivered for item in active_items)
    if any_delivered:
        return models.OrderStatus.partially_delivered
    
    # Check if all items are ready
    all_ready = all(item.status == models.OrderItemStatus.ready for item in active_items)
    if all_ready:
        return models.OrderStatus.ready
    
    # Check if any item is preparing or ready
    any_preparing_or_ready = any(
        item.status in [models.OrderItemStatus.preparing, models.OrderItemStatus.ready] 
        for item in active_items
    )
    if any_preparing_or_ready:
        return models.OrderStatus.preparing
    
    # All items are pending
    return models.OrderStatus.pending


def recompute_order_status_preserving_payment(
    order: models.Order,
    items: list[models.OrderItem],
) -> None:
    """
    Update order.status from items.

    Unpaid orders follow item-derived workflow status.
    Paid orders stay ``paid`` while service is unfinished (pre-pay); when all
    items are delivered they become ``completed`` so they leave Active Orders (#345).
    Do not overwrite ``out_for_delivery`` (courier journey).
    """
    if order.status == models.OrderStatus.cancelled:
        return
    if order.status == models.OrderStatus.out_for_delivery:
        return
    paid = order.paid_at is not None or order.status == models.OrderStatus.paid
    if paid:
        computed = compute_order_status_from_items(items)
        if computed == models.OrderStatus.completed:
            order.status = models.OrderStatus.completed
        else:
            order.status = models.OrderStatus.paid
        return
    order.status = compute_order_status_from_items(items)


@app.post("/orders/offline-cash")
def create_offline_cash_order_endpoint(
    body: models.OfflineCashOrderCreate,
    current_user: Annotated[
        models.User,
        Depends(require_permission(Permission.ORDER_UPDATE_STATUS, Permission.ORDER_MARK_PAID)),
    ],
    session: Session = Depends(get_session),
) -> dict:
    """Staff: sync a sale queued while offline (cash paid, or deferred card unpaid). Idempotent."""
    if not body.items:
        raise HTTPException(status_code=400, detail="Order must have at least one item")

    from app.offline_order_service import create_offline_cash_order

    lines = [
        {"product_id": it.product_id, "quantity": it.quantity, "notes": it.notes}
        for it in body.items
    ]
    order, outcome = create_offline_cash_order(
        session,
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        idempotency_key=body.idempotency_key,
        table_id=body.table_id,
        lines=lines,
        notes=body.notes,
        customer_name=body.customer_name,
        payment_intent=body.payment_intent or "cash",
        send_to_kitchen=body.send_to_kitchen,
    )
    if not order:
        detail = outcome.get("detail", "create_failed")
        if detail in ("invalid_idempotency_key",):
            raise HTTPException(status_code=400, detail="idempotency_key must be 8–64 characters")
        if detail == "invalid_payment_intent":
            raise HTTPException(
                status_code=400,
                detail="payment_intent must be 'cash', 'card' or 'transfer'",
            )
        if detail == "table_not_found":
            raise HTTPException(status_code=404, detail="Table not found")
        if detail == "table_not_active":
            raise HTTPException(
                status_code=400,
                detail="Table is not active. Use Take Away or activate the table first.",
            )
        if detail == "no_lines":
            raise HTTPException(status_code=400, detail="Order must have at least one item")
        if str(detail).startswith("product_not_found"):
            raise HTTPException(status_code=400, detail=f"Product not found: {detail.split(':', 1)[-1]}")
        if detail == "idempotency_orphan":
            raise HTTPException(status_code=409, detail="Idempotency key refers to a missing order")
        raise HTTPException(status_code=400, detail=str(detail))

    table = session.get(models.Table, order.table_id) if order.table_id else None
    intent = outcome.get("payment_intent") or (body.payment_intent or "cash")
    return {
        "status": outcome.get("status", "created"),
        "order_id": order.id,
        "payment_method": order.payment_method,
        "payment_intent": intent,
        "needs_payment": bool(outcome.get("needs_payment", order.paid_at is None)),
        "paid_at": order.paid_at.isoformat() if order.paid_at else None,
        "table_id": order.table_id,
        "table_name": table.name if table else None,
        "idempotency_key": body.idempotency_key.strip(),
    }


@app.post("/orders/satisfecho-delivery")
def create_satisfecho_delivery_order_endpoint(
    body: models.SatisfechoDeliveryOrderCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_UPDATE_STATUS))],
    session: Session = Depends(get_session),
) -> dict:
    """Staff: create a first-party Satisfecho Delivery order (no table / marketplace)."""
    if not body.items:
        raise HTTPException(status_code=400, detail="Order must have at least one item")
    address = (body.delivery_address or "").strip()
    if not address:
        raise HTTPException(status_code=400, detail="delivery_address is required")

    phone = None
    if body.customer_phone and body.customer_phone.strip():
        try:
            phone = normalize_phone_e164(body.customer_phone, settings.default_phone_country)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid customer_phone")

    from app.delivery_order_service import create_satisfecho_delivery_order

    lines = [
        {"product_id": it.product_id, "quantity": it.quantity, "notes": it.notes}
        for it in body.items
    ]
    order, outcome = create_satisfecho_delivery_order(
        session,
        tenant_id=current_user.tenant_id,
        lines=lines,
        delivery_address=address,
        customer_phone=phone,
        customer_name=body.customer_name,
        notes=body.notes,
        courier_user_id=body.courier_user_id,
    )
    if not order:
        detail = outcome.get("detail", "create_failed")
        if detail == "delivery_address_required":
            raise HTTPException(status_code=400, detail="delivery_address is required")
        if detail == "invalid_courier_user":
            raise HTTPException(status_code=400, detail="courier_user_id must be a courier in this tenant")
        if detail == "no_lines":
            raise HTTPException(status_code=400, detail="Order must have at least one item")
        if str(detail).startswith("product_not_found"):
            raise HTTPException(status_code=400, detail=f"Product not found: {detail.split(':', 1)[-1]}")
        raise HTTPException(status_code=400, detail=str(detail))

    return {
        "id": order.id,
        "status": order.status.value,
        "order_channel": _order_channel_value(order),
        "delivery_address": order.delivery_address,
        "customer_phone": order.customer_phone,
        "customer_name": order.customer_name,
        "notes": order.notes,
        "courier_user_id": order.courier_user_id,
        "table_id": order.table_id,
        "created_at": order.created_at.isoformat() if order.created_at else None,
    }


@app.post("/orders/{order_id}/items")
def staff_add_order_items(
    order_id: int,
    body: models.OrderItemsAdd,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_UPDATE_STATUS))],
    session: Session = Depends(get_session),
) -> dict:
    """Staff: add products to an open order (table, Take Away or delivery)."""
    if not body.items:
        raise HTTPException(status_code=400, detail="Order must have at least one item")
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not order or order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == models.OrderStatus.cancelled:
        raise HTTPException(status_code=400, detail="Cannot add items to a cancelled order")
    reopen = order.paid_at is not None or order.status in (models.OrderStatus.paid, models.OrderStatus.completed)
    if reopen and order_pay_svc.amount_paid_cents(session, order.id) <= 0:
        raise HTTPException(status_code=400, detail="Cannot add items to a paid order without recorded payments")

    from app.delivery_order_service import add_lines_to_order

    outcome = add_lines_to_order(
        session,
        order=order,
        lines=[{"product_id": it.product_id, "quantity": it.quantity, "notes": it.notes} for it in body.items],
    )
    if outcome.get("status") != "ok":
        detail = str(outcome.get("detail", "add_failed"))
        raise HTTPException(status_code=400, detail=detail)

    if reopen:
        # Payments already made stay on the order; the new lines are the balance still to collect.
        order.paid_at = None
        order.status = models.OrderStatus.pending
    all_items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order_id)).all()
    recompute_order_status_preserving_payment(order, list(all_items))
    session.add(order)
    session.commit()
    session.refresh(order)
    _sync_order_inventory(session, order)

    table = session.get(models.Table, order.table_id) if order.table_id else None
    publish_order_update(
        order.tenant_id,
        {
            "type": "items_added",
            "order_id": order.id,
            "table_name": table.name if table else None,
            "status": order.status.value,
        },
        table_id=order.table_id,
    )
    return {"status": "items_added", "order_id": order.id}


@app.put("/orders/{order_id}/delivery")
def update_order_delivery(
    order_id: int,
    body: models.OrderDeliveryUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_UPDATE_STATUS))],
    session: Session = Depends(get_session),
) -> dict:
    """Staff: update delivery metadata on a Satisfecho Delivery order."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not order or order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")
    if _order_channel_value(order) != models.OrderChannel.satisfecho_delivery.value:
        raise HTTPException(
            status_code=400,
            detail="Only Satisfecho Delivery orders can update delivery fields via this endpoint",
        )

    updates = body.model_dump(exclude_unset=True)
    if "delivery_address" in updates:
        address = (updates["delivery_address"] or "").strip()
        if not address:
            raise HTTPException(status_code=400, detail="delivery_address cannot be empty")
        order.delivery_address = address
    if "customer_phone" in updates:
        raw_phone = updates["customer_phone"]
        if raw_phone and str(raw_phone).strip():
            try:
                order.customer_phone = normalize_phone_e164(
                    str(raw_phone), settings.default_phone_country
                )
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid customer_phone")
        else:
            order.customer_phone = None
    if "customer_name" in updates:
        name = updates["customer_name"]
        order.customer_name = (name or "").strip() or None
    if "notes" in updates:
        from app.order_notes import normalize_order_note

        order.notes = normalize_order_note(updates["notes"])
    if "courier_user_id" in updates:
        cid = updates["courier_user_id"]
        if cid is None:
            order.courier_user_id = None
        else:
            courier = session.get(models.User, cid)
            if (
                not courier
                or courier.tenant_id != current_user.tenant_id
                or courier.role != models.UserRole.courier
            ):
                raise HTTPException(
                    status_code=400,
                    detail="courier_user_id must be a courier in this tenant",
                )
            order.courier_user_id = cid

    session.add(order)
    session.commit()
    session.refresh(order)
    return {
        "id": order.id,
        "order_channel": _order_channel_value(order),
        "delivery_address": order.delivery_address,
        "customer_phone": order.customer_phone,
        "customer_name": order.customer_name,
        "notes": order.notes,
        "courier_user_id": order.courier_user_id,
    }


@app.get("/orders")
def list_orders(
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_READ))],
    include_removed: bool = Query(False, description="Include removed items in response"),
    session: Session = Depends(get_session)
) -> list[dict]:
    orders = session.exec(
        select(models.Order)
        .where(models.Order.tenant_id == current_user.tenant_id)
        .where(models.Order.deleted_at.is_(None))
        .order_by(models.Order.created_at.desc())
    ).all()

    tenant_row = session.get(models.Tenant, current_user.tenant_id)
    station_rows = session.exec(
        select(models.KitchenStation).where(
            models.KitchenStation.tenant_id == current_user.tenant_id
        )
    ).all()
    station_by_id = {s.id: s for s in station_rows if s.id is not None}

    result = []
    for order in orders:
        table = session.exec(select(models.Table).where(models.Table.id == order.table_id)).first()
        
        # Get items, optionally including removed ones
        if include_removed:
            items = session.exec(
                select(models.OrderItem)
                .where(models.OrderItem.order_id == order.id)
                .order_by(models.OrderItem.removed_by_customer.asc(), models.OrderItem.id.asc())
            ).all()
        else:
            items = session.exec(
                select(models.OrderItem)
                .where(
                    models.OrderItem.order_id == order.id,
                    models.OrderItem.removed_by_customer == False,
                    models.OrderItem.removed_by_user_id.is_(None),
                )
            ).all()
        
        # Display status from items; paid + fully delivered → completed for Active/History (#345)
        status_items = session.exec(
            select(models.OrderItem).where(models.OrderItem.order_id == order.id)
        ).all()
        if order.status == models.OrderStatus.cancelled:
            computed_status = models.OrderStatus.cancelled
        elif order.status == models.OrderStatus.out_for_delivery:
            computed_status = models.OrderStatus.out_for_delivery
        elif order.paid_at is not None or order.status == models.OrderStatus.paid:
            item_status = compute_order_status_from_items(list(status_items))
            computed_status = (
                models.OrderStatus.completed
                if item_status == models.OrderStatus.completed
                else models.OrderStatus.paid
            )
        else:
            computed_status = compute_order_status_from_items(list(status_items))
        
        # Get all items for removed count calculation
        all_items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order.id)).all()
        
        # Calculate total from active items only (exclude items removed by customer OR staff, and cancelled)
        active_items = [
            item for item in all_items
            if not item.removed_by_customer and item.removed_by_user_id is None and item.status != models.OrderItemStatus.cancelled
        ]
        # Do not list orders that have no products (empty orders are not allowed)
        if len(active_items) == 0:
            continue
        subtotal_cents = sum(item.price_cents * item.quantity for item in active_items)
        tip_amt = int(order.tip_amount_cents or 0)
        extra_charge = int(order.extra_charge_cents or 0)
        total_cents = subtotal_cents + extra_charge + tip_amt

        # Product categories for kitchen/bar display filtering (one query per order)
        product_ids = list({i.product_id for i in items})
        product_map = {}
        if product_ids:
            products = session.exec(
                select(models.Product).where(models.Product.id.in_(product_ids))
            ).all()
            product_map = {p.id: p for p in products}

        # Billing customer for Factura (if set)
        billing_customer = None
        if order.billing_customer_id:
            bc = session.get(models.BillingCustomer, order.billing_customer_id)
            if bc and bc.tenant_id == current_user.tenant_id:
                billing_customer = {
                    "id": bc.id,
                    "name": bc.name,
                    "company_name": bc.company_name,
                    "tax_id": bc.tax_id,
                    "address": bc.address,
                    "email": bc.email,
                    "phone": bc.phone,
                    "birth_date": bc.birth_date.isoformat() if bc.birth_date else None,
                }

        order_items_json: list[dict] = []
        for oi in items:
            prod = product_map.get(oi.product_id) if product_map else None
            if tenant_row:
                kid, knm, krt = resolve_order_item_kds(prod, tenant_row, station_by_id)
            else:
                kid, knm, krt = None, None, "kitchen"
            order_items_json.append(
                {
                    "id": oi.id,
                    "product_name": oi.product_name,
                    "quantity": oi.quantity,
                    "price_cents": oi.price_cents,
                    "notes": oi.notes,
                    "line_modifiers": getattr(oi, "line_modifiers", None) or None,
                    "line_modifiers_summary": getattr(oi, "line_modifiers_summary", None) or None,
                    "status": oi.status.value if hasattr(oi.status, "value") else str(oi.status),
                    "removed_by_customer": oi.removed_by_customer,
                    "removed_by_staff": oi.removed_by_user_id is not None,
                    "removed_at": oi.removed_at.isoformat() if oi.removed_at else None,
                    "removed_reason": oi.removed_reason,
                    "tax_id": getattr(oi, "tax_id", None),
                    "tax_rate_percent": getattr(oi, "tax_rate_percent", None),
                    "tax_amount_cents": getattr(oi, "tax_amount_cents", None),
                    "category": getattr(product_map.get(oi.product_id), "category", None),
                    "kitchen_station_id": kid,
                    "kitchen_station_name": knm,
                    "kitchen_station_route": krt,
                }
            )

        tg_label = None
        if table:
            tg_label = _table_group_display_label(session, current_user.tenant_id, table)

        channel = _order_channel_value(order)
        table_display = "Unknown"
        if channel == models.OrderChannel.satisfecho_delivery.value:
            table_display = "Domicilio"
        elif getattr(order, "delivery_integration_id", None) or channel == models.OrderChannel.marketplace.value:
            table_display = "Delivery"
        elif table:
            table_display = table.name

        row_out = {
            "id": order.id,
            "table_name": table_display,
            "table_id": table.id if table else None,
            "table_token": table.token if table else None,
            "status": computed_status.value,
            "notes": order.notes,
            "session_id": order.session_id,
            "customer_name": order.customer_name,
            "billing_customer_id": order.billing_customer_id,
            "billing_customer": billing_customer,
            "created_at": order.created_at.isoformat(),
            "paid_at": order.paid_at.isoformat() if order.paid_at else None,
            "payment_method": order.payment_method,
            "staff_urgent": bool(getattr(order, "staff_urgent", False)),
            "order_channel": channel,
            "delivery_address": getattr(order, "delivery_address", None),
            "customer_phone": getattr(order, "customer_phone", None),
            "courier_user_id": getattr(order, "courier_user_id", None),
            "delivery_integration_id": getattr(order, "delivery_integration_id", None),
            "external_order_ref": getattr(order, "external_order_ref", None),
            "items": order_items_json,
            "subtotal_cents": subtotal_cents,
            "tip_percent_applied": getattr(order, "tip_percent_applied", None),
            "tip_amount_cents": getattr(order, "tip_amount_cents", None),
            "extra_charge_cents": extra_charge,
            "extra_charge_note": order.extra_charge_note,
            "tip_attributed_user_id": getattr(order, "tip_attributed_user_id", None),
            "total_cents": total_cents,
            "removed_items_count": len([item for item in all_items if item.removed_by_customer]),
        }
        recon = order_pay_svc.reconciliation_dict(session, order)
        row_out["amount_due_cents"] = recon["amount_due_cents"]
        row_out["amount_paid_cents"] = recon["amount_paid_cents"]
        row_out["amount_remaining_cents"] = recon["amount_remaining_cents"]
        row_out["payments"] = recon["payments"]
        if tg_label:
            row_out["table_group_label"] = tg_label
        result.append(row_out)
    
    return result


@app.put("/orders/{order_id}/status")
def update_order_status(
    order_id: int,
    status_update: models.OrderStatusUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_UPDATE_STATUS))],
    session: Session = Depends(get_session),
) -> dict:
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id,
        )
    ).first()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")

    # Update order status
    order.status = status_update.status

    # For backward compatibility: if updating order-level status, update all active items
    # Map order status to item status
    items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order_id)).all()
    active_items = [item for item in items if not item.removed_by_customer]
    
    if active_items:
        status_mapping = {
            models.OrderStatus.pending: models.OrderItemStatus.pending,
            models.OrderStatus.preparing: models.OrderItemStatus.preparing,
            models.OrderStatus.ready: models.OrderItemStatus.ready,
            # out_for_delivery: items stay ready (courier en route); no item remapping
            models.OrderStatus.completed: models.OrderItemStatus.delivered,  # completed = all items delivered
            models.OrderStatus.partially_delivered: models.OrderItemStatus.delivered,  # Partial delivery
        }
        
        item_status = status_mapping.get(status_update.status)
        if item_status:
            for item in active_items:
                # Only update if item is not already delivered
                if item.status != models.OrderItemStatus.delivered:
                    item.status = item_status
                    item.status_updated_at = datetime.now(timezone.utc)
                    if item_status == models.OrderItemStatus.ready:
                        item.prepared_by_user_id = current_user.id
                    elif item_status == models.OrderItemStatus.delivered:
                        item.delivered_by_user_id = current_user.id
                    session.add(item)
    
    session.add(order)
    session.commit()
    _sync_order_inventory(session, order)

    # Publish status update
    table = session.exec(select(models.Table).where(models.Table.id == order.table_id)).first()
    publish_order_update(current_user.tenant_id, {
        "type": "status_update",
        "order_id": order.id,
        "table_name": table.name if table else "Unknown",
        "status": order.status.value
    }, table_id=order.table_id)
    
    return {"status": "updated", "order_id": order.id, "new_status": order.status.value}


@app.put("/orders/{order_id}/mark-paid")
def mark_order_paid(
    order_id: int,
    payment_data: models.OrderMarkPaid,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_MARK_PAID))],
    session: Session = Depends(get_session)
) -> dict:
    """Mark order as paid manually (for cash/terminal payments). Pays remaining balance as one leg."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id
        )
    ).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == models.OrderStatus.paid or order.paid_at:
        raise HTTPException(status_code=400, detail="Order is already paid.")
    if order.status == models.OrderStatus.cancelled:
        raise HTTPException(status_code=400, detail="Cannot mark a cancelled order as paid.")
    
    tenant = session.get(models.Tenant, current_user.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    tip_pct, tip_amt = _resolve_tip_for_mark_paid(
        session, tenant, order_id, payment_data
    )

    # Allow pre-pay: staff can mark as paid even when not all items are delivered (e.g. customer pays before food is ready).
    # Do not clear bill_requested_at here — unmark-paid needs it for /tables/with-status payment_pending (GitHub #190).
    order.tip_percent_applied = tip_pct
    order.tip_amount_cents = tip_amt if tip_amt else None
    order.tip_attributed_user_id = _effective_waiter_for_tip(session, order)
    session.add(order)
    session.flush()

    due = order_pay_svc.order_due_cents(session, order, include_tip=True)
    already = order_pay_svc.amount_paid_cents(session, order.id)
    remaining = max(0, due - already)
    method = (payment_data.payment_method or "cash").strip() or "cash"

    if remaining > 0:
        _payment, recon = order_pay_svc.record_payment(
            session,
            order=order,
            amount_cents=remaining,
            payment_method=method,
            paid_by_user_id=current_user.id,
            tip_amount_cents=None,
            note="Full settlement (mark-paid)",
            settle_if_covered=True,
        )
    else:
        now = datetime.now(timezone.utc)
        order.paid_at = now
        order.paid_by_user_id = current_user.id
        order.payment_method = order_pay_svc.settlement_payment_method(
            order_pay_svc.list_active_payments(session, order.id)
        ) or method
        order.status = order_pay_svc.status_after_full_payment(session, order)
        session.add(order)
        session.commit()
        session.refresh(order)
        recon = order_pay_svc.reconciliation_dict(session, order)


    # Publish update
    table = session.exec(select(models.Table).where(models.Table.id == order.table_id)).first()
    publish_order_update(current_user.tenant_id, {
        "type": "order_paid",
        "order_id": order.id,
        "table_name": table.name if table else "Unknown",
        "payment_method": order.payment_method or method
    }, table_id=order.table_id)
    _close_table_after_full_payment(session, order, current_user.tenant_id)

    return {
        "status": "paid",
        "order_id": order.id,
        "payment_method": order.payment_method or method,
        "paid_at": order.paid_at.isoformat() if order.paid_at else None,
        "tip_percent_applied": order.tip_percent_applied,
        "tip_amount_cents": order.tip_amount_cents,
        "amount_due_cents": recon.get("amount_due_cents"),
        "amount_paid_cents": recon.get("amount_paid_cents"),
        "amount_remaining_cents": recon.get("amount_remaining_cents"),
        "payments": recon.get("payments"),
    }


@app.put("/orders/{order_id}/extra-charge")
def set_order_extra_charge(
    order_id: int,
    body: models.OrderExtraChargeUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_MARK_PAID))],
    session: Session = Depends(get_session),
) -> dict:
    """Waiter/owner sets (or clears with 0) an additional charge on an unpaid order."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not order or order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.paid_at or order.status in (models.OrderStatus.paid, models.OrderStatus.cancelled):
        raise HTTPException(status_code=400, detail="Order is already paid or cancelled")
    order.extra_charge_cents = body.amount_cents
    note = (body.note or "").strip()
    order.extra_charge_note = note or None if body.amount_cents > 0 else None
    session.add(order)
    session.commit()
    session.refresh(order)
    table = session.get(models.Table, order.table_id) if order.table_id else None
    publish_order_update(current_user.tenant_id, {
        "type": "extra_charge_updated",
        "order_id": order.id,
        "table_name": table.name if table else "Unknown",
        "extra_charge_cents": order.extra_charge_cents,
    }, table_id=order.table_id)
    return {
        "order_id": order.id,
        "extra_charge_cents": order.extra_charge_cents,
        "extra_charge_note": order.extra_charge_note,
    }


@app.get("/orders/{order_id}/payments")
def get_order_payments(
    order_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_READ))],
    session: Session = Depends(get_session),
) -> dict:
    """List payment legs and reconciliation totals for split bill (#318)."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not order or order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")
    recon = order_pay_svc.reconciliation_dict(session, order)
    return {"order_id": order.id, "paid_at": order.paid_at.isoformat() if order.paid_at else None, **recon}


@app.post("/orders/{order_id}/payments")
def post_order_payment(
    order_id: int,
    body: models.OrderPaymentCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_MARK_PAID))],
    session: Session = Depends(get_session),
) -> dict:
    """Record a partial or settling payment leg (#318)."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not order or order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")

    payment, recon = order_pay_svc.record_payment(
        session,
        order=order,
        amount_cents=body.amount_cents,
        payment_method=body.payment_method,
        paid_by_user_id=current_user.id,
        payer_label=body.payer_label,
        tip_amount_cents=body.tip_amount_cents,
        note=body.note,
        order_item_ids=body.order_item_ids,
        settle_if_covered=True,
    )

    if order.paid_at:
        table = session.exec(select(models.Table).where(models.Table.id == order.table_id)).first()
        publish_order_update(
            current_user.tenant_id,
            {
                "type": "order_paid",
                "order_id": order.id,
                "table_name": table.name if table else "Unknown",
                "payment_method": order.payment_method,
            },
            table_id=order.table_id,
        )
        _close_table_after_full_payment(session, order, current_user.tenant_id)
    else:
        table = session.exec(select(models.Table).where(models.Table.id == order.table_id)).first()
        publish_order_update(
            current_user.tenant_id,
            {
                "type": "order_payment_recorded",
                "order_id": order.id,
                "table_name": table.name if table else "Unknown",
                "amount_cents": payment.amount_cents,
                "amount_remaining_cents": recon.get("amount_remaining_cents"),
            },
            table_id=order.table_id,
        )

    return {
        "status": "paid" if order.paid_at else "partial",
        "order_id": order.id,
        "payment": order_pay_svc.payment_to_dict(session, payment),
        **recon,
        "paid_at": order.paid_at.isoformat() if order.paid_at else None,
        "payment_method": order.payment_method,
    }


@app.delete("/orders/{order_id}/payments/{payment_id}")
def delete_order_payment(
    order_id: int,
    payment_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_MARK_PAID))],
    session: Session = Depends(get_session),
) -> dict:
    """Void a payment leg while the order is not fully paid (#318)."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not order or order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")
    row = order_pay_svc.void_payment(session, order=order, payment_id=payment_id)
    recon = order_pay_svc.reconciliation_dict(session, order)
    return {
        "status": "voided",
        "order_id": order.id,
        "payment": order_pay_svc.payment_to_dict(session, row),
        **recon,
    }


@app.put("/orders/{order_id}/finish")
def finish_order(
    order_id: int,
    payment_data: models.OrderMarkPaid,
    current_user: Annotated[
        models.User,
        Depends(require_permission(Permission.ORDER_UPDATE_STATUS, Permission.ORDER_MARK_PAID)),
    ],
    session: Session = Depends(get_session),
) -> dict:
    """Mark all active line items as delivered and the order as paid in one step (fast checkout)."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id,
        )
    ).first()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == models.OrderStatus.paid or order.paid_at:
        raise HTTPException(status_code=400, detail="Order is already paid.")
    if order.status == models.OrderStatus.cancelled:
        raise HTTPException(status_code=400, detail="Cannot finish a cancelled order.")

    tenant = session.get(models.Tenant, current_user.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    tip_pct, tip_amt = _resolve_tip_for_mark_paid(
        session, tenant, order_id, payment_data
    )

    items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order_id)).all()
    active_items = [item for item in items if not item.removed_by_customer]
    now = datetime.now(timezone.utc)
    for item in active_items:
        if item.status == models.OrderItemStatus.cancelled:
            continue
        if item.status != models.OrderItemStatus.delivered:
            item.status = models.OrderItemStatus.delivered
            item.status_updated_at = now
            item.delivered_by_user_id = current_user.id
            session.add(item)

    order.tip_percent_applied = tip_pct
    order.tip_amount_cents = tip_amt if tip_amt else None
    order.tip_attributed_user_id = _effective_waiter_for_tip(session, order)
    session.add(order)
    session.flush()

    method = (payment_data.payment_method or "cash").strip() or "cash"
    due = order_pay_svc.order_due_cents(session, order, include_tip=True)
    already = order_pay_svc.amount_paid_cents(session, order.id)
    remaining = max(0, due - already)
    if remaining > 0:
        _payment, recon = order_pay_svc.record_payment(
            session,
            order=order,
            amount_cents=remaining,
            payment_method=method,
            paid_by_user_id=current_user.id,
            note="Full settlement (finish)",
            settle_if_covered=True,
        )
    else:
        order.paid_at = now
        order.paid_by_user_id = current_user.id
        order.payment_method = order_pay_svc.settlement_payment_method(
            order_pay_svc.list_active_payments(session, order.id)
        ) or method
        order.status = order_pay_svc.status_after_full_payment(session, order)
        session.add(order)
        session.commit()
        session.refresh(order)
        recon = order_pay_svc.reconciliation_dict(session, order)


    table = session.exec(select(models.Table).where(models.Table.id == order.table_id)).first()
    publish_order_update(
        current_user.tenant_id,
        {
            "type": "order_paid",
            "order_id": order.id,
            "table_name": table.name if table else "Unknown",
            "payment_method": order.payment_method or method,
        },
        table_id=order.table_id,
    )
    _close_table_after_full_payment(session, order, current_user.tenant_id)

    return {
        "status": "paid",
        "order_id": order.id,
        "payment_method": order.payment_method or method,
        "paid_at": order.paid_at.isoformat() if order.paid_at else None,
        "tip_percent_applied": order.tip_percent_applied,
        "tip_amount_cents": order.tip_amount_cents,
        "amount_paid_cents": recon.get("amount_paid_cents"),
        "payments": recon.get("payments"),
    }


@app.put("/orders/{order_id}/unmark-paid")
def unmark_order_paid(
    order_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_MARK_PAID))],
    session: Session = Depends(get_session)
) -> dict:
    """Unmark order as paid (clear paid mark only; order status is restored from item statuses)."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id
        )
    ).first()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == models.OrderStatus.cancelled:
        raise HTTPException(status_code=400, detail="Cannot unmark a cancelled order.")
    if order.status != models.OrderStatus.paid and order.paid_at is None:
        raise HTTPException(status_code=400, detail="Order is not paid.")

    # Clear the paid mark only
    order.paid_at = None
    order.paid_by_user_id = None
    order.payment_method = None
    order.tip_percent_applied = None
    order.tip_amount_cents = None
    order.tip_attributed_user_id = None
    # Restore workflow status from items (do not leave status as 'paid')
    items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order_id)).all()
    order.status = compute_order_status_from_items(list(items))
    order_pay_svc.void_all_payments(session, order_id)

    session.add(order)
    session.commit()

    table = session.exec(select(models.Table).where(models.Table.id == order.table_id)).first()
    publish_order_update(current_user.tenant_id, {
        "type": "status_update",
        "order_id": order.id,
        "table_name": table.name if table else "Unknown",
        "status": order.status.value
    }, table_id=order.table_id)

    return {"status": "unmarked", "order_id": order.id, "new_status": order.status.value}


@app.delete("/orders/{order_id}")
def delete_order(
    order_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_DELETE))],
    session: Session = Depends(get_session)
) -> dict:
    """Soft-delete an order: remove from orders list and from book-keeping (reports). For test/cleanup."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.deleted_at is not None:
        raise HTTPException(status_code=400, detail="Order is already deleted")

    order.deleted_at = datetime.now(timezone.utc)
    order.deleted_by_user_id = current_user.id
    order.table_id = None
    # Unlink from table so it no longer appears as active order
    tables = session.exec(
        select(models.Table).where(
            models.Table.tenant_id == current_user.tenant_id,
            models.Table.active_order_id == order_id,
        )
    ).all()
    for table in tables:
        table.active_order_id = None
        session.add(table)
    session.add(order)
    session.commit()
    _sync_order_inventory(session, order)
    return {"status": "deleted", "order_id": order.id}


@app.put("/orders/{order_id}/billing-customer")
def set_order_billing_customer(
    order_id: int,
    body: models.OrderBillingCustomerSet,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_MARK_PAID))],
    session: Session = Depends(get_session)
) -> dict:
    """Set or clear the billing customer (Factura) for an order."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id
        )
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")
    customer_id = body.billing_customer_id
    if customer_id is not None:
        customer = session.get(models.BillingCustomer, customer_id)
        if not customer or customer.tenant_id != current_user.tenant_id:
            raise HTTPException(status_code=404, detail="Billing customer not found")
    order.billing_customer_id = customer_id
    session.add(order)
    session.commit()
    return {"order_id": order.id, "billing_customer_id": order.billing_customer_id}


@app.get("/orders/{order_id}/dian-invoice")
def get_order_dian_invoice(
    order_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_READ))],
    session: Session = Depends(get_session),
) -> dict:
    """Return persisted DIAN invoice metadata for an order (tenant-scoped)."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not order or order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")
    di = get_dian_invoice(session, current_user.tenant_id, order.id)
    if not di:
        raise HTTPException(status_code=404, detail="DIAN invoice not found")
    return dian_invoice_public_dict(di)


@app.post("/orders/{order_id}/dian-invoice/issue")
def issue_order_dian_invoice(
    order_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_MARK_PAID))],
    session: Session = Depends(get_session),
) -> dict:
    """Issue or return existing DIAN electronic invoice for an order (idempotent per order)."""
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not order or order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")
    di = issue_or_get_dian_invoice(session, tenant, order)
    session.commit()
    session.refresh(di)
    return dian_invoice_public_dict(di)


@app.post("/orders/{order_id}/dian-invoice/cancel")
def cancel_order_dian_invoice(
    order_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_CANCEL))],
    session: Session = Depends(get_session),
) -> dict:
    """Issue a credit note (nota crédito) for the order's issued DIAN invoice; idempotent once cancelled."""
    tenant = session.exec(
        select(models.Tenant).where(models.Tenant.id == current_user.tenant_id)
    ).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not order or order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")
    di = cancel_dian_invoice(session, tenant, order)
    session.commit()
    session.refresh(di)
    return dian_invoice_public_dict(di)


@app.put("/orders/{order_id}/staff-urgent")
def set_order_staff_urgent(
    order_id: int,
    body: models.OrderStaffUrgentUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_UPDATE_STATUS))],
    session: Session = Depends(get_session),
) -> dict:
    """Mark or clear kitchen urgency (guest waiting for food)."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id,
        )
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status in (models.OrderStatus.cancelled,):
        raise HTTPException(status_code=400, detail="Cannot change urgency on cancelled orders")

    order.staff_urgent = bool(body.urgent)
    session.add(order)
    session.commit()

    table = session.exec(
        select(models.Table).where(models.Table.id == order.table_id)
    ).first()
    publish_order_update(
        current_user.tenant_id,
        {
            "type": "order_urgent_updated",
            "order_id": order.id,
            "staff_urgent": order.staff_urgent,
            "table_name": table.name if table else None,
        },
        table_id=order.table_id,
    )
    return {"order_id": order.id, "staff_urgent": order.staff_urgent}


def _billing_customer_dict(c: models.BillingCustomer, current_tenant_id: int) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "company_name": c.company_name,
        "tax_id": c.tax_id,
        "address": c.address,
        "email": c.email,
        "phone": c.phone,
        "birth_date": c.birth_date.isoformat() if c.birth_date else None,
        "created_at": c.created_at.isoformat(),
        "tenant_id": c.tenant_id,
        "is_shared": c.tenant_id != current_tenant_id,
    }


# ---------- Billing customers (Factura) ----------


@app.get("/billing-customers")
def list_billing_customers(
    current_user: Annotated[models.User, Depends(require_permission(Permission.BILLING_CUSTOMER_READ))],
    search: str | None = Query(None, description="Search by name, company_name, tax_id, email"),
    session: Session = Depends(get_session)
) -> list[dict]:
    from sqlalchemy import or_
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = select(models.BillingCustomer).where(
            models.BillingCustomer.tenant_id == current_user.tenant_id
        ).where(
            or_(
                models.BillingCustomer.name.ilike(term),
                models.BillingCustomer.company_name.ilike(term),
                models.BillingCustomer.tax_id.ilike(term),
                models.BillingCustomer.email.ilike(term),
            )
        ).order_by(models.BillingCustomer.name.asc())
    else:
        q = select(models.BillingCustomer).where(
            models.BillingCustomer.tenant_id == current_user.tenant_id
        ).order_by(models.BillingCustomer.name.asc())
    customers = session.exec(q).all()
    return [_billing_customer_dict(c, current_user.tenant_id) for c in customers]


@app.post("/billing-customers")
def create_billing_customer(
    body: models.BillingCustomerCreate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.BILLING_CUSTOMER_WRITE))],
    session: Session = Depends(get_session)
) -> dict:
    customer = models.BillingCustomer(
        tenant_id=current_user.tenant_id,
        name=body.name,
        company_name=body.company_name,
        tax_id=body.tax_id,
        address=body.address,
        email=body.email,
        phone=body.phone,
        birth_date=body.birth_date,
    )
    session.add(customer)
    session.commit()
    session.refresh(customer)
    return _billing_customer_dict(customer, current_user.tenant_id)


@app.get("/billing-customers/{customer_id}")
def get_billing_customer(
    customer_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.BILLING_CUSTOMER_READ))],
    session: Session = Depends(get_session)
) -> dict:
    customer = session.get(models.BillingCustomer, customer_id)
    if not customer or customer.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Billing customer not found")
    return _billing_customer_dict(customer, current_user.tenant_id)


@app.put("/billing-customers/{customer_id}")
def update_billing_customer(
    customer_id: int,
    body: models.BillingCustomerUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.BILLING_CUSTOMER_WRITE))],
    session: Session = Depends(get_session)
) -> dict:
    customer = session.exec(
        select(models.BillingCustomer).where(
            models.BillingCustomer.id == customer_id,
            models.BillingCustomer.tenant_id == current_user.tenant_id
        )
    ).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Billing customer not found")
    if body.name is not None:
        customer.name = body.name
    if body.company_name is not None:
        customer.company_name = body.company_name
    if body.tax_id is not None:
        customer.tax_id = body.tax_id
    if body.address is not None:
        customer.address = body.address
    if body.email is not None:
        customer.email = body.email
    if body.phone is not None:
        customer.phone = body.phone
    _bc_upd = body.model_dump(exclude_unset=True)
    if "birth_date" in _bc_upd:
        customer.birth_date = _bc_upd["birth_date"]
    customer.updated_at = datetime.now(timezone.utc)
    session.add(customer)
    session.commit()
    session.refresh(customer)
    return _billing_customer_dict(customer, current_user.tenant_id)


@app.delete("/billing-customers/{customer_id}")
def delete_billing_customer(
    customer_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.BILLING_CUSTOMER_WRITE))],
    session: Session = Depends(get_session)
) -> None:
    customer = session.exec(
        select(models.BillingCustomer).where(
            models.BillingCustomer.id == customer_id,
            models.BillingCustomer.tenant_id == current_user.tenant_id
        )
    ).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Billing customer not found")
    session.delete(customer)
    session.commit()
    return None


@app.put("/orders/{order_id}/items/{item_id}/status")
def update_order_item_status(
    order_id: int,
    item_id: int,
    status_update: models.OrderItemStatusUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_ITEM_STATUS))],
    session: Session = Depends(get_session)
) -> dict:
    """Update individual order item status (restaurant staff)."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id
        )
    ).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    item = session.exec(
        select(models.OrderItem).where(
            models.OrderItem.id == item_id,
            models.OrderItem.order_id == order_id
        )
    ).first()
    
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    
    # Update item status
    old_status = item.status
    item.status = status_update.status
    item.status_updated_at = datetime.now(timezone.utc)
    
    # Only attribute work to users of the same tenant (reports/tips are built from these ids)
    if status_update.user_id is not None and status_update.user_id != current_user.id:
        _attributed = session.get(models.User, status_update.user_id)
        if _attributed is None or _attributed.tenant_id != current_user.tenant_id:
            status_update.user_id = None

    # Track who prepared/delivered
    if status_update.status == models.OrderItemStatus.ready:
        item.prepared_by_user_id = status_update.user_id or current_user.id
    elif status_update.status == models.OrderItemStatus.delivered:
        item.delivered_by_user_id = status_update.user_id or current_user.id
        # Ready/delivered are marked in one step in the UI now, so prepared_by
        # may never get set via the ready branch above.
        if item.prepared_by_user_id is None:
            item.prepared_by_user_id = status_update.user_id or current_user.id
    
    session.add(item)
    
    # Recompute order status from items
    all_items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order_id)).all()
    recompute_order_status_preserving_payment(order, list(all_items))
    
    session.add(order)
    session.commit()
    _sync_order_inventory(session, order)
    
    # Publish update
    table = session.exec(select(models.Table).where(models.Table.id == order.table_id)).first()
    publish_order_update(current_user.tenant_id, {
        "type": "item_status_update",
        "order_id": order.id,
        "item_id": item.id,
        "old_status": old_status.value if hasattr(old_status, 'value') else str(old_status),
        "new_status": item.status.value,
        "status": order.status.value if hasattr(order.status, 'value') else str(order.status),  # Include computed order status
        "table_name": table.name if table else "Unknown"
    }, table_id=order.table_id)
    
    return {
        "status": "updated",
        "order_id": order.id,
        "item_id": item.id,
        "item_status": item.status.value,
        "order_status": order.status.value
    }


@app.put("/orders/{order_id}/items/{item_id}/reset-status")
def reset_item_status(
    order_id: int,
    item_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_ITEM_STATUS))],
    session: Session = Depends(get_session)
) -> dict:
    """Reset item status from preparing to pending (restaurant staff only)."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id
        )
    ).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    item = session.exec(
        select(models.OrderItem).where(
            models.OrderItem.id == item_id,
            models.OrderItem.order_id == order_id
        )
    ).first()
    
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    
    # Validation: Can only reset from preparing to pending
    if item.status != models.OrderItemStatus.preparing:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reset status from {item.status.value}. Only 'preparing' items can be reset to 'pending'."
        )
    
    # Reset status
    old_status = item.status
    item.status = models.OrderItemStatus.pending
    item.status_updated_at = datetime.now(timezone.utc)
    item.prepared_by_user_id = None  # Clear prepared_by since we're resetting
    
    session.add(item)
    
    # Recompute order status
    all_items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order_id)).all()
    recompute_order_status_preserving_payment(order, list(all_items))
    
    session.add(order)
    session.commit()
    
    # Publish update
    table = session.exec(select(models.Table).where(models.Table.id == order.table_id)).first()
    publish_order_update(current_user.tenant_id, {
        "type": "item_status_update",
        "order_id": order.id,
        "item_id": item.id,
        "old_status": old_status.value,
        "new_status": item.status.value,
        "status": order.status.value,
        "table_name": table.name if table else "Unknown"
    }, table_id=order.table_id)
    
    return {
        "status": "reset",
        "order_id": order.id,
        "item_id": item.id,
        "old_status": old_status.value,
        "new_status": item.status.value,
        "order_status": order.status.value
    }


@app.put("/orders/{order_id}/items/{item_id}/cancel")
def cancel_order_item_staff(
    order_id: int,
    item_id: int,
    cancel_data: models.OrderItemCancel,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_CANCEL))],
    session: Session = Depends(get_session)
) -> dict:
    """Cancel order item (restaurant staff) - requires reason if item is ready."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id
        )
    ).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    item = session.exec(
        select(models.OrderItem).where(
            models.OrderItem.id == item_id,
            models.OrderItem.order_id == order_id
        )
    ).first()
    
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    
    # Validation: Cannot cancel delivered items
    if item.status == models.OrderItemStatus.delivered:
        raise HTTPException(status_code=400, detail="Cannot cancel delivered items")
    
    # Validation: If item is ready, reason is required (for tax authorities)
    if item.status == models.OrderItemStatus.ready and not cancel_data.reason:
        raise HTTPException(
            status_code=400,
            detail="Reason is required when cancelling ready items (required for tax reporting)"
        )
    
    # Cancel item (soft delete)
    item.removed_by_customer = False  # Removed by staff, not customer
    item.removed_by_user_id = current_user.id
    item.removed_at = datetime.now(timezone.utc)
    item.removed_reason = cancel_data.reason
    item.cancelled_reason = cancel_data.reason  # Store for tax reporting
    item.status = models.OrderItemStatus.cancelled
    
    session.add(item)
    
    # Recompute order status and total
    all_items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order_id)).all()
    recompute_order_status_preserving_payment(order, list(all_items))
    
    session.add(order)
    session.commit()
    _sync_order_inventory(session, order)
    
    # Calculate new total
    active_items = [i for i in all_items if not i.removed_by_customer and i.removed_by_user_id is None]
    new_total = sum(i.price_cents * i.quantity for i in active_items)
    
    # Publish update
    table = session.exec(select(models.Table).where(models.Table.id == order.table_id)).first()
    publish_order_update(current_user.tenant_id, {
        "type": "item_cancelled",
        "order_id": order.id,
        "item_id": item.id,
        "cancelled_by": "staff",
        "table_name": table.name if table else "Unknown",
        "new_total_cents": new_total
    }, table_id=order.table_id)
    
    return {
        "status": "item_cancelled",
        "order_id": order.id,
        "item_id": item.id,
        "new_total_cents": new_total
    }


@app.put("/orders/{order_id}/items/{item_id}")
def update_order_item_staff(
    order_id: int,
    item_id: int,
    item_update: models.OrderItemStaffUpdate,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_REMOVE_ITEM))],
    session: Session = Depends(get_session)
) -> dict:
    """Update order item (restaurant staff) - can modify any item except delivered."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id
        )
    ).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    item = session.exec(
        select(models.OrderItem).where(
            models.OrderItem.id == item_id,
            models.OrderItem.order_id == order_id
        )
    ).first()
    
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    
    # Validation: Cannot modify delivered items
    if item.status == models.OrderItemStatus.delivered:
        raise HTTPException(status_code=400, detail="Cannot modify delivered items")
    
    # Update item
    if item_update.quantity is not None:
        if item_update.quantity <= 0:
            # Remove item (soft delete)
            item.removed_by_customer = False
            item.removed_by_user_id = current_user.id
            item.removed_at = datetime.now(timezone.utc)
            item.status = models.OrderItemStatus.cancelled
        else:
            item.quantity = item_update.quantity
            item.modified_by_user_id = current_user.id
            item.modified_at = datetime.now(timezone.utc)
    
    if item_update.notes is not None:
        item.notes = normalize_order_note(item_update.notes)
        item.modified_by_user_id = current_user.id
        item.modified_at = datetime.now(timezone.utc)

    if item_update.line_modifiers is not None:
        norm_lm, lm_summary = validate_and_normalize_line_modifiers(item_update.line_modifiers)
        item.line_modifiers = norm_lm
        item.line_modifiers_summary = lm_summary
        item.modified_by_user_id = current_user.id
        item.modified_at = datetime.now(timezone.utc)

    session.add(item)
    
    # Recompute order status and total
    all_items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order_id)).all()
    recompute_order_status_preserving_payment(order, list(all_items))
    
    session.add(order)
    session.commit()
    _sync_order_inventory(session, order)
    
    # Calculate new total
    active_items = [i for i in all_items if not i.removed_by_customer and i.removed_by_user_id is None]
    new_total = sum(i.price_cents * i.quantity for i in active_items)
    
    # Publish update
    table = session.exec(select(models.Table).where(models.Table.id == order.table_id)).first()
    publish_order_update(current_user.tenant_id, {
        "type": "item_updated",
        "order_id": order.id,
        "item_id": item.id,
        "new_quantity": item.quantity,
        "table_name": table.name if table else "Unknown",
        "new_total_cents": new_total
    }, table_id=order.table_id)
    
    return {
        "status": "item_updated",
        "order_id": order.id,
        "item_id": item.id,
        "new_quantity": item.quantity,
        "new_total_cents": new_total
    }


@app.delete("/orders/{order_id}/items/{item_id}")
def remove_order_item_staff(
    order_id: int,
    item_id: int,
    current_user: Annotated[models.User, Depends(require_permission(Permission.ORDER_REMOVE_ITEM))],
    reason: str | None = Query(None, description="Required reason when removing ready items"),
    session: Session = Depends(get_session)
) -> dict:
    """Remove order item (restaurant staff). Reason required for ready/delivered items (audit/tax)."""
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.tenant_id == current_user.tenant_id
        )
    ).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    item = session.exec(
        select(models.OrderItem).where(
            models.OrderItem.id == item_id,
            models.OrderItem.order_id == order_id
        )
    ).first()
    
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    
    # Validation: Reason required when removing ready or delivered items (audit/tax)
    if item.status in (models.OrderItemStatus.ready, models.OrderItemStatus.delivered):
        if not reason or not reason.strip():
            raise HTTPException(
                status_code=400,
                detail="Reason is required when removing ready or delivered items (for audit and tax reporting)"
            )
    
    # Soft delete
    item.removed_by_customer = False
    item.removed_by_user_id = current_user.id
    item.removed_at = datetime.now(timezone.utc)
    item.removed_reason = reason
    item.cancelled_reason = reason
    item.status = models.OrderItemStatus.cancelled
    
    session.add(item)
    
    # Recompute order status and total
    all_items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order_id)).all()
    recompute_order_status_preserving_payment(order, list(all_items))
    
    session.add(order)
    session.commit()
    _sync_order_inventory(session, order)
    
    # Calculate new total
    active_items = [i for i in all_items if not i.removed_by_customer and i.removed_by_user_id is None]
    new_total = sum(i.price_cents * i.quantity for i in active_items)
    
    # Publish update
    table = session.exec(select(models.Table).where(models.Table.id == order.table_id)).first()
    publish_order_update(current_user.tenant_id, {
        "type": "item_removed",
        "order_id": order.id,
        "item_id": item.id,
        "removed_by": "staff",
        "table_name": table.name if table else "Unknown",
        "new_total_cents": new_total
    }, table_id=order.table_id)
    
    return {
        "status": "item_removed",
        "order_id": order.id,
        "removed_item_id": item.id,
        "new_total_cents": new_total
    }


def _reject_guest_change_if_paid(order: "models.Order") -> None:
    """Guests may not edit/cancel an order once it has been paid."""
    if order.paid_at is not None or order.status == models.OrderStatus.paid:
        raise HTTPException(status_code=400, detail="Order already paid and can no longer be changed")


# ============ ORDER MODIFICATION (Public - Customer) ============


@app.delete("/menu/{table_token}/order/{order_id}/items/{item_id}")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_public_menu_per_minute', 30)}/minute"
)
def remove_order_item(
    request: Request,
    table_token: str,
    order_id: int,
    item_id: int,
    session_id: str | None = Query(None, description="Session identifier for order validation"),
    reason: str | None = Query(None, description="Optional reason for removal"),
    session: Session = Depends(get_session),
    current_user: Annotated[models.User | None, Depends(security.get_current_user_optional)] = None,
) -> dict:
    """Remove item from order (soft delete - customer)."""
    table = session.exec(select(models.Table).where(models.Table.token == table_token)).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.table_id == table.id
        )
    ).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Security: Validate that order belongs to this session
    # If order has a session_id, request must provide matching session_id
    is_staff = _is_staff_for_tenant(current_user, table.tenant_id)
    if not is_staff and order.session_id and order.session_id != session_id:
        raise HTTPException(status_code=403, detail="Order does not belong to this session")
    _reject_guest_change_if_paid(order)
    
    item = session.exec(
        select(models.OrderItem).where(
            models.OrderItem.id == item_id,
            models.OrderItem.order_id == order_id
        )
    ).first()
    
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    
    # Validation: Cannot remove items that are already being prepared or delivered
    if not is_staff and item.status in [models.OrderItemStatus.delivered, models.OrderItemStatus.preparing, models.OrderItemStatus.ready]:
        status_label = {
            models.OrderItemStatus.delivered: "delivered",
            models.OrderItemStatus.preparing: "being prepared",
            models.OrderItemStatus.ready: "ready"
        }.get(item.status, "in progress")
        raise HTTPException(
            status_code=400, 
            detail=f"Cannot remove items that are {status_label}. Only pending items can be removed."
        )
    
    # Soft delete: Mark as removed (NEVER actually delete)
    item.removed_by_customer = True
    item.removed_at = datetime.now(timezone.utc)
    item.removed_reason = reason
    if is_staff:
        item.removed_by_user_id = current_user.id
    item.status = models.OrderItemStatus.cancelled
    
    session.add(item)
    
    # Recompute order status and total
    all_items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order_id)).all()
    recompute_order_status_preserving_payment(order, list(all_items))
    
    session.add(order)
    session.commit()
    _sync_order_inventory(session, order)
    
    # Calculate new total (exclude removed items)
    active_items = [i for i in all_items if not i.removed_by_customer]
    new_total = sum(i.price_cents * i.quantity for i in active_items)
    
    # Publish update
    publish_order_update(order.tenant_id, {
        "type": "item_removed",
        "order_id": order.id,
        "item_id": item.id,
        "table_name": table.name,
        "new_total_cents": new_total
    }, table_id=order.table_id)

    return JSONResponse(content={
        "status": "item_removed",
        "order_id": order.id,
        "removed_item_id": item.id,
        "new_total_cents": new_total,
        "items_remaining": len(active_items),
    })


@app.put("/menu/{table_token}/order/{order_id}/items/{item_id}")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_public_menu_per_minute', 30)}/minute"
)
def update_order_item_quantity(
    request: Request,
    table_token: str,
    order_id: int,
    item_id: int,
    item_update: models.OrderItemUpdate,
    session_id: str | None = Query(None, description="Session identifier for order validation"),
    session: Session = Depends(get_session),
    current_user: Annotated[models.User | None, Depends(security.get_current_user_optional)] = None,
) -> dict:
    """Update order item quantity (customer)."""
    table = session.exec(select(models.Table).where(models.Table.token == table_token)).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.table_id == table.id
        )
    ).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Security: Validate that order belongs to this session
    # If order has a session_id, request must provide matching session_id
    is_staff = _is_staff_for_tenant(current_user, table.tenant_id)
    if not is_staff and order.session_id and order.session_id != session_id:
        raise HTTPException(status_code=403, detail="Order does not belong to this session")
    _reject_guest_change_if_paid(order)
    
    item = session.exec(
        select(models.OrderItem).where(
            models.OrderItem.id == item_id,
            models.OrderItem.order_id == order_id
        )
    ).first()
    
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    
    # Validation: Cannot modify items that are already being prepared or delivered
    if not is_staff and item.status in [models.OrderItemStatus.delivered, models.OrderItemStatus.preparing, models.OrderItemStatus.ready]:
        status_label = {
            models.OrderItemStatus.delivered: "delivered",
            models.OrderItemStatus.preparing: "being prepared",
            models.OrderItemStatus.ready: "ready"
        }.get(item.status, "in progress")
        raise HTTPException(
            status_code=400, 
            detail=f"Cannot modify items that are {status_label}. Only pending items can be modified."
        )
    
    # If quantity is 0, remove item (soft delete)
    if item_update.quantity <= 0:
        item.removed_by_customer = True
        item.removed_at = datetime.now(timezone.utc)
        item.status = models.OrderItemStatus.cancelled
    else:
        item.quantity = item_update.quantity
    
    session.add(item)
    
    # Recompute order status and total
    all_items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order_id)).all()
    recompute_order_status_preserving_payment(order, list(all_items))
    
    session.add(order)
    session.commit()
    _sync_order_inventory(session, order)
    
    # Calculate new total (exclude items removed by customer OR staff)
    active_items = [i for i in all_items if not i.removed_by_customer and i.removed_by_user_id is None]
    new_total = sum(i.price_cents * i.quantity for i in active_items)
    
    # Publish update
    publish_order_update(order.tenant_id, {
        "type": "item_updated",
        "order_id": order.id,
        "item_id": item.id,
        "new_quantity": item.quantity,
        "table_name": table.name,
        "new_total_cents": new_total
    }, table_id=order.table_id)

    return JSONResponse(content={
        "status": "item_updated",
        "order_id": order.id,
        "item_id": item.id,
        "new_quantity": item.quantity,
        "new_total_cents": new_total,
    })


@app.delete("/menu/{table_token}/order/{order_id}")
@limiter.limit(
    f"{getattr(settings, 'rate_limit_public_menu_per_minute', 30)}/minute"
)
def cancel_order(
    request: Request,
    table_token: str,
    order_id: int,
    session_id: str | None = Query(None, description="Session identifier for order validation"),
    session: Session = Depends(get_session),
    current_user: Annotated[models.User | None, Depends(security.get_current_user_optional)] = None,
) -> dict:
    """Cancel entire order (soft delete - customer)."""
    table = session.exec(select(models.Table).where(models.Table.token == table_token)).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    
    order = session.exec(
        select(models.Order).where(
            models.Order.id == order_id,
            models.Order.table_id == table.id
        )
    ).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Security: Validate that order belongs to this session
    # If order has a session_id, request must provide matching session_id
    is_staff = _is_staff_for_tenant(current_user, table.tenant_id)
    if not is_staff and order.session_id and order.session_id != session_id:
        raise HTTPException(status_code=403, detail="Order does not belong to this session")
    _reject_guest_change_if_paid(order)
    
    # Validation: Cannot cancel if any items are being prepared, ready, or delivered
    items = session.exec(select(models.OrderItem).where(models.OrderItem.order_id == order_id)).all()
    active_items = [item for item in items if not item.removed_by_customer]
    in_progress_items = [
        item for item in active_items 
        if item.status in [models.OrderItemStatus.preparing, models.OrderItemStatus.ready, models.OrderItemStatus.delivered]
    ]
    if in_progress_items and not is_staff:
        statuses = [item.status.value for item in in_progress_items]
        if models.OrderItemStatus.delivered.value in statuses:
            raise HTTPException(status_code=400, detail="Cannot cancel order with delivered items")
        elif models.OrderItemStatus.ready.value in statuses:
            raise HTTPException(status_code=400, detail="Cannot cancel order with items that are ready. Only pending items can be cancelled.")
        else:
            raise HTTPException(status_code=400, detail="Cannot cancel order with items that are being prepared. Only pending items can be cancelled.")
    
    # Soft delete: Mark order and all items as cancelled
    order.status = models.OrderStatus.cancelled
    order.cancelled_at = datetime.now(timezone.utc)
    order.cancelled_by = "staff" if is_staff else "customer"
    order.session_id = None  # Prevent order reuse - new orders get new numbers
    
    for item in items:
        if not item.removed_by_customer:  # Only cancel items not already removed
            item.removed_by_customer = True
            item.removed_at = datetime.now(timezone.utc)
            item.status = models.OrderItemStatus.cancelled

    session.add(order)
    if table.active_order_id == order.id:
        table.active_order_id = None
        session.add(table)

    session.commit()
    _sync_order_inventory(session, order)

    # Publish update
    publish_order_update(order.tenant_id, {
        "type": "order_cancelled",
        "order_id": order.id,
        "table_name": table.name,
        "cancelled_items": len(items)
    }, table_id=order.table_id)

    return JSONResponse(content={
        "status": "order_cancelled",
        "order_id": order.id,
        "cancelled_items": len(items),
    })

