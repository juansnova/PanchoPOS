#!/usr/bin/env node
/**
 * Smoke: Settings vertical nav layout + ?section= (#395) and #hash deep links (#365).
 */
import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { isHeadless } from './puppeteer-headless.mjs';

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
    } catch {
      /* ignore */
    }
  }
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

async function detectBaseUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  for (const port of [4203, 4202, 4200]) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok || res.status === 304) return `http://127.0.0.1:${port}`;
    } catch {
      /* try next */
    }
  }
  throw new Error('No app on 4203/4202/4200');
}

loadEnv();
const baseUrl = await detectBaseUrl();
const email = process.env.LOGIN_EMAIL || process.env.DEMO_LOGIN_EMAIL;
const password = process.env.LOGIN_PASSWORD || process.env.DEMO_LOGIN_PASSWORD;
if (!email || !password) {
  console.error('Need LOGIN_EMAIL/PASSWORD or DEMO_LOGIN_*');
  process.exit(1);
}

const browser = await puppeteer.launch({
  headless: isHeadless(),
  executablePath: chromePath(),
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
let failed = false;

try {
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/login?tenant=1`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[name="username"]', { timeout: 15000 });
  await page.type('input[name="username"]', email);
  await page.type('input[type="password"], input[name="password"]', password);
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
  ]);

  await page.goto(`${baseUrl}/settings`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="settings-nav"]', { timeout: 15000 });

  const desktop = await page.evaluate(() => {
    const layoutEl = document.querySelector('[data-testid="settings-layout"]');
    const style = layoutEl ? getComputedStyle(layoutEl) : null;
    return {
      hasNav: !!document.querySelector('[data-testid="settings-nav"]'),
      hasLayout: !!layoutEl,
      flexDirection: style?.flexDirection,
      hasOldTabs: !!document.querySelector('.tabs-container'),
      navItemCount: document.querySelectorAll('.settings-nav-item').length,
    };
  });
  console.log('desktop', desktop);
  if (!desktop.hasNav || desktop.hasOldTabs || desktop.flexDirection !== 'row') {
    console.error('FAIL: expected row layout with vertical nav on desktop');
    failed = true;
  }

  await page.click('[data-testid="settings-payments-tab"]');
  await page.waitForFunction(
    () => location.search.includes('section=payments') && location.hash === '#payments',
    { timeout: 5000 }
  );
  console.log('url after payments', page.url());

  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="settings-payments-tab"].active', { timeout: 10000 });
  console.log('payments active after reload');

  // #365: hash deep links (docs-friendly openinghours)
  await page.goto(`${baseUrl}/settings#openinghours`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="settings-hours-section"]', { timeout: 10000 });
  await page.waitForFunction(
    () =>
      location.hash === '#openinghours' &&
      !!document.querySelector('[data-testid="settings-hours-tab"].active'),
    { timeout: 10000 }
  );
  console.log('hash openinghours ok');

  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="settings-hours-section"]', { timeout: 10000 });
  console.log('openinghours active after hash reload');

  await page.goto(`${baseUrl}/settings#not-a-real-section`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="settings-nav"]', { timeout: 15000 });
  const unknownHashOk = await page.evaluate(() => {
    return (
      !!document.querySelector('[data-testid="settings-nav"]') &&
      !document.querySelector('[data-testid="settings-hours-section"]')
    );
  });
  console.log('unknown hash ignored', unknownHashOk);
  if (!unknownHashOk) {
    console.error('FAIL: unknown hash should leave default section');
    failed = true;
  }

  // #396: Delivery nav + legacy alias deep-link
  await page.click('[data-testid="settings-delivery-tab"]');
  await page.waitForSelector('[data-testid="settings-delivery-section"]', { timeout: 10000 });
  await page.waitForFunction(() => location.search.includes('section=delivery'), { timeout: 5000 });
  const deliveryOk = await page.evaluate(() => {
    const section = document.querySelector('[data-testid="settings-delivery-section"]');
    const fee = document.querySelector('#delivery_fee_cents');
    const integrations = document.querySelector('[data-testid="settings-delivery-integrations-section"]');
    return {
      hasSection: !!section,
      hasFee: !!fee,
      hasIntegrations: !!integrations,
    };
  });
  console.log('delivery', deliveryOk);
  if (!deliveryOk.hasSection || !deliveryOk.hasFee || !deliveryOk.hasIntegrations) {
    console.error('FAIL: Delivery section missing Satisfecho fields or marketplace block');
    failed = true;
  }

  await page.click('[data-testid="settings-payments-tab"]');
  await page.waitForFunction(() => location.search.includes('section=payments'), { timeout: 5000 });
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-testid="settings-delivery-section"]') &&
      !!document.querySelector('#currency_code'),
    { timeout: 10000 }
  );
  const paymentsClean = await page.evaluate(() => ({
    hasDeliveryFee: !!document.querySelector('#delivery_fee_cents'),
    hasLocationCheck: !!document.querySelector('input[name="location_check_enabled"]'),
    hasDeliverySection: !!document.querySelector('[data-testid="settings-delivery-section"]'),
  }));
  console.log('payments clean of delivery/location', paymentsClean);
  if (paymentsClean.hasDeliveryFee || paymentsClean.hasLocationCheck || paymentsClean.hasDeliverySection) {
    console.error('FAIL: Payment Settings still shows Delivery or Location Verification');
    failed = true;
  }

  await page.goto(`${baseUrl}/settings?section=delivery-integrations`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="settings-delivery-section"]', { timeout: 10000 });
  const aliasOk = await page.evaluate(
    () => !!document.querySelector('[data-testid="settings-delivery-tab"].active')
  );
  console.log('legacy delivery-integrations alias', aliasOk);
  if (!aliasOk) {
    console.error('FAIL: ?section=delivery-integrations should open Delivery');
    failed = true;
  }

  await page.goto(`${baseUrl}/settings?section=general`, { waitUntil: 'networkidle2' });
  const locationInGeneral = await page.evaluate(
    () => !!document.querySelector('input[name="location_check_enabled"]')
  );
  console.log('location verification in business profile', locationInGeneral);
  if (!locationInGeneral) {
    console.error('FAIL: Location Verification should be under Business Profile');
    failed = true;
  }

  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/settings?section=security`, { waitUntil: 'networkidle2' });
  const mobile = await page.evaluate(() => {
    const layoutEl = document.querySelector('[data-testid="settings-layout"]');
    const style = layoutEl ? getComputedStyle(layoutEl) : null;
    return {
      flexDirection: style?.flexDirection,
      securityVisible: !!document.querySelector('[data-testid="settings-security-section"]'),
    };
  });
  console.log('mobile', mobile);
  if (!mobile.securityVisible || mobile.flexDirection !== 'column') {
    console.error('FAIL: expected column layout + security section on mobile');
    failed = true;
  }
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
}

if (failed) {
  console.error('>>> RESULT: Settings vertical nav smoke FAILED');
  process.exit(1);
}
console.log('>>> RESULT: Settings vertical nav smoke passed.');
