# PanchoPOS Documentation

This folder contains deployment guides, feature documentation, and reference notes. The main [README.md](../README.md) in the repo root links to specific docs below.

---

## Quick links

| Need to… | See |
|----------|-----|
| Set up Revolut (sandbox, redirects, certificates) | [REVOLUT.md](REVOLUT.md) |
| Run Puppeteer/UI tests | [testing.md](testing.md) |
| Deploy to a server | [0004-deployment.md](0004-deployment.md) |
| Configure Gmail for email | [0056-gmail-setup.md](0056-gmail-setup.md) |
| Troubleshoot missing reservation confirmation email | [0030-reservation-confirmation-email-troubleshooting.md](0030-reservation-confirmation-email-troubleshooting.md) |
| Understand reservations / waiting list (staff + public) | [0011-table-reservation-user-guide.md](0011-table-reservation-user-guide.md) |
| Guest / staff Satisfecho Delivery (checkout, courier, track) | [0053-satisfecho-delivery-order-channel.md](0053-satisfecho-delivery-order-channel.md) |
| Rate limits (production) | [0020-rate-limiting-production.md](0020-rate-limiting-production.md) |
| Security review notes (structured pass, not a pentest) | [SECURITY-REVIEW.md](SECURITY-REVIEW.md) |

---

## Deployment & operations

| Doc | Description |
|-----|-------------|
| [0073-google-analytics.md](0073-google-analytics.md) | GA4 gtag: measurement ID via gitignored `.secrets`, injected at front container start (never commit the ID). |
| [0004-deployment.md](0004-deployment.md) | Deployment guide: configuration (API_URL, WS_URL, CORS), deploy steps (compose, migrations). See also [0027](0027-amvara9-menu-images-troubleshooting.md) for uploads 404. |
| [0026-haproxy-ssl-amvara9.md](0026-haproxy-ssl-amvara9.md) | HAProxy SSL: durable cert path (certbot/haproxy-certs), reload without overwriting certs. See also [0027](0027-amvara9-menu-images-troubleshooting.md) for uploads 404. |
| [0027-amvara9-menu-images-troubleshooting.md](0027-amvara9-menu-images-troubleshooting.md) | Public menu/catalog image 404s on `/api/uploads/…` — **ops guide**; JSON `Image not found` → missing file / orphan DB ref. |

---

## Email & SMTP

| Doc | Description |
|-----|-------------|
| [0056-gmail-setup.md](0056-gmail-setup.md) | Gmail setup: create account, 2FA, App Password, POS Settings → Email (SMTP). |
| [0030-reservation-confirmation-email-troubleshooting.md](0030-reservation-confirmation-email-troubleshooting.md) | **Ops:** booking has email but no confirmation — diagnose script, log strings, tenant vs global SMTP. |

---

## Feature guides (user-facing)

| Doc | Description |
|-----|-------------|
| [0011-table-reservation-user-guide.md](0011-table-reservation-user-guide.md) | Table reservations: staff flows, public booking at `/book/:tenantId`, view/cancel at `/reservation?token=...`; public waiting list at `/waitlist/:tenantId` and staff Waiting list tab. Guest feedback trends/CSV: [0064](0064-guest-feedback-analytics.md). |
| [0015-kitchen-display.md](0015-kitchen-display.md) | Kitchen display: full-screen at `/kitchen` (and `/bar`); as many prep stations as needed, each product on one station so that display shows only what it must prepare; auto-refresh, WebSocket, optional sound; Satisfecho Delivery cards use table label "Satisfecho Delivery" (not shown once `out_for_delivery`); highlighted order/item comments. |
| [0016-reports.md](0016-reports.md) | Reports (Sales & Revenue): date range, summary (incl. overbooking slots when &gt; 0), by product/category/table/waiter, CSV/Excel export. |
| [0017-billing-customers-factura.md](0017-billing-customers-factura.md) | Billing customers (Factura): register company details, search, print invoice with "Bill to". Fiscal invoicing for this deployment is DIAN (Colombia): see [0078](0078-dian-invoicing.md). |
| [0028-tenant-public-branding.md](0028-tenant-public-branding.md) | Tenant public branding: background colour and header image for book, menu, reservation-view, waitlist, and guest feedback. |
| [0051-table-groups-mvp.md](0051-table-groups-mvp.md) | Floor-plan table join/unjoin: combined seats and reservation pool for joined tables. |
| [0053-satisfecho-delivery-order-channel.md](0053-satisfecho-delivery-order-channel.md) | Satisfecho Delivery: staff Delivery tab / courier API, public checkout `/delivery/{tenantId}`, fee/postal/radius coverage, guest track `/delivery/{tenantId}/track`, unpaid public TTL cleanup. |
| [0055-public-seo.md](0055-public-seo.md) | Public SEO: titles/meta/OG, robots.txt, sitemap.xml, noindex for staff shells. |
| [REVOLUT.md](REVOLUT.md) | Revolut Merchant API: checkout extension, sandbox CSR, redirect URLs, tenant payment setup. |

---

## Implementation plans & specs

| Doc | Description |
|-----|-------------|
| [0009-table-pin-security.md](0009-table-pin-security.md) | Table PIN security: activate / PIN / regenerate / close; public-menu gates; optional GPS flagging off by default — operator/reference. |
| [0021-working-plan.md](0021-working-plan.md) | Working plan (shift schedule): living guide — status, API, UI, ops. |
| [0025-reservation-overbooking-detection.md](0025-reservation-overbooking-detection.md) | Reservation overbooking: slot capacity, overbooking report, 400 on over capacity. |
| [0061-multi-warehouse-inventory.md](0061-multi-warehouse-inventory.md) | Multi-warehouse inventory: warehouses, receive/adjust attribution, stock filter. |
| [0062-pos-migration-import.md](0062-pos-migration-import.md) | Import from existing POS: products/categories CSV CLI, dry-run/apply, cutover runbook. |
| [0063-offline-capable-client.md](0063-offline-capable-client.md) | Offline POS client: staff cash + deferred card intent queue; fiscal online-only. |
| [0064-guest-feedback-analytics.md](0064-guest-feedback-analytics.md) | Guest feedback staff trends + CSV export; receipt QR link format. |
| [0071-split-bill.md](0071-split-bill.md) | Split bill / partial payments: amount-based payment legs, reconciliation API, one fiscal invoice per settled order. |
| [0078-dian-invoicing.md](0078-dian-invoicing.md) | DIAN (Colombia) fiscal invoicing: the live fiscal regime for this deployment. |

---

## Reference & notes

| Doc | Description |
|-----|-------------|
| [agent-cursor-rules.md](agent-cursor-rules.md) | Categorized index of **`.cursor/rules/*.mdc`** for agents (Angular, FastAPI/SQLModel, Docker/HAProxy, security, i18n, smoke tests); also linked from **`AGENTS.md`**. |
| [SECURITY-REVIEW.md](SECURITY-REVIEW.md) | Structured security pass (uploads, auth, tenant isolation, public/payment surfaces) — **not a penetration test**; repeat after major releases. |
| [0024-whatsapp-reminder-notes.md](0024-whatsapp-reminder-notes.md) | WhatsApp reservation reminder: Twilio channel (env + send-reminder). |
| [0020-rate-limiting-production.md](0020-rate-limiting-production.md) | Rate limiting: limits (login, register, payment, public menu, upload, admin), Redis, X-Forwarded-For, tests. |
| [0033-postgres-adhoc-sql-table-names.md](0033-postgres-adhoc-sql-table-names.md) | Ad-hoc SQL: no `restaurantorder` table; use `"order"` / `orderitem`, quoting reserved names. |
| [0070-hardware-printing.md](0070-hardware-printing.md) | Hardware printing: print-jobs API, LAN agent, ESC/POS, browser fallback. |

---

## Testing

| Doc | Description |
|-----|-------------|
| [testing.md](testing.md) | **Puppeteer UI tests**: prerequisites, env vars, all test scripts (reservations, demo data, working plan, tables, orders, reports, catalog, rate limit, etc.), npm script table, backend/data checks, coverage summary, known issues. |
