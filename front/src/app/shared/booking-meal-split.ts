/** Day keys used in tenant opening_hours JSON (Monday-first). */
const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type OpeningHoursDay = {
  hasBreak?: boolean;
  closed?: boolean;
  /** Custom name for the continuous (no-break) window or the combined “all” option. */
  serviceLabel?: string;
  /** Custom name for the first window (API service `lunch`). */
  morningLabel?: string;
  /** Custom name for the second window (API service `dinner`). */
  eveningLabel?: string;
};

export type BookingServiceFallbacks = {
  all: string;
  lunch: string;
  dinner: string;
};

/** True if tenant opening_hours JSON has any day with lunch/dinner break (hasBreak). */
export function tenantOpeningHoursHasMealSplit(openingHoursJson: string | null | undefined): boolean {
  if (!openingHoursJson?.trim()) return false;
  try {
    const oh = JSON.parse(openingHoursJson) as Record<string, OpeningHoursDay>;
    for (const d of DAY_KEYS) {
      const day = oh[d];
      if (day && typeof day === 'object' && day.hasBreak && !day.closed) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function parseOpeningHours(
  openingHoursJson: string | null | undefined,
): Record<string, OpeningHoursDay> | null {
  if (!openingHoursJson?.trim()) return null;
  try {
    const oh = JSON.parse(openingHoursJson) as Record<string, OpeningHoursDay>;
    return oh && typeof oh === 'object' ? oh : null;
  } catch {
    return null;
  }
}

/** Weekday key for a YYYY-MM-DD calendar date (local interpretation of the date parts). */
export function openingHoursDayKeyForDate(dateYmd: string | null | undefined): string | null {
  const raw = dateYmd?.trim();
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  // JS: 0=Sun … 6=Sat → our DAY_KEYS Monday-first
  const js = dt.getDay();
  return DAY_KEYS[js === 0 ? 6 : js - 1];
}

function trimLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t || null;
}

/**
 * Pick the day object used for booking service labels.
 * Prefer the selected calendar date; else the first open split day; else the first open day.
 */
export function pickOpeningHoursDayForLabels(
  openingHoursJson: string | null | undefined,
  dateYmd?: string | null,
): OpeningHoursDay | null {
  const oh = parseOpeningHours(openingHoursJson);
  if (!oh) return null;

  const preferredKey = openingHoursDayKeyForDate(dateYmd ?? null);
  if (preferredKey) {
    const day = oh[preferredKey];
    if (day && typeof day === 'object' && !day.closed) return day;
  }

  for (const d of DAY_KEYS) {
    const day = oh[d];
    if (day && typeof day === 'object' && day.hasBreak && !day.closed) return day;
  }
  for (const d of DAY_KEYS) {
    const day = oh[d];
    if (day && typeof day === 'object' && !day.closed) return day;
  }
  return null;
}

/**
 * Resolve display text for the booking “Service” control / summary.
 * Empty custom labels keep the provided i18n fallbacks (Lunch / Dinner / Lunch and dinner).
 */
export function resolveBookingServiceLabel(
  openingHoursJson: string | null | undefined,
  service: 'all' | 'lunch' | 'dinner',
  fallbacks: BookingServiceFallbacks,
  dateYmd?: string | null,
): string {
  const day = pickOpeningHoursDayForLabels(openingHoursJson, dateYmd);
  if (!day) {
    if (service === 'lunch') return fallbacks.lunch;
    if (service === 'dinner') return fallbacks.dinner;
    return fallbacks.all;
  }

  const morning = trimLabel(day.morningLabel);
  const evening = trimLabel(day.eveningLabel);
  const continuous = trimLabel(day.serviceLabel);

  if (service === 'lunch') return morning || fallbacks.lunch;
  if (service === 'dinner') return evening || fallbacks.dinner;

  if (day.hasBreak) {
    if (morning && evening) return `${morning} / ${evening}`;
    if (continuous) return continuous;
    if (morning) return morning;
    if (evening) return evening;
    return fallbacks.all;
  }
  return continuous || fallbacks.all;
}
