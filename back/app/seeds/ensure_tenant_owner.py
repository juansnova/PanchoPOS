"""
Ensure a given user in a tenant has the owner role.

Usage (from repo root, with backend in Docker):
  docker compose exec back python -m app.seeds.ensure_tenant_owner

Required env:
  USER_USERNAME             Username of the account to promote
Optional env:
  TENANT_ID=1               (default)
"""

import os
import sys

from sqlmodel import Session, select

from app.db import engine
from app.models import User, UserRole


def run() -> None:
    username = os.environ.get("USER_USERNAME", "").strip()
    if not username:
        print("USER_USERNAME must be set.", file=sys.stderr)
        sys.exit(1)
    try:
        tenant_id = int(os.environ.get("TENANT_ID", "1"))
    except ValueError:
        tenant_id = 1

    with Session(engine) as session:
        user = session.exec(
            select(User).where(User.username == username).where(User.tenant_id == tenant_id)
        ).first()
        if not user:
            print(
                f"User not found: username={username}, tenant_id={tenant_id}.",
                file=sys.stderr,
            )
            sys.exit(1)
        if user.role == UserRole.owner:
            print(f"OK: {username} (tenant_id={tenant_id}) already has role owner.")
            return
        user.role = UserRole.owner
        session.add(user)
        session.commit()
        print(f"Updated: {username} (tenant_id={tenant_id}) set to role owner.")


if __name__ == "__main__":
    run()
