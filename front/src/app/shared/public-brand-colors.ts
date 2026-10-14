/**
 * Public guest-page branding tokens (#370).
 * Primary CTA default is blue (go/confirm), not terracotta/stop.
 */
export const PUBLIC_PRIMARY_COLOR_DEFAULT = '#2563EB';

/** Dark ink for light washes (matches global `--color-text`). */
export const PUBLIC_ON_LIGHT_INK = '#1C1917';

/** Light ink for dark washes / solid primary fills. */
export const PUBLIC_ON_DARK_INK = '#ffffff';

/** Resolve tenant primary CTA hex, or the OOBE blue default. */
export function resolvePublicPrimaryColor(
  hex: string | null | undefined,
): string {
  const v = (hex || '').trim();
  if (!v) return PUBLIC_PRIMARY_COLOR_DEFAULT;
  return v.startsWith('#') ? v : `#${v}`;
}

/** Normalize `#RGB` / `#RRGGBB` (optional leading `#`) to `#rrggbb`, or null. */
export function normalizeHex6(hex: string | null | undefined): string | null {
  const raw = (hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw.toLowerCase()}`;
  }
  return null;
}

/** Relative luminance (WCAG 2.x), 0–1. */
export function relativeLuminance(hex: string | null | undefined): number | null {
  const n = normalizeHex6(hex);
  if (!n) return null;
  const r = channelLuminance(parseInt(n.slice(1, 3), 16) / 255);
  const g = channelLuminance(parseInt(n.slice(3, 5), 16) / 255);
  const b = channelLuminance(parseInt(n.slice(5, 7), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function channelLuminance(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Pick black or white ink for text/icons on `bgHex` (WCAG-style).
 * When `bgHex` is missing/invalid, return white (default solid primary chrome).
 */
export function pickContrastingForeground(
  bgHex: string | null | undefined,
): string {
  const L = relativeLuminance(bgHex);
  if (L == null) return PUBLIC_ON_DARK_INK;
  // Midpoint where white and black have equal contrast against the background.
  return L > 0.179 ? PUBLIC_ON_LIGHT_INK : PUBLIC_ON_DARK_INK;
}

/** Contrast ratio between two hex colours (WCAG), or null if either is invalid. */
export function contrastRatio(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  const La = relativeLuminance(a);
  const Lb = relativeLuminance(b);
  if (La == null || Lb == null) return null;
  const lighter = Math.max(La, Lb);
  const darker = Math.min(La, Lb);
  return (lighter + 0.05) / (darker + 0.05);
}
