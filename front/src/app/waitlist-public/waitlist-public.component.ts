import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, TenantSummary } from '../services/api.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PublicGuestHeaderComponent } from '../shared/public-guest-header.component';
import { resolvePublicPrimaryColor } from '../shared/public-brand-colors';
import { publicBookRouterLink } from '../shared/public-book-path';
import { LegalLinksComponent } from '../shared/legal-links.component';
import { contactPhoneValid } from '../shared/contact-validators';
import { ApiErrorMessageService } from '../services/api-error-message.service';

@Component({
  selector: 'app-waitlist-public',
  standalone: true,
  imports: [FormsModule, TranslateModule, PublicGuestHeaderComponent, LegalLinksComponent, RouterLink],
  templateUrl: './waitlist-public.component.html',
  styleUrl: './waitlist-public.component.scss',
})
export class WaitlistPublicComponent implements OnInit, OnDestroy {
  readonly resolvePublicPrimaryColor = resolvePublicPrimaryColor;
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private translate = inject(TranslateService);
  private sanitizer = inject(DomSanitizer);
  private apiErr = inject(ApiErrorMessageService);

  tenantId = signal(0);
  tenant = signal<TenantSummary | null>(null);
  logoUrl = signal<string | null>(null);
  loading = signal(true);
  submitting = signal(false);
  success = signal(false);
  error = signal<string | null>(null);

  formName = '';
  formPartySize = 2;
  formPhone = '';

  /** Live "ticket" stamp: today's date and time, refreshed every 30 s. */
  private now = signal(new Date());
  private clock: ReturnType<typeof setInterval> | null = null;

  stamp(): string {
    const d = this.now();
    const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
    return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }

  /** One dot per guest on the ticket (up to 8; the rest shown as +N). */
  partyDots(): number[] {
    const n = Math.max(0, Math.min(8, Math.floor(Number(this.formPartySize) || 0)));
    return Array.from({ length: n }, (_, i) => i);
  }

  changeParty(delta: number): void {
    const cur = Math.floor(Number(this.formPartySize) || 1);
    this.formPartySize = Math.min(20, Math.max(1, cur + delta));
  }

  termsOfServiceUrl = signal<string | null>(null);
  privacyPolicyUrl = signal<string | null>(null);

  ngOnInit(): void {
    this.clock = setInterval(() => this.now.set(new Date()), 30000);
    const idParam = this.route.snapshot.paramMap.get('tenantId');
    const n = idParam ? parseInt(idParam, 10) : 0;
    if (!n || Number.isNaN(n)) {
      this.loading.set(false);
      this.error.set(this.translate.instant('WAITLIST.ERROR_INVALID_LINK'));
      return;
    }
    this.tenantId.set(n);
    this.api.getPublicTenant(n).subscribe({
      next: (t) => {
        this.tenant.set(t);
        this.logoUrl.set(this.api.getTenantLogoUrl(t.logo_filename ?? undefined, t.id));
        this.termsOfServiceUrl.set(t.terms_of_service_url?.trim() || null);
        this.privacyPolicyUrl.set(t.privacy_policy_url?.trim() || null);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set(this.translate.instant('WAITLIST.ERROR_INVALID_LINK'));
      },
    });
  }

  ngOnDestroy(): void {
    if (this.clock != null) clearInterval(this.clock);
  }

  getLogoSafeUrl(url: string | null): SafeResourceUrl | null {
    if (!url) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  /** Plain URL (not CSS) for rendering the custom banner as an <img>, so it keeps its own aspect ratio (matches /public-menu). */
  headerBackgroundImgUrl(): string | null {
    const t = this.tenant();
    if (!t?.header_background_filename || t?.id == null) return null;
    return this.api.getTenantHeaderBackgroundUrl(t.header_background_filename, t.id) || null;
  }

  /** Canonical guest booking link (#415). */
  bookRouterLink(): (string | number)[] {
    const t = this.tenant();
    if (t) return publicBookRouterLink(t);
    return ['/book', this.tenantId()];
  }

  submit(): void {
    this.error.set(null);
    const tid = this.tenantId();
    if (!tid) {
      this.error.set(this.translate.instant('WAITLIST.ERROR_INVALID_LINK'));
      return;
    }
    const name = this.formName.trim();
    if (!name) {
      this.error.set(this.translate.instant('RESERVATIONS.CUSTOMER_NAME'));
      return;
    }
    if (!contactPhoneValid(this.formPhone)) {
      this.error.set(this.translate.instant('WAITLIST.INVALID_PHONE'));
      return;
    }
    if (this.formPartySize < 1 || this.formPartySize > 99) {
      this.error.set(this.translate.instant('RESERVATIONS.ERROR_PARTY_SIZE_RANGE'));
      return;
    }
    this.submitting.set(true);
    this.api.submitPublicWaitingList(tid, {
      customer_name: name,
      customer_phone: this.formPhone.trim(),
      party_size: this.formPartySize,
    }).subscribe({
      next: () => {
        this.success.set(true);
        this.submitting.set(false);
      },
      error: (e) => {
        this.error.set(this.apiErr.fromHttpError(e, 'WAITLIST.ERROR_FAILED'));
        this.submitting.set(false);
      },
    });
  }
}
