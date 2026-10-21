/**
 * Cash close: end-of-day count of the register against what the system says was sold.
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SidebarComponent } from '../shared/sidebar.component';
import { AppDatePickerComponent } from '../shared/app-date-picker.component';
import { ApiService } from '../services/api.service';
import { formatMoneyCents } from '../shared/currency-symbol';

interface CashSummary {
  business_date: string;
  orders_count: number;
  expected_cash_cents: number;
  expected_card_cents: number;
  expected_transfer_cents: number;
  expected_other_cents: number;
  total_cents: number;
  tips_cents: number;
  existing_close: CashCloseRow | null;
}

interface CashCloseRow {
  id: number;
  business_date: string;
  orders_count: number;
  expected_cash_cents: number;
  expected_card_cents: number;
  expected_transfer_cents: number;
  expected_other_cents: number;
  tips_cents: number;
  opening_float_cents: number;
  counted_cash_cents: number;
  difference_cents: number;
  note: string | null;
  closed_at: string | null;
}

const ICON: Record<string, string> = {
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  transfer: '<path d="M7 7h13l-3-3M17 17H4l3 3"/>',
  other: '<circle cx="12" cy="12" r="9"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
};

@Component({
  selector: 'app-cash-close',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, SidebarComponent, AppDatePickerComponent],
  template: `
    <app-sidebar>
      <div class="cc-hero">
        <div>
          <h1>{{ 'CASH_CLOSE.TITLE' | translate }}</h1>
          <p>{{ 'CASH_CLOSE.SUBTITLE' | translate }}</p>
        </div>
        <div class="cc-date">
          <label>{{ 'CASH_CLOSE.DATE' | translate }}</label>
          <app-date-picker [ngModel]="date()" (ngModelChange)="onDate($event)" />
        </div>
      </div>

      <div class="content">
        @if (loading() || !summary()) {
          <div class="cc-empty">{{ 'CASH_CLOSE.LOADING' | translate }}</div>
        } @else {
          <div class="cc-total">
            <div>
              <small>{{ 'CASH_CLOSE.TOTAL_SOLD' | translate }}</small>
              <b>{{ money(summary()!.total_cents) }}</b>
            </div>
            <span>{{ summary()!.orders_count }} {{ 'CASH_CLOSE.ORDERS' | translate }}</span>
          </div>

          <div class="cc-methods">
            @for (m of methods(); track m.key) {
              <div class="cc-method" [attr.data-k]="m.key">
                <span class="cc-ico" [innerHTML]="m.svg" aria-hidden="true"></span>
                <div>
                  <small>{{ m.label | translate }}</small>
                  <strong>{{ money(m.cents) }}</strong>
                </div>
              </div>
            }
          </div>
          @if (summary()!.tips_cents > 0) {
            <p class="cc-tips">{{ 'CASH_CLOSE.TIPS' | translate }}: {{ money(summary()!.tips_cents) }}</p>
          }

          <section class="cc-count">
            <h2>{{ 'CASH_CLOSE.COUNT_TITLE' | translate }}</h2>
            <div class="cc-fields">
              <div class="cc-field">
                <label>{{ 'CASH_CLOSE.OPENING_FLOAT' | translate }}</label>
                <div class="cc-money"><span>$</span><input type="text" inputmode="numeric" autocomplete="off" [ngModel]="thousands(floatUnits())" (ngModelChange)="floatUnits.set(parse($event))" /></div>
              </div>
              <div class="cc-field">
                <label>{{ 'CASH_CLOSE.COUNTED' | translate }}</label>
                <div class="cc-money cc-money-big"><span>$</span><input type="text" inputmode="numeric" autocomplete="off" [ngModel]="thousands(countedUnits())" (ngModelChange)="countedUnits.set(parse($event))" /></div>
              </div>
            </div>

            <div class="cc-result" [attr.data-state]="state()">
              <div>
                <small>{{ 'CASH_CLOSE.EXPECTED_DRAWER' | translate }}</small>
                <strong>{{ money(expectedDrawer()) }}</strong>
              </div>
              <div class="cc-diff">
                <small>{{ 'CASH_CLOSE.DIFFERENCE' | translate }}</small>
                <strong>{{ diffLabel(diff()) }}</strong>
              </div>
            </div>

            <div class="cc-field">
              <label>{{ 'CASH_CLOSE.NOTE' | translate }}</label>
              <input type="text" class="cc-note" maxlength="500" [(ngModel)]="note" [placeholder]="'CASH_CLOSE.NOTE_PLACEHOLDER' | translate" />
            </div>

            @if (summary()!.existing_close) {
              <p class="cc-already">{{ 'CASH_CLOSE.ALREADY' | translate }}</p>
            }
            @if (message()) {
              <p class="cc-msg" [class.err]="isError()">{{ message() }}</p>
            }
            <button type="button" class="cc-btn" [disabled]="saving()" (click)="save()">
              {{ saving() ? ('CASH_CLOSE.CLOSING' | translate) : ('CASH_CLOSE.CLOSE' | translate) }}
            </button>
          </section>
        }

        <section class="cc-history">
          <h2>{{ 'CASH_CLOSE.HISTORY' | translate }}</h2>
          @if (history().length === 0) {
            <div class="cc-empty">{{ 'CASH_CLOSE.HISTORY_EMPTY' | translate }}</div>
          } @else {
            <div class="cc-hist-list">
              @for (h of history(); track h.id) {
                <article class="cc-hist" [attr.data-state]="stateOf(h.difference_cents)">
                  <div class="cc-hist-date">
                    <b>{{ h.business_date }}</b>
                    <small>{{ h.orders_count }} {{ 'CASH_CLOSE.ORDERS' | translate }}</small>
                  </div>
                  <div><small>{{ 'CASH_CLOSE.SOLD' | translate }}</small><strong>{{ money(soldOf(h)) }}</strong></div>
                  <div><small>{{ 'CASH_CLOSE.COUNTED' | translate }}</small><strong>{{ money(h.counted_cash_cents) }}</strong></div>
                  <span class="cc-pill">{{ diffLabel(h.difference_cents) }}</span>
                </article>
              }
            </div>
          }
        </section>
      </div>
    </app-sidebar>
  `,
  styleUrl: './cash-close.component.scss',
})
export class CashCloseComponent implements OnInit {
  private api = inject(ApiService);
  private translate = inject(TranslateService);
  private sanitizer = inject(DomSanitizer);

  private icon(key: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[key]}</svg>`
    );
  }

  date = signal(this.today());
  summary = signal<CashSummary | null>(null);
  history = signal<CashCloseRow[]>([]);
  loading = signal(true);
  saving = signal(false);
  message = signal('');
  isError = signal(false);
  floatUnits = signal(0);
  countedUnits = signal(0);
  note = '';

  methods = computed(() => {
    const s = this.summary();
    if (!s) return [];
    return [
      { key: 'cash', label: 'CASH_CLOSE.CASH', cents: s.expected_cash_cents, svg: this.icon('cash') },
      { key: 'card', label: 'CASH_CLOSE.CARD', cents: s.expected_card_cents, svg: this.icon('card') },
      { key: 'transfer', label: 'CASH_CLOSE.TRANSFER', cents: s.expected_transfer_cents, svg: this.icon('transfer') },
      ...(s.expected_other_cents > 0
        ? [{ key: 'other', label: 'CASH_CLOSE.OTHER', cents: s.expected_other_cents, svg: this.icon('other') }]
        : []),
    ];
  });

  expectedDrawer = computed(() => this.floatUnits() * 100 + (this.summary()?.expected_cash_cents ?? 0));
  diff = computed(() => this.countedUnits() * 100 - this.expectedDrawer());
  state = computed(() => this.stateOf(this.diff()));

  ngOnInit() {
    this.load();
    this.loadHistory();
  }

  private today(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  stateOf(diff: number): 'ok' | 'over' | 'short' {
    return diff === 0 ? 'ok' : diff > 0 ? 'over' : 'short';
  }

  diffLabel(diff: number): string {
    if (diff === 0) return this.translate.instant('CASH_CLOSE.BALANCED') + ' ✓';
    const key = diff > 0 ? 'CASH_CLOSE.OVER' : 'CASH_CLOSE.SHORT';
    return `${this.translate.instant(key)} ${this.money(Math.abs(diff))}`;
  }

  soldOf(h: CashCloseRow): number {
    return h.expected_cash_cents + h.expected_card_cents + h.expected_transfer_cents + h.expected_other_cents;
  }

  money(cents: number): string {
    return formatMoneyCents(cents);
  }

  parse(v: string): number {
    const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  }

  thousands(n: number): string {
    return n ? n.toLocaleString('es-CO') : '';
  }

  onDate(v: string | null) {
    if (!v) return;
    this.date.set(v);
    this.message.set('');
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api.getCashCloseSummary(this.date()).subscribe({
      next: (s: CashSummary) => {
        this.summary.set(s);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  loadHistory() {
    this.api.listCashCloses().subscribe({ next: (rows) => this.history.set(rows), error: () => {} });
  }

  save() {
    this.saving.set(true);
    this.message.set('');
    this.api
      .createCashClose({
        business_date: this.date(),
        counted_cash_cents: this.countedUnits() * 100,
        opening_float_cents: this.floatUnits() * 100,
        note: this.note || null,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.isError.set(false);
          this.message.set(this.translate.instant('CASH_CLOSE.SAVED'));
          this.note = '';
          this.load();
          this.loadHistory();
        },
        error: () => {
          this.saving.set(false);
          this.isError.set(true);
          this.message.set(this.translate.instant('CASH_CLOSE.ERROR'));
        },
      });
  }
}
