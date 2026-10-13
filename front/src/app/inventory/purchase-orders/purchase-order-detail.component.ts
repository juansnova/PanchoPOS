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
        <div class="page-header">
          <div>
            <a routerLink="/inventory/purchase-orders" class="back-link">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              {{ 'INVENTORY.PURCHASE_ORDERS.BACK' | translate }}
            </a>
            <h1>{{ order()!.order_number }}</h1>
          </div>
          <div class="header-actions">
            @for (target of transitionTargets(order()!.status); track target) {
              <button
                type="button"
                class="btn btn-secondary"
                [disabled]="statusUpdating()"
                (click)="transitionOrder(target)"
              >
                {{ purchaseOrderActionLabelKey(target) | translate }}
              </button>
            }
            @if (canReceive(order()!.status)) {
              <button class="btn btn-primary" [disabled]="statusUpdating()" (click)="showReceiveModal.set(true)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="22 2 13.5 11 9 8"/>
                  <path d="M22 2L15 22l-4-9-9-4z"/>
                </svg>
                {{ 'INVENTORY.PURCHASE_ORDERS.RECEIVE_GOODS' | translate }}
              </button>
            }
            @if (canCancel(order()!.status)) {
              <button type="button" class="btn btn-secondary btn-danger-outline" [disabled]="statusUpdating()" (click)="cancelOrder()">
                {{ 'INVENTORY.COMMON.CANCEL' | translate }}
              </button>
            }
          </div>
        </div>

        <div class="status-help-bar">
          <button
            type="button"
            class="icon-btn status-help-toggle"
            [attr.aria-expanded]="showStatusHelp()"
            [attr.aria-controls]="'po-detail-status-help-panel'"
            [attr.aria-label]="'INVENTORY.PURCHASE_ORDERS.STATUS_HELP_TOGGLE' | translate"
            (click)="toggleStatusHelp()"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4M12 8h.01"/>
            </svg>
          </button>
          @if (showStatusHelp()) {
            <div id="po-detail-status-help-panel" class="status-help-panel" role="region" [attr.aria-label]="'INVENTORY.PURCHASE_ORDERS.STATUS_HELP_TITLE' | translate">
              @for (status of statuses; track status) {
                <div class="status-help-item">
                  <span class="status-badge" [class]="status">
                    {{ 'INVENTORY.PURCHASE_ORDERS.STATUS_' + status.toUpperCase() | translate }}
                  </span>
                  <p>{{ 'INVENTORY.PURCHASE_ORDERS.STATUS_HELP_' + status.toUpperCase() | translate }}</p>
                </div>
              }
            </div>
          }
        </div>

        <div class="content">
          <!-- Order Info Cards -->
          <div class="info-row">
            <div class="info-card">
              <span class="info-label">{{ 'INVENTORY.PURCHASE_ORDERS.ORDER_DATE' | translate }}</span>
              <span class="info-value">{{ formatDate(order()!.order_date) }}</span>
            </div>
            <div class="info-card">
              <span class="info-label">{{ 'INVENTORY.PURCHASE_ORDERS.EXPECTED_DELIVERY' | translate }}</span>
              <span class="info-value">{{ order()!.expected_date ? formatDate(order()!.expected_date!) : '-' }}</span>
            </div>
            <div class="info-card">
              <span class="info-label">{{ 'INVENTORY.COMMON.TOTAL' | translate }}</span>
              <span class="info-value price">{{ formatCurrency(order()!.total_cents) }}</span>
            </div>
            <div class="info-card">
              <span class="info-label">{{ 'INVENTORY.ITEMS.STATUS' | translate }}</span>
              <span class="status-badge" [class]="order()!.status">{{ 'INVENTORY.PURCHASE_ORDERS.STATUS_' + order()!.status.toUpperCase() | translate }}</span>
            </div>
          </div>

          <!-- Line Items -->
          <div class="section">
            <h2>{{ 'INVENTORY.PURCHASE_ORDERS.LINE_ITEMS' | translate }}</h2>
            <div class="table-card">
              <table>
                <thead>
                  <tr>
                    <th>{{ 'INVENTORY.ITEMS.NAME' | translate }}</th>
                    <th>{{ 'INVENTORY.PURCHASE_ORDERS.ORDERED' | translate }}</th>
                    <th>{{ 'INVENTORY.PURCHASE_ORDERS.RECEIVED' | translate }}</th>
                    <th>{{ 'INVENTORY.PURCHASE_ORDERS.UNIT_COST' | translate }}</th>
                    <th>{{ 'INVENTORY.COMMON.TOTAL' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of order()!.items; track item.id) {
                    <tr>
                      <td>
                        <strong>{{ item.inventory_item_name }}</strong>
                        <small class="text-muted">{{ item.inventory_item_sku }}</small>
                      </td>
                      <td>{{ item.quantity_ordered }} {{ item.unit }}</td>
                      <td>
                        <span [class.complete]="item.quantity_received >= item.quantity_ordered">
                          {{ item.quantity_received }}
                        </span>
                      </td>
                      <td>{{ formatCurrency(item.unit_cost_cents) }}</td>
                      <td class="price">{{ formatCurrency(item.line_total_cents) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          @if (order()!.notes) {
            <div class="notes-section">
              <h3>{{ 'INVENTORY.ITEMS.NOTES' | translate }}</h3>
              <p>{{ order()!.notes }}</p>
            </div>
          }
        </div>

        <!-- Receive Goods Modal -->
        @if (showReceiveModal()) {
          <div class="modal-overlay">
            <div class="modal modal-lg" (click)="$event.stopPropagation()" appFocusFirstInput>
              <div class="form-header">
                <h3>{{ 'INVENTORY.PURCHASE_ORDERS.RECEIVE_GOODS' | translate }}</h3>
                <button class="icon-btn" (click)="showReceiveModal.set(false)">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
              <p class="field-hint receive-partial-hint">{{ 'INVENTORY.PURCHASE_ORDERS.RECEIVE_PARTIAL_HINT' | translate }}</p>
              <div class="form-group">
                <label for="receive_warehouse">{{ 'INVENTORY.WAREHOUSES.WAREHOUSE' | translate }}</label>
                <select id="receive_warehouse" [(ngModel)]="receiveWarehouseId">
                  @for (wh of warehouses(); track wh.id) {
                    <option [ngValue]="wh.id">
                      {{ wh.name }}@if (wh.is_default) { ({{ 'INVENTORY.WAREHOUSES.DEFAULT_BADGE' | translate }})}
                    </option>
                  }
                </select>
              </div>
              <div class="receive-table-wrapper">
                <table class="receive-table">
                  <thead>
                    <tr>
                      <th>{{ 'INVENTORY.ITEMS.NAME' | translate }}</th>
                      <th>{{ 'INVENTORY.PURCHASE_ORDERS.ORDERED' | translate }}</th>
                      <th>{{ 'INVENTORY.PURCHASE_ORDERS.ALREADY_RECEIVED' | translate }}</th>
                      <th>{{ 'INVENTORY.PURCHASE_ORDERS.RECEIVE_NOW' | translate }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (item of order()!.items; track item.id; let i = $index) {
                      <tr>
                        <td>{{ item.inventory_item_name }}</td>
                        <td>{{ item.quantity_ordered }}</td>
                        <td>{{ item.quantity_received }}</td>
                        <td>
                          <input
                            type="number"
                            [(ngModel)]="receiveQuantities[i]"
                            min="0"
                            [max]="item.quantity_ordered - item.quantity_received"
                            step="1"
                          />
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <div class="form-group">
                <label for="receive_notes">{{ 'INVENTORY.ITEMS.NOTES' | translate }}</label>
                <input type="text" id="receive_notes" [(ngModel)]="receiveNotes" [placeholder]="'INVENTORY.ITEMS.NOTES_PLACEHOLDER' | translate" />
              </div>
              <div class="form-actions">
                <button class="btn btn-secondary" (click)="showReceiveModal.set(false)">{{ 'INVENTORY.COMMON.CANCEL' | translate }}</button>
                <button class="btn btn-primary" (click)="submitReceive()" [disabled]="receiving()">
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