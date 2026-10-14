import { Component, inject, OnInit, signal } from '@angular/core';
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
    <main class="auth-page">
      <div class="auth-card">
        @if (selectedTenantLogoUrl()) {
          <div class="brand-hero">
            <img [src]="selectedTenantLogoUrl()!" [alt]="selectedTenant()?.name || ''" class="brand-hero-logo" />
          </div>
        }

        <div class="auth-header">
          <h1>{{ 'AUTH.WELCOME_BACK' | translate }}</h1>
          <p>{{ 'AUTH.SIGN_IN_ACCOUNT' | translate }}</p>
        </div>

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
          <p class="otp-recovery-hint">{{ 'AUTH.OTP_RECOVERY_HINT' | translate }}</p>
          <form (ngSubmit)="onSubmitOtp()">
            <div class="form-group">
              <label for="otp-code">{{ 'AUTH.OTP_CODE' | translate }}</label>
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
              >
            </div>
            @if (error()) {
              <div class="error-banner" role="alert">{{ error() }}</div>
            }
            <button type="submit" class="btn-submit" [disabled]="!canSubmitOtp() || loading()">
              {{ loading() ? ('AUTH.VERIFYING' | translate) : ('AUTH.VERIFY_OTP' | translate) }}
            </button>
            <button type="button" class="btn-back" (click)="backToPassword()">{{ 'AUTH.BACK' | translate }}</button>
          </form>
        } @else {
        <form [formGroup]="form" (ngSubmit)="onSubmit()">
          <div class="form-group">
            <label for="username">{{ 'AUTH.USERNAME' | translate }}</label>
            <input
              id="username"
              type="text"
              name="username"
              formControlName="username"
              [placeholder]="translate.instant('AUTH.USERNAME_PLACEHOLDER')"
              autocomplete="username"
            >
            @if (form.get('username')?.touched && form.get('username')?.invalid) {
              <div class="field-error">{{ 'AUTH.INVALID_USERNAME' | translate }}</div>
            }
          </div>

          <div class="form-group">
            <label for="password">{{ 'AUTH.PASSWORD' | translate }}</label>
            <div class="input-with-toggle">
              <input 
                id="password" 
                [type]="showPassword() ? 'text' : 'password'" 
                name="password"
                formControlName="password"
                [placeholder]="translate.instant('AUTH.PASSWORD_PLACEHOLDER')"
                autocomplete="current-password"
              >
              <button type="button" class="pw-toggle" (click)="showPassword.set(!showPassword())" [attr.aria-label]="showPassword() ? ('AUTH.HIDE_PASSWORD' | translate) : ('AUTH.SHOW_PASSWORD' | translate)" tabindex="-1">
                @if (showPassword()) {
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                } @else {
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>

          @if (error()) {
            <div class="error-banner" role="alert">{{ error() }}</div>
          }

          <button type="submit" class="btn-submit" [disabled]="loading()">
            {{ loading() ? ('AUTH.SIGNING_IN' | translate) : ('AUTH.SIGN_IN' | translate) }}
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
  `,
  styles: [`
    .auth-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-5);
      background:
        radial-gradient(circle at 15% -10%, color-mix(in srgb, var(--color-brand-accent) 16%, transparent), transparent 55%),
        radial-gradient(circle at 100% 100%, color-mix(in srgb, var(--color-brand-accent) 10%, transparent), transparent 50%),
        var(--color-bg);
    }

    .auth-card {
      width: 100%;
      max-width: 400px;
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border);
      box-shadow: var(--shadow-lg);
      padding: var(--space-8) var(--space-6);
      animation: auth-card-in var(--duration-base) var(--ease-out) both;
    }

    @keyframes auth-card-in {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
    }

    @media (max-width: 480px) {
      .auth-page {
        align-items: flex-start;
        padding: var(--space-4);
        padding-top: var(--space-8);
      }
      .auth-card {
        padding: var(--space-6) var(--space-5);
      }
    }

    .brand-hero {
      display: flex;
      justify-content: center;
      margin-bottom: var(--space-5);
    }

    .brand-hero-logo {
      height: 96px;
      width: auto;
      max-width: 100%;
      object-fit: contain;
    }

    .input-with-toggle {
      position: relative;
      display: flex;
    }
    .input-with-toggle input {
      flex: 1;
      padding-inline-end: 2.75rem;
    }
    .input-with-toggle .pw-toggle {
      position: absolute;
      inset-inline-end: var(--space-2);
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      border-radius: var(--radius-md);
      min-width: 44px;
      min-height: 44px;
      margin-inline-end: calc(var(--space-2) * -1);
      cursor: pointer;
      color: var(--color-text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .input-with-toggle .pw-toggle:hover {
      color: var(--color-text);
    }
    .input-with-toggle .pw-toggle:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: -2px;
    }

    .auth-header {
      margin-bottom: var(--space-6);
      text-align: center;

      h1 {
        font-family: var(--font-brand);
        font-size: 1.75rem;
        font-weight: 600;
        line-height: 1.2;
        color: var(--color-text);
        margin-bottom: var(--space-2);
        text-wrap: balance;
      }

      p {
        color: var(--color-text-muted);
        font-size: 0.9375rem;
      }
    }

    .tenant-context {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3);
      margin-bottom: var(--space-5);
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
    }

    .tenant-context-logo {
      width: 2.5rem;
      height: 2.5rem;
      border-radius: var(--radius-md);
      object-fit: contain;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      flex: 0 0 auto;
    }

    .tenant-context-copy {
      min-width: 0;
      flex: 1;
    }

    .tenant-context-copy span {
      display: block;
      color: var(--color-text-muted);
      font-size: 0.8125rem;
      line-height: 1.2;
    }

    .tenant-context-copy strong {
      display: block;
      color: var(--color-text);
      font-size: 0.9375rem;
      line-height: 1.35;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tenant-context a {
      color: var(--color-primary);
      font-size: 0.8125rem;
      font-weight: 500;
      text-decoration: none;
      white-space: nowrap;
    }

    .tenant-context a:hover {
      text-decoration: underline;
    }

    .error-banner {
      background: rgba(220, 38, 38, 0.08);
      color: #B91C1C;
      border: 1px solid rgba(220, 38, 38, 0.25);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      font-size: 0.875rem;
      margin-bottom: var(--space-4);
      animation: auth-error-in var(--duration-base) var(--ease-out) both;
    }

    @keyframes auth-error-in {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
    }

    .btn-submit {
      width: 100%;
      padding: var(--space-4);
      background: var(--color-primary);
      color: var(--color-on-primary);
      border: none;
      border-radius: var(--radius-md);
      font-family: inherit;
      font-size: 1rem;
      font-weight: 600;
      min-height: 48px;
      cursor: pointer;
      position: relative;
      isolation: isolate;
      transition: transform var(--duration-fast) var(--ease-out);

      &::before {
        content: '';
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: inherit;
        background: var(--color-primary-hover);
        opacity: 0;
        transition: opacity var(--duration-fast) var(--ease-out);
      }

      &:hover:not(:disabled)::before {
        opacity: 1;
      }

      &:active:not(:disabled) {
        transform: scale(0.98);
      }

      &:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 3px;
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }

    .auth-actions-foot {
      margin-top: var(--space-5);
      text-align: center;
      font-size: 0.9375rem;
      color: var(--color-text-muted);
      line-height: 1.6;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: baseline;
      column-gap: 0;
      row-gap: var(--space-2);
    }
    .auth-actions-foot > a {
      color: var(--color-primary);
      font-weight: 500;
      margin-left: var(--space-2);
      text-decoration: none;
    }
    .auth-actions-foot > a:hover {
      text-decoration: underline;
    }
    .auth-foot-sep {
      margin: 0 var(--space-2);
      user-select: none;
    }

    .otp-prompt {
      color: var(--color-text-muted);
      font-size: 0.9375rem;
      margin-bottom: var(--space-2);
    }
    .otp-recovery-hint {
      color: var(--color-text-muted);
      font-size: 0.8125rem;
      margin-bottom: var(--space-4);
    }
    .btn-back {
      width: 100%;
      margin-top: var(--space-3);
      padding: var(--space-3);
      background: transparent;
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      font-family: inherit;
      font-size: 0.9375rem;
      min-height: 44px;
      cursor: pointer;
    }
    .btn-back:hover {
      background: var(--color-bg);
    }
    .btn-back:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }
    .field-error {
      margin-top: var(--space-2);
      color: var(--color-error);
      font-size: 0.8125rem;
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
