"""
Ensure a default owner (admin) user exists. Idempotent; never overwrites an existing user.

Reads DEFAULT_ADMIN_USERNAME / DEFAULT_ADMIN_PASSWORD from the environment, falling back to
/app/config.env. Does nothing if either is unset. Creates tenant "Pancho Panza" if none exists.
Runs on every `docker compose up` (see docker-compose.yml, back.command).

Manual: docker compose exec -T back python -m app.seeds.ensure_default_admin
"""

import os
from pathlib import Path

from sqlmodel import Session, select

from app.db import engine
from app.models import Tenant, User, UserRole
from app.security import get_password_hash

CONFIG_ENV = Path("/app/config.env")


def _setting(name: str) -> str:
    value = os.environ.get(name, "")
    if value or not CONFIG_ENV.is_file():
        return value
    for line in CONFIG_ENV.read_text(encoding="utf-8").splitlines():
        key, sep, val = line.partition("=")
        if sep and key.strip() == name:
            return val.strip().strip("'\"")
    return ""


def run() -> None:
    username = _setting("DEFAULT_ADMIN_USERNAME")
    password = _setting("DEFAULT_ADMIN_PASSWORD")
    if not username or not password:
        print("DEFAULT_ADMIN_USERNAME/PASSWORD not set. Skipping default admin.")
        return
    with Session(engine) as session:
        if session.exec(select(User).where(User.username == username)).first():
            print(f"Default admin '{username}' already exists.")
            return
        tenant = session.exec(select(Tenant).order_by(Tenant.id)).first()
        if not tenant:
            tenant = Tenant(name="Pancho Panza")
            session.add(tenant)
            session.commit()
            session.refresh(tenant)
        session.add(
            User(
                username=username,
                hashed_password=get_password_hash(password),
                full_name="Admin",
                role=UserRole.owner,
                tenant_id=tenant.id,
            )
        )
        session.commit()
        print(f"Created default admin '{username}' (owner, tenant {tenant.id}).")


if __name__ == "__main__":
    run()
