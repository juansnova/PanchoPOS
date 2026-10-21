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
import { AppSelectComponent, AppSelectOption } from '../../shared/app-select.component';
import { AppDatePickerComponent } from '../../shared/app-date-picker.component';
import { unitSelectOptions } from '../unit-select-options';
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
    AppSelectComponent,
    AppDatePickerComponent,
  ],
  template: `
    <app-sidebar>
      <div class="page-header po-header">
        <div class="po-title">
          <h1>{{ 'INVENTORY.PURCHASE_ORDERS.TITLE' | translate }}</h1>
          <p>{{ 'INVENTORY.PURCHASE_ORDERS.SUBTITLE' | translate }}</p>
        </div>
        <button class="po-new" (click)="openCreateModal()"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>{{ 'INVENTORY.PURCHASE_ORDERS.CREATE_PO' | translate }}</button>
      </div>

      <div class="content">
        <div class="po-kpis">
          <div class="po-kpi"><span class="po-kpi-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h6"/></svg></span><div><strong>{{ poStats().total }}</strong><small>{{ 'INVENTORY.PURCHASE_ORDERS.KPI_TOTAL' | translate }}</small></div></div>
          <div class="po-kpi"><span class="po-kpi-ico po-ico-blue"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span><div><strong>{{ poStats().open }}</strong><small>{{ 'INVENTORY.PURCHASE_ORDERS.KPI_OPEN' | translate }}</small></div></div>
          <div class="po-kpi"><span class="po-kpi-ico po-ico-amber"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="6" width="15" height="11" rx="1"/><path d="M16 9h4l3 3v5h-7"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg></span><div><strong>{{ formatCurrency(poStats().toReceiveCents) }}</strong><small>{{ 'INVENTORY.PURCHASE_ORDERS.KPI_TO_RECEIVE' | translate }}</small></div></div>
          <div class="po-kpi po-kpi-main"><span class="po-kpi-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg></span><div><strong>{{ formatCurrency(poStats().receivedCents) }}</strong><small>{{ 'INVENTORY.PURCHASE_ORDERS.KPI_RECEIVED' | translate }}</small></div></div>
        </div>

        <div class="po-filters">
          <div class="po-chips" role="group" [attr.aria-label]="'INVENTORY.ITEMS.STATUS' | translate">
            <button type="button" class="po-chip" [class.on]="statusSel() === ''" (click)="setStatus('')">
              {{ 'INVENTORY.PURCHASE_ORDERS.ALL_STATUSES' | translate }} <span>{{ orders().length }}</span>
            </button>
            @for (status of statuses; track status) {
              <button type="button" class="po-chip" [attr.data-status]="status" [class.on]="statusSel() === status" (click)="setStatus(status)">
                <i></i>{{ 'INVENTORY.PURCHASE_ORDERS.STATUS_' + status.toUpperCase() | translate }} <span>{{ countByStatus(status) }}</span>
              </button>
            }
          </div>
          <button type="button" class="po-help-btn" [attr.aria-expanded]="showStatusHelp()" [attr.aria-controls]="'po-status-help-panel'"
            [attr.aria-label]="'INVENTORY.PURCHASE_ORDERS.STATUS_HELP_TOGGLE' | translate" [title]="'INVENTORY.PURCHASE_ORDERS.STATUS_HELP_TOGGLE' | translate" (click)="toggleStatusHelp()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          </button>
        </div>

        @if (showStatusHelp()) {
          <div id="po-status-help-panel" class="po-help-panel" role="region" [attr.aria-label]="'INVENTORY.PURCHASE_ORDERS.STATUS_HELP_TITLE' | translate">
            @for (status of statuses; track status) {
              <div class="po-help-item">
                <span class="status-badge" [class]="status">{{ 'INVENTORY.PURCHASE_ORDERS.STATUS_' + status.toUpperCase() | translate }}</span>
                <p>{{ 'INVENTORY.PURCHASE_ORDERS.STATUS_HELP_' + status.toUpperCase() | translate }}</p>
              </div>
            }
          </div>
        }

        @if (loading()) {
          <div class="empty-state"><p>{{ 'INVENTORY.PURCHASE_ORDERS.LOADING' | translate }}</p></div>
        } @else if (orders().length === 0) {
          <div class="po-empty">
            <div class="po-empty-ico"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h6"/></svg></div>
            <h3>{{ 'INVENTORY.PURCHASE_ORDERS.NO_ORDERS' | translate }}</h3>
            <p>{{ 'INVENTORY.PURCHASE_ORDERS.NO_ORDERS_DESC' | translate }}</p>
            <button class="po-new" (click)="openCreateModal()"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>{{ 'INVENTORY.PURCHASE_ORDERS.CREATE_PO' | translate }}</button>
          </div>
        } @else if (visibleOrders().length === 0) {
          <div class="po-empty"><p>{{ 'INVENTORY.PURCHASE_ORDERS.NO_MATCH' | translate }}</p></div>
        } @else {
          <div class="po-grid">
            @for (po of visibleOrders(); track po.id) {
              <article class="po-card" [attr.data-status]="po.status">
                <header class="po-card-head">
                  <div class="po-card-title">
                    <h3>{{ po.order_number }}</h3>
                    <span class="po-meta"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>{{ formatDate(po.order_date) }}</span>
                  </div>
                  <span class="status-badge po-pill" [class]="po.status">
                    {{ 'INVENTORY.PURCHASE_ORDERS.STATUS_' + po.status.toUpperCase() | translate }}
                  </span>
                </header>

                <ol class="po-steps" [attr.data-cancelled]="po.status === 'cancelled'" aria-hidden="true">
                  @for (st of pipeline; track st; let i = $index) {
                    <li [class.done]="stepIndex(po.status) >= i" [class.current]="stepIndex(po.status) > i - 1 && stepIndex(po.status) < i + 1 && po.status !== 'cancelled'">
                      <i></i><span>{{ 'INVENTORY.PURCHASE_ORDERS.STATUS_' + st.toUpperCase() | translate }}</span>
                    </li>
                  }
                </ol>

                <div class="po-info">
                  <div class="po-total">
                    <small>{{ 'INVENTORY.COMMON.TOTAL' | translate }}</small>
                    <strong>{{ formatCurrency(po.total_cents) }}</strong>
                  </div>
                  <div class="po-due" [attr.data-tone]="dueInfo(po).tone">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
                    <span>{{ dueInfo(po).text }}</span>
                  </div>
                </div>

                <footer class="po-actions">
                  @for (target of transitionTargets(po.status); track target) {
                    <button type="button" class="po-act po-act-main" [disabled]="statusUpdatingId() === po.id" (click)="transitionOrder(po, target)">
                      {{ purchaseOrderActionLabelKey(target) | translate }}
                    </button>
                  }
                  @if (canReceive(po.status)) {
                    <a [routerLink]="['/inventory/purchase-orders', po.id]" [queryParams]="{ receive: '1' }" class="po-act po-act-main">
                      {{ 'INVENTORY.PURCHASE_ORDERS.RECEIVE_GOODS' | translate }}
                    </a>
                  }
                  <span class="po-spacer"></span>
                  <button class="po-ico" [title]="'INVENTORY.PURCHASE_ORDERS.PRINT_PDF' | translate" [attr.aria-label]="'INVENTORY.PURCHASE_ORDERS.PRINT_PDF' | translate" (click)="downloadPdf(po)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg></button>
                  <a [routerLink]="['/inventory/purchase-orders', po.id]" class="po-ico" [title]="'INVENTORY.COMMON.VIEW' | translate" [attr.aria-label]="'INVENTORY.COMMON.VIEW' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></a>
                  @if (canCancel(po.status)) {
                    <button class="po-ico po-ico-danger" [title]="'INVENTORY.COMMON.CANCEL' | translate" [attr.aria-label]="'INVENTORY.COMMON.CANCEL' | translate" [disabled]="statusUpdatingId() === po.id" (click)="cancelOrder(po)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                  }
                </footer>
              </article>
            }
          </div>
        }
      </div>

      <!-- Create PO Modal -->
      @if (showCreateModal()) {
        <div class="modal-overlay">
          <div class="modal pm" (click)="$event.stopPropagation()" appFocusFirstInput>
            <div class="pm-head">
              <span class="pm-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 002 1.6h9.7a2 2 0 002-1.6L23 6H6"/></svg></span>
              <div class="pm-head-text">
                <h3>{{ 'INVENTORY.PURCHASE_ORDERS.CREATE_TITLE' | translate }}</h3>
                <p>{{ itemsArray.length }} {{ 'INVENTORY.PURCHASE_ORDERS.ARTICLES_SHORT' | translate }} · {{ formatCurrency(orderTotal()) }}</p>
              </div>
              <button type="button" class="pm-close" (click)="closeModal()" [attr.aria-label]="'INVENTORY.COMMON.CANCEL' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            </div>

            <form [formGroup]="createForm" (ngSubmit)="submitCreateForm()" class="pm-form">
              <div class="pm-body">
                <section class="pm-sec">
                  <h4><i>1</i>{{ 'INVENTORY.PURCHASE_ORDERS.FORM_DETAILS' | translate }}</h4>
                  <div class="pm-two">
                    <div class="pm-field">
                      <label for="expected_date">{{ 'INVENTORY.PURCHASE_ORDERS.EXPECTED_DELIVERY' | translate }}</label>
                      <app-date-picker id="expected_date" formControlName="expected_date" [placeholder]="'INVENTORY.PURCHASE_ORDERS.PICK_DATE' | translate" />
                    </div>
                    <div class="pm-field">
                      <label for="notes">{{ 'INVENTORY.ITEMS.NOTES' | translate }}</label>
                      <input type="text" id="notes" formControlName="notes" [placeholder]="'INVENTORY.PURCHASE_ORDERS.NOTES_PLACEHOLDER' | translate" />
                    </div>
                  </div>
                </section>

                <section class="pm-sec">
                  <h4>
                    <i>2</i>{{ 'INVENTORY.PURCHASE_ORDERS.ORDER_ITEMS' | translate }}
                    <button type="button" class="pm-add" (click)="addItem()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>{{ 'INVENTORY.ITEMS.ADD_ITEM' | translate }}</button>
                  </h4>

                  @if (itemsArray.length === 0) {
                    <button type="button" class="pm-empty" (click)="addItem()">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
                      <b>{{ 'INVENTORY.PURCHASE_ORDERS.NO_ITEMS' | translate }}</b>
                      <span>{{ 'INVENTORY.PURCHASE_ORDERS.NO_ITEMS_CTA' | translate }}</span>
                    </button>
                  } @else {
                    <div class="pm-lines" formArrayName="items">
                      @for (item of itemsArray.controls; track $index; let i = $index) {
                        <div class="pm-line" [formGroupName]="i">
                          <div class="pm-line-top">
                            <span class="pm-line-n">{{ i + 1 }}</span>
                            <div class="pm-line-item">
                              <app-select formControlName="inventory_item_id" [options]="inventoryOptions()" [placeholder]="'COMMON.SELECT' | translate" [searchable]="true" [emptyValue]="''" (changed)="onItemSelected(i)" />
                            </div>
                            <button type="button" class="pm-del" (click)="removeItem(i)" [attr.aria-label]="'INVENTORY.COMMON.DELETE' | translate" [title]="'INVENTORY.COMMON.DELETE' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
                          </div>
                          <div class="pm-line-grid">
                            <div class="pm-field">
                              <label>{{ 'INVENTORY.ITEMS.QUANTITY' | translate }}</label>
                              <div class="pm-qty">
                                <button type="button" (click)="stepQty(i, -1)" aria-label="-">−</button>
                                <input type="number" formControlName="quantity_ordered" min="1" step="1" />
                                <button type="button" class="pm-qty-plus" (click)="stepQty(i, 1)" aria-label="+">+</button>
                              </div>
                            </div>
                            <div class="pm-field">
                              <label>{{ 'INVENTORY.ITEMS.UNIT' | translate }}</label>
                              <app-select formControlName="unit" [options]="unitOptions()" [searchable]="false" />
                            </div>
                            <div class="pm-field">
                              <label>{{ 'INVENTORY.PURCHASE_ORDERS.UNIT_COST' | translate }}</label>
                              <div class="pm-money">
                                <span aria-hidden="true">$</span>
                                <input type="text" inputmode="numeric" autocomplete="off" [value]="formatThousands(item.get('unit_cost_dollars')?.value)" (input)="onUnitCostInput(i, $event)" [attr.aria-label]="'INVENTORY.PURCHASE_ORDERS.UNIT_COST' | translate" />
                              </div>
                            </div>
                            <div class="pm-line-total">
                              <small>{{ 'INVENTORY.COMMON.TOTAL' | translate }}</small>
                              <strong>{{ formatCurrency(getItemTotal(i)) }}</strong>
                            </div>
                          </div>
                        </div>
                      }
                    </div>
                  }
                </section>
              </div>

              <div class="pm-foot">
                <div class="pm-sum">
                  <small>{{ 'INVENTORY.PURCHASE_ORDERS.ORDER_TOTAL' | translate }}</small>
                  <strong>{{ formatCurrency(orderTotal()) }}</strong>
                </div>
                <button type="button" class="pm-btn pm-btn-ghost" (click)="closeModal()">{{ 'INVENTORY.COMMON.CANCEL' | translate }}</button>
                <button type="submit" class="pm-btn pm-btn-main" [disabled]="!createForm.valid || itemsArray.length === 0 || saving()">
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

  statuses: PurchaseOrderStatus[] = ['draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled'];
  units: UnitOfMeasure[] = ['piece', 'gram', 'kilogram', 'ounce', 'pound', 'milliliter', 'centiliter', 'liter', 'fluid_ounce', 'cup', 'gallon'];

  readonly unitKey = inventoryUnitKey;

  /** Steps of the happy path drawn on each card. */
  readonly pipeline: PurchaseOrderStatus[] = ['draft', 'submitted', 'approved', 'received'];
  statusSel = signal('');

  visibleOrders = computed(() => {
    const st = this.statusSel();
    return st ? this.orders().filter((o) => o.status === st) : this.orders();
  });

  poStats = computed(() => {
    const list = this.orders();
    const open = list.filter((o) => ['submitted', 'approved', 'partially_received'].includes(o.status));
    return {
      total: list.length,
      open: open.length,
      toReceiveCents: list
        .filter((o) => o.status === 'approved' || o.status === 'partially_received')
        .reduce((sum, o) => sum + (o.total_cents || 0), 0),
      receivedCents: list.filter((o) => o.status === 'received').reduce((sum, o) => sum + (o.total_cents || 0), 0),
    };
  });

  setStatus(value: string): void {
    this.statusSel.set(value);
  }

  countByStatus(status: string): number {
    return this.orders().filter((o) => o.status === status).length;
  }

  /** Position on the pipeline (draft 0 .. received 3); partially received sits between approved and received. */
  stepIndex(status: PurchaseOrderStatus): number {
    const map: Record<string, number> = { draft: 0, submitted: 1, approved: 2, partially_received: 2.5, received: 3 };
    return map[status] ?? -1;
  }

  /** "Llega en 3 d" / "Atrasada 2 d" for orders that are still waiting for goods. */
  dueInfo(po: PurchaseOrder): { text: string; tone: 'ok' | 'soon' | 'late' | 'none' } {
    if (!po.expected_date) return { text: this.translate.instant('INVENTORY.PURCHASE_ORDERS.NO_DUE'), tone: 'none' };
    const dateText = this.formatDate(po.expected_date);
    if (po.status === 'received' || po.status === 'cancelled') return { text: dateText, tone: 'none' };
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(po.expected_date);
    if (!m) return { text: dateText, tone: 'none' };
    const due = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    const today = new Date();
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const days = Math.round((due - t0) / 86400000);
    if (days < 0) return { text: this.translate.instant('INVENTORY.PURCHASE_ORDERS.DUE_LATE', { n: -days, date: dateText }), tone: 'late' };
    if (days === 0) return { text: this.translate.instant('INVENTORY.PURCHASE_ORDERS.DUE_TODAY'), tone: 'soon' };
    return { text: this.translate.instant('INVENTORY.PURCHASE_ORDERS.DUE_IN', { n: days, date: dateText }), tone: days <= 2 ? 'soon' : 'ok' };
  }

  inventoryOptions(): AppSelectOption[] {
    return this.inventoryItems().map((i) => ({ value: i.id, label: i.name, sub: i.sku }));
  }

  unitOptions(): AppSelectOption[] {
    return unitSelectOptions(this.translate, this.units);
  }

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
    this.inventoryService.getPurchaseOrders({}).subscribe({
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

  /** Quantity +/- on a line (whole units, minimum 1). */
  stepQty(index: number, dir: 1 | -1): void {
    const ctrl = this.itemsArray.at(index).get('quantity_ordered');
    const cur = Math.round(Number(ctrl?.value) || 0);
    ctrl?.setValue(Math.max(1, cur + dir));
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