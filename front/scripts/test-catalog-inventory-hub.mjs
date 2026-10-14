#!/usr/bin/env node
/**
 * Puppeteer smoke: Catalog & Inventory hub (#391).
 * Logs in, opens /catalog-inventory, asserts title + Products tile, follows Products.
 * Also clicks sidebar hub link from /dashboard.
 *
 * Env (or .env): LOGIN_EMAIL / LOGIN_PASSWORD or DEMO_LOGIN_*; BASE_URL; TENANT_ID; HEADLESS
 */

import { isHeadless } from './puppeteer-headless.mjs';
import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';
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
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

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

  const loginEmail = process.env.LOGIN_EMAIL || process.env.DEMO_LOGIN_EMAIL;
  const loginPassword = process.env.LOGIN_PASSWORD || process.env.DEMO_LOGIN_PASSWORD;
  const tenantId = process.env.TENANT_ID || '1';
  const headless = isHeadless();

  if (!loginEmail || !loginPassword) {
    console.error('Set LOGIN_EMAIL/LOGIN_PASSWORD or DEMO_LOGIN_*.');
    process.exit(1);
  }

  console.log('BASE_URL:', baseUrl);
  console.log('Headless:', headless);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless,
    defaultViewport: headless ? { width: 1280, height: 900 } : null,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    console.log('1. Login...');
    await page.goto(new URL(`/login?tenant=${tenantId}`, baseUrl).href, {
      waitUntil: 'networkidle2',
      timeout: 20000,
    });
    await page.type('input[name="username"]', loginEmail);
    await page.type('input[type="password"]', loginPassword);
    await page.click('button[type="submit"]');
    await sleep(4000);
    if (page.url().includes('/login')) {
      console.log('FAIL: still on login');
      process.exit(1);
    }

    console.log('2. Open /catalog-inventory...');
    await page.goto(new URL('/catalog-inventory', baseUrl).href, {
      waitUntil: 'networkidle2',
      timeout: 20000,
    });
    await sleep(1500);
    const title = await page.$('[data-testid="catalog-inventory-hub-title"]');
    const products = await page.$('[data-testid="hub-tile-products"]');
    if (!title || !products) {
      console.log('FAIL: hub title or products tile missing');
      process.exit(1);
    }
    console.log('   Hub title + products tile OK');

    console.log('3. Follow Products tile...');
    await products.click();
    await sleep(2000);
    if (!page.url().includes('/products')) {
      console.log('FAIL: products tile did not navigate to /products, url=', page.url());
      process.exit(1);
    }
    console.log('   Products route OK');

    console.log('4. Sidebar hub link from dashboard...');
    await page.goto(new URL('/dashboard', baseUrl).href, {
      waitUntil: 'networkidle2',
      timeout: 20000,
    });
    await sleep(1000);
    const hubLink = await page.$('[data-testid="nav-catalog-inventory-hub"]');
    if (!hubLink) {
      console.log('FAIL: sidebar hub link missing');
      process.exit(1);
    }
    await hubLink.click();
    await sleep(2000);
    if (!page.url().includes('/catalog-inventory')) {
      console.log('FAIL: sidebar link did not open hub, url=', page.url());
      process.exit(1);
    }
    const title2 = await page.$('[data-testid="catalog-inventory-hub-title"]');
    if (!title2) {
      console.log('FAIL: hub title missing after sidebar nav');
      process.exit(1);
    }
    console.log('   Sidebar → hub OK');

    console.log('PASS: catalog-inventory hub smoke');
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('FAIL:', err);
    await browser.close();
    process.exit(1);
  }
}

main();
