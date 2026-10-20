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

import html
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import print_agent as agent  # noqa: E402

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
BAR_TEXT = "BAR - MESA 5\nPedido #128   20/10 13:42\nCliente: Carlos\n" + "-" * 32 + "\n3x Limonada de coco\n  >> Poco hielo\n1x Cerveza Club Colombia\n"


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
        ("Barra", interpret(agent.render_escpos(BAR_TEXT, big=False))),
    ]
    out.write_text(page(tickets), encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
