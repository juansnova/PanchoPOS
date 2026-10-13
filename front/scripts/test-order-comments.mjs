#!/usr/bin/env node
/**
 * Puppeteer smoke: public menu item + order comments → kitchen highlight (#284).
 *
 * Path: Take Away menu (no PIN) → add product → set item comment + order notes →
 * place order → staff /kitchen shows both texts (highlighted).
 *
 * Usage (from repo root):
 *   npm run test:order-comments --prefix front
 *   BASE_URL=http://127.0.0.1:4202 npm run test:order-comments --prefix front
 *
 * Env:
 *   BASE_URL         App URL (default: auto-detect 4203, 4202, 4200)
 *   TENANT_ID        Demo tenant (default 1)
 *   TABLE_TOKEN      Optional menu token (default: Take Away for tenant via API)
 *   LOGIN_EMAIL      Staff user (or DEMO_LOGIN_EMAIL / ADMIN_EMAIL from .env)
 *   LOGIN_PASSWORD   Staff password (or DEMO_LOGIN_PASSWORD / ADMIN_PASSWORD)
 *   HEADLESS         Default headless; set 0, false, or no for a visible browser
 */

import { isHeadless } from './puppeteer-headless.mjs';
import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(__dirname, '..', '..');

function loadEnv() {
  const envPath = join(repoRoot, '.env');
  if (!existsSync(envPath)) return;
  try {
    readFileSync(envPath, 'utf8')
      .split('\n')
      .forEach((line) => {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m && !process.env[m[1].trim()]) {
          process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
        }
      });
  } catch (_) {}
}
loadEnv();

const CHROME_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolveBaseUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  for (const port of [4203, 4202, 4200]) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        method: 'head',
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok || res.status < 500) return `http://127.0.0.1:${port}`;
    } catch (_) {}
  }
  return 'http://127.0.0.1:4202';
}

function parseSetCookie(loginRes) {
  const raw = loginRes.headers.getSetCookie?.() || [];
  if (raw.length) return raw.map((c) => c.split(';')[0].trim()).join('; ');
  const single = loginRes.headers.get('set-cookie');
  if (!single) return '';
  return single
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function apiLogin(baseUrl, email, password) {
  const apiBase = `${baseUrl.replace(/\/$/, '')}/api`;
  const loginRes = await fetch(`${apiBase}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: email, password }),
  });
  if (!loginRes.ok) {
    throw new Error(`API login failed: ${loginRes.status}`);
  }
  return { apiBase, cookie: parseSetCookie(loginRes) };
}

async function getTakeAwayTableToken(baseUrl, email, password, tenantId) {
  const { apiBase, cookie } = await apiLogin(baseUrl, email, password);
  const tablesRes = await fetch(`${apiBase}/tables/with-status`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  if (!tablesRes.ok) {
    throw new Error(`tables/with-status failed: ${tablesRes.status}`);
  }
  const tables = await tablesRes.json();
  const takeAway = (tables || []).find((t) => {
    const name = String(t.name || '')
      .trim()
      .toLowerCase();
    const tid = t.tenant_id != null ? String(t.tenant_id) : null;
    if (tid && tid !== String(tenantId)) return false;
    return (
      name === 'take away' ||
      name === 'takeaway' ||
      name === 'take-away' ||
      name === 'home ordering'
    );
  });
  if (!takeAway?.token) {
    throw new Error(
      `No Take Away table token for tenant ${tenantId}. Run seed_demo_tables.`
    );
  }
  return takeAway.token;
}

async function dismissNameModal(page) {
  const skipped = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const skip = buttons.find((b) => /skip|omitir|weglassen|überspringen/i.test(b.textContent || ''));
    if (skip) {
      skip.click();
      return true;
    }
    return false;
  });
  if (skipped) await sleep(500);
}

async function selectMainCourseCategory(page) {
  // Prefer Main Course so the order appears on /kitchen (not /bar beverages).
  const clicked = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('button.category-chip'));
    const main = chips.find((b) =>
      /main\s*course|plato\s*principal|hauptgang|plat\s*principal/i.test(
        (b.textContent || '').trim()
      )
    );
    if (main) {
      main.click();
      return (main.textContent || '').trim();
    }
    return '';
  });
  if (clicked) {
    console.log('   Category:', clicked);
    await sleep(800);
  } else {
    console.log('   No Main Course category chip – using first visible product.');
  }
}

async function addFirstProduct(page) {
  await selectMainCourseCategory(page);
  let addBtn = await page.$('button.add-to-cart-btn');
  if (!addBtn) {
    const productCard = await page.$('.product-card, article.product-card, [class*="product-card"]');
    if (productCard) await productCard.click();
    await sleep(1000);
    addBtn = await page.$('button.add-to-cart-btn');
  }
  if (!addBtn) return false;
  await addBtn.click();
  await sleep(800);

  // Customization sheet: confirm add if present
  const confirmAdd = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const confirm = buttons.find((b) =>
      /add to (cart|order)|añadir|hinzufügen|ajouter/i.test((b.textContent || '').trim())
    );
    if (confirm && confirm.offsetParent !== null) {
      confirm.click();
      return true;
    }
    return false;
  });
  if (confirmAdd) await sleep(800);
  return true;
}

/** Set textarea via input event so Angular [value]/(input) and ngModel pick it up. */
async function setTextareaValue(page, selector, value) {
  const ok = await page.$eval(
    selector,
    (el, text) => {
      const ta = el;
      ta.focus();
      ta.value = text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      return ta.value === text;
    },
    value
  );
  if (!ok) throw new Error(`Failed to set textarea ${selector}`);
}

async function main() {
  const baseUrl = await resolveBaseUrl();
  const tenantId = process.env.TENANT_ID || '1';
  const headless = isHeadless();
  const loginEmail =
    process.env.LOGIN_EMAIL ||
    process.env.ADMIN_EMAIL ||
    process.env.DEMO_LOGIN_EMAIL;
  const loginPassword =
    process.env.LOGIN_PASSWORD ||
    process.env.ADMIN_PASSWORD ||
    process.env.DEMO_LOGIN_PASSWORD;

  if (!loginEmail || !loginPassword) {
    console.error(
      'LOGIN_EMAIL/LOGIN_PASSWORD (or DEMO_LOGIN_*) required for table token + kitchen check.'
    );
    process.exit(1);
  }

  const suffix = String(Date.now()).slice(-8);
  const itemComment = `Smoke item note ${suffix}`;
  const orderNotes = `Smoke order notes ${suffix}`;

  console.log('test-order-comments (Puppeteer)');
  console.log('BASE_URL:', baseUrl);
  console.log('TENANT_ID:', tenantId);
  console.log('Headless:', headless);
  console.log('Item comment:', itemComment);
  console.log('Order notes:', orderNotes);
  console.log('---');

  let tableToken = process.env.TABLE_TOKEN;
  if (!tableToken) {
    console.log('0. Resolve Take Away table token via API...');
    tableToken = await getTakeAwayTableToken(baseUrl, loginEmail, loginPassword, tenantId);
  }
  const menuUrl = new URL(`/menu/${tableToken}`, baseUrl).href;
  console.log('Menu URL:', menuUrl);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless,
    defaultViewport: headless ? { width: 1280, height: 900 } : null,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
    console.log('[pageerror]', err.message);
  });

  try {
    console.log('1. Open public menu...');
    await page.goto(menuUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await page.waitForSelector('.menu-page', { timeout: 15000 });
    const closed = await page.$('.table-closed-screen');
    if (closed) {
      throw new Error('Take Away table appears closed; ensure seed_demo_tables and is_active.');
    }
    await dismissNameModal(page);

    console.log('2. Add first product to cart...');
    const added = await addFirstProduct(page);
    if (!added) throw new Error('No add-to-cart control found on menu.');

    await page.waitForSelector('.cart-sheet', { timeout: 10000 });
    const expanded = await page.$('.cart-sheet.expanded');
    if (!expanded) {
      await page.click('.cart-summary, .cart-handle').catch(() => {});
      await sleep(500);
    }

    console.log('3. Set item comment + order notes...');
    await page.waitForSelector('button.comment-toggle-btn', { timeout: 8000 });
    // Order-level #cart-order-notes also uses .cart-comment-input; expand item field explicitly.
    const itemFieldOpen = await page.$('.cart-item-comment-field textarea.cart-comment-input');
    if (!itemFieldOpen) {
      await page.click('button.comment-toggle-btn');
    }
    await page.waitForSelector('.cart-item-comment-field textarea.cart-comment-input', {
      timeout: 8000,
    });
    await setTextareaValue(
      page,
      '.cart-item-comment-field textarea.cart-comment-input',
      itemComment
    );
    await page.waitForSelector('#cart-order-notes', { timeout: 5000 });
    await setTextareaValue(page, '#cart-order-notes', orderNotes);
    await sleep(300);

    console.log('4. Place order...');
    const placeBtn = await page.$('button.place-order-btn');
    if (!placeBtn) throw new Error('Place order button not found.');
    await placeBtn.click();
    await sleep(3000);

    const pinVisible = await page.evaluate(() => {
      const pinInput = document.querySelector('.pin-input');
      if (!pinInput) return false;
      const modal = pinInput.closest('.modal-overlay, .modal-sheet, .pin-modal');
      return !!(modal && modal.offsetParent !== null);
    });
    if (pinVisible) {
      throw new Error('PIN modal shown on Take Away — expected PIN skip for take-away tables.');
    }

    const orderFailed = await page.evaluate(() => {
      const err = document.querySelector('.error-banner, .toast-error, .cart-error');
      return err ? (err.textContent || '').trim() : '';
    });
    if (orderFailed && /pin|error|fail|403/i.test(orderFailed)) {
      throw new Error(`Order submit error UI: ${orderFailed.slice(0, 200)}`);
    }

    console.log('5. Staff login + open /kitchen...');
    await page.goto(new URL(`/login?tenant=${tenantId}`, baseUrl).href, {
      waitUntil: 'networkidle2',
      timeout: 15000,
    });
    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    await page.click('input[name="username"]', { clickCount: 3 });
    await page.type('input[name="username"]', loginEmail);
    await page.click('input[type="password"]', { clickCount: 3 });
    await page.type('input[type="password"]', loginPassword);
    await page.click('button[type="submit"]');
    await sleep(4000);
    if (page.url().includes('/login')) {
      throw new Error('Staff login failed.');
    }

    async function assertCommentsOnDisplay(pathLabel, path) {
      await page.goto(new URL(path, baseUrl).href, {
        waitUntil: 'networkidle2',
        timeout: 15000,
      });
      await page.waitForSelector('.kitchen-view, .kitchen-main, .order-grid, .bar-view', {
        timeout: 15000,
      });
      await sleep(2500);
      return page.evaluate(
        (itemText, orderText) => {
          const body = document.body?.innerText || '';
          const itemEl = Array.from(document.querySelectorAll('.item-notes')).find((el) =>
            (el.textContent || '').includes(itemText)
          );
          const orderEl = Array.from(document.querySelectorAll('.order-notes')).find((el) =>
            (el.textContent || '').includes(orderText)
          );
          return {
            path: location.pathname,
            bodyHasItem: body.includes(itemText),
            bodyHasOrder: body.includes(orderText),
            itemNotesEl: !!itemEl,
            orderNotesEl: !!orderEl,
            orderCardCount: document.querySelectorAll('.order-card').length,
          };
        },
        itemComment,
        orderNotes
      );
    }

    console.log('6. Assert kitchen (or bar) shows item + order comments...');
    let found = await assertCommentsOnDisplay('kitchen', '/kitchen');
    console.log('   /kitchen:', found);
    if (
      (!found.itemNotesEl && !found.bodyHasItem) ||
      (!found.orderNotesEl && !found.bodyHasOrder)
    ) {
      found = await assertCommentsOnDisplay('bar', '/bar');
      console.log('   /bar:', found);
    }

    if (!found.itemNotesEl && !found.bodyHasItem) {
      throw new Error(`Item comment not visible on kitchen/bar: ${itemComment}`);
    }
    if (!found.orderNotesEl && !found.bodyHasOrder) {
      throw new Error(`Order notes not visible on kitchen/bar: ${orderNotes}`);
    }
    if (!found.itemNotesEl) {
      console.log('   WARN: item text in body but .item-notes node missing');
    }
    if (!found.orderNotesEl) {
      console.log('   WARN: order text in body but .order-notes node missing');
    }

    if (pageErrors.length) {
      console.log('   Page errors (non-fatal if smoke assertions passed):', pageErrors.length);
    }

    console.log('RESULT: Order comments smoke passed.');
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('FAIL:', err.message || err);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
