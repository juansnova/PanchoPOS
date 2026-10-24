"""
One-off: lay out "Mesa 1".."Mesa 30" in the default 6 x 5 grid, keeping the tables that already exist
(same ids, so orders and tokens stay linked) and creating the missing ones. Tables with other names
are left untouched. Run it by hand; it never runs on startup.

Usage:
  docker compose exec back python -m app.seeds.arrange_tables_grid
"""

from sqlalchemy import text
from sqlmodel import Session

from app.db import engine
from app.seeds import seed_default_tables as d


def run() -> None:
    with Session(engine) as session:
        for (tenant_id,) in session.execute(text("SELECT id FROM tenant ORDER BY id")).fetchall():
            floor_id = d._floor_id(session, tenant_id)
            existing = {
                r[1].strip().lower(): r[0]
                for r in session.execute(
                    text('SELECT id, name FROM "table" WHERE tenant_id = :t'), {"t": tenant_id}
                ).fetchall()
            }
            for i in range(d.COLUMNS * d.ROWS):
                name = f"Mesa {i + 1}"
                x, y = d.X0 + (i % d.COLUMNS) * d.DX, d.Y0 + (i // d.COLUMNS) * d.DY
                table_id = existing.get(name.lower())
                if table_id:
                    session.execute(
                        text('UPDATE "table" SET x_position = :x, y_position = :y, floor_id = :f WHERE id = :i'),
                        {"x": x, "y": y, "f": floor_id, "i": table_id},
                    )
                else:
                    d._insert(session, tenant_id, floor_id, name, x, y, "rectangle", d.SIZE, d.SIZE, d.SEATS, False)
            session.execute(
                text('''UPDATE "table" SET x_position = 600, y_position = 760
                        WHERE tenant_id = :t AND lower(trim(name)) IN ('barra', 'take away')'''),
                {"t": tenant_id},
            )
            session.commit()
            print(f"Tenant {tenant_id}: {d.COLUMNS * d.ROWS} tables laid out in a {d.COLUMNS}x{d.ROWS} grid.")


if __name__ == "__main__":
    run()
