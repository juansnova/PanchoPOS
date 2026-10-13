#!/usr/bin/env node
/**
 * Puppeteer smoke: Settings → Printing docs link (#397).
 * Asserts the hardware printing runbook link points at docs/0070 on GitHub.
 *
 * Usage (from repo root):
 *   npm run test:settings-printing-docs --prefix front
 *
 * Env: BASE_URL; LOGIN_EMAIL / LOGIN_PASSWORD (or DEMO_LOGIN_*); TENANT_ID; HEADLESS
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
}
loadEnv();

const CHROME_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const EXPECTED_HREF =
  'https://github.com/satisfecho/pos/blob/master/docs/0070-hardware-printing.md';

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
    baseUrl = baseUrl || 'http://localhost:4202';
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

  console.log('BASE_URL:', baseUrl);
  console.log('Headless:', headless);
  if (!loginEmail || !loginPassword) {
    console.error(
      'Credentials required: set LOGIN_EMAIL/LOGIN_PASSWORD or DEMO_LOGIN_* in .env.'
    );
    process.exit(1);
  }
  console.log('Login as:', loginEmail);
  console.log('---');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless,
    defaultViewport: { width: 1280, height: 720 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tenantId = process.env.TENANT_ID || process.env.LOGIN_TENANT_ID || '1';

  try {
    console.log('1. Logging in (tenant=' + tenantId + ')...');
    await page.goto(new URL('/login?tenant=' + tenantId, baseUrl).href, {
      waitUntil: 'networkidle2',
      timeout: 15000,
    });
    await page.type('input[name="username"]', loginEmail);
    await page.type('input[type="password"]', loginPassword);
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
      await sleep(4000);
    }
    if (page.url().includes('/login')) {
      console.log('   FAIL: Still on login page.');
      await browser.close();
      process.exit(1);
    }

    console.log('2. Opening Settings → Printing...');
    await page.goto(new URL('/settings', baseUrl).href, {
      waitUntil: 'networkidle2',
      timeout: 15000,
    });
    await sleep(2000);
    const printingTab = await page.$('[data-testid="settings-printing-tab"]');
    if (!printingTab) {
      console.log('   FAIL: Printing tab not found.');
      await browser.close();
      process.exit(1);
    }
    await printingTab.click();
    await sleep(1500);

    console.log('3. Checking docs link...');
    const link = await page.waitForSelector('[data-testid="settings-printing-docs-link"]', {
      timeout: 10000,
    }).catch(() => null);
    if (!link) {
      console.log('   FAIL: settings-printing-docs-link not found.');
      await browser.close();
      process.exit(1);
    }
    const href = await page.evaluate((el) => el.getAttribute('href'), link);
    const target = await page.evaluate((el) => el.getAttribute('target'), link);
    if (href !== EXPECTED_HREF) {
      console.log('   FAIL: unexpected href:', href);
      await browser.close();
      process.exit(1);
    }
    if (target !== '_blank') {
      console.log('   FAIL: expected target=_blank, got:', target);
      await browser.close();
      process.exit(1);
    }
    console.log('   Link OK:', href);

    await browser.close();
    console.log('\n>>> RESULT: Settings Printing docs link smoke passed.');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    await browser.close();
    process.exit(1);
  }
}

main();
