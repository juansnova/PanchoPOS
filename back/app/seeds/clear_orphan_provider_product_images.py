"""
Clear ProviderProduct.image_filename (and Product provider-path refs) when files are missing on disk.

Stops catalog/menu from requesting /uploads/providers/... paths that 404.

Usage:
    python -m app.seeds.clear_orphan_provider_product_images
"""

from __future__ import annotations

from sqlmodel import Session

from app.db import engine
from app.provider_images import clear_orphan_provider_product_images


def main() -> None:
    with Session(engine) as session:
        stats = clear_orphan_provider_product_images(session)
    print("Orphan provider image cleanup:", stats)


if __name__ == "__main__":
    main()
