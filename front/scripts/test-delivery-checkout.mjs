#!/usr/bin/env node
/**
 * Smoke: public Satisfecho Delivery checkout, merged into the public menu page
 * (menu → cart → address → create order, all on /public-menu/:tenantId).
 * Also checks the old /delivery/:tenantId link still redirects there.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:4202 TENANT_ID=1 node front/scripts/test-delivery-checkout.mjs
 */
import { isHeadless } from './puppeteer-headless.mjs';
import { createRequire } from 'module';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../..');
const envPath = resolve(projectRoot, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4202').replace(/\/$/, '');
const TENANT_ID = process.env.TENANT_ID || '1';
const CHROME =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: isHeadless(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  /** Bare /uploads/... (no /api) hits front and 404s — regression for FEAT-312. */
  const bareUpload404s = [];
  page.on('response', (res) => {
    const u = res.url();
    if (!u.includes('/uploads/')) return;
    if (res.status() !== 404) return;
    try {
      const path = new URL(u).pathname;
      if (path.startsWith('/uploads/') && !path.startsWith('/api/')) {
        bareUpload404s.push(path);
      }
    } catch {
      /* ignore bad URLs */
    }
  });

  const url = `${BASE_URL}/public-menu/${TENANT_ID}`;
  console.log('Open', url);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  await page.waitForFunction(
    () => {
      const t = document.body?.innerText || '';
      return (
        t.includes('Delivery') ||
        t.includes('Lieferung') ||
        t.includes('Entrega') ||
        t.includes('Livraison') ||
        t.includes('Add') ||
        t.includes('Hinzufügen') ||
        t.includes('Añadir') ||
        !t.includes('Loading')
      );
    },
    { timeout: 30000 },
  );

  const text = await page.evaluate(() => document.body.innerText);
  if (/DELIVERY_CHECKOUT\./.test(text)) {
    throw new Error('Raw i18n keys visible on delivery page');
  }
  if (/Restaurant not found|Invalid restaurant|Tenant not found/i.test(text) && !/Add|cart|menu/i.test(text)) {
    console.warn('Tenant may be missing in this env; page still rendered error state OK');
  } else {
    // Product images must go through /api/uploads/... (HAProxy → back), not bare /uploads/...
    const imageCheck = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img.product-image')];
      const srcs = imgs.map((img) => img.getAttribute('src') || '');
      const bad = srcs.filter(
        (s) => s.includes('/uploads/') && !s.includes('/api/uploads/'),
      );
      const viaApi = srcs.filter((s) => s.includes('/api/uploads/'));
      return { count: imgs.length, viaApi: viaApi.length, bad };
    });
    if (imageCheck.bad.length) {
      throw new Error(
        `Delivery product images missing /api prefix (would 404 on HAProxy front): ${imageCheck.bad.slice(0, 3).join(', ')}`,
      );
    }
    if (imageCheck.count > 0 && imageCheck.viaApi === 0) {
      throw new Error('Expected at least one delivery product image via /api/uploads/');
    }
    if (bareUpload404s.length) {
      throw new Error(
        `Bare /uploads/ 404s (missing /api): ${[...new Set(bareUpload404s)].slice(0, 5).join(', ')}`,
      );
    }
    if (imageCheck.count > 0) {
      console.log(
        `Product images OK (${imageCheck.viaApi} via /api/uploads/, no bare-/uploads 404s)`,
      );
    } else {
      console.log('No product images in menu (placeholders only); URL routing check skipped');
    }

    const addBtn = await page.$('button.add-to-cart-btn');
    if (addBtn) {
      await addBtn.click();
      await page.waitForSelector('.delivery-floating-bar button.delivery-floating-cta', {
        timeout: 5000,
      });
      // Floating bar must show total + next-step CTA without scrolling (#360)
      const floatingOk = await page.evaluate(() => {
        const bar = document.querySelector('.delivery-floating-bar');
        if (!bar) return false;
        const style = window.getComputedStyle(bar);
        return style.position === 'fixed' && (bar.textContent || '').trim().length > 0;
      });
      if (!floatingOk) {
        throw new Error('Expected fixed floating checkout bar with order total (#360)');
      }
      await page.click('button.delivery-floating-cta');
      // Cart step only (not menu "View cart" / Ver carrito copy)
      await page.waitForSelector('ul.cart-list', { timeout: 10000 });
      // Floating bar is menu-only; cart uses inline actions (no overlap)
      const barOnCart = await page.$('.delivery-floating-bar');
      if (barOnCart) {
        throw new Error('Floating checkout bar must not show on cart step (#360 overlap fix)');
      }
      console.log('Cart step OK (via floating CTA); no floating bar on cart');

      // Address → create order (regression: TenantProduct menu IDs must not 400)
      const continueBtn = await page.$('.step-actions button.btn-primary');
      if (!continueBtn) {
        throw new Error('Could not open address step from cart inline Continue');
      }
      await continueBtn.click();
      await page.waitForSelector('form.order-form', { timeout: 10000 });
      const barOnAddress = await page.$('.delivery-floating-bar');
      if (barOnAddress) {
        throw new Error('Floating checkout bar must not show on address step (#360 overlap fix)');
      }
      await page.type('input[name="phone"]', '+34600111222');
      await page.type('textarea[name="address"]', 'Calle Smoke Test 1, Madrid');
      const postal = await page.$('input[name="postal"]');
      if (postal) {
        await postal.click({ clickCount: 3 });
        await postal.type('28001');
      }

      const createRespPromise = page.waitForResponse(
        (res) =>
          res.url().includes(`/public/tenants/${TENANT_ID}/satisfecho-delivery`) &&
          res.request().method() === 'POST',
        { timeout: 30000 },
      );
      await page.click('form.order-form .step-actions button.btn-primary');
      const createResp = await createRespPromise;
      const createStatus = createResp.status();
      const createBody = await createResp.json().catch(() => ({}));
      if (createStatus !== 200) {
        throw new Error(
          `Create delivery order failed: HTTP ${createStatus} ${JSON.stringify(createBody)}`,
        );
      }
      if (!createBody.public_order_token || !createBody.id) {
        throw new Error(`Create response missing token/id: ${JSON.stringify(createBody)}`);
      }
      // Tenants without an online gateway skip straight to order tracking (no dead-end
      // payment screen); tenants with Stripe/Revolut configured land on the pay step.
      await page.waitForFunction(
        () =>
          /pay|pago|Bezahlen|payer|Stripe|Revolut|Seguir tu pedido|Track your order|Recibido|Received/i.test(
            document.body?.innerText || '',
          ),
        { timeout: 15000 },
      );
      console.log('Order create OK (id=', createBody.id, ')');
    } else {
      console.log('No add buttons (empty menu); page shell OK');
    }
  }

  // Old bookmarked /delivery/:tenantId link must still land on the merged page.
  await page.goto(`${BASE_URL}/delivery/${TENANT_ID}`, {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });
  if (!page.url().includes(`/public-menu/`)) {
    throw new Error(`Expected /delivery/${TENANT_ID} to redirect to /public-menu/..., got ${page.url()}`);
  }
  console.log('/delivery/:tenantId redirect OK ->', page.url());
  console.log('PASS');
  await browser.close();
}

main().catch(async (err) => {
  console.error('FAIL', err);
  process.exitCode = 1;
});
