// Writes a sample A4 invoice so the design can be reviewed without the app or a printer.
//   node scripts/invoice-a4-preview.mjs      -> tmp/ticket-preview/factura-a4.html
// Serve that folder with: python -m http.server 4210 --bind 127.0.0.1 --directory tmp/ticket-preview
import { readdirSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInvoiceA4Html } from '../front/src/app/orders/invoice-a4.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'tmp', 'ticket-preview');
mkdirSync(out, { recursive: true });

// Use the first uploaded restaurant logo if there is one.
let logoUrl = null;
const uploads = join(root, 'back', 'uploads');
if (existsSync(uploads)) {
  for (const tenant of readdirSync(uploads)) {
    const dir = join(uploads, tenant, 'logo');
    if (existsSync(dir)) {
      const file = readdirSync(dir)[0];
      if (file) {
        copyFileSync(join(dir, file), join(out, 'logo.png'));
        logoUrl = 'logo.png';
        break;
      }
    }
  }
}

const money = (c) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(c / 100);

const html = buildInvoiceA4Html({
  logoUrl,
  business: {
    name: 'Pancho Panza',
    address: 'Carrera 7 # 45-10',
    city: 'Bogotá',
    phone: '601 555 0123',
    whatsapp: '300 123 4567',
    website: 'www.panchopanza.co',
    taxId: '900.123.456-7',
  },
  invoiceNumber: '000128',
  dateLabel: '20/10/2026 14:05',
  tableName: 'Mesa 5',
  customerName: 'Carlos',
  billing: { name: 'Inversiones Andina S.A.S.', taxId: '901.222.333-4', address: 'Calle 80 # 12-34, Bogotá', email: 'compras@andina.co' },
  lines: [
    { name: 'Bandeja paisa', detail: 'Sin cebolla', quantity: 2, unitCents: 3800000, totalCents: 7600000 },
    { name: 'Sopa de mondongo', quantity: 1, unitCents: 2200000, totalCents: 2200000 },
    { name: 'Limonada de coco', quantity: 3, unitCents: 900000, totalCents: 2700000 },
    { name: 'Postre del día', detail: 'Tres leches', quantity: 2, unitCents: 1100000, totalCents: 2200000 },
  ],
  subtotalCents: 14700000,
  extraChargeCents: 500000,
  extraChargeNote: 'Precio especial del día',
  taxes: [{ rate: 8, cents: 1129630 }],
  totalCents: 15200000,
  paid: true,
  paymentMethodLabel: 'Efectivo',
  formatMoney: money,
});
writeFileSync(join(out, 'factura-a4.html'), html, 'utf8');
console.log('wrote', join(out, 'factura-a4.html'));
