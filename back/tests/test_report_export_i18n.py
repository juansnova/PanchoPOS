from app.report_export_i18n import report_export_labels


def test_report_export_german_headers():
    L = report_export_labels("de")
    assert L["sheet_summary"] == "Übersicht"
    assert L["revenue_cents"] == "Umsatz (Cent)"
    assert L["source_public"] == "Öffentlich (online)"
    assert L["res_status_booked"] == "Gebucht"


def test_report_export_lang_fallback_lowercase():
    L = report_export_labels("DE")
    assert L["waiter"] == "Kellner"


def test_report_export_bulgarian_headers():
    L = report_export_labels("bg")
    assert L["sheet_summary"] == "Обобщение"
    assert L["revenue_cents"] == "Приходи (стотинки)"
    assert L["res_status_no_show"] == "Неявяване"
