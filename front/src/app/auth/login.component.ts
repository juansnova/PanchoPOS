import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { ApiService, type TenantSummary } from '../services/api.service';
import { ApiErrorMessageService } from '../services/api-error-message.service';
import { LegalLinksComponent } from '../shared/legal-links.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, RouterLink, TranslateModule, LegalLinksComponent],
  template: `
    <div class="lg-page">
      <!-- ============ brand side ============ -->
      <aside class="lg-brand" aria-hidden="false">
        <svg class="lg-art" viewBox="0 0 640 640" fill="none" aria-hidden="true">
          <!-- a table seen from above: two plates, knife and fork -->
          <g stroke="#fff" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="330" cy="390" r="236" stroke-opacity=".22" stroke-width="1.5" />
            <circle cx="330" cy="390" r="196" fill="#fff" fill-opacity=".07" stroke-opacity=".38" stroke-width="1.5" />
            <circle cx="330" cy="390" r="132" stroke-opacity=".26" stroke-width="1.2" />
            <circle cx="330" cy="390" r="70" fill="#fff" fill-opacity=".08" stroke-opacity=".3" stroke-width="1.2" />
            <circle cx="540" cy="70" r="116" stroke-opacity=".2" stroke-width="1.5" />
            <circle cx="540" cy="70" r="84" fill="#fff" fill-opacity=".05" stroke-opacity=".3" stroke-width="1.2" />
            <!-- fork -->
            <g transform="translate(34 300) rotate(-8)" stroke-opacity=".55" stroke-width="2.4">
              <path d="M0 0v44M16 0v44M32 0v44M0 44c0 22 32 22 32 0M16 66v104" />
            </g>
            <!-- knife -->
            <g transform="translate(612 330) rotate(7)" stroke-opacity=".55" stroke-width="2.4">
              <path d="M0 0c26 20 26 120 0 150h-10V0zM-5 150v66" />
            </g>
          </g>
        </svg>

        <div class="lg-brand-top">
          @if (selectedTenantLogoUrl()) {
            <span class="lg-logo"><img [src]="selectedTenantLogoUrl()!" [alt]="brandName()" /></span>
          } @else {
            <span class="lg-logo lg-logo-mono">{{ brandInitial() }}</span>
          }
          <span class="lg-kicker">{{ 'AUTH.BRAND_KICKER' | translate }}</span>
        </div>

        <div class="lg-brand-main">
          <h2 class="lg-name">
            <span>{{ brandParts().first }}</span>
            @if (brandParts().rest) { <em>{{ brandParts().rest }}</em> }
          </h2>
          <p class="lg-tagline">{{ 'AUTH.BRAND_TAGLINE' | translate }}</p>
        </div>

        <div class="lg-brand-foot">
          <span>{{ year }}</span>
          <i aria-hidden="true"></i>
          <span>{{ 'AUTH.BRAND_FOOT' | translate }}</span>
        </div>
      </aside>

      <!-- ============ form side ============ -->
      <main class="lg-form-side">
        <div class="lg-mobile-brand">
          @if (selectedTenantLogoUrl()) {
            <img [src]="selectedTenantLogoUrl()!" [alt]="brandName()" />
          }
          <b>{{ brandName() }}</b>
        </div>

        <div class="lg-card">
          <span class="lg-eyebrow">{{ (showOtpStep() ? 'AUTH.OTP_TITLE' : 'AUTH.EYEBROW') | translate }}</span>
          <h1>{{ 'AUTH.WELCOME_BACK' | translate }}</h1>
          <p class="lg-sub">{{ 'AUTH.SIGN_IN_ACCOUNT' | translate }}</p>

          @if (selectedTenant() && hasExplicitTenantParam()) {
            <div class="tenant-context" data-testid="login-tenant-context">
              @if (selectedTenantLogoUrl()) {
                <img [src]="selectedTenantLogoUrl()!" [alt]="selectedTenant()!.name" class="tenant-context-logo" />
              }
              <div class="tenant-context-copy">
                <span>{{ 'AUTH.LOGGING_INTO' | translate }}</span>
                <strong>{{ selectedTenant()!.name }}</strong>
              </div>
              <a routerLink="/">{{ 'AUTH.CHANGE_RESTAURANT' | translate }}</a>
            </div>
          }

          @if (showOtpStep()) {
            <p class="otp-prompt">{{ 'AUTH.OTP_ENTER_CODE' | translate }}</p>
            <form (ngSubmit)="onSubmitOtp()">
              <div class="lg-field">
                <label for="otp-code">{{ 'AUTH.OTP_CODE' | translate }}</label>
                <div class="lg-input lg-otp">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.2 7.6 8 9 4.8-1.4 8-4.5 8-9V6l-8-3z" /><path d="m9 12 2 2 4-4" /></svg>
                  <input
                    id="otp-code"
                    type="text"
                    inputmode="text"
                    maxlength="19"
                    [(ngModel)]="otpCode"
                    name="otpCode"
                    data-testid="login-otp-code"
                    [placeholder]="'AUTH.OTP_CODE_PLACEHOLDER' | translate"
                    autocomplete="one-time-code"
                  />
                </div>
                <p class="lg-hint">{{ 'AUTH.OTP_RECOVERY_HINT' | translate }}</p>
              </div>
              @if (error()) {
                <div class="lg-error" role="alert">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5h.01" /></svg>
                  {{ error() }}
                </div>
              }
              <button type="submit" class="lg-submit" [disabled]="!canSubmitOtp() || loading()">
                @if (loading()) { <i class="lg-spin"></i> }
                {{ loading() ? ('AUTH.VERIFYING' | translate) : ('AUTH.VERIFY_OTP' | translate) }}
              </button>
              <button type="button" class="lg-back" (click)="backToPassword()">{{ 'AUTH.BACK' | translate }}</button>
            </form>
          } @else {
            <form [formGroup]="form" (ngSubmit)="onSubmit()">
              <div class="lg-field">
                <label for="username">{{ 'AUTH.USERNAME' | translate }}</label>
                <div class="lg-input" [class.bad]="form.get('username')?.touched && form.get('username')?.invalid">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6" /><path d="M5 20c.7-3.7 3.5-5.6 7-5.6s6.3 1.9 7 5.6" /></svg>
                  <input
                    id="username"
                    type="text"
                    name="username"
                    formControlName="username"
                    [placeholder]="translate.instant('AUTH.USERNAME_PLACEHOLDER')"
                    autocomplete="username"
                  />
                </div>
                @if (form.get('username')?.touched && form.get('username')?.invalid) {
                  <div class="field-error">{{ 'AUTH.INVALID_USERNAME' | translate }}</div>
                }
              </div>

              <div class="lg-field">
                <label for="password">{{ 'AUTH.PASSWORD' | translate }}</label>
                <div class="lg-input">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>
                  <input
                    id="password"
                    [type]="showPassword() ? 'text' : 'password'"
                    name="password"
                    formControlName="password"
                    [placeholder]="translate.instant('AUTH.PASSWORD_PLACEHOLDER')"
                    autocomplete="current-password"
                    (keydown)="onKey($event)"
                    (keyup)="onKey($event)"
                  />
                  <button type="button" class="lg-eye" [class.on]="showPassword()" (click)="showPassword.set(!showPassword())" [attr.aria-label]="showPassword() ? ('AUTH.HIDE_PASSWORD' | translate) : ('AUTH.SHOW_PASSWORD' | translate)" tabindex="-1">
                    @if (showPassword()) {
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><path d="m1 1 22 22" /></svg>
                    } @else {
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    }
                  </button>
                </div>
                @if (capsOn()) {
                  <div class="lg-caps">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4 5 12h4v5h6v-5h4L12 4zM9 21h6" /></svg>
                    {{ 'AUTH.CAPS_ON' | translate }}
                  </div>
                }
              </div>

              @if (error()) {
                <div class="lg-error" role="alert">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5h.01" /></svg>
                  {{ error() }}
                </div>
              }

              <button type="submit" class="lg-submit" [disabled]="loading()">
                @if (loading()) { <i class="lg-spin"></i> }
                {{ loading() ? ('AUTH.SIGNING_IN' | translate) : ('AUTH.SIGN_IN' | translate) }}
                @if (!loading()) {
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                }
              </button>
            </form>
          }

          @if (legalTermsUrl() || legalPrivacyUrl()) {
            <div class="auth-actions-foot">
              <app-legal-links [inline]="true" [termsUrl]="legalTermsUrl()" [privacyUrl]="legalPrivacyUrl()" />
            </div>
          }
        </div>
      </main>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .lg-page {
      min-height: 100vh;
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
      background: var(--color-bg);
    }

    /* ---------------- brand side ---------------- */
    .lg-brand {
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 44px 56px;
      color: #fff;
      background:
        radial-gradient(90% 70% at 0% 0%, color-mix(in srgb, var(--color-primary) 100%, #fff 12%), transparent 70%),
        linear-gradient(155deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 55%, #1c1917));
    }

    .lg-art {
      position: absolute;
      right: -150px;
      bottom: -170px;
      width: min(760px, 120%);
      pointer-events: none;
      animation: lg-drift 18s ease-in-out infinite alternate;
    }
    @keyframes lg-drift { to { transform: translate(-14px, -10px) rotate(-1.5deg); } }

    .lg-brand-top, .lg-brand-main, .lg-brand-foot { position: relative; z-index: 1; }

    .lg-brand-top { display: flex; align-items: center; gap: 16px; }

    .lg-logo {
      display: grid;
      place-items: center;
      width: 64px;
      height: 64px;
      border-radius: 20px;
      background: #fff;
      box-shadow: 0 18px 30px -16px rgba(0, 0, 0, 0.5);
      overflow: hidden;
    }
    .lg-logo img { width: 100%; height: 100%; object-fit: contain; padding: 6px; box-sizing: border-box; }
    .lg-logo-mono { font-family: Georgia, 'Times New Roman', serif; font-size: 2rem; font-style: italic; color: var(--color-primary); }

    .lg-kicker { font-size: 0.7rem; font-weight: 800; letter-spacing: 0.24em; text-transform: uppercase; color: rgba(255, 255, 255, 0.85); }

    .lg-name {
      margin: 0;
      display: flex;
      flex-direction: column;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: clamp(3rem, 6.4vw, 5.6rem);
      font-weight: 400;
      line-height: 0.92;
      letter-spacing: -0.035em;
      text-shadow: 0 6px 30px rgba(0, 0, 0, 0.18);
    }
    .lg-name em { font-style: italic; padding-left: 0.5em; color: color-mix(in srgb, #fff 82%, var(--color-primary)); }

    .lg-tagline {
      margin: 22px 0 0;
      max-width: 34ch;
      text-wrap: balance;
      font-size: 1.05rem;
      font-weight: 500;
      line-height: 1.5;
      color: rgba(255, 255, 255, 0.86);
    }

    .lg-brand-foot { display: flex; align-items: center; gap: 12px; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(255, 255, 255, 0.7); }
    .lg-brand-foot i { width: 34px; height: 1px; background: rgba(255, 255, 255, 0.55); }

    /* ---------------- form side ---------------- */
    .lg-form-side {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 22px;
      padding: 40px 28px;
      background:
        radial-gradient(70% 50% at 100% 0%, color-mix(in srgb, var(--color-primary) 7%, transparent), transparent 70%),
        var(--color-bg);
    }

    .lg-mobile-brand { display: none; align-items: center; gap: 12px; }
    .lg-mobile-brand img { height: 44px; width: auto; border-radius: 12px; }
    .lg-mobile-brand b { font-family: Georgia, 'Times New Roman', serif; font-size: 1.5rem; font-weight: 500; }

    .lg-card { width: 100%; max-width: 410px; animation: lg-in 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
    @keyframes lg-in { from { opacity: 0; transform: translateY(14px); } }

    .lg-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--color-primary);
    }
    .lg-eyebrow::before { content: ''; width: 26px; height: 2px; background: var(--color-primary); }

    .lg-card h1 {
      margin: 12px 0 6px;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 2.5rem;
      font-weight: 400;
      letter-spacing: -0.03em;
      line-height: 1.05;
      color: var(--color-text);
    }
    .lg-sub { margin: 0 0 28px; color: var(--color-text-muted); font-size: 0.98rem; }

    .lg-field { margin-bottom: 18px; }
    .lg-field label {
      display: block;
      margin-bottom: 8px;
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--color-text-muted);
    }

    .lg-input {
      display: flex;
      align-items: center;
      gap: 12px;
      height: 56px;
      padding: 0 8px 0 18px;
      border-radius: 18px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      color: var(--color-text-muted);
      transition: border-color 0.15s, box-shadow 0.15s, color 0.15s;
    }
    .lg-input:hover { border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border)); }
    .lg-input:focus-within {
      border-color: var(--color-primary);
      color: var(--color-primary);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary) 18%, transparent);
    }
    .lg-input.bad { border-color: var(--color-error); }
    .lg-input svg { flex: none; }
    .lg-input input {
      flex: 1;
      min-width: 0;
      height: 100%;
      border: 0;
      outline: 0;
      background: transparent;
      font: inherit;
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-text);
    }
    .lg-input input::placeholder { color: var(--color-text-muted); font-weight: 500; opacity: 0.7; }
    .lg-otp input { font-variant-numeric: tabular-nums; letter-spacing: 0.2em; font-size: 1.15rem; padding-right: 12px; }

    .lg-eye {
      flex: none;
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--color-text-muted);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .lg-eye:hover { background: var(--color-primary-light); color: var(--color-primary); }
    .lg-eye.on { background: var(--color-primary); color: #fff; }

    .lg-caps { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; padding: 3px 10px; border-radius: 999px; background: #fef3c7; color: #92400e; font-size: 0.74rem; font-weight: 800; }
    .lg-hint { margin: 8px 0 0; font-size: 0.8rem; color: var(--color-text-muted); line-height: 1.45; }
    .field-error { margin-top: 8px; color: var(--color-error); font-size: 0.8rem; font-weight: 700; }

    .lg-error {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
      padding: 12px 16px;
      border-radius: 16px;
      background: rgba(220, 38, 38, 0.09);
      color: var(--color-error);
      font-size: 0.88rem;
      font-weight: 700;
      animation: lg-shake 0.4s ease;
    }
    @keyframes lg-shake { 20%, 60% { transform: translateX(-5px); } 40%, 80% { transform: translateX(5px); } }

    .lg-submit {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      height: 58px;
      margin-top: 6px;
      border: 0;
      border-radius: 999px;
      color: #fff;
      font: inherit;
      font-size: 1.02rem;
      font-weight: 800;
      cursor: pointer;
      touch-action: manipulation;
      background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 68%, #000));
      box-shadow: 0 20px 30px -18px var(--color-primary);
      transition: transform 0.15s, filter 0.15s, box-shadow 0.15s;
    }
    .lg-submit svg { transition: transform 0.2s; }
    .lg-submit:hover:not(:disabled) { filter: brightness(1.07); transform: translateY(-2px); box-shadow: 0 26px 34px -18px var(--color-primary); }
    .lg-submit:hover:not(:disabled) svg { transform: translateX(4px); }
    .lg-submit:disabled { opacity: 0.6; cursor: not-allowed; }

    .lg-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid rgba(255, 255, 255, 0.4); border-top-color: #fff; animation: lg-rot 0.7s linear infinite; }
    @keyframes lg-rot { to { transform: rotate(360deg); } }

    .lg-back { width: 100%; margin-top: 12px; height: 48px; border-radius: 999px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text); font: inherit; font-weight: 800; cursor: pointer; }
    .lg-back:hover { border-color: var(--color-primary); color: var(--color-primary); }

    .otp-prompt { margin: 0 0 18px; color: var(--color-text); font-size: 0.95rem; font-weight: 600; }

    .tenant-context {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      margin-bottom: 22px;
      border-radius: 18px;
      background: var(--color-surface);
      border: 1px dashed var(--color-border);
    }
    .tenant-context-logo { width: 2.5rem; height: 2.5rem; border-radius: 12px; object-fit: contain; background: #fff; border: 1px solid var(--color-border); flex: 0 0 auto; }
    .tenant-context-copy { min-width: 0; flex: 1; }
    .tenant-context-copy span { display: block; color: var(--color-text-muted); font-size: 0.78rem; line-height: 1.2; }
    .tenant-context-copy strong { display: block; color: var(--color-text); font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tenant-context a { color: var(--color-primary); font-size: 0.8rem; font-weight: 800; text-decoration: none; white-space: nowrap; }
    .tenant-context a:hover { text-decoration: underline; }

    .auth-actions-foot { margin-top: 28px; text-align: center; font-size: 0.85rem; color: var(--color-text-muted); display: flex; flex-wrap: wrap; justify-content: center; row-gap: 8px; }

    @media (prefers-reduced-motion: reduce) {
      .lg-art, .lg-card, .lg-error, .lg-spin { animation: none; }
      .lg-submit, .lg-submit svg { transition: none; }
    }

    @media (max-width: 920px) {
      .lg-page { grid-template-columns: 1fr; }
      .lg-brand { display: none; }
      .lg-mobile-brand { display: flex; }
      .lg-form-side { min-height: 100vh; justify-content: flex-start; padding-top: 48px; }
      .lg-card h1 { font-size: 2.1rem; }
    }
  `]
})
export class LoginComponent implements OnInit {
  private fb = inject(FormBuilder);
  private api = inject(ApiService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  translate = inject(TranslateService);
  private apiErr = inject(ApiErrorMessageService);

  legalTermsUrl = signal<string | null>(null);
  legalPrivacyUrl = signal<string | null>(null);
  selectedTenant = signal<TenantSummary | null>(null);
  selectedTenantLogoUrl = signal<string | null>(null);
  /** True only when the URL explicitly names a tenant (?tenant=), so the
   * "change restaurant" link isn't shown for this single-tenant deployment's
   * own default branding. */
  hasExplicitTenantParam = signal(false);

  readonly year = new Date().getFullYear();
  capsOn = signal(false);

  /** Restaurant name shown large on the brand side (falls back to this deployment's own name). */
  brandName = computed(() => this.selectedTenant()?.name?.trim() || 'Pancho Panza');
  brandInitial = computed(() => this.brandName().charAt(0).toUpperCase());
  brandParts = computed(() => {
    const [first, ...rest] = this.brandName().split(/\s+/);
    return { first, rest: rest.join(' ') };
  });

  onKey(ev: KeyboardEvent): void {
    this.capsOn.set(ev.getModifierState?.('CapsLock') ?? false);
  }

  ngOnInit(): void {
    this.api.getPublicLegalUrls().subscribe({
      next: (u) => {
        this.legalTermsUrl.set(u.terms_of_service_url ?? null);
        this.legalPrivacyUrl.set(u.privacy_policy_url ?? null);
      },
      error: () => {},
    });
    this.loadSelectedTenant();
  }

  error = signal<string>('');
  loading = signal(false);
  showOtpStep = signal(false);
  otpTempToken = signal<string | null>(null);
  otpCode = '';

  form = this.fb.group({
    username: ['', [Validators.required]],
    password: ['', Validators.required]
  });
  showPassword = signal(false);

  /**
   * Single-tenant deployment: this instance is Pancho Panza's own POS, so the
   * login screen shows its logo/name directly instead of a generic picker.
   */
  private static readonly DEFAULT_TENANT_SLUG = 'pancho-panza';

  private loadSelectedTenant(): void {
    const tenantParam = this.route.snapshot.queryParamMap.get('tenant');
    const tenantId = tenantParam != null ? Number.parseInt(tenantParam, 10) : NaN;
    const explicit = Number.isInteger(tenantId) && tenantId > 0;
    this.hasExplicitTenantParam.set(explicit);
    const tenantRef: number | string = explicit ? tenantId : LoginComponent.DEFAULT_TENANT_SLUG;

    this.api.getPublicTenant(tenantRef).subscribe({
      next: (tenant) => {
        this.selectedTenant.set(tenant);
        this.selectedTenantLogoUrl.set(this.api.getTenantLogoUrl(tenant.logo_filename, tenant.id));
      },
      error: () => {
        this.selectedTenant.set(null);
        this.selectedTenantLogoUrl.set(null);
      },
    });
  }

  /** iOS Safari Keychain can fill inputs without updating the reactive form model. */
  private syncLoginFieldsFromDom(): void {
    const usernameEl = document.getElementById('username') as HTMLInputElement | null;
    const passwordEl = document.getElementById('password') as HTMLInputElement | null;
    this.form.patchValue(
      {
        username: usernameEl?.value ?? this.form.get('username')?.value ?? '',
        password: passwordEl?.value ?? this.form.get('password')?.value ?? '',
      },
      { emitEvent: false },
    );
  }

  onSubmit() {
    this.syncLoginFieldsFromDom();
    this.form.updateValueAndValidity({ emitEvent: false });
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.error.set('');
    this.loading.set(true);

    const username = this.form.get('username')?.value ?? '';
    const password = this.form.get('password')?.value ?? '';
    const tenantId = this.route.snapshot.queryParams['tenant'];
    const id = tenantId != null ? parseInt(tenantId, 10) : undefined;
    this.api.login(username, password, isNaN(id as number) ? undefined : id).subscribe({
      next: () => {
        this.api.checkAuth().subscribe(user => {
          this.loading.set(false);
          if (user?.role === 'courier') {
            void this.router.navigate(['/courier']);
          } else {
            void this.router.navigate(['/dashboard']);
          }
        });
      },
      error: (err) => {
        this.loading.set(false);
        if (err.status === 403 && err.error?.require_otp && err.error?.temp_token) {
          this.otpTempToken.set(err.error.temp_token);
          this.showOtpStep.set(true);
          this.error.set('');
        } else if (err.status === 429) {
          this.error.set(this.apiErr.fromHttpError(err, 'AUTH.LOGIN_RATE_LIMITED'));
        } else {
          this.error.set(this.apiErr.fromHttpError(err, 'AUTH.LOGIN_FAILED'));
        }
      },
    });
  }

  onSubmitOtp() {
    const token = this.otpTempToken();
    const code = (this.otpCode || '').trim();
    if (!token || !this.canSubmitOtp()) return;
    this.error.set('');
    this.loading.set(true);
    this.api.loginWithOtp(token, code).subscribe({
      next: () => {
        this.api.checkAuth().subscribe(user => {
          this.loading.set(false);
          if (user?.role === 'courier') {
            void this.router.navigate(['/courier']);
          } else {
            void this.router.navigate(['/dashboard']);
          }
        });
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(this.apiErr.fromHttpError(err, 'API_ERRORS.INVALID_OTP_CODE'));
      }
    });
  }

  /** Accept 6-digit TOTP or an 8-char recovery code (with optional dashes). */
  canSubmitOtp(): boolean {
    const raw = (this.otpCode || '').trim();
    if (/^\d{6}$/.test(raw)) return true;
    const norm = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return norm.length === 8;
  }

  backToPassword() {
    this.showOtpStep.set(false);
    this.otpTempToken.set(null);
    this.otpCode = '';
    this.error.set('');
  }
}
