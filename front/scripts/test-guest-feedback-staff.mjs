#!/usr/bin/env node
/**
 * Puppeteer smoke: staff Guest feedback at /guest-feedback.
 * Logs in, opens the page, asserts shell (heading / QR card), list GET without 5xx,
 * and no raw FEEDBACK.* i18n keys. Empty list is OK.
 *
 * Usage (from repo root):
 *   LOGIN_EMAIL=... LOGIN_PASSWORD=... node front/scripts/test-guest-feedback-staff.mjs
 *   BASE_URL=http://127.0.0.1:4202 HEADLESS=1 npm run test:guest-feedback-staff --prefix front
 *
 * Env:
 *   BASE_URL       App URL (default: auto-detect 4203, 4202, 4200)
 *   TENANT_ID      Login tenant query (default 1)
 *   LOGIN_EMAIL    Staff with reservations access (or DEMO_LOGIN_EMAIL / ADMIN_EMAIL)
 *   LOGIN_PASSWORD Password (or DEMO_LOGIN_PASSWORD / ADMIN_PASSWORD)
 *   HEADLESS       Default headless; set 0, false, or no for a visible browser.
 */

import { isHeadless } from './puppeteer-headless.mjs';
import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

function loadDotEnv() {
  const envPath = join(repoRoot, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

loadDotEnv();

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

async function main() {
  const baseUrl = await resolveBaseUrl();
  const tenantId = process.env.TENANT_ID || '1';
  const headless = isHeadless();
  const loginEmail =
    process.env.LOGIN_EMAIL || process.env.ADMIN_EMAIL || process.env.DEMO_LOGIN_EMAIL;
  const loginPassword =
    process.env.LOGIN_PASSWORD || process.env.ADMIN_PASSWORD || process.env.DEMO_LOGIN_PASSWORD;

  console.log('test-guest-feedback-staff (Puppeteer)');
  console.log('BASE_URL:', baseUrl);
  console.log('TENANT_ID:', tenantId);
  console.log('Headless:', headless);
  if (!loginEmail || !loginPassword) {
    console.error('FAIL: LOGIN_EMAIL/LOGIN_PASSWORD (or DEMO_LOGIN_* / ADMIN_*) required.');
    process.exit(1);
  }

  const hardFails = [];
  const pageErrors = [];
  const failedResponses = [];

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless,
    defaultViewport: headless ? { width: 1280, height: 800 } : null,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
    console.log('[pageerror]', err.message);
  });
  page.on('response', (res) => {
    const url = res.url();
    if (!url.includes('guest-feedback') && !url.includes('/api/')) return;
    if (res.status() >= 500) {
      failedResponses.push(`${res.status()} ${res.request().method()} ${url}`);
    }
  });

  try {
    console.log('1. Logging in...');
    const loginUrl = new URL('/login', baseUrl);
    loginUrl.searchParams.set('tenant', tenantId);
    await page.goto(loginUrl.href, { waitUntil: 'networkidle2', timeout: 20000 });
    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    await page.type('input[name="username"]', loginEmail);
    await page.type('input[type="password"]', loginPassword);
    const submit = await page.$('button[type="submit"]');
    if (submit) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
        submit.click(),
      ]);
    }
    await sleep(2000);
    if (page.url().includes('/login')) {
      hardFails.push('Login failed (still on /login)');
    } else {
      console.log('   Logged in:', page.url());
    }

    console.log('2. Opening /guest-feedback...');
    const listPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/tenant/guest-feedback') &&
        !res.url().includes('/summary') &&
        !res.url().includes('/export') &&
        res.request().method() === 'GET',
      { timeout: 20000 },
    );
    const summaryPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/tenant/guest-feedback/summary') &&
        res.request().method() === 'GET',
      { timeout: 20000 },
    );

    await page.goto(new URL('/guest-feedback', baseUrl).href, {
      waitUntil: 'networkidle2',
      timeout: 25000,
    });

    if (!page.url().includes('/guest-feedback')) {
      hardFails.push(`Not on /guest-feedback. URL: ${page.url()}`);
    }

    const listRes = await listPromise.catch(() => null);
    if (!listRes) {
      hardFails.push('Staff guest-feedback GET missing');
    } else if (listRes.status() >= 500) {
      hardFails.push(`Staff guest-feedback GET HTTP ${listRes.status()}`);
    } else if (listRes.status() >= 400) {
      hardFails.push(`Staff guest-feedback GET failed: HTTP ${listRes.status()}`);
    } else {
      console.log('   List GET OK:', listRes.status());
    }

    const summaryRes = await summaryPromise.catch(() => null);
    if (!summaryRes) {
      hardFails.push('Staff guest-feedback summary GET missing');
    } else if (summaryRes.status() >= 400) {
      hardFails.push(`Staff guest-feedback summary GET failed: HTTP ${summaryRes.status()}`);
    } else {
      console.log('   Summary GET OK:', summaryRes.status());
    }

    await page.waitForSelector('app-guest-feedback h1, .page-header h1', { timeout: 15000 });
    await sleep(500);

    const shell = await page.evaluate(() => {
      const t = document.body?.innerText || '';
      const h1 = (document.querySelector('app-guest-feedback h1, .page-header h1')?.textContent || '')
        .trim();
      const hasRawKeys = /\bFEEDBACK\.[A-Z0-9_]+\b/.test(t);
      const titleOk =
        /guest feedback|feedback de|comentarios|feedback|rückmeldungen|opinions|valoraciones/i.test(
          h1,
        ) || h1.length > 0;
      const hasQrCard = !!document.querySelector('.feedback-qr-card, #feedback-qr-heading');
      const hasTable = !!document.querySelector('table.feedback-table');
      const hasEmpty = !!document.querySelector('.empty-state');
      const hasAnalytics = !!document.querySelector('[data-testid="feedback-analytics"]');
      const hasExport = !!document.querySelector('[data-testid="feedback-export-csv"]');
      const hasLoadError = /\bFEEDBACK\.LOAD_FAILED\b/.test(t);
      return {
        h1,
        hasRawKeys,
        titleOk,
        hasQrCard,
        hasTable,
        hasEmpty,
        hasAnalytics,
        hasExport,
        hasLoadError,
        textSample: t.slice(0, 200),
      };
    });

    if (shell.hasRawKeys || shell.hasLoadError) {
      hardFails.push(`Raw FEEDBACK.* keys or load-failed key visible (h1=${shell.h1})`);
    }
    if (!shell.titleOk) {
      hardFails.push(`Staff heading missing or unexpected: ${shell.h1 || '(empty)'}`);
    } else {
      console.log('   Heading:', shell.h1);
    }
    if (!shell.hasAnalytics) {
      hardFails.push('Expected feedback analytics / trends panel');
    } else {
      console.log('   Analytics panel OK');
    }
    if (!shell.hasExport) {
      hardFails.push('Expected Export CSV button');
    } else {
      console.log('   Export CSV button OK');
    }
    if (!shell.hasQrCard && !shell.hasTable && !shell.hasEmpty) {
      hardFails.push('Expected QR card, feedback table, or empty state');
    } else {
      console.log(
        shell.hasTable
          ? '   Feedback table visible'
          : shell.hasEmpty
            ? '   Empty state OK'
            : '   QR card shell OK',
      );
    }

    const badApi = failedResponses.filter((x) => x.includes('guest-feedback'));
    if (badApi.length) {
      hardFails.push(`Hard failing guest-feedback responses: ${badApi.join('; ')}`);
    }
    if (pageErrors.length) {
      hardFails.push(`Page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
    }

    await browser.close();

    console.log('\n---');
    if (hardFails.length) {
      for (const f of hardFails) console.error('FAIL:', f);
      console.log('\n>>> RESULT: Staff guest-feedback smoke FAILED');
      process.exit(1);
    }
    console.log('>>> RESULT: Staff guest-feedback smoke OK');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
