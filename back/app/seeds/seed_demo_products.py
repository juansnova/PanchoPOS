"""
Seed default demo products for every tenant (including partial menus).
Idempotent: creates only DEMO_PRODUCTS names that are missing for that tenant;
does not delete or alter existing catalog/wine/beer/pizza rows.
No image filenames so it works on any new deployment.

Usage:
  docker compose exec back python -m app.seeds.seed_demo_products
  cd back && python -m app.seeds.seed_demo_products
"""

from sqlalchemy import text
from sqlmodel import Session

from app.db import engine
from app.models import Product

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
# price_cents convention in this app: pesos * 100
DEMO_PRODUCTS = [(n, pesos * 100, c, d) for n, pesos, c, d in _MENU_PESOS]

DEMO_PRODUCT_NAMES = [name for name, *_ in DEMO_PRODUCTS]


def _seed_tenant_products(session, tenant_id: int) -> int:
    """Create missing demo products for tenant. Returns number created."""
    result = session.execute(
        text("SELECT name FROM product WHERE tenant_id = :tid"),
        {"tid": tenant_id},
    )
    existing_names = {row[0] for row in result.fetchall()}
    created = 0
    for name, price_cents, category, description in DEMO_PRODUCTS:
        if name in existing_names:
            continue
        product = Product(
            tenant_id=tenant_id,
            name=name,
            price_cents=price_cents,
            category=category,
            ingredients=None,
            image_filename=None,
            description=description,
        )
        session.add(product)
        created += 1
    return created


def _tenant_missing_demo_names(session, tenant_id: int) -> list[str]:
    """Return DEMO_PRODUCTS names not yet present for the tenant."""
    result = session.execute(
        text("SELECT name FROM product WHERE tenant_id = :tid"),
        {"tid": tenant_id},
    )
    existing_names = {row[0] for row in result.fetchall()}
    return [name for name in DEMO_PRODUCT_NAMES if name not in existing_names]


def run() -> None:
    with Session(engine) as session:
        result = session.execute(text("SELECT id FROM tenant ORDER BY id"))
        tenant_ids = [row[0] for row in result.fetchall()]
        if not tenant_ids:
            print("No tenants found.")
            return

        # Repair every tenant: empty and partial menus (create missing DEMO_PRODUCTS
        # names only). Idempotent; never deletes existing products.
        any_created = False
        for tenant_id in tenant_ids:
            missing = _tenant_missing_demo_names(session, tenant_id)
            if not missing:
                continue
            created = _seed_tenant_products(session, tenant_id)
            if created:
                session.commit()
                any_created = True
                print(f"Tenant {tenant_id}: created {created} demo products.")

        if not any_created:
            print("All tenants already have the full demo product set. Nothing to seed.")

    print("Done.")


if __name__ == "__main__":
    run()
