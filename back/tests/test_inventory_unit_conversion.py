from decimal import Decimal

import pytest

from app.inventory_models import UnitOfMeasure, convert_units, get_unit_type


def test_centiliter_unit_type():
    assert get_unit_type(UnitOfMeasure.centiliter) == "volume"


def test_centiliter_to_milliliter():
    assert convert_units(Decimal("5"), UnitOfMeasure.centiliter, UnitOfMeasure.milliliter) == Decimal(
        "50"
    )


def test_milliliter_to_centiliter():
    assert convert_units(Decimal("100"), UnitOfMeasure.milliliter, UnitOfMeasure.centiliter) == Decimal(
        "10"
    )


def test_centiliter_to_liter():
    assert convert_units(Decimal("100"), UnitOfMeasure.centiliter, UnitOfMeasure.liter) == Decimal("1")


def test_incompatible_units_raises():
    with pytest.raises(ValueError, match="Cannot convert"):
        convert_units(Decimal("1"), UnitOfMeasure.centiliter, UnitOfMeasure.gram)
