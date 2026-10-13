#!/usr/bin/env node
/**
 * Puppeteer smoke: OTP recovery codes (#400).
 * Enable 2FA → save recovery codes → log out → log in with a recovery code → reuse fails.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:4202 node front/scripts/test-otp-recovery-codes.mjs
 * Env: LOGIN_EMAIL / LOGIN_PASSWORD (or DEMO_LOGIN_*), HEADLESS (default on)
 */

import { isHeadless } from './puppeteer-headless.mjs';
import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

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

function dockerPy(py) {
  const r = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'docker-compose.yml',
      '-f',
      'docker-compose.dev.yml',
      'exec',
      '-T',
      'back',
      'python3',
      '-c',
      py,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`docker py failed: ${r.stderr || r.stdout}`);
  }
  return (r.stdout || '').trim();
}

function setOtpEnabledViaDocker(email, password, enabled) {
  const py = `
import pyotp
from sqlmodel import Session, select
from app.db import engine
from app import models, security, otp_recovery
email = ${JSON.stringify(email)}
password = ${JSON.stringify(password)}
enabled = ${enabled ? 'True' : 'False'}
with Session(engine) as session:
    user = session.exec(select(models.User).where(models.User.email == email)).first()
    if not user:
        raise SystemExit("user not found: " + email)
    if not security.verify_password(password, user.hashed_password):
        raise SystemExit("password mismatch for " + email)
    otp_recovery.delete_recovery_codes_for_user(session, user.id)
    if enabled:
        user.otp_secret = pyotp.random_base32()
        user.otp_enabled = True
    else:
        user.otp_secret = None
        user.otp_enabled = False
    session.add(user)
    session.commit()
    print("otp_set")
`;
  const out = dockerPy(py);
  if (!out.includes('otp_set')) throw new Error(`set OTP unexpected: ${out}`);
}

function totpNow(secret) {
  const out = dockerPy(`import pyotp; print(pyotp.TOTP(${JSON.stringify(secret)}).now())`);
  const code = (out.split('\n').pop() || '').trim();
  if (!/^\d{6}$/.test(code)) throw new Error(`bad totp: ${out}`);
  return code;
}

async function openSecurity(page, baseUrl) {
  await page.goto(`${baseUrl}/settings?section=security`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="settings-security-section"]', { timeout: 15000 });
}

async function loginWithPassword(page, baseUrl, email, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[name="username"], #username');
  await page.click('input[name="username"], #username', { clickCount: 3 });
  await page.type('input[name="username"], #username', email, { delay: 8 });
  await page.click('input[type="password"], input[name="password"], #password', { clickCount: 3 });
  await page.type('input[type="password"], input[name="password"], #password', password, {
    delay: 8,
  });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    page.click('button[type="submit"], button.btn-primary'),
  ]);
}

async function logoutViaApi(page, baseUrl) {
  await page.evaluate(async (url) => {
    await fetch(`${url}/api/logout`, { method: 'POST', credentials: 'include' });
  }, baseUrl);
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

  setOtpEnabledViaDocker(loginEmail, loginPassword, false);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: isHeadless(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);

  try {
    await loginWithPassword(page, baseUrl, loginEmail, loginPassword);
    await page.waitForFunction(() => !location.pathname.includes('/login'), { timeout: 20000 });

    await openSecurity(page, baseUrl);
    // Start setup if not already mid-flow
    const enableBtn = await page.$('button.btn-primary');
    const enableText = enableBtn
      ? await page.evaluate((el) => (el.textContent || '').toLowerCase(), enableBtn)
      : '';
    if (/otp|two-factor|2fa|autentic/i.test(enableText) || enableBtn) {
      // Prefer clicking the enable button inside security section
      await page.evaluate(() => {
        const sec = document.querySelector('[data-testid="settings-security-section"]');
        const btn = sec && sec.querySelector('button.btn-primary');
        if (btn) btn.click();
      });
    }
    await page.waitForSelector('[data-testid="otp-secret-value"]', { timeout: 20000 });
    const secret = await page.$eval('[data-testid="otp-secret-value"]', (el) =>
      (el.textContent || '').trim(),
    );
    if (!secret) throw new Error('OTP secret empty');
    // Generate TOTP immediately before submit so the 30s window is fresh
    const totp = totpNow(secret);
    await page.waitForSelector('[data-testid="otp-confirm-code"]', { timeout: 10000 });
    await page.click('[data-testid="otp-confirm-code"]', { clickCount: 3 });
    await page.type('[data-testid="otp-confirm-code"]', totp, { delay: 5 });
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="otp-confirm-submit"]');
        return btn && !btn.disabled;
      },
      { timeout: 5000 },
    );
    await page.click('[data-testid="otp-confirm-submit"]');

    await page.waitForSelector('[data-testid="otp-recovery-codes-panel"]', { timeout: 20000 });
    const recoveryCodes = await page.$$eval(
      '[data-testid="otp-recovery-codes-list"] code',
      (nodes) => nodes.map((n) => (n.textContent || '').trim()).filter(Boolean),
    );
    if (recoveryCodes.length < 1) throw new Error('no recovery codes shown');
    console.log('OK: recovery codes shown:', recoveryCodes.length);

    await page.click('[data-testid="otp-recovery-saved-confirm"]');
    await page.click('[data-testid="otp-recovery-continue"]');
    await page.waitForSelector('[data-testid="otp-recovery-remaining"]', { timeout: 15000 });
    console.log('OK: confirmed codes saved');

    const useCode = recoveryCodes[0];
    await logoutViaApi(page, baseUrl);

    await loginWithPassword(page, baseUrl, loginEmail, loginPassword);
    await page.waitForSelector('[data-testid="login-otp-code"]', { timeout: 20000 });
    await page.type('[data-testid="login-otp-code"]', useCode, { delay: 10 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
      page.click('button[type="submit"], button.btn-submit'),
    ]);
    await page.waitForFunction(() => !location.pathname.includes('/login'), { timeout: 20000 });
    console.log('OK: logged in with recovery code');

    await logoutViaApi(page, baseUrl);
    await loginWithPassword(page, baseUrl, loginEmail, loginPassword);
    await page.waitForSelector('[data-testid="login-otp-code"]', { timeout: 20000 });
    await page.type('[data-testid="login-otp-code"]', useCode, { delay: 10 });
    await page.click('button[type="submit"], button.btn-submit');
    await page.waitForFunction(
      () => {
        const err = document.querySelector('.error-banner');
        return !!(err && (err.textContent || '').trim());
      },
      { timeout: 15000 },
    );
    console.log('PASS: reused recovery code rejected');

    // Cleanup: login with TOTP and disable OTP
    const secretNow = dockerPy(`
from sqlmodel import Session, select
from app.db import engine
from app import models
email = ${JSON.stringify(loginEmail)}
with Session(engine) as session:
    user = session.exec(select(models.User).where(models.User.email == email)).first()
    print(user.otp_secret or "")
`);
    const secretLine = secretNow.split('\n').pop().trim();
    const totp2 = totpNow(secretLine);
    await page.click('[data-testid="login-otp-code"]', { clickCount: 3 });
    await page.type('[data-testid="login-otp-code"]', totp2, { delay: 10 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
      page.click('button[type="submit"], button.btn-submit'),
    ]);
    await page.waitForFunction(() => !location.pathname.includes('/login'), { timeout: 20000 });
    setOtpEnabledViaDocker(loginEmail, loginPassword, false);

    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('FAIL:', err?.message || err);
    await page.screenshot({ path: join(repoRoot, 'tmp', 'otp-recovery-codes-fail.png') }).catch(
      () => {},
    );
    try {
      setOtpEnabledViaDocker(loginEmail, loginPassword, false);
    } catch (_) {}
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
