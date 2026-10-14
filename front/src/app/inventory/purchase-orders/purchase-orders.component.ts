/**
 * Purchase Orders Component
 *
 * List and manage purchase orders with create modal and PDF export.
 * Follows app design patterns.
 */

import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormArray } from '@angular/forms';
import { SidebarComponent } from '../../shared/sidebar.component';
import { FocusFirstInputDirective } from '../../shared/focus-first-input.directive';
import { InventoryService } from '../inventory.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseOrderCreate,
  InventoryItem,
  UnitOfMeasure,
  inventoryUnitKey,
} from '../inventory.types';
import {
  canCancelPurchaseOrder,
  cancelPurchaseOrderViaStatusEndpoint,
  purchaseOrderActionLabelKey,
  purchaseOrderTransitionTargets,
  canReceivePurchaseOrder,
} from './purchase-order-status.util';

@Component({
  selector: 'app-purchase-orders',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    SidebarComponent,
    FocusFirstInputDirective,
    TranslateModule,
  ],
  template: `
    <app-sidebar>
      <div class="page-header">
        <h1>{{ 'INVENTORY.PURCHASE_ORDERS.TITLE' | translate }}</h1>
        <div class="header-actions">
          <button class="btn btn-primary" (click)="openCreateModal()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {{ 'INVENTORY.PURCHASE_ORDERS.CREATE_PO' | translate }}
          </button>
        </div>
      </div>

      <div class="content">
        <!-- Filters -->
        <div class="filters-bar">
          <select [(ngModel)]="statusFilter" (change)="loadOrders()">
            <option value="">{{ 'INVENTORY.PURCHASE_ORDERS.ALL_STATUSES' | translate }}</option>
            @for (status of statuses; track status) {
              <option [value]="status">{{ 'INVENTORY.PURCHASE_ORDERS.STATUS_' + status.toUpperCase() | translate }}</option>
            }
          </select>
        </div>

        <div class="status-help-bar">
          <button
            type="button"
            class="icon-btn status-help-toggle"
            [attr.aria-expanded]="showStatusHelp()"
            [attr.aria-controls]="'po-status-help-panel'"
            [attr.aria-label]="'INVENTORY.PURCHASE_ORDERS.STATUS_HELP_TOGGLE' | translate"
            (click)="toggleStatusHelp()"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4M12 8h.01"/>
            </svg>
          </button>
          @if (showStatusHelp()) {
            <div id="po-status-help-panel" class="status-help-panel" role="region" [attr.aria-label]="'INVENTORY.PURCHASE_ORDERS.STATUS_HELP_TITLE' | translate">
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

        @if (loading()) {
          <div class="empty-state"><p>{{ 'INVENTORY.PURCHASE_ORDERS.LOADING' | translate }}</p></div>
        } @else if (orders().length === 0) {
          <div class="empty-state">
            <div class="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
              </svg>
            </div>
            <h3>{{ 'INVENTORY.PURCHASE_ORDERS.NO_ORDERS' | translate }}</h3>
            <p>{{ 'INVENTORY.PURCHASE_ORDERS.NO_ORDERS_DESC' | translate }}</p>
            <button class="btn btn-primary" (click)="openCreateModal()">{{ 'INVENTORY.PURCHASE_ORDERS.CREATE_PO' | translate }}</button>
          </div>
        } @else {
          <div class="table-card">
            <table>
              <thead>
                <tr>
                  <th>{{ 'INVENTORY.PURCHASE_ORDERS.ORDER_NUMBER' | translate }}</th>
                  <th>{{ 'INVENTORY.REPORTS.DATE' | translate }}</th>
                  <th>{{ 'INVENTORY.PURCHASE_ORDERS.EXPECTED_DELIVERY' | translate }}</th>
                  <th>{{ 'INVENTORY.COMMON.TOTAL' | translate }}</th>
                  <th>{{ 'INVENTORY.ITEMS.STATUS' | translate }}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (po of orders(); track po.id) {
                  <tr>
                    <td><strong>{{ po.order_number }}</strong></td>
                    <td>{{ formatDate(po.order_date) }}</td>
                    <td>{{ po.expected_date ? formatDate(po.expected_date) : '-' }}</td>
                    <td class="price">{{ formatCurrency(po.total_cents) }}</td>
                    <td>
                      <span class="status-badge" [class]="po.status">
                        {{ 'INVENTORY.PURCHASE_ORDERS.STATUS_' + po.status.toUpperCase() | translate }}
                      </span>
                    </td>
                    <td class="actions">
                      @for (target of transitionTargets(po.status); track target) {
                        <button
                          type="button"
                          class="btn btn-secondary btn-sm po-row-action"
                          [disabled]="statusUpdatingId() === po.id"
                          (click)="transitionOrder(po, target)"
                        >
                          {{ purchaseOrderActionLabelKey(target) | translate }}
                        </button>
                      }
                      @if (canReceive(po.status)) {
                        <a
                          [routerLink]="['/inventory/purchase-orders', po.id]"
                          [queryParams]="{ receive: '1' }"
                          class="btn btn-primary btn-sm po-row-action"
                        >
                          {{ 'INVENTORY.PURCHASE_ORDERS.RECEIVE_GOODS' | translate }}
                        </a>
                      }
                      <button class="icon-btn" [title]="'INVENTORY.PURCHASE_ORDERS.PRINT_PDF' | translate" (click)="downloadPdf(po)">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="6 9 6 2 18 2 18 9"/>
                          <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
                          <rect x="6" y="14" width="12" height="8"/>
                        </svg>
                      </button>
                      <a [routerLink]="['/inventory/purchase-orders', po.id]" class="icon-btn" [title]="'INVENTORY.COMMON.VIEW' | translate">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      </a>
                      @if (canCancel(po.status)) {
                        <button
                          class="icon-btn icon-btn-danger"
                          [title]="'INVENTORY.COMMON.CANCEL' | translate"
                          [disabled]="statusUpdatingId() === po.id"
                          (click)="cancelOrder(po)"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                          </svg>
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <!-- Create PO Modal -->
      @if (showCreateModal()) {
        <div class="modal-overlay">
          <div class="modal modal-lg" (click)="$event.stopPropagation()" appFocusFirstInput>
            <div class="form-header">
              <h3>{{ 'INVENTORY.PURCHASE_ORDERS.CREATE_TITLE' | translate }}</h3>
              <button class="icon-btn" (click)="closeModal()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <form [formGroup]="createForm" (ngSubmit)="submitCreateForm()">
              <div class="form-row">
                <div class="form-group">
                  <label for="expected_date">{{ 'INVENTORY.PURCHASE_ORDERS.EXPECTED_DELIVERY' | translate }}</label>
                  <input type="date" id="expected_date" formControlName="expected_date" />
                </div>
              </div>
              <div class="form-group">
                <label for="notes">{{ 'INVENTORY.ITEMS.NOTES' | translate }}</label>
                <textarea id="notes" formControlName="notes" rows="2" [placeholder]="'INVENTORY.PURCHASE_ORDERS.NOTES_PLACEHOLDER' | translate"></textarea>
              </div>

              <!-- Items Section -->
              <div class="items-section">
                <div class="section-header">
                  <h4>{{ 'INVENTORY.PURCHASE_ORDERS.ORDER_ITEMS' | translate }}</h4>
                  <button type="button" class="btn btn-secondary btn-sm" (click)="addItem()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    {{ 'INVENTORY.ITEMS.ADD_ITEM' | translate }}
                  </button>
                </div>

                @if (itemsArray.length === 0) {
                  <div class="empty-items">
                    <p>{{ 'INVENTORY.PURCHASE_ORDERS.NO_ITEMS' | translate }}</p>
                  </div>
                } @else {
                  <div class="items-list" formArrayName="items">
                    @for (item of itemsArray.controls; track $index; let i = $index) {
                      <div class="item-row" [formGroupName]="i">
                        <div class="item-select">
                          <label>{{ 'INVENTORY.ITEMS.NAME' | translate }}</label>
                          <select formControlName="inventory_item_id" (change)="onItemSelected(i)">
                            <option value="">-- {{ 'COMMON.SELECT' | translate }} --</option>
                            @for (invItem of filteredInventoryItems(); track invItem.id) {
                              <option [value]="invItem.id">{{ invItem.name }} ({{ invItem.sku }})</option>
                            }
                          </select>
                        </div>
                        <div class="item-qty">
                          <label>{{ 'INVENTORY.ITEMS.QUANTITY' | translate }}</label>
                          <input type="number" formControlName="quantity_ordered" min="1" step="1" />
                        </div>
                        <div class="item-unit">
                          <label>{{ 'INVENTORY.ITEMS.UNIT' | translate }}</label>
                          <select formControlName="unit">
                            @for (unit of units; track unit) {
                              <option [value]="unit">{{ unitKey(unit) | translate }}</option>
                            }
                          </select>
                        </div>
                        <div class="item-cost">
                          <label>{{ 'INVENTORY.PURCHASE_ORDERS.UNIT_COST' | translate }}</label>
                          <input type="text" inputmode="numeric" [value]="formatThousands(item.get('unit_cost_dollars')?.value)" (input)="onUnitCostInput(i, $event)" placeholder="0" />
                        </div>
                        <div class="item-total">
                          <label>{{ 'INVENTORY.COMMON.TOTAL' | translate }}</label>
                          <span>{{ formatCurrency(getItemTotal(i)) }}</span>
                        </div>
                        <button type="button" class="icon-btn icon-btn-danger" (click)="removeItem(i)">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                          </svg>
                        </button>
                      </div>
                    }
                  </div>
                }

                <div class="order-total">
                  <span>{{ 'INVENTORY.PURCHASE_ORDERS.ORDER_TOTAL' | translate }}</span>
                  <strong>{{ formatCurrency(orderTotal()) }}</strong>
                </div>
              </div>

              <div class="form-actions">
                <button type="button" class="btn btn-secondary" (click)="closeModal()">{{ 'INVENTORY.COMMON.CANCEL' | translate }}</button>
                <button type="submit" class="btn btn-primary" [disabled]="!createForm.valid || itemsArray.length === 0 || saving()">
                  {{ saving() ? ('INVENTORY.COMMON.SAVING' | translate) : ('INVENTORY.PURCHASE_ORDERS.CREATE_TITLE' | translate) }}
                </button>
              </div>
            </form>
          </div>
        </div>
      }
    </app-sidebar>
  `,
  styleUrl: './purchase-orders.component.scss'
})
export class PurchaseOrdersComponent implements OnInit {
  private inventoryService = inject(InventoryService);
  private fb = inject(FormBuilder);
  private translate = inject(TranslateService);

  orders = signal<PurchaseOrder[]>([]);
  inventoryItems = signal<InventoryItem[]>([]);
  loading = signal(true);
  saving = signal(false);
  showCreateModal = signal(false);
  showStatusHelp = signal(false);
  statusUpdatingId = signal<number | null>(null);

  readonly transitionTargets = purchaseOrderTransitionTargets;
  readonly purchaseOrderActionLabelKey = purchaseOrderActionLabelKey;
  readonly canReceive = canReceivePurchaseOrder;
  readonly canCancel = canCancelPurchaseOrder;

  statusFilter = '';

  statuses: PurchaseOrderStatus[] = ['draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled'];
  units: UnitOfMeasure[] = ['piece', 'gram', 'kilogram', 'ounce', 'pound', 'milliliter', 'centiliter', 'liter', 'fluid_ounce', 'cup', 'gallon'];

  readonly unitKey = inventoryUnitKey;

  createForm: FormGroup = this.fb.group({
    expected_date: [''],
    notes: [''],
    items: this.fb.array([]),
  });

  get itemsArray(): FormArray {
    return this.createForm.get('items') as FormArray;
  }

  /** Re-run footer total when reactive form values change (computed alone does not track FormControl edits). */
  private readonly createFormValues = toSignal(
    this.createForm.valueChanges.pipe(startWith(this.createForm.getRawValue())),
    { initialValue: this.createForm.getRawValue() },
  );

  orderTotal = computed(() => {
    this.createFormValues();
    let total = 0;
    for (let i = 0; i < this.itemsArray.length; i++) {
      total += this.getItemTotal(i);
    }
    return total;
  });

  filteredInventoryItems = computed(() => this.inventoryItems());

  ngOnInit() {
    this.loadOrders();
    this.loadInventoryItems();
  }

  loadOrders() {
    this.loading.set(true);
    const options: { status?: PurchaseOrderStatus } = {};
    if (this.statusFilter) options.status = this.statusFilter as PurchaseOrderStatus;

    this.inventoryService.getPurchaseOrders(options).subscribe({
      next: orders => { this.orders.set(orders); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  loadInventoryItems() {
    this.inventoryService.getItems({ activeOnly: false }).subscribe({
      next: items => {
        this.inventoryItems.set(items);
      },
      error: (err) => console.error('Failed to load inventory items:', err)
    });
  }

  toggleStatusHelp() {
    this.showStatusHelp.update((open) => !open);
  }

  openCreateModal() {
    this.createForm.reset();
    this.itemsArray.clear();
    this.showCreateModal.set(true);
  }

  closeModal() {
    this.showCreateModal.set(false);
  }

  addItem() {
    const itemGroup = this.fb.group({
      inventory_item_id: ['', Validators.required],
      quantity_ordered: [1, [Validators.required, Validators.min(1)]],
      unit: ['piece', Validators.required],
      unit_cost_dollars: [0, [Validators.required, Validators.min(0)]],
    });
    this.itemsArray.push(itemGroup);
  }

  removeItem(index: number) {
    this.itemsArray.removeAt(index);
  }

  onItemSelected(index: number) {
    const itemId = this.itemsArray.at(index).get('inventory_item_id')?.value;
    if (itemId) {
      const invItem = this.inventoryItems().find(i => i.id === +itemId);
      if (invItem) {
        this.itemsArray.at(index).patchValue({
          unit: invItem.unit || 'piece',
          unit_cost_dollars: (invItem.average_cost_cents || 0) / 100,
        });
      }
    }
  }

  /** Formats a whole-peso amount with thousands separators (e.g. 15000 -> "15.000"). */
  formatThousands(value: number | string | null | undefined): string {
    const n = Math.round(Number(value) || 0);
    return n === 0 ? '' : n.toLocaleString('es-CO');
  }

  onUnitCostInput(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '');
    const n = digits ? parseInt(digits, 10) : 0;
    this.itemsArray.at(index).get('unit_cost_dollars')?.setValue(n);
    input.value = this.formatThousands(n);
  }

  getItemTotal(index: number): number {
    const itemCtrl = this.itemsArray.at(index);
    const qty = itemCtrl.get('quantity_ordered')?.value || 0;
    const costDollars = itemCtrl.get('unit_cost_dollars')?.value || 0;
    return Math.round(qty * costDollars * 100); // Return in cents
  }

  submitCreateForm() {
    if (!this.createForm.valid || this.itemsArray.length === 0) return;
    this.saving.set(true);

    const formValue = this.createForm.value;
    const poCreate: PurchaseOrderCreate = {
      expected_date: formValue.expected_date || null,
      notes: formValue.notes || null,
      items: formValue.items.map((item: any) => ({
        inventory_item_id: +item.inventory_item_id,
        quantity_ordered: Math.round(+item.quantity_ordered),
        unit: item.unit as UnitOfMeasure,
        unit_cost_cents: Math.round(+item.unit_cost_dollars * 100), // Convert to cents (kept for internal precision; input is now integer-only)
      })),
    };

    this.inventoryService.createPurchaseOrder(poCreate).subscribe({
      next: () => {
        this.saving.set(false);
        this.closeModal();
        this.loadOrders();
      },
      error: () => this.saving.set(false)
    });
  }

  transitionOrder(po: PurchaseOrder, newStatus: PurchaseOrderStatus) {
    this.statusUpdatingId.set(po.id);
    this.inventoryService.updatePurchaseOrderStatus(po.id, newStatus).subscribe({
      next: () => {
        this.statusUpdatingId.set(null);
        this.loadOrders();
      },
      error: () => {
        this.statusUpdatingId.set(null);
        alert(this.translate.instant('INVENTORY.PURCHASE_ORDERS.STATUS_UPDATE_ERROR'));
      },
    });
  }

  cancelOrder(po: PurchaseOrder) {
    if (!confirm(this.translate.instant('INVENTORY.PURCHASE_ORDERS.CANCEL_CONFIRM', { orderNumber: po.order_number }))) return;
    this.statusUpdatingId.set(po.id);
    const done = () => {
      this.statusUpdatingId.set(null);
      this.loadOrders();
    };
    const failed = () => {
      this.statusUpdatingId.set(null);
      alert(this.translate.instant('INVENTORY.PURCHASE_ORDERS.STATUS_UPDATE_ERROR'));
    };
    if (cancelPurchaseOrderViaStatusEndpoint(po.status)) {
      this.inventoryService.updatePurchaseOrderStatus(po.id, 'cancelled').subscribe({ next: done, error: failed });
    } else {
      this.inventoryService.cancelPurchaseOrder(po.id).subscribe({ next: done, error: failed });
    }
  }

  downloadPdf(po: PurchaseOrder) {
    this.inventoryService.getPurchaseOrderPdf(po.id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `PO-${po.order_number}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      },
      error: () => alert(this.translate.instant('INVENTORY.PURCHASE_ORDERS.PDF_ERROR'))
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

  formatCurrency(cents: number): string {
    return this.inventoryService.formatCurrency(cents);
  }
}