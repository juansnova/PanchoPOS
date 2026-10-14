"""
Import tenant products + categories from a CSV file (migration cutover MVP).

Reuses the same preview/confirm pipeline as Products → bulk import (JSON/vision).
Idempotent by product name (case-insensitive): re-run updates matching names.

Usage (Docker, from repo root):
  docker compose exec back python -m app.seeds.import_products_csv \\
    --tenant-id 1 --csv /app/fixtures/migration/sample_products.csv --dry-run

  docker compose exec back python -m app.seeds.import_products_csv \\
    --tenant-id 1 --csv /app/fixtures/migration/sample_products.csv --apply

See docs/0062-pos-migration-import.md for the cutover runbook and column map.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlmodel import Session, select

from app import models
from app.db import engine
from app.product_bulk_import import (
    build_preview,
    confirm_import,
    format_preview_report,
    parse_products_csv,
)


def run(
    *,
    tenant_id: int,
    csv_path: Path,
    apply: bool = False,
    session: Session | None = None,
) -> int:
    """
    Dry-run (default) or apply CSV import for one tenant.

    Returns process exit code: 0 on success, 1 on validation / tenant errors,
    2 on CSV parse / IO errors.

    Pass ``session`` in tests to reuse the test DB connection; otherwise a new
    Session is opened against ``app.db.engine``.
    """
    if not csv_path.is_file():
        print(f"ERROR: CSV not found: {csv_path}", file=sys.stderr)
        return 2

    try:
        text = csv_path.read_text(encoding="utf-8-sig")
        items = parse_products_csv(text)
    except ValueError as exc:
        print(f"ERROR: CSV validation failed: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"ERROR: cannot read CSV: {exc}", file=sys.stderr)
        return 2

    own_session = session is None
    if own_session:
        session = Session(engine)
    assert session is not None
    try:
        tenant = session.exec(
            select(models.Tenant).where(models.Tenant.id == tenant_id)
        ).first()
        if not tenant:
            print(f"ERROR: tenant_id={tenant_id} not found", file=sys.stderr)
            return 1

        preview = build_preview(session, tenant_id, items)
        mode = "apply" if apply else "dry-run"
        print(f"[{mode}] tenant_id={tenant_id} file={csv_path}")
        print(format_preview_report(preview))

        if preview.summary.invalid:
            print(
                "ERROR: invalid rows present; fix the CSV and re-run --dry-run "
                "(--apply will not write until invalid=0).",
                file=sys.stderr,
            )
            return 1

        if not apply:
            print("[dry-run] no database writes.")
            return 0

        if preview.summary.valid == 0:
            print("ERROR: no valid rows to import", file=sys.stderr)
            return 1

        result = confirm_import(session, tenant_id, preview.items)
        print(
            f"[apply] created={result.created} updated={result.updated} "
            f"skipped={result.skipped} product_ids={result.product_ids}"
        )
        return 0
    finally:
        if own_session:
            session.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Import products/categories from CSV for one tenant (migration MVP)."
    )
    parser.add_argument(
        "--tenant-id",
        type=int,
        required=True,
        help="Target tenant id (required; never imports across tenants)",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        required=True,
        help="Path to products CSV (inside container: /app/fixtures/...)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Persist valid rows after validation (default is dry-run only)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and print report only (default if --apply is omitted)",
    )
    args = parser.parse_args(argv)
    if args.dry_run and args.apply:
        parser.error("use either --dry-run or --apply, not both")
    return run(tenant_id=args.tenant_id, csv_path=args.csv, apply=args.apply)


if __name__ == "__main__":
    raise SystemExit(main())
