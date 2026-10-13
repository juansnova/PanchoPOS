#!/usr/bin/env node
/**
 * Puppeteer smoke: Settings → Security disable OTP with account password (#401).
 * Login first, enable OTP in DB while session is open, open Security, disable with password.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:4202 node front/scripts/test-settings-otp-disable-password.mjs
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

function setOtpEnabledViaDocker(email, password, enabled) {
  const py = `
import pyotp
from sqlmodel import Session, select
from app.db import engine
from app import models, security
email = ${JSON.stringify(email)}
password = ${JSON.stringify(password)}
enabled = ${enabled ? 'True' : 'False'}
with Session(engine) as session:
    user = session.exec(select(models.User).where(models.User.email == email)).first()
    if not user:
        raise SystemExit("user not found: " + email)
    if not security.verify_password(password, user.hashed_password):
        raise SystemExit("password mismatch for " + email)
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
    throw new Error(`set OTP failed: ${r.stderr || r.stdout}`);
  }
  if (!(r.stdout || '').includes('otp_set')) {
    throw new Error(`set OTP unexpected output: ${r.stdout}`);
  }
}

async function openSecurity(page, baseUrl) {
  await page.goto(`${baseUrl}/settings`, { waitUntil: 'networkidle2' });
  const secClicked = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll('a, button, [role="tab"], .nav-item'),
    );
    const el = candidates.find((n) =>
      /security|seguridad|sicherheit/i.test(n.textContent || ''),
    );
    if (el) {
      el.click();
      return true;
    }
    return false;
  });
  if (!secClicked) {
    await page.goto(`${baseUrl}/settings?section=security`, { waitUntil: 'networkidle2' });
  }
  await page.waitForSelector('[data-testid="settings-security-section"]', { timeout: 15000 });
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

  // Ensure login is not blocked by OTP
  setOtpEnabledViaDocker(loginEmail, loginPassword, false);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: isHeadless(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
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

    console.log('Enabling OTP in DB while session is open…');
    setOtpEnabledViaDocker(loginEmail, loginPassword, true);

    await openSecurity(page, baseUrl);
    await page.waitForSelector('[data-testid="otp-disable-password"]', { timeout: 15000 });

    await page.click('[data-testid="otp-disable-password"]', { clickCount: 3 });
    await page.type('[data-testid="otp-disable-password"]', 'wrong-password-xyz');
    await page.click('[data-testid="otp-disable-submit"]');
    await page.waitForFunction(
      () => {
        const err = document.querySelector('[data-testid="settings-security-section"] .field-error');
        return !!(err && (err.textContent || '').trim());
      },
      { timeout: 10000 },
    );
    console.log('OK: wrong password shows error');

    await page.click('[data-testid="otp-disable-password"]', { clickCount: 3 });
    await page.type('[data-testid="otp-disable-password"]', loginPassword);
    await page.click('[data-testid="otp-disable-submit"]');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="otp-disable-password"]'),
      { timeout: 15000 },
    );
    console.log('PASS: OTP disabled with account password');
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('FAIL:', err?.message || err);
    await page.screenshot({ path: join(repoRoot, 'tmp', 'otp-disable-password-fail.png') }).catch(
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
