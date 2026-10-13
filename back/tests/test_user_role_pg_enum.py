"""Regression: User.role must use PostgreSQL enum type user_role (not userrole)."""

from __future__ import annotations

from sqlalchemy import text

from pg_client_mixin import PgClientTestCase

from app import models, security


class TestUserRolePgEnum(PgClientTestCase):
    def test_role_column_uses_user_role_enum_type(self) -> None:
        row = self.session.exec(
            text(
                """
                SELECT c.udt_name
                FROM information_schema.columns c
                WHERE c.table_schema = 'public'
                  AND c.table_name = 'user'
                  AND c.column_name = 'role'
                """
            )
        ).first()
        self.assertIsNotNone(row)
        self.assertEqual(row[0], "user_role")

    def test_insert_each_role_value(self) -> None:
        tenant = models.Tenant(name="UserRole enum regression")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)

        for i, role in enumerate(models.UserRole):
            u = models.User(
                email=f"urole-{role.value}-{i}@test.local",
                hashed_password=security.get_password_hash("secret"),
                tenant_id=tenant.id,
                role=role,
            )
            self.session.add(u)
        self.session.commit()

    def test_only_supported_roles(self) -> None:
        self.assertEqual(
            {r.value for r in models.UserRole},
            {"owner", "kitchen", "waiter", "courier"},
        )
