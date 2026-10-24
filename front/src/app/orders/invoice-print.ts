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
@page { margin: 6mm; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #e8e8e8; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
/* Impresora de baja resolución: todo en negro puro, letras grandes y gruesas, sin grises ni líneas finas. */
body { font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; font-size: 15px; font-weight: 600; line-height: 1.4; color: #000; }
.sheet { width: 100%; max-width: 420px; margin: 24px auto; padding: 24px 20px 20px; background: #fff; border-top: 6px solid #000; box-shadow: 0 6px 24px rgba(0,0,0,.15); }
header { text-align: center; padding-bottom: 12px; }
header img { display: block; margin: 0 auto 8px; max-height: 90px; max-width: 240px; }
header h1 { margin: 0; font-size: 28px; font-weight: 900; letter-spacing: .3px; }
header p { margin: 2px 0 0; font-size: 14px; font-weight: 700; }
.doc { margin: 12px 0 4px; text-align: center; }
.doc .t { display: inline-block; padding: 4px 12px; border: 2.5px solid #000; border-radius: 99px; font-size: 14px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; }
.doc .no { display: block; margin-top: 8px; font-size: 26px; font-weight: 900; }
.meta { margin: 12px 0; padding: 8px 0; border-top: 2px solid #000; border-bottom: 2px solid #000; }
.meta div { display: flex; justify-content: space-between; gap: 12px; font-size: 15px; padding: 1px 0; }
.meta span { font-weight: 600; }
.meta b { font-weight: 900; }
.box { margin: 0 0 12px; padding: 8px 12px; border: 2px solid #000; border-radius: 4px; }
.box h4 { margin: 0 0 3px; font-size: 13px; letter-spacing: 1.2px; text-transform: uppercase; font-weight: 900; }
.box p { margin: 0; font-size: 14px; font-weight: 600; }
.box p.strong { font-weight: 900; font-size: 16px; }
table { width: 100%; border-collapse: collapse; }
thead th { padding: 6px 0; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; font-weight: 900; text-align: left; border-bottom: 3px solid #000; }
thead th.q { width: 48px; }
thead th.p { text-align: right; }
tbody td { padding: 9px 0; vertical-align: top; border-bottom: 2px solid #000; font-weight: 800; font-size: 16px; }
td.q { width: 48px; font-weight: 900; font-size: 18px; }
td.n small, .r small { display: block; font-size: 13px; font-weight: 600; }
td.p { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
tr { page-break-inside: avoid; }
.totals { margin-top: 10px; }
.r { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; font-size: 16px; font-weight: 700; }
.r b { font-weight: 900; font-variant-numeric: tabular-nums; white-space: nowrap; }
.r.tax { font-size: 14px; }
.grand { display: flex; justify-content: space-between; align-items: baseline; margin-top: 8px; padding: 10px 12px; background: #000; color: #fff; border-radius: 4px; font-size: 17px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; }
.grand b { font-size: 28px; letter-spacing: 0; }
.paid { margin-top: 8px; text-align: center; font-size: 15px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; }
.dian { margin-top: 14px; padding: 10px 12px; border: 2px solid #000; border-radius: 4px; font-size: 13px; font-weight: 700; }
.dian p { margin: 2px 0 0; }
.dian-head { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 900; }
.shield { display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; border-radius: 50%; background: #000; color: #fff; font-size: 14px; font-weight: 900; }
.cufe-l { margin-top: 6px !important; font-size: 12px; letter-spacing: 1.4px; font-weight: 900; }
.cufe { font-family: 'Courier New', Consolas, monospace; font-size: 13px; font-weight: 900; word-break: break-all; }
.pdf { font-size: 12px; word-break: break-all; }
footer { margin-top: 16px; padding-top: 10px; border-top: 2px solid #000; text-align: center; }
footer .thanks { margin: 0 0 4px; font-size: 20px; font-weight: 900; }
footer p { margin: 0; font-size: 13px; font-weight: 700; }
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
<script>
/* El logo se pasa a blanco y negro puro (sin grises) y se engrosa un punto: las impresoras térmicas no imprimen medios tonos. */
window.prepareLogo = function () {
  return new Promise(function (done) {
    var img = document.querySelector('header img');
    if (!img) { done(); return; }
    var src = new Image();
    src.crossOrigin = 'anonymous';
    src.onerror = function () { done(); };
    src.onload = function () {
      try {
        var k = Math.min(480 / src.naturalWidth, 180 / src.naturalHeight);
        var w = Math.max(1, Math.round(src.naturalWidth * k)), h = Math.max(1, Math.round(src.naturalHeight * k));
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
        x.drawImage(src, 0, 0, w, h);
        var d = x.getImageData(0, 0, w, h), px = d.data, dark = new Uint8Array(w * h), i, j;
        for (i = 0; i < w * h; i++) {
          dark[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) < 200 ? 1 : 0;
        }
        for (i = 0; i < h; i++) for (j = 0; j < w; j++) {
          var p = (i * w + j) * 4, on = dark[i * w + j] || (j > 0 && dark[i * w + j - 1]) || (i > 0 && dark[(i - 1) * w + j]);
          px[p] = px[p + 1] = px[p + 2] = on ? 0 : 255; px[p + 3] = 255;
        }
        x.putImageData(d, 0, 0);
        img.onload = function () { done(); };
        img.style.width = Math.round(w / 2) + 'px';
        img.src = c.toDataURL('image/png');
      } catch (e) { done(); }
    };
    src.src = img.src;
  });
};
</script>
</body></html>`;
}
