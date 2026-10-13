#!/usr/bin/env node
/**
 * Puppeteer smoke: sidebar Log Out is an icon left of POS and lands on /login (#383).
 *
 * Usage (from repo root):
 *   BASE_URL=http://127.0.0.1:4202 node front/scripts/test-sidebar-logout.mjs
 *
 * Env: LOGIN_EMAIL / LOGIN_PASSWORD or DEMO_LOGIN_* in .env; TENANT_ID (default 1).
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
  if (existsSync(envPath)) {
    try {
      readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m && !process.env[m[1].trim()]) {
          process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
        }
      });
    } catch (_) {}
  }
}
loadEnv();

const CHROME_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function main() {
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

  const headless = isHeadless();
  const loginEmail =
    process.env.LOGIN_EMAIL ||
    process.env.ADMIN_EMAIL ||
    process.env.DEMO_LOGIN_EMAIL;
  const loginPassword =
    process.env.LOGIN_PASSWORD ||
    process.env.ADMIN_PASSWORD ||
    process.env.DEMO_LOGIN_PASSWORD;
  const tenantId = process.env.TENANT_ID || process.env.LOGIN_TENANT_ID || '1';

  if (!loginEmail || !loginPassword) {
    console.error('Credentials required: LOGIN_* or DEMO_LOGIN_*');
    process.exit(1);
  }

  console.log('BASE_URL:', baseUrl);
  console.log('Login as:', loginEmail);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless,
    defaultViewport: { width: 1280, height: 720 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    await page.goto(new URL('/login?tenant=' + tenantId, baseUrl).href, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForSelector('input[name="username"]', { timeout: 15000 });
    await page.click('input[name="username"]', { clickCount: 3 });
    await page.type('input[name="username"]', loginEmail);
    await page.click('input[type="password"]', { clickCount: 3 });
    await page.type('input[type="password"]', loginPassword);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
      page.click('button[type="submit"]'),
    ]);
    await sleep(2000);
    if (page.url().includes('/login')) {
      console.log('FAIL: still on login');
      process.exit(1);
    }

    await page.goto(new URL('/dashboard', baseUrl).href, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForSelector('aside.sidebar [data-testid="sidebar-logout"]', {
      timeout: 15000,
    });
    await sleep(500);

    const footerLogout = await page.$('aside.sidebar .sidebar-footer .logout-btn');
    if (footerLogout) {
      console.log('FAIL: bulky footer logout button still present');
      process.exit(1);
    }

    const order = await page.evaluate(() => {
      const row = document.querySelector('aside.sidebar .logo-row');
      if (!row) return null;
      const logout = row.querySelector('[data-testid="sidebar-logout"]');
      const brand = row.querySelector('[data-testid="sidebar-brand-home"]');
      const langHost = row.querySelector('app-language-picker');
      const langBtn = row.querySelector('[data-testid="language-picker-icon"]');
      if (!logout || !brand || !langHost || !langBtn) {
        return {
          logout: !!logout,
          brand: !!brand,
          langHost: !!langHost,
          langBtn: !!langBtn,
        };
      }
      const children = [...row.children];
      return {
        logoutIndex: children.indexOf(logout),
        brandIndex: children.indexOf(brand),
        langIndex: children.indexOf(langHost),
      };
    });

    if (
      !order ||
      order.logout === false ||
      order.brand === false ||
      order.langHost === false ||
      order.langBtn === false
    ) {
      console.log('FAIL: logo-row controls missing', order);
      process.exit(1);
    }
    if (!(order.logoutIndex < order.brandIndex && order.brandIndex < order.langIndex)) {
      console.log('FAIL: expected logout | POS | language order, got', order);
      process.exit(1);
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
      page.click('[data-testid="sidebar-logout"]'),
    ]);
    await sleep(1500);
    const url = page.url();
    if (!url.includes('/login') || url.includes('/provider') || url.includes('/courier')) {
      console.log('FAIL: after logout expected staff /login, got', url);
      process.exit(1);
    }

    console.log('PASS: sidebar logout icon left of POS; logout → /login');
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('FAIL:', err);
    await browser.close();
    process.exit(1);
  }
}

main();
