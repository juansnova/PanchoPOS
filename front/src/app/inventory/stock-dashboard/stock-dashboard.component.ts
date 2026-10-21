/**
 * Stock Dashboard Component
 *
 * Overview of inventory with low-stock alerts.
 * Follows app design patterns.
 */

import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SidebarComponent } from '../../shared/sidebar.component';
import { InventoryService } from '../inventory.service';
import { StockLevel, LowStockItem, InventoryCategory, Warehouse, WasteReport, CostAlert, CostHistory, inventoryUnitKey, inventoryCategoryKey } from '../inventory.types';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-stock-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent, TranslateModule],
  template: `
    <app-sidebar>
      <div class="sk-hero">
        <div class="sk-hero-text">
          <h1>{{ 'INVENTORY.DASHBOARD.TITLE' | translate }}</h1>
          <p>{{ totalItems() }} {{ 'INVENTORY.ITEMS.TOTAL_ITEMS' | translate }}</p>
        </div>
        <button class="sk-refresh" (click)="loadData()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>{{ 'INVENTORY.COMMON.REFRESH' | translate }}</button>
      </div>

      <div class="content">
        <div class="sk-kpis">
          <div class="sk-kpi"><span class="sk-kpi-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg></span><div><b>{{ totalItems() }}</b><small>{{ 'INVENTORY.ITEMS.TOTAL_ITEMS' | translate }}</small></div></div>
          <div class="sk-kpi" [class.sk-kpi-warn]="lowStockCount() > 0" [class.sk-kpi-good]="lowStockCount() === 0">
            <span class="sk-kpi-ico">@if (lowStockCount() > 0) { <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01"/></svg> } @else { <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.1V12a10 10 0 11-5.9-9.1M22 4L12 14l-3-3"/></svg> }</span>
            <div><b>{{ lowStockCount() }}</b><small>{{ 'INVENTORY.DASHBOARD.LOW_STOCK_ALERTS' | translate }}</small></div>
          </div>
          <div class="sk-kpi sk-kpi-main"><span class="sk-kpi-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M14.5 9a2.5 2.5 0 00-5 0c0 3.5 5 1.5 5 5a2.5 2.5 0 01-5 0M12 6v2M12 16v2"/></svg></span><div><b>{{ formatCurrency(totalValue()) }}</b><small>{{ 'INVENTORY.ITEMS.TOTAL_VALUE' | translate }}</small></div></div>
        </div>

        <div class="sk-insights">
          <section class="sk-ins sk-ins-waste">
            <h2>🗑️ {{ 'INVENTORY.DASHBOARD.WASTE_TITLE' | translate }}</h2>
            @if (waste(); as w) {
              @if (w.events === 0) {
                <p class="sk-ins-empty">{{ 'INVENTORY.DASHBOARD.WASTE_EMPTY' | translate }}</p>
              } @else {
                <div class="sk-ins-big">{{ formatCurrency(w.total_cost_cents) }}<small>{{ w.events }} {{ 'INVENTORY.DASHBOARD.WASTE_EVENTS' | translate }}</small></div>
                <ul class="sk-ins-list">
                  @for (r of w.by_reason; track r.reason) {
                    <li><span>{{ reasonLabel(r.reason) | translate }}</span><b>{{ formatCurrency(r.cost_cents) }}</b></li>
                  }
                </ul>
                @if (w.by_item.length > 0) {
                  <p class="sk-ins-sub">{{ w.by_item[0].name }} · {{ formatCurrency(w.by_item[0].cost_cents) }}</p>
                }
              }
              <p class="sk-ins-hint">{{ 'INVENTORY.DASHBOARD.WASTE_HINT' | translate }}</p>
            }
          </section>

          @if (costAlerts().length > 0) {
            <section class="sk-ins sk-ins-price">
              <h2>📈 {{ 'INVENTORY.DASHBOARD.PRICE_TITLE' | translate }}</h2>
              <p class="sk-ins-hint">{{ 'INVENTORY.DASHBOARD.PRICE_HINT' | translate }}</p>
              <ul class="sk-ins-list">
                @for (a of costAlerts(); track a.item_id) {
                  <li>
                    <button type="button" class="sk-ins-link" (click)="openHistory(a.item_id)">{{ a.name }}</button>
                    <span class="sk-up">▲ {{ a.change_pct }}%</span>
                  </li>
                }
              </ul>
            </section>
          }
        </div>

        @if (lowStockItems().length > 0) {
          <section class="sk-section">
            <h2><span class="sk-dot"></span>{{ 'INVENTORY.DASHBOARD.LOW_STOCK_ALERTS' | translate }} <em>{{ lowStockItems().length }}</em></h2>
            <div class="sk-alerts">
              @for (item of lowStockItems(); track item.id) {
                <article class="sk-alert">
                  <div class="sk-alert-top">
                    <div><b>{{ item.name }}</b><small>{{ item.sku }}</small></div>
                    <span class="sk-chip-low">{{ 'INVENTORY.ITEMS.STATUS_LOW_STOCK' | translate }}</span>
                  </div>
                  <div class="sk-meter"><div [style.width.%]="meterPct(item.current_quantity, item.reorder_level)"></div></div>
                  <div class="sk-alert-nums">
                    <div><small>{{ 'INVENTORY.ITEMS.CURRENT' | translate }}</small><strong class="neg">{{ item.current_quantity.toFixed(2) }}</strong></div>
                    <div><small>{{ 'INVENTORY.ITEMS.REORDER' | translate }}</small><strong>{{ item.reorder_level.toFixed(2) }}</strong></div>
                    <div><small>{{ 'INVENTORY.DASHBOARD.SUGGEST' | translate }}</small><strong class="pri">{{ item.suggested_order_quantity.toFixed(2) }}</strong></div>
                  </div>
                  <a routerLink="/inventory/purchase-orders" class="sk-cta">{{ 'INVENTORY.DASHBOARD.CREATE_PO' | translate }}</a>
                </article>
              }
            </div>
          </section>
        }

        <section class="sk-section">
          <div class="sk-bar">
            <h2><span class="sk-dot sk-dot-ok"></span>{{ 'INVENTORY.DASHBOARD.STOCK_LEVELS' | translate }}</h2>
          </div>
          <div class="sk-chips" role="tablist">
            <button type="button" class="sk-chip" [class.on]="!categoryFilter" (click)="setCategory('')">{{ 'INVENTORY.ITEMS.ALL_CATEGORIES' | translate }} <i>{{ stockLevels().length }}</i></button>
            @for (cat of categories; track cat) {
              @if (categoryCount(cat) > 0) {
                <button type="button" class="sk-chip" [class.on]="categoryFilter === cat" (click)="setCategory(cat)">{{ categoryKey(cat) | translate }} <i>{{ categoryCount(cat) }}</i></button>
              }
            }
          </div>

          @if (loading()) {
            <div class="sk-empty"><p>{{ 'INVENTORY.DASHBOARD.LOADING' | translate }}</p></div>
          } @else if (filteredStockLevels().length === 0) {
            <div class="sk-empty">
              <span class="sk-empty-ico"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg></span>
              <h3>{{ 'INVENTORY.ITEMS.NO_ITEMS_YET' | translate }}</h3>
              <p>{{ 'INVENTORY.ITEMS.NO_ITEMS_DESC' | translate }}</p>
              <a routerLink="/inventory/items" class="sk-cta">{{ 'INVENTORY.DASHBOARD.GO_TO_ITEMS' | translate }}</a>
            </div>
          } @else {
            <div class="sk-list">
              @for (item of filteredStockLevels(); track item.id) {
                <article class="sk-row" [class.sk-row-low]="item.is_low_stock">
                  <div class="sk-row-name"><b>{{ item.name }}</b><small>{{ item.sku }} · {{ categoryKey(item.category) | translate }}</small></div>
                  <div class="sk-row-stock">
                    <div class="sk-row-qty"><strong [class.neg]="item.current_quantity < 0">{{ item.current_quantity.toFixed(2) }}</strong><span>{{ unitKey(item.unit) | translate }}</span></div>
                    <div class="sk-meter" [class.sk-meter-ok]="!item.is_low_stock"><div [style.width.%]="meterPct(item.current_quantity, item.reorder_level)"></div></div>
                    <small>{{ 'INVENTORY.ITEMS.REORDER_LEVEL' | translate }}: {{ item.reorder_level.toFixed(2) }}</small>
                  </div>
                  <div class="sk-row-val"><small>{{ 'INVENTORY.ITEMS.VALUE' | translate }}</small><strong>{{ formatCurrency(item.total_value_cents) }}</strong></div>
                  @if (item.is_low_stock) {
                    <span class="sk-tag sk-tag-low">{{ 'INVENTORY.ITEMS.STATUS_LOW_STOCK' | translate }}</span>
                  } @else {
                    <span class="sk-tag sk-tag-ok">{{ 'INVENTORY.ITEMS.STATUS_OK' | translate }}</span>
                  }
                </article>
              }
            </div>
          }
        </section>
      </div>
      @if (history(); as h) {
        <div class="modal-overlay" (click)="history.set(null)">
          <div class="modal sk-hist" (click)="$event.stopPropagation()">
            <div class="sk-hist-head">
              <div><h3>{{ h.name }}</h3><p>{{ 'INVENTORY.DASHBOARD.PRICE_HISTORY' | translate }}</p></div>
              <button type="button" class="sk-hist-x" (click)="history.set(null)" [attr.aria-label]="'INVENTORY.DASHBOARD.CLOSE' | translate">×</button>
            </div>
            @if (h.points.length === 0) {
              <p class="sk-ins-empty">{{ 'INVENTORY.DASHBOARD.PRICE_NO_HISTORY' | translate }}</p>
            } @else {
              <ol class="sk-hist-list">
                @for (pt of h.points; track pt.received_at; let i = $index) {
                  <li [class.first]="i === 0">
                    <div><b>{{ formatCurrency(pt.unit_cost_cents) }}</b><small>{{ 'INVENTORY.DASHBOARD.PRICE_PER' | translate }} {{ unitKey(h.unit) | translate }}</small></div>
                    <span>{{ shortDate(pt.received_at) }}</span>
                    @if (pt.change_pct !== null) {
                      <em [class.up]="pt.change_pct > 0" [class.down]="pt.change_pct < 0">{{ pt.change_pct > 0 ? '▲' : pt.change_pct < 0 ? '▼' : '=' }} {{ pt.change_pct > 0 ? '+' : '' }}{{ pt.change_pct }}%</em>
                    }
                  </li>
                }
              </ol>
            }
          </div>
        </div>
      }
    </app-sidebar>
  `,
  styleUrl: './stock-dashboard.component.scss'
})
export class StockDashboardComponent implements OnInit {
  private inventoryService = inject(InventoryService);

  stockLevels = signal<StockLevel[]>([]);
  lowStockItems = signal<LowStockItem[]>([]);
  warehouses = signal<Warehouse[]>([]);
  loading = signal(true);
  categoryFilter = '';
  warehouseFilter = '';

  categories: InventoryCategory[] = ['ingredients', 'beverages', 'packaging', 'cleaning', 'equipment', 'other'];

  readonly unitKey = inventoryUnitKey;
  readonly categoryKey = inventoryCategoryKey;

  filteredStockLevels = computed(() => {
    let result = this.stockLevels();
    if (this.categoryFilter) {
      result = result.filter(i => i.category === this.categoryFilter);
    }
    return result;
  });

  totalItems = computed(() => this.stockLevels().length);
  lowStockCount = computed(() => this.lowStockItems().length);
  totalValue = computed(() => this.stockLevels().reduce((sum, i) => sum + i.total_value_cents, 0));

  ngOnInit() {
    this.inventoryService.getWarehouses().subscribe({
      next: warehouses => this.warehouses.set(warehouses),
      error: () => { }
    });
    this.loadData();
  }

  waste = signal<WasteReport | null>(null);
  costAlerts = signal<CostAlert[]>([]);
  history = signal<CostHistory | null>(null);

  reasonLabel(reason: string): string {
    const map: Record<string, string> = {
      spoiled: 'INVENTORY.ITEMS.REASON_SPOILED',
      expired: 'INVENTORY.ITEMS.REASON_EXPIRED',
      broken: 'INVENTORY.ITEMS.REASON_BROKEN',
      theft: 'INVENTORY.ITEMS.REASON_THEFT',
    };
    return map[reason] ?? 'INVENTORY.ITEMS.REASON_OTHER';
  }

  openHistory(itemId: number) {
    this.inventoryService.getCostHistory(itemId).subscribe({ next: (h) => this.history.set(h), error: () => {} });
  }

  shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  private loadInsights() {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const from = `${now.getFullYear()}-${p(now.getMonth() + 1)}-01`;
    const to = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    this.inventoryService.getWasteReport(from, to).subscribe({ next: (w) => this.waste.set(w), error: () => {} });
    this.inventoryService.getCostAlerts().subscribe({ next: (a) => this.costAlerts.set(a), error: () => {} });
  }

  loadData() {
    this.loadInsights();
    this.loading.set(true);
    const warehouseId = this.warehouseFilter ? Number(this.warehouseFilter) : null;
    this.inventoryService.getStockLevels({ warehouseId }).subscribe({
      next: levels => { this.stockLevels.set(levels); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
    this.inventoryService.getLowStockItems().subscribe({
      next: items => this.lowStockItems.set(items),
      error: () => { }
    });
  }

  setCategory(cat: string) {
    this.categoryFilter = cat;
    this.applyFilter();
  }

  categoryCount(cat: string): number {
    return this.stockLevels().filter((i) => i.category === cat).length;
  }

  /** Fill of the stock meter: reorder level sits at 50 %, full bar = twice the level. */
  meterPct(current: number, reorder: number): number {
    if (current <= 0) return 3;
    if (!reorder || reorder <= 0) return 100;
    return Math.max(3, Math.min(100, Math.round((current / (reorder * 2)) * 100)));
  }

  applyFilter() {
    this.stockLevels.update(levels => [...levels]);
  }

  formatCurrency(cents: number): string {
    return this.inventoryService.formatCurrency(cents);
  }
}