import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { LanguageService } from '../services/language.service';

interface DayCell {
  date: Date;
  iso: string;
  day: number;
  inMonth: boolean;
  today: boolean;
  sunday: boolean;
  disabled: boolean;
}

interface MonthCell {
  month: number;
  label: string;
  iso: string;
  current: boolean;
}

const p2 = (n: number) => String(n).padStart(2, '0');

function toIso(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

function fromIso(v: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(v ?? '');
  return m ? new Date(+m[1], +m[2] - 1, m[3] ? +m[3] : 1) : null;
}

const QUICK_TIMES: [number, number][] = [
  [6, 0],
  [8, 0],
  [12, 0],
  [18, 0],
  [22, 0],
];

/**
 * Calendar popup that replaces <input type="date|month|datetime-local">.
 * - mode "date": "YYYY-MM-DD" (month grid, today ring, quick picks, clear)
 * - mode "month": "YYYY-MM" (year switcher + 12 month tiles)
 * - mode "datetime": "YYYY-MM-DDTHH:mm" (month grid + big 12-hour clock with quick times)
 * Works with ngModel / formControlName.
 */
@Component({
  selector: 'app-date-picker',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => AppDatePickerComponent), multi: true }],
  template: `
    <button
      #trigger
      type="button"
      class="dp-trigger"
      [class.dp-open]="open()"
      [class.dp-empty]="!value()"
      [class.dp-pill]="pill()"
      [disabled]="isDisabled()"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
      (keydown)="onTriggerKey($event)"
    >
      <span class="dp-ico" aria-hidden="true">
        @if (mode() === 'datetime') {
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><circle cx="15.5" cy="16" r="3.2" /><path d="M15.5 14.4V16l1 .7" />
          </svg>
        } @else {
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        }
      </span>
      <span class="dp-label">{{ displayLabel() }}</span>
      @if (value() && clearable()) {
        <span class="dp-x" role="button" tabindex="0" [attr.aria-label]="'COMMON.CLEAR' | translate" (click)="clear($event)" (keydown.enter)="clear($event)">×</span>
      }
    </button>

    @if (open()) {
      <div class="dp-panel" [class.dp-wide]="mode() === 'datetime'" role="dialog" [style.top.px]="top()" [style.left.px]="left()" (mousedown)="$event.stopPropagation()" (keydown)="onPanelKey($event)">
        <div class="dp-head">
          <button type="button" class="dp-nav" (click)="shift(-1)" aria-label="‹">‹</button>
          <div class="dp-title">
            @if (mode() === 'month') {
              <strong>{{ yearLabel() }}</strong>
              <small>{{ 'COMMON.CHOOSE_MONTH' | translate }}</small>
            } @else {
              <strong>{{ monthLabel() }}</strong>
              <small>{{ yearLabel() }}</small>
            }
          </div>
          <button type="button" class="dp-nav" (click)="shift(1)" aria-label="›">›</button>
        </div>

        @if (mode() === 'month') {
          <div class="dp-months">
            @for (m of monthCells(); track m.iso) {
              <button
                type="button"
                class="dp-month"
                [class.dp-today]="m.current"
                [class.dp-sel]="m.iso === value()"
                (click)="pickMonth(m)"
              >{{ m.label }}</button>
            }
          </div>
          <div class="dp-quick">
            <button type="button" (click)="thisMonth()">{{ 'COMMON.THIS_MONTH' | translate }}</button>
          </div>
        } @else {
          <div class="dp-week">
            @for (w of weekdays(); track $index) {
              <span [class.dp-sun]="$index === 6">{{ w }}</span>
            }
          </div>
          <div class="dp-grid" role="grid">
            @for (c of cells(); track c.iso) {
              <button
                type="button"
                class="dp-day"
                [class.dp-out]="!c.inMonth"
                [class.dp-today]="c.today"
                [class.dp-sunday]="c.sunday"
                [class.dp-sel]="c.iso === dateOnly()"
                [disabled]="c.disabled"
                [attr.aria-label]="c.iso"
                [attr.aria-pressed]="c.iso === dateOnly()"
                (click)="pick(c)"
              >{{ c.day }}</button>
            }
          </div>

          @if (mode() === 'datetime') {
            <div class="dp-time">
              <div class="dp-clock">
                <div class="dp-unit">
                  <button type="button" class="dp-step" (click)="stepHour(1)" aria-label="+">▲</button>
                  <input class="dp-digits" inputmode="numeric" maxlength="2" [value]="hourText()" (change)="onHourInput($event)" (focus)="selectAll($event)" aria-label="hora" />
                  <button type="button" class="dp-step" (click)="stepHour(-1)" aria-label="-">▼</button>
                </div>
                <span class="dp-colon">:</span>
                <div class="dp-unit">
                  <button type="button" class="dp-step" (click)="stepMinute(5)" aria-label="+">▲</button>
                  <input class="dp-digits" inputmode="numeric" maxlength="2" [value]="minuteText()" (change)="onMinuteInput($event)" (focus)="selectAll($event)" aria-label="min" />
                  <button type="button" class="dp-step" (click)="stepMinute(-5)" aria-label="-">▼</button>
                </div>
                <button type="button" class="dp-ampm" (click)="togglePm()">
                  <span [class.on]="!isPm()">a. m.</span>
                  <span [class.on]="isPm()">p. m.</span>
                </button>
              </div>
              <div class="dp-times">
                @for (t of quickTimes; track t[0]) {
                  <button type="button" [class.on]="timeH() === t[0] && timeM() === t[1]" (click)="setTime(t[0], t[1])">{{ timeLabel(t[0], t[1]) }}</button>
                }
              </div>
            </div>
            <div class="dp-actions">
              <button type="button" class="dp-ghost" (click)="nowQuick()">{{ 'COMMON.NOW' | translate }}</button>
              <button type="button" class="dp-done" (click)="finish()">{{ 'COMMON.DONE' | translate }}</button>
            </div>
          } @else {
            <div class="dp-quick">
              <button type="button" (click)="quick(0)">{{ 'COMMON.TODAY' | translate }}</button>
              <button type="button" (click)="quick(1)">{{ 'COMMON.TOMORROW' | translate }}</button>
              <button type="button" (click)="quick(7)">{{ 'COMMON.IN_ONE_WEEK' | translate }}</button>
            </div>
          }
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; position: relative; min-width: 0; }
    .dp-trigger {
      display: flex; align-items: center; gap: 10px; width: 100%; min-height: 46px; padding: 0 12px 0 8px;
      border: 1px solid var(--color-border); border-radius: 14px; background: var(--color-surface); color: var(--color-text);
      font: inherit; font-weight: 700; text-align: left; cursor: pointer; box-sizing: border-box; touch-action: manipulation;
      transition: border-color .15s, box-shadow .15s;
    }
    .dp-trigger.dp-pill { border-radius: 999px; border-color: transparent; }
    .dp-ico {
      flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%;
      background: linear-gradient(145deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 70%, #000)); color: #fff;
      box-shadow: 0 8px 14px -8px var(--color-primary);
    }
    .dp-trigger:hover:not(:disabled) { border-color: var(--color-primary); }
    .dp-trigger.dp-open, .dp-trigger:focus-visible { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
    .dp-trigger:disabled { opacity: .55; cursor: not-allowed; }
    .dp-empty .dp-label { color: var(--color-text-muted); font-weight: 500; }
    .dp-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dp-x { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; color: var(--color-text-muted); font-size: 1.1rem; line-height: 1; }
    .dp-x:hover { background: var(--color-bg); color: var(--color-text); }

    .dp-panel {
      position: fixed; z-index: 4000; width: 320px; padding: 0 14px 14px; box-sizing: border-box; overflow: hidden;
      border-radius: 24px; background: var(--color-surface); border: 1px solid var(--color-border);
      box-shadow: 0 30px 60px -18px rgba(0, 0, 0, .55); animation: dp-in .14s ease-out;
    }
    .dp-panel.dp-wide { width: 332px; }
    @keyframes dp-in { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
    .dp-head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 -14px 12px; padding: 14px;
      color: #fff; position: relative; overflow: hidden;
      background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 70%, #000));
    }
    .dp-head::after {
      content: ''; position: absolute; right: -40px; top: -60px; width: 170px; height: 170px; border-radius: 50%;
      background: radial-gradient(circle, transparent 38%, rgba(255,255,255,.16) 39%, transparent 40%, transparent 54%, rgba(255,255,255,.12) 55%, transparent 56%);
      pointer-events: none;
    }
    .dp-title { display: flex; flex-direction: column; align-items: center; line-height: 1.1; position: relative; z-index: 1; }
    .dp-title strong { font-family: Georgia, 'Times New Roman', serif; font-size: 1.45rem; font-weight: 500; font-style: italic; text-transform: capitalize; }
    .dp-title small { font-size: .72rem; font-weight: 800; letter-spacing: .14em; opacity: .9; }
    .dp-nav {
      position: relative; z-index: 1; width: 38px; height: 38px; border: 0; border-radius: 50%; background: rgba(255,255,255,.2); color: #fff;
      font-size: 1.4rem; line-height: 1; cursor: pointer; touch-action: manipulation; transition: background .15s;
    }
    .dp-nav:hover { background: rgba(255,255,255,.36); }
    .dp-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); margin-bottom: 4px; }
    .dp-week span { text-align: center; font-size: .68rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-muted); padding: 4px 0; }
    .dp-week span.dp-sun { color: var(--color-primary); }
    .dp-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 3px; }
    .dp-day {
      position: relative; aspect-ratio: 1; border: 0; border-radius: 50%; background: transparent; color: var(--color-text);
      font: inherit; font-size: .9rem; font-weight: 700; cursor: pointer; touch-action: manipulation; font-variant-numeric: tabular-nums;
      transition: background .12s, color .12s, transform .1s;
    }
    .dp-day.dp-sunday { color: var(--color-primary); }
    .dp-day:hover:not(:disabled):not(.dp-sel) { background: var(--color-primary-light); color: var(--color-primary); }
    .dp-day:active:not(:disabled) { transform: scale(.9); }
    .dp-day.dp-out { color: var(--color-text-muted); opacity: .4; font-weight: 500; }
    .dp-day.dp-today { box-shadow: inset 0 0 0 2px var(--color-primary); color: var(--color-primary); }
    .dp-day.dp-sel {
      background: linear-gradient(145deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 70%, #000)); color: #fff;
      box-shadow: 0 10px 16px -8px var(--color-primary); opacity: 1;
    }
    .dp-day:disabled { opacity: .25; cursor: not-allowed; }

    .dp-months { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding-top: 4px; }
    .dp-month {
      min-height: 52px; border: 1px solid var(--color-border); border-radius: 16px; background: var(--color-bg); color: var(--color-text);
      font: inherit; font-weight: 800; text-transform: capitalize; cursor: pointer; touch-action: manipulation; transition: all .12s;
    }
    .dp-month:hover { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-light); }
    .dp-month.dp-today { box-shadow: inset 0 0 0 2px var(--color-primary); color: var(--color-primary); }
    .dp-month.dp-sel {
      border-color: transparent; color: #fff; box-shadow: 0 10px 16px -8px var(--color-primary);
      background: linear-gradient(145deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 70%, #000));
    }

    .dp-quick { display: flex; gap: 6px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--color-border); }
    .dp-quick button {
      flex: 1; min-height: 36px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-bg);
      color: var(--color-text); font: inherit; font-size: .78rem; font-weight: 700; cursor: pointer; touch-action: manipulation;
    }
    .dp-quick button:hover { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-light); }

    .dp-time { margin-top: 12px; padding: 12px; border-radius: 20px; background: #1c1917; color: #fff; }
    .dp-clock { display: flex; align-items: center; justify-content: center; gap: 6px; }
    .dp-unit { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .dp-step {
      width: 44px; height: 22px; border: 0; border-radius: 8px; background: rgba(255,255,255,.1); color: rgba(255,255,255,.75);
      font-size: .6rem; cursor: pointer; touch-action: manipulation;
    }
    .dp-step:hover { background: var(--color-primary); color: #fff; }
    .dp-digits {
      width: 64px; height: 54px; border: 0; border-radius: 14px; background: rgba(255,255,255,.08); color: #fff; text-align: center;
      font-family: Georgia, 'Times New Roman', serif; font-size: 2.1rem; font-weight: 600; font-variant-numeric: tabular-nums;
    }
    .dp-digits:focus { outline: 2px solid var(--color-primary); }
    .dp-colon { font-size: 2rem; font-weight: 800; color: var(--color-primary); padding-bottom: 2px; }
    .dp-ampm {
      display: flex; flex-direction: column; gap: 4px; margin-left: 8px; padding: 4px; border: 0; border-radius: 14px;
      background: rgba(255,255,255,.1); cursor: pointer; touch-action: manipulation;
    }
    .dp-ampm span { padding: 7px 8px; border-radius: 10px; font-size: .74rem; font-weight: 800; color: rgba(255,255,255,.6); }
    .dp-ampm span.on { background: var(--color-primary); color: #fff; box-shadow: 0 8px 12px -8px var(--color-primary); }
    .dp-times { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; justify-content: center; }
    .dp-times button {
      min-height: 30px; padding: 0 12px; border: 1px solid rgba(255,255,255,.2); border-radius: 999px; background: transparent;
      color: rgba(255,255,255,.85); font: inherit; font-size: .74rem; font-weight: 700; cursor: pointer; touch-action: manipulation;
    }
    .dp-times button:hover { border-color: var(--color-primary); color: #fff; }
    .dp-times button.on { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
    .dp-actions { display: flex; gap: 8px; margin-top: 12px; }
    .dp-ghost, .dp-done { min-height: 42px; border-radius: 999px; font: inherit; font-weight: 800; cursor: pointer; touch-action: manipulation; }
    .dp-ghost { flex: 0 0 auto; padding: 0 18px; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text); }
    .dp-ghost:hover { border-color: var(--color-primary); color: var(--color-primary); }
    .dp-done { flex: 1; border: 0; color: #fff; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 70%, #000)); box-shadow: 0 12px 20px -12px var(--color-primary); }
    .dp-done:hover { filter: brightness(1.07); }
    @media (prefers-reduced-motion: reduce) { .dp-panel { animation: none; } }
  `],
})
export class AppDatePickerComponent implements ControlValueAccessor {
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private cdr = inject(ChangeDetectorRef);
  private lang = inject(LanguageService);

  readonly placeholder = input('');
  readonly clearable = input(true);
  /** Earliest selectable date ("YYYY-MM-DD"). */
  readonly min = input<string | null>(null);
  readonly disabled = input(false);
  /** "date" (YYYY-MM-DD), "month" (YYYY-MM) or "datetime" (YYYY-MM-DDTHH:mm). */
  readonly mode = input<'date' | 'month' | 'datetime'>('date');
  /** Short label ("mar, 20 oct 2026") for tight spaces such as page headers. */
  readonly compact = input(false);
  /** Fully rounded trigger (used on coloured banners). */
  readonly pill = input(false);

  @ViewChild('trigger') private triggerRef?: ElementRef<HTMLButtonElement>;

  protected value = signal<string>('');
  protected open = signal(false);
  protected viewMonth = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  protected timeH = signal(8);
  protected timeM = signal(0);
  protected top = signal(0);
  protected left = signal(0);
  protected readonly quickTimes = QUICK_TIMES;
  private cvaDisabled = signal(false);
  private onChange: (v: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  isDisabled = computed(() => this.disabled() || this.cvaDisabled());
  private locale = computed(() => this.lang.getLocale());

  /** The YYYY-MM-DD part of the value (empty in month mode). */
  dateOnly = computed(() => (this.mode() === 'month' ? '' : this.value().slice(0, 10)));
  isPm = computed(() => this.timeH() >= 12);
  hourText = computed(() => p2(this.timeH() % 12 || 12));
  minuteText = computed(() => p2(this.timeM()));

  displayLabel = computed(() => {
    const d = fromIso(this.value());
    if (!d) return this.placeholder();
    const loc = this.locale();
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    if (this.mode() === 'month') return cap(d.toLocaleDateString(loc, { month: 'long', year: 'numeric' }));
    if (this.mode() === 'datetime') {
      const t = new Date(2000, 0, 1, this.timeH(), this.timeM());
      const day = d.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
      return `${cap(day)} · ${t.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' })}`;
    }
    const s = this.compact()
      ? d.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '')
      : d.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return cap(s);
  });

  monthLabel = computed(() => this.viewMonth().toLocaleDateString(this.locale(), { month: 'long' }));
  yearLabel = computed(() => String(this.viewMonth().getFullYear()));

  /** Monday-first weekday initials in the current language. */
  weekdays = computed(() => {
    const base = new Date(2024, 0, 1); // a Monday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d.toLocaleDateString(this.locale(), { weekday: 'short' }).replace('.', '').slice(0, 2);
    });
  });

  cells = computed<DayCell[]>(() => {
    const vm = this.viewMonth();
    const first = new Date(vm.getFullYear(), vm.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // Monday = 0
    const start = new Date(first);
    start.setDate(1 - offset);
    const todayIso = toIso(new Date());
    const min = this.min();
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = toIso(d);
      return {
        date: d,
        iso,
        day: d.getDate(),
        inMonth: d.getMonth() === vm.getMonth(),
        today: iso === todayIso,
        sunday: d.getDay() === 0,
        disabled: !!min && iso < min,
      };
    });
  });

  monthCells = computed<MonthCell[]>(() => {
    const y = this.viewMonth().getFullYear();
    const now = new Date();
    return Array.from({ length: 12 }, (_, m) => ({
      month: m,
      label: new Date(y, m, 1).toLocaleDateString(this.locale(), { month: 'short' }).replace('.', ''),
      iso: `${y}-${p2(m + 1)}`,
      current: y === now.getFullYear() && m === now.getMonth(),
    }));
  });

  writeValue(v: string | null): void {
    const raw = v ? String(v) : '';
    const mode = this.mode();
    this.value.set(mode === 'month' ? raw.slice(0, 7) : mode === 'datetime' ? raw.slice(0, 16) : raw.slice(0, 10));
    if (mode === 'datetime') {
      const t = /T(\d{2}):(\d{2})/.exec(raw);
      if (t) {
        this.timeH.set(+t[1]);
        this.timeM.set(+t[2]);
      }
    }
    const d = fromIso(this.value());
    if (d) this.viewMonth.set(new Date(d.getFullYear(), d.getMonth(), 1));
    this.cdr.markForCheck();
  }
  registerOnChange(fn: (v: string | null) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void {
    this.cvaDisabled.set(d);
    this.cdr.markForCheck();
  }

  toggle(): void {
    if (this.isDisabled()) return;
    this.open() ? this.close() : this.openPanel();
  }

  private openPanel(): void {
    const el = this.triggerRef?.nativeElement;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panelH = this.mode() === 'datetime' ? 650 : this.mode() === 'month' ? 340 : 440;
    const panelW = this.mode() === 'datetime' ? 332 : 320;
    const openUp = window.innerHeight - r.bottom < panelH && r.top > panelH;
    this.top.set(openUp ? Math.max(8, r.top - panelH - 6) : Math.min(r.bottom + 6, Math.max(8, window.innerHeight - panelH - 8)));
    this.left.set(Math.max(8, Math.min(r.left, window.innerWidth - panelW - 8)));
    const d = fromIso(this.value());
    const base = d ?? new Date();
    this.viewMonth.set(new Date(base.getFullYear(), base.getMonth(), 1));
    this.open.set(true);
    this.cdr.markForCheck();
  }

  private close(focus = true): void {
    this.open.set(false);
    this.onTouched();
    if (focus) this.triggerRef?.nativeElement.focus();
    this.cdr.markForCheck();
  }

  finish(): void {
    if (!this.value()) this.emitDatetime(toIso(new Date()));
    this.close();
  }

  /** Previous / next month (or year in month mode). */
  shift(delta: number): void {
    const v = this.viewMonth();
    this.viewMonth.set(
      this.mode() === 'month' ? new Date(v.getFullYear() + delta, 0, 1) : new Date(v.getFullYear(), v.getMonth() + delta, 1),
    );
  }

  private commit(v: string): void {
    this.value.set(v);
    this.onChange(v);
    this.close();
  }

  private emitDatetime(isoDate: string): void {
    const v = `${isoDate}T${p2(this.timeH())}:${p2(this.timeM())}`;
    this.value.set(v);
    this.onChange(v);
    this.cdr.markForCheck();
  }

  pick(c: DayCell): void {
    if (c.disabled) return;
    if (this.mode() === 'datetime') this.emitDatetime(c.iso);
    else this.commit(c.iso);
  }

  pickMonth(m: MonthCell): void {
    this.commit(m.iso);
  }

  thisMonth(): void {
    const n = new Date();
    this.commit(`${n.getFullYear()}-${p2(n.getMonth() + 1)}`);
  }

  quick(offsetDays: number): void {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const iso = toIso(d);
    const min = this.min();
    if (min && iso < min) return;
    this.commit(iso);
  }

  nowQuick(): void {
    const n = new Date();
    this.timeH.set(n.getHours());
    this.timeM.set(n.getMinutes());
    this.viewMonth.set(new Date(n.getFullYear(), n.getMonth(), 1));
    this.emitDatetime(toIso(n));
  }

  // ---- time (12-hour clock)
  private touchTime(): void {
    this.emitDatetime(this.dateOnly() || toIso(new Date()));
  }

  setTime(h: number, m: number): void {
    this.timeH.set(h);
    this.timeM.set(m);
    this.touchTime();
  }

  stepHour(delta: number): void {
    const pm = this.isPm();
    const h12 = (((this.timeH() % 12 || 12) - 1 + delta + 12) % 12) + 1;
    this.timeH.set((h12 % 12) + (pm ? 12 : 0));
    this.touchTime();
  }

  stepMinute(delta: number): void {
    this.timeM.set((this.timeM() + delta + 60) % 60);
    this.touchTime();
  }

  togglePm(): void {
    this.timeH.set((this.timeH() + 12) % 24);
    this.touchTime();
  }

  onHourInput(ev: Event): void {
    const n = parseInt((ev.target as HTMLInputElement).value, 10);
    const h12 = Number.isFinite(n) ? Math.min(12, Math.max(1, n)) : this.timeH() % 12 || 12;
    this.timeH.set((h12 % 12) + (this.isPm() ? 12 : 0));
    (ev.target as HTMLInputElement).value = p2(h12);
    this.touchTime();
  }

  onMinuteInput(ev: Event): void {
    const n = parseInt((ev.target as HTMLInputElement).value, 10);
    const m = Number.isFinite(n) ? Math.min(59, Math.max(0, n)) : this.timeM();
    this.timeM.set(m);
    (ev.target as HTMLInputElement).value = p2(m);
    this.touchTime();
  }

  selectAll(ev: Event): void {
    (ev.target as HTMLInputElement).select();
  }

  timeLabel(h: number, m: number): string {
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(this.locale(), { hour: 'numeric', minute: '2-digit' });
  }

  clear(event: Event): void {
    event.stopPropagation();
    this.value.set('');
    this.onChange(null);
    this.cdr.markForCheck();
  }

  onTriggerKey(event: KeyboardEvent): void {
    if (['ArrowDown', 'Enter', ' '].includes(event.key) && !this.open()) {
      event.preventDefault();
      this.openPanel();
    }
  }

  onPanelKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentDown(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }

  @HostListener('window:resize')
  onResize(): void {
    if (this.open()) this.close(false);
  }
}
