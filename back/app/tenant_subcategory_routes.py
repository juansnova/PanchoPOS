"""Tenant custom product subcategory CRUD."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import Field
from sqlmodel import Session, SQLModel

from .db import get_session
from . import models
from .permissions import Permission, require_permission
from .rate_limits import admin_user_limit
from .tenant_subcategories import (
    add_custom_subcategory,
    remove_custom_subcategory,
    rename_custom_subcategory,
)

router = APIRouter()


class SubcategoryCreateBody(SQLModel):
    category: str = Field(max_length=128)
    name: str = Field(max_length=128)


class SubcategoryRenameBody(SQLModel):
    category: str = Field(max_length=128)
    old_name: str = Field(max_length=128)
    new_name: str = Field(max_length=128)


class SubcategoryDeleteBody(SQLModel):
    category: str = Field(max_length=128)
    name: str = Field(max_length=128)


@router.post("")
@admin_user_limit()
def create_tenant_subcategory(
    request: Request,
    response: Response,
    body: SubcategoryCreateBody,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> dict[str, list[str]]:
    try:
        return add_custom_subcategory(
            session, current_user.tenant_id, body.category, body.name
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.put("")
@admin_user_limit()
def rename_tenant_subcategory(
    request: Request,
    response: Response,
    body: SubcategoryRenameBody,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> dict[str, list[str]]:
    try:
        return rename_custom_subcategory(
            session,
            current_user.tenant_id,
            body.category,
            body.old_name,
            body.new_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("")
@admin_user_limit()
def delete_tenant_subcategory(
    request: Request,
    response: Response,
    body: SubcategoryDeleteBody,
    current_user: Annotated[models.User, Depends(require_permission(Permission.PRODUCT_WRITE))],
    session: Session = Depends(get_session),
) -> dict[str, list[str]]:
    try:
        return remove_custom_subcategory(
            session, current_user.tenant_id, body.category, body.name
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
