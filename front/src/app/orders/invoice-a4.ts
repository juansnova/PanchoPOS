import { DECOR_CSS, DECOR_HTML } from './invoice-a4-decor';

/**
 * Illustrated A4 invoice (cream paper, line-art decorations, banded table, totals box).
 * Pure function: data in, HTML out, so the page can be previewed without the app running.
 * Colours follow the restaurant logo; change ACCENT to re-theme.
 */

export interface InvoiceA4Line {
  name: string;
  detail?: string | null;
  quantity: number;
  unitCents: number;
  totalCents: number;
}

export interface InvoiceA4Data {
  logoUrl?: string | null;
  business: {
    name: string;
    address?: string | null;
    city?: string | null;
    phone?: string | null;
    taxId?: string | null;
    website?: string | null;
    whatsapp?: string | null;
  };
  invoiceNumber: string;
  dateLabel: string;
  tableName?: string | null;
  customerName?: string | null;
  billing?: { name: string; taxId?: string | null; address?: string | null; email?: string | null } | null;
  lines: InvoiceA4Line[];
  subtotalCents: number;
  extraChargeCents?: number;
  extraChargeNote?: string | null;
  tipCents?: number;
  tipLabel?: string;
  taxes: { rate: number; cents: number }[];
  totalCents: number;
  paid: boolean;
  paymentMethodLabel?: string | null;
  formatMoney: (cents: number) => string;
}

const ACCENT = '#df7d2e';
const INK = '#4a3b2c';
const MUTED = '#8a7a66';
const CREAM = '#fbf6ec';
const BAND = '#f8e6cc';
const BLOB = '#f6ddb8';
const LINE = '#9c8b6f';

function esc(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildInvoiceA4Html(d: InvoiceA4Data): string {
  const m = d.formatMoney;
  const hasLogo = !!d.logoUrl;

  const rows = d.lines
    .map(
      (l) => `<tr>
  <td class="c-desc">${esc(l.name)}${l.detail ? `<small>${esc(l.detail)}</small>` : ''}</td>
  <td class="c-qty">${l.quantity}</td>
  <td class="c-num">${m(l.unitCents)}</td>
  <td class="c-num">${m(l.totalCents)}</td>
</tr>`,
    )
    .join('');

  const totalsRows: string[] = [`<div class="t-row"><span>SUBTOTAL</span><b>${m(d.subtotalCents)}</b></div>`];
  if (d.extraChargeCents) {
    const note = d.extraChargeNote ? `<small>${esc(d.extraChargeNote)}</small>` : '';
    totalsRows.push(`<div class="t-row"><span>IMPORTE ADICIONAL${note}</span><b>${m(d.extraChargeCents)}</b></div>`);
  }
  if (d.tipCents) {
    totalsRows.push(`<div class="t-row"><span>${esc(d.tipLabel || 'PROPINA')}</span><b>${m(d.tipCents)}</b></div>`);
  }
  for (const t of d.taxes) {
    totalsRows.push(`<div class="t-row"><span>IVA ${t.rate}% <em>(incluido)</em></span><b>${m(t.cents)}</b></div>`);
  }

  const contact = [
    d.business.address && [d.business.address, d.business.city].filter(Boolean).join(', '),
    d.business.phone && `Tel: ${d.business.phone}`,
    d.business.whatsapp && `WhatsApp: ${d.business.whatsapp}`,
    d.business.website,
    d.business.taxId && `NIT/ID: ${d.business.taxId}`,
  ].filter(Boolean) as string[];

  const billing = d.billing
    ? `<div class="bill">
  <h4>FACTURAR A</h4>
  <p class="bill-name">${esc(d.billing.name)}</p>
  ${d.billing.taxId ? `<p>NIT/ID: ${esc(d.billing.taxId)}</p>` : ''}
  ${d.billing.address ? `<p>${esc(d.billing.address)}</p>` : ''}
  ${d.billing.email ? `<p>${esc(d.billing.email)}</p>` : ''}
</div>`
    : '';

  const meta = [d.tableName && `Mesa: ${esc(d.tableName)}`, d.customerName && `Cliente: ${esc(d.customerName)}`]
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Factura ${esc(d.invoiceNumber)}</title>
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #e9e3d6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif; color: ${INK}; }
.page { position: relative; display: flex; flex-direction: column; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 16mm 18mm 12mm; background: ${CREAM}; overflow: hidden; }
@media print { html, body { background: ${CREAM}; } .page { margin: 0; } }
${DECOR_CSS}
.content { position: relative; z-index: 1; flex: 1; display: flex; flex-direction: column; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; }
.brand img { display: block; max-height: 30mm; max-width: 68mm; margin-bottom: 6mm; }
.brand .name { font-size: 20pt; font-weight: 800; letter-spacing: .5px; margin: 0 0 4mm; }
.brand h1 { margin: 0; font-size: 26pt; letter-spacing: 3px; color: ${INK}; font-weight: 800; }
.brand h1::after { content: ''; display: block; width: 18mm; height: 1.4mm; margin-top: 2.5mm; border-radius: 1mm; background: ${ACCENT}; }
.info { text-align: right; padding-top: 4mm; }
.info .no { font-size: 17pt; font-weight: 700; letter-spacing: 1px; }
.info .no b { color: ${ACCENT}; }
.info p { margin: 1.5mm 0 0; font-size: 9.5pt; color: ${MUTED}; }
.bill { margin-top: 7mm; }
.bill h4 { margin: 0 0 1.5mm; font-size: 8.5pt; letter-spacing: 2px; color: ${ACCENT}; }
.bill p { margin: 0; font-size: 10pt; color: ${MUTED}; line-height: 1.5; }
.bill p.bill-name { color: ${INK}; font-weight: 700; font-size: 11pt; }
table { width: 100%; border-collapse: collapse; margin-top: 8mm; }
thead th { background: ${BAND}; padding: 3.2mm 4mm; font-size: 9pt; letter-spacing: 1.5px; font-weight: 700; text-align: left; }
thead th:nth-child(2) { text-align: center; } thead th:nth-child(n+3) { text-align: right; }
tbody td { padding: 3.2mm 4mm; font-size: 10.5pt; vertical-align: top; }
tbody tr:nth-child(even) td { background: ${BAND}; }
.c-desc small { display: block; margin-top: .8mm; font-size: 8.5pt; color: ${MUTED}; }
.c-qty { text-align: center; } .c-num { text-align: right; white-space: nowrap; }
tr { page-break-inside: avoid; }
.bottom { display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm; margin-top: auto; padding-top: 8mm; margin-bottom: 46mm; }
.contact { padding-bottom: 4mm; max-width: 78mm; }
.contact .thanks { font-size: 15pt; font-weight: 700; margin: 0 0 3mm; color: ${ACCENT}; }
.contact p { margin: 0; font-size: 9pt; color: ${MUTED}; line-height: 1.6; }
.totals { width: 82mm; background: ${BAND}; border-radius: 3mm; padding: 5mm 6mm; }
.t-row { display: flex; justify-content: space-between; gap: 6mm; padding: 1.6mm 0; font-size: 10pt; letter-spacing: .5px; }
.t-row b { white-space: nowrap; } .t-row em { font-style: normal; font-size: 8pt; color: ${MUTED}; }
.t-row small { display: block; margin-top: .6mm; font-size: 8pt; letter-spacing: 0; color: ${MUTED}; }
.t-total { display: flex; justify-content: space-between; align-items: baseline; margin-top: 2mm; padding-top: 3mm; border-top: 1.5px solid ${INK}; font-size: 15pt; font-weight: 800; }
.t-total b { color: ${ACCENT}; font-size: 17pt; }
.stamp { margin-top: 3mm; text-align: center; font-size: 9pt; letter-spacing: 3px; font-weight: 700; color: ${ACCENT}; }
</style></head><body>
<div class="page">
${DECOR_HTML}
<div class="content">
  <div class="top">
    <div class="brand">
      ${hasLogo ? `<img src="${esc(d.logoUrl)}" alt="${esc(d.business.name)}">` : `<p class="name">${esc(d.business.name)}</p>`}
      <h1>FACTURA</h1>
    </div>
    <div class="info">
      <div class="no">No. <b>${esc(d.invoiceNumber)}</b></div>
      <p>Fecha: ${esc(d.dateLabel)}</p>
      ${meta ? `<p>${meta}</p>` : ''}
    </div>
  </div>
  ${billing}
  <table>
    <thead><tr><th>DESCRIPCIÓN</th><th>CANT.</th><th>PRECIO</th><th>TOTAL</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="bottom">
    <div class="contact">
      <p class="thanks">¡Gracias por su visita!</p>
      <p><strong>${esc(d.business.name)}</strong></p>
      ${contact.map((c) => `<p>${esc(c)}</p>`).join('')}
    </div>
    <div class="totals">
      ${totalsRows.join('')}
      <div class="t-total"><span>TOTAL</span><b>${m(d.totalCents)}</b></div>
      ${d.paid ? `<div class="stamp">PAGADO${d.paymentMethodLabel ? ' · ' + esc(d.paymentMethodLabel).toUpperCase() : ''}</div>` : ''}
    </div>
  </div>
</div>
</div>
</body></html>`;
}
