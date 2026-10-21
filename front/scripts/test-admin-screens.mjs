#!/usr/bin/env node
/**
 * Puppeteer smoke test for the redesigned admin screens: each one must load
 * (no redirect to /login), show its main block and log no console errors.
 *
 * Usage (from repo root):
 *   LOGIN_EMAIL=owner@amvara.de LOGIN_PASSWORD=secret node front/scripts/test-admin-screens.mjs
 *
 * Env: BASE_URL (auto-detect 4203/4202/4200), LOGIN_EMAIL, LOGIN_PASSWORD, HEADLESS (0 to watch),
 *      PUPPETEER_EXECUTABLE_PATH (Chrome binary).
 */

import { isHeadless } from './puppeteer-headless.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const CHROME_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SCREENS = [
  { path: '/cash-close', selector: '.cc-hero', label: 'Cierre de caja' },
  { path: '/inventory/stock', selector: '.sk-hero', label: 'Stock' },
  { path: '/inventory/items', selector: '.content', label: 'Artículos de inventario' },
  { path: '/inventory/purchase-orders', selector: '.po-kpis', label: 'Órdenes de compra' },
  { path: '/reports', selector: '[data-testid="reports-page"]', label: 'Informes' },
  { path: '/customers', selector: 'table, .empty-state', label: 'Clientes' },
];

async function detectBaseUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  for (const port of [4203, 4202, 4200]) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'head', signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status < 500) return `http://127.0.0.1:${port}`;
    } catch (_) {}
  }
  throw new Error('App not reachable; set BASE_URL');
}

async function main() {
  const baseUrl = await detectBaseUrl();
  const email = process.env.LOGIN_EMAIL;
  const password = process.env.LOGIN_PASSWORD;
  if (!email || !password) {
    console.error('LOGIN_EMAIL and LOGIN_PASSWORD are required (owner or admin user).');
    process.exit(1);
  }
  const headless = isHeadless();
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  let failed = 0;
  try {
    await page.goto(new URL('/login', baseUrl).href, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.type('input[name="username"]', email);
    await page.type('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await new Promise((r) => setTimeout(r, 4000));
    if (page.url().includes('/login')) throw new Error('Login failed (check credentials)');

    for (const s of SCREENS) {
      errors.length = 0;
      await page.goto(new URL(s.path, baseUrl).href, { waitUntil: 'networkidle2', timeout: 20000 });
      const redirected = !page.url().includes(s.path);
      const found = redirected ? null : await page.waitForSelector(s.selector, { timeout: 8000 }).catch(() => null);
      const appErrors = errors.filter((e) => !/favicon|net::ERR_ABORTED/.test(e));
      if (redirected || !found || appErrors.length) {
        failed++;
        console.log(`FAIL ${s.label} (${s.path})`, redirected ? `redirected to ${page.url()}` : '', found ? '' : 'main block missing', appErrors.slice(0, 2));
      } else {
        console.log(`OK   ${s.label} (${s.path})`);
      }
    }

    // Phone width: no horizontal scroll on the new screens
    await page.setViewport({ width: 390, height: 800, isMobile: true });
    for (const s of SCREENS.slice(0, 4)) {
      await page.goto(new URL(s.path, baseUrl).href, { waitUntil: 'networkidle2', timeout: 20000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 4) {
        failed++;
        console.log(`FAIL ${s.label} at 390px: horizontal overflow ${overflow}px`);
      } else {
        console.log(`OK   ${s.label} at 390px`);
      }
    }
  } catch (e) {
    failed++;
    console.log('ERROR', e.message);
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}

main();
