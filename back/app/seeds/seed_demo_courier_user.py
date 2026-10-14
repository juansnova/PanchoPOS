"""
Ensure tenant 1 has one courier-role user for Satisfecho Delivery / courier demos.

Idempotent: if any courier already exists on tenant 1, does nothing. Otherwise
creates (or promotes) the demo courier using COURIER_USERNAME / COURIER_PASSWORD
(defaults match front/scripts/test-courier-actions.mjs). Does not create couriers
on other tenants. Does not delete users.

Usage:
  docker compose exec back python -m app.seeds.seed_demo_courier_user
  cd back && python -m app.seeds.seed_demo_courier_user

Env (optional):
  COURIER_USERNAME    Default courier-test-phase1
  COURIER_PASSWORD    Default secret
"""

import os
import sys

from sqlmodel import Session, select

from app import security
from app.db import engine
from app.models import Tenant, User, UserRole

DEMO_TENANT_ID = 1
DEFAULT_COURIER_USERNAME = "courier-test-phase1"
DEFAULT_COURIER_PASSWORD = "secret"
DEFAULT_FULL_NAME = "Demo Courier"


def _demo_credentials() -> tuple[str, str]:
    username = os.environ.get("COURIER_USERNAME", DEFAULT_COURIER_USERNAME).strip()
    password = os.environ.get("COURIER_PASSWORD", DEFAULT_COURIER_PASSWORD).strip()
    return username, password


def run() -> None:
    username, password = _demo_credentials()
    if not username or not password:
        print(
            "COURIER_USERNAME and COURIER_PASSWORD must be non-empty.",
            file=sys.stderr,
        )
        sys.exit(1)

    with Session(engine) as session:
        tenant = session.get(Tenant, DEMO_TENANT_ID)
        if not tenant:
            print("Tenant 1 not found. Run bootstrap_demo first.")
            return

        existing_courier = session.exec(
            select(User)
            .where(User.tenant_id == DEMO_TENANT_ID, User.role == UserRole.courier)
            .limit(1)
        ).first()
        if existing_courier is not None:
            print(
                f"Tenant {DEMO_TENANT_ID} already has courier "
                f"id={existing_courier.id} ({existing_courier.username}). Skipping."
            )
            return

        hashed = security.get_password_hash(password)
        user = session.exec(select(User).where(User.username == username)).first()
        if user is not None:
            if user.tenant_id != DEMO_TENANT_ID:
                print(
                    f"Username {username} already belongs to tenant_id={user.tenant_id}; "
                    f"cannot create demo courier for tenant {DEMO_TENANT_ID}. "
                    "Set COURIER_USERNAME to an unused username.",
                    file=sys.stderr,
                )
                sys.exit(1)
            user.role = UserRole.courier
            user.hashed_password = hashed
            if not user.full_name:
                user.full_name = DEFAULT_FULL_NAME
            session.add(user)
            session.commit()
            print(
                f"Tenant {DEMO_TENANT_ID}: promoted {username} to role courier "
                f"(id={user.id})."
            )
            return

        user = User(
            username=username,
            hashed_password=hashed,
            full_name=DEFAULT_FULL_NAME,
            role=UserRole.courier,
            tenant_id=DEMO_TENANT_ID,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        print(
            f"Tenant {DEMO_TENANT_ID}: created courier {username} (id={user.id})."
        )


if __name__ == "__main__":
    run()
