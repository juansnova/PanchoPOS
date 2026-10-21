/**
 * Purchase Order Detail Component
 *
 * View and receive goods for a purchase order.
 * Follows app design patterns.
 */

import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SidebarComponent } from '../../shared/sidebar.component';
import { FocusFirstInputDirective } from '../../shared/focus-first-input.directive';
import { InventoryService } from '../inventory.service';
import {
  PurchaseOrder,
  PurchaseOrderStatus,
  ReceiveGoodsInput,
  ReceivedItemInput,
  Warehouse,
  PurchaseOrderItem,
  inventoryUnitKey,
} from '../inventory.types';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  canCancelPurchaseOrder,
  canReceivePurchaseOrder,
  cancelPurchaseOrderViaStatusEndpoint,
  purchaseOrderActionLabelKey,
  purchaseOrderTransitionTargets,
} from './purchase-order-status.util';

@Component({
  selector: 'app-purchase-order-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, SidebarComponent, FocusFirstInputDirective, TranslateModule],
  template: `
    <app-sidebar>
      @if (loading()) {
        <div class="empty-state"><p>{{ 'INVENTORY.PURCHASE_ORDERS.LOADING_ORDER' | translate }}</p></div>
      } @else if (order()) {
        <div class="pd-hero" [attr.data-status]="order()!.status">
          <a routerLink="/inventory/purchase-orders" class="pd-back"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>{{ 'INVENTORY.PURCHASE_ORDERS.BACK' | translate }}</a>
          <div class="pd-hero-row">
            <div class="pd-hero-title">
              <h1>{{ order()!.order_number }}</h1>
              <span class="status-badge pd-pill" [class]="order()!.status">{{ 'INVENTORY.PURCHASE_ORDERS.STATUS_' + order()!.status.toUpperCase() | translate }}</span>
              <button type="button" class="pd-help" [attr.aria-expanded]="showStatusHelp()" [attr.aria-controls]="'po-detail-status-help-panel'"
                [attr.aria-label]="'INVENTORY.PURCHASE_ORDERS.STATUS_HELP_TOGGLE' | translate" [title]="'INVENTORY.PURCHASE_ORDERS.STATUS_HELP_TOGGLE' | translate" (click)="toggleStatusHelp()"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></button>
            </div>
            <div class="pd-actions">
              @for (target of transitionTargets(order()!.status); track target) {
                <button type="button" class="pd-btn pd-btn-main" [disabled]="statusUpdating()" (click)="transitionOrder(target)">
                  {{ purchaseOrderActionLabelKey(target) | translate }}
                </button>
              }
              @if (canReceive(order()!.status)) {
                <button class="pd-btn pd-btn-main" [disabled]="statusUpdating()" (click)="showReceiveModal.set(true)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3.3 7.5L12 12.5l8.7-5M12 22V12.5"/></svg>{{ 'INVENTORY.PURCHASE_ORDERS.RECEIVE_GOODS' | translate }}</button>
              }
              @if (canCancel(order()!.status)) {
                <button type="button" class="pd-btn pd-btn-danger" [disabled]="statusUpdating()" (click)="cancelOrder()">{{ 'INVENTORY.COMMON.CANCEL' | translate }}</button>
              }
            </div>
          </div>

          <ol class="po-steps pd-steps" [attr.data-cancelled]="order()!.status === 'cancelled'" aria-hidden="true">
            @for (st of pipeline; track st; let i = $index) {
              <li [class.done]="stepIndex(order()!.status) >= i" [class.current]="stepIndex(order()!.status) > i - 1 && stepIndex(order()!.status) < i + 1 && order()!.status !== 'cancelled'">
                <i></i><span>{{ 'INVENTORY.PURCHASE_ORDERS.STATUS_' + st.toUpperCase() | translate }}</span>
              </li>
            }
          </ol>
        </div>

        @if (showStatusHelp()) {
          <div id="po-detail-status-help-panel" class="pd-help-panel" role="region" [attr.aria-label]="'INVENTORY.PURCHASE_ORDERS.STATUS_HELP_TITLE' | translate">
            @for (status of statuses; track status) {
              <div class="pd-help-item">
                <span class="status-badge" [class]="status">{{ 'INVENTORY.PURCHASE_ORDERS.STATUS_' + status.toUpperCase() | translate }}</span>
                <p>{{ 'INVENTORY.PURCHASE_ORDERS.STATUS_HELP_' + status.toUpperCase() | translate }}</p>
              </div>
            }
          </div>
        }

        <div class="content">
          <div class="pd-cards">
            <div class="pd-card">
              <span class="pd-card-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span>
              <div><small>{{ 'INVENTORY.PURCHASE_ORDERS.ORDER_DATE' | translate }}</small><strong>{{ formatDate(order()!.order_date) }}</strong></div>
            </div>
            <div class="pd-card">
              <span class="pd-card-ico pd-ico-blue"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="6" width="15" height="11" rx="1"/><path d="M16 9h4l3 3v5h-7"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg></span>
              <div>
                <small>{{ 'INVENTORY.PURCHASE_ORDERS.EXPECTED_DELIVERY' | translate }}</small>
                <strong>{{ order()!.expected_date ? formatDate(order()!.expected_date!) : '-' }}</strong>
                @if (dueInfo(); as due) {
                  <em class="pd-due" [attr.data-tone]="due.tone">{{ due.text }}</em>
                }
              </div>
            </div>
            <div class="pd-card">
              <span class="pd-card-ico pd-ico-amber"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg></span>
              <div>
                <small>{{ 'INVENTORY.PURCHASE_ORDERS.RECEIVED' | translate }}</small>
                <strong>{{ receivedPercent() }}%</strong>
                <div class="pd-bar"><div [style.width.%]="receivedPercent()"></div></div>
              </div>
            </div>
            <div class="pd-card pd-card-main">
              <span class="pd-card-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M14.5 9a2.5 2.5 0 00-5 0c0 3.5 5 1.5 5 5a2.5 2.5 0 01-5 0M12 6v2M12 16v2"/></svg></span>
              <div><small>{{ 'INVENTORY.COMMON.TOTAL' | translate }}</small><strong>{{ formatCurrency(order()!.total_cents) }}</strong></div>
            </div>
          </div>

          <section class="pd-section">
            <h2>{{ 'INVENTORY.PURCHASE_ORDERS.LINE_ITEMS' | translate }} <span>{{ order()!.items?.length || 0 }}</span></h2>
            <div class="pd-lines">
              @for (item of order()!.items; track item.id) {
                <article class="pd-line" [class.pd-line-done]="item.quantity_received >= item.quantity_ordered">
                  <div class="pd-line-main">
                    <b>{{ item.inventory_item_name }}</b>
                    <small>{{ item.inventory_item_sku }}</small>
                  </div>
                  <div class="pd-line-qty">
                    <div class="pd-line-nums">
                      <strong>{{ item.quantity_received }}</strong>
                      <span>/ {{ item.quantity_ordered }} {{ unitLabel(item) }}</span>
                    </div>
                    <div class="pd-bar pd-bar-line"><div [style.width.%]="linePercent(item)"></div></div>
                    <small>
                      @if (item.quantity_received >= item.quantity_ordered) { {{ 'INVENTORY.PURCHASE_ORDERS.LINE_COMPLETE' | translate }} }
                      @else { {{ 'INVENTORY.PURCHASE_ORDERS.LINE_PENDING' | translate: { n: item.quantity_ordered - item.quantity_received } }} }
                    </small>
                  </div>
                  <div class="pd-line-money">
                    <small>{{ 'INVENTORY.PURCHASE_ORDERS.UNIT_COST' | translate }}</small>
                    <span>{{ formatCurrency(item.unit_cost_cents) }}</span>
                  </div>
                  <div class="pd-line-total">
                    <small>{{ 'INVENTORY.COMMON.TOTAL' | translate }}</small>
                    <strong>{{ formatCurrency(item.line_total_cents) }}</strong>
                  </div>
                </article>
              }
            </div>
          </section>

          @if (order()!.notes) {
            <section class="pd-notes">
              <span class="pd-notes-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h6"/></svg></span>
              <div>
                <h3>{{ 'INVENTORY.ITEMS.NOTES' | translate }}</h3>
                <p>{{ order()!.notes }}</p>
              </div>
            </section>
          }
        </div>

        <!-- Receive Goods Modal -->
        @if (showReceiveModal()) {
          <div class="modal-overlay">
            <div class="modal pr" (click)="$event.stopPropagation()" appFocusFirstInput>
              <div class="pr-head">
                <span class="pr-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3.3 7.5L12 12.5l8.7-5M12 22V12.5"/></svg></span>
                <div class="pr-head-text">
                  <h3>{{ 'INVENTORY.PURCHASE_ORDERS.RECEIVE_GOODS' | translate }}</h3>
                  <p>{{ order()!.order_number }}</p>
                </div>
                <button type="button" class="pr-close" (click)="showReceiveModal.set(false)" [attr.aria-label]="'INVENTORY.COMMON.CANCEL' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
              </div>
              <div class="pr-body">
                <p class="pr-hint">{{ 'INVENTORY.PURCHASE_ORDERS.RECEIVE_PARTIAL_HINT' | translate }}</p>
                <div class="pr-head-line">
                  <h4>{{ 'INVENTORY.PURCHASE_ORDERS.RECEIVE_NOW' | translate }}</h4>
                  <button type="button" class="pr-all" (click)="receiveAll()">{{ 'INVENTORY.PURCHASE_ORDERS.RECEIVE_ALL' | translate }}</button>
                </div>
                <div class="pr-items">
                  @for (item of order()!.items; track item.id; let i = $index) {
                    <div class="pr-item" [class.pr-item-full]="item.quantity_received >= item.quantity_ordered">
                      <div class="pr-item-info">
                        <b>{{ item.inventory_item_name }}</b>
                        <small>{{ 'INVENTORY.PURCHASE_ORDERS.ORDERED' | translate }} {{ item.quantity_ordered }} {{ unitLabel(item) }} · {{ 'INVENTORY.PURCHASE_ORDERS.ALREADY_RECEIVED' | translate }} {{ item.quantity_received }}</small>
                      </div>
                      <div class="pr-qty">
                        <button type="button" (click)="stepReceive(i, -1)" aria-label="-">−</button>
                        <input type="number" [(ngModel)]="receiveQuantities[i]" [name]="'recv_' + i" min="0" [max]="item.quantity_ordered - item.quantity_received" step="1" />
                        <button type="button" class="pr-qty-plus" (click)="stepReceive(i, 1)" aria-label="+">+</button>
                      </div>
                    </div>
                  }
                </div>

                <div class="pr-field">
                  <label for="receive_notes">{{ 'INVENTORY.ITEMS.NOTES' | translate }}</label>
                  <input type="text" id="receive_notes" name="receive_notes" [(ngModel)]="receiveNotes" [placeholder]="'INVENTORY.ITEMS.NOTES_PLACEHOLDER' | translate" />
                </div>
              </div>
              <div class="pr-foot">
                <button class="pr-btn pr-btn-ghost" (click)="showReceiveModal.set(false)">{{ 'INVENTORY.COMMON.CANCEL' | translate }}</button>
                <button class="pr-btn pr-btn-main" (click)="submitReceive()" [disabled]="receiving()">
                  {{ receiving() ? ('INVENTORY.COMMON.PROCESSING' | translate) : ('INVENTORY.PURCHASE_ORDERS.CONFIRM_RECEIPT' | translate) }}
                </button>
              </div>
            </div>
          </div>
        }
      }
    </app-sidebar>
  `,
  styleUrl: './purchase-order-detail.component.scss'
})
export class PurchaseOrderDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private inventoryService = inject(InventoryService);
  private translate = inject(TranslateService);

  order = signal<PurchaseOrder | null>(null);
  warehouses = signal<Warehouse[]>([]);
  loading = signal(true);
  showReceiveModal = signal(false);
  showStatusHelp = signal(false);
  receiving = signal(false);
  statusUpdating = signal(false);

  readonly statuses: PurchaseOrderStatus[] = [
    'draft',
    'submitted',
    'approved',
    'partially_received',
    'received',
    'cancelled',
  ];

  readonly transitionTargets = purchaseOrderTransitionTargets;
  readonly purchaseOrderActionLabelKey = purchaseOrderActionLabelKey;
  readonly canReceive = canReceivePurchaseOrder;
  readonly canCancel = canCancelPurchaseOrder;

  /** Happy path drawn under the title (same as the list cards). */
  readonly pipeline: PurchaseOrderStatus[] = ['draft', 'submitted', 'approved', 'received'];

  stepIndex(status: PurchaseOrderStatus): number {
    const map: Record<string, number> = { draft: 0, submitted: 1, approved: 2, partially_received: 2.5, received: 3 };
    return map[status] ?? -1;
  }

  /** Overall % of ordered quantity already received (line by line, capped at 100). */
  receivedPercent(): number {
    const items = this.order()?.items ?? [];
    const ordered = items.reduce((sum, i) => sum + (i.quantity_ordered || 0), 0);
    if (!ordered) return 0;
    const got = items.reduce((sum, i) => sum + Math.min(i.quantity_received || 0, i.quantity_ordered || 0), 0);
    return Math.round((got / ordered) * 100);
  }

  linePercent(item: PurchaseOrderItem): number {
    if (!item.quantity_ordered) return 0;
    return Math.min(100, Math.round(((item.quantity_received || 0) / item.quantity_ordered) * 100));
  }

  unitLabel(item: PurchaseOrderItem): string {
    return this.translate.instant(inventoryUnitKey(item.unit));
  }

  /** "Llega en 3 d" / "Atrasada 2 d" while the goods have not arrived. */
  dueInfo(): { text: string; tone: 'ok' | 'soon' | 'late' } | null {
    const po = this.order();
    if (!po?.expected_date || po.status === 'received' || po.status === 'cancelled') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(po.expected_date);
    if (!m) return null;
    const due = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    const now = new Date();
    const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const days = Math.round((due - t0) / 86400000);
    if (days < 0) return { text: this.translate.instant('INVENTORY.PURCHASE_ORDERS.DUE_LATE_SHORT', { n: -days }), tone: 'late' };
    if (days === 0) return { text: this.translate.instant('INVENTORY.PURCHASE_ORDERS.DUE_TODAY'), tone: 'soon' };
    return { text: this.translate.instant('INVENTORY.PURCHASE_ORDERS.DUE_IN_SHORT', { n: days }), tone: days <= 2 ? 'soon' : 'ok' };
  }

  /** Fill every line with what is still missing. */
  receiveAll(): void {
    this.receiveQuantities = (this.order()?.items ?? []).map((i) => Math.max(0, i.quantity_ordered - i.quantity_received));
  }

  stepReceive(index: number, dir: 1 | -1): void {
    const item = this.order()?.items?.[index];
    if (!item) return;
    const max = Math.max(0, item.quantity_ordered - item.quantity_received);
    const cur = Math.round(Number(this.receiveQuantities[index]) || 0);
    this.receiveQuantities[index] = Math.min(max, Math.max(0, cur + dir));
  }

  receiveQuantities: number[] = [];
  receiveNotes = '';
  receiveWarehouseId: number | null = null;

  ngOnInit() {
    const id = +this.route.snapshot.paramMap.get('id')!;
    this.loadWarehouses();
    this.loadOrder(id, this.route.snapshot.queryParamMap.get('receive') === '1');
  }

  toggleStatusHelp() {
    this.showStatusHelp.update((open) => !open);
  }

  loadWarehouses() {
    this.inventoryService.getWarehouses().subscribe({
      next: warehouses => {
        this.warehouses.set(warehouses);
        if (this.receiveWarehouseId == null) {
          const def = warehouses.find(w => w.is_default) || warehouses[0];
          this.receiveWarehouseId = def?.id ?? null;
        }
      },
      error: () => { }
    });
  }

  loadOrder(id: number, openReceive = false) {
    this.loading.set(true);
    this.inventoryService.getPurchaseOrder(id).subscribe({
      next: order => {
        this.order.set(order);
        this.receiveQuantities = order.items?.map(i => i.quantity_ordered - i.quantity_received) || [];
        this.loading.set(false);
        if (openReceive && canReceivePurchaseOrder(order.status)) {
          this.showReceiveModal.set(true);
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { receive: null },
            queryParamsHandling: 'merge',
            replaceUrl: true,
          });
        }
      },
      error: () => this.loading.set(false)
    });
  }

  transitionOrder(newStatus: PurchaseOrderStatus) {
    const order = this.order();
    if (!order) return;
    this.statusUpdating.set(true);
    this.inventoryService.updatePurchaseOrderStatus(order.id, newStatus).subscribe({
      next: () => {
        this.statusUpdating.set(false);
        this.loadOrder(order.id);
      },
      error: () => {
        this.statusUpdating.set(false);
        alert(this.translate.instant('INVENTORY.PURCHASE_ORDERS.STATUS_UPDATE_ERROR'));
      },
    });
  }

  cancelOrder() {
    const order = this.order();
    if (!order) return;
    if (!confirm(this.translate.instant('INVENTORY.PURCHASE_ORDERS.CANCEL_CONFIRM', { orderNumber: order.order_number }))) return;
    this.statusUpdating.set(true);
    const done = () => {
      this.statusUpdating.set(false);
      this.loadOrder(order.id);
    };
    const failed = () => {
      this.statusUpdating.set(false);
      alert(this.translate.instant('INVENTORY.PURCHASE_ORDERS.STATUS_UPDATE_ERROR'));
    };
    if (cancelPurchaseOrderViaStatusEndpoint(order.status)) {
      this.inventoryService.updatePurchaseOrderStatus(order.id, 'cancelled').subscribe({ next: done, error: failed });
    } else {
      this.inventoryService.cancelPurchaseOrder(order.id).subscribe({ next: done, error: failed });
    }
  }

  submitReceive() {
    const order = this.order();
    if (!order?.items) return;

    const items: ReceivedItemInput[] = order.items
      .map((item, i) => ({ purchase_order_item_id: item.id, quantity_received: this.receiveQuantities[i] || 0 }))
      .filter(r => r.quantity_received > 0);

    if (items.length === 0) {
      alert(this.translate.instant('INVENTORY.PURCHASE_ORDERS.ENTER_QUANTITY_ERROR'));
      return;
    }

    this.receiving.set(true);
    const input: ReceiveGoodsInput = {
      items,
      notes: this.receiveNotes || undefined,
      warehouse_id: this.receiveWarehouseId || undefined,
    };

    this.inventoryService.receivePurchaseOrder(order.id, input).subscribe({
      next: () => { this.receiving.set(false); this.showReceiveModal.set(false); this.loadOrder(order.id); },
      error: () => this.receiving.set(false)
    });
  }

  formatDate(dateStr: string): string {
    // Date-only strings (e.g. "2026-09-28") must be read as local dates, not UTC midnight —
    // otherwise timezones behind UTC (like Colombia) show the previous day.
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      return new Date(+year, +month - 1, +day).toLocaleDateString();
    }
    return new Date(dateStr).toLocaleDateString();
  }
  formatCurrency(cents: number): string { return this.inventoryService.formatCurrency(cents); }
  formatStatus(status: string): string { return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
}