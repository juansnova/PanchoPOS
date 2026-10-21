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
  disabled: boolean;
}

function toIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fromIso(v: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/**
 * Calendar popup that replaces <input type="date">: month grid, today ring, quick picks
 * (today / tomorrow / next week) and a clear button. Works with ngModel / formControlName
 * using "YYYY-MM-DD" strings.
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
      [disabled]="isDisabled()"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
      (keydown)="onTriggerKey($event)"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      <span class="dp-label">{{ displayLabel() }}</span>
      @if (value() && clearable()) {
        <span class="dp-x" role="button" tabindex="0" [attr.aria-label]="'COMMON.CLEAR' | translate" (click)="clear($event)" (keydown.enter)="clear($event)">×</span>
      }
    </button>

    @if (open()) {
      <div class="dp-panel" role="dialog" [style.top.px]="top()" [style.left.px]="left()" (mousedown)="$event.stopPropagation()" (keydown)="onPanelKey($event)">
        <div class="dp-head">
          <button type="button" class="dp-nav" (click)="shiftMonth(-1)" aria-label="‹">‹</button>
          <div class="dp-title">
            <strong>{{ monthLabel() }}</strong>
            <small>{{ yearLabel() }}</small>
          </div>
          <button type="button" class="dp-nav" (click)="shiftMonth(1)" aria-label="›">›</button>
        </div>
        <div class="dp-week">
          @for (w of weekdays(); track $index) {
            <span>{{ w }}</span>
          }
        </div>
        <div class="dp-grid" role="grid">
          @for (c of cells(); track c.iso) {
            <button
              type="button"
              class="dp-day"
              [class.dp-out]="!c.inMonth"
              [class.dp-today]="c.today"
              [class.dp-sel]="c.iso === value()"
              [disabled]="c.disabled"
              [attr.aria-label]="c.iso"
              [attr.aria-pressed]="c.iso === value()"
              (click)="pick(c)"
            >{{ c.day }}</button>
          }
        </div>
        <div class="dp-quick">
          <button type="button" (click)="quick(0)">{{ 'COMMON.TODAY' | translate }}</button>
          <button type="button" (click)="quick(1)">{{ 'COMMON.TOMORROW' | translate }}</button>
          <button type="button" (click)="quick(7)">{{ 'COMMON.IN_ONE_WEEK' | translate }}</button>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; position: relative; min-width: 0; }
    .dp-trigger {
      display: flex; align-items: center; gap: 10px; width: 100%; min-height: 46px; padding: 0 12px;
      border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); color: var(--color-text);
      font: inherit; font-weight: 600; text-align: left; cursor: pointer; box-sizing: border-box; touch-action: manipulation;
      transition: border-color .15s, box-shadow .15s;
    }
    .dp-trigger svg { flex: none; color: var(--color-primary); }
    .dp-trigger:hover:not(:disabled) { border-color: var(--color-primary); }
    .dp-trigger.dp-open, .dp-trigger:focus-visible { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
    .dp-trigger:disabled { opacity: .55; cursor: not-allowed; }
    .dp-empty .dp-label { color: var(--color-text-muted); font-weight: 500; }
    .dp-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dp-x { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; color: var(--color-text-muted); font-size: 1.1rem; line-height: 1; }
    .dp-x:hover { background: var(--color-bg); color: var(--color-text); }

    .dp-panel {
      position: fixed; z-index: 4000; width: 316px; padding: 14px; box-sizing: border-box;
      border-radius: 22px; background: var(--color-surface); border: 1px solid var(--color-border);
      box-shadow: 0 28px 56px -18px rgba(0, 0, 0, .5); animation: dp-in .14s ease-out;
    }
    @keyframes dp-in { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
    .dp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    .dp-title { display: flex; flex-direction: column; align-items: center; line-height: 1.1; }
    .dp-title strong { font-family: Georgia, 'Times New Roman', serif; font-size: 1.25rem; font-weight: 500; font-style: italic; text-transform: capitalize; }
    .dp-title small { font-size: .72rem; font-weight: 800; letter-spacing: .12em; color: var(--color-primary); }
    .dp-nav {
      width: 38px; height: 38px; border: 0; border-radius: 12px; background: var(--color-bg); color: var(--color-text);
      font-size: 1.4rem; line-height: 1; cursor: pointer; touch-action: manipulation; transition: background .15s, color .15s;
    }
    .dp-nav:hover { background: var(--color-primary-light); color: var(--color-primary); }
    .dp-week { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 4px; }
    .dp-week span { text-align: center; font-size: .68rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-muted); padding: 4px 0; }
    .dp-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
    .dp-day {
      position: relative; aspect-ratio: 1; border: 0; border-radius: 12px; background: transparent; color: var(--color-text);
      font: inherit; font-size: .9rem; font-weight: 700; cursor: pointer; touch-action: manipulation; font-variant-numeric: tabular-nums;
      transition: background .12s, color .12s, transform .1s;
    }
    .dp-day:hover:not(:disabled):not(.dp-sel) { background: var(--color-primary-light); color: var(--color-primary); }
    .dp-day:active:not(:disabled) { transform: scale(.92); }
    .dp-day.dp-out { color: var(--color-text-muted); opacity: .45; font-weight: 500; }
    .dp-day.dp-today { box-shadow: inset 0 0 0 2px var(--color-primary); color: var(--color-primary); }
    .dp-day.dp-sel { background: var(--color-primary); color: #fff; box-shadow: 0 8px 14px -8px var(--color-primary); opacity: 1; }
    .dp-day:disabled { opacity: .25; cursor: not-allowed; }
    .dp-quick { display: flex; gap: 6px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--color-border); }
    .dp-quick button {
      flex: 1; min-height: 36px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-bg);
      color: var(--color-text); font: inherit; font-size: .78rem; font-weight: 700; cursor: pointer; touch-action: manipulation;
    }
    .dp-quick button:hover { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-light); }
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

  @ViewChild('trigger') private triggerRef?: ElementRef<HTMLButtonElement>;

  protected value = signal<string>('');
  protected open = signal(false);
  protected viewMonth = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  protected top = signal(0);
  protected left = signal(0);
  private cvaDisabled = signal(false);
  private onChange: (v: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  isDisabled = computed(() => this.disabled() || this.cvaDisabled());
  private locale = computed(() => this.lang.getLocale());

  displayLabel = computed(() => {
    const d = fromIso(this.value());
    if (!d) return this.placeholder();
    const s = d.toLocaleDateString(this.locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
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
      return { date: d, iso, day: d.getDate(), inMonth: d.getMonth() === vm.getMonth(), today: iso === todayIso, disabled: !!min && iso < min };
    });
  });

  writeValue(v: string | null): void {
    this.value.set(v ? String(v).slice(0, 10) : '');
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
    const panelH = 400;
    const openUp = window.innerHeight - r.bottom < panelH && r.top > panelH;
    this.top.set(openUp ? Math.max(8, r.top - panelH - 6) : Math.min(r.bottom + 6, Math.max(8, window.innerHeight - panelH - 8)));
    this.left.set(Math.max(8, Math.min(r.left, window.innerWidth - 316 - 8)));
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

  shiftMonth(delta: number): void {
    const v = this.viewMonth();
    this.viewMonth.set(new Date(v.getFullYear(), v.getMonth() + delta, 1));
  }

  private commit(iso: string): void {
    this.value.set(iso);
    this.onChange(iso);
    this.close();
  }

  pick(c: DayCell): void {
    if (!c.disabled) this.commit(c.iso);
  }

  quick(offsetDays: number): void {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const iso = toIso(d);
    const min = this.min();
    if (min && iso < min) return;
    this.commit(iso);
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
