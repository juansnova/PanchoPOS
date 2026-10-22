#!/usr/bin/env python3
"""Preview how the print agent's tickets look on paper, without a printer.

Renders sample jobs with the agent's own ESC/POS code (print_agent.render_*), interprets the
bytes (alignment, bold, size, reverse, feed, cut) and writes an HTML page.

    python scripts/print-agent/preview_ticket.py            # writes tmp/ticket-preview/index.html
    python scripts/print-agent/preview_ticket.py out.html   # custom output file

View it by serving that folder, e.g. `python -m http.server 4210 --bind 127.0.0.1 --directory tmp/ticket-preview`
and opening http://localhost:4210/ (do not serve tmp/ itself: it holds the agent token).
"""
from __future__ import annotations

import base64
import html
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(ROOT / "back" / "app"))
import print_agent as agent  # noqa: E402
import receipt_logo  # noqa: E402


def sample_logo() -> dict | None:
    """Raster of the first uploaded restaurant logo found (same conversion the API uses)."""
    for path in sorted((ROOT / "back" / "uploads").glob("*/logo/*")):
        return receipt_logo.logo_to_raster(path)
    return None


def _png_1bit(width: int, rows: list[bytes]) -> str:
    """Data URI of a 1-bit PNG; ESC/POS bit 1 = black dot, PNG gray bit 1 = white, so invert."""
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    raw = b"".join(b"\x00" + bytes(b ^ 0xFF for b in row) for row in rows)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, len(rows), 1, 0, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")

COLS = 48
ESC, GS = b"\x1b", b"\x1d"

KITCHEN = {
    "order_id": 128,
    "service_label": "MESA 5",
    "time_label": "20/10 13:42",
    "customer_name": "Carlos",
    "addition": False,
    "lines": [
        {"quantity": 2, "name": "Bandeja paisa", "notes": "Quitar: chorizo · Añadir: huevo extra", "item_note": "Sin cebolla, alergia al maní"},
        {"quantity": 1, "name": "Sopa de mondongo", "notes": None, "item_note": None},
        {"quantity": 3, "name": "Limonada de coco", "notes": None, "item_note": "Poco hielo"},
    ],
    "order_notes": "Cumpleaños: sacar el postre con una vela",
}
ADDITION = {**KITCHEN, "addition": True, "lines": KITCHEN["lines"][1:2], "order_notes": None, "customer_name": None}
DELIVERY = {
    **KITCHEN,
    "service_label": "DOMICILIO",
    "delivery_address": "Calle 10 # 43-12, Apto 501",
    "customer_phone": "300 123 4567",
    "lines": KITCHEN["lines"][:1],
}
RECEIPT = {
    "logo": sample_logo(),
    "order_id": 128,
    "date_label": "20/10/2026 14:05",
    "table_name": "Mesa 5",
    "customer_name": "Carlos",
    "business": {
        "name": "Pancho Panza",
        "address": "Carrera 7 # 45-10",
        "city": "Bogotá",
        "phone": "601 555 0123",
        "tax_id": "900.123.456-7",
        "website": "www.panchopanza.co",
        "whatsapp": "300 123 4567",
    },
    "billing": {"name": "Inversiones Andina S.A.S.", "tax_id": "901.222.333-4", "address": "Calle 80 # 12-34", "email": "compras@andina.co"},
    "lines": [
        {"quantity": 2, "name": "Bandeja paisa", "price_cents": 3800000, "line_total_cents": 7600000, "notes": "Quitar: chorizo", "item_note": "Sin cebolla"},
        {"quantity": 1, "name": "Sopa de mondongo", "price_cents": 2200000, "line_total_cents": 2200000},
        {"quantity": 3, "name": "Limonada de coco", "price_cents": 900000, "line_total_cents": 2700000},
    ],
    "subtotal_cents": 12500000,
    "extra_charge_cents": 500000,
    "extra_charge_note": None,
    "tip_cents": 0,
    "tax_summary": [{"rate": 8, "cents": 925926}],
    "total_cents": 13000000,
    "paid": True,
    "payment_method": "cash",
}
RECEIPT_SIMPLE = {
    **RECEIPT,
    "billing": None,
    "customer_name": None,
    "lines": RECEIPT["lines"][1:2],
    "subtotal_cents": 2200000,
    "extra_charge_cents": 0,
    "tax_summary": [],
    "total_cents": 2200000,
    "paid": False,
}
BAR = {
    **KITCHEN,
    "station": "bar",
    "station_label": "BARRA",
    "lines": [
        {"quantity": 3, "name": "Limonada de coco", "notes": None, "item_note": "Poco hielo"},
        {"quantity": 1, "name": "Cerveza Club Colombia", "notes": None, "item_note": None},
        {"quantity": 2, "name": "Jugo de lulo en leche", "notes": "Sin azúcar", "item_note": None},
    ],
    "order_notes": None,
}
BAR_ADDITION = {**BAR, "addition": True, "lines": BAR["lines"][:1], "customer_name": None}


def interpret(data: bytes) -> str:
    """Render the ESC/POS subset the agent emits as HTML."""
    rows: list[str] = []
    align, bold, size, reverse = 0, False, 0x00, False
    buf = bytearray()
    i = 0

    def flush() -> None:
        nonlocal buf
        w, h = ((size >> 4) & 7) + 1, (size & 7) + 1
        text = bytes(buf).decode("cp437", errors="replace")
        buf = bytearray()
        cls = f"a{align}{' b' if bold else ''}{' r' if reverse else ''}"
        inner = html.escape(text) or "&nbsp;"
        if reverse:
            inner = f"<i>{inner}</i>"
        rows.append(
            f'<div class="row" style="height:calc(var(--lh)*{h})">'
            f'<div class="ln {cls}" style="font-size:calc(var(--fs)*{w});line-height:calc(var(--lh)*{w});height:calc(var(--lh)*{w});transform:scaleY({h / w});">{inner}</div></div>'
        )

    while i < len(data):
        b = data[i : i + 1]
        if b == ESC and data[i + 1 : i + 2] == b"@":
            i += 2
        elif b == ESC and data[i + 1 : i + 2] == b"t":
            i += 3
        elif b == ESC and data[i + 1 : i + 2] == b"a":
            align = data[i + 2]
            i += 3
        elif b == ESC and data[i + 1 : i + 2] == b"E":
            bold = bool(data[i + 2])
            i += 3
        elif b == ESC and data[i + 1 : i + 2] == b"d":
            rows.append(f'<div class="row" style="height:calc(var(--lh)*{min(data[i + 2], 3)})"></div>')
            i += 3
        elif b == GS and data[i + 1 : i + 2] == b"!":
            size = data[i + 2]
            i += 3
        elif b == GS and data[i + 1 : i + 2] == b"B":
            reverse = bool(data[i + 2])
            i += 3
        elif b == GS and data[i + 1 : i + 3] == b"v0":  # raster image: GS v 0 m xL xH yL yH data
            wb, rows_n = struct.unpack("<HH", data[i + 4 : i + 8])
            body = data[i + 8 : i + 8 + wb * rows_n]
            img = _png_1bit(wb * 8, [body[r * wb : (r + 1) * wb] for r in range(rows_n)])
            cls = f"a{align}"
            rows.append(f'<div class="img {cls}"><img src="{img}" alt="logo" width="{wb * 8}" height="{rows_n}"></div>')
            i += 8 + wb * rows_n
        elif b == GS and data[i + 1 : i + 2] == b"V":
            rows.append('<div class="cut">✂ corte</div>')
            i += 3
        elif b == b"\n":
            flush()
            i += 1
        else:
            buf.extend(b)
            i += 1
    return "".join(rows)


def page(tickets: list[tuple[str, str]]) -> str:
    cards = "".join(
        f'<section><h2>{html.escape(title)}</h2><div class="paper">{body}</div></section>' for title, body in tickets
    )
    return f"""<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Vista previa de tickets</title>
<style>
body{{margin:0;padding:24px;background:#e5e7eb;font-family:system-ui,sans-serif;color:#111}}
h1{{margin:0 0 4px;font-size:1.25rem}} p.hint{{margin:0 0 20px;color:#555;font-size:.9rem}}
.wrap{{display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start}}
section h2{{font-size:.95rem;margin:0 0 8px}}
.paper{{--fs:20px;--lh:26px;width:calc(48 * 12px);max-width:100%;padding:16px 0 8px;background:#fff;
  box-shadow:0 4px 18px rgba(0,0,0,.25);font-family:"Courier New",Courier,monospace;overflow:hidden}}
.row{{overflow:hidden}}
.ln{{white-space:pre;transform-origin:top left;line-height:var(--lh);height:var(--lh);font-size:var(--fs)}}
.ln.a1{{text-align:center;width:100%}} .ln.a2{{text-align:right;width:100%}}
.ln.b{{font-weight:700}} .ln.r i{{font-style:normal;background:#000;color:#fff}}
.img{{line-height:0}} .img img{{display:block}} .img.a1{{text-align:center}} .img.a1 img{{margin:0 auto}}
.cut{{text-align:center;color:#9ca3af;font-size:12px;border-top:2px dashed #9ca3af;margin-top:8px;padding-top:4px}}
</style></head><body>
<h1>Vista previa de tickets</h1>
<p class="hint">Generado con el mismo código del agente de impresión (papel de 80 mm, {COLS} columnas). Datos de ejemplo.</p>
<div class="wrap">{cards}</div></body></html>"""


def main() -> None:
    default = Path(__file__).resolve().parents[2] / "tmp" / "ticket-preview" / "index.html"
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else default
    out.parent.mkdir(parents=True, exist_ok=True)
    tickets = [
        ("Cocina · comanda", interpret(agent.render_kitchen_ticket(KITCHEN, cols=COLS))),
        ("Cocina · adición (solo platos nuevos)", interpret(agent.render_kitchen_ticket(ADDITION, cols=COLS))),
        ("Cocina · domicilio", interpret(agent.render_kitchen_ticket(DELIVERY, cols=COLS))),
        ("Barra · comanda de bebidas", interpret(agent.render_bar_ticket(BAR, cols=COLS))),
        ("Barra · adición (solo bebidas nuevas)", interpret(agent.render_bar_ticket(BAR_ADDITION, cols=COLS))),
        ("Factura · pagada, con cliente de facturación e importe adicional", interpret(agent.render_receipt_ticket(RECEIPT, cols=COLS))),
        ("Factura · sencilla, sin pagar", interpret(agent.render_receipt_ticket(RECEIPT_SIMPLE, cols=COLS))),
    ]
    out.write_text(page(tickets), encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
