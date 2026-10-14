#!/usr/bin/env node
/**
 * Smoke: activate a demo table → Tables UI shows active duration (data-testid=table-active-duration).
 * Env: BASE_URL, LOGIN_EMAIL/LOGIN_PASSWORD (or DEMO_*), TENANT_ID, HEADLESS.
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
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
  const tenantId = process.env.TENANT_ID != null ? process.env.TENANT_ID : '1';
  if (!loginEmail || !loginPassword) {
    console.error('LOGIN_EMAIL and LOGIN_PASSWORD required');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: isHeadless(),
    defaultViewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let activatedTableId = null;

  try {
    const loginUrl = new URL('/login', baseUrl);
    loginUrl.searchParams.set('tenant', tenantId);
    await page.goto(loginUrl.href, { waitUntil: 'networkidle2', timeout: 20000 });
    await page.type('input[name="username"]', loginEmail);
    await page.type('input[type="password"]', loginPassword);
    await page.click('button[type="submit"]');
    await sleep(3000);
    if (page.url().includes('/login')) throw new Error('login failed');

    // Prefer an inactive table via API (cookie session), activate it, then assert UI.
    const tablesRes = await page.evaluate(async () => {
      const r = await fetch('/api/tables', { credentials: 'include' });
      return { status: r.status, body: await r.json() };
    });
    if (tablesRes.status !== 200) throw new Error(`GET /tables ${tablesRes.status}`);
    const tables = Array.isArray(tablesRes.body) ? tablesRes.body : [];
    const target =
      tables.find((t) => t && t.id && !t.is_active) ||
      tables.find((t) => t && t.id);
    if (!target) throw new Error('no tables found');

    if (!target.is_active) {
      const act = await page.evaluate(async (id) => {
        const r = await fetch(`/api/tables/${id}/activate`, {
          method: 'POST',
          credentials: 'include',
        });
        return { status: r.status, body: await r.json() };
      }, target.id);
      if (act.status !== 200) throw new Error(`activate failed ${act.status} ${JSON.stringify(act.body)}`);
      activatedTableId = target.id;
      console.log('Activated table', target.id, target.name, 'activated_at=', act.body.activated_at);
    } else {
      console.log('Using already-active table', target.id, target.name);
    }

    await page.goto(new URL('/tables?view=tiles', baseUrl).href, {
      waitUntil: 'networkidle2',
      timeout: 20000,
    });
    await sleep(1500);

    const texts = await page.$$eval('[data-testid="table-active-duration"]', (els) =>
      els.map((el) => (el.textContent || '').trim()).filter(Boolean),
    );
    console.log('Duration UI texts:', texts);
    if (!texts.length) throw new Error('table-active-duration not found on /tables');
    // Fresh activation should show 0m (not "2h 0m" from a timezone mis-parse).
    const freshOk = texts.some((t) => /(?:^|\s)0m\b/.test(t) && !/\d+h\s+0m\b/.test(t));
    if (activatedTableId != null && !freshOk) {
      throw new Error(`expected a short live duration after activate; got: ${JSON.stringify(texts)}`);
    }
    if (!texts.some((t) => /\d/.test(t))) {
      throw new Error(`unexpected duration texts: ${JSON.stringify(texts)}`);
    }
    console.log('>>> RESULT: table active duration smoke passed.');
  } catch (e) {
    console.error('FAIL:', e.message || e);
    process.exitCode = 1;
  } finally {
    if (activatedTableId != null) {
      try {
        await page.evaluate(async (id) => {
          await fetch(`/api/tables/${id}/close`, { method: 'POST', credentials: 'include' });
        }, activatedTableId);
        console.log('Closed table', activatedTableId);
      } catch (_) {}
    }
    await browser.close();
  }
}

main();
