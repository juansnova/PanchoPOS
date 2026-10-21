import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  forwardRef,
  inject,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export interface AppSelectOption {
  value: unknown;
  label: string;
  /** Small secondary line (e.g. SKU). */
  sub?: string;
  /** Shown but not selectable (e.g. a time slot that is full). */
  disabled?: boolean;
  /** Emoji / short glyph shown in a tinted square before the label. */
  icon?: string;
  /** Inner markup of a 24x24 stroke SVG (our own static strings); drawn instead of `icon` when set. */
  svg?: string;
  /** Colour family for the icon square (a = amber, b = blue, c = green). */
  tone?: 'a' | 'b' | 'c' | 'd' | 'e';
  /** Options with the same group are listed under a heading (list must already be ordered by group). */
  group?: string;
}

/**
 * Drop-in replacement for a native <select> that matches the app: rounded trigger, floating panel
 * with optional search, check mark on the selected row, keyboard support. Works with ngModel.
 */
@Component({
  selector: 'app-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => AppSelectComponent), multi: true }],
  template: `
    <button
      #trigger
      type="button"
      class="as-trigger"
      [class.as-open]="open()"
      [class.as-compact]="compact()"
      [class.as-placeholder]="!hasValue()"
      [disabled]="isDisabled()"
      role="combobox"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
      (keydown)="onTriggerKey($event)"
    >
      @if (selectedSvg(); as sv) {
        <span class="as-trigger-icon" [attr.data-tone]="selectedTone()" aria-hidden="true" [innerHTML]="svgHtml(sv)"></span>
      } @else if (selectedIcon(); as ic) {
        <span class="as-trigger-icon" [attr.data-tone]="selectedTone()" [class.as-opt-icon-sym]="ic.length > 2" aria-hidden="true">{{ ic }}</span>
      }
      <span class="as-label">{{ selectedLabel() }}</span>
      <svg class="as-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    @if (open()) {
      <div class="as-panel" [style.top.px]="panelTop()" [style.left.px]="panelLeft()" [style.width.px]="panelWidth()"
        [style.max-height.px]="panelMaxHeight()" role="presentation" (mousedown)="$event.stopPropagation()">
        @if (showSearch()) {
          <div class="as-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input #searchBox type="search" autocomplete="off" [value]="query()" (input)="onQuery($event)" (keydown)="onPanelKey($event)" placeholder="…" />
          </div>
        }
        <ul class="as-list" [class.as-grid]="grid()" role="listbox" tabindex="-1" (keydown)="onPanelKey($event)" #list>
          @if (clearable() && !query()) {
            <li class="as-opt as-opt-empty" role="option" [class.as-active]="activeIndex() === -1" (mouseenter)="activeIndex.set(-1)" (click)="clear()">
              {{ placeholder() }}
            </li>
          }
          @for (opt of filtered(); track $index; let i = $index) {
            @if (opt.group && (i === 0 || filtered()[i - 1].group !== opt.group)) {
              <li class="as-group" role="presentation">{{ opt.group }}</li>
            }
            <li class="as-opt" role="option" [attr.aria-selected]="isSelected(opt)" [attr.aria-disabled]="opt.disabled ? true : null"
              [class.as-selected]="isSelected(opt)" [class.as-disabled]="opt.disabled"
              [class.as-active]="activeIndex() === i && !opt.disabled" (mouseenter)="!opt.disabled && activeIndex.set(i)" (click)="!opt.disabled && choose(opt)">
              @if (opt.svg) {
                <span class="as-opt-icon" [attr.data-tone]="opt.tone" aria-hidden="true" [innerHTML]="svgHtml(opt.svg)"></span>
              } @else if (opt.icon) {
                <span class="as-opt-icon" [attr.data-tone]="opt.tone" [class.as-opt-icon-sym]="opt.icon.length > 2" aria-hidden="true">{{ opt.icon }}</span>
              }
              <span class="as-opt-text">
                <span class="as-opt-label">{{ opt.label }}</span>
                @if (opt.sub) {
                  <small class="as-opt-sub">{{ opt.sub }}</small>
                }
              </span>
              @if (isSelected(opt)) {
                <svg class="as-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
              }
            </li>
          } @empty {
            <li class="as-none">—</li>
          }
        </ul>
      </div>
    }
  `,
  styles: [`
    :host { display: block; position: relative; min-width: 0; }
    .as-trigger {
      display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-height: 46px; padding: 0 14px;
      border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); color: var(--color-text);
      font: inherit; text-align: left; cursor: pointer; box-sizing: border-box; touch-action: manipulation;
      transition: border-color .15s, box-shadow .15s, background .15s;
    }
    .as-trigger:hover:not(:disabled) { border-color: var(--color-primary); }
    .as-trigger.as-open, .as-trigger:focus-visible {
      outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light);
    }
    .as-trigger:disabled { opacity: .55; cursor: not-allowed; background: var(--color-bg); }
    .as-placeholder .as-label { color: var(--color-text-muted); }
    .as-trigger-icon { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 10px; background: var(--color-primary-light); font-size: 1.05rem; }
    .as-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .as-chevron { flex: none; color: var(--color-text-muted); transition: transform .18s; }
    .as-open .as-chevron { transform: rotate(180deg); color: var(--color-primary); }

    .as-panel {
      position: fixed; z-index: 4000; display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box;
      border-radius: 16px; background: var(--color-surface); border: 1px solid var(--color-border);
      box-shadow: 0 30px 60px -20px rgba(23, 18, 16, .5), 0 0 0 4px color-mix(in srgb, var(--color-primary) 6%, transparent); animation: as-in .14s ease-out;
    }
    @keyframes as-in { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
    .as-search { position: relative; display: flex; align-items: center; padding: 10px 10px 6px; flex: none; }
    .as-search svg { position: absolute; left: 22px; color: var(--color-text-muted); pointer-events: none; }
    .as-search input {
      width: 100%; min-height: 40px; padding: 0 12px 0 36px; border: 1px solid var(--color-border); border-radius: 999px;
      background: var(--color-bg); color: var(--color-text); font: inherit; box-sizing: border-box;
    }
    .as-search input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
    .as-list { list-style: none; margin: 0; padding: 6px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
    .as-opt {
      display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 44px; padding: 6px 12px;
      border-radius: 12px; cursor: pointer; touch-action: manipulation;
    }
    .as-opt-text { display: flex; flex-direction: column; min-width: 0; }
    .as-opt-label { font-weight: 600; overflow-wrap: anywhere; }
    .as-opt-sub { color: var(--color-text-muted); font-size: .75rem; }
    .as-opt-empty { color: var(--color-text-muted); font-style: italic; }
    .as-active { background: var(--color-primary-light); }
    .as-selected { color: var(--color-primary); }
    .as-selected .as-opt-label { font-weight: 800; }
    .as-check { flex: none; color: var(--color-primary); }
    .as-opt-icon[data-tone], .as-trigger-icon[data-tone] { color: var(--ic); background: color-mix(in srgb, var(--ic) 14%, var(--color-surface)); border: 1px solid color-mix(in srgb, var(--ic) 30%, transparent); }
    [data-tone='a'] { --ic: #b7791f; }
    [data-tone='b'] { --ic: #2b6cb0; }
    [data-tone='c'] { --ic: #2f855a; }
    [data-tone='d'] { --ic: #b91c1c; }
    [data-tone='e'] { --ic: var(--color-primary); }
    .as-trigger.as-compact { min-height: 40px; padding: 0 10px 0 6px; gap: 8px; border-radius: 999px; box-shadow: inset 0 0 0 1px transparent; }
    .as-compact .as-trigger-icon { width: 28px; height: 28px; border-radius: 50%; }
    .as-compact .as-label { font-size: .86rem; }
    .as-compact .as-chevron { width: 16px; height: 16px; }
    .as-opt-icon-sym { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 700; font-size: .78rem !important; letter-spacing: 0; }
    .as-opt-icon svg, .as-trigger-icon svg { display: block; }
    .as-group { padding: 10px 12px 4px; font-size: .68rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--color-text-muted); }
    .as-opt-icon { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; background: var(--color-bg); font-size: 1.15rem; }
    .as-selected .as-opt-icon { background: var(--color-primary-light); }
    .as-opt:has(.as-opt-icon) { justify-content: flex-start; gap: 12px; }
    .as-opt:has(.as-opt-icon) .as-opt-text { flex: 1; }
    .as-grid .as-group { grid-column: 1 / -1; }
    .as-disabled { opacity: .38; cursor: not-allowed; text-decoration: line-through; }
    .as-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .as-grid .as-opt { justify-content: center; min-height: 44px; padding: 4px 6px; border: 1px solid var(--color-border); text-align: center; }
    .as-grid .as-opt-empty { grid-column: 1 / -1; border-style: dashed; }
    .as-grid .as-check { display: none; }
    .as-grid .as-selected { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
    .as-grid .as-selected .as-opt-label { font-weight: 800; }
    .as-grid .as-none { grid-column: 1 / -1; }
    .as-none { padding: 14px; text-align: center; color: var(--color-text-muted); }
    @media (prefers-reduced-motion: reduce) { .as-panel { animation: none; } .as-chevron { transition: none; } }
  `],
})
export class AppSelectComponent implements ControlValueAccessor {
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private cdr = inject(ChangeDetectorRef);
  private sanitizer = inject(DomSanitizer);

  /** Wraps trusted, hard-coded icon markup (never user input) into a 24x24 stroke svg. */
  svgHtml(inner: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>'
    );
  }

  readonly options = input<AppSelectOption[]>([]);
  readonly placeholder = input('');
  /** Adds a first row that sets the value back to `emptyValue`. */
  readonly clearable = input(false);
  readonly emptyValue = input<unknown>('');
  /** Force the search box on/off; by default it appears with more than 7 options. */
  readonly searchable = input<boolean | null>(null);
  readonly disabled = input(false);
  /** Compact grid of short labels (e.g. times) instead of a vertical list. */
  readonly grid = input(false);
  /** Smaller pill trigger for dense rows (e.g. per-item status in the order editor). */
  readonly compact = input(false);
  readonly changed = output<unknown>();

  @ViewChild('trigger') private triggerRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('searchBox') private searchRef?: ElementRef<HTMLInputElement>;
  @ViewChild('list') private listRef?: ElementRef<HTMLElement>;

  protected value = signal<unknown>(null);
  protected open = signal(false);
  protected query = signal('');
  protected activeIndex = signal(-1);
  protected panelTop = signal(0);
  protected panelLeft = signal(0);
  protected panelWidth = signal(240);
  protected panelMaxHeight = signal(320);
  private cvaDisabled = signal(false);

  private onChange: (v: unknown) => void = () => {};
  private onTouched: () => void = () => {};

  isDisabled = computed(() => this.disabled() || this.cvaDisabled());
  showSearch = computed(() => (this.searchable() ?? this.options().length > 7));
  filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.options();
    if (!q) return all;
    return all.filter((o) => (o.label + ' ' + (o.sub || '')).toLowerCase().includes(q));
  });
  hasValue = computed(() => {
    const v = this.value();
    return v !== null && v !== undefined && v !== '' && this.options().some((o) => o.value === v);
  });
  selectedSvg = computed(() => {
    const v = this.value();
    return this.hasValue() ? (this.options().find((o) => o.value === v)?.svg ?? '') : '';
  });
  selectedTone = computed(() => {
    const v = this.value();
    return this.hasValue() ? (this.options().find((o) => o.value === v)?.tone ?? null) : null;
  });
  selectedIcon = computed(() => {
    const v = this.value();
    return this.hasValue() ? (this.options().find((o) => o.value === v)?.icon ?? '') : '';
  });
  selectedLabel = computed(() => {
    const v = this.value();
    const found = this.options().find((o) => o.value === v);
    return found && this.hasValue() ? found.label : this.placeholder() || '';
  });

  writeValue(v: unknown): void {
    this.value.set(v);
    this.cdr.markForCheck();
  }
  registerOnChange(fn: (v: unknown) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void {
    this.cvaDisabled.set(d);
    this.cdr.markForCheck();
  }

  isSelected(opt: AppSelectOption): boolean {
    return opt.value === this.value();
  }

  toggle(): void {
    if (this.isDisabled()) return;
    this.open() ? this.close() : this.openPanel();
  }

  private openPanel(): void {
    const el = this.triggerRef?.nativeElement;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const openUp = below < 220 && above > below;
    const room = Math.max(160, Math.min(360, openUp ? above : below));
    this.panelWidth.set(Math.max(r.width, 220));
    this.panelLeft.set(Math.min(r.left, Math.max(8, window.innerWidth - Math.max(r.width, 220) - 8)));
    this.panelMaxHeight.set(room);
    // Opening upwards: anchor the panel's bottom edge to the trigger (estimate height from the option count).
    const est = Math.min(room, (this.showSearch() ? 60 : 12) + (this.options().length + (this.clearable() ? 1 : 0)) * 46);
    this.panelTop.set(openUp ? Math.max(8, r.top - est - 6) : r.bottom + 6);
    this.query.set('');
    const idx = this.options().findIndex((o) => o.value === this.value());
    this.activeIndex.set(idx);
    this.open.set(true);
    this.cdr.markForCheck();
    setTimeout(() => {
      if (this.showSearch()) this.searchRef?.nativeElement.focus();
      else this.listRef?.nativeElement.focus();
      this.scrollActiveIntoView();
    });
  }

  private close(focusTrigger = true): void {
    this.open.set(false);
    this.onTouched();
    if (focusTrigger) this.triggerRef?.nativeElement.focus();
    this.cdr.markForCheck();
  }

  choose(opt: AppSelectOption): void {
    this.value.set(opt.value);
    this.onChange(opt.value);
    this.changed.emit(opt.value);
    this.close();
  }

  clear(): void {
    const v = this.emptyValue();
    this.value.set(v);
    this.onChange(v);
    this.changed.emit(v);
    this.close();
  }

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.activeIndex.set(this.filtered().length ? 0 : -1);
  }

  onTriggerKey(event: KeyboardEvent): void {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key) && !this.open()) {
      event.preventDefault();
      this.openPanel();
    }
  }

  onPanelKey(event: KeyboardEvent): void {
    const n = this.filtered().length;
    const min = this.clearable() && !this.query() ? -1 : 0;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex.set(Math.min(n - 1, this.activeIndex() + 1));
      this.scrollActiveIntoView();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex.set(Math.max(min, this.activeIndex() - 1));
      this.scrollActiveIntoView();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const i = this.activeIndex();
      if (i === -1 && min === -1) this.clear();
      else if (this.filtered()[i] && !this.filtered()[i].disabled) this.choose(this.filtered()[i]);
    } else if (event.key === 'Tab') {
      this.close(false);
    }
  }

  private scrollActiveIntoView(): void {
    setTimeout(() => {
      this.listRef?.nativeElement.querySelector('.as-active')?.scrollIntoView({ block: 'nearest' });
    });
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentDown(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }

  @HostListener('window:resize')
  @HostListener('window:scroll')
  onViewportChange(): void {
    if (this.open()) this.close(false);
  }
}
