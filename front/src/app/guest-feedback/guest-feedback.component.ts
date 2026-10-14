import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QRCodeComponent } from 'angularx-qrcode';
import { ApiService, GuestFeedback, GuestFeedbackSummary } from '../services/api.service';
import { SidebarComponent } from '../shared/sidebar.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PermissionService } from '../services/permission.service';

@Component({
  selector: 'app-guest-feedback',
  standalone: true,
  imports: [SidebarComponent, TranslateModule, RouterLink, QRCodeComponent],
  templateUrl: './guest-feedback.component.html',
  styleUrl: './guest-feedback.component.scss',
})
export class GuestFeedbackComponent implements OnInit {
  private api = inject(ApiService);
  private permissions = inject(PermissionService);
  private translate = inject(TranslateService);

  loading = signal(true);
  error = signal<string | null>(null);
  items = signal<GuestFeedback[]>([]);
  summary = signal<GuestFeedbackSummary | null>(null);
  summaryDays = signal(90);
  exporting = signal(false);
  /** Brief “copied” hint after copy URL */
  urlCopied = signal(false);
  private urlCopiedTimer?: ReturnType<typeof setTimeout>;

  readonly starLevels = [5, 4, 3, 2, 1] as const;

  maxRatingCount = computed(() => {
    const s = this.summary();
    if (!s) return 1;
    const vals = this.starLevels.map((n) => s.rating_counts[String(n)] || 0);
    return Math.max(1, ...vals);
  });

  maxDayCount = computed(() => {
    const s = this.summary();
    if (!s?.by_day?.length) return 1;
    return Math.max(1, ...s.by_day.map((d) => d.count));
  });

  /** Last 14 days of the lookback for a compact trend strip. */
  recentDays = computed(() => {
    const s = this.summary();
    if (!s?.by_day?.length) return [];
    return s.by_day.slice(-14);
  });

  ngOnInit() {
    this.load();
  }

  get tenantId(): number | undefined {
    const id = this.permissions.getCurrentUser()?.tenant_id;
    return id == null ? undefined : id;
  }

  /** Absolute URL to the public feedback form (same origin as the staff app). */
  feedbackPublicUrl(): string {
    const id = this.tenantId;
    if (id == null) return '';
    if (typeof window === 'undefined') return `/feedback/${id}`;
    return `${window.location.origin}/feedback/${id}`;
  }

  copyFeedbackUrl() {
    const url = this.feedbackPublicUrl();
    if (!url) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => this.flashUrlCopied()).catch(() => {});
    }
  }

  private flashUrlCopied() {
    if (this.urlCopiedTimer) clearTimeout(this.urlCopiedTimer);
    this.urlCopied.set(true);
    this.urlCopiedTimer = setTimeout(() => this.urlCopied.set(false), 2500);
  }

  printFeedbackQr() {
    document.body.classList.add('print-feedback-qr-only');
    const remove = () => document.body.classList.remove('print-feedback-qr-only');
    window.addEventListener('afterprint', remove, { once: true });
    setTimeout(remove, 120_000);
    window.print();
  }

  setSummaryDays(days: number) {
    if (days === this.summaryDays()) return;
    this.summaryDays.set(days);
    this.loadSummary();
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.loadSummary();
    this.api.listGuestFeedback(200).subscribe({
      next: (rows) => {
        this.items.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.translate.instant('FEEDBACK.LOAD_FAILED'));
        this.loading.set(false);
      },
    });
  }

  private loadSummary() {
    this.api.getGuestFeedbackSummary(this.summaryDays()).subscribe({
      next: (s) => this.summary.set(s),
      error: () => this.summary.set(null),
    });
  }

  ratingCount(stars: number): number {
    return this.summary()?.rating_counts[String(stars)] || 0;
  }

  exportCsv() {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.api.exportGuestFeedbackCsv(this.summaryDays()).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `guest-feedback-${this.tenantId ?? 'export'}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        this.exporting.set(false);
      },
      error: () => this.exporting.set(false),
    });
  }
}
