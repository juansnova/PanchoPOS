"""
Default floor plan: 30 tables ("Mesa 1".."Mesa 30") in a 6 x 5 grid with generous gaps, plus Barra (take-away counter).
Runs on every start but only fills a tenant that has no tables yet (Barra alone counts as empty),
so tables, names and positions edited by the owner are never overwritten.

Usage:
  docker compose exec back python -m app.seeds.seed_default_tables
"""

from uuid import uuid4

from sqlalchemy import text
from sqlmodel import Session

from app.db import engine

FLOOR_NAME = "Planta 1"
COLUMNS, ROWS = 6, 5
SEATS = 4
SIZE = 80
# Canvas is 1200 x 800; positions are the table centres.
X0, DX = 150, 180
Y0, DY = 120, 140


def _floor_id(session, tenant_id: int) -> int:
    row = session.execute(
        text("SELECT id FROM floor WHERE tenant_id = :tid ORDER BY sort_order, id LIMIT 1"),
        {"tid": tenant_id},
    ).fetchone()
    if row:
        return row[0]
    return session.execute(
        text(
            "INSERT INTO floor (tenant_id, name, sort_order, is_active, seating_zone, created_at) "
            "VALUES (:tid, :name, 0, true, 'any', NOW()) RETURNING id"
        ),
        {"tid": tenant_id, "name": FLOOR_NAME},
    ).scalar_one()


def _insert(session, tenant_id, floor_id, name, x, y, shape, width, height, seats, active):
    session.execute(
        text(
            '''INSERT INTO "table" (tenant_id, name, token, floor_id, seat_count, x_position, y_position,
                                    rotation, shape, width, height, is_active)
               VALUES (:tid, :name, :token, :fid, :seats, :x, :y, 0, :shape, :w, :h, :active)'''
        ),
        {
            "tid": tenant_id, "name": name, "token": str(uuid4()), "fid": floor_id,
            "seats": seats, "x": x, "y": y, "shape": shape, "w": width, "h": height, "active": active,
        },
    )


def run() -> None:
    with Session(engine) as session:
        tenant_ids = [r[0] for r in session.execute(text("SELECT id FROM tenant ORDER BY id")).fetchall()]
        for tenant_id in tenant_ids:
            # The counter used to be called "Take Away"; same table, new name (orders keep pointing to it).
            session.execute(
                text('''UPDATE "table" SET name = 'Barra' WHERE tenant_id = :tid AND lower(trim(name)) = 'take away'
                        AND NOT EXISTS (SELECT 1 FROM "table" WHERE tenant_id = :tid AND lower(trim(name)) = 'barra')'''),
                {"tid": tenant_id},
            )
            session.commit()
            others = session.execute(
                text('''SELECT count(*) FROM "table" WHERE tenant_id = :tid AND lower(trim(name)) NOT IN ('barra', 'take away')'''),
                {"tid": tenant_id},
            ).scalar_one()
            if others:
                continue
            floor_id = _floor_id(session, tenant_id)
            for i in range(COLUMNS * ROWS):
                col, row = i % COLUMNS, i // COLUMNS
                _insert(session, tenant_id, floor_id, f"Mesa {i + 1}", X0 + col * DX, Y0 + row * DY,
                        "rectangle", SIZE, SIZE, SEATS, False)
            has_take_away = session.execute(
                text('''SELECT 1 FROM "table" WHERE tenant_id = :tid AND lower(trim(name)) IN ('barra', 'take away')'''),
                {"tid": tenant_id},
            ).fetchone()
            if not has_take_away:
                _insert(session, tenant_id, floor_id, "Barra", 600, 760, "bar", 160, 50, 2, True)
            session.commit()
            print(f"Tenant {tenant_id}: created {COLUMNS * ROWS} default tables ({COLUMNS}x{ROWS}).")


if __name__ == "__main__":
    run()
