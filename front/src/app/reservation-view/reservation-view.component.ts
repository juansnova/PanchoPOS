import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl, SafeStyle } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService, Reservation, TenantSummary } from '../services/api.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { ConfirmationModalComponent } from '../shared/confirmation-modal.component';
import { reservationDietaryNotesDisplay } from '../shared/reservation-dietary-notes';
import { PublicGuestHeaderComponent } from '../shared/public-guest-header.component';
import { resolvePublicPrimaryColor } from '../shared/public-brand-colors';
import { publicBookRouterLink } from '../shared/public-book-path';

@Component({
  selector: 'app-reservation-view',
  standalone: true,
  imports: [FormsModule, TranslateModule, RouterLink, ConfirmationModalComponent, PublicGuestHeaderComponent],
  templateUrl: './reservation-view.component.html',
  styleUrl: './reservation-view.component.scss',
})
export class ReservationViewComponent implements OnInit {
  readonly resolvePublicPrimaryColor = resolvePublicPrimaryColor;
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private translate = inject(TranslateService);
  private sanitizer = inject(DomSanitizer);

  loading = signal(true);
  error = signal<string | null>(null);
  reservation = signal<Reservation | null>(null);
  tenant = signal<TenantSummary | null>(null);
  logoUrl = signal<string | null>(null);
  showCancelConfirm = signal(false);
  delayNotice = '';
  updatingDelay = signal(false);
  delaySuccess = signal(false);
  delayRateLimited = signal(false);
  delayEmpty = signal(false);
  delayFailed = signal(false);

  googleMapsUrl = computed(() => this.tenant()?.public_google_maps_url?.trim() || null);
  openstreetmapUrl = computed(() => this.tenant()?.public_openstreetmap_url?.trim() || null);

  /** Drives the headline and tone: active (booked/seated), cancelled, or done (finished/no-show). */
  mood = computed<'active' | 'cancelled' | 'done'>(() => {
    const s = this.reservation()?.status;
    if (s === 'cancelled') return 'cancelled';
    if (s === 'finished' || s === 'no_show') return 'done';
    return 'active';
  });

  firstName = computed(() => (this.reservation()?.customer_name ?? '').trim().split(/\s+/)[0] ?? '');

  private dateObj = computed(() => {
    const r = this.reservation();
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(r?.reservation_date ?? '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  });

  dateParts = computed(() => {
    const d = this.dateObj();
    if (!d) return { weekday: '', day: '', month: '', year: '' };
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    return {
      weekday: cap(d.toLocaleDateString(undefined, { weekday: 'long' })),
      day: String(d.getDate()),
      month: cap(d.toLocaleDateString(undefined, { month: 'long' })),
      year: String(d.getFullYear()),
    };
  });

  timeLabel = computed(() => {
    const m = /^(\d{2}):(\d{2})/.exec(this.reservation()?.reservation_time ?? '');
    if (!m) return '';
    const d = new Date(2000, 0, 1, +m[1], +m[2]);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  });

  /** "Hoy" / "Mañana" / "En N días" for upcoming active reservations. */
  whenLabel = computed<{ key: string; params?: { n: number } } | null>(() => {
    const d = this.dateObj();
    if (!d || this.mood() !== 'active') return null;
    const now = new Date();
    const days = Math.round((d.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
    if (days < 0) return null;
    if (days === 0) return { key: 'RES_VIEW.WHEN_TODAY' };
    if (days === 1) return { key: 'RES_VIEW.WHEN_TOMORROW' };
    return { key: 'RES_VIEW.WHEN_IN', params: { n: days } };
  });

  partyDots(): number[] {
    const n = Math.max(0, Math.min(8, this.reservation()?.party_size ?? 0));
    return Array.from({ length: n }, (_, i) => i);
  }

  bookRouterLink(): (string | number)[] {
    const t = this.tenant();
    return t ? publicBookRouterLink(t) : ['/'];
  }

  getStatusKey(): string {
    const s = this.reservation()?.status;
    return s ? 'RESERVATIONS.STATUS_' + s.toUpperCase() : '';
  }

  dietaryNotesDisplay(): string | null {
    const r = this.reservation();
    return r ? reservationDietaryNotesDisplay(r) : null;
  }

  getLogoSafeUrl(url: string | null): SafeResourceUrl | null {
    if (!url) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  headerBackgroundStyle(): SafeStyle | null {
    const t = this.tenant();
    const url = t?.header_background_filename && t?.id
      ? this.api.getTenantHeaderBackgroundUrl(t.header_background_filename, t.id) : null;
    return url ? this.sanitizer.bypassSecurityTrustStyle('url("' + url + '")') : null;
  }

  ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.error.set(this.translate.instant('RESERVATIONS.ERROR_MISSING_TOKEN'));
      this.loading.set(false);
      return;
    }
    this.api.getReservationByToken(token).subscribe({
      next: (r) => {
        this.reservation.set(r);
        this.loadTenant(r.tenant_id);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.translate.instant('RESERVATIONS.ERROR_NOT_FOUND'));
        this.loading.set(false);
      },
    });
  }

  private loadTenant(tenantId: number) {
    this.api.getPublicTenant(tenantId).subscribe({
      next: (t) => {
        this.tenant.set(t);
        const url = this.api.getTenantLogoUrl(t.logo_filename ?? undefined, t.id);
        this.logoUrl.set(url);
      },
      error: () => {},
    });
  }

  doCancel() {
    const r = this.reservation();
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!r || !token) return;
    this.api.cancelReservationPublic(r.id, token).subscribe({
      next: (updated) => {
        this.reservation.set(updated);
        this.showCancelConfirm.set(false);
      },
      error: () => this.showCancelConfirm.set(false),
    });
  }

  submitDelayNotice() {
    const r = this.reservation();
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!r || !token) return;
    if (!this.delayNotice.trim()) {
      this.delayEmpty.set(true);
      return;
    }
    this.updatingDelay.set(true);
    this.delaySuccess.set(false);
    this.delayRateLimited.set(false);
    this.delayEmpty.set(false);
    this.delayFailed.set(false);
    this.api.updateReservationPublic(r.id, token, { delay_notice: this.delayNotice.trim() || null }).subscribe({
      next: (updated) => {
        this.reservation.set(updated);
        this.delayNotice = '';
        this.updatingDelay.set(false);
        this.delaySuccess.set(true);
      },
      error: (e) => {
        this.updatingDelay.set(false);
        if (e?.status === 429) {
          this.delayRateLimited.set(true);
        } else {
          this.delayFailed.set(true);
        }
      },
    });
  }
}
