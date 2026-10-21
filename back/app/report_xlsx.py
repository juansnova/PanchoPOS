"""
Styled Excel workbooks for the sales reports (GET /reports/export and /reports/export-detailed).

Money is written in currency units (cents / 100) with a currency number format, never raw cents.
Every sheet has a banner, a styled header, zebra rows, totals, filters, frozen headers and, where
it helps the analysis, native Excel charts. Totals / percentages are computed here (no formulas),
so the workbook is safe to run through ``neutralize_workbook``.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, PieChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.series import DataPoint
from openpyxl.formatting.rule import ColorScaleRule, DataBarRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from .export_safety import neutralize_workbook

ORANGE = "EA580C"
ORANGE_SOFT = "FFEDD5"
CREAM = "FFF7ED"
DARK = "1C1917"
GREY = "78716C"
ZEBRA = "FAF8F6"
GRID = "E7E5E4"
GREEN = "047857"
PALETTE = ["EA580C", "F59E0B", "0E7490", "7C3AED", "059669", "DB2777", "2563EB", "B91C1C", "65A30D", "475569"]

MONEY = '"$" #,##0;[Red]-"$" #,##0'
PCT = "0.0%"
INT = "#,##0"
QTY = "#,##0.##"
DATE_FMT = "dd/mm/yyyy"
DATETIME_FMT = "dd/mm/yyyy hh:mm"

DEFAULT_TZ = "America/Bogota"

_THIN = Side(style="thin", color=GRID)
_BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
_HEADER_FONT = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
_HEADER_FILL = PatternFill("solid", fgColor=DARK)
_BODY_FONT = Font(name="Calibri", size=11, color=DARK)
_ZEBRA_FILL = PatternFill("solid", fgColor=ZEBRA)
_TOTAL_FONT = Font(name="Calibri", bold=True, size=11, color=DARK)
_TOTAL_FILL = PatternFill("solid", fgColor=ORANGE_SOFT)
_TOTAL_BORDER = Border(left=_THIN, right=_THIN, top=Side(style="medium", color=ORANGE), bottom=_THIN)

# ----------------------------------------------------------------------------- labels

_ES = {
    "report_title": "Informe de ventas",
    "detailed_title": "Informe detallado de ingresos y gastos",
    "period": "Periodo",
    "generated": "Generado",
    "restaurant": "Restaurante",
    "kpi_revenue": "Ingresos",
    "kpi_cost": "Costo de ventas",
    "kpi_profit": "Utilidad",
    "kpi_margin": "Margen",
    "kpi_tips": "Propinas",
    "kpi_orders": "Pedidos",
    "kpi_ticket": "Ticket promedio",
    "kpi_days": "Días con ventas",
    "kpi_expenses": "Gastos (compras)",
    "kpi_net": "Neto",
    "kpi_net_margin": "Margen neto",
    "kpi_lines": "Líneas vendidas",
    "kpi_purchases": "Compras recibidas",
    "kpi_suppliers": "Proveedores",
    "highlights": "Lo más destacado",
    "indicator": "Indicador",
    "result": "Resultado",
    "detail": "Detalle",
    "best_day": "Mejor día",
    "worst_day": "Día más flojo",
    "top_product": "Producto más vendido",
    "top_profit_product": "Producto con más utilidad",
    "top_category": "Categoría líder",
    "top_table": "Mesa líder",
    "top_waiter": "Mesero líder",
    "peak_hour": "Hora pico",
    "best_weekday": "Mejor día de la semana",
    "top_payment": "Método de pago principal",
    "top_supplier": "Proveedor con más compras",
    "top_expense_item": "Artículo con más gasto",
    "of_total": "del total",
    "orders_word": "pedidos",
    "units_word": "unidades",
    "of_revenue": "de los ingresos",
    "sheet_summary": "Resumen",
    "sheet_daily": "Por día",
    "sheet_products": "Productos",
    "sheet_categories": "Categorías",
    "sheet_tables": "Mesas",
    "sheet_waiters": "Meseros",
    "sheet_payments": "Métodos de pago",
    "sheet_time": "Horas y días",
    "sheet_reservations": "Reservas",
    "sheet_income": "Ingresos detallados",
    "sheet_expenses": "Gastos detallados",
    "sheet_by_day": "Ingresos vs gastos",
    "sheet_suppliers": "Por proveedor",
    "sheet_items": "Por artículo",
    "date": "Fecha",
    "datetime": "Fecha y hora",
    "weekday": "Día",
    "hour": "Hora",
    "orders": "Pedidos",
    "revenue": "Ingresos",
    "cost": "Costo",
    "profit": "Utilidad",
    "margin": "Margen",
    "tips": "Propinas",
    "tips_pct": "Propina %",
    "ticket": "Ticket promedio",
    "rank": "#",
    "product": "Producto",
    "category": "Categoría",
    "quantity": "Cantidad",
    "share": "% del total",
    "cumulative": "% acumulado",
    "abc": "Clase ABC",
    "table": "Mesa",
    "waiter": "Mesero",
    "payment": "Método de pago",
    "customer": "Cliente",
    "order": "Pedido",
    "unit_price": "Precio unitario",
    "supplier": "Proveedor",
    "status": "Estado",
    "item": "Artículo",
    "qty_received": "Cant. recibida",
    "unit": "Unidad",
    "unit_cost": "Costo unitario",
    "line_total": "Total línea",
    "expenses": "Gastos",
    "net": "Neto",
    "net_cum": "Neto acumulado",
    "po_orders": "Órdenes de compra",
    "total": "TOTAL",
    "count": "Cantidad",
    "res_active": "Reservas activas",
    "res_finished": "Reservas finalizadas",
    "res_all": "Reservas totales",
    "res_overbooking": "Franjas con sobreventa",
    "chart_daily": "Ingresos por día",
    "chart_categories": "Ventas por categoría",
    "chart_top_products": "Top 10 productos por ingresos",
    "chart_hours": "Ingresos por hora",
    "chart_income_vs_expenses": "Ingresos vs gastos por día",
    "unspecified": "Sin especificar",
    "uncategorized": "Sin categoría",
    "unassigned": "Sin asignar",
    "none": "—",
    "abc_hint": "A = productos que suman el 80 % de los ingresos · B = hasta el 95 % · C = el resto",
    "cost_hint": "Costo y utilidad se calculan con el costo registrado en las recetas.",
    "weekdays": ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"],
    "pay_cash": "Efectivo",
    "pay_terminal": "Datáfono / tarjeta",
    "pay_stripe": "Tarjeta en línea",
    "pay_other": "Otro",
    "res_status_booked": "Reservada",
    "res_status_seated": "En mesa",
    "res_status_finished": "Finalizada",
    "res_status_cancelled": "Cancelada",
    "res_status_no_show": "No se presentó",
    "po_received": "Recibido",
    "po_partially_received": "Recibido parcialmente",
}

_EN = {
    **_ES,
    "report_title": "Sales report",
    "detailed_title": "Detailed income & expenses report",
    "period": "Period",
    "generated": "Generated",
    "restaurant": "Restaurant",
    "kpi_revenue": "Revenue",
    "kpi_cost": "Cost of sales",
    "kpi_profit": "Profit",
    "kpi_margin": "Margin",
    "kpi_tips": "Tips",
    "kpi_orders": "Orders",
    "kpi_ticket": "Average ticket",
    "kpi_days": "Days with sales",
    "kpi_expenses": "Expenses (purchases)",
    "kpi_net": "Net",
    "kpi_net_margin": "Net margin",
    "kpi_lines": "Lines sold",
    "kpi_purchases": "Purchases received",
    "kpi_suppliers": "Suppliers",
    "highlights": "Highlights",
    "indicator": "Indicator",
    "result": "Result",
    "detail": "Detail",
    "best_day": "Best day",
    "worst_day": "Slowest day",
    "top_product": "Best-selling product",
    "top_profit_product": "Most profitable product",
    "top_category": "Top category",
    "top_table": "Top table",
    "top_waiter": "Top waiter",
    "peak_hour": "Peak hour",
    "best_weekday": "Best weekday",
    "top_payment": "Main payment method",
    "top_supplier": "Top supplier by spend",
    "top_expense_item": "Item with highest spend",
    "of_total": "of total",
    "orders_word": "orders",
    "units_word": "units",
    "of_revenue": "of revenue",
    "sheet_summary": "Summary",
    "sheet_daily": "By day",
    "sheet_products": "Products",
    "sheet_categories": "Categories",
    "sheet_tables": "Tables",
    "sheet_waiters": "Waiters",
    "sheet_payments": "Payment methods",
    "sheet_time": "Hours & weekdays",
    "sheet_reservations": "Reservations",
    "sheet_income": "Detailed income",
    "sheet_expenses": "Detailed expenses",
    "sheet_by_day": "Income vs expenses",
    "sheet_suppliers": "By supplier",
    "sheet_items": "By item",
    "date": "Date",
    "datetime": "Date & time",
    "weekday": "Weekday",
    "hour": "Hour",
    "orders": "Orders",
    "revenue": "Revenue",
    "cost": "Cost",
    "profit": "Profit",
    "margin": "Margin",
    "tips": "Tips",
    "tips_pct": "Tip %",
    "ticket": "Average ticket",
    "product": "Product",
    "category": "Category",
    "quantity": "Quantity",
    "share": "% of total",
    "cumulative": "Cumulative %",
    "abc": "ABC class",
    "table": "Table",
    "waiter": "Waiter",
    "payment": "Payment method",
    "customer": "Customer",
    "order": "Order",
    "unit_price": "Unit price",
    "supplier": "Supplier",
    "status": "Status",
    "item": "Item",
    "qty_received": "Qty received",
    "unit": "Unit",
    "unit_cost": "Unit cost",
    "line_total": "Line total",
    "expenses": "Expenses",
    "net": "Net",
    "net_cum": "Cumulative net",
    "po_orders": "Purchase orders",
    "total": "TOTAL",
    "count": "Count",
    "res_active": "Active reservations",
    "res_finished": "Finished reservations",
    "res_all": "Total reservations",
    "res_overbooking": "Overbooked slots",
    "chart_daily": "Revenue per day",
    "chart_categories": "Sales by category",
    "chart_top_products": "Top 10 products by revenue",
    "chart_hours": "Revenue by hour",
    "chart_income_vs_expenses": "Income vs expenses per day",
    "unspecified": "Unspecified",
    "uncategorized": "Uncategorized",
    "unassigned": "Unassigned",
    "abc_hint": "A = products making up 80 % of revenue · B = up to 95 % · C = the rest",
    "cost_hint": "Cost and profit use the cost recorded in the recipes.",
    "weekdays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    "pay_cash": "Cash",
    "pay_terminal": "Card terminal",
    "pay_stripe": "Online card",
    "pay_other": "Other",
    "res_status_booked": "Booked",
    "res_status_seated": "Seated",
    "res_status_finished": "Finished",
    "res_status_cancelled": "Cancelled",
    "res_status_no_show": "No-show",
    "po_received": "Received",
    "po_partially_received": "Partially received",
}


def labels(lang: str | None) -> dict:
    """Spanish for any es-* language, English otherwise (the in-app default is Spanish)."""
    low = (lang or "es").strip().lower()
    return _EN if low and not low.startswith("es") else _ES


# ----------------------------------------------------------------------------- helpers


def _tz(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo((name or DEFAULT_TZ).strip() or DEFAULT_TZ)
    except Exception:
        return ZoneInfo(DEFAULT_TZ)


def _local(dt: datetime | None, tz: ZoneInfo) -> datetime | None:
    """Tenant-local wall-clock time as a naive datetime (Excel has no time zones)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz).replace(tzinfo=None)


def _money(cents) -> float:
    return round((cents or 0) / 100, 2)


def _ratio(a, b) -> float:
    return (a / b) if b else 0.0


def _col(n: int) -> str:
    return get_column_letter(n)


def _banner(ws, title: str, subtitle: str, ncols: int) -> None:
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)
    c = ws.cell(row=1, column=1, value=title)
    c.font = Font(name="Calibri", bold=True, size=20, color="FFFFFF")
    c.fill = PatternFill("solid", fgColor=ORANGE)
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    for j in range(2, ncols + 1):
        ws.cell(row=1, column=j).fill = PatternFill("solid", fgColor=ORANGE)
    ws.row_dimensions[1].height = 38
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=ncols)
    s = ws.cell(row=2, column=1, value=subtitle)
    s.font = Font(name="Calibri", italic=True, size=10, color=GREY)
    s.fill = PatternFill("solid", fgColor=CREAM)
    s.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    for j in range(2, ncols + 1):
        ws.cell(row=2, column=j).fill = PatternFill("solid", fgColor=CREAM)
    ws.row_dimensions[2].height = 20


def _section(ws, row: int, text: str, ncols: int) -> None:
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=ncols)
    c = ws.cell(row=row, column=1, value=text)
    c.font = Font(name="Calibri", bold=True, size=13, color=ORANGE)
    c.alignment = Alignment(horizontal="left", vertical="center")
    for j in range(1, ncols + 1):
        ws.cell(row=row, column=j).border = Border(bottom=Side(style="medium", color=ORANGE))
    ws.row_dimensions[row].height = 24


def _table(ws, top: int, headers, rows, fmts, total=None, center=(), first_filter=True):
    """Write a styled table. Returns (first_data_row, last_data_row, next_free_row)."""
    n = len(headers)
    for j, h in enumerate(headers, 1):
        c = ws.cell(row=top, column=j, value=h)
        c.font = _HEADER_FONT
        c.fill = _HEADER_FILL
        c.border = _BORDER
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[top].height = 30
    for i, row in enumerate(rows):
        r = top + 1 + i
        for j, v in enumerate(row, 1):
            c = ws.cell(row=r, column=j, value=v)
            c.font = _BODY_FONT
            c.border = _BORDER
            fmt = fmts[j - 1]
            if fmt:
                c.number_format = fmt
            if (j - 1) in center:
                c.alignment = Alignment(horizontal="center", vertical="center")
            elif fmt:
                c.alignment = Alignment(horizontal="right", vertical="center")
            else:
                c.alignment = Alignment(horizontal="left", vertical="center")
            if i % 2 == 1:
                c.fill = _ZEBRA_FILL
    first, last = top + 1, top + len(rows)
    nxt = last + 1
    if total is not None:
        for j, v in enumerate(total, 1):
            c = ws.cell(row=nxt, column=j, value=v)
            c.font = _TOTAL_FONT
            c.fill = _TOTAL_FILL
            c.border = _TOTAL_BORDER
            fmt = fmts[j - 1]
            if fmt:
                c.number_format = fmt
            c.alignment = Alignment(
                horizontal="right" if fmt and (j - 1) not in center else ("center" if (j - 1) in center else "left"),
                vertical="center",
            )
        ws.row_dimensions[nxt].height = 22
        nxt += 1
    if rows and first_filter:
        ws.auto_filter.ref = f"A{top}:{_col(n)}{last}"
    return first, last, nxt


def _data_bars(ws, col: int, first: int, last: int, color: str = "FDBA74") -> None:
    if last >= first:
        ws.conditional_formatting.add(
            f"{_col(col)}{first}:{_col(col)}{last}",
            DataBarRule(start_type="num", start_value=0, end_type="max", color=color, showValue=True),
        )


def _margin_scale(ws, col: int, first: int, last: int) -> None:
    if last >= first:
        ws.conditional_formatting.add(
            f"{_col(col)}{first}:{_col(col)}{last}",
            ColorScaleRule(
                start_type="num", start_value=0, start_color="FCA5A5",
                mid_type="num", mid_value=0.5, mid_color="FEF3C7",
                end_type="num", end_value=1, end_color="86EFAC",
            ),
        )


def _autowidth(ws, start_row: int = 4, min_w: int = 11, max_w: int = 46) -> None:
    widths: dict[int, int] = {}
    for row in ws.iter_rows(min_row=start_row):
        for c in row:
            v = c.value
            if v is None:
                continue
            if isinstance(v, datetime):
                ln = 17
            elif isinstance(v, date):
                ln = 11
            elif isinstance(v, (int, float)):
                f = c.number_format or ""
                ln = 7 if "%" in f else len(f"{v:,.2f}") + (3 if "$" in f else 0)
            else:
                ln = max(len(part) for part in str(v).split("\n"))
            widths[c.column] = max(widths.get(c.column, 0), ln)
    for col, ln in widths.items():
        ws.column_dimensions[_col(col)].width = max(min_w, min(max_w, ln + 4))


def _finish(ws, header_row: int | None, tab: str = ORANGE, landscape: bool = True) -> None:
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = tab
    if header_row:
        ws.freeze_panes = f"A{header_row + 1}"
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True


def _style_axes(ch) -> None:
    ch.x_axis.delete = False
    ch.y_axis.delete = False
    ch.y_axis.number_format = '"$" #,##0'
    ch.y_axis.majorGridlines.spPr = None


def _line_chart(ws_data, title, cat_col, val_col, top, first, last, w=22, h=8.5):
    ch = LineChart()
    ch.title = title
    ch.height, ch.width = h, w
    ch.add_data(Reference(ws_data, min_col=val_col, min_row=top, max_row=last), titles_from_data=True)
    ch.set_categories(Reference(ws_data, min_col=cat_col, min_row=first, max_row=last))
    ch.legend = None
    s = ch.series[0]
    s.graphicalProperties.line.solidFill = ORANGE
    s.graphicalProperties.line.width = 32000
    s.smooth = True
    s.marker.symbol = "circle"
    s.marker.size = 6
    s.marker.graphicalProperties.solidFill = "FFFFFF"
    s.marker.graphicalProperties.line.solidFill = ORANGE
    _style_axes(ch)
    ch.x_axis.number_format = "dd/mm"
    return ch


def _bar_chart(ws_data, title, cat_col, val_cols, top, first, last, w=22, h=8.5, horizontal=False, legend=False):
    ch = BarChart()
    ch.type = "bar" if horizontal else "col"
    ch.title = title
    ch.height, ch.width = h, w
    for k, vc in enumerate(val_cols):
        ch.add_data(Reference(ws_data, min_col=vc, min_row=top, max_row=last), titles_from_data=True)
    ch.set_categories(Reference(ws_data, min_col=cat_col, min_row=first, max_row=last))
    for k, s in enumerate(ch.series):
        s.graphicalProperties.solidFill = PALETTE[k % len(PALETTE)] if len(val_cols) > 1 else ORANGE
        s.graphicalProperties.line.solidFill = "FFFFFF"
    ch.gapWidth = 60
    if not legend:
        ch.legend = None
    _style_axes(ch)
    if horizontal:
        ch.x_axis.scaling.orientation = "maxMin"
    return ch


def _pie_chart(ws_data, title, cat_col, val_col, top, first, last, w=13, h=8.5):
    ch = PieChart()
    ch.title = title
    ch.height, ch.width = h, w
    ch.add_data(Reference(ws_data, min_col=val_col, min_row=top, max_row=last), titles_from_data=True)
    ch.set_categories(Reference(ws_data, min_col=cat_col, min_row=first, max_row=last))
    s = ch.series[0]
    for i in range(last - first + 1):
        pt = DataPoint(idx=i)
        pt.graphicalProperties.solidFill = PALETTE[i % len(PALETTE)]
        pt.graphicalProperties.line.solidFill = "FFFFFF"
        s.dPt.append(pt)
    ch.dataLabels = DataLabelList()
    ch.dataLabels.showPercent = True
    ch.dataLabels.showVal = False
    ch.dataLabels.showLegendKey = False
    ch.dataLabels.showCatName = False
    ch.dataLabels.showSerName = False
    ch.dataLabels.showLeaderLines = False
    return ch


def _kpi(ws, row: int, col: int, label: str, value, fmt: str | None, accent: str = ORANGE) -> None:
    """A 2-column × 2-row KPI card: small label over a big figure."""
    soft = PatternFill("solid", fgColor=CREAM)
    white = Side(style="thick", color="FFFFFF")
    edge = Side(style="medium", color=accent)
    ws.merge_cells(start_row=row, start_column=col, end_row=row, end_column=col + 1)
    ws.merge_cells(start_row=row + 1, start_column=col, end_row=row + 1, end_column=col + 1)
    lab = ws.cell(row=row, column=col, value=label.upper())
    lab.font = Font(name="Calibri", bold=True, size=9, color=GREY)
    lab.alignment = Alignment(horizontal="left", vertical="bottom", indent=1)
    val = ws.cell(row=row + 1, column=col, value=value)
    val.font = Font(name="Calibri", bold=True, size=20, color=accent)
    val.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    if fmt:
        val.number_format = fmt
    for r in (row, row + 1):
        for cc in (col, col + 1):
            cell = ws.cell(row=r, column=cc)
            cell.fill = soft
            cell.border = Border(
                left=white if cc == col else None,
                right=white if cc == col + 1 else None,
                top=edge if r == row else None,
                bottom=white if r == row + 1 else None,
            )
    ws.row_dimensions[row].height = 20
    ws.row_dimensions[row + 1].height = 34


def _highlights(ws, top: int, L: dict, items: list[tuple[str, str, str]], ncols: int = 8) -> int:
    """Indicator | result | detail table across the summary sheet. Returns next free row."""
    spans = [(1, 3), (4, 5), (6, ncols)]
    for (a, b), text in zip(spans, (L["indicator"], L["result"], L["detail"])):
        ws.merge_cells(start_row=top, start_column=a, end_row=top, end_column=b)
        for j in range(a, b + 1):
            c = ws.cell(row=top, column=j)
            c.fill = _HEADER_FILL
            c.border = _BORDER
        h = ws.cell(row=top, column=a, value=text)
        h.font = _HEADER_FONT
        h.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[top].height = 24
    r = top + 1
    for i, (name, result, detail) in enumerate(items):
        for (a, b), text, bold in zip(spans, (name, result, detail), (True, True, False)):
            ws.merge_cells(start_row=r, start_column=a, end_row=r, end_column=b)
            for j in range(a, b + 1):
                c = ws.cell(row=r, column=j)
                c.border = _BORDER
                if i % 2 == 1:
                    c.fill = _ZEBRA_FILL
            c = ws.cell(row=r, column=a, value=text)
            c.font = Font(name="Calibri", bold=bold, size=11, color=DARK if bold else GREY)
            c.alignment = Alignment(horizontal="left", vertical="center", indent=1, wrap_text=True)
        ws.row_dimensions[r].height = 22
        r += 1
    return r


def _fmt_money_text(cents) -> str:
    return "$ {:,.0f}".format((cents or 0) / 100).replace(",", ".")


def _pay_label(raw: str | None, L: dict) -> str:
    key = (raw or "").strip().lower()
    if not key:
        return L["unspecified"]
    return {
        "cash": L["pay_cash"],
        "terminal": L["pay_terminal"],
        "card": L["pay_terminal"],
        "stripe": L["pay_stripe"],
        "other": L["pay_other"],
    }.get(key, key.replace("_", " ").title())


def _localize_names(data: dict, rows: list[dict], L: dict, category_labels=None, lang: str | None = None):
    """Show categories as the app does (owner's rename > built-in translation) and translate placeholders."""
    from .category_codes import get_public_category_display_label

    overrides = category_labels or {}

    def cat(v):
        if not v or v == "Uncategorized":
            return L["uncategorized"]
        return overrides.get(v) or get_public_category_display_label(v, lang or "es")

    def wtr(v):
        return L["unassigned"] if (not v or v == "Unassigned") else v

    rows = [{**r, "category": cat(r.get("category")), "waiter_name": wtr(r.get("waiter_name"))} for r in rows]
    if data:
        data = {
            **data,
            "by_category": [{**c, "category": cat(c["category"])} for c in data["by_category"]],
            "by_product": [{**p, "category": cat(p.get("category"))} for p in data["by_product"]],
            "by_waiter": [{**w, "waiter_name": wtr(w["waiter_name"])} for w in data["by_waiter"]],
        }
    return data, rows


def _abc(cum: float, L: dict) -> str:
    return "A" if cum <= 0.8 else ("B" if cum <= 0.95 else "C")


def _period(from_date: date, to_date: date) -> str:
    return f"{from_date:%d/%m/%Y} – {to_date:%d/%m/%Y}"


def _subtitle(L: dict, tenant_name: str, from_date: date, to_date: date, tz: ZoneInfo) -> str:
    now = datetime.now(tz).strftime("%d/%m/%Y %H:%M")
    head = f"{tenant_name}  ·  " if tenant_name else ""
    return f"{head}{L['period']}: {_period(from_date, to_date)}  ·  {L['generated']}: {now}"


# ----------------------------------------------------------------------------- sales workbook


def build_sales_workbook(
    data: dict,
    rows: list[dict],
    lang: str | None,
    tenant_name: str = "",
    tz_name: str | None = None,
    category_labels: dict[str, str] | None = None,
) -> Workbook:
    """Multi-sheet analytical workbook for the report range described by ``data``."""
    L = labels(lang)
    tz = _tz(tz_name)
    data, rows = _localize_names(data, rows, L, category_labels, lang)
    s = data["summary"]
    from_date = date.fromisoformat(data["from_date"])
    to_date = date.fromisoformat(data["to_date"])
    total_rev = s["total_revenue_cents"]
    total_cost = s.get("total_cost_cents", 0)
    total_profit = s.get("total_profit_cents", 0)
    has_cost = total_cost > 0
    sub = _subtitle(L, tenant_name, from_date, to_date, tz)

    wb = Workbook()
    summary_ws = wb.active
    summary_ws.title = L["sheet_summary"]

    # ---------------------------------------------------------------- by day
    ws_day = wb.create_sheet(L["sheet_daily"])
    daily = s["daily"]
    head = [L["date"], L["weekday"], L["orders"], L["revenue"]]
    fm = [DATE_FMT, None, INT, MONEY]
    if has_cost:
        head += [L["cost"], L["profit"], L["margin"]]
        fm += [MONEY, MONEY, PCT]
    head += [L["tips"], L["ticket"]]
    fm += [MONEY, MONEY]
    ncols = len(head)
    _banner(ws_day, f"{L['sheet_daily']} · {L['report_title']}", sub, ncols)
    day_rows = []
    for d in daily:
        dd = date.fromisoformat(d["date"])
        r = [dd, L["weekdays"][dd.weekday()], d["order_count"], _money(d["revenue_cents"])]
        if has_cost:
            r += [_money(d.get("cost_cents", 0)), _money(d.get("profit_cents", 0)),
                  _ratio(d.get("profit_cents", 0), d["revenue_cents"])]
        r += [_money(d.get("tips_cents", 0)), _money(_ratio(d["revenue_cents"], d["order_count"]))]
        day_rows.append(r)
    tot = [L["total"], "", s["total_orders"], _money(total_rev)]
    if has_cost:
        tot += [_money(total_cost), _money(total_profit), _ratio(total_profit, total_rev)]
    tot += [_money(s.get("total_tips_cents", 0)), _money(s.get("average_revenue_per_order_cents", 0))]
    day_top = 4
    d_first, d_last, nxt = _table(ws_day, day_top, head, day_rows, fm, total=tot, center=(1,))
    _data_bars(ws_day, 4, d_first, d_last)
    if has_cost:
        _margin_scale(ws_day, 7, d_first, d_last)
    _autowidth(ws_day)
    if day_rows:
        ch = _line_chart(ws_day, L["chart_daily"], 1, 4, day_top, d_first, d_last)
        ws_day.add_chart(ch, f"A{nxt + 2}")
    _finish(ws_day, day_top)

    # ---------------------------------------------------------------- products (ABC)
    ws_p = wb.create_sheet(L["sheet_products"])
    head = [L["rank"], L["product"], L["category"], L["quantity"], L["revenue"]]
    fm = [INT, None, None, QTY, MONEY]
    if has_cost:
        head += [L["cost"], L["profit"], L["margin"]]
        fm += [MONEY, MONEY, PCT]
    head += [L["share"], L["cumulative"], L["abc"]]
    fm += [PCT, PCT, None]
    _banner(ws_p, f"{L['sheet_products']} · {L['report_title']}", sub, len(head))
    prow, cum = [], 0.0
    for i, p in enumerate(data["by_product"], 1):
        share = _ratio(p["revenue_cents"], total_rev)
        cum += share
        r = [i, p["product_name"], p.get("category", ""), p["quantity"], _money(p["revenue_cents"])]
        if has_cost:
            r += [_money(p.get("cost_cents", 0)), _money(p.get("profit_cents", 0)),
                  _ratio(p.get("profit_cents", 0), p["revenue_cents"])]
        r += [share, min(cum, 1.0), _abc(cum - share, L)]
        prow.append(r)
    tot = ["", L["total"], "", sum(p["quantity"] for p in data["by_product"]), _money(total_rev)]
    if has_cost:
        tot += [_money(total_cost), _money(total_profit), _ratio(total_profit, total_rev)]
    tot += [1.0 if prow else 0, "", ""]
    p_top = 4
    p_first, p_last, nxt = _table(ws_p, p_top, head, prow, fm, total=tot, center=(0, len(head) - 1))
    _data_bars(ws_p, 5, p_first, p_last)
    if has_cost:
        _margin_scale(ws_p, 8, p_first, p_last)
    _autowidth(ws_p)
    ws_p.column_dimensions["A"].width = 6
    ws_p.cell(row=nxt + 1, column=2, value=L["abc_hint"]).font = Font(italic=True, size=10, color=GREY)
    if has_cost:
        ws_p.cell(row=nxt + 2, column=2, value=L["cost_hint"]).font = Font(italic=True, size=10, color=GREY)
    top_n = min(10, len(prow))
    if top_n:
        ch = _bar_chart(ws_p, L["chart_top_products"], 2, [5], p_top, p_first, p_first + top_n - 1,
                        w=24, h=9, horizontal=True)
        ws_p.add_chart(ch, f"B{nxt + 4}")
    _finish(ws_p, p_top, tab="059669")

    # ---------------------------------------------------------------- categories
    ws_c = wb.create_sheet(L["sheet_categories"])
    head = [L["category"], L["quantity"], L["revenue"]]
    fm = [None, QTY, MONEY]
    if has_cost:
        head += [L["cost"], L["profit"], L["margin"]]
        fm += [MONEY, MONEY, PCT]
    head += [L["share"]]
    fm += [PCT]
    _banner(ws_c, f"{L['sheet_categories']} · {L['report_title']}", sub, len(head))
    crow = []
    for c in data["by_category"]:
        r = [c["category"], c["quantity"], _money(c["revenue_cents"])]
        if has_cost:
            r += [_money(c.get("cost_cents", 0)), _money(c.get("profit_cents", 0)),
                  _ratio(c.get("profit_cents", 0), c["revenue_cents"])]
        r += [_ratio(c["revenue_cents"], total_rev)]
        crow.append(r)
    tot = [L["total"], sum(c["quantity"] for c in data["by_category"]), _money(total_rev)]
    if has_cost:
        tot += [_money(total_cost), _money(total_profit), _ratio(total_profit, total_rev)]
    tot += [1.0 if crow else 0]
    c_top = 4
    c_first, c_last, nxt = _table(ws_c, c_top, head, crow, fm, total=tot)
    _data_bars(ws_c, 3, c_first, c_last, "C4B5FD")
    if has_cost:
        _margin_scale(ws_c, 6, c_first, c_last)
    _autowidth(ws_c)
    if crow:
        ws_c.add_chart(_pie_chart(ws_c, L["chart_categories"], 1, 3, c_top, c_first, c_last), f"A{nxt + 2}")
    _finish(ws_c, c_top, tab="7C3AED")

    # ---------------------------------------------------------------- tables
    ws_t = wb.create_sheet(L["sheet_tables"])
    head = [L["table"], L["orders"], L["revenue"], L["ticket"]]
    fm = [None, INT, MONEY, MONEY]
    if has_cost:
        head += [L["cost"], L["profit"]]
        fm += [MONEY, MONEY]
    head += [L["share"]]
    fm += [PCT]
    _banner(ws_t, f"{L['sheet_tables']} · {L['report_title']}", sub, len(head))
    trow = []
    for t in data["by_table"]:
        r = [t["table_name"], t["order_count"], _money(t["revenue_cents"]),
             _money(_ratio(t["revenue_cents"], t["order_count"]))]
        if has_cost:
            r += [_money(t.get("cost_cents", 0)), _money(t.get("profit_cents", 0))]
        r += [_ratio(t["revenue_cents"], total_rev)]
        trow.append(r)
    tot = [L["total"], s["total_orders"], _money(total_rev), _money(s.get("average_revenue_per_order_cents", 0))]
    if has_cost:
        tot += [_money(total_cost), _money(total_profit)]
    tot += [1.0 if trow else 0]
    t_first, t_last, _ = _table(ws_t, 4, head, trow, fm, total=tot)
    _data_bars(ws_t, 3, t_first, t_last, "FCA5A5")
    _autowidth(ws_t)
    _finish(ws_t, 4, tab="DC2626")

    # ---------------------------------------------------------------- waiters
    ws_w = wb.create_sheet(L["sheet_waiters"])
    head = [L["waiter"], L["orders"], L["revenue"], L["ticket"], L["tips"], L["tips_pct"]]
    fm = [None, INT, MONEY, MONEY, MONEY, PCT]
    if has_cost:
        head += [L["cost"], L["profit"]]
        fm += [MONEY, MONEY]
    head += [L["share"]]
    fm += [PCT]
    _banner(ws_w, f"{L['sheet_waiters']} · {L['report_title']}", sub, len(head))
    wrow = []
    for w in data["by_waiter"]:
        r = [w["waiter_name"], w["order_count"], _money(w["revenue_cents"]),
             _money(_ratio(w["revenue_cents"], w["order_count"])), _money(w.get("tips_cents", 0)),
             _ratio(w.get("tips_cents", 0), w["revenue_cents"])]
        if has_cost:
            r += [_money(w.get("cost_cents", 0)), _money(w.get("profit_cents", 0))]
        r += [_ratio(w["revenue_cents"], total_rev)]
        wrow.append(r)
    tot = [L["total"], s["total_orders"], _money(total_rev), _money(s.get("average_revenue_per_order_cents", 0)),
           _money(s.get("total_tips_cents", 0)), _ratio(s.get("total_tips_cents", 0), total_rev)]
    if has_cost:
        tot += [_money(total_cost), _money(total_profit)]
    tot += [1.0 if wrow else 0]
    w_first, w_last, _ = _table(ws_w, 4, head, wrow, fm, total=tot)
    _data_bars(ws_w, 3, w_first, w_last)
    _autowidth(ws_w)
    _finish(ws_w, 4, tab="2563EB")

    # ---------------------------------------------------------------- payment methods
    pay: dict[str, dict] = defaultdict(lambda: {"rev": 0, "orders": set()})
    for r in rows:
        k = _pay_label(r.get("payment_method"), L)
        pay[k]["rev"] += r["revenue_cents"]
        pay[k]["orders"].add(r["order_id"])
    ws_pay = wb.create_sheet(L["sheet_payments"])
    head = [L["payment"], L["orders"], L["revenue"], L["ticket"], L["share"]]
    fm = [None, INT, MONEY, MONEY, PCT]
    _banner(ws_pay, f"{L['sheet_payments']} · {L['report_title']}", sub, len(head))
    pay_sorted = sorted(pay.items(), key=lambda kv: -kv[1]["rev"])
    prows = [[k, len(v["orders"]), _money(v["rev"]), _money(_ratio(v["rev"], len(v["orders"]))),
              _ratio(v["rev"], total_rev)] for k, v in pay_sorted]
    tot = [L["total"], s["total_orders"], _money(total_rev), _money(s.get("average_revenue_per_order_cents", 0)),
           1.0 if prows else 0]
    pay_first, pay_last, nxt = _table(ws_pay, 4, head, prows, fm, total=tot)
    _data_bars(ws_pay, 3, pay_first, pay_last, "86EFAC")
    _autowidth(ws_pay)
    if prows:
        ws_pay.add_chart(_pie_chart(ws_pay, L["sheet_payments"], 1, 3, 4, pay_first, pay_last), f"A{nxt + 2}")
    _finish(ws_pay, 4, tab="0E7490")

    # ---------------------------------------------------------------- hours & weekdays
    wd: dict[int, dict] = defaultdict(lambda: {"rev": 0, "orders": set(), "days": set()})
    hr: dict[int, dict] = defaultdict(lambda: {"rev": 0, "orders": set()})
    for r in rows:
        loc = r["date"]  # already restaurant-local wall clock
        if loc is None:
            continue
        wd[loc.weekday()]["rev"] += r["revenue_cents"]
        wd[loc.weekday()]["orders"].add(r["order_id"])
        wd[loc.weekday()]["days"].add(loc.date())
        hr[loc.hour]["rev"] += r["revenue_cents"]
        hr[loc.hour]["orders"].add(r["order_id"])
    ws_h = wb.create_sheet(L["sheet_time"])
    _banner(ws_h, f"{L['sheet_time']} · {L['report_title']}", sub, 5)
    wd_head = [L["weekday"], L["orders"], L["revenue"], L["ticket"], L["share"]]
    wd_fm = [None, INT, MONEY, MONEY, PCT]
    wd_rows = []
    for i in range(7):
        v = wd.get(i)
        if not v:
            wd_rows.append([L["weekdays"][i], 0, 0.0, 0.0, 0.0])
            continue
        wd_rows.append([L["weekdays"][i], len(v["orders"]), _money(v["rev"]),
                        _money(_ratio(v["rev"], len(v["orders"]))), _ratio(v["rev"], total_rev)])
    _section(ws_h, 4, L["weekday"], 5)
    wf, wl, nxt = _table(ws_h, 5, wd_head, wd_rows, wd_fm, first_filter=False)
    _data_bars(ws_h, 3, wf, wl, "FDBA74")
    hr_rows = [[f"{h:02d}:00", len(v["orders"]), _money(v["rev"]),
                _money(_ratio(v["rev"], len(v["orders"]))), _ratio(v["rev"], total_rev)]
               for h, v in sorted(hr.items())]
    sec2 = nxt + 1
    _section(ws_h, sec2, L["hour"], 5)
    hf, hl, nxt = _table(ws_h, sec2 + 1, [L["hour"], L["orders"], L["revenue"], L["ticket"], L["share"]],
                         hr_rows, [None, INT, MONEY, MONEY, PCT], first_filter=False, center=(0,))
    _data_bars(ws_h, 3, hf, hl, "FDBA74")
    _autowidth(ws_h)
    if hr_rows:
        ch = _bar_chart(ws_h, L["chart_hours"], 1, [3], sec2 + 1, hf, hl, w=22, h=8.5)
        ws_h.add_chart(ch, f"G4")
    _finish(ws_h, None, tab="F59E0B")

    # ---------------------------------------------------------------- reservations
    res = data.get("reservations") or {}
    ws_r = wb.create_sheet(L["sheet_reservations"])
    _banner(ws_r, f"{L['sheet_reservations']} · {L['report_title']}", sub, 3)
    all_count = res.get("all_count", 0)
    r_rows = [[L.get(f"res_status_{x['status']}", x["status"]), x["count"], _ratio(x["count"], all_count)]
              for x in res.get("by_status", [])]
    rf, rl, nxt = _table(ws_r, 4, [L["status"], L["count"], L["share"]], r_rows, [None, INT, PCT],
                         total=[L["total"], all_count, 1.0 if r_rows else 0], first_filter=False)
    _data_bars(ws_r, 2, rf, rl, "C4B5FD")
    extra = [
        [L["res_active"], res.get("active_count", 0)],
        [L["res_finished"], res.get("total", 0)],
        [L["res_all"], all_count],
        [L["res_overbooking"], res.get("overbooking_slots_count", 0)],
    ]
    _section(ws_r, nxt + 1, L["sheet_reservations"], 3)
    _table(ws_r, nxt + 2, [L["indicator"], L["result"]], extra, [None, INT], first_filter=False)
    _autowidth(ws_r)
    _finish(ws_r, None, tab="A78BFA")

    # ---------------------------------------------------------------- summary (dashboard)
    ws = summary_ws
    _banner(ws, f"{L['report_title']} · {L['sheet_summary']}", sub, 8)
    for j in range(1, 9):
        ws.column_dimensions[_col(j)].width = 17
    avg_ticket = s.get("average_revenue_per_order_cents", 0)
    cards = [(L["kpi_revenue"], _money(total_rev), MONEY, ORANGE)]
    if has_cost:
        cards += [(L["kpi_cost"], _money(total_cost), MONEY, "475569"),
                  (L["kpi_profit"], _money(total_profit), MONEY, GREEN),
                  (L["kpi_margin"], _ratio(total_profit, total_rev), PCT, GREEN)]
    cards += [(L["kpi_tips"], _money(s.get("total_tips_cents", 0)), MONEY, "DB2777"),
              (L["kpi_orders"], s["total_orders"], INT, "2563EB"),
              (L["kpi_ticket"], _money(avg_ticket), MONEY, "0E7490"),
              (L["kpi_days"], len(daily), INT, "7C3AED")]
    for i, (lab, val, fmt, color) in enumerate(cards[:8]):
        _kpi(ws, 4 + (i // 4) * 3, 1 + (i % 4) * 2, lab, val, fmt, color)
    next_row = 4 + ((len(cards[:8]) - 1) // 4) * 3 + 3

    # highlights
    hl_items: list[tuple[str, str, str]] = []
    none = L["none"]
    if daily:
        best = max(daily, key=lambda d: d["revenue_cents"])
        worst = min(daily, key=lambda d: d["revenue_cents"])
        for key, d in (("best_day", best), ("worst_day", worst)):
            dd = date.fromisoformat(d["date"])
            hl_items.append((L[key], f"{dd:%d/%m/%Y} ({L['weekdays'][dd.weekday()]})",
                             f"{_fmt_money_text(d['revenue_cents'])} · {d['order_count']} {L['orders_word']}"))
    if data["by_product"]:
        tp = max(data["by_product"], key=lambda p: p["quantity"])
        hl_items.append((L["top_product"], tp["product_name"],
                         f"{tp['quantity']} {L['units_word']} · {_fmt_money_text(tp['revenue_cents'])}"))
        if has_cost:
            pp = max(data["by_product"], key=lambda p: p.get("profit_cents", 0))
            hl_items.append((L["top_profit_product"], pp["product_name"],
                             f"{_fmt_money_text(pp.get('profit_cents', 0))} {L['kpi_profit'].lower()}"))
    if data["by_category"]:
        tc = data["by_category"][0]
        hl_items.append((L["top_category"], tc["category"],
                         f"{_ratio(tc['revenue_cents'], total_rev):.0%} {L['of_revenue']}"))
    if data["by_table"]:
        tt = data["by_table"][0]
        hl_items.append((L["top_table"], tt["table_name"],
                         f"{_fmt_money_text(tt['revenue_cents'])} · {tt['order_count']} {L['orders_word']}"))
    if data["by_waiter"]:
        tw = data["by_waiter"][0]
        hl_items.append((L["top_waiter"], tw["waiter_name"],
                         f"{_fmt_money_text(tw['revenue_cents'])} · {tw['order_count']} {L['orders_word']}"))
    if hr:
        ph, pv = max(hr.items(), key=lambda kv: kv[1]["rev"])
        hl_items.append((L["peak_hour"], f"{ph:02d}:00 – {ph + 1:02d}:00",
                         f"{_fmt_money_text(pv['rev'])} · {len(pv['orders'])} {L['orders_word']}"))
    if wd:
        bw, bv = max(wd.items(), key=lambda kv: kv[1]["rev"])
        hl_items.append((L["best_weekday"], L["weekdays"][bw], _fmt_money_text(bv["rev"])))
    if pay_sorted:
        pk, pv = pay_sorted[0]
        hl_items.append((L["top_payment"], pk, f"{_ratio(pv['rev'], total_rev):.0%} {L['of_revenue']}"))
    if not hl_items:
        hl_items.append((none, none, none))
    _section(ws, next_row, L["highlights"], 8)
    next_row = _highlights(ws, next_row + 1, L, hl_items) + 1

    # charts on the dashboard
    if day_rows:
        ws.add_chart(_line_chart(ws_day, L["chart_daily"], 1, 4, day_top, d_first, d_last, w=15.5, h=8), f"A{next_row}")
    if crow:
        ws.add_chart(_pie_chart(ws_c, L["chart_categories"], 1, 3, c_top, c_first, c_last, w=13.5, h=8), f"E{next_row}")
    _finish(ws, None, landscape=False)

    neutralize_workbook(wb)
    return wb


# ----------------------------------------------------------------------------- detailed workbook


def build_detailed_workbook(
    income_rows: list[dict],
    expense_rows: list[dict],
    from_date: date,
    to_date: date,
    lang: str | None,
    tenant_name: str = "",
    tz_name: str | None = None,
    category_labels: dict[str, str] | None = None,
) -> Workbook:
    """Line-by-line income and expenses with a net analysis."""
    L = labels(lang)
    tz = _tz(tz_name)
    _, income_rows = _localize_names({}, income_rows, L, category_labels, lang)
    sub = _subtitle(L, tenant_name, from_date, to_date, tz)
    income_total = sum(r["revenue_cents"] for r in income_rows)
    cost_total = sum(r["cost_cents"] for r in income_rows)
    has_cost = cost_total > 0
    expense_total = sum(r["line_total_cents"] for r in expense_rows)
    net_total = income_total - expense_total
    order_ids = {r["order_id"] for r in income_rows}
    po_numbers = {r["order_number"] for r in expense_rows}
    suppliers = {r["supplier_name"] for r in expense_rows if r["supplier_name"]}

    wb = Workbook()
    summary_ws = wb.active
    summary_ws.title = L["sheet_summary"]

    # ------------------------------------------------ income lines
    ws_i = wb.create_sheet(L["sheet_income"])
    head = [L["datetime"], L["order"], L["table"], L["waiter"], L["customer"], L["payment"],
            L["product"], L["category"], L["quantity"], L["unit_price"], L["revenue"]]
    fm = [DATETIME_FMT, INT, None, None, None, None, None, None, QTY, MONEY, MONEY]
    if has_cost:
        head += [L["cost"], L["profit"], L["margin"]]
        fm += [MONEY, MONEY, PCT]
    _banner(ws_i, f"{L['sheet_income']} · {L['detailed_title']}", sub, len(head))
    irows = []
    for r in sorted(income_rows, key=lambda x: (x["date"] is None, x["date"])):
        row = [r["date"], r["order_id"], r["table_name"], r["waiter_name"], r["customer_name"],
               _pay_label(r.get("payment_method"), L), r["product_name"], r["category"], r["quantity"],
               _money(r["price_cents"]), _money(r["revenue_cents"])]
        if has_cost:
            row += [_money(r["cost_cents"]), _money(r["profit_cents"]), _ratio(r["profit_cents"], r["revenue_cents"])]
        irows.append(row)
    tot = [L["total"]] + [""] * 7 + [sum(r["quantity"] for r in income_rows), "", _money(income_total)]
    if has_cost:
        tot += [_money(cost_total), _money(income_total - cost_total), _ratio(income_total - cost_total, income_total)]
    i_first, i_last, _ = _table(ws_i, 4, head, irows, fm, total=tot, center=(1,))
    _data_bars(ws_i, 11, i_first, i_last)
    if has_cost:
        _margin_scale(ws_i, 14, i_first, i_last)
    _autowidth(ws_i)
    _finish(ws_i, 4, tab="059669")

    # ------------------------------------------------ expense lines
    ws_e = wb.create_sheet(L["sheet_expenses"])
    head = [L["datetime"], L["order"], L["supplier"], L["status"], L["item"], L["qty_received"], L["unit"],
            L["unit_cost"], L["line_total"]]
    fm = [DATETIME_FMT, None, None, None, None, QTY, None, MONEY, MONEY]
    _banner(ws_e, f"{L['sheet_expenses']} · {L['detailed_title']}", sub, len(head))
    erows = []
    for r in sorted(expense_rows, key=lambda x: (x["date"] is None, x["date"])):
        erows.append([_local(r["date"], tz), r["order_number"], r["supplier_name"],
                      L.get(f"po_{r['status']}", r["status"]), r["item_name"], r["quantity_received"], r["unit"],
                      _money(r["unit_cost_cents"]), _money(r["line_total_cents"])])
    tot = [L["total"], "", "", "", "", "", "", "", _money(expense_total)]
    e_first, e_last, _ = _table(ws_e, 4, head, erows, fm, total=tot)
    _data_bars(ws_e, 9, e_first, e_last, "FCA5A5")
    _autowidth(ws_e)
    _finish(ws_e, 4, tab="DC2626")

    # ------------------------------------------------ income vs expenses by day
    inc_day: dict[date, int] = defaultdict(int)
    exp_day: dict[date, int] = defaultdict(int)
    for r in income_rows:
        if r["date"]:
            inc_day[r["date"].date()] += r["revenue_cents"]  # local naive
    for r in expense_rows:
        if r["date"]:
            exp_day[_local(r["date"], tz).date()] += r["line_total_cents"]
    days = sorted(set(inc_day) | set(exp_day))
    ws_d = wb.create_sheet(L["sheet_by_day"])
    head = [L["date"], L["weekday"], L["revenue"], L["expenses"], L["net"], L["net_cum"]]
    fm = [DATE_FMT, None, MONEY, MONEY, MONEY, MONEY]
    _banner(ws_d, f"{L['sheet_by_day']} · {L['detailed_title']}", sub, len(head))
    drows, cumulative = [], 0
    for d in days:
        net = inc_day.get(d, 0) - exp_day.get(d, 0)
        cumulative += net
        drows.append([d, L["weekdays"][d.weekday()], _money(inc_day.get(d, 0)), _money(exp_day.get(d, 0)),
                      _money(net), _money(cumulative)])
    d_first, d_last, nxt = _table(ws_d, 4, head, drows, fm,
                                  total=[L["total"], "", _money(income_total), _money(expense_total),
                                         _money(net_total), _money(net_total)], center=(1,))
    _data_bars(ws_d, 3, d_first, d_last, "86EFAC")
    _data_bars(ws_d, 4, d_first, d_last, "FCA5A5")
    _autowidth(ws_d)
    if drows:
        ch = _bar_chart(ws_d, L["chart_income_vs_expenses"], 1, [3, 4], 4, d_first, d_last, w=24, h=9, legend=True)
        ch.series[0].graphicalProperties.solidFill = "10B981"
        ch.series[1].graphicalProperties.solidFill = "EF4444"
        ws_d.add_chart(ch, f"A{nxt + 2}")
    _finish(ws_d, 4, tab=ORANGE)

    # ------------------------------------------------ expenses by supplier / item
    sup: dict[str, dict] = defaultdict(lambda: {"total": 0, "pos": set()})
    itm: dict[str, dict] = defaultdict(lambda: {"total": 0, "qty": 0.0, "unit": ""})
    for r in expense_rows:
        k = r["supplier_name"] or L["unspecified"]
        sup[k]["total"] += r["line_total_cents"]
        sup[k]["pos"].add(r["order_number"])
        it = itm[r["item_name"] or L["unspecified"]]
        it["total"] += r["line_total_cents"]
        it["qty"] += r["quantity_received"]
        it["unit"] = r["unit"]
    ws_s = wb.create_sheet(L["sheet_suppliers"])
    _banner(ws_s, f"{L['sheet_suppliers']} · {L['detailed_title']}", sub, 4)
    srows = [[k, len(v["pos"]), _money(v["total"]), _ratio(v["total"], expense_total)]
             for k, v in sorted(sup.items(), key=lambda kv: -kv[1]["total"])]
    s_first, s_last, nxt = _table(ws_s, 4, [L["supplier"], L["po_orders"], L["expenses"], L["share"]], srows,
                                  [None, INT, MONEY, PCT],
                                  total=[L["total"], len(po_numbers), _money(expense_total), 1.0 if srows else 0])
    _data_bars(ws_s, 3, s_first, s_last, "FCA5A5")
    _autowidth(ws_s)
    if srows:
        ws_s.add_chart(_pie_chart(ws_s, L["sheet_suppliers"], 1, 3, 4, s_first, min(s_last, s_first + 9)), f"A{nxt + 2}")
    _finish(ws_s, 4, tab="B91C1C")

    ws_x = wb.create_sheet(L["sheet_items"])
    _banner(ws_x, f"{L['sheet_items']} · {L['detailed_title']}", sub, 5)
    xrows = [[k, v["qty"], v["unit"], _money(v["total"]), _ratio(v["total"], expense_total)]
             for k, v in sorted(itm.items(), key=lambda kv: -kv[1]["total"])]
    x_first, x_last, _ = _table(ws_x, 4, [L["item"], L["qty_received"], L["unit"], L["expenses"], L["share"]],
                                xrows, [None, QTY, None, MONEY, PCT],
                                total=[L["total"], "", "", _money(expense_total), 1.0 if xrows else 0])
    _data_bars(ws_x, 4, x_first, x_last, "FCA5A5")
    _autowidth(ws_x)
    _finish(ws_x, 4, tab="B91C1C")

    # ------------------------------------------------ summary dashboard
    ws = summary_ws
    _banner(ws, f"{L['detailed_title']} · {L['sheet_summary']}", sub, 8)
    for j in range(1, 9):
        ws.column_dimensions[_col(j)].width = 17
    net_color = GREEN if net_total >= 0 else "B91C1C"
    cards = [
        (L["kpi_revenue"], _money(income_total), MONEY, GREEN),
        (L["kpi_expenses"], _money(expense_total), MONEY, "B91C1C"),
        (L["kpi_net"], _money(net_total), MONEY, net_color),
        (L["kpi_net_margin"], _ratio(net_total, income_total), PCT, net_color),
        (L["kpi_orders"], len(order_ids), INT, "2563EB"),
        (L["kpi_lines"], len(income_rows), INT, "0E7490"),
        (L["kpi_purchases"], len(po_numbers), INT, "7C3AED"),
        (L["kpi_suppliers"], len(suppliers), INT, "DB2777"),
    ]
    for i, (lab, val, fmt, color) in enumerate(cards):
        _kpi(ws, 4 + (i // 4) * 3, 1 + (i % 4) * 2, lab, val, fmt, color)
    next_row = 10
    hl: list[tuple[str, str, str]] = []
    if days:
        bd = max(days, key=lambda d: inc_day.get(d, 0) - exp_day.get(d, 0))
        wd_ = min(days, key=lambda d: inc_day.get(d, 0) - exp_day.get(d, 0))
        for key, d in (("best_day", bd), ("worst_day", wd_)):
            hl.append((L[key], f"{d:%d/%m/%Y} ({L['weekdays'][d.weekday()]})",
                       f"{L['kpi_net']}: {_fmt_money_text(inc_day.get(d, 0) - exp_day.get(d, 0))}"))
    if srows:
        k, v = max(sup.items(), key=lambda kv: kv[1]["total"])
        hl.append((L["top_supplier"], k, f"{_fmt_money_text(v['total'])} · {_ratio(v['total'], expense_total):.0%}"))
    if xrows:
        k, v = max(itm.items(), key=lambda kv: kv[1]["total"])
        hl.append((L["top_expense_item"], k, f"{_fmt_money_text(v['total'])} · {_ratio(v['total'], expense_total):.0%}"))
    if not hl:
        hl.append((L["none"], L["none"], L["none"]))
    _section(ws, next_row, L["highlights"], 8)
    next_row = _highlights(ws, next_row + 1, L, hl) + 1
    if drows:
        ch = _bar_chart(ws_d, L["chart_income_vs_expenses"], 1, [3, 4], 4, d_first, d_last, w=29, h=8.5, legend=True)
        ch.series[0].graphicalProperties.solidFill = "10B981"
        ch.series[1].graphicalProperties.solidFill = "EF4444"
        ws.add_chart(ch, f"A{next_row}")
    _finish(ws, None, landscape=False)

    neutralize_workbook(wb)
    return wb
