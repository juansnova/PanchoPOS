"""
Seed default demo products for every tenant (including partial menus).
Idempotent: creates only DEMO_PRODUCTS names that are missing for that tenant;
does not delete or alter existing catalog/wine/beer/pizza rows.
Photos come from menu_images/ and are copied into uploads/ when missing.

Usage:
  docker compose exec back python -m app.seeds.seed_demo_products
  cd back && python -m app.seeds.seed_demo_products
"""

import re
import shutil
import unicodedata
from pathlib import Path

from sqlalchemy import text
from sqlmodel import Session

from app.db import engine
from app.models import Product, Tenant
from app.tenant_ui_modules import new_tenant_ui_modules_stored

# Default menu (Pancho Panza): name, price in COP pesos, category, description (optional)
_MENU_PESOS = [
    # Almuerzos
    ("Almuerzo Corriente", 18000, "Almuerzos", None),
    ("Almuerzo con Pollo Asado", 20000, "Almuerzos", None),
    ("Almuerzo con Broaster", 21000, "Almuerzos", None),
    ("Sopa", 6000, "Almuerzos", None),
    # Pollo Asado
    ("Pollo Asado Entero", 42000, "Pollo Asado", None),
    ("Pollo Asado Medio", 25000, "Pollo Asado", None),
    ("Pollo Asado Cuarto", 15000, "Pollo Asado", None),
    # Pollo Broaster
    ("Pollo Broaster Entero", 52000, "Pollo Broaster", None),
    ("Pollo Broaster Medio", 30000, "Pollo Broaster", None),
    ("Pollo Broaster Cuarto", 18000, "Pollo Broaster", None),
    # Pescados
    ("Cazuela de Mariscos", 45000, "Pescados", None),
    ("Trucha Marinera", 38000, "Pescados", None),
    ("Bagre en Salsa", 42000, "Pescados", None),
    ("Mojarra", 30000, "Pescados", None),
    # Carnes
    ("Churrasco", 36000, "Carnes", None),
    ("Carne Fresca", 30000, "Carnes", None),
    ("Carne Oreada", 34000, "Carnes", None),
    ("Sobrebarriga", 34000, "Carnes", None),
    ("Lomo de Cerdo", 27000, "Carnes", None),
    ("Chuleta de Cerdo", 28000, "Carnes", None),
    ("Pechuga a la Plancha", 27000, "Carnes", None),
    ("Mixto de Carnes", 37000, "Carnes", "Carne oreada, sobrebarriga y chorizo"),
    # Especiales
    ("Arroz con Pollo", 24000, "Especiales", None),
    ("Espaguetis con Pollo", 24000, "Especiales", None),
    ("Costillitas de Cerdo", 34000, "Especiales", "En salsa BBQ"),
    ("Alitas de Pollo", 28000, "Especiales", "8 piezas, Broaster o BBQ"),
    # Comidas rápidas
    ("Picada Pancho Panza", 45000, "Comidas Rápidas", "Para dos personas"),
    ("Perro Granjero", 24000, "Comidas Rápidas", "Salchicha americana, carne de res, pechuga, tocineta, maíz dulce, salsa tartara y papita francesa"),
    ("Hamburguesa Clásica", 19000, "Comidas Rápidas", "Carne de res, queso, tocineta, vegetales, salsa tartara y papita francesa"),
    ("Hamburguesa Pancho", 25000, "Comidas Rápidas", "Carne de res, queso, pechuga asada, tocineta, vegetales, salsa tartara y papita francesa"),
    ("Hamburguesa Ranchera", 27000, "Comidas Rápidas", "Carne de res, queso, pollo desmechado en salsa tartara de la casa, chorizo ranchero, vegetales y papita francesa"),
    ("Desgranado", 23000, "Comidas Rápidas", "Maíz dulce, carne de res, pechuga, lomo de cerdo, tocineta, salsa tartara y quesito fundido"),
    ("Papitas Pancho", 28000, "Comidas Rápidas", "Papita francesa, carne de res, pechuga, salchicha, tocineta, salsa tartara y quesito fundido"),
    ("Salchichoripapa", 22000, "Comidas Rápidas", None),
    ("Menú Infantil", 20000, "Comidas Rápidas", "Nuggets de pollo, acompañado de papitas francesa"),
    ("Porción Papa Francesa", 8000, "Comidas Rápidas", None),
    # Bebidas
    ("Jugo Natural en Leche", 10000, "Bebidas", None),
    ("Jugo Natural en Agua", 8000, "Bebidas", None),
    ("Granizada de Cereza", 10000, "Bebidas", None),
    ("Jugo Hit", 4500, "Bebidas", None),
    ("Gaseosa Personal", 4000, "Bebidas", None),
    ("Gaseosa Econolitro", 5500, "Bebidas", None),
    ("Gaseosa 1,5 Lt", 8500, "Bebidas", None),
    ("Gaseosa 3 Lt", 13000, "Bebidas", None),
    ("Agua Natural", 3000, "Bebidas", None),
    ("Agua Saborizada", 4000, "Bebidas", None),
    ("Electrolit", 11000, "Bebidas", None),
    ("Soda Hatsu", 5000, "Bebidas", None),
    ("Cola & Pola", 4000, "Bebidas", None),
    ("Águila Original", 4000, "Bebidas", None),
    ("Águila Light", 4000, "Bebidas", None),
    ("Poker", 4000, "Bebidas", None),
    ("Club Colombia", 5000, "Bebidas", None),
    ("Budweiser", 4500, "Bebidas", None),
    ("Coronita", 5000, "Bebidas", None),
]

# Brief descriptions for products listed above without one. Applied on create and, for
# existing products, only while their description is empty (owner edits are never overwritten).
_BRIEF_DESCRIPTIONS = {
    "Almuerzo Corriente": "Sopa, seco del día, jugo y postre",
    "Almuerzo con Pollo Asado": "Sopa, pollo asado con acompañantes y jugo",
    "Almuerzo con Broaster": "Sopa, pollo broaster con acompañantes y jugo",
    "Sopa": "Sopa del día",
    "Pollo Asado Entero": "Pollo asado entero con papa y arepa",
    "Pollo Asado Medio": "Medio pollo asado con papa y arepa",
    "Pollo Asado Cuarto": "Cuarto de pollo asado con papa y arepa",
    "Pollo Broaster Entero": "Pollo broaster entero, crocante, con papa",
    "Pollo Broaster Medio": "Medio pollo broaster crocante con papa",
    "Pollo Broaster Cuarto": "Cuarto de pollo broaster crocante con papa",
    "Cazuela de Mariscos": "Mariscos en salsa cremosa, con arroz",
    "Trucha Marinera": "Trucha frita en salsa marinera",
    "Bagre en Salsa": "Bagre guisado en salsa criolla",
    "Mojarra": "Mojarra frita con patacón y ensalada",
    "Churrasco": "Corte de res a la parrilla con acompañantes",
    "Carne Fresca": "Carne de res a la plancha con acompañantes",
    "Carne Oreada": "Carne oreada asada con acompañantes",
    "Sobrebarriga": "Sobrebarriga en salsa criolla con acompañantes",
    "Lomo de Cerdo": "Lomo de cerdo a la plancha con acompañantes",
    "Chuleta de Cerdo": "Chuleta de cerdo apanada con acompañantes",
    "Pechuga a la Plancha": "Pechuga de pollo a la plancha con acompañantes",
    "Arroz con Pollo": "Arroz con pollo y vegetales",
    "Espaguetis con Pollo": "Espaguetis con pollo en salsa cremosa",
    "Salchichoripapa": "Salchicha, chorizo y papa francesa",
    "Porción Papa Francesa": "Porción de papa a la francesa",
    "Jugo Natural en Leche": "Jugo de fruta natural preparado en leche",
    "Jugo Natural en Agua": "Jugo de fruta natural preparado en agua",
    "Granizada de Cereza": "Granizada fría con sabor a cereza",
    "Jugo Hit": "Jugo Hit de caja",
    "Gaseosa Personal": "Gaseosa en presentación personal",
    "Gaseosa Econolitro": "Gaseosa de litro",
    "Gaseosa 1,5 Lt": "Gaseosa de 1,5 litros",
    "Gaseosa 3 Lt": "Gaseosa de 3 litros",
    "Agua Natural": "Botella de agua natural",
    "Agua Saborizada": "Agua con sabor",
    "Electrolit": "Bebida hidratante con electrolitos",
    "Soda Hatsu": "Soda Hatsu con sabor",
    "Cola & Pola": "Mezcla de gaseosa cola y cerveza",
    "Águila Original": "Cerveza Águila Original",
    "Águila Light": "Cerveza Águila Light",
    "Poker": "Cerveza Poker",
    "Club Colombia": "Cerveza Club Colombia",
    "Budweiser": "Cerveza Budweiser",
    "Coronita": "Cerveza Coronita",
}

# Menu structure: the old flat categories are subcategories of three general ones.
#   old name -> (category, subcategory)
# "Main Course" is the standard category shown as "Platos Fuertes" (see _CATEGORY_LABELS).
_REGROUP = {
    "Almuerzos": ("Main Course", "Almuerzos"),
    "Carnes": ("Main Course", "Carnes"),
    "Pescados": ("Main Course", "Pescados"),
    "Especiales": ("Main Course", "Especiales"),
    "Pollo Asado": ("Pollos", "Pollo Asado"),
    "Pollo Broaster": ("Pollos", "Pollo Broaster"),
}
_CATEGORY_LABELS = {"Main Course": "Platos Fuertes"}

# "Comidas Rápidas" and "Bebidas" stay categories; their products are split into
# subcategories by name. Each entry: category names it may be stored under -> {name: subcategory}.
# (Bebidas is stored as the standard "Beverages", so both spellings are accepted.)
_FAST_FOOD_CATEGORY = "Comidas Rápidas"
_DRINK_SUBCATEGORY = {
    "Jugo Natural en Leche": "Jugos y Granizadas",
    "Jugo Natural en Agua": "Jugos y Granizadas",
    "Granizada de Cereza": "Jugos y Granizadas",
    "Jugo Hit": "Jugos y Granizadas",
    "Gaseosa Personal": "Gaseosas",
    "Gaseosa Econolitro": "Gaseosas",
    "Gaseosa 1,5 Lt": "Gaseosas",
    "Gaseosa 3 Lt": "Gaseosas",
    "Agua Natural": "Aguas e Hidratantes",
    "Agua Saborizada": "Aguas e Hidratantes",
    "Electrolit": "Aguas e Hidratantes",
    "Soda Hatsu": "Aguas e Hidratantes",
    "Águila Original": "Cervezas",
    "Águila Light": "Cervezas",
    "Poker": "Cervezas",
    "Club Colombia": "Cervezas",
    "Budweiser": "Cervezas",
    "Coronita": "Cervezas",
    "Cola & Pola": "Cervezas",
}
_FAST_FOOD_SUBCATEGORY = {
    "Hamburguesa Clásica": "Hamburguesas",
    "Hamburguesa Pancho": "Hamburguesas",
    "Hamburguesa Ranchera": "Hamburguesas",
    "Perro Granjero": "Perros",
    "Picada Pancho Panza": "Picadas y Papas",
    "Papitas Pancho": "Picadas y Papas",
    "Salchichoripapa": "Picadas y Papas",
    "Desgranado": "Picadas y Papas",
    "Porción Papa Francesa": "Picadas y Papas",
    "Menú Infantil": "Infantil",
}

_SUBCATEGORY_BY_NAME_GROUPS = [
    (("Comidas Rápidas",), _FAST_FOOD_SUBCATEGORY),
    (("Bebidas", "Beverages"), _DRINK_SUBCATEGORY),
]

# price_cents convention in this app: pesos * 100
# (name, price_cents, category, subcategory, description)
DEMO_PRODUCTS = [
    (
        n,
        pesos * 100,
        *(
            (c, _FAST_FOOD_SUBCATEGORY.get(n))
            if c == _FAST_FOOD_CATEGORY
            else (c, _DRINK_SUBCATEGORY.get(n))
            if c == "Bebidas"
            else _REGROUP.get(c, (c, None))
        ),
        d or _BRIEF_DESCRIPTIONS.get(n),
    )
    for n, pesos, c, d in _MENU_PESOS
]

# Photos live in menu_images/<slug>.jpg (credits in menu_images/CREDITS.md); they are
# copied into uploads/<tenant>/products/ so the app serves them. Products without a
# matching file simply have no image.
IMAGES_DIR = Path(__file__).parent / "menu_images"
UPLOADS_DIR = Path(__file__).parent.parent.parent / "uploads"


def _slug(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")


def _ensure_image(tenant_id: int, name: str) -> str | None:
    """Copy the product's photo into the tenant uploads dir; return its filename."""
    src = IMAGES_DIR / f"{_slug(name)}.jpg"
    if not src.is_file():
        return None
    filename = f"menu-{src.name}"
    dest_dir = UPLOADS_DIR / str(tenant_id) / "products"
    dest = dest_dir / filename
    if not dest.is_file():
        dest_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
    return filename


DEMO_PRODUCT_NAMES = [name for name, *_ in DEMO_PRODUCTS]


def _seed_tenant_products(session, tenant_id: int) -> int:
    """Create missing demo products for tenant. Returns number created."""
    result = session.execute(
        text("SELECT name FROM product WHERE tenant_id = :tid"),
        {"tid": tenant_id},
    )
    existing_names = {row[0] for row in result.fetchall()}
    created = 0
    # Attach photos to demo products that exist without one (e.g. seeded before photos).
    for name, *_ in DEMO_PRODUCTS:
        if name not in existing_names:
            continue
        filename = _ensure_image(tenant_id, name)
        if filename:
            session.execute(
                text(
                    "UPDATE product SET image_filename = :f "
                    "WHERE tenant_id = :tid AND name = :n AND image_filename IS NULL"
                ),
                {"f": filename, "tid": tenant_id, "n": name},
            )
    for name, price_cents, category, subcategory, description in DEMO_PRODUCTS:
        if name in existing_names:
            if description:
                session.execute(
                    text(
                        "UPDATE product SET description = :d "
                        "WHERE tenant_id = :tid AND name = :n "
                        "AND (description IS NULL OR description = '')"
                    ),
                    {"d": description, "tid": tenant_id, "n": name},
                )
            continue
        product = Product(
            tenant_id=tenant_id,
            name=name,
            price_cents=price_cents,
            category=category,
            subcategory=subcategory,
            ingredients=None,
            image_filename=_ensure_image(tenant_id, name),
            description=description,
        )
        session.add(product)
        created += 1
    return created


def _regroup_categories(session, tenant_id: int) -> int:
    """Move products still in an old flat category (e.g. "Carnes") under its general category.

    Idempotent: only touches rows whose category is one of the old names and that have no
    subcategory yet, so it also upgrades databases seeded before the regrouping.
    """
    moved = 0
    for old, (category, subcategory) in _REGROUP.items():
        result = session.execute(
            text(
                "UPDATE product SET category = :cat, subcategory = :sub "
                "WHERE tenant_id = :tid AND category = :old "
                "AND (subcategory IS NULL OR subcategory = '')"
            ),
            {"cat": category, "sub": subcategory, "old": old, "tid": tenant_id},
        )
        moved += result.rowcount or 0
    for categories, by_name in _SUBCATEGORY_BY_NAME_GROUPS:
        for name, subcategory in by_name.items():
            result = session.execute(
                text(
                    "UPDATE product SET subcategory = :sub "
                    "WHERE tenant_id = :tid AND category = ANY(:cats) AND name = :name "
                    "AND (subcategory IS NULL OR subcategory = '')"
                ),
                {"sub": subcategory, "cats": list(categories), "name": name, "tid": tenant_id},
            )
            moved += result.rowcount or 0
    return moved


def _ensure_category_labels(session, tenant_id: int) -> None:
    """Display names for standard categories (only when the owner has not chosen one)."""
    tenant = session.get(Tenant, tenant_id)
    if tenant is None:
        return
    labels = dict(tenant.custom_category_labels or {})
    changed = False
    for key, label in _CATEGORY_LABELS.items():
        if not labels.get(key):
            labels[key] = label
            changed = True
    if changed:
        tenant.custom_category_labels = labels
        session.add(tenant)


def _tenant_missing_demo_names(session, tenant_id: int) -> list[str]:
    """Return DEMO_PRODUCTS names not yet present for the tenant."""
    result = session.execute(
        text("SELECT name FROM product WHERE tenant_id = :tid"),
        {"tid": tenant_id},
    )
    existing_names = {row[0] for row in result.fetchall()}
    return [name for name in DEMO_PRODUCT_NAMES if name not in existing_names]


DEFAULT_ADDRESS = "Calle 10 N° 11-04, Segundo Piso, Barrio El Centro, San Vicente de Chucurí, Santander."
FIXED_CITY = "San Vicente de Chucurí"
# Issuer defaults for Colombian electronic invoicing (from the RUT). Only applied while empty:
# the admin can change them in Settings > Facturación electrónica.
DEFAULT_NIT = "63508103"  # without check digit; the DV (1) is computed in Settings
DEFAULT_DIAN_TAX_REGIME = "no_responsable_iva"  # RUT responsibility 49


def _ensure_location(session: Session, tenant_id: int) -> None:
    """Default address (only when empty: it stays editable) and fixed city for the single restaurant."""
    tenant = session.get(Tenant, tenant_id)
    if tenant is None:
        return
    changed = False
    if not (tenant.address or "").strip():
        tenant.address = DEFAULT_ADDRESS
        changed = True
    if tenant.city != FIXED_CITY:
        tenant.city = FIXED_CITY
        changed = True
    if not (tenant.tax_id or "").strip():
        tenant.tax_id = DEFAULT_NIT
        changed = True
    if not (tenant.dian_tax_regime or "").strip():
        tenant.dian_tax_regime = DEFAULT_DIAN_TAX_REGIME
        changed = True
    if changed:
        session.add(tenant)


def run() -> None:
    with Session(engine) as session:
        result = session.execute(text("SELECT id FROM tenant ORDER BY id"))
        tenant_ids = [row[0] for row in result.fetchall()]
        if not tenant_ids:
            # Fresh install without config.env (no default admin): create the single
            # restaurant so the menu exists before the owner registers (register() reuses it).
            tenant = Tenant(
                name="Pancho Panza",
                address=DEFAULT_ADDRESS,
                city=FIXED_CITY,
                ui_modules=new_tenant_ui_modules_stored(),
            )
            session.add(tenant)
            session.commit()
            session.refresh(tenant)
            tenant_ids = [tenant.id]
            print(f"Created tenant id={tenant.id} (Pancho Panza).")

        # Repair every tenant: create missing DEMO_PRODUCTS names and attach photos to
        # demo products that lack one. Idempotent; never deletes existing products.
        for tenant_id in tenant_ids:
            _ensure_location(session, tenant_id)
            created = _seed_tenant_products(session, tenant_id)
            moved = _regroup_categories(session, tenant_id)
            _ensure_category_labels(session, tenant_id)
            session.commit()
            if created:
                print(f"Tenant {tenant_id}: created {created} demo products.")
            if moved:
                print(f"Tenant {tenant_id}: regrouped {moved} products into subcategories.")

    print("Done.")


if __name__ == "__main__":
    run()
