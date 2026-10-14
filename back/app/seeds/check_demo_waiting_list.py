"""
Check that tenant 1 has demo waiting-list entries.

Exits 0 when tenant 1 has at least MIN_WAITING waiting and MIN_NOTIFIED
notified rows (matching seed_demo_waiting_list mix); exits 1 otherwise.
Use after seed_demo_waiting_list or reset_demo_data.

Usage:
  cd back && python -m app.seeds.check_demo_waiting_list
  docker compose exec back python -m app.seeds.check_demo_waiting_list
"""

import sys

from sqlalchemy import text
from sqlmodel import Session

from app.db import engine
from app.models import WaitingListStatus

DEMO_TENANT_ID = 1
# Seed creates 3 waiting + 1 notified; assert ≥1 each so a regression that
# skips waiting-list seeding (or only one status) fails the check.
MIN_WAITING = 1
MIN_NOTIFIED = 1


def run() -> int:
    waiting_status = WaitingListStatus.waiting.value
    notified_status = WaitingListStatus.notified.value
    with Session(engine) as session:
        row = session.execute(
            text(
                "SELECT "
                "COUNT(*) FILTER (WHERE status = :waiting), "
                "COUNT(*) FILTER (WHERE status = :notified), "
                "COUNT(*) "
                "FROM waiting_list_entry "
                "WHERE tenant_id = :tid"
            ),
            {
                "tid": DEMO_TENANT_ID,
                "waiting": waiting_status,
                "notified": notified_status,
            },
        ).one()
        waiting_n = int(row[0] or 0)
        notified_n = int(row[1] or 0)
        total = int(row[2] or 0)

    ok = waiting_n >= MIN_WAITING and notified_n >= MIN_NOTIFIED
    if not ok:
        print(
            f"Missing demo waiting-list entries for tenant {DEMO_TENANT_ID}: "
            f"waiting={waiting_n} (need ≥{MIN_WAITING}), "
            f"notified={notified_n} (need ≥{MIN_NOTIFIED}), "
            f"total={total}. "
            "Run: python -m app.seeds.reset_demo_data "
            "(or seed_demo_waiting_list when tenant 1 has no waiting-list rows)."
        )
        return 1

    print(
        f"OK: tenant {DEMO_TENANT_ID} has {waiting_n} waiting, "
        f"{notified_n} notified waiting-list entr{'y' if total == 1 else 'ies'} "
        f"(total={total})."
    )
    return 0


if __name__ == "__main__":
    sys.exit(run())
