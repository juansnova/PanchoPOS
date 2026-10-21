/**
 * Sales & Revenue Reports
 *
 * Date range, summary, by product/category/table/waiter.
 * Simple catchy CSS charts; export CSV/Excel.
 */
import {
  Component,
  inject,
  signal,
  computed,
  DestroyRef,
  OnInit,
  HostListener,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { SidebarComponent } from '../shared/sidebar.component';
import { WorkSessionAdjustment,
  ApiService,
  SalesReport,
  User,
  WorkSession,
  workSessionNetWorkSeconds,
} from '../services/api.service';
import { ApiErrorMessageService } from '../services/api-error-message.service';
import { PermissionService } from '../services/permission.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../services/language.service';
import { intlLocaleFromTranslate } from '../shared/intl-locale';
import { formatMoneyCents } from '../shared/currency-symbol';
import { AppDatePickerComponent } from '../shared/app-date-picker.component';
import { AppSelectComponent, AppSelectOption } from '../shared/app-select.component';
import { ConfirmationModalComponent } from '../shared/confirmation-modal.component';
import { getCategoryLabel } from '../shared/product-category-label.util';

export type ReportsDatePreset =
  | 'today'
  | 'last7'
  | 'thisWeek'
  | 'thisMonth'
  | 'previousMonth';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, SidebarComponent, TranslateModule, AppDatePickerComponent, AppSelectComponent, ConfirmationModalComponent],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
})
export class ReportsComponent implements OnInit {
  private api = inject(ApiService);
  private translate = inject(TranslateService);
  private languageService = inject(LanguageService);
  private permissions = inject(PermissionService);
  private apiErr = inject(ApiErrorMessageService);
  private destroyRef = inject(DestroyRef);

  report = signal<SalesReport | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  exporting = signal(false);
  exportingDetailed = signal(false);
  workSessions = signal<WorkSession[]>([]);
  workSessionsLoading = signal(false);
  workSessionsError = signal<string | null>(null);
  workSessionsLive = signal<WorkSession[]>([]);
  workSessionsLiveLoading = signal(false);
  workSessionsLiveError = signal<string | null>(null);
  /** Modal: correct clock-in/out (report:read). */
  workSessionAdjustOpen = signal(false);
  workSessionAdjustTarget = signal<WorkSession | null>(null);
  workSessionAdjustStartedLocal = signal('');
  workSessionAdjustEndedLocal = signal('');
  workSessionAdjustNote = signal('');
  workSessionAdjustSaving = signal(false);
  workSessionAdjustError = signal<string | null>(null);
  /** `YYYY-MM` for monthly attendance Excel (calendar month, local). */
  attendanceExcelMonth = signal('');
  attendanceExcelExporting = signal(false);
  attendanceExcelError = signal<string | null>(null);
  attendanceExcelStaffUsers = signal<User[]>([]);
  /** Empty = all tenant staff with data; non-empty = filter export to these user IDs. */
  attendanceExcelStaffFilterIds: number[] = [];
  /** Collapsible staff filter panel (replaces native multi-select). */
  attendanceExcelStaffPanelOpen = signal(false);
  attendanceExcelStaffSearch = signal('');
  filteredAttendanceExcelStaffUsers = computed(() => {
    const q = this.attendanceExcelStaffSearch().trim().toLowerCase();
    const users = this.attendanceExcelStaffUsers();
    if (!q) return users;
    return users.filter((u) => {
      const n = (u.full_name || '').toLowerCase();
      const e = (u.username || '').toLowerCase();
      return n.includes(q) || e.includes(q);
    });
  });

  @ViewChild('attendanceStaffDropdownRoot') attendanceStaffDropdownRoot?: ElementRef<HTMLElement>;
  fromDate = signal('');
  toDate = signal('');

  maxBarValue = computed(() => {
    const r = this.report();
    if (!r) return 1;
    const dailyMax = r.summary.daily.length
      ? Math.max(...r.summary.daily.map((d) => d.revenue_cents))
      : 0;
    const productMax = r.by_product.length
      ? Math.max(...r.by_product.map((p) => p.revenue_cents))
      : 0;
    return Math.max(1, dailyMax, productMax);
  });

  /** Best sellers (by units) and the slowest movers, shown above the product table. */
  rankedProducts = computed(() => {
    const r = this.report();
    const list = [...(r?.by_product ?? [])].sort((a, b) => b.quantity - a.quantity);
    const top = list.slice(0, 5);
    const rest = list.slice(5);
    const bottom = rest.length ? [...rest].sort((a, b) => a.quantity - b.quantity).slice(0, 5) : [];
    const topMax = Math.max(1, ...top.map((p) => p.quantity));
    return { top, bottom, topMax };
  });

  totalProductQuantity = computed(() => {
    const r = this.report();
    if (!r?.by_product?.length) return 0;
    return r.by_product.reduce((sum, p) => sum + p.quantity, 0);
  });

  totalCategoryQuantity = computed(() => {
    const r = this.report();
    if (!r?.by_category?.length) return 0;
    return r.by_category.reduce((sum, c) => sum + c.quantity, 0);
  });

  /** Bumps when UI language changes so currency/date formatting refreshes. */
  private reportIntlRevision = signal(0);

  /** Owner's category renames (e.g. "Main Course" shown as "Platos Fuertes"); empty if not allowed. */
  private categoryOverrides = signal<Record<string, string>>({});

  categoryLabel(category: string): string {
    if (category === 'Uncategorized') return this.translate.instant('REPORTS.UNCATEGORIZED');
    return getCategoryLabel(category, this.translate, this.categoryOverrides());
  }

  ngOnInit() {
    const clock = setInterval(() => this.nowMs.set(Date.now()), 30000);
    this.destroyRef.onDestroy(() => clearInterval(clock));
    this.api.getTenantCategoryLabels().subscribe({
      next: (labels) => this.categoryOverrides.set(labels),
      error: () => undefined,
    });
    const today = this.startOfLocalDay(new Date());
    const from = this.addLocalDays(today, -30);
    this.fromDate.set(this.fmtDate(from));
    this.toDate.set(this.fmtDate(today));
    this.loadReport();
    const now = new Date();
    this.attendanceExcelMonth.set(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    );
    this.translate.onLangChange.subscribe(() => this.reportIntlRevision.update((n) => n + 1));
    if (this.canViewAttendance()) {
      this.api.getUsers().subscribe({
        next: (users) => {
          const list = users
            .filter((u): u is User & { id: number } => u.id != null && Number.isFinite(u.id))
            .sort((a, b) =>
              (a.full_name || a.username || '').localeCompare(b.full_name || b.username || '', undefined, {
                sensitivity: 'base',
              }),
            );
          this.attendanceExcelStaffUsers.set(list);
        },
        error: () => {},
      });
    }
  }

  /** Local calendar date as `YYYY-MM-DD` (not UTC midnight from `toISOString`). */
  private fmtDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private startOfLocalDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  private addLocalDays(d: Date, delta: number): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
  }

  /** Monday (local) as first day of the ISO-style week containing `ref`. */
  private mondayOfWeekContaining(ref: Date): Date {
    const s = this.startOfLocalDay(ref);
    const dow = s.getDay();
    const delta = dow === 0 ? -6 : 1 - dow;
    return this.addLocalDays(s, delta);
  }

  applyDatePreset(preset: ReportsDatePreset): void {
    const today = this.startOfLocalDay(new Date());
    let from: Date;
    let to: Date;
    switch (preset) {
      case 'today':
        from = today;
        to = today;
        break;
      case 'last7':
        from = this.addLocalDays(today, -6);
        to = today;
        break;
      case 'thisWeek': {
        const mon = this.mondayOfWeekContaining(today);
        from = mon;
        to = this.addLocalDays(mon, 6);
        break;
      }
      case 'thisMonth':
        from = new Date(today.getFullYear(), today.getMonth(), 1);
        to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        break;
      case 'previousMonth': {
        const firstThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastPrev = this.addLocalDays(firstThisMonth, -1);
        from = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
        to = lastPrev;
        break;
      }
      default:
        return;
    }
    this.fromDate.set(this.fmtDate(from));
    this.toDate.set(this.fmtDate(to));
    this.loadReport();
  }

  loadReport() {
    const from = this.fromDate();
    const to = this.toDate();
    if (!from || !to) return;
    this.loading.set(true);
    this.error.set(null);
    this.api.getSalesReports(from, to).subscribe({
      next: (data) => {
        this.report.set(data);
        this.loading.set(false);
        this.loadWorkSessions();
      },
      error: (err) => {
        this.error.set(err?.message || 'Failed to load report');
        this.loading.set(false);
        this.loadWorkSessions();
      },
    });
  }

  canViewAttendance(): boolean {
    return this.permissions.hasPermission(this.api.getCurrentUser(), 'report:read');
  }

  @HostListener('document:click', ['$event'])
  onAttendanceStaffDocumentClick(ev: MouseEvent): void {
    if (!this.attendanceExcelStaffPanelOpen()) return;
    const root = this.attendanceStaffDropdownRoot?.nativeElement;
    if (root && !root.contains(ev.target as Node)) {
      this.attendanceExcelStaffPanelOpen.set(false);
      this.attendanceExcelStaffSearch.set('');
    }
  }

  @HostListener('document:keydown', ['$event'])
  onAttendanceStaffDocumentKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && this.attendanceExcelStaffPanelOpen()) {
      this.attendanceExcelStaffPanelOpen.set(false);
      this.attendanceExcelStaffSearch.set('');
    }
  }

  toggleAttendanceStaffPanel(): void {
    const next = !this.attendanceExcelStaffPanelOpen();
    this.attendanceExcelStaffPanelOpen.set(next);
    if (!next) {
      this.attendanceExcelStaffSearch.set('');
    }
  }

  onAttendanceStaffTriggerKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      this.toggleAttendanceStaffPanel();
    }
  }

  toggleAttendanceStaffFilter(id: number | undefined, ev?: Event): void {
    ev?.stopPropagation();
    if (id == null || !Number.isFinite(id)) return;
    const cur = [...this.attendanceExcelStaffFilterIds];
    const i = cur.indexOf(id);
    if (i >= 0) {
      cur.splice(i, 1);
    } else {
      cur.push(id);
    }
    cur.sort((a, b) => a - b);
    this.attendanceExcelStaffFilterIds = cur;
    this.attendanceExcelError.set(null);
  }

  isAttendanceStaffFilterSelected(id: number | undefined): boolean {
    if (id == null || !Number.isFinite(id)) return false;
    return this.attendanceExcelStaffFilterIds.includes(id);
  }

  attendanceExcelSingleStaffLabel(): string {
    const ids = this.attendanceExcelStaffFilterIds;
    if (ids.length !== 1) return '';
    const u = this.attendanceExcelStaffUsers().find((x) => x.id === ids[0]);
    return (u?.full_name || u?.username || String(ids[0])).trim();
  }

  downloadAttendanceExcel(): void {
    if (!this.canViewAttendance()) return;
    const ym = (this.attendanceExcelMonth() || '').trim();
    const m = /^(\d{4})-(\d{2})$/.exec(ym);
    if (!m) {
      this.attendanceExcelError.set(this.translate.instant('REPORTS.ATTENDANCE_EXCEL_INVALID_MONTH'));
      return;
    }
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    this.attendanceExcelExporting.set(true);
    this.attendanceExcelError.set(null);
    const staffIds =
      this.attendanceExcelStaffFilterIds.length > 0 ? this.attendanceExcelStaffFilterIds : undefined;
    this.api.getReportsAttendanceExcel(year, month, staffIds).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `asistencia_${year}_${String(month).padStart(2, '0')}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.attendanceExcelExporting.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.attendanceExcelExporting.set(false);
        if (err.status === 404) {
          this.attendanceExcelError.set(this.translate.instant('REPORTS.ATTENDANCE_EXCEL_NO_DATA'));
          return;
        }
        const body = err.error;
        if (body instanceof Blob) {
          body
            .text()
            .then((text) => {
              try {
                const parsed = JSON.parse(text) as { detail?: unknown };
                const d = parsed?.detail;
                this.attendanceExcelError.set(
                  typeof d === 'string' && d.trim()
                    ? d
                    : this.translate.instant('REPORTS.ATTENDANCE_EXCEL_ERROR'),
                );
              } catch {
                this.attendanceExcelError.set(this.translate.instant('REPORTS.ATTENDANCE_EXCEL_ERROR'));
              }
            })
            .catch(() =>
              this.attendanceExcelError.set(this.translate.instant('REPORTS.ATTENDANCE_EXCEL_ERROR')),
            );
          return;
        }
        this.attendanceExcelError.set(
          this.apiErr.fromHttpError(err, 'REPORTS.ATTENDANCE_EXCEL_ERROR'),
        );
      },
    });
  }

  loadWorkSessions(): void {
    if (!this.canViewAttendance()) {
      this.workSessions.set([]);
      this.workSessionsLive.set([]);
      return;
    }
    const from = this.fromDate();
    const to = this.toDate();
    if (!from || !to) return;
    this.workSessionsLoading.set(true);
    this.workSessionsError.set(null);
    this.api.getReportWorkSessions(from, to).subscribe({
      next: (rows) => {
        this.workSessions.set(rows);
        this.workSessionsLoading.set(false);
      },
      error: () => {
        this.workSessions.set([]);
        this.workSessionsLoading.set(false);
        this.workSessionsError.set('Failed to load attendance');
      },
    });
    this.loadWorkSessionsLive();
  }

  loadWorkSessionsLive(): void {
    if (!this.canViewAttendance()) {
      this.workSessionsLive.set([]);
      return;
    }
    this.workSessionsLiveLoading.set(true);
    this.workSessionsLiveError.set(null);
    this.api.getReportWorkSessionsLive().subscribe({
      next: (rows) => {
        this.workSessionsLive.set(rows);
        this.workSessionsLiveLoading.set(false);
      },
      error: () => {
        this.workSessionsLive.set([]);
        this.workSessionsLiveLoading.set(false);
        this.workSessionsLiveError.set('Failed to load live attendance');
      },
    });
  }

  formatWorkSessionDt(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  formatWorkSessionDuration(row: WorkSession): string {
    if (!row.ended_at) {
      const om = row.open_duration_minutes;
      if (om != null && om >= 0) {
        const h = Math.floor(om / 60);
        const m = om % 60;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
      }
      const sec = workSessionNetWorkSeconds(row);
      const mins = Math.max(0, Math.floor(sec / 60));
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    }
    if (row.duration_minutes === 0) return '<1 min';
    if (row.duration_minutes != null && row.duration_minutes >= 0) {
      const h = Math.floor(row.duration_minutes / 60);
      const m = row.duration_minutes % 60;
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    }
    return '—';
  }

  liveAttendanceStatus(row: WorkSession): string {
    if (row.on_break) {
      return this.translate.instant('REPORTS.WORK_SESSIONS_STATUS_BREAK');
    }
    return this.translate.instant('REPORTS.WORK_SESSIONS_STATUS_WORKING');
  }

  openWorkSessionAdjust(row: WorkSession): void {
    if (!this.canViewAttendance()) return;
    this.workSessionAdjustTarget.set(row);
    this.workSessionAdjustStartedLocal.set(this.isoToDatetimeLocalValue(row.started_at));
    this.workSessionAdjustEndedLocal.set(row.ended_at ? this.isoToDatetimeLocalValue(row.ended_at) : '');
    this.workSessionAdjustNote.set('');
    this.workSessionAdjustError.set(null);
    this.workSessionAdjustOpen.set(true);
  }

  closeWorkSessionAdjust(): void {
    if (this.workSessionAdjustSaving()) return;
    this.workSessionAdjustOpen.set(false);
    this.workSessionAdjustTarget.set(null);
    this.workSessionAdjustError.set(null);
  }

  workSessionDeleteConfirm = signal(false);

  confirmDeleteWorkSession(): void {
    const row = this.workSessionAdjustTarget();
    if (!row) return;
    this.workSessionDeleteConfirm.set(false);
    this.workSessionAdjustSaving.set(true);
    this.workSessionAdjustError.set(null);
    this.api.deleteReportWorkSession(row.id, (this.workSessionAdjustNote() || '').trim() || undefined).subscribe({
      next: () => {
        this.workSessionAdjustSaving.set(false);
        this.closeWorkSessionAdjust();
        this.flash(this.translate.instant('REPORTS.WORK_SESSION_DELETE_OK'));
        this.loadWorkSessions();
      },
      error: (err: HttpErrorResponse) => {
        this.workSessionAdjustSaving.set(false);
        this.workSessionAdjustError.set(this.apiErr.fromHttpError(err, 'REPORTS.WORK_SESSION_DELETE_ERROR'));
      },
    });
  }

  submitWorkSessionAdjust(): void {
    const row = this.workSessionAdjustTarget();
    if (!row) return;
    const startLocal = (this.workSessionAdjustStartedLocal() || '').trim();
    const endLocal = (this.workSessionAdjustEndedLocal() || '').trim();
    const startIso = this.datetimeLocalToUtcIso(startLocal);
    if (!startIso) {
      this.workSessionAdjustError.set(this.translate.instant('REPORTS.WORK_SESSION_ADJUST_INVALID_START'));
      return;
    }
    let endIso: string | null = null;
    if (endLocal) {
      endIso = this.datetimeLocalToUtcIso(endLocal);
      if (!endIso) {
        this.workSessionAdjustError.set(this.translate.instant('REPORTS.WORK_SESSION_ADJUST_INVALID_END'));
        return;
      }
      if (new Date(endIso).getTime() < new Date(startIso).getTime()) {
        this.workSessionAdjustError.set(this.translate.instant('REPORTS.WORK_SESSION_ADJUST_INVALID_RANGE'));
        return;
      }
    }
    const body: { note: string; started_at: string; ended_at?: string | null } = {
      note: (this.workSessionAdjustNote() || '').trim(),
      started_at: startIso,
    };
    if (endIso) {
      body.ended_at = endIso;
    }
    this.workSessionAdjustSaving.set(true);
    this.workSessionAdjustError.set(null);
    this.api.postReportWorkSessionAdjust(row.id, body).subscribe({
      next: () => {
        this.workSessionAdjustSaving.set(false);
        this.closeWorkSessionAdjust();
        this.loadWorkSessions();
      },
      error: (err: HttpErrorResponse) => {
        this.workSessionAdjustSaving.set(false);
        this.workSessionAdjustError.set(
          this.apiErr.fromHttpError(err, 'REPORTS.WORK_SESSION_ADJUST_ERROR'),
        );
      },
    });
  }

  /** `datetime-local` value in the user’s local timezone from an API ISO timestamp. */
  // ------------------------------------------------------------ clock-in history (pro table)
  wsPerson = signal<number | null>(null);
  wsStatus = signal<'all' | 'open' | 'alerts' | 'edited'>('all');
  wsLimit = signal(40);
  wsFlash = signal<string | null>(null);

  historyTarget = signal<WorkSession | null>(null);
  historyItems = signal<WorkSessionAdjustment[]>([]);
  historyLoading = signal(false);

  manualOpen = signal(false);
  manualUser = signal<number | null>(null);
  manualStart = signal('');
  manualEnd = signal('');
  manualNote = signal('');
  manualSaving = signal(false);
  manualError = signal<string | null>(null);

  wsPersonOptions = computed<AppSelectOption[]>(() => {
    const seen = new Map<number, string>();
    for (const r of this.workSessions()) seen.set(r.user_id, r.user_name);
    return [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
      .map(([value, label]) => ({ value, label }));
  });

  staffOptions = computed<AppSelectOption[]>(() =>
    this.attendanceExcelStaffUsers().map((u) => ({ value: u.id as number, label: u.full_name || u.username })),
  );

  private netMinutes(row: WorkSession): number {
    if (row.ended_at) return row.duration_minutes ?? 0;
    return row.open_duration_minutes ?? Math.floor(workSessionNetWorkSeconds(row) / 60);
  }

  sessionFlags(row: WorkSession) {
    const open = !row.ended_at;
    const net = this.netMinutes(row);
    const stale = open && net > 12 * 60;
    const long = !open && net > 12 * 60;
    const short = !open && net < 2;
    return { open, stale, long, short, edited: (row.adjusted_count ?? 0) > 0, alert: stale || long || short };
  }

  private wsByPerson = computed(() => {
    const person = this.wsPerson();
    const rows = this.workSessions();
    return person == null ? rows : rows.filter((r) => r.user_id === person);
  });

  wsCounts = computed(() => {
    const rows = this.wsByPerson();
    let open = 0;
    let alerts = 0;
    let edited = 0;
    for (const r of rows) {
      const f = this.sessionFlags(r);
      if (f.open) open++;
      if (f.alert) alerts++;
      if (f.edited) edited++;
    }
    return { all: rows.length, open, alerts, edited };
  });

  wsFiltered = computed(() => {
    const status = this.wsStatus();
    const rows = this.wsByPerson();
    if (status === 'all') return rows;
    return rows.filter((r) => {
      const f = this.sessionFlags(r);
      return status === 'open' ? f.open : status === 'alerts' ? f.alert : f.edited;
    });
  });

  wsStats = computed(() => {
    const rows = this.wsFiltered();
    const mins = rows.reduce((sum, r) => sum + (r.ended_at ? (r.duration_minutes ?? 0) : 0), 0);
    return {
      count: rows.length,
      people: new Set(rows.map((r) => r.user_id)).size,
      time: this.fmtMinutes(mins),
      alerts: rows.filter((r) => this.sessionFlags(r).alert).length,
    };
  });

  /** Visible rows grouped by (browser-local) day with per-day totals. */
  wsGroups = computed(() => {
    const rows = this.wsFiltered().slice(0, this.wsLimit());
    const todayKey = new Date().toDateString();
    const groups: { key: string; label: string; today: boolean; items: WorkSession[]; people: number; time: string }[] = [];
    for (const r of rows) {
      const key = new Date(r.started_at).toDateString();
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) {
        g = { key, label: this.dayOnly(r.started_at), today: key === todayKey, items: [], people: 0, time: '' };
        groups.push(g);
      }
      g.items.push(r);
    }
    for (const g of groups) {
      g.people = new Set(g.items.map((r) => r.user_id)).size;
      g.time = this.fmtMinutes(g.items.reduce((s, r) => s + (r.ended_at ? (r.duration_minutes ?? 0) : 0), 0));
    }
    return groups;
  });

  wsRemaining = computed(() => Math.max(0, this.wsFiltered().length - this.wsLimit()));

  fmtMinutes(m: number): string {
    if (m < 1) return '0 min';
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h > 0 ? `${h} h ${String(r).padStart(2, '0')} min` : `${r} min`;
  }

  breaksLabel(row: WorkSession): string {
    const n = row.break_count ?? 0;
    const sec = row.break_seconds_total ?? 0;
    if (!n && !sec) return '—';
    return `${n} · ${Math.round(sec / 60)} min`;
  }

  setWsStatus(s: 'all' | 'open' | 'alerts' | 'edited'): void {
    this.wsStatus.set(s);
    this.wsLimit.set(40);
  }

  setWsPerson(v: unknown): void {
    this.wsPerson.set(v === '' || v == null ? null : Number(v));
    this.wsLimit.set(40);
  }

  clearWsFilters(): void {
    this.wsPerson.set(null);
    this.wsStatus.set('all');
    this.wsLimit.set(40);
  }

  showMoreSessions(): void {
    this.wsLimit.update((n) => n + 40);
  }

  private flash(msg: string): void {
    this.wsFlash.set(msg);
    setTimeout(() => this.wsFlash.set(null), 3500);
  }

  exportSessionsCsv(): void {
    const rows = this.wsFiltered();
    if (!rows.length) return;
    const cell = (v: string | number): string => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const head = ['Empleado', 'Fecha', 'Entrada', 'Salida', 'Descansos (min)', 'Horas netas', 'IP entrada', 'IP salida', 'Editado'];
    const lines = [head.map(cell).join(',')];
    for (const r of rows) {
      const start = new Date(r.started_at);
      const net = this.netMinutes(r);
      lines.push(
        [
          r.user_name,
          start.toLocaleDateString(),
          this.timeOnly(r.started_at),
          r.ended_at ? this.timeOnly(r.ended_at) : 'En curso',
          Math.round((r.break_seconds_total ?? 0) / 60),
          (net / 60).toFixed(2),
          r.start_ip ?? '',
          r.end_ip ?? '',
          (r.adjusted_count ?? 0) > 0 ? 'Sí' : 'No',
        ]
          .map(cell)
          .join(','),
      );
    }
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fichajes_${this.fromDate()}_${this.toDate()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  openHistory(row: WorkSession): void {
    this.historyTarget.set(row);
    this.historyItems.set([]);
    this.historyLoading.set(true);
    this.api.getReportWorkSessionAdjustments(row.id).subscribe({
      next: (items) => {
        this.historyItems.set(items);
        this.historyLoading.set(false);
      },
      error: () => this.historyLoading.set(false),
    });
  }

  closeHistory(): void {
    this.historyTarget.set(null);
  }

  openManual(): void {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const day = this.fmtDate(y);
    this.manualUser.set(this.wsPerson());
    this.manualStart.set(`${day}T08:00`);
    this.manualEnd.set(`${day}T17:00`);
    this.manualNote.set('');
    this.manualError.set(null);
    this.manualOpen.set(true);
  }

  closeManual(): void {
    if (this.manualSaving()) return;
    this.manualOpen.set(false);
  }

  submitManual(): void {
    const uid = this.manualUser();
    if (uid == null) {
      this.manualError.set(this.translate.instant('REPORTS.WS_ADD_ERR_PERSON'));
      return;
    }
    const s = this.datetimeLocalToUtcIso(this.manualStart());
    const e = this.datetimeLocalToUtcIso(this.manualEnd());
    if (!s || !e || new Date(e).getTime() <= new Date(s).getTime()) {
      this.manualError.set(this.translate.instant('REPORTS.WS_ADD_ERR_RANGE'));
      return;
    }
    if (new Date(e).getTime() > Date.now() + 5 * 60000) {
      this.manualError.set(this.translate.instant('REPORTS.WS_ADD_ERR_FUTURE'));
      return;
    }
    this.manualSaving.set(true);
    this.manualError.set(null);
    this.api
      .createReportWorkSession({ user_id: uid, started_at: s, ended_at: e, note: this.manualNote().trim() })
      .subscribe({
        next: () => {
          this.manualSaving.set(false);
          this.manualOpen.set(false);
          this.flash(this.translate.instant('REPORTS.WS_ADD_OK'));
          this.loadWorkSessions();
        },
        error: (err: HttpErrorResponse) => {
          this.manualSaving.set(false);
          this.manualError.set(
            err.status === 409
              ? this.translate.instant('REPORTS.WS_ADD_ERR_OVERLAP')
              : this.apiErr.fromHttpError(err, 'REPORTS.WS_ADD_ERROR'),
          );
        },
      });
  }

  private nowMs = signal(Date.now());

  /** Live shift board: one bar per open session, from clock-in to now, on a shared day axis. */
  liveBoard = computed(() => {
    const rows = this.workSessionsLive();
    const now = new Date(this.nowMs());
    const nowH = now.getHours() + now.getMinutes() / 60;
    const sameDay = (d: Date) => d.toDateString() === now.toDateString();
    const starts = rows.map((r) => {
      const d = new Date(r.started_at);
      return sameDay(d) ? d.getHours() + d.getMinutes() / 60 : 0;
    });
    const axisStart = Math.max(0, Math.min(6, Math.floor(Math.min(6, ...starts))));
    const axisEnd = Math.min(24, Math.max(20, Math.ceil(nowH) + 1));
    const span = axisEnd - axisStart;
    const pct = (h: number) => Math.min(100, Math.max(0, ((h - axisStart) / span) * 100));
    const step = span > 14 ? 3 : 2;
    const ticks: { left: number; label: string }[] = [];
    for (let h = axisStart; h <= axisEnd; h += step) {
      ticks.push({
        left: pct(h),
        label: new Date(2000, 0, 1, h % 24).toLocaleTimeString([], { hour: 'numeric' }),
      });
    }
    const items = rows.map((row, i) => ({
      row,
      left: pct(starts[i]),
      width: Math.max(1.8, pct(nowH) - pct(starts[i])),
      carried: starts[i] === 0 && !sameDay(new Date(row.started_at)),
    }));
    return {
      items,
      ticks,
      nowLeft: pct(nowH),
      nowLabel: now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      working: rows.filter((r) => !r.on_break).length,
      onBreak: rows.filter((r) => r.on_break).length,
    };
  });

  /** Month shown on the Excel preview card ("octubre" / "2026"). */
  attendanceMonthParts = computed(() => {
    void this.reportIntlRevision();
    const m = /^(\d{4})-(\d{2})$/.exec(this.attendanceExcelMonth());
    if (!m) return { month: '—', year: '' };
    const d = new Date(+m[1], +m[2] - 1, 1);
    return {
      month: d.toLocaleDateString(intlLocaleFromTranslate(this.translate), { month: 'long' }),
      year: m[1],
    };
  });

  /** Decorative mini spreadsheet (6 columns): header, then rows of name + day cells with hours tint. */
  readonly previewCells: string[] = (() => {
    const out: string[] = [];
    const tints = ['', 't1', 't2', 't3'];
    for (let c = 0; c < 6; c++) out.push(c === 0 ? 'head name' : `head${c === 5 ? ' sun' : ''}`);
    for (let r = 0; r < 5; r++) {
      out.push('name');
      for (let c = 1; c < 6; c++) {
        const t = tints[(r * 7 + c * 3 + (r % 2)) % 4];
        out.push(`${t}${c === 5 ? ' sun' : ''}`.trim());
      }
    }
    return out;
  })();

  readonly previewTabs = ['Resumen', 'Por empleado', 'Calendario', 'Sesiones', 'Semanas', 'Alertas'];

  hueOf(name: string): number {
    let hash = 0;
    for (const ch of name || '?') hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    return hash;
  }

  timeOnly(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  dayOnly(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const s = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** Net length of the session being corrected, from the two pickers. */
  adjustPreview = computed(() => {
    const start = new Date(this.workSessionAdjustStartedLocal());
    const endRaw = this.workSessionAdjustEndedLocal();
    if (!endRaw || isNaN(start.getTime())) return null;
    const end = new Date(endRaw);
    if (isNaN(end.getTime())) return null;
    const mins = Math.round((end.getTime() - start.getTime()) / 60000);
    const h = Math.floor(Math.abs(mins) / 60);
    const m = Math.abs(mins) % 60;
    return { bad: mins <= 0, text: `${h} h ${String(m).padStart(2, '0')} min` };
  });

  initialsOf(name: string): string {
    const parts = (name || '?').trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  private isoToDatetimeLocalValue(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** Parse `datetime-local` as local civil time → UTC ISO for the API. */
  private datetimeLocalToUtcIso(localValue: string): string | null {
    const d = new Date(localValue);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  formatCurrency(cents: number): string {
    return formatMoneyCents(cents);
  }

  formatShortDate(iso: string): string {
    void this.reportIntlRevision();
    const d = new Date(iso);
    return d.toLocaleDateString(intlLocaleFromTranslate(this.translate), {
      month: 'short',
      day: 'numeric',
    });
  }

  getReservationStatusLabel(status: string): string {
    const key = `RESERVATIONS.STATUS_${status.toUpperCase().replace(/-/g, '_')}`;
    const t = this.translate.instant(key);
    return t !== key ? t : status;
  }

  /** Backend keys rows by (product_id, product_name); tracking by id alone duplicates NG0955. */
  trackByProductRow(p: SalesReport['by_product'][number]): string {
    return `${p.product_id}\u0000${p.product_name}`;
  }

  barWidth(cents: number): string {
    const max = this.maxBarValue();
    if (max <= 0) return '0%';
    return `${Math.min(100, (cents / max) * 100)}%`;
  }

  /** SVG chart dimensions (content area; padding for labels). */
  readonly chartPad = { left: 44, right: 12, top: 12, bottom: 28 };
  readonly chartWidth = 520;
  readonly chartHeight = 200;

  /** Revenue-over-time: polyline points for SVG (x,y from daily data). */
  revenueChartPoints(): string {
    const r = this.report();
    if (!r?.summary.daily?.length) return '';
    const daily = r.summary.daily;
    const maxRev = Math.max(1, ...daily.map((d) => d.revenue_cents));
    const w = this.chartWidth - this.chartPad.left - this.chartPad.right;
    const h = this.chartHeight - this.chartPad.top - this.chartPad.bottom;
    const points = daily.map((d, i) => {
      const x = this.chartPad.left + (i / (daily.length - 1 || 1)) * w;
      const y = this.chartPad.top + h - (d.revenue_cents / maxRev) * h;
      return `${x},${y}`;
    });
    return points.join(' ');
  }

  /** Revenue-over-time: one marker per day (with its value for the tooltip). */
  revenueChartDots(): { x: number; y: number; label: string }[] {
    const r = this.report();
    if (!r?.summary.daily?.length) return [];
    const daily = r.summary.daily;
    const maxRev = Math.max(1, ...daily.map((d) => d.revenue_cents));
    const w = this.chartWidth - this.chartPad.left - this.chartPad.right;
    const h = this.chartHeight - this.chartPad.top - this.chartPad.bottom;
    return daily.map((d, i) => ({
      x: this.chartPad.left + (i / (daily.length - 1 || 1)) * w,
      y: this.chartPad.top + h - (d.revenue_cents / maxRev) * h,
      label: `${this.formatShortDate(d.date)}: ${this.formatCurrency(d.revenue_cents)}`,
    }));
  }

  /** Revenue-over-time: area path (fill under the line). */
  revenueChartAreaPath(): string {
    const r = this.report();
    if (!r?.summary.daily?.length) return '';
    const daily = r.summary.daily;
    const maxRev = Math.max(1, ...daily.map((d) => d.revenue_cents));
    const w = this.chartWidth - this.chartPad.left - this.chartPad.right;
    const h = this.chartHeight - this.chartPad.top - this.chartPad.bottom;
    const baseY = this.chartPad.top + h;
    const firstX = this.chartPad.left;
    const lastX = this.chartPad.left + w;
    const points = daily.map((d, i) => {
      const x = this.chartPad.left + (i / (daily.length - 1 || 1)) * w;
      const y = this.chartPad.top + h - (d.revenue_cents / maxRev) * h;
      return `${x},${y}`;
    });
    return `M ${firstX},${baseY} L ${points.join(' L ')} L ${lastX},${baseY} Z`;
  }

  /** Y-axis ticks for revenue chart (0, ~50%, 100% of max). */
  revenueChartYLabels(): { value: number; y: number }[] {
    const r = this.report();
    if (!r?.summary.daily?.length) return [];
    const maxRev = Math.max(1, ...r.summary.daily.map((d) => d.revenue_cents));
    const h = this.chartHeight - this.chartPad.top - this.chartPad.bottom;
    return [
      { value: maxRev, y: this.chartPad.top },
      { value: Math.round(maxRev / 2), y: this.chartPad.top + h / 2 },
      { value: 0, y: this.chartPad.top + h },
    ];
  }

  /** X-axis date labels (first, middle, last) for revenue chart. */
  revenueChartXLabels(): { date: string; x: number }[] {
    const r = this.report();
    if (!r?.summary.daily?.length) return [];
    const daily = r.summary.daily;
    const w = this.chartWidth - this.chartPad.left - this.chartPad.right;
    const indices = daily.length === 1 ? [0] : [0, Math.floor((daily.length - 1) / 2), daily.length - 1];
    return indices.map((i) => ({
      date: this.formatShortDate(daily[i].date),
      x: this.chartPad.left + (i / (daily.length - 1 || 1)) * w,
    }));
  }

  /** Format value as percentage of total (e.g. "12.3%" or "0%"). */
  formatPct(value: number, total: number): string {
    if (total <= 0) return '0%';
    const pct = (value / total) * 100;
    return pct >= 100 ? '100%' : pct <= 0 ? '0%' : `${pct.toFixed(1)}%`;
  }

  exportExcel() {
    this.exporting.set(true);
    const from = this.fromDate();
    const to = this.toDate();
    this.api.getReportsExport(from, to, 'xlsx', 'summary', this.languageService.getLanguage()).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pos2-sales-${from}-${to}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.exporting.set(false);
      },
      error: () => this.exporting.set(false),
    });
  }

  exportDetailedExcel() {
    this.exportingDetailed.set(true);
    const from = this.fromDate();
    const to = this.toDate();
    this.api.getReportsExportDetailed(from, to, this.languageService.getLanguage()).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pos2-detailed-${from}-${to}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.exportingDetailed.set(false);
      },
      error: () => this.exportingDetailed.set(false),
    });
  }

}
