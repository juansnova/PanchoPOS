#!/usr/bin/env node
/**
 * Puppeteer: My shift — when venue clock QR is required, page loads clock-qr-status
 * and shows the "Scan venue QR" control (.scan-cta) with no token in session.
 *
 * Credentials:
 *   Prefer OWNER_EMAIL / OWNER_PASSWORD to enable/disable clock QR via API, and
 *   LOGIN_EMAIL / LOGIN_PASSWORD for the user that opens /my-shift (often a waiter).
 *   If OWNER_EMAIL is omitted, LOGIN_EMAIL is used for both (typical: tenant owner alone).
 *
 * Required:
 *   LOGIN_EMAIL / LOGIN_PASSWORD — must include SETTINGS_UPDATE for regenerate/delete,
 *   and must be able to open /my-shift (staff routes).
 *
 * Optional:
 *   OWNER_EMAIL / OWNER_PASSWORD — override for enable/disable when different from staff
 *   BASE_URL       (default: auto-detect 4203/4202/4200)
 *   HEADLESS       default on; 0 / false / no for visible browser
 */

import { isHeadless } from './puppeteer-headless.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const CHROME_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function detectBaseUrl() {
  let baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    for (const port of [4203, 4202, 4200]) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, {
          method: 'head',
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok || res.status < 500) {
          baseUrl = `http://127.0.0.1:${port}`;
          break;
        }
      } catch (_) {}
    }
    baseUrl = baseUrl || 'http://127.0.0.1:4202';
  }
  return baseUrl;
}

async function login(page, baseUrl, email, password) {
  await page.goto(new URL('/login', baseUrl).href, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.type('input[name="username"]', email);
  await page.type('input[type="password"]', password);
  const submitBtn = await page.$('button[type="submit"]');
  if (submitBtn) await submitBtn.click();
  await new Promise((r) => setTimeout(r, 2500));
  if (page.url().includes('/login')) {
    throw new Error('Login failed (still on /login). Check credentials.');
  }
}

async function logoutApi(page, baseUrl) {
  await page.evaluate(async (origin) => {
    await fetch(`${origin}/api/logout`, { method: 'POST', credentials: 'include' });
  }, baseUrl);
}

async function main() {
  const baseUrl = await detectBaseUrl();
  const staffEmail = process.env.LOGIN_EMAIL;
  const staffPassword = process.env.LOGIN_PASSWORD;
  const ownerEmail = process.env.OWNER_EMAIL || staffEmail;
  const ownerPassword = process.env.OWNER_PASSWORD || staffPassword;

  if (!staffEmail || !staffPassword || !ownerEmail || !ownerPassword) {
    console.error('Required: LOGIN_EMAIL, LOGIN_PASSWORD (and optional OWNER_EMAIL / OWNER_PASSWORD).');
    process.exit(1);
  }

  const headless = isHeadless();
  console.log('BASE_URL:', baseUrl);
  console.log('Headless:', headless);
  console.log('---');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless,
    defaultViewport: headless ? { width: 1280, height: 720 } : null,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  try {
    // 1) Owner: enable clock QR
    console.log('1. Owner login + enable clock QR...');
    await login(page, baseUrl, ownerEmail, ownerPassword);
    const regen = await page.evaluate(async (origin) => {
      const r = await fetch(`${origin}/api/tenant/settings/clock-qr/regenerate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const text = await r.text();
      return { status: r.status, text };
    }, baseUrl);
    if (regen.status !== 200) {
      console.error('FAIL: regenerate clock QR:', regen.status, regen.text);
      process.exit(1);
    }
    console.log('   OK: clock QR enabled');

    await logoutApi(page, baseUrl);

    // 2) Staff (or same user): open /my-shift, expect API + Scan CTA
    console.log('2. Shift user login...');
    await login(page, baseUrl, staffEmail, staffPassword);

    const tenantId = await page.evaluate(async (origin) => {
      const r = await fetch(`${origin}/api/users/me`, { credentials: 'include' });
      if (!r.ok) return null;
      const u = await r.json();
      return u?.tenant_id ?? null;
    }, baseUrl);
    if (tenantId != null) {
      await page.evaluate((tid) => {
        sessionStorage.removeItem(`clock_qr_${tid}`);
      }, tenantId);
    }

    console.log('3. Open /my-shift (wait for clock-qr-status)...');
    const statusPromise = page.waitForResponse(
      (r) => r.url().includes('/users/me/clock-qr-status') && r.status() === 200,
      { timeout: 20000 }
    );
    await page.goto(new URL('/my-shift', baseUrl).href, { waitUntil: 'networkidle2', timeout: 20000 });
    await statusPromise;
    console.log('   OK: GET /users/me/clock-qr-status returned 200');

    await new Promise((r) => setTimeout(r, 500));
    const hasScan = await page.evaluate(() => !!document.querySelector('.scan-cta'));
    if (!hasScan) {
      console.error('FAIL: .scan-cta not in DOM (expected Scan venue QR when QR required and no token).');
      process.exit(1);
    }
    console.log('   OK: .scan-cta present');

    console.log('PASS: My shift clock-QR UI and API check.');
  } finally {
    try {
      await logoutApi(page, baseUrl);
      await login(page, baseUrl, ownerEmail, ownerPassword);
      const del = await page.evaluate(async (origin) => {
        const r = await fetch(`${origin}/api/tenant/settings/clock-qr`, {
          method: 'DELETE',
          credentials: 'include',
        });
        return { status: r.status, text: await r.text() };
      }, baseUrl);
      if (del.status !== 200) {
        console.warn('WARN: could not disable clock QR (cleanup):', del.status, del.text);
      } else {
        console.log('Cleanup: clock QR disabled for tenant.');
      }
    } catch (e) {
      console.warn('WARN: cleanup failed:', e?.message || e);
    }
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
