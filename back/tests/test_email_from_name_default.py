"""Effective SMTP From name falls back to Business Name when unset."""

from types import SimpleNamespace

from app.email_service import _effective_from_name, _effective_smtp_config
from app.settings import settings


def test_from_name_uses_saved_tenant_value():
    tenant = SimpleNamespace(name="Demo Bistro", email_from_name="Custom Sender")
    assert _effective_from_name(tenant) == "Custom Sender"


def test_from_name_falls_back_to_business_name_when_empty():
    tenant = SimpleNamespace(name="Demo Bistro", email_from_name=None)
    assert _effective_from_name(tenant) == "Demo Bistro"

    tenant_blank = SimpleNamespace(name="Demo Bistro", email_from_name="   ")
    assert _effective_from_name(tenant_blank) == "Demo Bistro"


def test_from_name_falls_back_to_global_when_no_business_name():
    tenant = SimpleNamespace(name=None, email_from_name="")
    assert _effective_from_name(tenant) == settings.email_from_name
    assert _effective_from_name(None) == settings.email_from_name


def test_effective_smtp_config_from_name_uses_business_name_without_tenant_smtp():
    """Global SMTP credentials still use tenant Business Name for From when unset."""
    tenant = SimpleNamespace(
        name="Demo Bistro",
        email_from_name=None,
        email_from=None,
        smtp_host=None,
        smtp_port=None,
        smtp_use_tls=None,
        smtp_user=None,
        smtp_password=None,
    )
    cfg = _effective_smtp_config(tenant)
    assert cfg["from_name"] == "Demo Bistro"
