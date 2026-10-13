#!/usr/bin/env node
/**
 * Puppeteer smoke: public waiting list join + staff Reservations → Waitlist tab.
 *
 * Usage (from repo root):
 *   npm run test:waiting-list --prefix front
 *   BASE_URL=http://127.0.0.1:4202 npm run test:waiting-list --prefix front
 *
 * Env:
 *   BASE_URL         App URL (default: auto-detect 4203, 4202, 4200)
 *   TENANT_ID        Public /waitlist/:id and login tenant (default 1)
 *   LOGIN_EMAIL      Staff user (or DEMO_LOGIN_EMAIL / ADMIN_EMAIL from .env)
 *   LOGIN_PASSWORD   Staff password (or DEMO_LOGIN_PASSWORD / ADMIN_PASSWORD)
 *   HEADLESS         Default headless; set 0, false, or no for a visible browser.
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

  const suffix = String(Date.now()).slice(-8);
  const guestName = `Smoke Waitlist ${suffix}`;
  // Spanish mobile E.164: +34 + 9 digits (6XXXXXXXX); unique per run
  const guestPhone = `+346${suffix}`;

  console.log('test-waiting-list (Puppeteer)');
  console.log('BASE_URL:', baseUrl);
  console.log('TENANT_ID:', tenantId);
  console.log('Headless:', headless);
  console.log('Guest:', guestName, guestPhone);
  if (!loginEmail || !loginPassword) {
    console.log('LOGIN_EMAIL/LOGIN_PASSWORD not set – staff Waitlist tab will be skipped.');
  }
  console.log('---');

  const hardFails = [];
  const pageErrors = [];
  const failedResponses = [];

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless,
    defaultViewport: headless ? { width: 1280, height: 720 } : null,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
    console.log('[pageerror]', err.message);
  });
  page.on('response', (res) => {
    const url = res.url();
    if (!url.includes('/waiting-list') && !url.includes('/api/')) return;
    if (res.status() >= 400) {
      failedResponses.push(`${res.status()} ${res.request().method()} ${url}`);
    }
  });

  try {
    // 1. Public waitlist page + join
    const waitlistUrl = new URL(`/waitlist/${tenantId}`, baseUrl).href;
    console.log('1. Open public', waitlistUrl);
    await page.goto(waitlistUrl, { waitUntil: 'networkidle2', timeout: 25000 });

    await page.waitForSelector('#wl-name', { timeout: 15000 });
    const formOk = await page.evaluate(() => {
      const t = document.body?.innerText || '';
      return (
        !!document.querySelector('#wl-name') &&
        !!document.querySelector('#wl-phone') &&
        !!document.querySelector('#wl-party') &&
        !t.includes('WAITLIST.')
      );
    });
    if (!formOk) {
      hardFails.push('Public waitlist form missing or raw WAITLIST.* keys visible');
    } else {
      console.log('   Form visible (no raw WAITLIST.* keys)');
    }

    await page.click('#wl-name', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#wl-name', guestName);
    await page.click('#wl-party', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#wl-party', '2');
    await page.click('#wl-phone', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#wl-phone', guestPhone);
    await sleep(200);

    const postPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/public/tenants/${tenantId}/waiting-list`) &&
        res.request().method() === 'POST',
      { timeout: 20000 },
    );
    await page.click('.book-form button.btn-primary');
    const postRes = await postPromise.catch(() => null);
    if (!postRes) {
      const formErr = await page.evaluate(
        () => document.querySelector('.form-error')?.textContent?.trim() || '',
      );
      hardFails.push(`Public join POST missing (form error: ${formErr || 'none'})`);
    } else {
      const postStatus = postRes.status();
      const postBody = await postRes.json().catch(() => ({}));
      if (postStatus !== 200) {
        hardFails.push(
          `Public join POST failed: HTTP ${postStatus} ${JSON.stringify(postBody)}`,
        );
      } else {
        console.log('   Join POST OK, entry id:', postBody.id ?? '(n/a)');
      }
    }

    const successEl = await page.waitForSelector('.book-success-card', { timeout: 15000 }).catch(() => null);
    if (!successEl) {
      const formErr = await page.evaluate(
        () => document.querySelector('.form-error')?.textContent?.trim() || '',
      );
      hardFails.push(`Public join success card missing (form error: ${formErr || 'none'})`);
    } else {
      const successOk = await page.evaluate(() => {
        const t = document.body?.innerText || '';
        return (
          !t.includes('WAITLIST.') &&
          (t.includes('waiting list') ||
            t.includes('Warteliste') ||
            t.includes('lista de espera') ||
            t.includes('lista d') ||
            t.includes('attente') ||
            t.includes('You are on'))
        );
      });
      if (!successOk) {
        hardFails.push('Public join success card shown but raw keys or unexpected copy');
      } else {
        console.log('   Success card OK');
      }
    }

    // 2. Staff Waitlist tab (optional if no credentials)
    if (loginEmail && loginPassword) {
      console.log('2. Staff login → /reservations → Waitlist tab');
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
        hardFails.push('Staff login failed (still on /login)');
      } else {
        console.log('   Logged in:', page.url());

        await page.goto(new URL('/reservations', baseUrl).href, {
          waitUntil: 'networkidle2',
          timeout: 25000,
        });
        await page.waitForSelector('button.view-tab', { timeout: 15000 });

        const listPromise = page.waitForResponse(
          (res) =>
            res.url().includes('/waiting-list') &&
            res.request().method() === 'GET' &&
            !res.url().includes('/public/'),
          { timeout: 20000 },
        );

        const tabClicked = await page.evaluate(() => {
          const tabs = [...document.querySelectorAll('button.view-tab')];
          const wl = tabs.find((t) =>
            /waiting list|warteliste|lista de espera|lista d|liste d.?attente|llista d.?espera/i.test(
              t.textContent || '',
            ),
          );
          const target = wl || tabs[1];
          if (!target) return false;
          target.click();
          return true;
        });
        if (!tabClicked) {
          hardFails.push('Waitlist tab button not found on /reservations');
        } else {
          const listRes = await listPromise.catch(() => null);
          if (!listRes || listRes.status() >= 400) {
            hardFails.push(
              `Staff waiting-list GET failed or missing (status ${listRes?.status() ?? 'n/a'})`,
            );
          } else {
            console.log('   Staff waiting-list GET OK:', listRes.status());
          }

          await sleep(800);
          const staffOk = await page.evaluate((name) => {
            const t = document.body?.innerText || '';
            if (t.includes('RESERVATIONS.WL_') || t.includes('WAITLIST.')) return false;
            const hasEmpty =
              /no one on the waiting list|niemand auf der warteliste|nadie en la lista|ningú a la llista|personne sur la liste/i.test(
                t,
              );
            const hasGrid = !!document.querySelector('.reservation-grid .reservation-card');
            const hasGuest = t.includes(name);
            return hasGuest || hasGrid || hasEmpty;
          }, guestName);
          if (!staffOk) {
            hardFails.push('Staff Waitlist tab did not show list, empty state, or joined guest');
          } else {
            const sawGuest = await page.evaluate(
              (name) => (document.body?.innerText || '').includes(name),
              guestName,
            );
            console.log(
              sawGuest
                ? `   Waitlist shows joined guest (${guestName})`
                : '   Waitlist tab rendered (list or empty state)',
            );
          }
        }
      }
    } else {
      console.log('2. Skipped staff Waitlist (no credentials)');
    }

    const badApi = failedResponses.filter((x) => x.includes('waiting-list'));
    if (badApi.length) {
      hardFails.push(`Hard failing waiting-list responses: ${badApi.join('; ')}`);
    }
    if (pageErrors.length) {
      hardFails.push(`Page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
    }

    await browser.close();

    console.log('\n---');
    if (hardFails.length) {
      for (const f of hardFails) console.error('FAIL:', f);
      console.log('\n>>> RESULT: Waiting list smoke FAILED');
      process.exit(1);
    }
    console.log('>>> RESULT: Waiting list smoke OK (public join + staff tab as applicable)');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
