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

/** Hand-drawn style decorations, absolutely positioned behind the content. */
const DECORATIONS = `
<svg class="deco blob-top" viewBox="0 0 300 200" aria-hidden="true"><path d="M300 0v150c-40 40-110 50-150 10S90 60 130 30 230 0 300 0z" fill="${BLOB}"/></svg>
<svg class="deco blob-bottom" viewBox="0 0 320 260" aria-hidden="true"><path d="M0 40c60-30 130 10 160 70s90 60 160 40v110H0z" fill="${BLOB}"/></svg>
<svg class="deco sprig" viewBox="0 0 120 150" fill="none" stroke="${LINE}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20 5c18 25 22 60 14 100"/>
  <path d="M26 25c-14-4-22-14-22-24 14 0 24 8 22 24zM28 45c14-2 26-12 28-24-16 0-26 10-28 24zM30 65c-14-4-24-14-24-26 14 2 24 12 24 26zM32 85c14-4 26-14 28-28-16 2-26 14-28 28z"/>
  <path d="M26 25c-6-6-12-12-18-22M28 45c8-8 16-16 26-23M30 65c-8-6-16-14-22-24M32 85c10-10 18-18 26-27"/>
</svg>
<svg class="deco chili" viewBox="0 0 90 120" fill="none" stroke="${LINE}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M60 14c8 4 12 12 8 22-6 22-16 52-40 72-6 4-14 2-8-6 14-20 22-44 26-64 2-12 6-18 14-24z"/>
  <path d="M56 12c-2-6 2-10 8-10M52 20c4 6 10 10 14 14"/>
</svg>
<svg class="deco cutlery" viewBox="0 0 170 190" fill="none" stroke="${LINE}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <ellipse cx="46" cy="38" rx="22" ry="32"/><path d="M46 70c-3 30-6 60-8 110M46 70c3 30 6 60 8 110"/><path d="M38 180h16"/>
  <path d="M112 8v50c0 14 10 20 18 22M130 8v62M148 8v50c0 14-10 20-18 22"/><path d="M130 70c0 40 2 80 4 110"/><path d="M126 180h16"/>
</svg>
<svg class="deco dots" viewBox="0 0 200 200" fill="none" stroke="${LINE}" stroke-width="1.4" aria-hidden="true">
  <circle cx="18" cy="20" r="5"/><circle cx="170" cy="48" r="4"/><circle cx="60" cy="150" r="5"/><circle cx="150" cy="170" r="4"/>
  <path d="M110 60c10-18 28-20 36-14-2 14-14 24-36 14z"/>
</svg>`;

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
.page { position: relative; display: flex; flex-direction: column; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 20mm 18mm 16mm; background: ${CREAM}; overflow: hidden; }
@media print { html, body { background: ${CREAM}; } .page { margin: 0; } }
.deco { position: absolute; pointer-events: none; }
.blob-top { top: 0; right: 0; width: 95mm; }
.blob-bottom { bottom: 0; left: 0; width: 100mm; }
.sprig { top: 8mm; left: 98mm; width: 28mm; }
.chili { bottom: 9mm; left: 16mm; width: 18mm; transform: rotate(8deg); }
.cutlery { bottom: 8mm; right: 18mm; width: 30mm; }
.dots { top: 98mm; right: 3mm; width: 30mm; opacity: .8; }
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
.bill { margin-top: 12mm; }
.bill h4 { margin: 0 0 1.5mm; font-size: 8.5pt; letter-spacing: 2px; color: ${ACCENT}; }
.bill p { margin: 0; font-size: 10pt; color: ${MUTED}; line-height: 1.5; }
.bill p.bill-name { color: ${INK}; font-weight: 700; font-size: 11pt; }
table { width: 100%; border-collapse: collapse; margin-top: 12mm; }
thead th { background: ${BAND}; padding: 3.2mm 4mm; font-size: 9pt; letter-spacing: 1.5px; font-weight: 700; text-align: left; }
thead th:nth-child(2) { text-align: center; } thead th:nth-child(n+3) { text-align: right; }
tbody td { padding: 3.2mm 4mm; font-size: 10.5pt; vertical-align: top; }
tbody tr:nth-child(even) td { background: ${BAND}; }
.c-desc small { display: block; margin-top: .8mm; font-size: 8.5pt; color: ${MUTED}; }
.c-qty { text-align: center; } .c-num { text-align: right; white-space: nowrap; }
tr { page-break-inside: avoid; }
.bottom { display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm; margin-top: auto; padding-top: 10mm; margin-bottom: 38mm; }
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
${DECORATIONS}
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
