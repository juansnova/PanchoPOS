"""
Category and subcategory code definitions for internationalization.

Categories and subcategories use codes instead of strings to support
multiple languages. The frontend can map these codes to localized labels.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from sqlmodel import Session, select

logger = logging.getLogger(__name__)

# Main category codes
CATEGORY_CODES = {
    "STARTERS": "Starters",
    "MAIN_COURSE": "Main Course",
    "DESSERTS": "Desserts",
    "BEVERAGES": "Beverages",
    "SIDES": "Sides",
}

# Subcategory codes for each main category
SUBCATEGORY_CODES = {
    "STARTERS": {
        "APPETIZERS": "Appetizers",
        "SALADS": "Salads",
        "SOUPS": "Soups",
        "BREAD_DIPS": "Bread & Dips",
    },
    "MAIN_COURSE": {
        "MEAT": "Meat",
        "FISH": "Fish",
        "POULTRY": "Poultry",
        "VEGETARIAN": "Vegetarian",
        "VEGAN": "Vegan",
        "PASTA": "Pasta",
        "RICE": "Rice",
        "PIZZA": "Pizza",
    },
    "DESSERTS": {
        "CAKES": "Cakes",
        "ICE_CREAM": "Ice Cream",
        "FRUIT": "Fruit",
        "CHEESE": "Cheese",
    },
    "BEVERAGES": {
        "HOT_DRINKS": "Hot Drinks",
        "COLD_DRINKS": "Cold Drinks",
        "ALCOHOLIC": "Alcoholic",
        "NON_ALCOHOLIC": "Non-Alcoholic",
        "WINE": "Wine",
        "BEER": "Beer",
        "COCKTAILS": "Cocktails",
        "SOFT_DRINKS": "Soft Drinks",
        # Wine subcategories
        "WINE_RED": "Red Wine",
        "WINE_WHITE": "White Wine",
        "WINE_SPARKLING": "Sparkling Wine",
        "WINE_ROSE": "Rosé Wine",
        "WINE_SWEET": "Sweet Wine",
        "WINE_FORTIFIED": "Fortified Wine",
        "WINE_BY_GLASS": "Wine by Glass",
    },
    "SIDES": {
        "VEGETABLES": "Vegetables",
        "POTATOES": "Potatoes",
        "RICE": "Rice",
        "BREAD": "Bread",
    },
}

# Reverse mapping: string -> code
CATEGORY_STRING_TO_CODE = {v: k for k, v in CATEGORY_CODES.items()}

# i18n key -> CATEGORY_CODES key (PRODUCTS.CATEGORY_* in front/public/i18n/*.json)
_I18N_CATEGORY_KEYS: tuple[tuple[str, str], ...] = (
    ("CATEGORY_STARTERS", "STARTERS"),
    ("CATEGORY_MAIN_COURSE", "MAIN_COURSE"),
    ("CATEGORY_DESSERTS", "DESSERTS"),
    ("CATEGORY_BEVERAGES", "BEVERAGES"),
    ("CATEGORY_SIDES", "SIDES"),
)

# Baked-in locale labels when front/i18n is not mounted (e.g. back-only Docker).
_FALLBACK_CATEGORY_ALIASES: dict[str, str] = {
    # en (canonical)
    "Starters": "Starters",
    "Main Course": "Main Course",
    "Desserts": "Desserts",
    "Beverages": "Beverages",
    "Sides": "Sides",
    # es
    "Entrantes": "Starters",
    "Plato principal": "Main Course",
    "Postres": "Desserts",
    "Bebidas": "Beverages",
    "Guarniciones": "Sides",
    # ca
    "Entrants": "Starters",
    "Plat principal": "Main Course",
    "Begudes": "Beverages",
    "Amanida / Acompanyaments": "Sides",
    # de
    "Vorspeisen": "Starters",
    "Hauptgericht": "Main Course",
    "Getränke": "Beverages",
    "Beilagen": "Sides",
    # fr
    "Entrées": "Starters",
    "Boissons": "Beverages",
    "Accompagnements": "Sides",
    # bg
    "ПРЕДЯСТИЯ": "Starters",
    "Основно ястие": "Main Course",
    "Десерти": "Desserts",
    "Напитки": "Beverages",
    "страни": "Sides",
    # hi
    "स्टार्टर": "Starters",
    "मुख्य व्यंजन": "Main Course",
    "डेज़र्ट": "Desserts",
    "पेय": "Beverages",
    "साइड डिश": "Sides",
    # ur
    "اسٹارٹرز": "Starters",
    "اہم کورس": "Main Course",
    "میٹھے": "Desserts",
    "مشروبات": "Beverages",
    "سائیڈز": "Sides",
    # zh-CN
    "开胃菜": "Starters",
    "主菜": "Main Course",
    "甜点": "Desserts",
    "饮料": "Beverages",
    "配菜": "Sides",
}

_CATEGORY_ALIAS_TO_CANONICAL: dict[str, str] | None = None


def _repo_i18n_dir() -> Path | None:
    root = Path(__file__).resolve().parents[2]
    directory = root / "front" / "public" / "i18n"
    return directory if directory.is_dir() else None


def _load_aliases_from_i18n_files() -> dict[str, str]:
    out: dict[str, str] = {}
    directory = _repo_i18n_dir()
    if not directory:
        return out
    for path in sorted(directory.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Skipping i18n file %s: %s", path.name, exc)
            continue
        products = data.get("PRODUCTS")
        if not isinstance(products, dict):
            continue
        for i18n_key, code_key in _I18N_CATEGORY_KEYS:
            label = products.get(i18n_key)
            if not isinstance(label, str):
                continue
            stripped = label.strip()
            if not stripped:
                continue
            out[stripped] = CATEGORY_CODES[code_key]
    return out


def get_category_alias_to_canonical() -> dict[str, str]:
    """Map translated or legacy category labels to canonical English."""
    global _CATEGORY_ALIAS_TO_CANONICAL
    if _CATEGORY_ALIAS_TO_CANONICAL is not None:
        return _CATEGORY_ALIAS_TO_CANONICAL
    merged = dict(_FALLBACK_CATEGORY_ALIASES)
    merged.update(_load_aliases_from_i18n_files())
    for canonical in CATEGORY_CODES.values():
        merged[canonical] = canonical
    _CATEGORY_ALIAS_TO_CANONICAL = merged
    return merged


_CATEGORY_DISPLAY_BY_LOCALE: dict[str, dict[str, str]] | None = None


def _normalize_public_menu_lang(lang: str) -> str:
    """Map API lang to a front/public/i18n filename stem."""
    raw = (lang or "en").strip().replace("_", "-")
    lower = raw.lower()
    if lower.startswith("zh"):
        return "zh-CN"
    if lower.startswith("ca"):
        return "ca"
    return lower.split("-")[0] or "en"


_BUILTIN_CATEGORY_DISPLAY: dict[str, dict[str, str]] = {
    "en": {v: v for v in CATEGORY_CODES.values()},
    "es": {
        "Starters": "Entrantes",
        "Main Course": "Plato principal",
        "Desserts": "Postres",
        "Beverages": "Bebidas",
        "Sides": "Guarniciones",
    },
    "ca": {
        "Starters": "Entrants",
        "Main Course": "Plat principal",
        "Desserts": "Postres",
        "Beverages": "Begudes",
        "Sides": "Amanida / Acompanyaments",
    },
    "de": {
        "Starters": "Vorspeisen",
        "Main Course": "Hauptgericht",
        "Desserts": "Desserts",
        "Beverages": "Getränke",
        "Sides": "Beilagen",
    },
    "fr": {
        "Starters": "Entrées",
        "Main Course": "Plat principal",
        "Desserts": "Desserts",
        "Beverages": "Boissons",
        "Sides": "Accompagnements",
    },
}


def _load_category_display_by_locale() -> dict[str, dict[str, str]]:
    """Canonical English category -> localized label per locale."""
    out: dict[str, dict[str, str]] = {
        locale: dict(labels) for locale, labels in _BUILTIN_CATEGORY_DISPLAY.items()
    }
    directory = _repo_i18n_dir()
    if directory:
        for path in sorted(directory.glob("*.json")):
            locale = path.stem
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("Skipping i18n file %s: %s", path.name, exc)
                continue
            products = data.get("PRODUCTS")
            if not isinstance(products, dict):
                continue
            labels: dict[str, str] = dict(out.get(locale, {}))
            for i18n_key, code_key in _I18N_CATEGORY_KEYS:
                label = products.get(i18n_key)
                if not isinstance(label, str):
                    continue
                stripped = label.strip()
                if not stripped:
                    continue
                labels[CATEGORY_CODES[code_key]] = stripped
            if labels:
                out[locale] = labels
    return out


def get_category_display_by_locale() -> dict[str, dict[str, str]]:
    global _CATEGORY_DISPLAY_BY_LOCALE
    if _CATEGORY_DISPLAY_BY_LOCALE is None:
        _CATEGORY_DISPLAY_BY_LOCALE = _load_category_display_by_locale()
    return _CATEGORY_DISPLAY_BY_LOCALE


def get_public_category_display_label(category: str | None, lang: str = "en") -> str:
    """
    Localized menu section title for public APIs when grouping by category (no subcategory).
    Unknown categories are returned stripped as-is.
    """
    if category is None:
        return "Other"
    stripped = category.strip()
    if not stripped:
        return "Other"
    canonical = normalize_product_category(stripped) or stripped
    locale = _normalize_public_menu_lang(lang)
    labels = get_category_display_by_locale()
    if locale in labels and canonical in labels[locale]:
        return labels[locale][canonical]
    if canonical in CATEGORY_CODES.values():
        return labels.get("en", {}).get(canonical, canonical)
    return stripped


def normalize_product_category(category: str | None) -> str | None:
    """
    Return canonical English for known standard categories; otherwise strip and return as-is.
    None/blank input becomes None.
    """
    if category is None:
        return None
    stripped = category.strip()
    if not stripped:
        return None
    return get_category_alias_to_canonical().get(stripped, stripped)


def collapse_category_map_keys(
    merged: dict[str, list[str]] | dict[str, set[str]],
) -> dict[str, list[str]]:
    """Merge subcategory lists when multiple keys normalize to the same canonical category."""
    collapsed: dict[str, set[str]] = {}
    for category, subs in merged.items():
        cat = (category or "").strip()
        if not cat:
            continue
        norm = normalize_product_category(cat) or cat
        if norm not in collapsed:
            collapsed[norm] = set()
        if isinstance(subs, (list, set, tuple)):
            for sub in subs:
                name = (str(sub) if sub is not None else "").strip()
                if name:
                    collapsed[norm].add(name)
    return {cat: sorted(subs) for cat, subs in sorted(collapsed.items())}


def repair_stored_category_aliases(session: Session) -> dict[str, int]:
    """
    Idempotent repair: Product.category and tenant.custom_subcategories keys.
    """
    from . import models

    products_updated = 0
    tenants_updated = 0

    for product in session.exec(select(models.Product)).all():
        if not product.category:
            continue
        normalized = normalize_product_category(product.category)
        if normalized and normalized != product.category:
            product.category = normalized
            session.add(product)
            products_updated += 1

    for tenant in session.exec(select(models.Tenant)).all():
        stored = tenant.custom_subcategories
        if not stored or not isinstance(stored, dict):
            continue
        rebuilt: dict[str, list[str]] = {}
        changed = False
        for category, names in stored.items():
            norm = normalize_product_category(str(category)) or str(category).strip()
            if norm != str(category).strip():
                changed = True
            if not isinstance(names, list):
                continue
            existing = set(rebuilt.get(norm, []))
            items: list[str] = list(rebuilt.get(norm, []))
            for raw in names:
                name = (str(raw) if raw is not None else "").strip()
                if not name or name in existing:
                    continue
                existing.add(name)
                items.append(name)
            if items:
                rebuilt[norm] = sorted(items)
        if changed:
            tenant.custom_subcategories = rebuilt or None
            session.add(tenant)
            tenants_updated += 1

    if products_updated or tenants_updated:
        session.commit()
    return {"products_updated": products_updated, "tenants_updated": tenants_updated}

SUBCATEGORY_STRING_TO_CODE = {}
for main_cat_code, subcats in SUBCATEGORY_CODES.items():
    for code, string in subcats.items():
        SUBCATEGORY_STRING_TO_CODE[string] = code


def get_category_code(category_string: str | None) -> str | None:
    """Convert category string to code."""
    if not category_string:
        return None
    return CATEGORY_STRING_TO_CODE.get(category_string)


def get_subcategory_code(subcategory_string: str | None) -> str | None:
    """Convert subcategory string to code."""
    if not subcategory_string:
        return None
    return SUBCATEGORY_STRING_TO_CODE.get(subcategory_string)


def extract_wine_type_code(subcategory_string: str | None) -> str | None:
    """
    Extract wine type code from subcategory string.
    Handles formats like "Red Wine - D.O. Empordà - Wine by Glass"
    """
    if not subcategory_string:
        return None
    
    # Extract first part (wine type)
    parts = subcategory_string.split(" - ")
    wine_type = parts[0].strip()
    
    # Map to code
    if wine_type == "Red Wine":
        return "WINE_RED"
    elif wine_type == "White Wine":
        return "WINE_WHITE"
    elif wine_type == "Sparkling Wine":
        return "WINE_SPARKLING"
    elif wine_type == "Rosé Wine":
        return "WINE_ROSE"
    elif wine_type == "Sweet Wine":
        return "WINE_SWEET"
    elif wine_type == "Fortified Wine":
        return "WINE_FORTIFIED"
    
    return None


def extract_wine_by_glass_code(subcategory_string: str | None) -> str | None:
    """Check if subcategory contains 'Wine by Glass'."""
    if subcategory_string and "Wine by Glass" in subcategory_string:
        return "WINE_BY_GLASS"
    return None


def get_all_subcategory_codes(subcategory_string: str | None) -> list[str]:
    """
    Extract all subcategory codes from a subcategory string.
    Returns list of codes (e.g., ["WINE_RED", "WINE_BY_GLASS"])
    """
    if not subcategory_string:
        return []
    
    codes = []
    
    # Extract wine type code
    wine_type_code = extract_wine_type_code(subcategory_string)
    if wine_type_code:
        codes.append(wine_type_code)
    
    # Check for Wine by Glass
    wine_by_glass_code = extract_wine_by_glass_code(subcategory_string)
    if wine_by_glass_code:
        codes.append(wine_by_glass_code)
    
    # Check for other subcategory codes (non-wine)
    # Map common subcategory strings to codes
    subcat_lower = subcategory_string.lower()
    if "appetizers" in subcat_lower or subcategory_string == "Appetizers":
        codes.append("APPETIZERS")
    elif "salads" in subcat_lower or subcategory_string == "Salads":
        codes.append("SALADS")
    elif "soups" in subcat_lower or subcategory_string == "Soups":
        codes.append("SOUPS")
    elif "bread" in subcat_lower and "dips" in subcat_lower:
        codes.append("BREAD_DIPS")
    elif subcategory_string == "Meat":
        codes.append("MEAT")
    elif subcategory_string == "Fish":
        codes.append("FISH")
    elif subcategory_string == "Poultry":
        codes.append("POULTRY")
    elif subcategory_string == "Vegetarian":
        codes.append("VEGETARIAN")
    elif subcategory_string == "Vegan":
        codes.append("VEGAN")
    elif subcategory_string == "Pasta":
        codes.append("PASTA")
    elif subcategory_string == "Rice":
        codes.append("RICE")
    elif subcategory_string == "Pizza":
        codes.append("PIZZA")
    elif subcategory_string == "Cakes":
        codes.append("CAKES")
    elif subcategory_string == "Ice Cream":
        codes.append("ICE_CREAM")
    elif subcategory_string == "Fruit":
        codes.append("FRUIT")
    elif subcategory_string == "Cheese":
        codes.append("CHEESE")
    elif subcategory_string == "Hot Drinks":
        codes.append("HOT_DRINKS")
    elif subcategory_string == "Cold Drinks":
        codes.append("COLD_DRINKS")
    elif subcategory_string == "Alcoholic":
        codes.append("ALCOHOLIC")
    elif subcategory_string == "Non-Alcoholic":
        codes.append("NON_ALCOHOLIC")
    elif subcategory_string == "Beer":
        codes.append("BEER")
    elif subcategory_string == "Cocktails":
        codes.append("COCKTAILS")
    elif subcategory_string == "Soft Drinks":
        codes.append("SOFT_DRINKS")
    elif subcategory_string == "Vegetables":
        codes.append("VEGETABLES")
    elif subcategory_string == "Potatoes":
        codes.append("POTATOES")
    elif subcategory_string == "Bread":
        codes.append("BREAD")
    
    return codes
