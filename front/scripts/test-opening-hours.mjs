#!/usr/bin/env node
/**
 * Puppeteer test for Settings → Horarios de apertura (weekly planner). Nothing is saved: the test edits the
 * grid and checks the live feedback; any settings save request is aborted.
 *
 * Usage (from repo root):
 *   LOGIN_EMAIL=owner LOGIN_PASSWORD=secret node front/scripts/test-opening-hours.mjs
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Opens a time picker and chooses hh:mm (hour cell, then quarter cell which closes it). */
async function pickTime(page, pickerSelector, hhmm) {
  const [h, m] = hhmm.split(':');
  await page.click(`${pickerSelector} .oh-tp-btn`);
  await page.waitForSelector(`${pickerSelector} .oh-tp-panel`);
  const hours = await page.$$(`${pickerSelector} .oh-tp-hours .oh-tp-cell`);
  await hours[Number(h)].click();
  const mins = await page.$$(`${pickerSelector} .oh-tp-mins .oh-tp-cell`);
  await mins[Number(m) / 15].click();
}

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

let failed = 0;
function check(label, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : ` ${detail}`}`);
}

async function main() {
  const baseUrl = await detectBaseUrl();
  const email = process.env.LOGIN_EMAIL;
  const password = process.env.LOGIN_PASSWORD;
  if (!email || !password) {
    console.error('LOGIN_EMAIL and LOGIN_PASSWORD are required (owner or admin user).');
    process.exit(1);
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: isHeadless(),
    defaultViewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const errors = [];
  // Safety net: the test must never write settings, so any save request is aborted and counted.
  let saveAttempts = 0;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.method() === 'PUT' && /\/tenant\/settings/.test(req.url())) {
      saveAttempts++;
      req.abort();
    } else {
      req.continue();
    }
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  try {
    await page.goto(new URL('/login', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('input[name="username"]', { timeout: 15000 });
    await page.type('input[name="username"]', email);
    await page.type('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await sleep(4000);
    if (page.url().includes('/login')) throw new Error('Login failed (check credentials)');

    await page.goto(new URL('/settings', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('[data-testid="settings-hours-tab"]', { timeout: 15000 });
    await page.click('[data-testid="settings-hours-tab"]');
    await page.waitForSelector('[data-testid="settings-hours-section"] .oh-day', { timeout: 8000 });

    // Structure
    const days = await page.$$eval('.oh-day', (els) => els.length);
    const pills = await page.$$eval('.oh-week li', (els) => els.length);
    check('7 day rows', days === 7, `got ${days}`);
    check('7 week pills in the hero', pills === 7, `got ${pills}`);
    check('hero shows a summary', (await page.$eval('.oh-hero-summary', (e) => e.textContent.trim())).length > 0);
    check('exactly one day is marked today', (await page.$$eval('.oh-day.today', (e) => e.length)) === 1);

    // Editing the first day's closing time updates the bar and the summary
    const monday = '.oh-day:nth-child(1)';
    await page.waitForSelector(`${monday} app-opening-shift .oh-tp-btn`);
    const widthBefore = await page.$eval(`${monday} .oh-seg`, (e) => e.style.width);
    const summaryBefore = await page.$eval('.oh-hero-summary', (e) => e.textContent);
    await pickTime(page, `${monday} app-opening-shift app-time-picker:nth-of-type(2)`, '20:00');
    await sleep(300);
    const widthAfter = await page.$eval(`${monday} .oh-seg`, (e) => e.style.width);
    const summaryAfter = await page.$eval('.oh-hero-summary', (e) => e.textContent);
    check('changing the closing time moves the bar', widthBefore !== widthAfter, `${widthBefore} → ${widthAfter}`);
    check('changing the closing time updates the summary', summaryBefore !== summaryAfter);
    check('editing marks the save bar as dirty', (await page.$$eval('.st-savebar.dirty', (e) => e.length)) === 1);

    // Quick copy: Monday → weekdays
    await page.select('#oh-copy-from', 'monday');
    await page.click('[data-testid="oh-copy-weekdays"]');
    await sleep(300);
    const closes = await page.$$eval('.oh-day', (els) =>
      els.map((d) => d.querySelectorAll('app-opening-shift .oh-tp-btn b')[1]?.textContent.trim() ?? null),
    );
    check('copy to weekdays gives Tue–Fri the same closing time', closes.slice(1, 5).every((v) => v === '20:00'), JSON.stringify(closes));
    check('copy to weekdays leaves the weekend alone', closes.slice(5).every((v) => v !== '20:00'), JSON.stringify(closes));

    // Split shift: two windows appear
    await page.click(`${monday} .oh-chip input`);
    await sleep(300);
    const shifts = await page.$$eval(`${monday} app-opening-shift`, (e) => e.length);
    const segs = await page.$$eval(`${monday} .oh-seg`, (e) => e.length);
    check('split shift shows two service windows', shifts === 2, `got ${shifts}`);
    check('split shift draws two bar segments', segs === 2, `got ${segs}`);

    // Closing before opening is flagged and blocks saving
    await pickTime(page, `${monday} app-opening-shift:nth-of-type(1) app-time-picker:nth-of-type(2)`, '09:00');
    await sleep(300);
    check('closing before opening shows an error', (await page.$$eval(`${monday} .oh-error`, (e) => e.length)) === 1);
    await page.click('.st-savebar .btn-primary');
    await sleep(500);
    check('saving is blocked while hours are invalid', saveAttempts === 0 && (await page.$$eval('.oh-error', (e) => e.length)) >= 1, `save requests: ${saveAttempts}`);

    // Closing a day
    await page.click(`${monday} .switch .slider`);
    await sleep(300);
    check('closing a day shows the Cerrado badge', (await page.$$eval(`${monday} .closed-badge`, (e) => e.length)) === 1);

    // Delete confirmation is inline (no browser dialog)
    let dialog = false;
    page.on('dialog', async (d) => {
      dialog = true;
      await d.dismiss();
    });
    const del = await page.$('.oh-plan-actions .oh-btn');
    if (del) {
      await del.click();
      await sleep(200);
      check('delete asks inline, without a browser dialog', !dialog && (await page.$('.oh-ask')) !== null);
      await page.click('.oh-plan-actions .oh-btn:not(.oh-btn-danger)');
    } else {
      console.log('SKIP inline delete confirmation (no scheduled entries to delete)');
    }

    // Phone width
    await page.setViewport({ width: 390, height: 800, isMobile: true });
    await sleep(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('no horizontal overflow at 390px', overflow <= 4, `${overflow}px`);

    const appErrors = errors.filter((e) => !/favicon|net::ERR_ABORTED/.test(e));
    check('no console errors', appErrors.length === 0, JSON.stringify(appErrors.slice(0, 2)));
  } catch (e) {
    failed++;
    console.log('ERROR', e.message);
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}

main();
