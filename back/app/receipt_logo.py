"""Restaurant logo as a 1-bit raster for thermal receipts (ESC/POS ``GS v 0``).

Thermal paper only prints black dots, so a colour logo is flattened to "ink": every pixel that is
not white (orange, grey, black...) becomes black. Pillow does the work in the API container; a
small stdlib PNG reader keeps the preview script working on a machine without Pillow.
"""
from __future__ import annotations

import base64
import logging
import struct
import zlib
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# 80 mm paper = 576 dots (203 dpi). 400 dots is about 70 % of the width: bold but with margins.
DEFAULT_WIDTH_DOTS = 400
# Ink level (0-255) above which a dot is printed; low enough to keep thin outlines visible.
INK_THRESHOLD = 70


def _pack(ink: list[bytes], width: int) -> dict[str, Any]:
    """Pack rows of 0..255 ink values into 1 bit per dot (MSB first, 1 = black)."""
    width_bytes = (width + 7) // 8
    out = bytearray()
    for row in ink:
        for bx in range(width_bytes):
            byte = 0
            for bit in range(8):
                x = bx * 8 + bit
                if x < width and row[x] > INK_THRESHOLD:
                    byte |= 0x80 >> bit
            out.append(byte)
    return {
        "width_bytes": width_bytes,
        "height": len(ink),
        "data_b64": base64.b64encode(bytes(out)).decode("ascii"),
    }


def _ink_rows_pillow(path: Path, width: int) -> list[bytes]:
    from PIL import Image, ImageChops

    im = Image.open(path).convert("RGBA")
    page = Image.new("RGBA", im.size, (255, 255, 255, 255))
    page.alpha_composite(im)
    rgb = page.convert("RGB")
    height = max(1, round(rgb.height * width / rgb.width))
    rgb = rgb.resize((width, height), Image.LANCZOS)
    r, g, b = rgb.split()
    darkest = ImageChops.darker(ImageChops.darker(r, g), b)
    ink = darkest.point(lambda v: 255 - v)
    raw = ink.tobytes()
    return [raw[y * width : (y + 1) * width] for y in range(height)]


def _ink_rows_png(path: Path, width: int) -> list[bytes]:
    """Stdlib fallback: 8-bit, non-interlaced PNG (gray, RGB, palette, gray+alpha, RGBA)."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, palette = 8, bytearray(), b""
    sw = sh = depth = ctype = interlace = 0
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos : pos + 8])
        body = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            sw, sh, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
        elif kind == b"PLTE":
            palette = body
        elif kind == b"IDAT":
            idat.extend(body)
        pos += 12 + length
    if depth != 8 or interlace != 0 or ctype not in (0, 2, 3, 4, 6):
        raise ValueError("unsupported PNG variant")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    stride = sw * channels
    raw = zlib.decompress(bytes(idat))

    prev = bytearray(stride)
    ink_src: list[bytes] = []
    for y in range(sh):
        ft = raw[y * (stride + 1)]
        cur = bytearray(raw[y * (stride + 1) + 1 : (y + 1) * (stride + 1)])
        if ft == 1:
            for i in range(channels, stride):
                cur[i] = (cur[i] + cur[i - channels]) & 255
        elif ft == 2:
            for i in range(stride):
                cur[i] = (cur[i] + prev[i]) & 255
        elif ft == 3:
            for i in range(stride):
                left = cur[i - channels] if i >= channels else 0
                cur[i] = (cur[i] + ((left + prev[i]) >> 1)) & 255
        elif ft == 4:
            for i in range(stride):
                a = cur[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                cur[i] = (cur[i] + pred) & 255
        prev = cur
        row = bytearray(sw)
        for x in range(sw):
            o = x * channels
            if ctype == 0:
                r = g = b = cur[o]
                a = 255
            elif ctype == 2:
                r, g, b, a = cur[o], cur[o + 1], cur[o + 2], 255
            elif ctype == 3:
                idx = cur[o] * 3
                r, g, b, a = palette[idx], palette[idx + 1], palette[idx + 2], 255
            elif ctype == 4:
                r = g = b = cur[o]
                a = cur[o + 1]
            else:
                r, g, b, a = cur[o], cur[o + 1], cur[o + 2], cur[o + 3]
            # Composite on white, then ink = how far the darkest channel is from white.
            lo = min(r, g, b)
            row[x] = 255 - ((255 - a) * 255 + lo * a) // 255
        ink_src.append(bytes(row))

    height = max(1, round(sh * width / sw))
    out: list[bytes] = []
    for ty in range(height):
        y0 = ty * sh // height
        y1 = max(y0 + 1, (ty + 1) * sh // height)
        cols = []
        for tx in range(width):
            x0 = tx * sw // width
            x1 = max(x0 + 1, (tx + 1) * sw // width)
            total = n = 0
            for y in range(y0, y1):
                seg = ink_src[y][x0:x1]
                total += sum(seg)
                n += len(seg)
            cols.append(total // n)
        out.append(bytes(cols))
    return out


def logo_to_raster(path: Path, width: int = DEFAULT_WIDTH_DOTS) -> dict[str, Any] | None:
    """Return ``{width_bytes, height, data_b64}`` for the image at ``path`` or None on failure."""
    width = max(8, (width // 8) * 8)
    try:
        try:
            rows = _ink_rows_pillow(path, width)
        except ImportError:
            rows = _ink_rows_png(path, width)
        return _pack(rows, width)
    except Exception:  # a broken logo must never block printing the invoice
        logger.exception("Could not convert logo %s to a receipt raster", path)
        return None


def tenant_logo_raster(uploads_dir: Path, tenant: Any, width: int = DEFAULT_WIDTH_DOTS) -> dict[str, Any] | None:
    """Raster for the tenant's uploaded logo (``uploads/<tenant_id>/logo/<file>``), if any."""
    filename = getattr(tenant, "logo_filename", None)
    tenant_id = getattr(tenant, "id", None)
    if not filename or tenant_id is None:
        return None
    path = uploads_dir / str(tenant_id) / "logo" / Path(filename).name
    if not path.is_file():
        return None
    return logo_to_raster(path, width)
