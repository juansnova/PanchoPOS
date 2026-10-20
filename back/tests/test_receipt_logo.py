"""Logo -> 1-bit raster for thermal receipts."""

from __future__ import annotations

import base64
import struct
import tempfile
import unittest
import zlib
from pathlib import Path

from app import receipt_logo


def _png_rgba(width: int, height: int, pixel) -> bytes:
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    raw = b"".join(
        b"\x00" + b"".join(bytes(pixel(x, y)) for x in range(width)) for y in range(height)
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


class TestReceiptLogo(unittest.TestCase):
    def _raster(self, pixel, width: int = 16, height: int = 16, dots: int = 16):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "logo.png"
            path.write_bytes(_png_rgba(width, height, pixel))
            return receipt_logo._pack(receipt_logo._ink_rows_png(path, dots), dots)

    def test_orange_ink_on_transparent_background(self) -> None:
        # Left half orange, right half transparent: left becomes black dots, right stays white.
        r = self._raster(lambda x, y: (224, 125, 47, 255) if x < 8 else (0, 0, 0, 0))
        self.assertEqual((r["width_bytes"], r["height"]), (2, 16))
        row = base64.b64decode(r["data_b64"])[:2]
        self.assertEqual(row, b"\xff\x00")

    def test_white_logo_prints_nothing(self) -> None:
        r = self._raster(lambda x, y: (255, 255, 255, 255))
        self.assertEqual(set(base64.b64decode(r["data_b64"])), {0})

    def test_missing_file_returns_none(self) -> None:
        self.assertIsNone(receipt_logo.logo_to_raster(Path("/nonexistent/logo.png")))


if __name__ == "__main__":
    unittest.main()
