# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Meseros (staff on the floor) and restaurant guests are the main users. Staff use the app from PC, tablet or phone; guests mostly from their phone (public reservations, public menu, delivery/take-away ordering). Secondary: owners/admins (menu, reports, settings, inventory), kitchen/bar display screens, couriers.

## Product Purpose
Full-stack point of sale for a single restaurant (Pancho Panza, asadero): tables, orders, kitchen/bar display, reservations, waiting list, delivery, inventory, reports and billing. Success: fast, error-free service for waiters and an easy, trustworthy booking/ordering experience for guests.

## Capabilities and Constraints
Angular 20 SPA in `front/` (global SCSS partials in `front/src/styles/`, tokens in `front/src/styles.scss`, plus per-component inline styles), FastAPI + PostgreSQL backend. Presentation-only work: no changes to business logic, routes or API. i18n texts (ngx-translate) stay untouched. No `npm install`; check `pos-front` logs after each change.

## Brand Commitments
Existing orange palette (#C2672C primary, #DE7C34 logo accent), Inter for UI, Fredoka for wordmark and titles. Desired feel: warm and gastronomic, clean and professional.

## Product Principles
- Waiters' speed and legibility outrank decoration.
- Guest-facing pages are mobile-first and are the brand's face.
- One design system: shared tokens, no per-screen one-off styles.
- Motion is subtle and fast (<300 ms, transform/opacity only).

## Accessibility & Inclusion
Keep AA contrast, visible focus, touch targets suitable for tablets/phones, and respect reduced motion.
