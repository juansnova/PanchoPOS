/** Parse API timestamps: naive ISO from Postgres is UTC wall time (no offset). */
export function parseTableActivatedAt(activatedAt: string): Date {
  const s = activatedAt.trim();
  if (!s) return new Date(NaN);
  if (/Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) {
    return new Date(s);
  }
  return new Date(`${s}Z`);
}

/** Format elapsed active-session length for staff tables UI (live clock). */
export function formatElapsedActiveDuration(
  activatedAt: string | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!activatedAt) return null;
  const start = parseTableActivatedAt(activatedAt).getTime();
  if (Number.isNaN(start)) return null;
  const mins = Math.max(0, Math.floor((nowMs - start) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Format activation start time in tenant timezone (fallback: browser local). */
export function formatActivatedAtTime(
  activatedAt: string | null | undefined,
  locale: string,
  timeZone?: string | null,
): string | null {
  if (!activatedAt) return null;
  const d = parseTableActivatedAt(activatedAt);
  if (Number.isNaN(d.getTime())) return null;
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  const tz = timeZone?.trim();
  if (tz) opts.timeZone = tz;
  try {
    return new Intl.DateTimeFormat(locale, opts).format(d);
  } catch {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
  }
}
