"""Unit tests: menu order line price resolution (orderitem.price_cents is NOT NULL)."""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from fastapi import HTTPException

from app import models
from app.main import (
    _finalize_menu_order_line_price_cents,
    _price_cents_from_tenant_product_row,
)


def _tp(**kwargs) -> models.TenantProduct:
    defaults = dict(
        id=1,
        tenant_id=10,
        catalog_id=20,
        name="Pozole",
        price_cents=100,
        provider_product_id=None,
        product_id=None,
    )
    defaults.update(kwargs)
    return models.TenantProduct(**defaults)


class TestPriceCentsFromTenantProductRow(unittest.TestCase):
    def test_returns_tenant_price_when_set(self):
        session = MagicMock()
        tp = _tp(price_cents=250)
        self.assertEqual(_price_cents_from_tenant_product_row(session, tp), 250)
        session.get.assert_not_called()

    def test_falls_back_to_provider_product(self):
        session = MagicMock()
        tp = _tp(price_cents=None, provider_product_id=30, product_id=7)
        tp.price_cents = None
        pp = models.ProviderProduct(
            id=30,
            catalog_id=20,
            provider_id=5,
            external_id="e",
            name="P",
            price_cents=888,
        )

        def _get(model, pk):
            if model is models.ProviderProduct and pk == 30:
                return pp
            return None

        session.get.side_effect = _get
        self.assertEqual(_price_cents_from_tenant_product_row(session, tp), 888)

    def test_falls_back_to_linked_product(self):
        session = MagicMock()
        tp = _tp(price_cents=None, provider_product_id=None, product_id=7)
        tp.price_cents = None
        prod = models.Product(id=7, name="Pozole", price_cents=350, tenant_id=10)

        def _get(model, pk):
            if model is models.Product and pk == 7:
                return prod
            return None

        session.get.side_effect = _get
        self.assertEqual(_price_cents_from_tenant_product_row(session, tp), 350)


class TestFinalizeMenuOrderLinePriceCents(unittest.TestCase):
    def test_returns_existing_price(self):
        session = MagicMock()
        r = _finalize_menu_order_line_price_cents(
            session,
            tenant_id=10,
            request_product_id=1,
            effective_product_id=7,
            line_tenant_product=None,
            price_cents=123,
            product_name="X",
        )
        self.assertEqual(r, 123)

    def test_raises_400_when_nothing_resolves(self):
        session = MagicMock()
        session.get.return_value = None
        session.exec.return_value.first.return_value = None
        with self.assertRaises(HTTPException) as ctx:
            _finalize_menu_order_line_price_cents(
                session,
                tenant_id=10,
                request_product_id=99,
                effective_product_id=7,
                line_tenant_product=None,
                price_cents=None,
                product_name="Pozole",
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("no selling price", ctx.exception.detail.lower())

    def test_uses_line_tenant_product_when_price_missing(self):
        session = MagicMock()
        tp = _tp(id=5, price_cents=None, provider_product_id=30, product_id=7)
        tp.price_cents = None
        pp = models.ProviderProduct(
            id=30,
            catalog_id=20,
            provider_id=5,
            external_id="e",
            name="P",
            price_cents=888,
        )

        def _get(model, pk):
            if model is models.ProviderProduct and pk == 30:
                return pp
            return None

        session.get.side_effect = _get
        r = _finalize_menu_order_line_price_cents(
            session,
            tenant_id=10,
            request_product_id=5,
            effective_product_id=7,
            line_tenant_product=tp,
            price_cents=None,
            product_name="Pozole",
        )
        self.assertEqual(r, 888)


if __name__ == "__main__":
    unittest.main()
