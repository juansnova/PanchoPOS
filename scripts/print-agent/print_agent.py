#!/usr/bin/env python3
"""
LAN print agent for Satisfecho POS (#317).

Polls the cloud backend for pending print jobs and sends ESC/POS text to a
network thermal printer (JetDirect :9100) or writes to a dry-run file.

Environment:
  PRINT_AGENT_API_BASE   Base URL including /api if behind HAProxy
                         (e.g. http://127.0.0.1:4202/api or https://satisfecho.de/api)
  PRINT_AGENT_TOKEN      Agent token from Settings → Printing (shown once at create)
  PRINT_AGENT_POLL_SEC   Poll interval seconds (default 2)
  KITCHEN_PRINTER        Ordered fallback list, e.g.
                         tcp:192.168.1.50,win:DigitalPOS,file:/dev/usb/lp0
                         (tcp = Ethernet or WiFi, win = USB via Windows spooler)
  RECEIPT_PRINTER        Same for the receipt role (defaults to the kitchen list)
  KITCHEN_PRINTER_HOST   Legacy: host/IP for kitchen role (default 127.0.0.1)
  KITCHEN_PRINTER_PORT   Port (default 9100)
  RECEIPT_PRINTER_HOST   Host/IP for receipt role (default same as kitchen)
  RECEIPT_PRINTER_PORT   Port (default 9100)
  PRINT_AGENT_DRY_RUN    If 1/true, write bytes to tmp/print-agent-last.bin instead of TCP

List the printer names Windows knows (for win:NAME):
  python scripts/print-agent/print_agent.py --list-printers

Usage (from repo root):
  PRINT_AGENT_API_BASE=http://127.0.0.1:4202/api \\
  PRINT_AGENT_TOKEN=... PRINT_AGENT_DRY_RUN=1 \\
  python3 scripts/print-agent/print_agent.py
"""

from __future__ import annotations

import json
import os
import socket
import struct
import sys
import textwrap
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

ESC = b"\x1b"
GS = b"\x1d"


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _truthy(val: str) -> bool:
    return val.lower() in ("1", "true", "yes", "on")


def _api_base() -> str:
    base = _env("PRINT_AGENT_API_BASE", "http://127.0.0.1:4202/api").rstrip("/")
    return base


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "satisfecho-print-agent/1.0",
    }


def _request(method: str, url: str, token: str, body: dict | None = None) -> object:
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=_headers(token), method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            if not raw:
                return None
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} {url}: {detail}") from e


# Paper lines fed before the cut: the cutter sits below the print head, so without
# this the last lines of the ticket are cut off.
FEED_BEFORE_CUT = 7


def render_escpos(plain_text: str, *, big: bool = False) -> bytes:
    """ESC/POS: init, text, feed, cut. ``big`` = kitchen layout with large, bold text.

    Header lines (up to the first dashed separator) are double width + height; the
    lines below are double height, which keeps 48 columns on 80 mm paper.
    """
    text = (plain_text or "").replace("\r\n", "\n").replace("\r", "\n")
    out = bytearray()
    out.extend(ESC + b"@")  # init
    out.extend(ESC + b"a\x00")  # left align
    if big:
        out.extend(ESC + b"E\x01")  # bold
        in_header = True
        for line in text.split("\n"):
            is_separator = line.startswith("-" * 8)
            if is_separator:
                in_header = False
                out.extend(GS + b"!\x00")  # normal size for the separator
            elif in_header:
                out.extend(GS + b"!\x11")  # double width + height
            else:
                out.extend(GS + b"!\x01")  # double height
            # Prefer CP437-safe text; drop unsupported chars.
            out.extend(line.encode("cp437", errors="replace") + b"\n")
        out.extend(GS + b"!\x00" + ESC + b"E\x00")
    else:
        payload = text.encode("cp437", errors="replace")
        out.extend(payload)
        if not payload.endswith(b"\n"):
            out.extend(b"\n")
    out.extend(ESC + b"d" + bytes([FEED_BEFORE_CUT]))
    out.extend(GS + b"V\x00")  # full cut (many printers ignore if unsupported)
    return bytes(out)


def _enc(text: str) -> bytes:
    """CP437 bytes; characters it lacks (e.g. capital Ú) fall back to their plain letter."""
    out = bytearray()
    for ch in text:
        try:
            out.extend(ch.encode("cp437"))
        except UnicodeEncodeError:
            base = unicodedata.normalize("NFKD", ch).encode("ascii", "ignore")
            out.extend(base or b"?")
    return bytes(out)


def _wrap(text: str, width: int, indent: int = 0) -> list[str]:
    """Wrap to ``width`` columns, continuation lines indented by ``indent``."""
    lines = textwrap.wrap(text, width=width, subsequent_indent=" " * indent) or [""]
    return lines


def _make_put(out: bytearray, cols: int):
    """Return ``put(text, ...)`` that appends styled, wrapped lines to ``out``."""

    def put(text: str, *, size: int = 0x00, bold: bool = False, align: str = "left",
            reverse: bool = False) -> None:
        # Width of one character depends on the size byte: bit 4-6 = width multiplier - 1.
        per_char = ((size >> 4) & 0x07) + 1
        usable = cols // per_char
        for line in _wrap(text, usable):
            out.extend(ESC + b"a" + bytes([{"left": 0, "center": 1, "right": 2}[align]]))
            out.extend(ESC + b"E" + bytes([1 if bold else 0]))
            out.extend(GS + b"!" + bytes([size]))
            out.extend(GS + b"B" + bytes([1 if reverse else 0]))
            out.extend(_enc(f" {line} " if reverse else line) + b"\n")
        out.extend(GS + b"B\x00" + GS + b"!\x00" + ESC + b"E\x00" + ESC + b"a\x00")

    return put


def _logo_raster(logo: dict | None, align: int = 1) -> bytes:
    """ESC/POS raster image (``GS v 0``) for the 1-bit logo in the job payload, centred."""
    if not logo or not logo.get("data_b64") or not logo.get("height"):
        return b""
    import base64

    width_bytes, height = int(logo["width_bytes"]), int(logo["height"])
    data = base64.b64decode(logo["data_b64"])
    if len(data) != width_bytes * height:
        return b""
    out = bytearray(ESC + b"a" + bytes([align]))
    strip = 128  # rows per command: keeps small printer buffers happy; strips join seamlessly
    for y in range(0, height, strip):
        rows = min(strip, height - y)
        out.extend(GS + b"v0\x00" + struct.pack("<HH", width_bytes, rows))
        out.extend(data[y * width_bytes : (y + rows) * width_bytes])
    out.extend(ESC + b"a\x00")
    return bytes(out)


def money(cents: int) -> str:
    """COP style: ``$12.500`` (thousands with dots, decimals only when there are cents)."""
    value = (cents or 0) / 100
    if value == int(value):
        return "$" + f"{int(value):,}".replace(",", ".")
    return "$" + f"{value:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


PAYMENT_LABELS = {
    "cash": "Efectivo",
    "terminal": "Datáfono",
    "stripe": "Tarjeta (online)",
    "revolut": "Revolut",
}


def _two_cols(left: str, right: str, cols: int) -> str:
    """``left`` flush left and ``right`` flush right on one line."""
    gap = max(1, cols - len(left) - len(right))
    return left + " " * gap + right


def render_receipt_ticket(payload: dict, *, cols: int = 48) -> bytes:
    """Customer invoice: business header, itemised lines, tax breakdown, total."""
    out = bytearray()
    put = _make_put(out, cols)
    out.extend(ESC + b"@")  # init
    out.extend(ESC + b"t\x00")  # code page 437

    biz = payload.get("business") or {}
    logo = _logo_raster(payload.get("logo"))
    if logo:
        out.extend(logo)  # the logo already carries the restaurant name
        out.extend(b"\n")
    else:
        put(str(biz.get("name") or "Factura"), size=0x11, bold=True, align="center")
    for part in (
        ", ".join(x for x in (biz.get("address"), biz.get("city")) if x),
        f"Tel: {biz['phone']}" if biz.get("phone") else "",
        "  ".join(x for x in (f"NIT/ID: {biz['tax_id']}" if biz.get("tax_id") else "",
                             f"CIF: {biz['cif']}" if biz.get("cif") else "") if x),
    ):
        if part:
            put(part, align="center")
    put("=" * cols)
    put("FACTURA", size=0x11, bold=True, align="center", reverse=True)
    put(_two_cols(f"No. {payload.get('order_id', '')}", str(payload.get("date_label") or ""), cols), bold=True)
    put(_two_cols(f"Mesa: {payload.get('table_name') or '-'}",
                  f"Cliente: {payload['customer_name']}" if payload.get("customer_name") else "", cols))
    billing = payload.get("billing")
    if billing:
        put("-" * cols)
        put("FACTURAR A", bold=True)
        put(str(billing.get("name") or ""), bold=True)
        for key, label in (("tax_id", "NIT/ID: "), ("address", ""), ("email", "")):
            if billing.get(key):
                put(f"{label}{billing[key]}")
    put("=" * cols)

    # Columns: qty | description | unit | total
    w_qty, w_unit, w_total = 3, 9, 10
    w_name = cols - w_qty - w_unit - w_total - 3
    put(f"{'CAN':<{w_qty}} {'DESCRIPCION':<{w_name}} {'P.UNIT':>{w_unit}} {'TOTAL':>{w_total}}", bold=True)
    put("-" * cols)
    for line in payload.get("lines") or []:
        qty = int(line.get("quantity") or 1)
        name_lines = _wrap(str(line.get("name") or ""), w_name)
        put(f"{qty:<{w_qty}} {name_lines[0]:<{w_name}} "
            f"{money(line.get('price_cents') or 0):>{w_unit}} "
            f"{money(line.get('line_total_cents') or 0):>{w_total}}")
        for extra in name_lines[1:]:
            put(" " * (w_qty + 1) + extra)
        for note in (line.get("notes"), line.get("item_note")):
            if note:
                put(" " * (w_qty + 1) + f"> {note}")
    put("-" * cols)

    put(_two_cols("Subtotal", money(payload.get("subtotal_cents") or 0), cols))
    if payload.get("extra_charge_cents"):
        label = "Importe adicional"
        if payload.get("extra_charge_note"):
            label += f" ({payload['extra_charge_note']})"
        put(_two_cols(label[: cols - 12], money(payload["extra_charge_cents"]), cols))
    if payload.get("tip_cents"):
        pct = payload.get("tip_percent")
        put(_two_cols(f"Propina {pct}%" if pct else "Propina", money(payload["tip_cents"]), cols))
    for tax in payload.get("tax_summary") or []:
        put(_two_cols(f"IVA {tax['rate']}% (incluido)", money(tax["cents"]), cols))
    put("=" * cols)
    put(_two_cols("TOTAL", money(payload.get("total_cents") or 0), cols // 2), size=0x11, bold=True)
    put("=" * cols)

    if payload.get("paid"):
        method = PAYMENT_LABELS.get(str(payload.get("payment_method") or ""), payload.get("payment_method"))
        put("PAGADO" + (f" - {method}" if method else ""), bold=True, align="center")
    put("Gracias por su visita", size=0x01, bold=True, align="center")
    put("¡Esperamos verle pronto!", align="center")
    contact = "   ".join(x for x in (biz.get("website"), f"WhatsApp {biz['whatsapp']}" if biz.get("whatsapp") else "") if x)
    if contact:
        put(contact, align="center")
    out.extend(ESC + b"d" + bytes([FEED_BEFORE_CUT]))
    out.extend(GS + b"V\x00")
    return bytes(out)


def render_kitchen_ticket(payload: dict, *, cols: int = 48) -> bytes:
    """Kitchen ticket laid out from the job payload (Spanish, large, scannable at a glance)."""
    out = bytearray()
    put = _make_put(out, cols)
    out.extend(ESC + b"@")  # init
    out.extend(ESC + b"t\x00")  # code page 437
    addition = bool(payload.get("addition"))
    station = str(payload.get("station_label") or "").strip()
    banner = ("ADICION" if addition else "COMANDA") + (f" {station}" if station else "")
    put(banner, size=0x11, bold=True, align="center", reverse=True)
    if addition:
        put("solo platos nuevos", bold=True, align="center")
    put(str(payload.get("service_label") or "PARA LLEVAR"), size=0x22, bold=True, align="center")
    meta = f"Pedido #{payload.get('order_id', '')}   {payload.get('time_label', '')}".strip()
    put(meta, bold=True, align="center")
    if payload.get("customer_name"):
        put(f"Cliente: {payload['customer_name']}", bold=True)
    if payload.get("delivery_address"):
        put(f"Dir: {payload['delivery_address']}")
    if payload.get("customer_phone"):
        put(f"Tel: {payload['customer_phone']}")
    put("=" * cols)

    total = 0
    lines = payload.get("lines") or []
    for idx, line in enumerate(lines):
        qty = int(line.get("quantity") or 1)
        total += qty
        head = f"{qty:>2} x "
        wrapped = _wrap(str(line.get("name") or ""), cols - len(head), indent=0)
        for n, part in enumerate(wrapped):
            put((head if n == 0 else " " * len(head)) + part, size=0x01, bold=True)
        if line.get("notes"):
            put(f"     > {line['notes']}", bold=True)
        if line.get("item_note"):
            put(f"NOTA: {line['item_note']}", bold=True, reverse=True)
        if idx < len(lines) - 1:
            put("- " * (cols // 2))
    put("=" * cols)
    put(f"{total} plato{'s' if total != 1 else ''}", size=0x01, bold=True, align="center")
    if payload.get("order_notes"):
        put("NOTA DEL PEDIDO", bold=True, align="center", reverse=True)
        put(str(payload["order_notes"]), size=0x01, bold=True)

    out.extend(ESC + b"d" + bytes([FEED_BEFORE_CUT]))
    out.extend(GS + b"V\x00")
    return bytes(out)


def render_bar_ticket(payload: dict, *, cols: int = 48) -> bytes:
    """Bar ticket: same data as the kitchen ticket, laid out for drinks.

    Big reversed BARRA banner, service label, a bordered header, quantities in double size so the
    bartender reads them from a distance, notes in reverse video, drink count and a toast footer.
    Only CP437 glyphs are used (box drawing, diamonds, notes) so every ESC/POS printer renders it.
    """
    out = bytearray()
    put = _make_put(out, cols)
    out.extend(ESC + b"@")  # init
    out.extend(ESC + b"t\x00")  # code page 437
    addition = bool(payload.get("addition"))

    def rule(mid: str = "\u25a0", ch: str = "\u2550") -> None:
        side = (cols - 3) // 2
        put(ch * side + f" {mid} " + ch * (cols - side - 3), align="center")

    rule()
    put("BARRA", size=0x22, bold=True, align="center", reverse=True)
    if addition:
        put("ADICION - solo bebidas nuevas", bold=True, align="center")
    put(str(payload.get("service_label") or "PARA LLEVAR"), size=0x22, bold=True, align="center")
    put(f"Pedido #{payload.get('order_id', '')}", size=0x11, bold=True, align="center")
    if payload.get("time_label"):
        put(f"\u2248  {payload['time_label']}  \u2248", bold=True, align="center")
    if payload.get("customer_name"):
        put(f"Cliente: {payload['customer_name']}", bold=True, align="center")
    if payload.get("delivery_address"):
        put(f"Dir: {payload['delivery_address']}", align="center")
    if payload.get("customer_phone"):
        put(f"Tel: {payload['customer_phone']}", align="center")
    rule()

    total = 0
    lines = payload.get("lines") or []
    for idx, line in enumerate(lines):
        qty = int(line.get("quantity") or 1)
        total += qty
        # double width + height: 24 columns of 48, so qty and name stay huge and readable
        put(f"{qty}x {line.get('name') or ''}", size=0x11, bold=True)
        if line.get("notes"):
            put(f"   > {line['notes']}", bold=True)
        if line.get("item_note"):
            put(f"NOTA: {line['item_note']}", bold=True, reverse=True)
        if idx < len(lines) - 1:
            put(". " * (cols // 2), align="center")
    rule("\u25a0")
    put(f"{total} bebida{'s' if total != 1 else ''}", size=0x11, bold=True, align="center", reverse=True)
    if payload.get("order_notes"):
        put("NOTA DEL PEDIDO", bold=True, align="center", reverse=True)
        put(str(payload["order_notes"]), size=0x01, bold=True)
    put("\u2248  \u00a1Salud!  \u2248", size=0x01, bold=True, align="center")
    rule()

    out.extend(ESC + b"d" + bytes([FEED_BEFORE_CUT]))
    out.extend(GS + b"V\x00")
    return bytes(out)


def printer_targets(role: str) -> list[str]:
    """Ordered list of targets for a role; the first one that works wins.

    <ROLE>_PRINTER accepts comma-separated entries:
      tcp:HOST[:PORT]   Ethernet or WiFi printer (JetDirect, default port 9100)
      win:PRINTER_NAME  USB (or any) printer installed in Windows, sent as RAW
      file:PATH         device file, e.g. /dev/usb/lp0 on Linux
    Without it, falls back to the legacy *_PRINTER_HOST / *_PRINTER_PORT vars.
    """
    # Roles: kitchen, bar, receipt. A role without its own printer uses KITCHEN_PRINTER
    # (then RECEIPT_PRINTER), so one printer can serve everything.
    role = (role or "receipt").upper()
    chain = [role] + [r for r in ("KITCHEN", "RECEIPT") if r != role]
    for name in chain:
        spec = _env(f"{name}_PRINTER")
        if spec:
            return [t.strip() for t in spec.split(",") if t.strip()]
    host = next((_env(f"{n}_PRINTER_HOST") for n in chain if _env(f"{n}_PRINTER_HOST")), "127.0.0.1")
    port = next((_env(f"{n}_PRINTER_PORT") for n in chain if _env(f"{n}_PRINTER_PORT")), "9100")
    return [f"tcp:{host}:{port}"]


def _send_tcp(rest: str, data: bytes) -> str:
    host, _, port = rest.partition(":")
    port_n = int(port or "9100")
    with socket.create_connection((host, port_n), timeout=10) as sock:
        sock.sendall(data)
    return f"{host}:{port_n}"


def _send_win(name: str, data: bytes) -> str:
    """RAW job through the Windows spooler (ctypes, no extra packages)."""
    if os.name != "nt":
        raise RuntimeError("win: target only works on Windows")
    import ctypes
    from ctypes import wintypes

    class DocInfo1(ctypes.Structure):
        _fields_ = [
            ("pDocName", wintypes.LPWSTR),
            ("pOutputFile", wintypes.LPWSTR),
            ("pDatatype", wintypes.LPWSTR),
        ]

    spool = ctypes.WinDLL("winspool.drv", use_last_error=True)
    handle = wintypes.HANDLE()
    if not spool.OpenPrinterW(name, ctypes.byref(handle), None):
        raise RuntimeError(f"cannot open Windows printer {name!r}")
    try:
        doc = DocInfo1("PanchoPOS", None, "RAW")
        if not spool.StartDocPrinterW(handle, 1, ctypes.byref(doc)):
            raise RuntimeError("StartDocPrinter failed")
        try:
            spool.StartPagePrinter(handle)
            written = wintypes.DWORD()
            if not spool.WritePrinter(handle, data, len(data), ctypes.byref(written)):
                raise RuntimeError("WritePrinter failed")
            spool.EndPagePrinter(handle)
        finally:
            spool.EndDocPrinter(handle)
    finally:
        spool.ClosePrinter(handle)
    return name


def _send_file(path: str, data: bytes) -> str:
    with open(path, "wb") as fh:
        fh.write(data)
    return path


_SENDERS = {"tcp": _send_tcp, "win": _send_win, "file": _send_file}


def send_to_printer(role: str, data: bytes, *, dry_run: bool) -> None:
    if dry_run:
        out_dir = Path(__file__).resolve().parents[2] / "tmp"
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / "print-agent-last.bin"
        path.write_bytes(data)
        text_path = out_dir / "print-agent-last.txt"
        # Strip ESC/POS control for human-readable preview
        preview = data.decode("cp437", errors="replace")
        text_path.write_text(preview, encoding="utf-8")
        print(f"[dry-run] wrote {path} ({len(data)} bytes)", flush=True)
        return
    errors: list[str] = []
    for target in printer_targets(role):
        kind, _, rest = target.partition(":")
        sender = _SENDERS.get(kind.lower())
        if sender is None:
            errors.append(f"{target}: unknown target type")
            continue
        try:
            where = sender(rest, data)
        except Exception as exc:
            errors.append(f"{target}: {exc}")
            print(f"[warn] {target} failed ({exc}); trying next", flush=True)
            continue
        print(f"[ok] sent {len(data)} bytes via {kind} {where} role={role}", flush=True)
        return
    raise RuntimeError("all printer targets failed: " + " | ".join(errors))


def process_job(token: str, base: str, job: dict, *, dry_run: bool) -> None:
    job_id = job["id"]
    role = job.get("printer_role") or job.get("job_type") or "receipt"
    payload = job.get("payload") or {}
    plain = payload.get("plain_text") or ""
    if not plain and payload.get("lines"):
        lines = [f"{ln.get('quantity', 1)}x {ln.get('name', '')}" for ln in payload["lines"]]
        plain = "\n".join(lines) + "\n"
    # Layout follows the job type; the role (kitchen / bar / receipt) only picks the printer.
    kind = job.get("job_type") or role
    cols = int(_env("PRINTER_COLUMNS", "48") or "48")
    if kind == "kitchen" and payload.get("lines") and payload.get("service_label"):
        is_bar = str(payload.get("station") or role).lower() == "bar"
        data = (render_bar_ticket if is_bar else render_kitchen_ticket)(payload, cols=cols)
    elif kind == "receipt" and payload.get("business") and payload.get("lines"):
        data = render_receipt_ticket(payload, cols=cols)
    else:
        data = render_escpos(plain, big=kind == "kitchen")
    try:
        send_to_printer(role, data, dry_run=dry_run)
        _request(
            "POST",
            f"{base}/print-agent/jobs/{job_id}/complete",
            token,
            {"status": "done"},
        )
        print(f"[done] job {job_id}", flush=True)
    except Exception as exc:
        print(f"[fail] job {job_id}: {exc}", flush=True)
        try:
            _request(
                "POST",
                f"{base}/print-agent/jobs/{job_id}/complete",
                token,
                {"status": "failed", "error_message": str(exc)[:480]},
            )
        except Exception as ack_exc:
            print(f"[warn] could not ack failure for job {job_id}: {ack_exc}", flush=True)


def list_printers() -> int:
    """Print the names Windows knows, to use after ``win:`` in KITCHEN_PRINTER."""
    if os.name != "nt":
        print("Linux: use file:/dev/usb/lp0 (see ls /dev/usb) or tcp:IP", file=sys.stderr)
        return 1
    import subprocess

    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", "Get-Printer | Select-Object -ExpandProperty Name"],
        capture_output=True,
        text=True,
    )
    print(out.stdout.strip() or "No printers found")
    return 0


def main() -> int:
    if "--list-printers" in sys.argv:
        return list_printers()
    token = _env("PRINT_AGENT_TOKEN")
    if not token:
        print("PRINT_AGENT_TOKEN is required", file=sys.stderr)
        return 2
    base = _api_base()
    dry_run = _truthy(_env("PRINT_AGENT_DRY_RUN", "0"))
    poll = float(_env("PRINT_AGENT_POLL_SEC", "2") or "2")
    print(f"print-agent starting base={base} dry_run={dry_run} poll={poll}s", flush=True)
    while True:
        try:
            _request("POST", f"{base}/print-agent/heartbeat", token, {})
            jobs = _request("GET", f"{base}/print-agent/jobs?limit=10", token)
            if isinstance(jobs, list):
                for job in jobs:
                    process_job(token, base, job, dry_run=dry_run)
        except Exception as exc:
            print(f"[poll-error] {exc}", flush=True)
        time.sleep(max(0.5, poll))


if __name__ == "__main__":
    raise SystemExit(main())
