"""
Email service for sending transactional emails.
Supports SMTP (Gmail, Proton Mail, etc.) and can be extended for API-based services.
Uses per-tenant SMTP config when set; falls back to global config.env otherwise.
"""

import html
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import TYPE_CHECKING, Any, Optional

import aiosmtplib

from .messages import get_message, reservation_transactional_lang
from .reservation_email_template import (
    normalize_confirmation_html_fragment,
    render_confirmation_email,
    render_reminder_email,
    wrap_html_email,
)
from .settings import settings

if TYPE_CHECKING:
    from .models import Tenant

logger = logging.getLogger(__name__)


def _effective_from_name(tenant: Optional["Tenant"] = None) -> str:
    """
    Effective From name for outbound mail.

    Prefer a saved tenant From name. If unset/blank, use Business Name (tenant.name).
    Fall back to global EMAIL_FROM_NAME when no tenant name is available.
    Does not overwrite a stored email_from_name; only resolves empty cases at send time.
    """
    if tenant is not None:
        saved = (tenant.email_from_name or "").strip()
        if saved:
            return saved
        business = (tenant.name or "").strip()
        if business:
            return business
    return settings.email_from_name


def _effective_smtp_config(tenant: Optional["Tenant"] = None) -> dict[str, Any]:
    """
    Build SMTP config: tenant values when tenant has credentials set, else global.
    From name always prefers tenant identity (saved From name, then Business Name).
    """
    use_tenant = (
        tenant
        and tenant.smtp_user
        and tenant.smtp_password
    )
    return {
        "host": (tenant.smtp_host or settings.smtp_host) if use_tenant else settings.smtp_host,
        "port": (tenant.smtp_port if tenant and tenant.smtp_port is not None else settings.smtp_port)
        if use_tenant
        else settings.smtp_port,
        "use_tls": (tenant.smtp_use_tls if tenant and tenant.smtp_use_tls is not None else settings.smtp_use_tls)
        if use_tenant
        else settings.smtp_use_tls,
        "user": (tenant.smtp_user or settings.smtp_user) if use_tenant else settings.smtp_user,
        "password": (tenant.smtp_password or settings.smtp_password) if use_tenant else settings.smtp_password,
        "from_email": (tenant.email_from or settings.email_from) if use_tenant else settings.email_from,
        "from_name": _effective_from_name(tenant),
    }


def smtp_credentials_configured(tenant: Optional["Tenant"] = None) -> bool:
    """True when tenant or global SMTP has user and password (email can be attempted)."""
    cfg = _effective_smtp_config(tenant)
    return bool(cfg.get("user") and cfg.get("password"))


def reminder_send_failure_message(
    attempted_email: bool,
    email_sent: bool,
    attempted_whatsapp: bool,
    whatsapp_sent: bool,
    tenant: Optional["Tenant"] = None,
) -> str:
    """
    User-facing explanation when no reminder channel succeeded (staff UI / HTTP detail).
    Does not include secrets or raw SMTP errors.
    """
    parts: list[str] = []
    if attempted_email and not email_sent:
        if not smtp_credentials_configured(tenant):
            parts.append(
                "Email is not configured: add SMTP credentials in Settings (Email) or server configuration."
            )
        else:
            parts.append(
                "Email could not be sent. Check SMTP settings, network connectivity, and server logs."
            )
    if attempted_whatsapp and not whatsapp_sent:
        parts.append(
            "WhatsApp reminder could not be sent. Check the phone number, Twilio settings, and server logs."
        )
    if not parts:
        return "Reminder could not be sent."
    return " ".join(parts)


async def send_email(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: Optional[str] = None,
    from_email: Optional[str] = None,
    from_name: Optional[str] = None,
    tenant: Optional["Tenant"] = None,
) -> bool:
    """
    Send an email via SMTP.
    Uses tenant SMTP config when tenant has smtp_user/smtp_password set; else global config.

    Args:
        to_email: Recipient email address
        subject: Email subject
        html_content: HTML email body
        text_content: Plain text email body (optional)
        from_email: Sender email (overrides config when set)
        from_name: Sender name (overrides config when set)
        tenant: Optional tenant for per-restaurant SMTP (fallback to global when unset)

    Returns:
        True if email sent successfully, False otherwise
    """
    cfg = _effective_smtp_config(tenant)
    if not cfg["user"] or not cfg["password"]:
        logger.error("SMTP credentials not configured (tenant or global)")
        return False

    from_addr = from_email or cfg["from_email"]
    from_n = from_name or cfg["from_name"]

    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = f"{from_n} <{from_addr}>" if from_n else from_addr
    message["To"] = to_email

    if text_content:
        message.attach(MIMEText(text_content, "plain"))
    message.attach(MIMEText(html_content, "html"))

    try:
        port = cfg["port"]
        if port == 587:
            await aiosmtplib.send(
                message,
                hostname=cfg["host"],
                port=port,
                username=cfg["user"],
                password=cfg["password"],
                start_tls=True,
            )
        elif port == 465:
            await aiosmtplib.send(
                message,
                hostname=cfg["host"],
                port=port,
                username=cfg["user"],
                password=cfg["password"],
                use_tls=True,
            )
        else:
            await aiosmtplib.send(
                message,
                hostname=cfg["host"],
                port=port,
                username=cfg["user"],
                password=cfg["password"],
                start_tls=cfg["use_tls"],
            )
        logger.info(f"Email sent successfully to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {e}")
        return False


async def send_reservation_confirmation(
    to_email: str,
    customer_name: str,
    reservation_date: str,
    reservation_time: str,
    party_size: int,
    tenant: "Tenant",
    view_url: Optional[str] = None,
    smtp_tenant: Optional["Tenant"] = None,
    reservation: Optional[object] = None,
) -> bool:
    """
    Send reservation confirmation using per-tenant templates (or built-in defaults).

    `tenant` is used for placeholder values and templates. `smtp_tenant` selects SMTP
    credentials (when tenant uses global SMTP, pass None to use global config).
    Optional `reservation` supplies a per-booking locale when the model stores one.
    """
    mail_tenant = smtp_tenant if smtp_tenant is not None else tenant
    lang = reservation_transactional_lang(tenant, reservation)
    subject, text_content, html_inner = render_confirmation_email(
        tenant,
        customer_name,
        reservation_date,
        reservation_time,
        party_size,
        view_url,
        lang=lang,
    )
    html_content = wrap_html_email(
        normalize_confirmation_html_fragment(html_inner),
        tenant=tenant,
        public_app_base_url=settings.public_app_base_url,
        lang=lang,
    )
    return await send_email(to_email, subject, html_content, text_content, tenant=mail_tenant)


async def send_reservation_reminder(
    to_email: str,
    customer_name: str,
    reservation_date: str,
    reservation_time: str,
    party_size: int,
    tenant_name: str,
    view_url: Optional[str] = None,
    tenant: Optional["Tenant"] = None,
    reservation: Optional[object] = None,
) -> bool:
    """Send a reminder email for an upcoming reservation. Helps reduce no-shows."""
    lang = reservation_transactional_lang(tenant, reservation)
    subject, text_content, html_content = render_reminder_email(
        customer_name=customer_name,
        reservation_date=reservation_date,
        reservation_time=reservation_time,
        party_size=party_size,
        tenant_name=tenant_name,
        view_url=view_url,
        tenant=tenant,
        public_app_base_url=settings.public_app_base_url,
        lang=lang,
    )
    return await send_email(to_email, subject, html_content, text_content, tenant=tenant)


async def test_smtp_connection(tenant: Optional["Tenant"] = None) -> dict:
    """
    Test SMTP connection and authentication.
    Uses tenant SMTP when tenant has credentials; else global config.

    Returns:
        dict with 'success' (bool) and 'message' (str)
    """
    cfg = _effective_smtp_config(tenant)
    if not cfg["user"] or not cfg["password"]:
        return {
            "success": False,
            "message": "SMTP credentials not configured (configure in Settings → Email or in config.env)",
        }

    try:
        test_message = MIMEText("SMTP connection test")
        test_message["From"] = cfg["from_email"]
        test_message["To"] = cfg["user"]
        test_message["Subject"] = "SMTP Test"

        port = cfg["port"]
        if port == 587:
            await aiosmtplib.send(
                test_message,
                hostname=cfg["host"],
                port=port,
                username=cfg["user"],
                password=cfg["password"],
                start_tls=True,
            )
        elif port == 465:
            await aiosmtplib.send(
                test_message,
                hostname=cfg["host"],
                port=port,
                username=cfg["user"],
                password=cfg["password"],
                use_tls=True,
            )
        else:
            await aiosmtplib.send(
                test_message,
                hostname=cfg["host"],
                port=port,
                username=cfg["user"],
                password=cfg["password"],
                start_tls=cfg["use_tls"],
            )

        return {
            "success": True,
            "message": f"Successfully connected and sent test email to {cfg['host']}:{port}",
        }
    except aiosmtplib.SMTPAuthenticationError as e:
        return {
            "success": False,
            "message": f"Authentication failed. For Gmail, use an App Password. Error: {e}",
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Connection failed: {e}",
        }
