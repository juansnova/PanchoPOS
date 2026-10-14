"""Product bulk import API routes."""

from io import BytesIO
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, File, HTTPException, Request, Response, UploadFile
from PIL import Image
from sqlmodel import Session

from .db import get_session
from . import models
from .permissions import Permission, require_permission
from .rate_limits import admin_user_limit
from .settings import settings
from .product_bulk_import import (
    MAX_VISION_IMAGE_BYTES,
    ProductBulkImportConfirmRequest,
    ProductBulkImportConfirmResult,
    ProductBulkImportCsvRequest,
    ProductBulkImportPreviewResponse,
    ProductBulkImportRequest,
    build_preview,
    confirm_import,
    extract_items_from_menu_image,
    parse_json_import_payload,
    parse_products_csv,
    vision_api_configured,
)

router = APIRouter()

_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/avif"}


def _resolve_image_content_type(file: UploadFile, contents: bytes) -> str | None:
    ct = file.content_type
    if ct in _ALLOWED_IMAGE_TYPES:
        return ct
    fn = (file.filename or "").lower()
    ext_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".avif": "image/avif",
    }
    for ext, mime in ext_map.items():
        if fn.endswith(ext):
            return mime
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


@router.get("/vision-status")
def bulk_import_vision_status(
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_READ))],
) -> dict[str, bool]:
    """Whether menu photo extraction is available (API key configured)."""
    return {"configured": vision_api_configured()}


@router.post("/preview", response_model=ProductBulkImportPreviewResponse)
@admin_user_limit()
def bulk_import_preview(
    request: Request,
    response: Response,
    body: ProductBulkImportRequest,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> ProductBulkImportPreviewResponse:
    """Validate JSON rows and return a read-only preview (no DB writes)."""
    return build_preview(session, current_user.tenant_id, body.items)


@router.post("/preview-json", response_model=ProductBulkImportPreviewResponse)
@admin_user_limit()
def bulk_import_preview_raw_json(
    request: Request,
    response: Response,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
    payload: Any = Body(...),
) -> ProductBulkImportPreviewResponse:
    """Accept pasted JSON ({items:[...]} or raw array) and return preview."""
    try:
        items = parse_json_import_payload(payload)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_import_json")
    if not items:
        raise HTTPException(status_code=400, detail="import_empty")
    return build_preview(session, current_user.tenant_id, items)


def _http_detail_for_csv_parse_error(exc: Exception) -> tuple[int, str]:
    """Map parse_products_csv / AI errors to HTTP status + detail string."""
    if isinstance(exc, RuntimeError):
        code = str(exc)
        if code == "vision_not_configured":
            return 503, "product_vision_not_configured"
        if code.startswith("vision_api_error"):
            return 502, "product_vision_api_failed"
        return 502, "product_vision_parse_failed"
    msg = str(exc)
    if msg.startswith("unknown_csv_columns:"):
        return 400, msg
    if msg.startswith("unmapped_csv_columns:"):
        return 400, msg
    if msg.startswith("invalid_ai_mapping:"):
        return 400, msg
    if msg in {
        "empty_csv",
        "missing_name_column",
        "duplicate_csv_headers",
        "too_many_rows",
    }:
        return 400, msg
    if msg.startswith("row_"):
        return 400, "invalid_csv_row"
    return 400, "invalid_import_csv"


@router.post("/preview-csv", response_model=ProductBulkImportPreviewResponse)
@admin_user_limit()
def bulk_import_preview_csv(
    request: Request,
    response: Response,
    body: ProductBulkImportCsvRequest,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> ProductBulkImportPreviewResponse:
    """
    Accept CSV/TSV text (paste or file contents), parse into items, return preview.
    No DB writes. Optional ``use_ai_mapping`` remaps unknown headers via the vision LLM.
    """
    if body.use_ai_mapping and not vision_api_configured():
        raise HTTPException(status_code=503, detail="product_vision_not_configured")
    try:
        items = parse_products_csv(body.csv, use_ai_mapping=body.use_ai_mapping)
    except Exception as exc:
        status, detail = _http_detail_for_csv_parse_error(exc)
        raise HTTPException(status_code=status, detail=detail) from exc
    if not items:
        raise HTTPException(status_code=400, detail="import_empty")
    return build_preview(session, current_user.tenant_id, items)


@router.post("/vision/preview", response_model=ProductBulkImportPreviewResponse)
@admin_user_limit()
def bulk_import_vision_preview(
    request: Request,
    response: Response,
    file: Annotated[UploadFile, File()],
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> ProductBulkImportPreviewResponse:
    """
    Upload a menu photo; call vision API to extract items, then return preview.
    Image is not stored; user must confirm before products are saved.
    """
    if not vision_api_configured():
        raise HTTPException(status_code=503, detail="product_vision_not_configured")

    contents = file.file.read()
    if len(contents) > MAX_VISION_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="vision_image_too_large")
    content_type = _resolve_image_content_type(file, contents)
    if content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="vision_invalid_image_type")

    try:
        items = extract_items_from_menu_image(contents, content_type)
    except RuntimeError as e:
        code = str(e)
        if code == "vision_not_configured":
            raise HTTPException(status_code=503, detail="product_vision_not_configured")
        if code.startswith("vision_api_error"):
            raise HTTPException(status_code=502, detail="product_vision_api_failed")
        raise HTTPException(status_code=502, detail="product_vision_parse_failed")
    except Exception:
        raise HTTPException(status_code=502, detail="product_vision_parse_failed")

    if not items:
        raise HTTPException(status_code=400, detail="vision_no_items_found")
    return build_preview(session, current_user.tenant_id, items)


@router.post("/confirm", response_model=ProductBulkImportConfirmResult)
@admin_user_limit()
def bulk_import_confirm(
    request: Request,
    response: Response,
    body: ProductBulkImportConfirmRequest,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> ProductBulkImportConfirmResult:
    """Persist valid preview rows after explicit user confirmation."""
    valid_count = sum(1 for r in body.items if r.valid)
    if valid_count == 0:
        raise HTTPException(status_code=400, detail="import_no_valid_rows")
    return confirm_import(session, current_user.tenant_id, body.items)
