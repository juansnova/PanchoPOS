import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ApiService } from '../services/api.service';
import { ApiErrorMessageService } from '../services/api-error-message.service';
import { LegalLinksComponent } from '../shared/legal-links.component';

@Component({
  selector: 'app-courier-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TranslateModule, LegalLinksComponent],
  template: `
    <div class="cl">
      <header class="cl-hero">
        <span class="cl-seal" aria-hidden="true">
          <span class="cl-ring"></span>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l4-8h5l3 8M9 9H7M14 9l-2 8"/></svg>
        </span>
        <p class="cl-eyebrow"><i></i>{{ 'COURIER_HOME.EYEBROW' | translate }}<i></i></p>
        <h1>{{ 'COURIER_AUTH.TITLE' | translate }}</h1>
        <p class="cl-sub">{{ 'COURIER_AUTH.SUBTITLE' | translate }}</p>
      </header>

      <main class="cl-card">
        <form [formGroup]="form" (ngSubmit)="onSubmit()">
          <label class="cl-field" for="username">
            <span class="cl-label">{{ 'AUTH.USERNAME' | translate }}</span>
            <span class="cl-input">
              <span class="cl-ico" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              </span>
              <input
                id="username"
                type="text"
                name="username"
                formControlName="username"
                [placeholder]="'AUTH.USERNAME_PLACEHOLDER' | translate"
                autocomplete="username"
              >
            </span>
          </label>

          <label class="cl-field" for="password">
            <span class="cl-label">{{ 'AUTH.PASSWORD' | translate }}</span>
            <span class="cl-input">
              <span class="cl-ico" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="3"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
              </span>
              <input
                id="password"
                [type]="showPassword() ? 'text' : 'password'"
                name="password"
                formControlName="password"
                [placeholder]="'AUTH.PASSWORD_PLACEHOLDER' | translate"
                autocomplete="current-password"
              >
              <button type="button" class="cl-eye" (click)="showPassword.set(!showPassword())" [attr.aria-label]="showPassword() ? ('AUTH.HIDE_PASSWORD' | translate) : ('AUTH.SHOW_PASSWORD' | translate)" tabindex="-1">
                @if (showPassword()) {
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                } @else {
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </span>
          </label>

          @if (error()) {
            <div class="cl-error" role="alert">{{ error() }}</div>
          }
          <button type="submit" class="cl-btn" [disabled]="form.invalid || loading()">
            {{ loading() ? ('AUTH.SIGNING_IN' | translate) : ('AUTH.SIGN_IN' | translate) }}<i aria-hidden="true">→</i>
          </button>
        </form>

        <div class="cl-foot">
          <a routerLink="/login">{{ 'COURIER_AUTH.BACK_STAFF_LOGIN' | translate }}</a>
          @if (legalTermsUrl() || legalPrivacyUrl()) {
            <span class="cl-sep" aria-hidden="true">·</span>
            <app-legal-links [inline]="true" [termsUrl]="legalTermsUrl()" [privacyUrl]="legalPrivacyUrl()" />
          }
        </div>
      </main>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #faf6f1; }
    .cl { max-width: 460px; margin: 0 auto; min-height: 100vh; }
    .cl-hero {
      position: relative;
      padding: 56px 24px 84px;
      text-align: center;
      color: #fff;
      border-radius: 0 0 40px 40px;
      background:
        radial-gradient(120% 90% at 100% 0, rgba(232, 154, 82, 0.38), transparent 60%),
        linear-gradient(160deg, #2a1d17, #160e0b);
      overflow: hidden;
    }
    .cl-hero::after { content: ''; position: absolute; left: -50px; bottom: -70px; width: 220px; height: 220px; border-radius: 50%; border: 1.5px dashed rgba(232, 154, 82, 0.35); }
    .cl-seal { position: relative; display: inline-grid; place-items: center; width: 76px; height: 76px; margin-bottom: 22px; border-radius: 26px; color: #fff; background: linear-gradient(145deg, #e89a52, #b4551f); box-shadow: 0 22px 32px -16px #e07b2b, inset 0 1px 0 rgba(255, 255, 255, 0.35); transform: rotate(-4deg); }
    .cl-ring { position: absolute; inset: -9px; border-radius: 32px; border: 1.5px dashed rgba(240, 163, 94, 0.5); }
    .cl-seal svg { position: relative; }
    .cl-eyebrow { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 0; font-size: 0.64rem; font-weight: 800; letter-spacing: 0.22em; text-transform: uppercase; color: #f0a35e; i { width: 18px; height: 1.5px; background: currentColor; } }
    .cl-hero h1 { margin: 10px 0 0; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 500; font-size: clamp(2rem, 9vw, 2.6rem); line-height: 1.05; letter-spacing: -0.025em; }
    .cl-sub { margin: 10px auto 0; max-width: 28ch; font-size: 0.95rem; color: rgba(255, 255, 255, 0.7); }

    .cl-card { position: relative; z-index: 1; margin: -48px 16px 0; padding: 26px 22px 22px; border-radius: 30px; background: #fff; box-shadow: 0 30px 50px -28px rgba(23, 18, 16, 0.55), 0 0 0 1px rgba(193, 90, 30, 0.14); }
    .cl-field { display: flex; flex-direction: column; gap: 7px; margin-bottom: 16px; }
    .cl-label { font-size: 0.64rem; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-text-muted); }
    .cl-input { display: flex; align-items: center; gap: 10px; padding: 0 12px 0 8px; border-radius: 18px; background: color-mix(in srgb, var(--color-primary) 3%, #fff); box-shadow: inset 0 0 0 1.5px var(--color-border); transition: box-shadow 0.2s, background 0.2s; }
    .cl-input:focus-within { background: #fff; box-shadow: inset 0 0 0 2px var(--color-primary), 0 0 0 5px color-mix(in srgb, var(--color-primary) 14%, transparent); }
    .cl-ico { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 11%, #fff); }
    .cl-input input { flex: 1; min-width: 0; min-height: 52px; padding: 0; border: 0; background: transparent; font: inherit; font-size: 1rem; outline: none; }
    .cl-eye { display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; color: var(--color-text-muted); cursor: pointer; &:hover { color: var(--color-text); } }
    .cl-error { margin-bottom: 16px; padding: 12px 16px; border-radius: 16px; font-size: 0.9rem; font-weight: 600; color: #b91c1c; background: #fef2f2; }
    .cl-btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 56px; margin-top: 6px; border: 0; border-radius: 999px; font: inherit; font-size: 1rem; font-weight: 800; color: #fff; cursor: pointer; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #000)); box-shadow: 0 18px 28px -14px var(--color-primary); transition: transform 0.15s; &:active { transform: scale(0.98); } &:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; } i { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; font-style: normal; background: rgba(255, 255, 255, 0.22); } }
    .cl-foot { display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline; row-gap: 8px; margin-top: 22px; padding-top: 16px; border-top: 1.5px dashed var(--color-border); font-size: 0.88rem; color: var(--color-text-muted); }
    .cl-foot > a { color: var(--color-primary); font-weight: 700; text-decoration: none; &:hover { text-decoration: underline; } }
    .cl-sep { margin: 0 8px; user-select: none; }
  `]
})
export class CourierLoginComponent implements OnInit {
  private fb = inject(FormBuilder);
  private api = inject(ApiService);
  private router = inject(Router);
  private apiErr = inject(ApiErrorMessageService);

  legalTermsUrl = signal<string | null>(null);
  legalPrivacyUrl = signal<string | null>(null);

  ngOnInit(): void {
    this.api.getPublicLegalUrls().subscribe({
      next: (u) => {
        this.legalTermsUrl.set(u.terms_of_service_url ?? null);
        this.legalPrivacyUrl.set(u.privacy_policy_url ?? null);
      },
      error: () => {},
    });
  }

  error = signal<string>('');
  loading = signal(false);

  form = this.fb.group({
    username: ['', [Validators.required]],
    password: ['', Validators.required]
  });
  showPassword = signal(false);

  onSubmit() {
    if (!this.form.valid) return;
    this.error.set('');
    this.loading.set(true);
    const username = this.form.get('username')?.value ?? '';
    const password = this.form.get('password')?.value ?? '';
    this.api.login(username, password, undefined, 'courier').subscribe({
      next: () => this.router.navigate(['/courier']),
      error: (err) => {
        this.loading.set(false);
        this.error.set(this.apiErr.fromHttpError(err, 'AUTH.LOGIN_FAILED'));
      }
    });
  }
}
