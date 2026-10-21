/**
 * Inventory Reports Component
 *
 * FIFO valuation (who holds the money) and the latest stock movements.
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { SidebarComponent } from '../../shared/sidebar.component';
import { InventoryService } from '../inventory.service';
import { InventoryValuation, InventoryTransaction, inventoryUnitKey } from '../inventory.types';
import { TranslateModule } from '@ngx-translate/core';

type MoveFilter = 'all' | 'in' | 'out' | 'waste';

const IN_TYPES = ['purchase', 'adjustment_add', 'transfer_in'];
const OUT_TYPES = ['sale', 'adjustment_subtract', 'transfer_out'];

/** Small line icon per movement type. */
const MOVE_ICON: Record<string, string> = {
  purchase: '<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3.3 7.5L12 12.5l8.7-5M12 22V12.5"/>',
  sale: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 11.4a2 2 0 002 1.6h8.3a2 2 0 002-1.5L22 7H6"/>',
  adjustment_add: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  adjustment_subtract: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  waste: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6"/>',
  transfer_in: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  transfer_out: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
};

@Component({
  selector: 'app-inventory-reports',
  standalone: true,
  imports: [CommonModule, SidebarComponent, TranslateModule],
  template: `
    <app-sidebar>
      <div class="ir-hero">
        <div>
          <h1>{{ 'INVENTORY.REPORTS.TITLE' | translate }}</h1>
          @if (valuation()) {
            <p>{{ 'INVENTORY.REPORTS.AS_OF' | translate: { date: formatDateTime(valuation()!.as_of_date) } }}</p>
          }
        </div>
        <button class="ir-refresh" (click)="loadData()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
          </svg>
          {{ 'INVENTORY.COMMON.REFRESH' | translate }}
        </button>
      </div>

      <div class="content">
        <section class="ir-sec">
          <h2><span class="ir-dot"></span>{{ 'INVENTORY.REPORTS.FIFO_VALUATION' | translate }}</h2>

          @if (loadingValuation()) {
            <div class="ir-empty">{{ 'INVENTORY.REPORTS.LOADING_VALUATION' | translate }}</div>
          } @else if (valuation()) {
            <div class="ir-kpis">
              <div class="ir-kpi ir-kpi-main">
                <small>{{ 'INVENTORY.ITEMS.TOTAL_VALUE' | translate }}</small>
                <b>{{ formatCurrency(valuation()!.total_value_cents) }}</b>
              </div>
              <div class="ir-kpi">
                <small>{{ 'INVENTORY.ITEMS.TOTAL_ITEMS' | translate }}</small>
                <b>{{ valuation()!.items.length }}</b>
              </div>
              @if (topItem(); as top) {
                <div class="ir-kpi">
                  <small>{{ 'INVENTORY.REPORTS.TOP_VALUE' | translate }}</small>
                  <b class="ir-kpi-name">{{ top.name }}</b>
                  <em>{{ share(top.fifo_value_cents) }}%</em>
                </div>
              }
            </div>

            <div class="ir-values">
              @for (item of rankedItems(); track item.inventory_item_id; let i = $index) {
                <article class="ir-value">
                  <span class="ir-rank" [attr.data-r]="i < 3 ? i + 1 : 0">{{ i + 1 }}</span>
                  <div class="ir-value-main">
                    <div class="ir-value-top">
                      <b>{{ item.name }}</b>
                      <strong>{{ formatCurrency(item.fifo_value_cents) }}</strong>
                    </div>
                    <div class="ir-bar"><div [style.width.%]="barWidth(item.fifo_value_cents)"></div></div>
                    <small>{{ item.sku }} · {{ item.quantity.toFixed(2) }} {{ unitKey(item.unit) | translate }} · {{ share(item.fifo_value_cents) }}%</small>
                  </div>
                </article>
              }
            </div>
          }
        </section>

        <section class="ir-sec">
          <h2><span class="ir-dot ir-dot-blue"></span>{{ 'INVENTORY.REPORTS.RECENT_TRANSACTIONS' | translate }}</h2>

          <div class="ir-chips">
            @for (f of filters; track f.key) {
              <button type="button" class="ir-chip" [class.on]="moveFilter() === f.key" (click)="moveFilter.set(f.key)">
                {{ f.label | translate }} <i>{{ countFor(f.key) }}</i>
              </button>
            }
          </div>

          @if (loadingTransactions()) {
            <div class="ir-empty">{{ 'INVENTORY.REPORTS.LOADING_TRANSACTIONS' | translate }}</div>
          } @else if (visibleMoves().length === 0) {
            <div class="ir-empty">{{ 'INVENTORY.REPORTS.NO_TRANSACTIONS' | translate }}</div>
          } @else {
            <div class="ir-moves">
              @for (txn of visibleMoves(); track txn.id) {
                <article class="ir-move" [attr.data-kind]="kindOf(txn.transaction_type)">
                  <span class="ir-move-ico" [innerHTML]="iconHtml(txn.transaction_type)" aria-hidden="true"></span>
                  <div class="ir-move-main">
                    <b>{{ txn.inventory_item_name }}</b>
                    <small>{{ 'INVENTORY.TRANSACTION_TYPES.' + txn.transaction_type | translate }} · {{ formatDateTime(txn.created_at) }}</small>
                    @if (txn.notes) {
                      <em>{{ txn.notes }}</em>
                    }
                  </div>
                  <div class="ir-move-qty">
                    <strong [class.pos]="txn.quantity > 0" [class.neg]="txn.quantity < 0">{{ txn.quantity > 0 ? '+' : '' }}{{ txn.quantity.toFixed(2) }}</strong>
                    <small>{{ 'INVENTORY.REPORTS.BALANCE' | translate }}: {{ txn.balance_after.toFixed(2) }}</small>
                  </div>
                  <div class="ir-move-cost">
                    @if (txn.total_cost_cents) {
                      <strong>{{ formatCurrency(txn.total_cost_cents) }}</strong>
                    } @else {
                      <span>-</span>
                    }
                  </div>
                </article>
              }
            </div>
          }
        </section>
      </div>
    </app-sidebar>
  `,
  styleUrl: './inventory-reports.component.scss'
})
export class InventoryReportsComponent implements OnInit {
  private inventoryService = inject(InventoryService);
  private sanitizer = inject(DomSanitizer);

  valuation = signal<InventoryValuation | null>(null);
  transactions = signal<InventoryTransaction[]>([]);
  loadingValuation = signal(true);
  loadingTransactions = signal(true);
  moveFilter = signal<MoveFilter>('all');

  readonly unitKey = inventoryUnitKey;
  readonly filters: { key: MoveFilter; label: string }[] = [
    { key: 'all', label: 'INVENTORY.REPORTS.FILTER_ALL' },
    { key: 'in', label: 'INVENTORY.REPORTS.FILTER_IN' },
    { key: 'out', label: 'INVENTORY.REPORTS.FILTER_OUT' },
    { key: 'waste', label: 'INVENTORY.REPORTS.FILTER_WASTE' },
  ];

  /** Items sorted by the money they hold, biggest first. */
  rankedItems = computed(() =>
    [...(this.valuation()?.items ?? [])].sort((a, b) => b.fifo_value_cents - a.fifo_value_cents)
  );
  topItem = computed(() => this.rankedItems()[0] ?? null);

  visibleMoves = computed(() => {
    const f = this.moveFilter();
    return this.transactions().filter((t) => this.matches(t.transaction_type, f));
  });

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.loadingValuation.set(true);
    this.loadingTransactions.set(true);

    this.inventoryService.getInventoryValuation().subscribe({
      next: val => { this.valuation.set(val); this.loadingValuation.set(false); },
      error: () => this.loadingValuation.set(false)
    });

    this.inventoryService.getTransactions({ limit: 50 }).subscribe({
      next: txns => { this.transactions.set(txns); this.loadingTransactions.set(false); },
      error: () => this.loadingTransactions.set(false)
    });
  }

  private matches(type: string, f: MoveFilter): boolean {
    if (f === 'all') return true;
    if (f === 'waste') return type === 'waste';
    return (f === 'in' ? IN_TYPES : OUT_TYPES).includes(type);
  }

  countFor(f: MoveFilter): number {
    return this.transactions().filter((t) => this.matches(t.transaction_type, f)).length;
  }

  kindOf(type: string): 'in' | 'out' | 'waste' {
    return type === 'waste' ? 'waste' : IN_TYPES.includes(type) ? 'in' : 'out';
  }

  iconHtml(type: string): SafeHtml {
    const d = MOVE_ICON[type] ?? MOVE_ICON['adjustment_add'];
    return this.sanitizer.bypassSecurityTrustHtml(
      `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
    );
  }

  barWidth(cents: number): number {
    const max = this.topItem()?.fifo_value_cents || 0;
    return max ? Math.max(2, Math.round((cents / max) * 100)) : 0;
  }

  share(cents: number): number {
    const total = this.valuation()?.total_value_cents || 0;
    return total ? Math.round((cents / total) * 100) : 0;
  }

  formatCurrency(cents: number): string {
    return this.inventoryService.formatCurrency(cents);
  }

  formatDateTime(dateStr: string): string {
    return new Date(dateStr).toLocaleString();
  }
}
