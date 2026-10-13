# Guest feedback analytics & export

**Status:** shipped (staff trends + CSV; #325)

Extends the baseline public `/feedback/:tenantId` flow and staff `/guest-feedback` list with staff-facing aggregates and CSV download. Google reviews remain deep-link only.

## Staff UI

On **Guest feedback** (`/guest-feedback`, reservations module):

- **Trends** panel: total responses, average rating, counts with comment / contact, star histogram, and a compact daily volume strip (last 14 days inside the selected lookback).
- Lookback toggles: **30 / 90 / 365** days (default 90).
- **Export CSV** downloads the same lookback window (UTF-8 BOM for Excel).

## API (authenticated, `reservation:read`)

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/tenant/guest-feedback` | Existing list (unchanged). |
| `GET` | `/tenant/guest-feedback/summary?days=90` | Aggregates for the lookback window. |
| `GET` | `/tenant/guest-feedback/export?days=90` | CSV attachment; omit `days` for all rows (capped, default max 5000). |

Same admin rate limit as other tenant management routes (`RATE_LIMIT_ADMIN_PER_MINUTE`). See `docs/0020-rate-limiting-production.md`.

## Public / receipt QR link format

Printing bridge may embed a QR later; the URL format is already stable:

| Use | URL |
|-----|-----|
| Generic feedback | `{origin}/feedback/{tenantId}` |
| After a reservation | `{origin}/feedback/{tenantId}?token={reservation_token}` |

`token` must be a reservation token for that tenant; invalid tokens are rejected on submit. Staff can print the generic QR from `/guest-feedback` today without the receipt printer.

## Out of scope (follow-ups)

- NPS / multi-question survey templates
- Post-reservation email/SMS with the feedback link
- Automated Google review posting (not allowed by Google; keep deep-link only)
