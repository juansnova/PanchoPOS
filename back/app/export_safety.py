"""Neutralise spreadsheet formula injection in exports (user-controlled names starting with = + - @)."""

_RISKY = ("=", "+", "-", "@", "\t", "\r")


def safe_text(value):
    """Prefix risky strings with an apostrophe so Excel/LibreOffice treat them as text."""
    if isinstance(value, str) and value.startswith(_RISKY):
        return "'" + value
    return value


def neutralize_workbook(wb) -> None:
    """Force every string cell that would parse as a formula to be stored as plain text."""
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if isinstance(cell.value, str) and cell.value.startswith(_RISKY):
                    cell.value = "'" + cell.value
                    cell.data_type = "s"
