#!/usr/bin/env node
/**
 * Puppeteer smoke: Settings → Security OTP secret Copy (#377).
 * Starts OTP setup (if not already enabled), clicks Copy, checks clipboard,
 * then cancels setup so OTP is not left half-enabled.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:4202 node front/scripts/test-settings-otp-copy.mjs
 * Env: LOGIN_EMAIL / LOGIN_PASSWORD (or DEMO_LOGIN_* from .env), HEADLESS (default on)
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

async function detectBaseUrl() {
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
  const baseUrl = await detectBaseUrl();
  const loginEmail =
    process.env.LOGIN_EMAIL || process.env.DEMO_LOGIN_EMAIL || process.env.ADMIN_EMAIL;
  const loginPassword =
    process.env.LOGIN_PASSWORD || process.env.DEMO_LOGIN_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!loginEmail || !loginPassword) {
    console.error('FAIL: set LOGIN_EMAIL and LOGIN_PASSWORD (or DEMO_LOGIN_*)');
    process.exit(1);
  }

  console.log('BASE_URL:', baseUrl);
  console.log('LOGIN:', loginEmail);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: isHeadless(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = browser.defaultBrowserContext();
  await context.overridePermissions(baseUrl, ['clipboard-read', 'clipboard-write']);
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[name="username"], #username');
    await page.type('input[name="username"], #username', loginEmail, {
      delay: 10,
    });
    await page.type('input[type="password"], input[name="password"], #password', loginPassword, {
      delay: 10,
    });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
      page.click('button[type="submit"], button.btn-primary'),
    ]);
    await page.waitForFunction(() => !location.pathname.includes('/login'), { timeout: 20000 });

    await page.goto(`${baseUrl}/settings`, { waitUntil: 'networkidle2' });
    // Open Security section (nav label or hash / data attr)
    const secClicked = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('a, button, [role="tab"], .nav-item'));
      const el = candidates.find((n) => /security|seguridad|sicherheit/i.test(n.textContent || ''));
      if (el) {
        el.click();
        return true;
      }
      return false;
    });
    if (!secClicked) {
      // Fallback: set section via URL fragment used by some builds
      await page.goto(`${baseUrl}/settings?section=security`, { waitUntil: 'networkidle2' });
    }
    await page.waitForSelector('[data-testid="settings-security-section"]', { timeout: 15000 });

    const alreadyEnabled = await page.evaluate(() => {
      const sec = document.querySelector('[data-testid="settings-security-section"]');
      return !!sec && /enabled|activado|aktiviert/i.test(sec.textContent || '');
    });
    if (alreadyEnabled) {
      console.log('SKIP: OTP already enabled for this user — cannot show setup secret without disable code.');
      console.log('PASS (section reachable)');
      await browser.close();
      process.exit(0);
    }

    // Start setup
    const enableBtn = await page.evaluateHandle(() => {
      const sec = document.querySelector('[data-testid="settings-security-section"]');
      if (!sec) return null;
      const btns = Array.from(sec.querySelectorAll('button'));
      return btns.find((b) => /enable|activar|aktivieren|otp/i.test(b.textContent || '')) || null;
    });
    if (!enableBtn.asElement()) {
      console.error('FAIL: Enable OTP button not found');
      process.exit(1);
    }
    await enableBtn.asElement().click();
    await page.waitForSelector('[data-testid="otp-secret-value"]', { timeout: 15000 });

    const secret = await page.$eval('[data-testid="otp-secret-value"]', (el) =>
      (el.textContent || '').trim(),
    );
    if (!secret || secret.length < 8) {
      console.error('FAIL: secret not shown');
      process.exit(1);
    }

    await page.click('[data-testid="otp-secret-copy"]');
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="otp-secret-copy"]');
        return btn && /copied|kopiert|copiado|copié|копирано|已复制|کاپی|कॉपी/i.test(btn.textContent || '');
      },
      { timeout: 5000 },
    );

    const pasted = await page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return null;
      }
    });
    if (pasted !== secret) {
      console.error('FAIL: clipboard mismatch', {
        secretLen: secret.length,
        pastedLen: pasted?.length ?? null,
      });
      process.exit(1);
    }
    console.log('OK: clipboard matches secret');

    // Cancel setup — leave account without enabling OTP
    await page.evaluate(() => {
      const sec = document.querySelector('[data-testid="settings-security-section"]');
      const btns = Array.from(sec?.querySelectorAll('button') || []);
      const cancel = btns.find((b) => /cancel|abbrechen|cancelar|annuler/i.test(b.textContent || ''));
      cancel?.click();
    });

    console.log('PASS');
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('FAIL:', err?.message || err);
    await page.screenshot({ path: join(repoRoot, 'tmp', 'otp-copy-fail.png') }).catch(() => {});
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
