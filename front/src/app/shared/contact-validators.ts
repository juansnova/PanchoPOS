/**
 * Client-side checks aligned with backend rules (authoritative validation on API).
 */

const EMAIL_MAX = 254;
/** Simplified RFC 5322-style local@domain check; backend uses email-validator. */
const EMAIL_PART = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function contactEmailValid(raw: string): boolean {
  const s = (raw || '').trim();
  if (!s || s.length > EMAIL_MAX) return false;
  if (s.includes('..') || s.startsWith('@') || s.endsWith('@')) return false;
  return EMAIL_PART.test(s);
}

/**
 * Colombian phone numbers: unified 10-digit numbering plan (mobile starts with 3,
 * landlines start with 60x since the 2021 dialing plan change), with an optional
 * +57/57 country code. Matches the backend's normalize_phone_e164(default_region="CO").
 */
export function contactPhoneValid(raw: string): boolean {
  const digits = (raw || '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('57') ? digits.slice(2) : digits;
  return /^\d{10}$/.test(local);
}

export function contactEmailValidator(control: { value: unknown }): Record<string, true> | null {
  const v = control.value;
  if (v == null || v === '') return null;
  return contactEmailValid(String(v)) ? null : { contactEmail: true };
}

export function contactPhoneValidator(control: { value: unknown }): Record<string, true> | null {
  const v = control.value;
  if (v == null || v === '') return { contactPhone: true };
  return contactPhoneValid(String(v)) ? null : { contactPhone: true };
}

/** Use when phone is optional: empty is valid. */
export function optionalContactPhoneValidator(control: { value: unknown }): Record<string, true> | null {
  const v = control.value;
  if (v == null || String(v).trim() === '') return null;
  return contactPhoneValid(String(v)) ? null : { contactPhone: true };
}

/** Login username: no email required. Matches backend normalize_username(). */
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9_.-]{1,30}[a-z0-9])?$/;

export function usernameValid(raw: string): boolean {
  return USERNAME_PATTERN.test((raw || '').trim().toLowerCase());
}

export function usernameValidator(control: { value: unknown }): Record<string, true> | null {
  const v = control.value;
  if (v == null || v === '') return null;
  return usernameValid(String(v)) ? null : { username: true };
}
