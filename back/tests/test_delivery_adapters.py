from app.delivery_adapters import StubDeliveryAdapter, get_adapter


def test_stub_parse_webhook():
    adapter = StubDeliveryAdapter()
    out = adapter.parse_webhook_order(
        {
            "external_order_ref": "ORD-1",
            "customer_name": "Ada",
            "lines": [{"external_item_id": "SKU_A", "quantity": 2}],
        }
    )
    assert out["external_order_ref"] == "ORD-1"
    assert out["customer_name"] == "Ada"
    assert len(out["lines"]) == 1
    assert out["lines"][0]["external_item_id"] == "SKU_A"
    assert out["lines"][0]["quantity"] == 2


def test_get_adapter_registered_brands():
    assert get_adapter("uber_eats").provider_key == "uber_eats"
    assert get_adapter("glovo").provider_key == "glovo"
