from app.delivery_credentials import decrypt_credentials_json, encrypt_credentials_json


def test_encrypt_decrypt_roundtrip():
    data = {"api_key": "secret123", "nested": {"a": 1}}
    blob = encrypt_credentials_json(data)
    assert blob and isinstance(blob, str)
    out = decrypt_credentials_json(blob)
    assert out == data


def test_decrypt_invalid_returns_none():
    assert decrypt_credentials_json("") is None
    assert decrypt_credentials_json("garbage") is None
