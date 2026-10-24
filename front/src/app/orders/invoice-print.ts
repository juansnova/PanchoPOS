/**
 * Factura imprimible en una columna angosta (sirve en tirilla de 80 mm y en hoja carta/A4).
 * Dos variantes con el mismo diseño: factura normal y factura electrónica (DIAN).
 * Función pura: datos adentro, HTML afuera, así se puede previsualizar sin la app.
 */

export interface InvoiceLine {
  name: string;
  detail?: string | null;
  quantity: number;
  unitCents: number;
  totalCents: number;
}

export interface InvoiceElectronic {
  /** Número asignado por la DIAN / proveedor (prefijo + consecutivo). */
  number: string | null;
  cufe: string | null;
  issuedLabel: string | null;
  regimeLabel: string | null;
  pdfUrl?: string | null;
}

export interface InvoiceData {
  logoUrl?: string | null;
  business: {
    name: string;
    address?: string | null;
    city?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    website?: string | null;
    taxId?: string | null;
  };
  invoiceNumber: string;
  dateLabel: string;
  tableName?: string | null;
  customerName?: string | null;
  billing?: { name: string; taxId?: string | null; address?: string | null; email?: string | null } | null;
  lines: InvoiceLine[];
  subtotalCents: number;
  extraChargeCents?: number;
  extraChargeNote?: string | null;
  tipCents?: number;
  tipLabel?: string;
  taxes: { rate: number; cents: number }[];
  totalCents: number;
  paid: boolean;
  paymentMethodLabel?: string | null;
  /** Si viene, se imprime la variante electrónica. */
  electronic?: InvoiceElectronic | null;
  formatMoney: (cents: number) => string;
}

const ACCENT = '#c2672c';
const INK = '#2b2118';
const MUTED = '#7a6c5d';
const RULE = '#d9cdbd';

function esc(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Parte el CUFE en bloques para que se lea y no desborde la columna. */
function chunk(s: string, n: number): string {
  return (s.match(new RegExp(`.{1,${n}}`, 'g')) ?? [s]).join('<br>');
}

export function buildInvoiceHtml(d: InvoiceData): string {
  const m = d.formatMoney;
  const el = d.electronic ?? null;

  const rows = d.lines
    .map(
      (l) => `<tr>
  <td class="q">${l.quantity}</td>
  <td class="n">${esc(l.name)}${l.detail ? `<small>${esc(l.detail)}</small>` : ''}${
    l.quantity > 1 ? `<small>${m(l.unitCents)} c/u</small>` : ''
  }</td>
  <td class="p">${m(l.totalCents)}</td>
</tr>`,
    )
    .join('');

  const totals: string[] = [`<div class="r"><span>Subtotal</span><b>${m(d.subtotalCents)}</b></div>`];
  if (d.extraChargeCents) {
    totals.push(
      `<div class="r"><span>Importe adicional${d.extraChargeNote ? `<small>${esc(d.extraChargeNote)}</small>` : ''}</span><b>${m(d.extraChargeCents)}</b></div>`,
    );
  }
  if (d.tipCents) {
    totals.push(`<div class="r"><span>${esc(d.tipLabel || 'Propina')}</span><b>${m(d.tipCents)}</b></div>`);
  }
  for (const t of d.taxes) {
    totals.push(`<div class="r tax"><span>IVA ${t.rate}% (incluido)</span><b>${m(t.cents)}</b></div>`);
  }

  const contact = [
    d.business.address && [d.business.address, d.business.city].filter(Boolean).join(', '),
    d.business.phone && `Tel. ${d.business.phone}`,
    d.business.whatsapp && `WhatsApp ${d.business.whatsapp}`,
    d.business.website,
  ].filter(Boolean) as string[];

  const meta = [
    ['Fecha', d.dateLabel],
    d.tableName ? ['Mesa', d.tableName] : null,
    d.customerName ? ['Atendido a', d.customerName] : null,
  ].filter(Boolean) as string[][];

  const billing = d.billing
    ? `<section class="box">
  <h4>Facturado a</h4>
  <p class="strong">${esc(d.billing.name)}</p>
  ${d.billing.taxId ? `<p>NIT/ID ${esc(d.billing.taxId)}</p>` : ''}
  ${d.billing.address ? `<p>${esc(d.billing.address)}</p>` : ''}
  ${d.billing.email ? `<p>${esc(d.billing.email)}</p>` : ''}
</section>`
    : '';

  const docTitle = el ? 'Factura electrónica de venta' : 'Factura de venta';
  const docNumber = el?.number || `N.º ${d.invoiceNumber}`;

  const dian = el
    ? `<section class="dian">
  <div class="dian-head"><span class="shield">✓</span><b>Validada por la DIAN</b></div>
  ${el.issuedLabel ? `<p>Emitida: ${esc(el.issuedLabel)}</p>` : ''}
  ${el.regimeLabel ? `<p>${esc(el.regimeLabel)}</p>` : ''}
  ${el.cufe ? `<p class="cufe-l">CUFE</p><p class="cufe">${chunk(esc(el.cufe), 32)}</p>` : ''}
  ${el.pdfUrl ? `<p class="pdf">${esc(el.pdfUrl)}</p>` : ''}
</section>`
    : '';

  const legal = el
    ? 'Representación gráfica de la factura electrónica de venta. El documento válido es el XML firmado y validado por la DIAN.'
    : 'Documento informativo de la venta. No reemplaza la factura electrónica de venta.';

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>${esc(docTitle)} ${esc(docNumber)}</title>
<style>
@page { margin: 8mm; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #efe9df; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.45; color: ${INK}; }
.sheet { width: 100%; max-width: 400px; margin: 24px auto; padding: 28px 24px 22px; background: #fff; border-top: 5px solid ${ACCENT}; box-shadow: 0 6px 24px rgba(60,40,20,.12); }
header { text-align: center; padding-bottom: 14px; }
header img { display: block; margin: 0 auto 8px; max-height: 64px; max-width: 200px; }
header h1 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 22px; letter-spacing: .3px; }
header p { margin: 2px 0 0; font-size: 11.5px; color: ${MUTED}; }
.doc { margin: 14px 0 4px; text-align: center; }
.doc .t { display: inline-block; padding: 4px 12px; border: 1.5px solid ${ACCENT}; border-radius: 99px; color: ${ACCENT}; font-size: 10.5px; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase; }
.doc .no { display: block; margin-top: 8px; font-family: Georgia, serif; font-size: 20px; font-weight: 700; }
.meta { margin: 12px 0; padding: 8px 0; border-top: 1px dashed ${RULE}; border-bottom: 1px dashed ${RULE}; }
.meta div { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; padding: 1px 0; }
.meta span { color: ${MUTED}; }
.box { margin: 0 0 12px; padding: 9px 12px; background: #faf6f0; border-left: 3px solid ${ACCENT}; border-radius: 2px; }
.box h4 { margin: 0 0 3px; font-size: 10px; letter-spacing: 1.6px; text-transform: uppercase; color: ${ACCENT}; }
.box p { margin: 0; font-size: 12px; color: ${MUTED}; }
.box p.strong { color: ${INK}; font-weight: 700; font-size: 13px; }
table { width: 100%; border-collapse: collapse; }
thead th { padding: 6px 0; font-size: 10px; letter-spacing: 1.4px; text-transform: uppercase; color: ${MUTED}; text-align: left; border-bottom: 1.5px solid ${INK}; }
thead th.q { width: 44px; }
thead th.p { text-align: right; }
tbody td { padding: 8px 0; vertical-align: top; border-bottom: 1px dotted ${RULE}; }
td.q { width: 44px; font-weight: 700; color: ${ACCENT}; }
td.n small, .r small { display: block; font-size: 10.5px; color: ${MUTED}; }
td.p { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
tr { page-break-inside: avoid; }
.totals { margin-top: 10px; }
.r { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; font-size: 12.5px; }
.r b { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.r.tax { font-size: 11.5px; color: ${MUTED}; }
.grand { display: flex; justify-content: space-between; align-items: baseline; margin-top: 8px; padding: 10px 12px; background: ${INK}; color: #fff; border-radius: 4px; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; }
.grand b { font-family: Georgia, serif; font-size: 21px; letter-spacing: 0; }
.paid { margin-top: 8px; text-align: center; font-size: 10.5px; font-weight: 700; letter-spacing: 2.4px; text-transform: uppercase; color: ${ACCENT}; }
.dian { margin-top: 16px; padding: 10px 12px; border: 1px solid ${RULE}; border-radius: 4px; font-size: 11px; color: ${MUTED}; }
.dian p { margin: 2px 0 0; }
.dian-head { display: flex; align-items: center; gap: 8px; color: ${INK}; font-size: 12px; }
.shield { display: inline-flex; width: 18px; height: 18px; align-items: center; justify-content: center; border-radius: 50%; background: ${ACCENT}; color: #fff; font-size: 11px; font-weight: 700; }
.cufe-l { margin-top: 6px !important; font-size: 9.5px; letter-spacing: 1.6px; font-weight: 700; color: ${INK}; }
.cufe { font-family: Consolas, 'Courier New', monospace; font-size: 10.5px; color: ${INK}; word-break: break-all; }
.pdf { font-size: 9.5px; word-break: break-all; }
footer { margin-top: 18px; padding-top: 12px; border-top: 1px dashed ${RULE}; text-align: center; }
footer .thanks { margin: 0 0 4px; font-family: Georgia, serif; font-size: 16px; color: ${ACCENT}; }
footer p { margin: 0; font-size: 10.5px; color: ${MUTED}; }
@media print {
  html, body { background: #fff; }
  .sheet { margin: 0 auto; box-shadow: none; padding: 4px 0; max-width: 100%; border-top: 0; }
  @page { size: auto; }
}
</style></head><body>
<div class="sheet">
  <header>
    ${d.logoUrl ? `<img src="${esc(d.logoUrl)}" alt="">` : ''}
    <h1>${esc(d.business.name)}</h1>
    ${d.business.taxId ? `<p>NIT ${esc(d.business.taxId)}</p>` : ''}
    ${contact.map((c) => `<p>${esc(c)}</p>`).join('')}
  </header>
  <div class="doc"><span class="t">${esc(docTitle)}</span><span class="no">${esc(docNumber)}</span></div>
  <div class="meta">${meta.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
  ${billing}
  <table>
    <thead><tr><th class="q">Cant.</th><th>Descripción</th><th class="p">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    ${totals.join('')}
    <div class="grand"><span>Total</span><b>${m(d.totalCents)}</b></div>
    ${d.paid ? `<div class="paid">Pagado${d.paymentMethodLabel ? ' · ' + esc(d.paymentMethodLabel) : ''}</div>` : ''}
  </div>
  ${dian}
  <footer>
    <p class="thanks">¡Gracias por su visita!</p>
    <p>${esc(legal)}</p>
  </footer>
</div>
</body></html>`;
}
