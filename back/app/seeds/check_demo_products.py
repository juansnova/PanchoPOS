"""
Check that demo products exist for tenant 1.

Exits 0 if tenant 1 has every name in DEMO_PRODUCTS (seed_demo_products);
exits 1 otherwise. Extra catalog/import products are allowed. Use after
seed_demo_products or to verify DB state.

Usage:
  cd back && python -m app.seeds.check_demo_products
  docker compose exec back python -m app.seeds.check_demo_products
"""

import sys

from sqlalchemy import text
from sqlmodel import Session

from app.db import engine
from app.seeds.seed_demo_products import DEMO_PRODUCT_NAMES

DEMO_TENANT_ID = 1


def run() -> int:
    with Session(engine) as session:
        result = session.execute(
            text("SELECT name FROM product WHERE tenant_id = :tid"),
            {"tid": DEMO_TENANT_ID},
        )
        names = {row[0] for row in result.fetchall()}

    missing = [name for name in DEMO_PRODUCT_NAMES if name not in names]
    if missing:
        print(f"Missing demo products for tenant {DEMO_TENANT_ID}: {missing}")
        return 1
    print(
        f"OK: tenant {DEMO_TENANT_ID} has all {len(DEMO_PRODUCT_NAMES)} demo products "
        f"({len(names)} total products)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(run())
