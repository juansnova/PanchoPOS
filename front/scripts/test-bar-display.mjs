#!/usr/bin/env node
/**
 * Puppeteer smoke: Bar display at /bar (same KitchenDisplayComponent, view=bar).
 * Logs in, opens /bar, asserts URL, kitchen/bar chrome, and Bar title (not Kitchen).
 *
 * Usage (from repo root):
 *   LOGIN_EMAIL=... LOGIN_PASSWORD=... node front/scripts/test-bar-display.mjs
 *   BASE_URL=http://127.0.0.1:4202 HEADLESS=1 npm run test:bar-display --prefix front
 *
 * Env:
 *   BASE_URL       App URL (default: auto-detect 4202, 4203, 4200)
 *   LOGIN_EMAIL    Staff with kitchen_bar access (or DEMO_LOGIN_EMAIL / ADMIN_EMAIL)
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

async function resolveBaseUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  for (const port of [4202, 4203, 4200]) {
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
  const headless = isHeadless();
  const loginEmail =
    process.env.LOGIN_EMAIL || process.env.ADMIN_EMAIL || process.env.DEMO_LOGIN_EMAIL;
  const loginPassword =
    process.env.LOGIN_PASSWORD || process.env.ADMIN_PASSWORD || process.env.DEMO_LOGIN_PASSWORD;

  console.log('BASE_URL:', baseUrl);
  if (!loginEmail || !loginPassword) {
    console.error('FAIL: LOGIN_EMAIL/LOGIN_PASSWORD (or DEMO_LOGIN_* / ADMIN_*) required.');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless,
    defaultViewport: headless ? { width: 1280, height: 800 } : null,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  try {
    console.log('1. Logging in...');
    await page.goto(new URL('/login', baseUrl).href, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.type('input[name="username"]', loginEmail);
    await page.type('input[type="password"]', loginPassword);
    await page.click('button[type="submit"]');
    await sleep(4000);
    if (page.url().includes('/login')) {
      console.error('FAIL: Login failed.');
      process.exit(1);
    }

    console.log('2. Opening /bar...');
    await page.goto(new URL('/bar', baseUrl).href, { waitUntil: 'networkidle2', timeout: 15000 });
    if (!page.url().includes('/bar')) {
      console.error('FAIL: Not on /bar. URL:', page.url());
      process.exit(1);
    }

    console.log('3. Waiting for bar/kitchen chrome...');
    await page.waitForSelector('.kitchen-view .kitchen-header', { timeout: 15000 });

    const titleText = await page.$eval('.kitchen-title', (el) => (el.textContent || '').trim());
    const titleOk =
      /bar/i.test(titleText) ||
      /bebidas|boissons|getränke|barra/i.test(titleText);
    if (!titleOk || /kitchen display/i.test(titleText)) {
      console.error('FAIL: Expected Bar display title, got:', titleText);
      process.exit(1);
    }
    console.log('   Title:', titleText);

    const timerSettingsBtn = await page.$('.timer-settings-btn');
    if (!timerSettingsBtn) {
      console.error('FAIL: Timer settings button (.timer-settings-btn) not found on /bar.');
      process.exit(1);
    }

    const fullscreenBtn = await page.$('[data-testid="kitchen-fullscreen-toggle"]');
    if (!fullscreenBtn) {
      console.error('FAIL: Fullscreen toggle missing on /bar.');
      process.exit(1);
    }

    if (pageErrors.length > 0) {
      console.error('FAIL: pageerror(s):', pageErrors.slice(0, 3));
      process.exit(1);
    }

    console.log('RESULT: Bar display smoke passed.');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
