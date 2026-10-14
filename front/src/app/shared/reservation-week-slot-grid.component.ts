import { Component, inject, input, model, signal, effect, untracked } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  ApiService,
  ReservationBookDaySlotsResponse,
  ReservationBookWeekSlotState,
} from '../services/api.service';
import { resolveBookingServiceLabel } from './booking-meal-split';

/** Month calendar + time dropdown (public /book and staff /reservations). */
@Component({
  selector: 'app-reservation-week-slot-grid',
  standalone: true,
  imports: [FormsModule, NgClass, TranslateModule],
  templateUrl: './reservation-week-slot-grid.component.html',
  styleUrl: './reservation-week-slot-grid.component.scss',
})
export class ReservationWeekSlotGridComponent {
  /** Matches backend `RESERVATION_PUBLIC_MIN_LEAD_MINUTES` for /book and book-day-slots. */
  private static readonly PUBLIC_BOOK_MIN_LEAD_MINUTES = 10;

  private api = inject(ApiService);
  private translate = inject(TranslateService);

  tenantId = input.required<number>();
  partySize = input(2);
  /** IANA TZ for “today” / max book range (falls back to browser TZ). */
  timezone = input<string | null>(null);
  excludeReservationId = input<number | null>(null);
  /** When this changes (e.g. modal opens with a date), jump the calendar to that month. */
  weekAnchorSeed = input<string | null>(null);
  /** When opening hours have lunch+dinner, filter to one service (same backend as /book). */
  serviceType = input<'all' | 'lunch' | 'dinner'>('all');
  /** Tenant opening_hours JSON — used for custom service labels on the summary. */
  openingHoursJson = input<string | null>(null);
  /** Public /book: seating zone — capacity for that floor only (omit when venue-wide). */
  bookFloorId = input<number | null>(null);

  selectedDate = model<string>('');
  selectedTime = model<string>('');

  calendarYear = signal(0);
  calendarMonth = signal(1);
  monthStates = signal<Record<string, ReservationBookWeekSlotState>>({});
  monthLoading = signal(false);
  bookDaySlots = signal<ReservationBookDaySlotsResponse | null>(null);
  daySlotsLoading = signal(false);

  constructor() {
    effect(() => {
      const seed = this.weekAnchorSeed()?.trim() ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(seed)) return;
      const [y, m] = seed.split('-').map(Number);
      untracked(() => {
        if (this.calendarYear() !== y) this.calendarYear.set(y);
        if (this.calendarMonth() !== m) this.calendarMonth.set(m);
      });
    });

    effect(() => {
      const tid = this.tenantId();
      this.partySize();
      this.excludeReservationId();
      this.serviceType();
      this.bookFloorId();
      this.calendarYear();
      this.calendarMonth();
      if (!tid) return;
      untracked(() => this.loadMonthDayStates());
    });

    effect(() => {
      const tid = this.tenantId();
      this.partySize();
      this.excludeReservationId();
      this.serviceType();
      this.bookFloorId();
      this.monthLoading();
      const dateStr = this.selectedDate()?.trim() ?? '';
      if (!tid || !dateStr) {
        untracked(() => {
          this.bookDaySlots.set(null);
          this.daySlotsLoading.set(false);
        });
        return;
      }
      if (this.monthLoading()) return;
      untracked(() => this.loadDaySlots(dateStr));
    });
  }

  /** For parent save validation */
  slotState(dateStr: string, timeStr: string): string {
    const ds = this.bookDaySlots();
    if (!ds || ds.date !== dateStr || !timeStr) return 'out_of_hours';
    return ds.cells[timeStr] ?? 'out_of_hours';
  }

  private addCalendarMonth(year: number, month: number, delta: number): { y: number; m: number } {
    const d = new Date(year, month - 1 + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  }

  private loadMonthDayStates(): void {
    const tid = this.tenantId();
    if (!tid) return;
    let y = this.calendarYear();
    let m = this.calendarMonth();
    if (y < 2000) {
      const t = this.tenantTodayDateStr();
      const [ty, tm] = t.split('-').map(Number);
      y = ty;
      m = tm;
      this.calendarYear.set(y);
      this.calendarMonth.set(m);
    }
    this.monthLoading.set(true);
    const svc = this.serviceType();
    const apiSvc = svc === 'all' ? null : svc;
    this.api
      .getReservationBookMonthDayStates(
        tid,
        y,
        m,
        this.partySize(),
        this.excludeReservationId(),
        apiSvc,
        this.bookFloorId()
      )
      .subscribe({
        next: (res) => {
          const map: Record<string, ReservationBookWeekSlotState> = {};
          for (const row of res.days) map[row.date] = row.state;
          this.monthStates.set(map);
          this.monthLoading.set(false);
          untracked(() => this.afterMonthLoaded());
        },
        error: () => {
          this.monthStates.set({});
          this.monthLoading.set(false);
        },
      });
  }

  private afterMonthLoaded(): void {
    const states = this.monthStates();
    const sel = this.selectedDate().trim();
    if (sel && states[sel] === 'available') {
      const ds = this.bookDaySlots();
      if (ds?.date === sel) {
        untracked(() => this.ensureTimeFitsDay());
      }
      return;
    }
    const first = this.firstAvailableDateInMonth(states);
    if (first) {
      this.selectedDate.set(first);
      this.selectedTime.set('');
      return;
    }
    this.selectedDate.set('');
    this.selectedTime.set('');
    const tid = this.tenantId();
    if (!tid) return;
    const svc = this.serviceType();
    const apiSvc = svc === 'all' ? null : svc;
    this.api
      .getNextAvailableReservation(
        tid,
        this.tenantTodayDateStr(),
        this.partySize(),
        undefined,
        apiSvc,
        this.bookFloorId()
      )
      .subscribe({
        next: (res: { date: string; time: string }) => {
          const [y, mo] = res.date.split('-').map(Number);
          this.calendarYear.set(y);
          this.calendarMonth.set(mo);
          this.selectedDate.set(res.date);
          // Let day-slots load + ensureTimeFitsDay pick the first bookable slot (avoids rounding API time down).
          this.selectedTime.set('');
        },
        error: () => {},
      });
  }

  private firstAvailableDateInMonth(states: Record<string, ReservationBookWeekSlotState>): string | null {
    const y = this.calendarYear();
    const m = this.calendarMonth();
    const lastDom = new Date(y, m, 0).getDate();
    for (let d = 1; d <= lastDom; d++) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (states[dateStr] === 'available') return dateStr;
    }
    return null;
  }

  private loadDaySlots(dateStr: string): void {
    const states = this.monthStates();
    if (states[dateStr] !== 'available') {
      this.bookDaySlots.set(null);
      this.daySlotsLoading.set(false);
      return;
    }
    this.daySlotsLoading.set(true);
    const tid = this.tenantId();
    const svc = this.serviceType();
    const apiSvc = svc === 'all' ? null : svc;
    this.api
      .getReservationBookDaySlots(
        tid,
        dateStr,
        this.partySize(),
        this.excludeReservationId(),
        apiSvc,
        this.bookFloorId()
      )
      .subscribe({
        next: (res) => {
          this.bookDaySlots.set(res);
          this.daySlotsLoading.set(false);
          untracked(() => this.ensureTimeFitsDay());
        },
        error: () => {
          this.bookDaySlots.set(null);
          this.daySlotsLoading.set(false);
        },
      });
  }

  /** True when the current time is listed for the day and still bookable (not past / full). */
  private selectedTimeValidForDay(
    res: ReservationBookDaySlotsResponse,
    dateStr: string,
    timeStr: string,
  ): boolean {
    if (!timeStr || res.date !== dateStr) return false;
    const times = this.dayTimesForSelectedDate(res, dateStr);
    return times.includes(timeStr) && res.cells[timeStr] === 'available';
  }

  /** First selectable time for the day (same rules as `dayTimes()` + `available` cells). */
  private firstBookableTimeForDay(res: ReservationBookDaySlotsResponse, dateStr: string): string {
    if (res.date !== dateStr) return '';
    for (const slot of this.dayTimesForSelectedDate(res, dateStr)) {
      if (res.cells[slot] === 'available') return slot;
    }
    return '';
  }

  private ensureTimeFitsDay(): void {
    const res = this.bookDaySlots();
    if (!res) return;
    const dateStr = this.selectedDate().trim();
    if (!dateStr) return;
    const t = this.selectedTime().trim();
    if (t && this.selectedTimeValidForDay(res, dateStr, t)) return;
    this.selectedTime.set(this.firstBookableTimeForDay(res, dateStr));
  }

  isTodaySelected(): boolean {
    const d = this.selectedDate().trim();
    return !!d && d === this.tenantTodayDateStr();
  }

  monthDayState(dateStr: string): ReservationBookWeekSlotState | undefined {
    return this.monthStates()[dateStr];
  }

  monthDayButtonClass(dateStr: string): Record<string, boolean> {
    const st = this.monthDayState(dateStr);
    const selected = dateStr === this.selectedDate().trim();
    return {
      'dm-available': st === 'available',
      'dm-full': st === 'full',
      'dm-muted':
        st === 'past' ||
        st === 'closed_day' ||
        st === 'out_of_hours' ||
        st === 'out_of_range' ||
        st === undefined,
      'dm-closed-day': st === 'closed_day',
      'dm-selected': selected && st === 'available',
    };
  }

  monthDaySelectable(dateStr: string): boolean {
    return this.monthDayState(dateStr) === 'available';
  }

  selectMonthDay(dateStr: string): void {
    if (!this.monthDaySelectable(dateStr)) return;
    if (this.selectedDate().trim() === dateStr) return;
    this.selectedDate.set(dateStr);
    this.selectedTime.set('');
  }

  private weekDayAriaDate(dateStr: string): string {
    const locale = this.translate.currentLang || this.translate.defaultLang || 'en';
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(dt);
  }

  monthDayAriaLabel(dateStr: string): string {
    const st = this.monthDayState(dateStr);
    const keyMap: Record<string, string> = {
      available: 'BOOK.SLOT_STATE_AVAILABLE',
      full: 'BOOK.SLOT_STATE_FULL',
      past: 'BOOK.SLOT_STATE_PAST',
      closed_day: 'BOOK.SLOT_STATE_CLOSED_DAY',
      out_of_hours: 'BOOK.SLOT_STATE_OUT_OF_HOURS',
      out_of_range: 'BOOK.SLOT_STATE_OUT_OF_RANGE',
    };
    const msg = this.translate.instant(keyMap[st || ''] || 'BOOK.SLOT_STATE_OUT_OF_HOURS');
    return `${this.weekDayAriaDate(dateStr)}. ${msg}`;
  }

  monthTitle(): string {
    const y = this.calendarYear();
    const m = this.calendarMonth();
    if (y < 2000) return '';
    const locale = this.translate.currentLang || this.translate.defaultLang || 'en';
    const dt = new Date(y, m - 1, 15);
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(dt);
  }

  /** Weekday column headers Mon–Sun (locale short names). */
  weekdayHeaders(): string[] {
    const locale = this.translate.currentLang || this.translate.defaultLang || 'en';
    const out: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dt = new Date(2024, 0, 1 + i);
      out.push(new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(dt));
    }
    return out;
  }

  calendarCells(): Array<{ kind: 'blank' } | { kind: 'day'; date: string; day: number }> {
    const y = this.calendarYear();
    const m = this.calendarMonth();
    if (y < 2000) return [];
    const first = new Date(y, m - 1, 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const lastDom = new Date(y, m, 0).getDate();
    const cells: Array<{ kind: 'blank' } | { kind: 'day'; date: string; day: number }> = [];
    for (let i = 0; i < mondayOffset; i++) cells.push({ kind: 'blank' });
    for (let d = 1; d <= lastDom; d++) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ kind: 'day', date: dateStr, day: d });
    }
    return cells;
  }

  serviceLabel(): string {
    return resolveBookingServiceLabel(
      this.openingHoursJson(),
      this.serviceType(),
      {
        all: this.translate.instant('BOOK.SERVICE_ALL'),
        lunch: this.translate.instant('BOOK.SERVICE_LUNCH'),
        dinner: this.translate.instant('BOOK.SERVICE_DINNER'),
      },
      this.selectedDate()?.trim() || null,
    );
  }

  formattedSelectedDate(): string {
    const raw = this.selectedDate()?.trim();
    if (!raw) return '';
    const [y, m, d] = raw.split('-').map(Number);
    const locale = this.translate.currentLang || this.translate.defaultLang || 'en';
    const dt = new Date(y, m - 1, d);
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(dt);
  }

  onTimeModelChange(value: string): void {
    const dateStr = this.selectedDate().trim();
    if (!dateStr) return;
    if (!value) {
      this.selectedTime.set('');
      return;
    }
    if (this.slotState(dateStr, value) !== 'available') return;
    this.selectedTime.set(value);
  }

  /**
   * Ordered slot keys for the dropdown. On the tenant’s calendar today, omit slots the API marks
   * as past so the list starts at the next bookable time (same as /book and staff reservations).
   */
  dayTimes(): string[] {
    const res = this.bookDaySlots();
    if (!res) return [];
    return this.dayTimesForSelectedDate(res, this.selectedDate().trim());
  }

  private dayTimesForSelectedDate(
    res: ReservationBookDaySlotsResponse,
    dateStr: string,
  ): string[] {
    if (!dateStr || dateStr !== this.tenantTodayDateStr()) {
      return res.times;
    }
    const earliest = this.earliestBookableTimeToday();
    return res.times.filter((t) => {
      if (res.cells[t] === 'past') return false;
      return this.compareTimeHHmm(t, earliest) >= 0;
    });
  }

  private compareTimeHHmm(a: string, b: string): number {
    const [ah, am] = a.split(':').map(Number);
    const [bh, bm] = b.split(':').map(Number);
    return (ah || 0) * 60 + (am || 0) - ((bh || 0) * 60 + (bm || 0));
  }

  private earliestBookableTimeToday(): string {
    const tz = this.timezone()?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    return this.earliestQuarterHHmmAfterLeadMinutes(
      ReservationWeekSlotGridComponent.PUBLIC_BOOK_MIN_LEAD_MINUTES,
      tz,
    );
  }

  daySlotSelectable(timeStr: string): boolean {
    const dateStr = this.selectedDate().trim();
    return this.slotState(dateStr, timeStr) === 'available';
  }

  tenantTodayDateStr(): string {
    const tz = this.timezone()?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  canMonthPrev(): boolean {
    const t = this.tenantTodayDateStr();
    const [ty, tm] = t.split('-').map(Number);
    const cy = this.calendarYear();
    const cm = this.calendarMonth();
    if (cy < ty) return false;
    if (cy === ty && cm <= tm) return false;
    return true;
  }

  maxBookDateStr(): string {
    const base = this.tenantTodayDateStr();
    const [y, m, d] = base.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + 366);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  canMonthNext(): boolean {
    const cy = this.calendarYear();
    const cm = this.calendarMonth();
    const n = this.addCalendarMonth(cy, cm, 1);
    const firstOfNext = `${n.y}-${String(n.m).padStart(2, '0')}-01`;
    return firstOfNext <= this.maxBookDateStr();
  }

  monthPrev(): void {
    if (!this.canMonthPrev() || this.monthLoading()) return;
    const n = this.addCalendarMonth(this.calendarYear(), this.calendarMonth(), -1);
    this.calendarYear.set(n.y);
    this.calendarMonth.set(n.m);
  }

  monthNext(): void {
    if (!this.canMonthNext() || this.monthLoading()) return;
    const n = this.addCalendarMonth(this.calendarYear(), this.calendarMonth(), 1);
    this.calendarYear.set(n.y);
    this.calendarMonth.set(n.m);
  }

  private earliestQuarterHHmmAfterLeadMinutes(leadMinutes: number, tz: string): string {
    const lead = new Date(Date.now() + leadMinutes * 60 * 1000);
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = f.formatToParts(lead);
    const hp = parts.find((p) => p.type === 'hour');
    const mp = parts.find((p) => p.type === 'minute');
    if (!hp || !mp) {
      const d = new Date(lead);
      const total = d.getHours() * 60 + d.getMinutes();
      const rounded = Math.ceil(total / 15) * 15;
      const nh = Math.floor(rounded / 60) % 24;
      const nm = rounded % 60;
      return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
    }
    const h = parseInt(hp.value, 10);
    const m = parseInt(mp.value, 10);
    const total = h * 60 + m;
    const rounded = Math.ceil(total / 15) * 15;
    const nh = Math.floor(rounded / 60) % 24;
    const nm = rounded % 60;
    return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
  }

  /** Snap to the next 15-minute boundary (never round down — avoids past slots for “today”). */
  roundTimeToQuarter(t: string): string {
    if (!t) {
      return this.earliestBookableTimeToday();
    }
    const [h, m] = t.split(':').map(Number);
    const total = (h || 0) * 60 + (m || 0);
    const quarter = Math.ceil(total / 15) * 15;
    const nh = Math.floor(quarter / 60) % 24;
    const nm = quarter % 60;
    return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
  }
}
