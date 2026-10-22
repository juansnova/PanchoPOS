import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ApiService } from '../services/api.service';
import {
  normalizeHex6,
  pickContrastingForeground,
} from './public-brand-colors';

export type PublicGuestNavKey = 'menu' | 'book' | 'waitlist' | 'feedback';

/**
 * Sticky tenant chrome for public guest pages (#376 / #364).
 * Compact branding plus links; language picker stays visible while the guest scrolls.
 * Ink colour follows wash luminance so light tenant backgrounds stay readable (#411).
 */
@Component({
  selector: 'app-public-guest-header',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  template: `
    @if (tenantId() > 0) {
      <header
        class="public-guest-header"
        data-testid="public-guest-header"
        [style.--hero-header-fg]="headerFg()"
        [attr.data-header-ink]="headerInkMode()"
      >
        <a
          class="public-guest-header__brand"
          [routerLink]="['/public-menu', menuLinkRef()]"
          [attr.title]="name()"
        >
          @if (logoSafe()) {
            <img class="public-guest-header__logo" [src]="logoSafe()" [alt]="name()" />
          }
          @if (name()) {
            <span class="public-guest-header__name">{{ name() }}</span>
          }
        </a>
        <nav class="public-guest-header__nav" [attr.aria-label]="'PUBLIC_GUEST_NAV.ARIA' | translate">
          <a
            [routerLink]="['/public-menu', menuLinkRef()]"
            class="public-guest-header__link"
            [class.is-active]="activePage() === 'menu'"
            data-testid="public-guest-nav-menu"
          >
            <svg class="public-guest-header__ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 2v7a2 2 0 002 2 2 2 0 002-2V2"/><path d="M9 2v20"/><path d="M17 22V2c-2.2 1.2-3.5 3.7-3.5 7s1.3 4 3.5 4"/></svg>
            <span>{{ 'PUBLIC_GUEST_NAV.MENU' | translate }}</span>
          </a>
          <a
            [routerLink]="bookRouterLink()"
            class="public-guest-header__link"
            [class.is-active]="activePage() === 'book'"
            data-testid="public-guest-nav-book"
          >
            <svg class="public-guest-header__ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>
            <span>{{ 'PUBLIC_GUEST_NAV.BOOK' | translate }}</span>
          </a>
          <a
            [routerLink]="['/waitlist', tenantId()]"
            class="public-guest-header__link"
            [class.is-active]="activePage() === 'waitlist'"
            data-testid="public-guest-nav-waitlist"
          >
            <svg class="public-guest-header__ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            <span>{{ 'PUBLIC_GUEST_NAV.WAITLIST' | translate }}</span>
          </a>
          <a
            [routerLink]="['/feedback', tenantId()]"
            class="public-guest-header__link"
            [class.is-active]="activePage() === 'feedback'"
            data-testid="public-guest-nav-feedback"
          >
            <svg class="public-guest-header__ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>
            <span>{{ 'PUBLIC_GUEST_NAV.FEEDBACK' | translate }}</span>
          </a>
        </nav>
      </header>
    }
  `,
  styles: `
    :host {
      display: block;
      position: sticky;
      top: 0;
      z-index: 40;
    }

    .public-guest-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-height: 3.25rem;
      padding: calc(0.35rem + env(safe-area-inset-top, 0px)) 0.75rem 0.35rem;
      background: var(--hero-header-bg, #171210);
      color: var(--hero-header-fg, #ffffff);
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06), 0 8px 20px -12px rgba(0, 0, 0, 0.5);
    }

    .public-guest-header__brand {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      min-width: 0;
      flex: 0 1 auto;
      color: inherit;
      text-decoration: none;
    }

    .public-guest-header__logo {
      width: 2rem;
      height: 2rem;
      object-fit: contain;
      border-radius: 0.4rem;
      background: #fff;
      flex-shrink: 0;
    }

    .public-guest-header__name {
      font-family: var(--font-brand, inherit);
      font-weight: 600;
      font-size: 1rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 9rem;
    }

    .public-guest-header__nav {
      display: flex;
      align-items: center;
      gap: 0.15rem;
      flex: 1 1 auto;
      min-width: 0;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }

    .public-guest-header__nav::-webkit-scrollbar {
      display: none;
    }

    .public-guest-header__link {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      min-height: 2.25rem;
      padding: 0.3rem 0.8rem;
      border-radius: 999px;
      color: color-mix(in srgb, var(--hero-header-fg, #ffffff) 80%, transparent);
      text-decoration: none;
      font-size: 0.8125rem;
      font-weight: 500;
      white-space: nowrap;
      transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
    }

    .public-guest-header__link:hover {
      color: var(--hero-header-fg, #ffffff);
    }

    .public-guest-header__link:active {
      transform: scale(0.96);
    }

    .public-guest-header__link:focus-visible,
    .public-guest-header__brand:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }

    .public-guest-header__link.is-active {
      background: #f08a3c;
      color: #171210;
      font-weight: 700;
    }

    :host([data-ink='dark']) .public-guest-header__link.is-active,
    .public-guest-header[data-header-ink='dark'] .public-guest-header__link.is-active {
      background: #171210;
      color: #fbf6ee;
    }

    @media (max-width: 480px) {
      .public-guest-header__name {
        max-width: 5.5rem;
      }
    }
    /* ===== v2: capsule nav, icon links, softer chrome ===== */
    .public-guest-header {
      min-height: 3.75rem;
      gap: 0.75rem;
      padding: calc(0.45rem + env(safe-area-inset-top, 0px)) 0.9rem 0.45rem;
      background-image:
        linear-gradient(90deg, transparent, color-mix(in srgb, #f08a3c 55%, transparent) 50%, transparent),
        linear-gradient(180deg, color-mix(in srgb, var(--hero-header-fg, #fff) 5%, transparent), transparent);
      background-size: 100% 1.5px, 100% 100%;
      background-position: bottom, top;
      background-repeat: no-repeat;
      box-shadow: 0 14px 24px -18px rgba(0, 0, 0, 0.7);
    }

    .public-guest-header__brand { gap: 0.6rem; }

    .public-guest-header__logo {
      width: 2.5rem;
      height: 2.5rem;
      padding: 2px;
      border-radius: 0.8rem;
      box-shadow: 0 0 0 1.5px color-mix(in srgb, #f08a3c 55%, transparent), 0 10px 16px -8px rgba(0, 0, 0, 0.6);
      transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    .public-guest-header__brand:hover .public-guest-header__logo { transform: rotate(-4deg) scale(1.05); }

    .public-guest-header__name {
      font-family: Georgia, 'Times New Roman', serif;
      font-style: italic;
      font-weight: 500;
      font-size: 1.2rem;
      letter-spacing: -0.01em;
      max-width: 11rem;
    }

    .public-guest-header__nav {
      flex: 0 1 auto;
      margin-left: auto;
      gap: 0.2rem;
      padding: 0.25rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--hero-header-fg, #fff) 8%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--hero-header-fg, #fff) 14%, transparent);
    }

    .public-guest-header__link {
      position: relative;
      gap: 0.45rem;
      min-height: 2.4rem;
      padding: 0.3rem 0.95rem 0.3rem 0.8rem;
      font-size: 0.82rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      transition: background 0.2s, color 0.2s, box-shadow 0.2s, transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
    }

    .public-guest-header__ico { flex: none; opacity: 0.85; transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); }
    .public-guest-header__link:hover:not(.is-active) { background: color-mix(in srgb, var(--hero-header-fg, #fff) 10%, transparent); }
    .public-guest-header__link:hover .public-guest-header__ico { transform: translateY(-1px) scale(1.12); }

    .public-guest-header__link.is-active {
      background: linear-gradient(135deg, #f7a554, #e0782a);
      color: #171210;
      font-weight: 800;
      box-shadow: 0 10px 18px -8px rgba(240, 138, 60, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.4);
    }

    .public-guest-header__link.is-active .public-guest-header__ico { opacity: 1; }

    :host([data-ink='dark']) .public-guest-header__link.is-active,
    .public-guest-header[data-header-ink='dark'] .public-guest-header__link.is-active {
      background: #171210;
      color: #fbf6ee;
      box-shadow: 0 10px 18px -10px rgba(23, 18, 16, 0.8);
    }

    @media (max-width: 640px) {
      .public-guest-header { flex-wrap: wrap; row-gap: 0.35rem; padding-top: calc(0.35rem + env(safe-area-inset-top, 0px)); padding-bottom: 0.45rem; min-height: 0; }
      .public-guest-header__logo { width: 2.1rem; height: 2.1rem; border-radius: 0.7rem; }
      .public-guest-header__link { min-height: 2.1rem; }
      .public-guest-header__brand { flex: 1 1 auto; }
      .public-guest-header__nav { flex: 1 1 100%; margin-left: 0; justify-content: space-between; }
      .public-guest-header__link { flex: 1 1 0; justify-content: center; padding: 0.3rem 0.4rem; font-size: 0.76rem; gap: 0.3rem; }
      .public-guest-header__name { max-width: 14rem; font-size: 1.1rem; }
    }
    @media (max-width: 380px) {
      .public-guest-header__ico { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .public-guest-header__logo, .public-guest-header__ico, .public-guest-header__link { transition: none; }
    }

  `,
})
export class PublicGuestHeaderComponent implements OnInit {
  private api = inject(ApiService);
  private sanitizer = inject(DomSanitizer);

  tenantId = input(0);
  /** Optional /public-menu path segment (slug preferred). Defaults to tenantId. */
  publicMenuRef = input<string | number | null>(null);
  /** Optional public_slug for /{slug}/book (#415). */
  publicBookSlug = input<string | null>(null);
  tenantName = input<string | null>(null);
  logoUrl = input<string | null>(null);
  /** Tenant public wash hex; when set, drives nav ink contrast (#411). */
  headerBackgroundColor = input<string | null>(null);
  activePage = input<PublicGuestNavKey>('book');

  private fetchedName = signal<string | null>(null);
  private fetchedLogo = signal<string | null>(null);
  private fetchedBg = signal<string | null>(null);
  private fetchedMenuRef = signal<string | number | null>(null);
  private fetchedBookSlug = signal<string | null>(null);

  name = computed(() => this.tenantName()?.trim() || this.fetchedName() || '');
  menuLinkRef = computed(
    () => this.publicMenuRef() ?? this.fetchedMenuRef() ?? this.tenantId(),
  );
  bookRouterLink = computed((): (string | number)[] => {
    const slug =
      this.publicBookSlug()?.trim() || this.fetchedBookSlug()?.trim() || '';
    if (slug) return ['/', slug, 'book'];
    return ['/book', this.tenantId()];
  });
  logoSafe = computed((): SafeResourceUrl | null => {
    const url = this.logoUrl() || this.fetchedLogo();
    if (!url) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  private resolvedBg = computed(
    () =>
      normalizeHex6(this.headerBackgroundColor()) ||
      normalizeHex6(this.fetchedBg()),
  );

  headerFg = computed(() => pickContrastingForeground(this.resolvedBg()));

  headerInkMode = computed(() =>
    this.headerFg() === '#ffffff' ? 'light' : 'dark',
  );

  ngOnInit(): void {
    const id = this.tenantId();
    if (!id) return;
    const haveName = !!this.tenantName()?.trim();
    const haveLogo = !!this.logoUrl();
    const haveBg = !!normalizeHex6(this.headerBackgroundColor());
    const haveMenuRef =
      this.publicMenuRef() != null && String(this.publicMenuRef()).trim() !== '';
    const haveBookSlug = !!this.publicBookSlug()?.trim();
    if (haveName && haveLogo && haveBg && haveMenuRef && haveBookSlug) return;
    this.api.getPublicTenant(id).subscribe({
      next: (t) => {
        if (!haveName) this.fetchedName.set(t.name);
        if (!haveLogo) {
          this.fetchedLogo.set(this.api.getTenantLogoUrl(t.logo_filename ?? undefined, t.id));
        }
        if (!haveBg) {
          this.fetchedBg.set(t.public_background_color ?? null);
        }
        const slug = t.public_slug?.trim();
        this.fetchedMenuRef.set(slug || t.id);
        if (!haveBookSlug) this.fetchedBookSlug.set(slug || null);
      },
      error: () => {
        /* Parent pages already show load errors. */
      },
    });
  }
}
