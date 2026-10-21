"""Billing customers: document type validation, normalization and clearing fields."""

from __future__ import annotations

import unittest

from fastapi import HTTPException

from app.main import _clean_document_type, _clean_text


class TestBillingCustomerHelpers(unittest.TestCase):
    def test_blank_text_becomes_none_so_fields_can_be_cleared(self):
        self.assertIsNone(_clean_text("   "))
        self.assertIsNone(_clean_text(""))
        self.assertIsNone(_clean_text(None))
        self.assertEqual(_clean_text("  Ana  "), "Ana")

    def test_email_is_lowercased(self):
        self.assertEqual(_clean_text(" Ana@Mail.COM ", lower=True), "ana@mail.com")

    def test_document_type_accepts_dian_codes_case_insensitive(self):
        self.assertEqual(_clean_document_type("nit"), "NIT")
        self.assertEqual(_clean_document_type(" cc "), "CC")
        self.assertIsNone(_clean_document_type(""))
        self.assertIsNone(_clean_document_type(None))

    def test_document_type_rejects_unknown_code(self):
        with self.assertRaises(HTTPException) as ctx:
            _clean_document_type("XYZ")
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
