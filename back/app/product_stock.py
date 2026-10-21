"""Helpers for per-product sellable stock alerts (#356)."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from . import models


def product_stock_alert_payload(product: models.Product | None) -> dict:
    """Public menu fields when stock alert is enabled on a Product row."""
    if product is None or not product.stock_alert_enabled:
        return {}
    return {
        "stock_alert_enabled": True,
        "stock_qty": int(product.stock_qty or 0),
        "stock_alert_level": int(product.stock_alert_level or 0),
    }


def products_blocked_by_recipe(session, tenant_id: int) -> set[int]:
    """Product ids that cannot be sold now: some recipe ingredient has less stock than one portion needs.

    Products without a recipe are never blocked (stock is not tracked for them).
    """
    from decimal import Decimal

    from sqlmodel import select

    from .inventory_models import InventoryItem, ProductRecipe
    from .inventory_service import convert_to_base_unit

    rows = session.exec(
        select(ProductRecipe, InventoryItem)
        .join(InventoryItem, InventoryItem.id == ProductRecipe.inventory_item_id)
        .where(ProductRecipe.tenant_id == tenant_id)
        .where(InventoryItem.is_deleted == False)  # noqa: E712
    ).all()
    blocked: set[int] = set()
    for recipe, item in rows:
        if recipe.product_id in blocked:
            continue
        try:
            per_portion = convert_to_base_unit(recipe.quantity_required, recipe.unit, item)
        except Exception:
            continue
        waste = Decimal(recipe.waste_percentage or 0) / Decimal(100)
        needed = per_portion * (Decimal(1) + waste)
        if Decimal(item.current_quantity or 0) < needed:
            blocked.add(recipe.product_id)
    return blocked
