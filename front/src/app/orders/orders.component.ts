import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  Order,
  OrderItem,
  TenantSettings,
  BillingCustomer,
  OrderItemCreate,
  OrderLineModifiers,
  DianInvoicePublic,
  Product,
  User,
  OrderDeliveryUpdate,
} from '../services/api.service';
import { AudioService } from '../services/audio.service';
import { PermissionService, Permission } from '../services/permission.service';
import { PrintBridgeService } from '../services/print-bridge.service';
import { Subscription } from 'rxjs';
import { AgGridAngular } from 'ag-grid-angular';
import { SidebarComponent } from '../shared/sidebar.component';
import { StaffPosToolbarComponent } from '../shared/staff-pos-toolbar.component';
import { FocusFirstInputDirective } from '../shared/focus-first-input.directive';
import { QuickSaleComponent } from './quick-sale.component';
import { ProductPickerComponent, PickedLine, PickerProduct } from './product-picker.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { formatMoneyCents } from '../shared/currency-symbol';
import {
  ColDef,
  ModuleRegistry,
  ClientSideRowModelModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  themeQuartz,
  ICellRendererParams,
} from 'ag-grid-community';

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
]);

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [AgGridAngular, SidebarComponent, StaffPosToolbarComponent, FormsModule, FocusFirstInputDirective, TranslateModule, QuickSaleComponent, ProductPickerComponent],
  template: `
    <app-sidebar>
        <div class="page-header page-header--staff-flow">
          <app-staff-pos-toolbar />
          <div class="page-header-row">
            <h1>{{ 'ORDERS.TITLE' | translate }}</h1>
            <div class="page-header-actions">
              @if (canUpdateStatus()) {
                <button type="button" class="btn btn-primary" (click)="openCreateDeliveryModal()">
                  {{ 'ORDERS.NEW_DELIVERY_ORDER' | translate }}
                </button>
              }
              <button class="btn btn-secondary" (click)="loadOrders()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                </svg>
                {{ 'ORDERS.REFRESH' | translate }}
              </button>
            </div>
          </div>
        </div>

        <div class="content">
          @if (canMarkPaid() && canUpdateStatus()) {
            <app-quick-sale />
          }
          @if (loading()) {
            <div class="empty-state"><p>{{ 'ORDERS.LOADING' | translate }}</p></div>
          } @else {
            @if (tableScopeId() != null) {
              <div class="orders-table-scope-banner" role="status">
                <span>{{ 'ORDERS.TABLE_SCOPE_LABEL' | translate: { name: tableScopeLabel() } }}</span>
                <button type="button" class="btn btn-sm btn-secondary" (click)="clearTableScope()">
                  {{ 'ORDERS.TABLE_SCOPE_CLEAR' | translate }}
                </button>
              </div>
            }
            <!-- Filter Toggle -->
            <div class="filter-tabs">
              <button 
                class="filter-tab" 
                [class.active]="viewMode() === 'active'"
                (click)="viewMode.set('active')">
                {{ 'ORDERS.ACTIVE_ORDERS' | translate }}
                @if (activeOrders().length > 0) {
                  <span class="tab-badge">{{ activeOrders().length }}</span>
                }
              </button>
              <button 
                class="filter-tab" 
                [class.active]="viewMode() === 'not_paid'"
                (click)="viewMode.set('not_paid')">
                {{ 'ORDERS.NOT_PAID_YET' | translate }}
                @if (notPaidOrders().length > 0) {
                  <span class="tab-badge">{{ notPaidOrders().length }}</span>
                }
              </button>
              <button 
                class="filter-tab" 
                [class.active]="viewMode() === 'history'"
                (click)="viewMode.set('history')">
                {{ 'ORDERS.ORDER_HISTORY' | translate }}
                @if (completedOrders().length > 0) {
                  <span class="tab-badge">{{ completedOrders().length }}</span>
                }
              </button>
              <button
                class="filter-tab"
                [class.active]="viewMode() === 'delivery'"
                (click)="viewMode.set('delivery')">
                {{ 'ORDERS.DELIVERY_TAB' | translate }}
                @if (deliveryOrders().length > 0) {
                  <span class="tab-badge">{{ deliveryOrders().length }}</span>
                }
              </button>
              @if (viewMode() === 'active') {
                <label class="toggle-removed">
                  <input type="checkbox" [(ngModel)]="showRemovedItems" (change)="loadOrders()">
                  <span>{{ 'ORDERS.SHOW_REMOVED_ITEMS' | translate }}</span>
                </label>
              }
            </div>

            <!-- Active Orders Section -->
            @if (viewMode() === 'active' && activeOrders().length > 0) {
              <div class="order-grid">
                @for (order of activeOrders(); track order.id) {
                  <div class="order-card" [id]="'order-card-' + order.id" [class]="'status-' + order.status + (orderCardHasOpenStatusDropdown(order.id) ? ' status-dropdown-open' : '')">
                    <div class="order-header">
                      <div class="order-header-main">
                        <span class="order-id">#{{ order.id }}</span>
                        <span class="order-table">{{ order.table_name }}</span>
                        @if (orderChannelBadgeKey(order); as channelKey) {
                          <span class="order-channel-badge" [class.marketplace]="isMarketplaceDelivery(order)">{{ channelKey | translate }}</span>
                        }
                        @if (order.table_group_label) {
                          <span class="order-table-group">{{ order.table_group_label }}</span>
                        }
                        @if (order.customer_name) {
                          <span class="order-customer">{{ 'ORDERS.CUSTOMER' | translate }}: {{ order.customer_name }}</span>
                        }
                        @if (order.staff_urgent) {
                          <span class="order-urgent-badge">{{ 'ORDERS.URGENT_BADGE' | translate }}</span>
                        }
                        <span class="order-time" [title]="formatExactTime(order.created_at)">{{ 'ORDERS.ORDER_TIME' | translate }}: {{ formatOrderTime(order.created_at) }}</span>
                      </div>
                    </div>

                    @if (isDeliveryChannel(order)) {
                      <div class="order-delivery-meta">
                        @if (order.delivery_address) {
                          <div>{{ 'ORDERS.DELIVERY_ADDRESS' | translate }}: {{ order.delivery_address }}</div>
                        }
                        @if (order.customer_phone) {
                          <div>{{ 'ORDERS.DELIVERY_PHONE' | translate }}: {{ order.customer_phone }}</div>
                        }
                        @if (isSatisfechoDelivery(order)) {
                          <div>{{ 'ORDERS.COURIER' | translate }}: {{ courierDisplayName(order.courier_user_id) }}</div>
                        }
                      </div>
                    }

                    <div class="order-items">
                      @for (item of getSortedItems(order.items); track item.id) {
                        <div class="order-item" [class.removed]="item.removed_by_customer">
                          <div class="item-name-row">
                            <span class="item-qty">
                              @if (!item.removed_by_customer && item.status !== 'cancelled' && item.status !== 'delivered') {
                                <input type="number" 
                                  [value]="item.quantity" 
                                  (change)="updateItemQuantity(order.id, item.id!, +$any($event.target).value)"
                                  min="1" 
                                  class="quantity-input"
                                />
                              } @else {
                                {{ item.quantity }}x
                              }
                            </span>
                            <span class="item-name">{{ item.product_name }}</span>
                            @if (hasItemModifiersLine(item)) {
                              <span class="item-customization">{{ formatItemModifiersLine(item) }}</span>
                            }
                            @if (item.notes?.trim()) {
                              <span class="item-notes">{{ item.notes }}</span>
                            }
                          </div>
                          <div class="item-details-row">
                            <span class="item-price">
                              {{ formatPrice(item.price_cents) }}
                              @if (item.quantity > 1) {
                                <span class="price-total">({{ formatPrice(item.price_cents * item.quantity) }} total)</span>
                              }
                            </span>
                            <div class="item-actions">
                              @if (!item.removed_by_customer && item.status !== 'cancelled') {
                                <button class="btn-remove-item" (click)="removeItemStaff(order.id, item.id!, item.status ?? 'pending')" [title]="'ORDERS.REMOVE_ITEM' | translate">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M18 6L6 18M6 6l12 12"/>
                                  </svg>
                                </button>
                              }
                              @if (item.status && !item.removed_by_customer) {
                                <div class="item-status-control">
                                  <button 
                                    class="item-status-badge clickable" 
                                    [class]="'status-' + item.status"
                                    (click)="toggleItemStatusDropdown(order.id, item.id!)"
                                    [title]="'ORDERS.CLICK_TO_CHANGE_STATUS' | translate">
                                    {{ getItemStatusLabel(item.status) }}
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                      <polyline points="6,9 12,15 18,9"/>
                                    </svg>
                                  </button>
                                  @if (itemStatusDropdownOpen() === order.id + '-' + item.id) {
                                    <div class="status-dropdown item-status-dropdown" (click)="$event.stopPropagation()">
                                      @if (getItemStatusTransitions(item.status).backward.length > 0) {
                                        <div class="dropdown-section">
                                          <div class="dropdown-label">{{ 'ORDERS.GO_BACK' | translate }}</div>
                                          @for (status of getItemStatusTransitions(item.status).backward; track status) {
                                            <button 
                                              class="dropdown-item backward"
                                              (click)="updateItemStatus(order.id, item.id!, status); itemStatusDropdownOpen.set(null)">
                                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <polyline points="15,18 9,12 15,6"/>
                                              </svg>
                                              {{ getItemStatusLabel(status) }}
                                            </button>
                                          }
                                        </div>
                                      }
                                      @if (getItemStatusTransitions(item.status).forward.length > 0) {
                                        <div class="dropdown-section">
                                          <div class="dropdown-label">{{ 'ORDERS.MOVE_FORWARD' | translate }}</div>
                                          @for (status of getItemStatusTransitions(item.status).forward; track status) {
                                            <button 
                                              class="dropdown-item forward"
                                              (click)="updateItemStatus(order.id, item.id!, status); itemStatusDropdownOpen.set(null)">
                                              {{ getItemStatusLabel(status) }}
                                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <polyline points="9,18 15,12 9,6"/>
                                              </svg>
                                            </button>
                                          }
                                        </div>
                                      }
                                    </div>
                                  }
                                </div>
                              }
                            </div>
                          </div>
                          @if (item.removed_by_customer) {
                            <div class="removed-indicator">
                              <span class="removed-label">{{ 'ORDERS.REMOVED_BY_CUSTOMER' | translate }}</span>
                              @if (item.removed_at) {
                                <span class="removed-time">{{ formatTime(item.removed_at) }}</span>
                              }
                            </div>
                          }
                        </div>
                      }
                    </div>

                    @if (displayOrderNotes(order.notes)) {
                      <div class="order-notes-banner">{{ 'ORDERS.ORDER_NOTES' | translate }}: {{ displayOrderNotes(order.notes) }}</div>
                    }

                    <div class="order-footer">
                      <div class="order-footer-left">
                        <span class="order-total">{{ 'ORDERS.TOTAL' | translate }}: {{ formatPrice(order.total_cents) }}</span>
                        @if (order.removed_items_count && order.removed_items_count > 0) {
                          <span class="removed-count">{{ 'ORDERS.ITEMS_REMOVED' | translate:{ count: order.removed_items_count } }}</span>
                        }
                      </div>
                      <div class="order-actions">
                        @if (canUpdateStatus() && order.status !== 'cancelled') {
                          <button type="button" class="btn btn-urgent" (click)="toggleStaffUrgent(order, $event)">
                            {{ order.staff_urgent ? ('ORDERS.CLEAR_URGENT' | translate) : ('ORDERS.MARK_URGENT' | translate) }}
                          </button>
                        }
                        <button type="button" class="btn btn-edit-order" (click)="openOrderEdit(order)" [title]="'ORDERS.EDIT_ORDER' | translate">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                          {{ 'COMMON.EDIT' | translate }}
                        </button>
                        @if (isSatisfechoDelivery(order) && canUpdateStatus() && order.status !== 'cancelled') {
                          <button type="button" class="btn btn-secondary" (click)="openEditDeliveryModal(order)">
                            {{ 'ORDERS.EDIT_DELIVERY' | translate }}
                          </button>
                        }
                        @if (order.status !== 'paid' && order.status !== 'cancelled' && canFinishOrder()) {
                          <button type="button" class="btn btn-success" (click)="openFinishPaymentModal(order)" [title]="'ORDERS.FINISH_ORDER_MENU' | translate">
                            {{ 'ORDERS.FINISH_ORDER' | translate }}
                          </button>
                        }
                        <div class="status-control">
                          <button
                            class="status-badge-btn"
                            [class]="order.status"
                            (click)="toggleStatusDropdown(order.id)"
                            [title]="'ORDERS.CLICK_TO_CHANGE_STATUS' | translate">
                            {{ getStatusLabel(order.status) }}
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <polyline points="6,9 12,15 18,9"/>
                            </svg>
                          </button>
                          @if (statusDropdownOpen() === order.id) {
                            <div class="status-dropdown" (click)="$event.stopPropagation()">
                              @if (getOrderStatusTransitions(order.status).backward.length > 0) {
                                <div class="dropdown-section">
                                  <div class="dropdown-label">{{ 'ORDERS.GO_BACK' | translate }}</div>
                                  @for (status of getOrderStatusTransitions(order.status).backward; track status) {
                                    <button
                                      class="dropdown-item backward"
                                      (click)="updateStatus(order, status)">
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="15,18 9,12 15,6"/>
                                      </svg>
                                      {{ getStatusLabel(status) }}
                                    </button>
                                  }
                                </div>
                              }
                              @if (getOrderStatusTransitions(order.status).forward.length > 0) {
                                <div class="dropdown-section">
                                  <div class="dropdown-label">{{ 'ORDERS.MOVE_FORWARD' | translate }}</div>
                                  @for (status of getOrderStatusTransitions(order.status).forward; track status) {
                                    <button
                                      class="dropdown-item forward"
                                      (click)="updateStatus(order, status)">
                                      {{ getStatusLabel(status) }}
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="9,18 15,12 9,6"/>
                                      </svg>
                                    </button>
                                  }
                                </div>
                              }
                              @if (order.status !== 'paid' && order.status !== 'cancelled' && canFinishOrder()) {
                                <div class="dropdown-section">
                                  <button
                                    class="dropdown-item forward"
                                    (click)="openFinishPaymentModal(order); statusDropdownOpen.set(null)">
                                    {{ 'ORDERS.FINISH_ORDER_MENU' | translate }}
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                      <polyline points="9,18 15,12 9,6"/>
                                    </svg>
                                  </button>
                                </div>
                              }
                              @if (order.status === 'paid' && canMarkPaid()) {
                                <div class="dropdown-section">
                                  <button
                                    class="dropdown-item backward"
                                    (click)="unmarkPaid(order)">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                      <polyline points="15,18 9,12 15,6"/>
                                    </svg>
                                    {{ 'ORDERS.UNMARK_PAID' | translate }}
                                  </button>
                                </div>
                              }
                            </div>
                          }
                        </div>
                        @if (canDeleteOrder()) {
                          <button type="button" class="btn btn-delete-order" (click)="deleteOrder(order)" [title]="'ORDERS.DELETE_ORDER' | translate">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                              <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
                            </svg>
                            {{ 'ORDERS.DELETE_ORDER' | translate }}
                          </button>
                        }
                        @if (order.table_id != null && order.table_token) {
                          <button type="button" class="btn btn-menu-link" (click)="openMenuForOrder(order)" [title]="'ORDERS.OPEN_MENU_LINK' | translate">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                            </svg>
                            {{ 'ORDERS.OPEN_MENU' | translate }}
                          </button>
                        }
                        <button type="button" class="btn btn-print" (click)="openFacturaModal(order)" [title]="'CUSTOMERS.PRINT_FACTURA' | translate">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                }
              </div>
            } @else if (viewMode() === 'active' && activeOrders().length === 0 && notPaidOrders().length === 0) {
              <div class="empty-state">
                <div class="empty-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline points="14,2 14,8 20,8"/>
                  </svg>
                </div>
                <h3>{{ 'ORDERS.NO_ORDERS' | translate }}</h3>
                <p>{{ 'ORDERS.NO_ORDERS_DESC' | translate }}</p>
              </div>
            }

            <!-- Not Paid Yet Section -->
            @if (viewMode() === 'not_paid') {
              @if (notPaidOrders().length > 0) {
                <div class="order-grid">
                  @for (order of notPaidOrders(); track order.id) {
                    <div class="order-card" [id]="'order-card-' + order.id" [class]="'status-' + order.status + (orderCardHasOpenStatusDropdown(order.id) ? ' status-dropdown-open' : '')">
                      <div class="order-header">
                        <div class="order-header-main">
                          <span class="order-id">#{{ order.id }}</span>
                          <span class="order-table">{{ order.table_name }}</span>
                          @if (orderChannelBadgeKey(order); as channelKey) {
                            <span class="order-channel-badge" [class.marketplace]="isMarketplaceDelivery(order)">{{ channelKey | translate }}</span>
                          }
                          @if (order.table_group_label) {
                            <span class="order-table-group">{{ order.table_group_label }}</span>
                          }
                          @if (order.customer_name) {
                            <span class="order-customer">{{ 'ORDERS.CUSTOMER' | translate }}: {{ order.customer_name }}</span>
                          }
                          @if (order.staff_urgent) {
                            <span class="order-urgent-badge">{{ 'ORDERS.URGENT_BADGE' | translate }}</span>
                          }
                          <span class="order-time" [title]="formatExactTime(order.created_at)">{{ 'ORDERS.ORDER_TIME' | translate }}: {{ formatOrderTime(order.created_at) }}</span>
                        </div>
                      </div>

                      @if (isDeliveryChannel(order)) {
                        <div class="order-delivery-meta">
                          @if (order.delivery_address) {
                            <div>{{ 'ORDERS.DELIVERY_ADDRESS' | translate }}: {{ order.delivery_address }}</div>
                          }
                          @if (order.customer_phone) {
                            <div>{{ 'ORDERS.DELIVERY_PHONE' | translate }}: {{ order.customer_phone }}</div>
                          }
                          @if (isSatisfechoDelivery(order)) {
                            <div>{{ 'ORDERS.COURIER' | translate }}: {{ courierDisplayName(order.courier_user_id) }}</div>
                          }
                        </div>
                      }

                      <div class="order-items">
                        @for (item of getSortedItems(order.items); track item.id) {
                          <div class="order-item" [class.removed]="item.removed_by_customer">
                            <div class="item-name-row">
                              <span class="item-qty">
                                @if (!item.removed_by_customer && item.status !== 'cancelled' && item.status !== 'delivered') {
                                  <input type="number"
                                    [value]="item.quantity"
                                    (change)="updateItemQuantity(order.id, item.id!, +$any($event.target).value)"
                                    min="1"
                                    class="quantity-input"
                                  />
                                } @else {
                                  {{ item.quantity }}x
                                }
                              </span>
                              <span class="item-name">{{ item.product_name }}</span>
                              @if (hasItemModifiersLine(item)) {
                                <span class="item-customization">{{ formatItemModifiersLine(item) }}</span>
                              }
                              @if (item.notes?.trim()) {
                                <span class="item-notes">{{ item.notes }}</span>
                              }
                            </div>
                            <div class="item-details-row">
                              <span class="item-price">
                                {{ formatPrice(item.price_cents) }}
                                @if (item.quantity > 1) {
                                  <span class="price-total">({{ formatPrice(item.price_cents * item.quantity) }} total)</span>
                                }
                              </span>
                              <div class="item-actions">
                                @if (!item.removed_by_customer && item.status !== 'cancelled') {
                                  <button class="btn-remove-item" (click)="removeItemStaff(order.id, item.id!, item.status ?? 'pending')" [title]="'ORDERS.REMOVE_ITEM' | translate">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                      <path d="M18 6L6 18M6 6l12 12"/>
                                    </svg>
                                  </button>
                                }
                                @if (item.status && !item.removed_by_customer) {
                                  <div class="item-status-control">
                                    <button
                                      class="item-status-badge clickable"
                                      [class]="'status-' + item.status"
                                      (click)="toggleItemStatusDropdown(order.id, item.id!)"
                                      [title]="'ORDERS.CLICK_TO_CHANGE_STATUS' | translate">
                                      {{ getItemStatusLabel(item.status) }}
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="6,9 12,15 18,9"/>
                                      </svg>
                                    </button>
                                    @if (itemStatusDropdownOpen() === order.id + '-' + item.id) {
                                      <div class="status-dropdown item-status-dropdown" (click)="$event.stopPropagation()">
                                        @if (getItemStatusTransitions(item.status).backward.length > 0) {
                                          <div class="dropdown-section">
                                            <div class="dropdown-label">{{ 'ORDERS.GO_BACK' | translate }}</div>
                                            @for (status of getItemStatusTransitions(item.status).backward; track status) {
                                              <button
                                                class="dropdown-item backward"
                                                (click)="updateItemStatus(order.id, item.id!, status); itemStatusDropdownOpen.set(null)">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                  <polyline points="15,18 9,12 15,6"/>
                                                </svg>
                                                {{ getItemStatusLabel(status) }}
                                              </button>
                                            }
                                          </div>
                                        }
                                        @if (getItemStatusTransitions(item.status).forward.length > 0) {
                                          <div class="dropdown-section">
                                            <div class="dropdown-label">{{ 'ORDERS.MOVE_FORWARD' | translate }}</div>
                                            @for (status of getItemStatusTransitions(item.status).forward; track status) {
                                              <button
                                                class="dropdown-item forward"
                                                (click)="updateItemStatus(order.id, item.id!, status); itemStatusDropdownOpen.set(null)">
                                                {{ getItemStatusLabel(status) }}
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                  <polyline points="9,18 15,12 9,6"/>
                                                </svg>
                                              </button>
                                            }
                                          </div>
                                        }
                                      </div>
                                    }
                                  </div>
                                }
                              </div>
                            </div>
                            @if (item.removed_by_customer) {
                              <div class="removed-indicator">
                                <span class="removed-label">{{ 'ORDERS.REMOVED_BY_CUSTOMER' | translate }}</span>
                                @if (item.removed_at) {
                                  <span class="removed-time">{{ formatTime(item.removed_at) }}</span>
                                }
                              </div>
                            }
                          </div>
                        }
                      </div>

                      <div class="order-footer">
                        <div class="order-footer-left">
                          <span class="order-total">{{ 'ORDERS.TOTAL' | translate }}: {{ formatPrice(order.total_cents) }}</span>
                          @if (order.removed_items_count && order.removed_items_count > 0) {
                            <span class="removed-count">{{ 'ORDERS.ITEMS_REMOVED' | translate:{ count: order.removed_items_count } }}</span>
                          }
                        </div>
                        <div class="order-actions">
                          @if (canUpdateStatus() && order.status !== 'cancelled') {
                            <button type="button" class="btn btn-urgent" (click)="toggleStaffUrgent(order, $event)">
                              {{ order.staff_urgent ? ('ORDERS.CLEAR_URGENT' | translate) : ('ORDERS.MARK_URGENT' | translate) }}
                            </button>
                          }
                          <button type="button" class="btn btn-edit-order" (click)="openOrderEdit(order)" [title]="'ORDERS.EDIT_ORDER' | translate">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                            {{ 'COMMON.EDIT' | translate }}
                          </button>
                          @if (isSatisfechoDelivery(order) && canUpdateStatus() && order.status !== 'cancelled') {
                            <button type="button" class="btn btn-secondary" (click)="openEditDeliveryModal(order)">
                              {{ 'ORDERS.EDIT_DELIVERY' | translate }}
                            </button>
                          }
                          @if (order.status !== 'paid' && order.status !== 'cancelled' && canFinishOrder()) {
                            <button type="button" class="btn btn-success" (click)="openFinishPaymentModal(order)" [title]="'ORDERS.FINISH_ORDER_MENU' | translate">
                              {{ 'ORDERS.FINISH_ORDER' | translate }}
                            </button>
                          }
                          <div class="status-control">
                            <button
                              class="status-badge-btn"
                              [class]="order.status"
                              (click)="toggleStatusDropdown(order.id)"
                              [title]="'ORDERS.CLICK_TO_CHANGE_STATUS' | translate">
                              {{ getStatusLabel(order.status) }}
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6,9 12,15 18,9"/>
                              </svg>
                            </button>
                            @if (statusDropdownOpen() === order.id) {
                              <div class="status-dropdown" (click)="$event.stopPropagation()">
                                @if (getOrderStatusTransitions(order.status).backward.length > 0) {
                                  <div class="dropdown-section">
                                    <div class="dropdown-label">{{ 'ORDERS.GO_BACK' | translate }}</div>
                                    @for (status of getOrderStatusTransitions(order.status).backward; track status) {
                                      <button
                                        class="dropdown-item backward"
                                        (click)="updateStatus(order, status)">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                          <polyline points="15,18 9,12 15,6"/>
                                        </svg>
                                        {{ getStatusLabel(status) }}
                                      </button>
                                    }
                                  </div>
                                }
                                @if (getOrderStatusTransitions(order.status).forward.length > 0) {
                                  <div class="dropdown-section">
                                    <div class="dropdown-label">{{ 'ORDERS.MOVE_FORWARD' | translate }}</div>
                                    @for (status of getOrderStatusTransitions(order.status).forward; track status) {
                                      <button
                                        class="dropdown-item forward"
                                        (click)="updateStatus(order, status)">
                                        {{ getStatusLabel(status) }}
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                          <polyline points="9,18 15,12 9,6"/>
                                        </svg>
                                      </button>
                                    }
                                  </div>
                                }
                                @if (order.status !== 'paid' && order.status !== 'cancelled' && canFinishOrder()) {
                                  <div class="dropdown-section">
                                    <button
                                      class="dropdown-item forward"
                                      (click)="openFinishPaymentModal(order); statusDropdownOpen.set(null)">
                                      {{ 'ORDERS.FINISH_ORDER_MENU' | translate }}
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="9,18 15,12 9,6"/>
                                      </svg>
                                    </button>
                                  </div>
                                }
                                @if (order.status === 'paid' && canMarkPaid()) {
                                  <div class="dropdown-section">
                                    <button
                                      class="dropdown-item backward"
                                      (click)="unmarkPaid(order)">
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="15,18 9,12 15,6"/>
                                      </svg>
                                      {{ 'ORDERS.UNMARK_PAID' | translate }}
                                    </button>
                                  </div>
                                }
                              </div>
                            }
                          </div>
                          @if (canDeleteOrder()) {
                            <button type="button" class="btn btn-delete-order" (click)="deleteOrder(order)" [title]="'ORDERS.DELETE_ORDER' | translate">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
                              </svg>
                              {{ 'ORDERS.DELETE_ORDER' | translate }}
                            </button>
                          }
                          @if (order.table_id != null && order.table_token) {
                            <button type="button" class="btn btn-menu-link" (click)="openMenuForOrder(order)" [title]="'ORDERS.OPEN_MENU_LINK' | translate">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                              </svg>
                              {{ 'ORDERS.OPEN_MENU' | translate }}
                            </button>
                          }
                          <button type="button" class="btn btn-print" (click)="openFacturaModal(order)" [title]="'CUSTOMERS.PRINT_FACTURA' | translate">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  }
                </div>
              } @else {
                <div class="empty-state">
                  <div class="empty-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M9 12l2 2 4-4M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z"/>
                    </svg>
                  </div>
                  <h3>{{ 'ORDERS.ALL_ORDERS_PAID' | translate }}</h3>
                  <p>{{ 'ORDERS.NO_UNPAID_ORDERS' | translate }}</p>
                </div>
              }
            }

            <!-- Delivery Orders Section -->
            @if (viewMode() === 'delivery') {
              @if (deliveryOrders().length > 0) {
                <div class="order-grid">
                  @for (order of deliveryOrders(); track order.id) {
                    <div class="order-card" [id]="'order-card-' + order.id" [class]="'status-' + order.status + (orderCardHasOpenStatusDropdown(order.id) ? ' status-dropdown-open' : '')">
                      <div class="order-header">
                        <div class="order-header-main">
                          <span class="order-id">#{{ order.id }}</span>
                          <span class="order-table">{{ order.table_name }}</span>
                          @if (orderChannelBadgeKey(order); as channelKey) {
                            <span class="order-channel-badge" [class.marketplace]="isMarketplaceDelivery(order)">{{ channelKey | translate }}</span>
                          }
                          @if (order.customer_name) {
                            <span class="order-customer">{{ 'ORDERS.CUSTOMER' | translate }}: {{ order.customer_name }}</span>
                          }
                          @if (order.staff_urgent) {
                            <span class="order-urgent-badge">{{ 'ORDERS.URGENT_BADGE' | translate }}</span>
                          }
                          <span class="order-time" [title]="formatExactTime(order.created_at)">{{ 'ORDERS.ORDER_TIME' | translate }}: {{ formatOrderTime(order.created_at) }}</span>
                        </div>
                      </div>
                      <div class="order-delivery-meta">
                        @if (order.delivery_address) {
                          <div>{{ 'ORDERS.DELIVERY_ADDRESS' | translate }}: {{ order.delivery_address }}</div>
                        }
                        @if (order.customer_phone) {
                          <div>{{ 'ORDERS.DELIVERY_PHONE' | translate }}: {{ order.customer_phone }}</div>
                        }
                        @if (isSatisfechoDelivery(order)) {
                          <div>{{ 'ORDERS.COURIER' | translate }}: {{ courierDisplayName(order.courier_user_id) }}</div>
                        }
                        @if (isMarketplaceDelivery(order) && order.external_order_ref) {
                          <div>{{ 'ORDERS.MARKETPLACE_REF' | translate }}: {{ order.external_order_ref }}</div>
                        }
                      </div>
                      <div class="order-items">
                        @for (item of getSortedItems(order.items); track item.id) {
                          <div class="order-item" [class.removed]="item.removed_by_customer">
                            <div class="item-name-row">
                              <span class="item-qty">{{ item.quantity }}x</span>
                              <span class="item-name">{{ item.product_name }}</span>
                              @if (item.notes?.trim()) {
                                <span class="item-notes">{{ item.notes }}</span>
                              }
                            </div>
                            <div class="item-details-row">
                              <span class="item-price">{{ formatPrice(item.price_cents) }}</span>
                              @if (item.status) {
                                <span class="item-status-badge" [class]="'status-' + item.status">{{ getItemStatusLabel(item.status) }}</span>
                              }
                            </div>
                          </div>
                        }
                      </div>
                      @if (displayOrderNotes(order.notes)) {
                        <div class="order-notes-banner">{{ 'ORDERS.ORDER_NOTES' | translate }}: {{ displayOrderNotes(order.notes) }}</div>
                      }
                      <div class="order-footer">
                        <div class="order-footer-left">
                          <span class="order-total">{{ 'ORDERS.TOTAL' | translate }}: {{ formatPrice(order.total_cents) }}</span>
                        </div>
                        <div class="order-actions">
                          <button type="button" class="btn btn-edit-order" (click)="openOrderEdit(order)" [title]="'ORDERS.EDIT_ORDER' | translate">
                            {{ 'COMMON.EDIT' | translate }}
                          </button>
                          @if (isSatisfechoDelivery(order) && canUpdateStatus() && order.status !== 'cancelled') {
                            <button type="button" class="btn btn-secondary" (click)="openEditDeliveryModal(order)">
                              {{ 'ORDERS.EDIT_DELIVERY' | translate }}
                            </button>
                          }
                          @if (order.status !== 'paid' && order.status !== 'cancelled' && canFinishOrder()) {
                            <button type="button" class="btn btn-success" (click)="openFinishPaymentModal(order)">{{ 'ORDERS.FINISH_ORDER' | translate }}</button>
                          }
                        </div>
                      </div>
                    </div>
                  }
                </div>
              } @else {
                <div class="empty-state">
                  <div class="empty-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                      <polyline points="9 22 9 12 15 12 15 22"/>
                    </svg>
                  </div>
                  <h3>{{ 'ORDERS.NO_DELIVERY_ORDERS' | translate }}</h3>
                  <p>{{ 'ORDERS.NO_DELIVERY_ORDERS_DESC' | translate }}</p>
                  @if (canUpdateStatus()) {
                    <button type="button" class="btn btn-primary" (click)="openCreateDeliveryModal()">{{ 'ORDERS.NEW_DELIVERY_ORDER' | translate }}</button>
                  }
                </div>
              }
            }

            <!-- Order History Section (AG Grid) - only when History tab is selected -->
            @if (viewMode() === 'history') {
              @if (completedOrders().length > 0) {
                <div class="section-header history-header">
                  <h2>{{ 'ORDERS.ORDER_HISTORY' | translate }}</h2>
                  <span class="badge secondary">{{ completedOrders().length }}</span>
                </div>
                <div class="grid-container" (click)="onGridClick($event)">
                  <ag-grid-angular
                    style="width: 100%; height: 400px;"
                    [theme]="gridTheme"
                    [rowData]="completedOrders()"
                    [columnDefs]="columnDefs"
                    [defaultColDef]="defaultColDef"
                  />
                </div>
              } @else {
                <div class="empty-state">
                  <div class="empty-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <polyline points="14,2 14,8 20,8"/>
                    </svg>
                  </div>
                  <h3>{{ 'ORDERS.ORDER_HISTORY' | translate }}</h3>
                  <p>{{ 'ORDERS.NO_ORDER_HISTORY_YET' | translate }}</p>
                </div>
              }
            }
          }
        </div>

        <!-- Order Edit Widget Modal (add/remove/change items, billing, print) -->
        @if (editOrder(); as order) {
          <div class="modal-overlay">
            <div class="modal modal-order-edit eo" (click)="$event.stopPropagation()" appFocusFirstInput>
              <div class="eo-head">
                <div class="eo-head-main">
                  <h3>#{{ order.id }} · {{ order.table_name }}</h3>
                  <span class="eo-status" [class]="'status-' + order.status">{{ getStatusLabel(order.status) }}</span>
                  @if (order.customer_name) {
                    <span class="eo-customer">{{ order.customer_name }}</span>
                  }
                </div>
                <div class="eo-total">
                  <small>{{ 'ORDERS.TOTAL' | translate }}</small>
                  <strong>{{ formatPrice(order.total_cents) }}</strong>
                </div>
                <button class="icon-btn" (click)="closeOrderEdit()" [attr.aria-label]="'COMMON.CLOSE' | translate">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>

              <div class="eo-body">
                <div class="eo-section-title">{{ 'ORDERS.EDIT_WHAT_ORDERED' | translate }}</div>
                @for (item of getSortedItems(order.items); track item.id) {
                  @if (!item.removed_by_customer) {
                    <div class="eo-item" [class.eo-item-cancelled]="item.status === 'cancelled'">
                      <div class="eo-item-main">
                        <div class="eo-stepper">
                          <button type="button" [disabled]="item.quantity <= 1"
                            (click)="updateEditItemQuantity(order.id, item.id!, item.quantity - 1)" aria-label="-">−</button>
                          <span>{{ item.quantity }}</span>
                          <button type="button"
                            (click)="updateEditItemQuantity(order.id, item.id!, item.quantity + 1)" aria-label="+">+</button>
                        </div>
                        <div class="eo-item-text">
                          <span class="eo-item-name">{{ item.product_name }}</span>
                          @if (item.notes?.trim() && modifierEditItemId !== item.id) {
                            <span class="eo-item-note">{{ item.notes }}</span>
                          }
                          @if (hasItemModifiersLine(item) && modifierEditItemId !== item.id) {
                            <span class="eo-item-note">{{ formatItemModifiersLine(item) }}</span>
                          }
                        </div>
                        <span class="eo-item-price">{{ formatPrice(item.price_cents * item.quantity) }}</span>
                      </div>
                      <div class="eo-item-tools">
                        <select class="eo-status-select" [class]="'status-' + item.status" [ngModel]="item.status"
                          (ngModelChange)="updateEditItemStatus(order.id, item.id!, $event)"
                          [name]="'edit-status-' + item.id">
                          @for (st of ['pending','preparing','delivered','cancelled']; track st) {
                            <option [value]="st">{{ getItemStatusLabel(st) }}</option>
                          }
                        </select>
                        <button type="button" class="eo-link" (click)="toggleModifierEdit(item)">
                          {{ modifierEditItemId === item.id ? ('COMMON.CLOSE' | translate) : ('ORDERS.EDIT_CUSTOMIZE' | translate) }}
                        </button>
                        <button type="button" class="eo-trash" (click)="removeEditItem(order.id, item.id!, item.status ?? 'pending')"
                          [title]="'ORDERS.REMOVE_ITEM' | translate" [attr.aria-label]="'ORDERS.REMOVE_ITEM' | translate">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>
                          </svg>
                        </button>
                      </div>
                      @if (modifierEditItemId === item.id) {
                        <div class="eo-custom">
                          <label>{{ 'ORDERS.EDIT_NOTE' | translate }}</label>
                          <textarea class="form-input modifier-textarea" rows="2" [(ngModel)]="item.notes" [name]="'item-notes-' + item.id"
                            [placeholder]="'ORDERS.ITEM_NOTES_PLACEHOLDER' | translate" maxlength="500"
                            (blur)="saveEditItemNotes(order.id, item)"></textarea>
                          <label>{{ 'ORDERS.LINE_MODIFIERS_REMOVE' | translate }}</label>
                          <input type="text" class="form-input" [(ngModel)]="modifierEditRemove" [name]="'mod-rem-' + item.id" [placeholder]="'ORDERS.LINE_MODIFIERS_REMOVE_PLACEHOLDER' | translate" />
                          <label>{{ 'ORDERS.LINE_MODIFIERS_ADD' | translate }}</label>
                          <input type="text" class="form-input" [(ngModel)]="modifierEditAdd" [name]="'mod-add-' + item.id" [placeholder]="'ORDERS.LINE_MODIFIERS_ADD_PLACEHOLDER' | translate" />
                          <label>{{ 'ORDERS.LINE_MODIFIERS_SUBSTITUTE' | translate }}</label>
                          <textarea class="form-input modifier-textarea" rows="2" [(ngModel)]="modifierEditSubstitute" [name]="'mod-sub-' + item.id" [placeholder]="'ORDERS.LINE_MODIFIERS_SUBSTITUTE_PLACEHOLDER' | translate"></textarea>
                          <button type="button" class="btn btn-primary btn-sm" (click)="saveItemModifiers(order.id, item)" [disabled]="savingItemModifiers()">
                            {{ savingItemModifiers() ? ('COMMON.LOADING' | translate) : ('COMMON.SAVE' | translate) }}
                          </button>
                        </div>
                      }
                    </div>
                  }
                }

                @if (canAddItemsToOrder(order)) {
                  <button type="button" class="eo-pill" (click)="editAddOpen.set(true)">
                    <span class="eo-plus">+</span> {{ 'ORDERS.EDIT_ADD_PRODUCT' | translate }}
                  </button>
                  @if (editAddOpen()) {
                    <app-product-picker
                      [products]="editOrderProducts()"
                      [title]="('ORDERS.EDIT_ADD_PRODUCT' | translate) + ' · #' + order.id"
                      [confirmLabel]="'ORDERS.EDIT_ADD_TO_ORDER' | translate"
                      [busy]="addingItem()"
                      (confirmed)="addPickedProducts($event)"
                      (closed)="editAddOpen.set(false)" />
                  }
                }

                <div class="eo-bill">
                  <label for="edit-billing-customer">{{ 'ORDERS.EDIT_BILL_TO' | translate }}</label>
                  <select id="edit-billing-customer" class="form-select" [(ngModel)]="editOrderBillingId" name="editBillingCustomer"
                    (ngModelChange)="saveEditOrderBilling()">
                    <option [ngValue]="null">{{ 'COMMON.NONE' | translate }}</option>
                    @for (c of editOrderBillingCustomers(); track c.id) {
                      <option [ngValue]="c.id">{{ c.company_name || c.name }}{{ c.tax_id ? ' (' + c.tax_id + ')' : '' }}</option>
                    }
                  </select>
                </div>
              </div>

              <div class="eo-foot">
                <div class="eo-foot-left">
                  <button type="button" class="eo-ghost" (click)="printEditOrderInvoice()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                      stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>
                    {{ 'ORDERS.EDIT_PRINT_INVOICE' | translate }}
                  </button>
                  <button type="button" class="eo-ghost" (click)="printEditOrderKitchen()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                      stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>
                    {{ 'ORDERS.EDIT_PRINT_KITCHEN' | translate }}
                  </button>
                </div>
                <div class="eo-foot-right">
                  @if (order.status !== 'paid' && order.status !== 'cancelled' && canFinishOrder()) {
                    <button type="button" class="btn btn-success" (click)="markEditOrderFinish(order)"
                      [title]="'ORDERS.FINISH_ORDER_HELP' | translate">{{ 'ORDERS.EDIT_SERVE_AND_CHARGE' | translate }}</button>
                  }
                  @if (order.status !== 'paid' && order.status !== 'cancelled' && canMarkPaid()) {
                    <button type="button" class="btn btn-primary" (click)="markEditOrderAsPaid(order)">{{ 'ORDERS.EDIT_CHARGE' | translate }}</button>
                  }
                </div>
              </div>
            </div>
          </div>
        }

        <!-- Create Satisfecho Delivery Order Modal -->
        @if (createDeliveryOpen()) {
          <div class="modal-overlay">
            <div class="modal modal-order-edit" (click)="$event.stopPropagation()" appFocusFirstInput>
              <div class="modal-header">
                <h3>{{ 'ORDERS.NEW_DELIVERY_ORDER' | translate }}</h3>
                <button class="icon-btn" (click)="closeCreateDeliveryModal()">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
              <div class="modal-body">
                <p class="modal-hint">{{ 'ORDERS.NEW_DELIVERY_HINT' | translate }}</p>
                <div class="form-group">
                  <label for="delivery-address">{{ 'ORDERS.DELIVERY_ADDRESS' | translate }} *</label>
                  <input id="delivery-address" type="text" class="form-input" [(ngModel)]="deliveryFormAddress" name="deliveryAddress" required />
                </div>
                <div class="form-group">
                  <label for="delivery-phone">{{ 'ORDERS.DELIVERY_PHONE' | translate }}</label>
                  <input id="delivery-phone" type="tel" class="form-input" [(ngModel)]="deliveryFormPhone" name="deliveryPhone" />
                </div>
                <div class="form-group">
                  <label for="delivery-customer">{{ 'ORDERS.CUSTOMER' | translate }}</label>
                  <input id="delivery-customer" type="text" class="form-input" [(ngModel)]="deliveryFormCustomerName" name="deliveryCustomer" />
                </div>
                <div class="form-group">
                  <label for="delivery-notes">{{ 'ORDERS.ORDER_NOTES' | translate }}</label>
                  <textarea id="delivery-notes" class="form-input modifier-textarea" rows="2" [(ngModel)]="deliveryFormNotes" name="deliveryNotes"></textarea>
                </div>
                <div class="form-group">
                  <label for="delivery-courier">{{ 'ORDERS.COURIER' | translate }}</label>
                  <select id="delivery-courier" class="form-select" [(ngModel)]="deliveryFormCourierId" name="deliveryCourier">
                    <option [ngValue]="null">{{ 'COMMON.NONE' | translate }}</option>
                    @for (c of couriers(); track c.id) {
                      <option [ngValue]="c.id">{{ c.full_name || c.username }}</option>
                    }
                  </select>
                </div>
                <div class="edit-order-label">{{ 'ORDERS.ITEMS' | translate }} *</div>
                <div class="delivery-draft-items">
                  @for (line of deliveryDraftItems; track $index; let i = $index) {
                    <div class="edit-order-row">
                      <span class="edit-item-name">{{ line.name }} × {{ line.quantity }}</span>
                      <button type="button" class="btn btn-sm btn-secondary" (click)="removeDeliveryDraftItem(i)">{{ 'ORDERS.REMOVE_ITEM' | translate }}</button>
                    </div>
                  }
                </div>
                <div class="add-items-row">
                  <select class="form-select" [(ngModel)]="deliveryAddProductId" name="deliveryAddProduct">
                    <option [ngValue]="null">{{ 'COMMON.SELECT' | translate }}</option>
                    @for (p of deliveryProducts(); track p.id) {
                      <option [ngValue]="p.id">{{ p.name }} — {{ formatPrice(p.price_cents) }}</option>
                    }
                  </select>
                  <input type="number" class="quantity-input" [(ngModel)]="deliveryAddQuantity" min="1" name="deliveryAddQty" />
                  <button type="button" class="btn btn-secondary" (click)="addDeliveryDraftItem()" [disabled]="!deliveryAddProductId || deliveryAddQuantity < 1">
                    {{ 'COMMON.ADD' | translate }}
                  </button>
                </div>
              </div>
              <div class="modal-actions">
                <button type="button" class="btn btn-secondary" (click)="closeCreateDeliveryModal()">{{ 'COMMON.CANCEL' | translate }}</button>
                <button type="button" class="btn btn-primary" (click)="submitCreateDelivery()" [disabled]="creatingDelivery() || !deliveryFormAddress.trim() || deliveryDraftItems.length === 0">
                  {{ creatingDelivery() ? ('COMMON.LOADING' | translate) : ('ORDERS.CREATE_DELIVERY' | translate) }}
                </button>
              </div>
            </div>
          </div>
        }

        <!-- Edit Satisfecho Delivery metadata Modal -->
        @if (editDeliveryOrder(); as dOrder) {
          <div class="modal-overlay">
            <div class="modal modal-order-edit" (click)="$event.stopPropagation()" appFocusFirstInput>
              <div class="modal-header">
                <h3>{{ 'ORDERS.EDIT_DELIVERY' | translate }} — #{{ dOrder.id }}</h3>
                <button class="icon-btn" (click)="closeEditDeliveryModal()">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
              <div class="modal-body">
                <div class="form-group">
                  <label for="edit-delivery-address">{{ 'ORDERS.DELIVERY_ADDRESS' | translate }} *</label>
                  <input id="edit-delivery-address" type="text" class="form-input" [(ngModel)]="deliveryFormAddress" name="editDeliveryAddress" />
                </div>
                <div class="form-group">
                  <label for="edit-delivery-phone">{{ 'ORDERS.DELIVERY_PHONE' | translate }}</label>
                  <input id="edit-delivery-phone" type="tel" class="form-input" [(ngModel)]="deliveryFormPhone" name="editDeliveryPhone" />
                </div>
                <div class="form-group">
                  <label for="edit-delivery-customer">{{ 'ORDERS.CUSTOMER' | translate }}</label>
                  <input id="edit-delivery-customer" type="text" class="form-input" [(ngModel)]="deliveryFormCustomerName" name="editDeliveryCustomer" />
                </div>
                <div class="form-group">
                  <label for="edit-delivery-notes">{{ 'ORDERS.ORDER_NOTES' | translate }}</label>
                  <textarea id="edit-delivery-notes" class="form-input modifier-textarea" rows="2" [(ngModel)]="deliveryFormNotes" name="editDeliveryNotes"></textarea>
                </div>
                <div class="form-group">
                  <label for="edit-delivery-courier">{{ 'ORDERS.COURIER' | translate }}</label>
                  <select id="edit-delivery-courier" class="form-select" [(ngModel)]="deliveryFormCourierId" name="editDeliveryCourier">
                    <option [ngValue]="null">{{ 'COMMON.NONE' | translate }}</option>
                    @for (c of couriers(); track c.id) {
                      <option [ngValue]="c.id">{{ c.full_name || c.username }}</option>
                    }
                  </select>
                </div>
              </div>
              <div class="modal-actions">
                <button type="button" class="btn btn-secondary" (click)="closeEditDeliveryModal()">{{ 'COMMON.CANCEL' | translate }}</button>
                <button type="button" class="btn btn-primary" (click)="submitEditDelivery()" [disabled]="savingDelivery() || !deliveryFormAddress.trim()">
                  {{ savingDelivery() ? ('COMMON.LOADING' | translate) : ('COMMON.SAVE' | translate) }}
                </button>
              </div>
            </div>
          </div>
        }

        <!-- Print Factura Modal -->
        @if (facturaOrder()) {
          <div class="modal-overlay">
            <div class="modal modal-edit-order" (click)="$event.stopPropagation()" appFocusFirstInput>
              <div class="modal-header">
                <h3>{{ facturaModalEditMode() ? ('ORDERS.EDIT_ORDER' | translate) : ('CUSTOMERS.PRINT_FACTURA' | translate) }}</h3>
                <button class="icon-btn" (click)="closeFacturaModal()">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
              <div class="modal-body">
                <p class="order-summary">{{ 'ORDERS.ORDER_ID' | translate }}{{ facturaOrder()!.id }} — {{ facturaOrder()!.table_name }} — {{ formatPrice(facturaOrder()!.total_cents) }}</p>
                <div class="form-group">
                  <label for="factura-customer">{{ 'CUSTOMERS.SELECT_FOR_FACTURA' | translate }}</label>
                  <select id="factura-customer" class="form-select" [(ngModel)]="facturaCustomerId" name="facturaCustomer">
                    <option [ngValue]="null">{{ 'COMMON.NONE' | translate }}</option>
                    @for (c of facturaCustomers(); track c.id) {
                      <option [ngValue]="c.id">{{ c.company_name || c.name }}{{ c.tax_id ? ' (' + c.tax_id + ')' : '' }}</option>
                    }
                  </select>
                </div>

                @if (dianInvoicingEnabled()) {
                  <div class="divider"></div>
                  <h4>{{ 'ORDERS.DIAN_SECTION_TITLE' | translate }}</h4>
                  <p class="hint">{{ 'ORDERS.DIAN_SECTION_HINT' | translate }}</p>

                  @if (dianInvoiceError()) {
                    <p class="error-text">{{ dianInvoiceError() }}</p>
                  }

                  @if (dianInvoice(); as di) {
                    <p class="order-summary">
                      @if (di.document_type === 'credit_note') {
                        {{ 'ORDERS.DIAN_CREDIT_NOTE_ISSUED' | translate }}
                      } @else {
                        {{ 'ORDERS.DIAN_STATUS' | translate }}: <strong>{{ di.status }}</strong>
                      }
                      ({{ di.submission_status }}, {{ di.provider }})
                      @if (di.cufe) {
                        <br>CUFE: {{ di.cufe }}
                      }
                      @if (di.error_message) {
                        <br><span class="error-text">{{ di.error_message }}</span>
                      }
                    </p>
                    @if (di.status === 'issued' && di.document_type === 'invoice') {
                      <button type="button" class="btn btn-secondary" [disabled]="dianInvoiceLoading()" (click)="cancelDianInvoiceSimulation()">
                        {{ dianInvoiceLoading() ? ('COMMON.LOADING' | translate) : ('ORDERS.DIAN_CANCEL' | translate) }}
                      </button>
                    }
                  } @else {
                    <button type="button" class="btn btn-secondary" [disabled]="dianInvoiceLoading()" (click)="issueDianInvoiceSimulation()">
                      {{ dianInvoiceLoading() ? ('COMMON.LOADING' | translate) : ('ORDERS.DIAN_ISSUE' | translate) }}
                    </button>
                  }
                }
              </div>
              <div class="modal-actions">
                <button type="button" class="btn btn-secondary" (click)="closeFacturaModal()">{{ 'COMMON.CANCEL' | translate }}</button>
                @if (facturaModalEditMode()) {
                  <button type="button" class="btn btn-secondary" (click)="printFacturaAndClose()">
                    {{ 'ORDERS.PRINT_INVOICE' | translate }}
                  </button>
                  <button type="button" class="btn btn-primary" (click)="saveFacturaCustomerAndClose()">
                    {{ 'COMMON.SAVE' | translate }}
                  </button>
                } @else {
                  <button type="button" class="btn btn-primary" (click)="printFacturaAndClose()">
                    {{ 'ORDERS.PRINT_INVOICE' | translate }}
                  </button>
                }
              </div>
            </div>
          </div>
        }

        <!-- Mark as Paid / Finish order Modal -->
        @if (orderToMarkPaid()) {
          <div class="modal-overlay">
            <div class="modal" (click)="$event.stopPropagation()" appFocusFirstInput>
              <div class="modal-header">
                <h3>{{ paymentModalFinishMode() ? ('ORDERS.FINISH_ORDER_TITLE' | translate) : ('ORDERS.MARK_ORDER_AS_PAID' | translate) }}</h3>
                <button class="icon-btn" (click)="closePaymentModal()">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
              <div class="modal-body">
                <p>{{ 'ORDERS.ORDER_ID' | translate }}{{ orderToMarkPaid()!.id }}</p>
                <p class="payment-amount-line">
                  {{ 'ORDERS.SUBTOTAL' | translate }}: {{ formatPrice(orderPaymentSubtotal(orderToMarkPaid()!)) }}
                </p>
                <div class="extra-block">
                  @if (extraEditorOpen()) {
                    <div class="extra-panel">
                      <div class="extra-inline">
                        <span class="extra-currency">$</span>
                        <input id="payment-extra-amount" class="extra-amount" type="text" inputmode="decimal"
                          placeholder="0"
                          [value]="extraChargeInputValue(orderToMarkPaid()!)"
                          (input)="paymentExtraInput = $any($event.target).value" />
                        <button type="button" class="extra-ok" (click)="applyExtraCharge()"
                          [attr.aria-label]="'ORDERS.EXTRA_CHARGE_APPLY' | translate">✓</button>
                        <button type="button" class="extra-x" (click)="extraEditorOpen.set(false)"
                          [attr.aria-label]="'COMMON.CANCEL' | translate">✕</button>
                      </div>
                      <div class="extra-chips">
                        @for (v of extraQuickAmounts; track v) {
                        <button type="button" class="extra-chip" (click)="addExtraAmount(v)">+{{ formatPrice(v * 100) }}</button>
                        }
                      </div>
                    </div>
                  } @else if ((orderToMarkPaid()!.extra_charge_cents || 0) > 0) {
                    <button type="button" class="extra-pill extra-pill-on" (click)="extraEditorOpen.set(true)">
                      <span>✨ {{ 'ORDERS.EXTRA_CHARGE' | translate }}</span>
                      <strong>+ {{ formatPrice(orderToMarkPaid()!.extra_charge_cents || 0) }}</strong>
                    </button>
                  } @else {
                    <button type="button" class="extra-pill" (click)="extraEditorOpen.set(true)">
                      <span class="extra-plus">+</span> {{ 'ORDERS.EXTRA_CHARGE' | translate }}
                    </button>
                  }
                </div>
                @if (paymentModalFinishMode()) {
                  <p class="modal-hint">{{ 'ORDERS.FINISH_ORDER_HELP' | translate }}</p>
                } @else {
                  <p class="modal-hint">{{ 'ORDERS.PAY_NOW_HELP' | translate }}</p>
                }
                @if (orderToMarkPaid(); as payOrder) {
                  <div class="split-pay-summary" data-testid="split-pay-summary">
                    <p class="modal-hint">
                      {{ 'ORDERS.AMOUNT_DUE' | translate }}: {{ formatPrice(paymentAmountDueCents(payOrder)) }}
                      @if ((payOrder.amount_paid_cents || 0) > 0) {
                        — {{ 'ORDERS.AMOUNT_PAID' | translate }}: {{ formatPrice(payOrder.amount_paid_cents || 0) }}
                        — {{ 'ORDERS.AMOUNT_REMAINING' | translate }}: {{ formatPrice(paymentAmountRemainingCents(payOrder)) }}
                      }
                    </p>
                    @if (payOrder.payments && payOrder.payments.length > 0) {
                      <ul class="split-pay-list" data-testid="split-pay-list">
                        @for (p of payOrder.payments; track p.id) {
                          <li>
                            {{ formatPrice(p.amount_cents) }} · {{ p.payment_method }}
                            @if (p.payer_label) { ({{ p.payer_label }}) }
                          </li>
                        }
                      </ul>
                    }
                    @if (!paymentModalFinishMode() && paymentAmountRemainingCents(payOrder) > 0) {
                      <div class="form-group" data-testid="split-by-line">
                        <label>{{ 'ORDERS.SPLIT_BY_LINE' | translate }}</label>
                        <p class="modal-hint">{{ 'ORDERS.SPLIT_BY_LINE_HINT' | translate }}</p>
                        <ul class="split-line-list">
                          @for (item of payableSplitLines(payOrder); track item.id) {
                            <li>
                              <label class="split-line-row">
                                <input
                                  type="checkbox"
                                  [checked]="isSplitLineSelected(item.id)"
                                  (change)="toggleSplitLine(item.id)"
                                  [attr.data-testid]="'split-line-' + item.id"
                                />
                                <span>
                                  {{ item.quantity }}× {{ item.product_name }}
                                  — {{ formatPrice((item.price_cents || 0) * (item.quantity || 0)) }}
                                </span>
                              </label>
                            </li>
                          }
                        </ul>
                        @if (selectedSplitLineTotalCents(payOrder) > 0) {
                          <p class="modal-hint" data-testid="split-line-total">
                            {{ 'ORDERS.SPLIT_LINE_TOTAL' | translate }}:
                            {{ formatPrice(selectedSplitLineTotalCents(payOrder)) }}
                          </p>
                        }
                      </div>
                      <div class="form-group">
                        <label for="partial-pay-amount">{{ 'ORDERS.PARTIAL_PAYMENT_AMOUNT' | translate }}</label>
                        <input
                          id="partial-pay-amount"
                          type="text"
                          inputmode="decimal"
                          class="form-control"
                          [(ngModel)]="partialPaymentAmountInput"
                          name="partialPaymentAmount"
                          data-testid="partial-pay-amount"
                          [disabled]="selectedSplitLineIds.size > 0"
                        />
                      </div>
                      <div class="form-group">
                        <label for="partial-pay-label">{{ 'ORDERS.PAYER_LABEL' | translate }}</label>
                        <input
                          id="partial-pay-label"
                          type="text"
                          class="form-control"
                          [(ngModel)]="partialPaymentPayerLabel"
                          name="partialPaymentPayerLabel"
                          data-testid="partial-pay-label"
                          [placeholder]="'ORDERS.PAYER_LABEL_HINT' | translate"
                        />
                      </div>
                      <button
                        type="button"
                        class="btn btn-secondary"
                        data-testid="record-partial-payment"
                        (click)="confirmPartialPayment()"
                        [disabled]="processingPayment()"
                      >
                        {{ 'ORDERS.RECORD_PARTIAL_PAYMENT' | translate }}
                      </button>
                    }
                  </div>
                }
                <div class="form-group">
                  <label for="payment-method">{{ 'ORDERS.PAYMENT_METHOD' | translate }}</label>
                  <select id="payment-method" [(ngModel)]="paymentMethod" class="form-select">
                    <option value="cash">{{ 'ORDERS.CASH' | translate }}</option>
                    <option value="terminal">{{ 'ORDERS.CARD_TERMINAL' | translate }}</option>
                    <option value="transfer">{{ 'ORDERS.TRANSFER' | translate }}</option>
                    <option value="other">{{ 'ORDERS.OTHER' | translate }}</option>
                  </select>
                </div>
              </div>
              <div class="modal-actions">
                <button class="btn btn-secondary" (click)="closePaymentModal()">{{ 'ORDERS.CANCEL' | translate }}</button>
                <button class="btn btn-primary" (click)="confirmMarkAsPaid()" [disabled]="processingPayment()">
                  @if (processingPayment()) {
                    {{ 'ORDERS.PROCESSING' | translate }}
                  } @else if (paymentModalFinishMode()) {
                    {{ 'ORDERS.FINISH_ORDER_CONFIRM' | translate }}
                  } @else {
                    {{ 'ORDERS.MARK_AS_PAID' | translate }}
                  }
                </button>
              </div>
            </div>
          </div>
        }

        <!-- Confirmation Modal (replaces native confirm/prompt) -->
        @if (confirmAction()) {
          <div class="modal-overlay" (click)="closeConfirmModal()">
            <div class="modal" (click)="$event.stopPropagation()" appFocusFirstInput>
              <div class="modal-header">
                <h3>{{ 'COMMON.CONFIRM' | translate }}</h3>
                <button class="icon-btn" (click)="closeConfirmModal()">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
              <div class="modal-body">
                <p>{{ confirmAction()!.message }}</p>
                @if (confirmAction()!.requireReason) {
                  <div class="form-group">
                    <textarea 
                      class="form-textarea"
                      [(ngModel)]="confirmReason"
                      rows="3"
                      [placeholder]="'COMMON.DESCRIPTION' | translate"
                    ></textarea>
                  </div>
                }
              </div>
              <div class="modal-actions">
                <button class="btn btn-secondary" (click)="closeConfirmModal()">{{ 'COMMON.CANCEL' | translate }}</button>
                <button class="btn btn-primary" (click)="handleConfirm()">
                  {{ confirmAction()!.confirmText || ('COMMON.CONFIRM' | translate) }}
                </button>
              </div>
            </div>
          </div>
        }

        <!-- Toast Notification -->
        @if (toast()) {
          <div class="toast" [class]="toast()!.type">
            <span>{{ toast()!.message }}</span>
            <button class="toast-close" (click)="toast.set(null)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        }

    </app-sidebar>
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-5); }
    .page-header.page-header--staff-flow {
      flex-direction: column;
      align-items: stretch;
      gap: 0;
    }
    .page-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-4);
    }
    .page-header h1 { font-size: 1.5rem; font-weight: 600; color: var(--color-text); margin: 0; }

    .orders-table-scope-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      margin-bottom: var(--space-4);
      background: var(--color-primary-light);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      font-size: 0.9375rem;
      font-weight: 500;
      color: var(--color-text);
    }

    .page-header-actions {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .order-delivery-meta {
      font-size: 0.8125rem;
      color: var(--color-text-muted);
      padding: 0.35rem 0.75rem 0.5rem;
      line-height: 1.4;
      border-bottom: 1px solid var(--color-border, #E7E5E4);
    }
    .order-channel-badge {
      display: inline-block;
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      background: rgba(211, 82, 51, 0.12);
      color: #D35233;
      margin-left: 0.35rem;
    }
    .order-channel-badge.marketplace {
      background: rgba(59, 130, 246, 0.12);
      color: #2563eb;
    }
    .delivery-draft-items {
      margin-bottom: 0.75rem;
    }
        .filter-tabs {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
      border-bottom: 2px solid var(--color-border);
    }
    .filter-tab {
      padding: var(--space-3) var(--space-4);
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-text-muted);
      cursor: pointer;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: -2px;
    }
    .filter-tab:hover {
      color: var(--color-text);
    }
    .filter-tab.active {
      color: var(--color-primary);
      border-bottom-color: var(--color-primary);
    }
    .tab-badge {
      background: var(--color-primary);
      color: white;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .section-header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); }
    .section-header h2 { font-size: 1.125rem; font-weight: 600; color: var(--color-text); margin: 0; }
    .history-header { margin-top: var(--space-6); }
    .badge {
      padding: var(--space-1) var(--space-3); border-radius: 20px; font-size: 0.75rem; font-weight: 600;
      background: var(--color-primary); color: white;
      &.secondary { background: var(--color-text-muted); }
    }

    .btn { display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-4); border: none; border-radius: var(--radius-md); font-size: 0.875rem; font-weight: 500; cursor: pointer; transition: all 0.15s ease; }
    .btn-primary { background: var(--color-primary); color: white; &:hover { background: var(--color-primary-hover); } }
    .btn-secondary { background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border); &:hover { background: var(--color-border); } }
    .btn-success { background: var(--color-success); color: white; &:hover { background: #15803d; } }
    .btn-sm { padding: var(--space-2) var(--space-3); font-size: 0.8125rem; }

    .empty-state {
      text-align: center; padding: var(--space-8); background: var(--color-surface);
      border: 1px dashed var(--color-border); border-radius: var(--radius-lg);
      .empty-icon { color: var(--color-text-muted); margin-bottom: var(--space-4); }
      h3 { margin: 0 0 var(--space-2); font-size: 1.125rem; color: var(--color-text); }
      p { margin: 0; color: var(--color-text-muted); }
    }

    .order-grid { 
      display: grid; 
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: var(--space-4); 
      align-items: start;
    }
    
    .grid-container {
      width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }

    .order-card {
      position: relative;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-left: 4px solid transparent;
      border-radius: var(--radius-lg);
      overflow: visible;
      box-shadow: var(--shadow-sm);
      transition: box-shadow 0.2s ease, transform 0.2s ease;
      max-width: 100%;
      z-index: 1;
      &:hover {
        box-shadow: var(--shadow-md);
        transform: translateY(-2px);
      }
      &.status-dropdown-open {
        z-index: 9998;
      }
      &.status-pending { border-left-color: var(--color-warning); }
      &.status-preparing { border-left-color: #3B82F6; }
      &.status-ready { border-left-color: var(--color-success); }
      &.status-paid { border-left-color: var(--color-success); }
      &.status-completed { border-left-color: var(--color-text-muted); }
    }

    .order-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-4);
      border-bottom: 1px solid var(--color-border);
      margin-bottom: var(--space-3);
    }
    .order-header-main { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; flex: 1; }
    .btn-edit-order {
      display: inline-flex; align-items: center; gap: var(--space-2);
      padding: var(--space-2) var(--space-3); min-height: 44px;
      border-radius: 14px; font-size: 0.875rem; font-weight: 500;
      border: 1px solid var(--color-border); background: var(--color-surface);
      color: var(--color-text); cursor: pointer; transition: all 0.15s;
    }
    .btn-edit-order:hover { background: var(--color-bg); box-shadow: 0 2px 6px rgba(0,0,0,0.08); }
    .btn-urgent {
      display: inline-flex; align-items: center; gap: var(--space-2);
      padding: var(--space-2) var(--space-3); min-height: 44px;
      border-radius: 14px; font-size: 0.8125rem; font-weight: 600;
      border: 1px solid rgba(220, 38, 38, 0.35); background: rgba(220, 38, 38, 0.08);
      color: #b91c1c; cursor: pointer; transition: all 0.15s;
    }
    .btn-urgent:hover { background: rgba(220, 38, 38, 0.14); }
    .order-urgent-badge {
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
      color: #b91c1c; background: rgba(220, 38, 38, 0.1);
      padding: 2px 8px; border-radius: 6px; width: fit-content;
    }
    .order-hub-badge {
      font-size: 0.75rem; font-weight: 700; letter-spacing: 0.02em;
      color: #1e40af; background: rgba(37, 99, 235, 0.1);
      padding: 2px 8px; border-radius: 6px; width: fit-content;
    }
    .order-hub-badge.prepared {
      color: #166534; background: rgba(22, 163, 74, 0.12);
    }
    .btn-delete-order {
      display: inline-flex; align-items: center; gap: var(--space-2);
      padding: var(--space-2) var(--space-3); min-height: 44px;
      border-radius: 14px; font-size: 0.875rem; font-weight: 500;
      border: 1px solid var(--color-border); background: var(--color-surface);
      color: var(--color-text-muted); cursor: pointer; transition: all 0.15s;
    }
    .btn-delete-order:hover { background: rgba(220, 38, 38, 0.08); color: var(--color-error, #dc2626); border-color: rgba(220, 38, 38, 0.3); }
    .order-id { font-weight: 600; color: var(--color-text); }
    .order-table { color: var(--color-text-muted); font-size: 0.875rem; }
    .order-table-group { color: var(--color-text-muted); font-size: 0.75rem; margin-left: 0.35rem; opacity: 0.9; }
    .order-customer { color: var(--color-primary); font-size: 0.875rem; font-weight: 500; }
    .order-time { color: var(--color-text-muted); font-size: 0.75rem; }

    .status-badge {
      padding: var(--space-1) var(--space-3); border-radius: 20px; font-size: 0.75rem; font-weight: 600;
      &.pending { background: rgba(245, 158, 11, 0.15); color: var(--color-warning); }
      &.preparing { background: rgba(59, 130, 246, 0.15); color: #3B82F6; }
      &.ready { background: var(--color-success-light); color: var(--color-success); }
      &.paid { background: var(--color-success-light); color: var(--color-success); }
      &.completed { background: var(--color-bg); color: var(--color-text-muted); }
    }

    .order-items { padding: 0 var(--space-4); }
    .order-item { 
      display: flex; 
      flex-direction: column;
      gap: var(--space-1); 
      padding: var(--space-3) 0; 
      font-size: 0.9375rem; 
    }
    .order-item:not(:last-child) { border-bottom: 1px solid var(--color-border); }
    .order-item.removed { 
      opacity: 0.6; 
      text-decoration: line-through;
      background: var(--color-bg);
      padding: var(--space-3);
      margin: 0 calc(-1 * var(--space-4));
      padding-left: var(--space-4);
      padding-right: var(--space-4);
    }
    .item-name-row { 
      display: flex; 
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .item-details-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
    }
    .item-actions {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .item-qty { 
      font-weight: 600; 
      color: var(--color-primary); 
      flex-shrink: 0;
    }
    .quantity-input {
      width: 42px;
      padding: 4px 4px;
      border: 1px solid var(--color-border);
      border-radius: 4px;
      font-size: 0.875rem;
      text-align: center;
      background: var(--color-surface);
      color: var(--color-text);
      box-sizing: border-box;
    }
    .quantity-input:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 2px var(--color-primary-light);
    }
    .item-name { 
      color: var(--color-text); 
      font-weight: 500;
    }
    .item-customization {
      width: 100%;
      font-size: 0.8125rem;
      color: var(--color-text-muted);
    }
    .item-notes {
      width: 100%;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-warning);
      font-style: italic;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .order-notes-banner {
      margin: 0 var(--space-4) var(--space-2);
      padding: var(--space-2) var(--space-3);
      background: rgba(245, 158, 11, 0.1);
      border-left: 3px solid var(--color-warning);
      font-size: 0.875rem;
      color: var(--color-text);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .item-price { 
      color: var(--color-text-muted); 
      font-size: 0.875rem;
    }
    .price-total {
      color: var(--color-text-muted);
      font-size: 0.75rem;
      font-weight: 400;
      margin-left: 4px;
    }
    .btn-remove-item {
      background: none;
      border: none;
      color: var(--color-error);
      cursor: pointer;
      min-width: 44px;
      min-height: 44px;
      padding: var(--space-2);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      opacity: 0.7;
      transition: opacity 0.15s;
    }
    .btn-remove-item:hover {
      opacity: 1;
    }
    .item-status-badge {
      min-height: 44px;
      padding: var(--space-2) var(--space-3);
      border-radius: 14px;
      font-size: 0.875rem;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
      border: 1px solid var(--color-border);
    }
    .item-status-badge.status-pending { 
      background: rgba(245, 158, 11, 0.15); 
      color: var(--color-warning);
    }
    .item-status-badge.status-pending.clickable:hover {
      background: var(--color-warning);
      color: white;
      transform: scale(1.05);
    }
    .item-status-badge.status-preparing { 
      background: rgba(59, 130, 246, 0.15); 
      color: #3B82F6;
    }
    .item-status-badge.status-preparing.clickable:hover {
      background: #3B82F6;
      color: white;
      transform: scale(1.05);
    }
    .item-status-badge.status-ready { 
      background: var(--color-success-light); 
      color: var(--color-success);
    }
    .item-status-badge.clickable {
      cursor: pointer;
      transition: all 0.15s;
      user-select: none;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .item-status-badge.clickable svg {
      transition: transform 0.15s;
    }
    .item-status-control:has(.item-status-dropdown:not([style*="display: none"])) .item-status-badge.clickable svg {
      transform: rotate(180deg);
    }
    .item-status-badge.status-ready.clickable:hover {
      background: var(--color-success);
      color: white;
      transform: scale(1.05);
    }
    .item-status-badge.status-delivered { 
      background: var(--color-bg); 
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
    }
    .item-status-badge.status-delivered.clickable:hover {
      background: rgba(59, 130, 246, 0.15);
      color: #3B82F6;
      border-color: #3B82F6;
      transform: scale(1.05);
    }
    .item-status-badge.status-cancelled { background: var(--color-bg); color: var(--color-text-muted); }
    .item-actions {
      display: flex;
      gap: var(--space-2);
      margin-top: var(--space-1);
    }
    .btn-xs {
      padding: 4px 8px;
      font-size: 0.75rem;
    }
    .btn-info {
      background: #3B82F6;
      color: white;
    }
    .btn-info:hover {
      background: #2563eb;
    }
    .btn-secondary {
      background: var(--color-text-muted);
      color: white;
    }
    .btn-secondary:hover {
      background: #57534e;
    }
    .btn-print,
    .btn-menu-link {
      background: var(--color-surface);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }
    .btn-print:hover,
    .btn-menu-link:hover {
      background: var(--color-bg);
    }
    .btn-danger {
      background: var(--color-error);
      color: white;
    }
    .btn-danger:hover {
      background: #dc2626;
    }
    .quantity-input:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 2px var(--color-primary-light);
    }
    .removed-indicator {
      display: flex;
      gap: var(--space-2);
      font-size: 0.75rem;
      color: var(--color-text-muted);
      font-style: italic;
      margin-top: var(--space-1);
    }
    .removed-label { color: var(--color-error); }
    .removed-time { color: var(--color-text-muted); }
    .removed-count {
      font-size: 0.75rem;
      color: var(--color-text-muted);
      font-style: italic;
    }
    .toggle-removed {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: 0.875rem;
      color: var(--color-text);
      cursor: pointer;
      margin-left: auto;
      padding: var(--space-2) var(--space-3);
    }
    .toggle-removed input[type="checkbox"] {
      cursor: pointer;
    }

    .order-footer { 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      padding: var(--space-4); 
      background: none;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-3);
      border-top: 1px solid var(--color-border);
      overflow: visible;
    }
    .order-footer-left {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }
    .order-total { font-weight: 600; color: var(--color-text); }
    .order-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: var(--space-2);
      position: relative;
      overflow: visible;
    }
    
    .status-control {
      position: relative;
      overflow: visible;
      z-index: 1;
    }
    .order-card.status-dropdown-open .status-control {
      z-index: 9999;
    }
    
    .status-badge-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-height: 44px;
      padding: var(--space-2) var(--space-3);
      border-radius: 14px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--color-border);
      transition: all 0.15s;
      position: relative;
    }
    .status-badge-btn svg {
      transition: transform 0.15s;
    }
    .status-control:has(.status-dropdown:not([style*="display: none"])) .status-badge-btn svg {
      transform: rotate(180deg);
    }
    .status-badge-btn.pending { background: rgba(245, 158, 11, 0.15); color: var(--color-warning); }
    .status-badge-btn.preparing { background: rgba(59, 130, 246, 0.15); color: #3B82F6; }
    .status-badge-btn.ready { background: var(--color-success-light); color: var(--color-success); }
    .status-badge-btn.completed { background: var(--color-bg); color: var(--color-text-muted); }
    .status-badge-btn.paid { background: var(--color-success-light); color: var(--color-success); }
    .status-badge-btn:hover {
      transform: scale(1.05);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    
    .status-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      right: auto;
      margin-top: 6px;
      margin-left: 0;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 10000;
      min-width: 220px;
      overflow: hidden;
    }
    .item-status-dropdown {
      min-width: 200px;
    }
    
    .dropdown-section {
      padding: var(--space-2) 0;
    }
    .dropdown-section:not(:last-child) {
      border-bottom: 1px solid var(--color-border);
    }
    
    .dropdown-label {
      padding: var(--space-2) var(--space-3);
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .dropdown-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      width: 100%;
      min-height: 48px;
      padding: var(--space-3) var(--space-4);
      background: none;
      border: none;
      text-align: left;
      font-size: 1rem;
      font-weight: 500;
      color: var(--color-text);
      cursor: pointer;
      transition: background 0.15s;
    }
    .dropdown-item:hover {
      background: var(--color-bg);
    }
    .dropdown-item.forward {
      color: var(--color-primary);
    }
    .dropdown-item.backward {
      color: var(--color-text-muted);
    }
    .dropdown-item svg {
      flex-shrink: 0;
    }
    
    .item-status-control {
      position: relative;
      display: inline-flex;
      z-index: 10;
    }
    .order-item:hover .item-status-control {
      z-index: 50;
    }
    /* Outrank the order-level status badge (z-index: 9999 while any dropdown in
       this card is open) so this item's own dropdown isn't covered by it.
       Needs to beat ".order-item:hover .item-status-control" too (more specific
       selector), so it's repeated under :hover with higher specificity. */
    .item-status-control:has(.item-status-dropdown),
    .order-item:hover .item-status-control:has(.item-status-dropdown) {
      z-index: 10001;
    }

    .grid-container {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }
    .grid-container .btn-factura-row,
    .grid-container .btn-edit-order-row {
      display: inline-flex !important;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      padding: 0 !important;
      cursor: pointer;
      background: #fff !important;
      color: #333 !important;
      border: 1px solid #ddd !important;
      border-radius: 8px;
      transition: background 0.15s ease;
    }
    .grid-container .btn-factura-row:hover,
    .grid-container .btn-edit-order-row:hover {
      background: #f5f5f5 !important;
    }
    .grid-container .btn-factura-row svg,
    .grid-container .btn-edit-order-row svg {
      flex-shrink: 0;
    }

    .mobile-header { display: none; position: fixed; top: 0; left: 0; right: 0; height: 56px; background: var(--color-surface); border-bottom: 1px solid var(--color-border); padding: 0 var(--space-4); align-items: center; gap: var(--space-3); z-index: 99; }
    .menu-toggle { display: flex; flex-direction: column; gap: 4px; background: none; border: none; padding: var(--space-2); cursor: pointer; }
    .menu-toggle span { display: block; width: 20px; height: 2px; background: var(--color-text); border-radius: 1px; }
    .header-title { font-weight: 700; color: var(--color-primary); }
    .overlay { display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); z-index: 99; }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal {
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      width: 90%;
      max-width: 400px;
      max-height: 90vh;
      overflow: hidden;
      box-shadow: var(--shadow-lg);
      display: flex;
      flex-direction: column;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--space-4);
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .modal-header h3 {
      margin: 0;
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--color-text);
    }

    .icon-btn {
      background: none;
      border: none;
      color: var(--color-text-muted);
      cursor: pointer;
      padding: var(--space-2);
      display: flex;
      align-items: center;
      transition: color 0.15s;
    }

    .icon-btn:hover {
      color: var(--color-text);
    }

    .modal-body {
      padding: var(--space-4);
      overflow-y: auto;
      flex: 1 1 auto;
      min-height: 0;
    }

    .modal-body p {
      margin: 0 0 var(--space-4);
      color: var(--color-text);
      font-weight: 500;
    }

    .modal-body p.modal-hint {
      margin-top: calc(-1 * var(--space-3));
      font-weight: 400;
      font-size: 0.875rem;
      color: var(--color-text-muted);
    }

    .payment-amount-line { margin-bottom: var(--space-3); }
    /* Additional charge: collapsed pill; the hint below has a negative top margin, so keep room */
    .extra-block { margin-bottom: var(--space-5, 20px); }
    .extra-pill {
      display: inline-flex; align-items: center; gap: 8px; max-width: 100%;
      padding: 6px 16px 6px 6px; border-radius: 999px; cursor: pointer;
      border: 1.5px dashed var(--color-primary);
      background: var(--color-primary-light); color: var(--color-primary);
      font-size: 0.9375rem; font-weight: 600; touch-action: manipulation;
      transition: transform 0.12s, box-shadow 0.15s;
    }
    .extra-pill:hover { box-shadow: 0 4px 12px color-mix(in srgb, var(--color-primary) 25%, transparent); }
    .extra-pill:active { transform: scale(0.97); }
    .extra-plus {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 50%; font-size: 1.125rem; line-height: 1;
      background: var(--color-primary); color: #fff;
    }
    .extra-pill-on {
      padding: 8px 16px; gap: 12px; border-style: solid; color: #fff;
      border-color: transparent;
      background: linear-gradient(135deg, var(--color-primary), var(--color-primary-hover));
      box-shadow: 0 4px 14px color-mix(in srgb, var(--color-primary) 35%, transparent);
    }
    .extra-panel {
      padding: 10px; border-radius: 16px;
      background: linear-gradient(160deg, var(--color-primary-light), transparent 75%);
      border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
    }
    .extra-inline { display: flex; align-items: center; gap: 8px; }
    .extra-currency { font-size: 1.5rem; font-weight: 700; color: var(--color-primary); padding-left: 4px; }
    .extra-inline input {
      flex: 1 1 0; min-width: 0; height: 46px; padding: 0 12px;
      border: 2px solid var(--color-primary); border-radius: 12px;
      font-size: 1.25rem; font-weight: 700;
      background: var(--color-surface); color: var(--color-text);
    }
    .extra-inline input:focus { outline: none; box-shadow: 0 0 0 3px var(--color-primary-light); }
    .extra-ok, .extra-x {
      flex: 0 0 42px; height: 42px; border: none; border-radius: 50%; cursor: pointer;
      touch-action: manipulation; transition: transform 0.12s;
    }
    .extra-ok:active, .extra-x:active { transform: scale(0.9); }
    .extra-ok {
      background: var(--color-primary); color: #fff; font-weight: 700; font-size: 1.125rem;
      box-shadow: 0 4px 12px color-mix(in srgb, var(--color-primary) 40%, transparent);
    }
    .extra-x { background: transparent; color: var(--color-text); opacity: 0.6; }
    .extra-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .extra-chip {
      padding: 0 12px; height: 32px; border-radius: 999px; cursor: pointer;
      border: 1px solid color-mix(in srgb, var(--color-primary) 40%, transparent);
      background: var(--color-surface); color: var(--color-primary);
      font-size: 0.8125rem; font-weight: 600; touch-action: manipulation;
    }
    .extra-chip:active { transform: scale(0.95); background: var(--color-primary-light); }
    .payment-tip-group .form-label-text {
      display: block;
      font-size: 0.875rem;
      font-weight: 600;
      margin-bottom: var(--space-2);
    }
    .tip-preset-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-bottom: var(--space-2);
    }
    .tip-preset-buttons .btn-sm {
      padding: var(--space-2) var(--space-3);
      font-size: 0.8125rem;
    }
    .payment-tip-preview { margin-top: var(--space-2); margin-bottom: 0; }

    .modal-order-edit { max-width: 520px; }
    /* Edit-order modal ("eo"): header with total, item cards, collapsed add panel, grouped footer */
    .modal-order-edit.eo { max-width: 560px; padding: 0; display: flex; flex-direction: column; max-height: 90vh; overflow: hidden; }
    .eo-head { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4) var(--space-4) var(--space-3);
      border-bottom: 1px solid var(--color-border); }
    .eo-head-main { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
    .eo-head-main h3 { margin: 0; font-size: 1.125rem; }
    .eo-status { font-size: 0.75rem; font-weight: 600; padding: 2px 10px; border-radius: 999px;
      background: var(--color-primary-light); color: var(--color-primary); }
    .eo-customer { font-size: 0.8125rem; color: var(--color-text-muted); }
    .eo-total { text-align: right; line-height: 1.1; }
    .eo-total small { display: block; font-size: 0.6875rem; text-transform: uppercase; color: var(--color-text-muted); }
    .eo-total strong { font-size: 1.375rem; color: var(--color-primary); }
    .eo-body { flex: 1; overflow-y: auto; padding: var(--space-3) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
    .eo-section-title { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-text-muted); }
    .eo-item { border: 1px solid var(--color-border); border-radius: 14px; padding: 10px 12px; background: var(--color-surface); }
    .eo-item-cancelled { opacity: 0.55; }
    .eo-item-cancelled .eo-item-name { text-decoration: line-through; }
    .eo-item-main { display: flex; align-items: center; gap: 12px; }
    .eo-item-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .eo-item-name { font-weight: 600; overflow-wrap: anywhere; }
    .eo-item-note { font-size: 0.8125rem; color: var(--color-text-muted); overflow-wrap: anywhere; }
    .eo-item-price { font-weight: 700; white-space: nowrap; }
    .eo-item-tools { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
    .eo-stepper { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border-radius: 999px;
      background: var(--color-primary-light); flex-shrink: 0; }
    .eo-stepper button { width: 32px; height: 32px; border: none; border-radius: 50%; cursor: pointer;
      background: var(--color-primary); color: #fff; font-size: 1.125rem; line-height: 1; touch-action: manipulation; }
    .eo-stepper button:disabled { opacity: 0.35; cursor: default; }
    .eo-stepper span { min-width: 24px; text-align: center; font-weight: 700; }
    .eo-status-select { height: 34px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--color-border);
      background: var(--color-surface); color: var(--color-text); font-size: 0.8125rem; font-weight: 600; }
    .eo-link { border: none; background: none; color: var(--color-primary); font-weight: 600; font-size: 0.8125rem;
      cursor: pointer; padding: 6px 4px; }
    .eo-trash { margin-left: auto; width: 36px; height: 36px; border: none; border-radius: 50%; cursor: pointer;
      background: color-mix(in srgb, var(--color-error) 12%, transparent); color: var(--color-error);
      display: inline-flex; align-items: center; justify-content: center; touch-action: manipulation; }
    .eo-trash:hover { background: var(--color-error); color: #fff; }
    .eo-custom { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; padding-top: 10px;
      border-top: 1px dashed var(--color-border); }
    .eo-custom label { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; color: var(--color-text-muted); }
    .eo-custom .btn { align-self: flex-start; }
    .eo-pill { align-self: flex-start; display: inline-flex; align-items: center; gap: 8px; padding: 6px 16px 6px 6px;
      border-radius: 999px; cursor: pointer; border: 1.5px dashed var(--color-primary);
      background: var(--color-primary-light); color: var(--color-primary); font-weight: 600; touch-action: manipulation; }
    .eo-plus { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px;
      border-radius: 50%; background: var(--color-primary); color: #fff; font-size: 1.125rem; line-height: 1; }
    .eo-bill { display: flex; flex-direction: column; gap: 4px; }
    .eo-bill label { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-text-muted); }
    .eo-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px;
      padding: var(--space-3) var(--space-4); border-top: 1px solid var(--color-border); background: var(--color-surface); }
    .eo-foot-left, .eo-foot-right { display: flex; flex-wrap: wrap; gap: 8px; }
    .eo-ghost { display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 12px; border-radius: 999px;
      border: 1px solid var(--color-border); background: transparent; color: var(--color-text); font-size: 0.8125rem;
      font-weight: 600; cursor: pointer; touch-action: manipulation; }
    .eo-ghost:hover { background: var(--color-primary-light); }
    .edit-order-items { margin-bottom: var(--space-4); }
    .edit-order-label { font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; margin-bottom: var(--space-2); }
    .edit-order-row {
      display: flex; align-items: center; gap: var(--space-2);
      padding: var(--space-2) 0;
    }
    .modal-order-edit .edit-order-row { border-bottom: none; }
    .edit-order-row .edit-item-name { flex: 1; min-width: 0; font-size: 0.9375rem; }
    .edit-order-row .quantity-input { width: 56px; }
    .edit-order-row .edit-item-status { width: 120px; }
    .edit-order-row .btn-remove-item { flex-shrink: 0; padding: var(--space-2); color: var(--color-text-muted); border: none; background: none; cursor: pointer; border-radius: 6px; }
    .edit-order-row .btn-remove-item:hover { color: var(--color-error, #dc2626); background: rgba(0,0,0,0.05); }
    .add-items-section .add-items-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
    .add-items-section .add-items-row .form-select { flex: 1; min-width: 160px; }
    .add-items-section .add-items-row .quantity-input { width: 56px; }
    .edit-order-item-block { border-bottom: 1px solid var(--color-border); padding-bottom: var(--space-2); margin-bottom: var(--space-1); }
    .edit-order-item-block:last-child { border-bottom: none; }
    .modifier-edit-fields, .add-modifiers-fields {
      display: flex; flex-direction: column; gap: var(--space-1);
      margin-top: var(--space-2); padding-left: var(--space-1);
    }
    .modifier-label { font-size: 0.6875rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; margin-top: var(--space-1); }
    .modifier-textarea { resize: vertical; min-height: 2.5rem; font-family: inherit; }
    .add-modifiers-fields { margin-top: var(--space-3); }

    .form-group {
      margin-bottom: var(--space-4);
    }

    .form-group label {
      display: block;
      margin-bottom: var(--space-2);
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text);
    }

    .form-select {
      width: 100%;
      padding: var(--space-3);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      font-size: 0.9375rem;
      background: var(--color-surface);
      color: var(--color-text);
    }

    .form-select:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px var(--color-primary-light);
    }

    .form-input {
      width: 100%;
      padding: var(--space-3);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      font-size: 0.9375rem;
      background: var(--color-surface);
      color: var(--color-text);
      box-sizing: border-box;
    }
    .form-input:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px var(--color-primary-light);
    }

    .modal-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      justify-content: flex-end;
      align-items: center;
      width: 100%;
      box-sizing: border-box;
      padding: var(--space-4);
      border-top: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .modal-actions .btn {
      flex: 0 1 auto;
      min-width: 6rem;
    }

    @media (max-width: 768px) {
      .mobile-header { display: flex; }
      .sidebar { transform: translateX(-100%); transition: transform 0.25s ease; }
      .sidebar-open .sidebar { transform: translateX(0); }
      .sidebar-open .overlay { display: block; }
      .close-btn { display: block; }
      .main { margin-left: 0; padding: calc(56px + var(--space-4)) var(--space-4) var(--space-4); }
      .order-grid { grid-template-columns: 1fr; }
      
      .grid-container {
        margin-left: calc(-1 * var(--space-4));
        margin-right: calc(-1 * var(--space-4));
        padding: 0 var(--space-4);
      }
      
      .status-dropdown {
        min-width: 200px;
      }
      .item-status-dropdown {
        right: 0;
        left: auto;
      }
    }

    /* Toast Notification */
    .toast {
      position: fixed;
      bottom: var(--space-6);
      right: var(--space-6);
      padding: var(--space-4) var(--space-5);
      background: var(--color-surface);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      display: flex;
      align-items: center;
      gap: var(--space-3);
      z-index: 1100;
      animation: slideInUp 0.3s ease;
      max-width: 400px;
      border-left: 4px solid var(--color-text-muted);
    }
    .toast.success {
      border-left-color: var(--color-success);
    }
    .toast.error {
      border-left-color: var(--color-error);
    }
    .toast-close {
      background: none;
      border: none;
      color: var(--color-text-muted);
      cursor: pointer;
      padding: 4px;
      display: flex;
      transition: color 0.15s;
    }
    .toast-close:hover {
      color: var(--color-text);
    }
    @keyframes slideInUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .error-text {
      color: #d32f2f;
      font-size: 0.85rem;
      margin: 4px 0;
    }

    .split-pay-summary {
      margin: var(--space-3) 0;
      padding: var(--space-3) 0;
      border-top: 1px solid var(--color-border);
    }
    .split-pay-list {
      margin: 0.5rem 0 0.75rem;
      padding-left: 1.25rem;
      font-size: 0.875rem;
      color: var(--color-text-muted, #666);
    }
    .split-line-list {
      list-style: none;
      margin: 0.35rem 0 0.5rem;
      padding: 0;
      max-height: 10rem;
      overflow: auto;
    }
    .split-line-row {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      margin-bottom: 0.35rem;
      cursor: pointer;
      font-size: 0.875rem;
    }
    .split-pay-summary .btn {
      margin-bottom: var(--space-3);
    }
    @keyframes slideDown {
      from { transform: translateY(-100%); }
      to { transform: translateY(0); }
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.85; }
    }
    @keyframes ring {
      0%, 100% { transform: rotate(0); }
      25% { transform: rotate(15deg); }
      75% { transform: rotate(-15deg); }
    }

    /* Form textarea */
    .form-textarea {
      width: 100%;
      padding: var(--space-3);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      font-size: 0.9375rem;
      font-family: var(--font-sans);
      background: var(--color-surface);
      color: var(--color-text);
      resize: vertical;
      min-height: 80px;
    }
    .form-textarea:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px var(--color-primary-light);
    }
  `]
})
export class OrdersComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private audio = inject(AudioService);
  private translate = inject(TranslateService);
  private permissions = inject(PermissionService);
  private printBridge = inject(PrintBridgeService);

  // Permission checks for UI
  canUpdateStatus = computed(() => this.permissions.hasPermission(this.api.getCurrentUser(), 'order:update_status'));
  canUpdateItemStatus = computed(() => this.permissions.hasPermission(this.api.getCurrentUser(), 'order:item_status'));
  canMarkPaid = computed(() => this.permissions.hasPermission(this.api.getCurrentUser(), 'order:mark_paid'));
  /** Finish (deliver all + pay) needs both status updates and mark-paid (same as backend). */
  canFinishOrder = computed(() =>
    this.permissions.hasPermission(this.api.getCurrentUser(), 'order:update_status') &&
    this.permissions.hasPermission(this.api.getCurrentUser(), 'order:mark_paid')
  );
  canCancelOrder = computed(() => this.permissions.hasPermission(this.api.getCurrentUser(), 'order:cancel'));
  canRemoveItem = computed(() => this.permissions.hasPermission(this.api.getCurrentUser(), 'order:remove_item'));
  canDeleteOrder = computed(() => this.permissions.hasPermission(this.api.getCurrentUser(), 'order:delete'));

  // Get browser's timezone automatically
  private getBrowserTimezone(): string {
    try {
      // Use Intl API to get the timezone
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      // Fallback: try to detect from date offset
      const offset = -new Date().getTimezoneOffset();
      const hours = Math.floor(Math.abs(offset) / 60);
      const minutes = Math.abs(offset) % 60;
      const sign = offset >= 0 ? '+' : '-';
      return `UTC${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
  }
  private wsSub?: Subscription;
  private tableScopeQuerySub?: Subscription;
  private refreshIntervalId: ReturnType<typeof setInterval> | null = null;
  private toastTimeout?: ReturnType<typeof setTimeout>;
  private quantityDebounceTimeout?: ReturnType<typeof setTimeout>;

  orders = signal<Order[]>([]);
  /** When set (via `?table=` query), order lists show only this table's orders. */
  tableScopeId = signal<number | null>(null);
  loading = signal(true);
  showRemovedItems = false;
  viewMode = signal<'active' | 'not_paid' | 'history' | 'delivery'>('active');

  /** Satisfecho Delivery create / edit forms */
  createDeliveryOpen = signal(false);
  editDeliveryOrder = signal<Order | null>(null);
  creatingDelivery = signal(false);
  savingDelivery = signal(false);
  couriers = signal<User[]>([]);
  deliveryProducts = signal<Product[]>([]);
  deliveryFormAddress = '';
  deliveryFormPhone = '';
  deliveryFormCustomerName = '';
  deliveryFormNotes = '';
  deliveryFormCourierId: number | null = null;
  deliveryDraftItems: { product_id: number; name: string; quantity: number }[] = [];
  deliveryAddProductId: number | null = null;
  deliveryAddQuantity = 1;
  orderToMarkPaid = signal<Order | null>(null);
  /** When true, payment modal confirms finish (deliver all + pay) instead of pay-only. */
  paymentModalFinishMode = signal(false);
  paymentMethod = 'cash';
  /** Selected POS tip preset percent; 0 = no tip */
  paymentTipPercent = 0;
  /** When tip_entry_mode is overpayment: amount charged on card/terminal (major units, locale decimal) */
  paymentAmountPaidInput = '';
  /** Editable tip in major units (defaults from amount − subtotal) */
  paymentTipAmountInput = '';
  /** Split-bill partial payment amount (major units) */
  partialPaymentAmountInput = '';
  partialPaymentPayerLabel = '';
  /** Split-by-line: selected order item ids in the payment modal (#331). */
  selectedSplitLineIds = new Set<number>();
  processingPayment = signal(false);
  statusDropdownOpen = signal<number | null>(null); // Order ID for which dropdown is open
  itemStatusDropdownOpen = signal<string | null>(null); // "orderId-itemId" for which dropdown is open
  facturaOrder = signal<Order | null>(null);
  facturaCustomers = signal<BillingCustomer[]>([]);
  facturaCustomerId: number | null = null;
  /** When true, modal is in "Edit order" mode (Save primary); when false, "Print Factura" mode (Print primary). */
  facturaModalEditMode = signal<boolean>(false);

  /** Colombia DIAN electronic invoice (certified-provider simulation) for the Factura modal's order. */
  dianInvoice = signal<DianInvoicePublic | null>(null);
  dianInvoiceLoading = signal<boolean>(false);
  dianInvoiceError = signal<string | null>(null);

  /** Full order edit widget: add/remove/change items, billing, print. Same modal from cards and history. */
  editOrder = signal<Order | null>(null);
  /** "Agregar producto" panel of the edit-order modal; collapsed until needed. */
  editAddOpen = signal(false);
  editOrderProducts = signal<PickerProduct[]>([]);
  editOrderBillingCustomers = signal<BillingCustomer[]>([]);
  editOrderBillingId: number | null = null;
  addingItem = signal(false);
  /** Edit modifiers for a line in the order edit modal (item id). */
  modifierEditItemId: number | null = null;
  modifierEditRemove = '';
  modifierEditAdd = '';
  modifierEditSubstitute = '';
  savingItemModifiers = signal(false);

  // Toast notification system (replaces native alerts)
  toast = signal<{ message: string; type: 'success' | 'error' } | null>(null);

  // Confirmation modal (replaces native confirm)
  confirmAction = signal<{
    message: string;
    onConfirm: () => void;
    confirmText?: string;
    requireReason?: boolean;
  } | null>(null);
  confirmReason = '';

  // Loading state for async actions
  loadingAction = signal<string | null>(null);

  /** Display name for the scoped table (from loaded orders). */
  tableScopeLabel = computed(() => {
    const tid = this.tableScopeId();
    if (tid == null) return '';
    const o = this.orders().find(x => x.table_id === tid);
    return (o?.table_name && String(o.table_name).trim()) ? String(o.table_name) : `#${tid}`;
  });

  // Paid orders stay active until all items are delivered; then only History (#345).
  /** True when the order still has kitchen/service work (not fully delivered). */
  private orderHasUndeliveredActiveItems(order: Order): boolean {
    const items = order.items ?? [];
    const active = items.filter(
      (i) => !i.removed_by_customer && i.status !== 'cancelled'
    );
    if (active.length === 0) return false;
    return active.some((i) => i.status !== 'delivered');
  }

  private isActiveOrderStatus(order: Order): boolean {
    const workflow = ['pending', 'preparing', 'ready', 'out_for_delivery', 'partially_delivered'];
    if (workflow.includes(order.status)) return true;
    // Pre-pay: keep paid orders visible while items are still being served.
    if (order.status === 'paid' && this.orderHasUndeliveredActiveItems(order)) return true;
    return false;
  }

  activeOrders = computed(() => {
    const tid = this.tableScopeId();
    let list = this.orders().filter((o) => this.isActiveOrderStatus(o));
    if (tid != null) list = list.filter(o => o.table_id === tid);
    return [...list].sort((a, b) => {
      if (!!a.staff_urgent !== !!b.staff_urgent) {
        return a.staff_urgent ? -1 : 1;
      }
      return 0;
    });
  });
  completedOrders = computed(() => {
    const tid = this.tableScopeId();
    // History: completed / cancelled / paid (incl. legacy paid+fully delivered).
    // Exclude paid orders that still belong in Active (undelivered items).
    let list = this.orders().filter((o) => {
      if (o.status === 'completed' || o.status === 'cancelled') return true;
      if (o.status === 'paid' && !this.orderHasUndeliveredActiveItems(o)) return true;
      return false;
    });
    if (tid != null) list = list.filter(o => o.table_id === tid);
    return list;
  });
  notPaidOrders = computed(() => {
    const tid = this.tableScopeId();
    let list = this.orders().filter(o => o.status === 'completed' && !o.paid_at);
    if (tid != null) list = list.filter(o => o.table_id === tid);
    return list;
  });
  /** Satisfecho Delivery + marketplace delivery orders (Delivery tab). */
  deliveryOrders = computed(() => {
    return this.orders().filter(o => this.isDeliveryChannel(o));
  });

  // AG Grid configuration - custom light theme matching app colors
  gridTheme = themeQuartz.withParams({
    backgroundColor: '#FFFFFF',
    foregroundColor: '#1C1917',
    accentColor: '#D35233',
    borderColor: '#E7E5E4',
    chromeBackgroundColor: '#FAF9F7',
    headerTextColor: '#1C1917',
    oddRowBackgroundColor: 'rgba(0, 0, 0, 0.02)',
    rowHoverColor: 'rgba(211, 82, 51, 0.05)',
    selectedRowBackgroundColor: 'rgba(211, 82, 51, 0.1)',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    borderRadius: 10,
    wrapperBorderRadius: 10,
  });

  get columnDefs(): ColDef[] {
    const formatCurrency = (value: number) => formatMoneyCents(value);
    return [
      {
        field: 'id',
        headerName: this.translate.instant('ORDERS.GRID.ORDER_NUMBER'),
        width: 100,
        valueFormatter: (params) => `#${params.value}`,
      },
      {
        field: 'table_name',
        headerName: this.translate.instant('ORDERS.GRID.TABLE'),
        width: 120,
      },
      {
        field: 'customer_name',
        headerName: this.translate.instant('ORDERS.GRID.CUSTOMER'),
        width: 150,
        valueFormatter: (params) => params.value || '-',
      },
      {
        field: 'items',
        headerName: this.translate.instant('ORDERS.GRID.ITEMS'),
        flex: 1,
        valueFormatter: (params) => {
          if (!params.value) return '';
          return params.value.map((item: any) => `${item.quantity}x ${item.product_name}`).join(', ');
        },
      },
      {
        field: 'total_cents',
        headerName: this.translate.instant('ORDERS.GRID.TOTAL'),
        width: 110,
        valueFormatter: (params) => {
          if (params.value == null) return '';
          return formatCurrency(params.value);
        },
      },
      {
        field: 'status',
        headerName: this.translate.instant('ORDERS.GRID.STATUS'),
        width: 120,
        cellRenderer: (params: ICellRendererParams) => {
          const status = params.value;
          const statusLabel = this.translate.instant(`ORDER_STATUS.${status}`) || status;
          const colorMap: Record<string, string> = {
            completed: '#78716C',  // matches --color-text-muted
            paid: '#16A34A',       // matches --color-success
          };
          const color = colorMap[status] || '#78716C';
          return `<span style="
            display: inline-block;
            padding: 2px 10px;
            border-radius: 12px;
            font-size: 0.7rem;
            font-weight: 600;
            background: ${color}20;
            color: ${color};
            line-height: 1.4;
          ">${statusLabel}</span>`;
        },
      },
      {
        field: 'created_at',
        headerName: this.translate.instant('ORDERS.GRID.DATE'),
        width: 220,
        valueFormatter: (params) => {
          if (!params.value) return '';
          // Parse date - backend sends ISO without timezone, treat as UTC
          const dateStr = params.value.endsWith('Z') || params.value.includes('+') || params.value.includes('-', 10)
            ? params.value
            : params.value + 'Z';
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) return '';
          // Use browser's local timezone for display
          const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          return date.toLocaleString(undefined, {
            month: 'numeric',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: timeZone,
            hour12: false
          });
        },
      },
      {
        headerName: '',
        width: 56,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams) => {
          const id = params.data?.id;
          if (id == null) return '';
          const editTitle = this.translate.instant('ORDERS.EDIT_ORDER');
          const safeEditTitle = (editTitle || 'Edit').replace(/"/g, '&quot;');
          const editIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
          return `<button type="button" class="btn-edit-order-row" data-order-id="${id}" title="${safeEditTitle}" style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;cursor:pointer;background:#fff;color:#333;border:1px solid #ddd;border-radius:8px;">${editIcon}</button>`;
        },
      },
      {
        headerName: '',
        width: 56,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams) => {
          const id = params.data?.id;
          if (id == null) return '';
          const title = this.translate.instant('CUSTOMERS.PRINT_FACTURA');
          const icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/></svg>';
          const safeTitle = (title || '').replace(/"/g, '&quot;');
          return `<button type="button" class="btn-factura-row" data-order-id="${id}" title="${safeTitle}" style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;cursor:pointer;background:#fff;color:#333;border:1px solid #ddd;border-radius:8px;">${icon}</button>`;
        },
      },
      ...(this.canDeleteOrder() ? [{
        headerName: '',
        width: 56,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams) => {
          const id = params.data?.id;
          if (id == null) return '';
          const deleteTitle = this.translate.instant('ORDERS.DELETE_ORDER');
          const safeDeleteTitle = (deleteTitle || 'Delete').replace(/"/g, '&quot;');
          const deleteIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
          return `<button type="button" class="btn-delete-order-row" data-order-id="${id}" title="${safeDeleteTitle}" style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;cursor:pointer;background:#fff;color:#666;border:1px solid #ddd;border-radius:8px;">${deleteIcon}</button>`;
        },
      }] : []),
    ];
  }

  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
  };

  ngOnInit() {
    this.tableScopeQuerySub = this.route.queryParamMap.subscribe(q => {
      const t = q.get('table');
      const id = t != null && t !== '' ? Number(t) : NaN;
      this.tableScopeId.set(Number.isFinite(id) && id > 0 ? id : null);
    });
    this.loadTenantSettings();
    this.ensureDeliveryLookups();
    this.loadOrders();
    // Connect WebSocket for real-time updates (non-blocking - HTTP requests work without it)
    try {
      this.api.connectWebSocket();
      this.wsSub = this.api.orderUpdates$.subscribe((update: any) => {
        if (update && update.type) {
          // call_waiter / payment_requested alerts are handled globally by WaiterAlertBannerComponent
          const changeTypes = ['item_removed', 'item_updated', 'order_cancelled', 'new_order', 'items_added'];
          if (changeTypes.includes(update.type)) {
            this.audio.playRestaurantOrderChange();
          }
        }
        this.loadOrders();
      });
    } catch (error) {
      console.warn('WebSocket connection failed, continuing without real-time updates:', error);
    }

    // Background poll as a fallback: some orders (e.g. a public delivery order still
    // awaiting payment confirmation) don't push a WebSocket event, so without this the
    // list only picks them up on a manual refresh.
    this.refreshIntervalId = setInterval(() => this.loadOrders(true), 15000);

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.status-control') && !target.closest('.item-status-control')) {
        this.statusDropdownOpen.set(null);
        this.itemStatusDropdownOpen.set(null);
      }
    });
  }

  ngOnDestroy() {
    this.wsSub?.unsubscribe();
    this.tableScopeQuerySub?.unsubscribe();
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
  }

  clearTableScope() {
    this.tableScopeId.set(null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { table: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }


  loadOrders(background = false) {
    if (!background) {
      this.loading.set(true);
    }
    this.api.getOrders(this.showRemovedItems).subscribe({
      next: orders => {
        this.orders.set(orders);
        this.loading.set(false);
        this.applyStaffOrdersFocusFromQuery();
      },
      error: () => this.loading.set(false)
    });
  }

  /**
   * Deep-link from floor plan (and similar): ?focusOrder=123 or ?focusTableId=45
   * Picks the right tab, scrolls to the card when possible, or opens edit for history-only orders.
   */
  private applyStaffOrdersFocusFromQuery() {
    const q = this.route.snapshot.queryParamMap;
    const focusOrderRaw = q.get('focusOrder');
    const focusTableRaw = q.get('focusTableId');
    if (!focusOrderRaw && !focusTableRaw) return;

    const focusOrderId =
      focusOrderRaw != null && focusOrderRaw !== ''
        ? Number(focusOrderRaw)
        : NaN;
    const focusTableId =
      focusTableRaw != null && focusTableRaw !== ''
        ? Number(focusTableRaw)
        : NaN;

    /** Resolve focus using full order list (ignore table scope filter). */
    const rawActive = this.orders().filter((o) => this.isActiveOrderStatus(o));
    const rawNotPaid = this.orders().filter(o => o.status === 'completed' && !o.paid_at);

    let preserveTableId: number | null = null;

    const clearParams = () => {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          focusOrder: null,
          focusTableId: null,
          ...(preserveTableId != null ? { table: preserveTableId } : {}),
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    };

    let mode: 'active' | 'not_paid' | 'history' | null = null;
    let scrollId: number | null = null;
    let openEdit: Order | null = null;

    if (Number.isFinite(focusOrderId) && focusOrderId > 0) {
      const order = this.orders().find(o => o.id === focusOrderId);
      if (order) {
        if (order.table_id != null && order.table_id > 0) {
          preserveTableId = order.table_id;
        }
        if (rawActive.some(o => o.id === focusOrderId)) {
          mode = 'active';
          scrollId = focusOrderId;
        } else if (rawNotPaid.some(o => o.id === focusOrderId)) {
          mode = 'not_paid';
          scrollId = focusOrderId;
        } else {
          mode = 'history';
          openEdit = order;
        }
      }
    } else if (Number.isFinite(focusTableId) && focusTableId > 0) {
      preserveTableId = focusTableId;
      const forTable = this.orders().filter(o => o.table_id === focusTableId);
      const activeForTable = forTable
        .filter((o) => this.isActiveOrderStatus(o))
        .sort((a, b) => (b.staff_urgent ? 1 : 0) - (a.staff_urgent ? 1 : 0) || a.id - b.id);
      if (activeForTable.length > 0) {
        mode = 'active';
        scrollId = activeForTable[0].id;
      } else {
        const notPaid = forTable.filter(o => o.status === 'completed' && !o.paid_at);
        if (notPaid.length > 0) {
          mode = 'not_paid';
          scrollId = notPaid[0].id;
        } else {
          const hist = forTable
            .filter((o) => {
              if (o.status === 'completed' || o.status === 'cancelled') return true;
              if (o.status === 'paid' && !this.orderHasUndeliveredActiveItems(o)) return true;
              return false;
            })
            .sort((a, b) => b.id - a.id);
          if (hist.length > 0) {
            mode = 'history';
            openEdit = hist[0];
          } else {
            this.showToast(this.translate.instant('ORDERS.FOCUS_TABLE_NO_ORDERS'), 'error');
            mode = 'active';
          }
        }
      }
    }

    if (mode != null) {
      this.viewMode.set(mode);
      setTimeout(() => {
        if (scrollId != null) {
          this.scrollToOrder(scrollId);
        }
        if (openEdit) {
          this.openOrderEdit(openEdit);
        }
        clearParams();
      }, 150);
    } else {
      clearParams();
    }
  }

  /** Refresh orders list and update editOrder with the latest order so the edit modal stays in sync. */
  refreshEditOrder(orderId: number) {
    this.api.getOrders(this.showRemovedItems).subscribe({
      next: orders => {
        this.orders.set(orders);
        const o = orders.find(ord => ord.id === orderId);
        if (o) this.editOrder.set(o);
      }
    });
  }

  isSatisfechoDelivery(order: Order): boolean {
    return (order.order_channel || '') === 'satisfecho_delivery';
  }

  isMarketplaceDelivery(order: Order): boolean {
    return (order.order_channel || '') === 'marketplace' || !!order.delivery_integration_id;
  }

  isDeliveryChannel(order: Order): boolean {
    return this.isSatisfechoDelivery(order) || this.isMarketplaceDelivery(order);
  }

  orderChannelBadgeKey(order: Order): string | null {
    if (this.isSatisfechoDelivery(order)) return 'ORDERS.CHANNEL_SATISFECHO_DELIVERY';
    if (this.isMarketplaceDelivery(order)) return 'ORDERS.CHANNEL_MARKETPLACE';
    return null;
  }

  courierDisplayName(courierUserId: number | null | undefined): string {
    if (courierUserId == null) return this.translate.instant('ORDERS.COURIER_UNASSIGNED');
    const c = this.couriers().find(u => u.id === courierUserId);
    if (c) return (c.full_name || c.username || `#${courierUserId}`).trim();
    return `#${courierUserId}`;
  }

  private resetDeliveryForm(): void {
    this.deliveryFormAddress = '';
    this.deliveryFormPhone = '';
    this.deliveryFormCustomerName = '';
    this.deliveryFormNotes = '';
    this.deliveryFormCourierId = null;
    this.deliveryDraftItems = [];
    this.deliveryAddProductId = null;
    this.deliveryAddQuantity = 1;
  }

  private ensureDeliveryLookups(): void {
    if (this.couriers().length === 0) {
      this.api.getCouriers().subscribe({
        next: list => this.couriers.set(list),
        error: () => this.couriers.set([]),
      });
    }
    if (this.deliveryProducts().length === 0) {
      this.api.getProducts().subscribe({
        next: list => this.deliveryProducts.set(list.filter(p => p.id != null)),
        error: () => this.deliveryProducts.set([]),
      });
    }
  }

  openCreateDeliveryModal(): void {
    this.resetDeliveryForm();
    this.editDeliveryOrder.set(null);
    this.createDeliveryOpen.set(true);
    this.ensureDeliveryLookups();
  }

  closeCreateDeliveryModal(): void {
    this.createDeliveryOpen.set(false);
    this.resetDeliveryForm();
  }

  openEditDeliveryModal(order: Order): void {
    this.createDeliveryOpen.set(false);
    this.editDeliveryOrder.set(order);
    this.deliveryFormAddress = order.delivery_address || '';
    this.deliveryFormPhone = order.customer_phone || '';
    this.deliveryFormCustomerName = order.customer_name || '';
    this.deliveryFormNotes = this.displayOrderNotes(order.notes) || '';
    this.deliveryFormCourierId = order.courier_user_id ?? null;
    this.ensureDeliveryLookups();
  }

  closeEditDeliveryModal(): void {
    this.editDeliveryOrder.set(null);
    this.resetDeliveryForm();
  }

  addDeliveryDraftItem(): void {
    if (!this.deliveryAddProductId || this.deliveryAddQuantity < 1) return;
    const product = this.deliveryProducts().find(p => p.id === this.deliveryAddProductId);
    if (!product?.id) return;
    const existing = this.deliveryDraftItems.find(l => l.product_id === product.id);
    if (existing) {
      existing.quantity += this.deliveryAddQuantity;
    } else {
      this.deliveryDraftItems = [
        ...this.deliveryDraftItems,
        { product_id: product.id, name: product.name, quantity: this.deliveryAddQuantity },
      ];
    }
    this.deliveryAddProductId = null;
    this.deliveryAddQuantity = 1;
  }

  removeDeliveryDraftItem(index: number): void {
    this.deliveryDraftItems = this.deliveryDraftItems.filter((_, i) => i !== index);
  }

  submitCreateDelivery(): void {
    const address = this.deliveryFormAddress.trim();
    if (!address || this.deliveryDraftItems.length === 0) return;
    this.creatingDelivery.set(true);
    this.api.createSatisfechoDeliveryOrder({
      items: this.deliveryDraftItems.map(l => ({ product_id: l.product_id, quantity: l.quantity })),
      delivery_address: address,
      customer_phone: this.deliveryFormPhone.trim() || null,
      customer_name: this.deliveryFormCustomerName.trim() || null,
      notes: this.deliveryFormNotes.trim() || null,
      courier_user_id: this.deliveryFormCourierId,
    }).subscribe({
      next: () => {
        this.creatingDelivery.set(false);
        this.closeCreateDeliveryModal();
        this.viewMode.set('delivery');
        this.loadOrders();
        this.showToast(this.translate.instant('ORDERS.DELIVERY_CREATED'), 'success');
      },
      error: (err) => {
        this.creatingDelivery.set(false);
        const detail = err?.error?.detail;
        this.showToast(
          typeof detail === 'string' ? detail : this.translate.instant('ORDERS.DELIVERY_CREATE_FAILED'),
          'error'
        );
      },
    });
  }

  submitEditDelivery(): void {
    const order = this.editDeliveryOrder();
    const address = this.deliveryFormAddress.trim();
    if (!order || !address) return;
    this.savingDelivery.set(true);
    const body: OrderDeliveryUpdate = {
      delivery_address: address,
      customer_phone: this.deliveryFormPhone.trim() || null,
      customer_name: this.deliveryFormCustomerName.trim() || null,
      notes: this.deliveryFormNotes.trim() || null,
      courier_user_id: this.deliveryFormCourierId,
    };
    this.api.updateOrderDelivery(order.id, body).subscribe({
      next: (res) => {
        this.savingDelivery.set(false);
        this.orders.update(list =>
          list.map(o =>
            o.id === order.id
              ? {
                  ...o,
                  delivery_address: res.delivery_address,
                  customer_phone: res.customer_phone,
                  customer_name: res.customer_name ?? undefined,
                  notes: res.notes ?? undefined,
                  courier_user_id: res.courier_user_id,
                }
              : o
          )
        );
        this.closeEditDeliveryModal();
        this.showToast(this.translate.instant('ORDERS.DELIVERY_UPDATED'), 'success');
      },
      error: (err) => {
        this.savingDelivery.set(false);
        const detail = err?.error?.detail;
        this.showToast(
          typeof detail === 'string' ? detail : this.translate.instant('ORDERS.DELIVERY_UPDATE_FAILED'),
          'error'
        );
      },
    });
  }

  canAddItemsToOrder(order: Order): boolean {
    return !!(order.table_id != null && order.table_token && order.status !== 'paid' && order.status !== 'cancelled');
  }

  updateEditItemQuantity(orderId: number, itemId: number, quantity: number) {
    if (quantity < 1) return;
    this.api.updateOrderItemQuantityStaff(orderId, itemId, quantity).subscribe({
      next: () => this.refreshEditOrder(orderId),
      error: () => this.showToast(this.translate.instant('ORDERS.FAILED_TO_UPDATE_ITEM'), 'error')
    });
  }

  updateEditItemStatus(orderId: number, itemId: number, status: string) {
    this.api.updateOrderItemStatus(orderId, itemId, status).subscribe({
      next: () => this.refreshEditOrder(orderId),
      error: () => this.showToast(this.translate.instant('ORDERS.FAILED_TO_UPDATE_STATUS'), 'error')
    });
  }

  removeEditItem(orderId: number, itemId: number, itemStatus: string) {
    this.removeItemStaff(orderId, itemId, itemStatus, () => this.refreshEditOrder(orderId));
  }

  /** Lines chosen in the product picker are added to the open order in one request. */
  addPickedProducts(lines: PickedLine[]) {
    const order = this.editOrder();
    if (!order?.table_token || lines.length === 0) return;
    this.addingItem.set(true);
    const items: OrderItemCreate[] = lines.map(l => ({
      product_id: l.product_id,
      quantity: l.quantity,
      source: 'product',
    }));
    this.api.submitOrder(order.table_token, { items }).subscribe({
      next: () => {
        this.addingItem.set(false);
        this.editAddOpen.set(false);
        this.refreshEditOrder(order.id);
      },
      error: () => {
        this.addingItem.set(false);
        this.showToast(this.translate.instant('ORDERS.FAILED_TO_UPDATE_ITEM'), 'error');
      }
    });
  }

  saveEditOrderBilling() {
    const order = this.editOrder();
    if (!order) return;
    const customer = this.editOrderBillingId != null
      ? this.editOrderBillingCustomers().find(c => c.id === this.editOrderBillingId)
      : null;
    this.api.setOrderBillingCustomer(order.id, this.editOrderBillingId).subscribe({
      next: () => {
        this.orders.update(list =>
          list.map(o => o.id === order.id ? { ...o, billing_customer_id: this.editOrderBillingId, billing_customer: customer ?? undefined } : o)
        );
        this.editOrder.set(this.orders().find(o => o.id === order.id) ?? null);
        this.showToast(this.translate.instant('ORDERS.ITEM_UPDATED'), 'success');
      },
      error: () => this.showToast(this.translate.instant('ORDERS.FAILED_TO_UPDATE_ITEM'), 'error')
    });
  }

  printEditOrderInvoice() {
    const order = this.editOrder();
    if (!order) return;
    const customer = this.editOrderBillingId != null
      ? this.editOrderBillingCustomers().find(c => c.id === this.editOrderBillingId)
      : undefined;
    void this.printInvoice(order, customer ?? undefined);
    if (this.editOrderBillingId != null) {
      this.api.setOrderBillingCustomer(order.id, this.editOrderBillingId).subscribe({
        next: () => this.refreshEditOrder(order.id),
        error: () => {}
      });
    }
  }

  printEditOrderKitchen() {
    const order = this.editOrder();
    if (!order?.id) return;
    void this.printKitchenTicket(order);
  }

  async printKitchenTicket(order: Order) {
    if (!order.id) return;
    const result = await this.printBridge.tryEnqueue('kitchen', order.id, 'kitchen');
    if (result.ok) {
      this.showToast(this.translate.instant('ORDERS.PRINT_BRIDGE_SENT'), 'success');
      return;
    }
    this.showToast(this.translate.instant('ORDERS.PRINT_BRIDGE_OFFLINE'), 'error');
    const items = (order.items || []).filter((i) => !i.removed_by_customer);
    const rows = items
      .map(
        (i) =>
          `<tr><td>${i.quantity || 1}×</td><td>${this.escapeHtml(i.product_name || '')}</td></tr>`,
      )
      .join('');
    const html = `<!DOCTYPE html><html><head><title>Kitchen #${order.id}</title>
<style>body{font-family:monospace;padding:16px} h1{font-size:18px}</style></head><body>
<h1>KITCHEN #${order.id}</h1>
<p>Table: ${this.escapeHtml(order.table_name || '—')}</p>
<table>${rows}</table>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};}<\/script>
</body></html>`;
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  }

  markEditOrderAsPaid(order: Order) {
    this.closeOrderEdit();
    this.paymentModalFinishMode.set(false);
    this.orderToMarkPaid.set(order);
    this.paymentMethod = 'cash';
    this.paymentTipPercent = 0;
    this.paymentAmountPaidInput = '';
    this.paymentTipAmountInput = '';
  }

  markEditOrderFinish(order: Order) {
    this.closeOrderEdit();
    this.paymentModalFinishMode.set(true);
    this.orderToMarkPaid.set(order);
    this.paymentMethod = 'cash';
    this.paymentTipPercent = 0;
    this.paymentAmountPaidInput = '';
    this.paymentTipAmountInput = '';
  }

  getStatusLabel(status: string): string {
    return this.translate.instant(`ORDER_STATUS.${status}`) || status;
  }

  getItemStatusLabel(status: string): string {
    return this.translate.instant(`ITEM_STATUS.${status}`) || status;
  }

  /** Hide internal payment markers when showing customer order notes to staff. */
  displayOrderNotes(notes?: string | null): string | null {
    if (!notes?.trim()) return null;
    const cleaned = notes
      .split('\n')
      .filter(line => !/^\[PAID:/i.test(line.trim()))
      .join('\n')
      .trim();
    return cleaned || null;
  }

  saveEditItemNotes(orderId: number, item: OrderItem) {
    const notes = (item.notes ?? '').trim();
    this.api.updateOrderItemStaff(orderId, item.id!, { notes: notes || null }).subscribe({
      next: () => this.refreshEditOrder(orderId),
      error: () => this.showToast(this.translate.instant('ORDERS.FAILED_TO_UPDATE_ITEM'), 'error'),
    });
  }

  hasLineModifiersItem(item: OrderItem): boolean {
    if (item?.line_modifiers_summary?.trim()) return true;
    const m = item?.line_modifiers;
    if (!m || typeof m !== 'object') return false;
    return (
      (Array.isArray(m.remove) && m.remove.length > 0) ||
      (Array.isArray(m.add) && m.add.length > 0) ||
      (Array.isArray(m.substitute) && m.substitute.length > 0)
    );
  }

  hasItemModifiersLine(item: OrderItem): boolean {
    return this.hasLineModifiersItem(item);
  }

  formatLineModifiersFromJson(m: OrderLineModifiers | null | undefined): string {
    if (!m) return '';
    const parts: string[] = [];
    if (m.remove?.length) parts.push(`Remove: ${m.remove.join(', ')}`);
    if (m.add?.length) parts.push(`Add: ${m.add.join(', ')}`);
    if (m.substitute?.length) {
      parts.push(`Sub: ${m.substitute.map(s => `${s.from}→${s.to}`).join(', ')}`);
    }
    return parts.join(' · ');
  }

  formatItemModifiersLine(item: OrderItem): string {
    const snap = item.line_modifiers_summary?.trim();
    return snap || this.formatLineModifiersFromJson(item.line_modifiers ?? undefined);
  }

  private parseCommaSeparatedLabels(s: string): string[] {
    return s
      .split(/[,;]/)
      .map(x => x.trim())
      .filter(Boolean);
  }

  private parseSubstituteLines(s: string): { from: string; to: string }[] {
    const out: { from: string; to: string }[] = [];
    const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      let from = '';
      let to = '';
      if (line.includes('→')) {
        const p = line.split('→');
        from = (p[0] || '').trim();
        to = (p.slice(1).join('→') || '').trim();
      } else if (line.includes('->')) {
        const p = line.split('->');
        from = (p[0] || '').trim();
        to = (p.slice(1).join('->') || '').trim();
      } else if (line.toLowerCase().includes(' to ')) {
        const idx = line.toLowerCase().indexOf(' to ');
        from = line.slice(0, idx).trim();
        to = line.slice(idx + 4).trim();
      } else if (line.includes('=')) {
        const p = line.split('=');
        from = (p[0] || '').trim();
        to = (p.slice(1).join('=') || '').trim();
      }
      if (from && to) out.push({ from, to });
    }
    return out;
  }

  buildLineModifiersFromStrings(remove: string, add: string, substitute: string): OrderLineModifiers | undefined {
    const r = this.parseCommaSeparatedLabels(remove);
    const a = this.parseCommaSeparatedLabels(add);
    const sub = this.parseSubstituteLines(substitute);
    if (r.length === 0 && a.length === 0 && sub.length === 0) return undefined;
    const lm: OrderLineModifiers = {};
    if (r.length) lm.remove = r;
    if (a.length) lm.add = a;
    if (sub.length) lm.substitute = sub;
    return lm;
  }

  fillModifierEditFields(item: OrderItem) {
    const m = item.line_modifiers;
    this.modifierEditRemove = m?.remove?.join(', ') ?? '';
    this.modifierEditAdd = m?.add?.join(', ') ?? '';
    this.modifierEditSubstitute =
      m?.substitute?.map(p => `${p.from} → ${p.to}`).join('\n') ?? '';
  }

  toggleModifierEdit(item: OrderItem) {
    if (this.modifierEditItemId === item.id) {
      this.modifierEditItemId = null;
      return;
    }
    this.modifierEditItemId = item.id ?? null;
    this.fillModifierEditFields(item);
  }

  saveItemModifiers(orderId: number, item: OrderItem) {
    if (!item.id) return;
    const lm = this.buildLineModifiersFromStrings(
      this.modifierEditRemove,
      this.modifierEditAdd,
      this.modifierEditSubstitute,
    );
    this.savingItemModifiers.set(true);
    this.api.updateOrderItemStaff(orderId, item.id, { line_modifiers: lm ?? {} }).subscribe({
      next: () => {
        this.savingItemModifiers.set(false);
        this.modifierEditItemId = null;
        this.refreshEditOrder(orderId);
        this.showToast(this.translate.instant('ORDERS.ITEM_UPDATED'), 'success');
      },
      error: () => {
        this.savingItemModifiers.set(false);
        this.showToast(this.translate.instant('ORDERS.FAILED_TO_UPDATE_ITEM'), 'error');
      },
    });
  }

  showToast(message: string, type: 'success' | 'error') {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = undefined;
    }
    this.toast.set({ message, type });
  }

  openConfirmModal(message: string, onConfirm: () => void, options?: { confirmText?: string; requireReason?: boolean }) {
    this.confirmReason = '';
    this.confirmAction.set({
      message,
      onConfirm,
      confirmText: options?.confirmText,
      requireReason: options?.requireReason
    });
  }

  closeConfirmModal() {
    this.confirmAction.set(null);
    this.confirmReason = '';
  }

  handleConfirm() {
    const action = this.confirmAction();
    if (action) {
      action.onConfirm();
      this.closeConfirmModal();
    }
  }

  formatTime(isoString: string): string {
    // Parse date - backend sends ISO without timezone, treat as UTC
    const dateStr = isoString.endsWith('Z') || isoString.includes('+') || isoString.includes('-', 10)
      ? isoString
      : isoString + 'Z';
    const date = new Date(dateStr);
    // Use browser's local timezone for display
    const timeZone = this.getBrowserTimezone();
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timeZone
    });
  }

  tenantSettings = signal<TenantSettings | null>(null);

  loadTenantSettings() {
    this.api.getTenantSettings().subscribe({
      next: (settings) => {
        this.tenantSettings.set(settings);
      },
      error: (err) => {
        console.error('Failed to load tenant settings:', err);
      }
    });
  }

  openMenuForOrder(order: Order) {
    if (order.table_token == null) return;
    window.open(`${window.location.origin}/menu/${order.table_token}`, '_blank');
  }

  openFacturaModal(order: Order) {
    this.facturaModalEditMode.set(false);
    this.facturaOrder.set(order);
    this.facturaCustomerId = order.billing_customer_id ?? null;
    this.api.getBillingCustomers().subscribe({
      next: list => this.facturaCustomers.set(list),
      error: () => this.facturaCustomers.set([])
    });

    this.dianInvoice.set(null);
    this.dianInvoiceError.set(null);
    if (this.dianInvoicingEnabled() && order.id != null) {
      this.api.getOrderDianInvoice(order.id).subscribe({
        next: (di) => this.dianInvoice.set(di),
        error: () => this.dianInvoice.set(null),
      });
    }
  }

  dianInvoicingEnabled(): boolean {
    const m = this.tenantSettings()?.dian_mode;
    return m === 'test' || m === 'live';
  }

  issueDianInvoiceSimulation() {
    const order = this.facturaOrder();
    if (!order?.id) return;
    this.dianInvoiceLoading.set(true);
    this.dianInvoiceError.set(null);
    this.api.issueOrderDianInvoice(order.id).subscribe({
      next: (di) => {
        this.dianInvoice.set(di);
        this.dianInvoiceLoading.set(false);
      },
      error: (err: { error?: { detail?: unknown } }) => {
        this.dianInvoiceError.set(this.fiscalIssueErrorMessage(err));
        this.dianInvoiceLoading.set(false);
      },
    });
  }

  cancelDianInvoiceSimulation() {
    const order = this.facturaOrder();
    if (!order?.id) return;
    this.dianInvoiceLoading.set(true);
    this.dianInvoiceError.set(null);
    this.api.cancelOrderDianInvoice(order.id).subscribe({
      next: (di) => {
        this.dianInvoice.set(di);
        this.dianInvoiceLoading.set(false);
      },
      error: (err: { error?: { detail?: unknown } }) => {
        this.dianInvoiceError.set(this.fiscalIssueErrorMessage(err));
        this.dianInvoiceLoading.set(false);
      },
    });
  }

  openOrderEdit(order: Order) {
    this.editOrder.set(order);
    this.editOrderBillingId = order.billing_customer_id ?? null;
    this.editAddOpen.set(false);
    this.modifierEditItemId = null;
    this.modifierEditRemove = '';
    this.modifierEditAdd = '';
    this.modifierEditSubstitute = '';
    this.api.getProducts().subscribe({
      next: list => this.editOrderProducts.set(
        (list || [])
          .filter(p => p.id != null)
          .map(p => ({
            id: p.id as number,
            name: p.name,
            price_cents: p.price_cents,
            category: p.category ?? null,
            image_url: this.api.getProductImageUrl(p),
          }))
      ),
      error: () => this.editOrderProducts.set([])
    });
    this.api.getBillingCustomers().subscribe({
      next: list => this.editOrderBillingCustomers.set(list),
      error: () => this.editOrderBillingCustomers.set([])
    });
  }

  closeOrderEdit() {
    this.editOrder.set(null);
    this.editOrderProducts.set([]);
    this.editAddOpen.set(false);
    this.editOrderBillingCustomers.set([]);
    this.modifierEditItemId = null;
  }

  openEditOrderModal(order: Order) {
    this.openOrderEdit(order);
  }

  closeFacturaModal() {
    this.facturaOrder.set(null);
    this.facturaCustomers.set([]);
    this.facturaModalEditMode.set(false);
    this.dianInvoice.set(null);
    this.dianInvoiceError.set(null);
    this.dianInvoiceLoading.set(false);
  }

  onGridClick(event: Event) {
    const target = event.target as HTMLElement;
    const facturaBtn = target.closest('.btn-factura-row');
    const editBtn = target.closest('.btn-edit-order-row');
    const deleteBtn = target.closest('.btn-delete-order-row');
    if (editBtn) {
      const id = +(editBtn.getAttribute('data-order-id') || 0);
      const order = this.orders().find(o => o.id === id);
      if (order) this.openEditOrderModal(order);
      return;
    }
    if (facturaBtn) {
      const id = +(facturaBtn.getAttribute('data-order-id') || 0);
      const order = this.orders().find(o => o.id === id);
      if (order) this.openFacturaModal(order);
      return;
    }
    if (deleteBtn) {
      const id = +(deleteBtn.getAttribute('data-order-id') || 0);
      const order = this.orders().find(o => o.id === id);
      if (order) this.deleteOrder(order);
    }
  }

  saveFacturaCustomerAndClose() {
    const order = this.facturaOrder();
    if (!order) return;
    const customer = this.facturaCustomerId != null
      ? this.facturaCustomers().find(c => c.id === this.facturaCustomerId)
      : null;
    this.api.setOrderBillingCustomer(order.id, this.facturaCustomerId).subscribe({
      next: () => {
        this.orders.update(list =>
          list.map(o => o.id === order.id ? { ...o, billing_customer_id: this.facturaCustomerId, billing_customer: customer ?? undefined } : o)
        );
        this.showToast(this.translate.instant('ORDERS.ITEM_UPDATED') || 'Saved', 'success');
        this.closeFacturaModal();
      },
      error: () => this.showToast(this.translate.instant('ORDERS.FAILED_TO_UPDATE_ITEM') || 'Failed to save', 'error')
    });
  }

  printFacturaAndClose() {
    const order = this.facturaOrder();
    if (!order) return;
    const customer = this.facturaCustomerId != null
      ? this.facturaCustomers().find(c => c.id === this.facturaCustomerId)
      : null;
    void this.printInvoice(order, customer ?? undefined);
    this.afterFacturaPrintPersistCustomer(order, customer);
    this.closeFacturaModal();
  }

  private fiscalIssueErrorMessage(err: { error?: { detail?: unknown } }): string {
    const d = err?.error?.detail;
    if (typeof d === 'string' && d.trim()) return d;
    return this.translate.instant('ORDERS.FISCAL_ISSUE_FAILED') || 'Could not issue fiscal invoice';
  }

  private afterFacturaPrintPersistCustomer(order: Order, customer: BillingCustomer | null | undefined) {
    if (this.facturaCustomerId != null) {
      this.api.setOrderBillingCustomer(order.id, this.facturaCustomerId).subscribe({
        next: () => {
          this.orders.update(list =>
            list.map(o =>
              o.id === order.id
                ? { ...o, billing_customer_id: this.facturaCustomerId, billing_customer: customer ?? undefined }
                : o
            )
          );
        },
        error: () => {}
      });
    }
  }

  async printInvoice(
    order: Order,
    billingCustomer?: BillingCustomer | null,
  ) {
    if (order.id != null) {
      // The chosen billing customer is saved after printing, so send it with the job.
      const result = await this.printBridge.tryEnqueue(
        'receipt',
        order.id,
        'receipt',
        billingCustomer?.id != null ? { billing_customer_id: billingCustomer.id } : undefined,
      );
      if (result.ok) {
        this.showToast(this.translate.instant('ORDERS.PRINT_BRIDGE_SENT'), 'success');
        return;
      }
      this.showToast(this.translate.instant('ORDERS.PRINT_BRIDGE_OFFLINE'), 'error');
    }

    const settings = this.tenantSettings();
    const tenantId = this.api.getCurrentUser()?.tenant_id;
    const logoUrl = settings?.logo_filename && tenantId
      ? this.api.getTenantLogoUrl(settings.logo_filename, tenantId)
      : null;

    const businessName = settings?.name || 'Business';
    const address = settings?.address ? `<p>${this.escapeHtml(settings.address)}</p>` : '';
    const taxLine: string[] = [];
    if (settings?.tax_id) taxLine.push(`Tax ID: ${this.escapeHtml(settings.tax_id)}`);
    if (settings?.cif) taxLine.push(`CIF: ${this.escapeHtml(settings.cif)}`);
    const taxBlock = taxLine.length ? `<p style="font-size:11px;color:#555;">${taxLine.join(' &nbsp;|&nbsp; ')}</p>` : '';

    const dateStr = order.created_at
      ? new Date(order.created_at.endsWith('Z') || order.created_at.includes('+') || order.created_at.includes('-', 10) ? order.created_at : order.created_at + 'Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : '';

    const items = (order.items || []).filter(i => !i.removed_by_customer);
    const rows = items.map(i => {
      const lineTotal = (i.price_cents || 0) * (i.quantity || 1);
      const taxCents = i.tax_amount_cents ?? 0;
      const cust = this.formatItemModifiersLine(i);
      const nameCell = cust
        ? `${this.escapeHtml(i.product_name || '')}<br/><span style="font-size:11px;color:#555;">${this.escapeHtml(cust)}</span>`
        : this.escapeHtml(i.product_name || '');
      return `<tr>
        <td>${nameCell}</td>
        <td style="text-align:center">${i.quantity || 1}</td>
        <td style="text-align:right">${this.formatPrice(i.price_cents || 0)}</td>
        <td style="text-align:right">${taxCents > 0 ? this.formatPrice(taxCents) : '—'}</td>
        <td style="text-align:right">${this.formatPrice(lineTotal)}</td>
      </tr>`;
    }).join('');

    const subtotalCents = items.reduce(
      (s, i) => s + (i.price_cents || 0) * (i.quantity || 1),
      0
    );
    const tipAmt = order.tip_amount_cents || 0;
    const tipPct = order.tip_percent_applied;
    const tipTaxRate = Math.min(
      100,
      Math.max(0, Math.floor(Number(settings?.tip_tax_rate_percent) || 0))
    );
    let tipTaxPart = 0;
    if (tipAmt > 0 && tipTaxRate > 0) {
      const den = 100 + tipTaxRate;
      tipTaxPart = Math.floor((tipAmt * tipTaxRate + den / 2) / den);
    }
    const tipLabel =
      tipPct != null && tipPct > 0
        ? this.translate.instant('ORDERS.INVOICE_TIP_LINE', { percent: tipPct })
        : this.translate.instant('ORDERS.TIP');
    const extraCents = order.extra_charge_cents || 0;
    const extraRowHtml =
      extraCents > 0
        ? `<tr>
        <td colspan="4">${this.escapeHtml(this.translate.instant('ORDERS.EXTRA_CHARGE'))}${order.extra_charge_note ? ' — ' + this.escapeHtml(order.extra_charge_note) : ''}</td>
        <td style="text-align:right">${this.formatPrice(extraCents)}</td>
      </tr>`
        : '';
    const tipRowsHtml =
      tipAmt > 0
        ? `<tr>
        <td colspan="4" style="text-align:right;font-size:12px;color:#555;">${this.escapeHtml(this.translate.instant('ORDERS.INVOICE_SUBTOTAL'))}</td>
        <td style="text-align:right">${this.formatPrice(subtotalCents)}</td>
      </tr>
      <tr>
        <td colspan="3">${this.escapeHtml(tipLabel)}</td>
        <td style="text-align:right">${tipTaxPart > 0 ? this.formatPrice(tipTaxPart) : '—'}</td>
        <td style="text-align:right">${this.formatPrice(tipAmt)}</td>
      </tr>`
        : '';

    // Totals by tax rate for invoice breakdown
    const taxByRate: Record<number, number> = {};
    items.forEach(i => {
      const rate = i.tax_rate_percent ?? 0;
      const cents = i.tax_amount_cents ?? 0;
      if (rate > 0 && cents > 0) {
        taxByRate[rate] = (taxByRate[rate] ?? 0) + cents;
      }
    });
    if (tipTaxPart > 0) {
      taxByRate[tipTaxRate] = (taxByRate[tipTaxRate] ?? 0) + tipTaxPart;
    }
    const totalTaxCents = Object.values(taxByRate).reduce((a, b) => a + b, 0);
    const taxSummaryRows = Object.entries(taxByRate)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([rate, cents]) =>
        `<tr><td colspan="4" style="text-align:right; font-size: 12px; color: #555;">IVA ${rate}%</td><td style="text-align:right">${this.formatPrice(cents)}</td></tr>`
      ).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Invoice #${order.id}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 14px; line-height: 1.4; color: #1a1a1a; max-width: 400px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #333; padding-bottom: 16px; }
    .header img { max-height: 56px; max-width: 180px; }
    .header h1 { margin: 8px 0 4px; font-size: 1.5rem; font-weight: 700; }
    .meta { font-size: 12px; color: #555; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; border-bottom: 1px solid #ddd; padding: 8px 4px; }
    th:nth-child(2) { text-align: center; }
    th:nth-child(3), th:nth-child(4), th:nth-child(5) { text-align: right; }
    td { padding: 10px 4px; border-bottom: 1px solid #eee; }
    .total-row { font-weight: 700; font-size: 1.1rem; border-top: 2px solid #333; }
    .total-row td { padding-top: 12px; }
    .footer { margin-top: 24px; font-size: 11px; color: #888; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    ${logoUrl ? `<img src="${this.escapeHtml(logoUrl)}" alt="" />` : ''}
    <h1>${this.escapeHtml(businessName)}</h1>
    ${address}
    ${taxBlock}
  </div>
  ${billingCustomer ? `
  <div class="bill-to" style="margin-bottom: 16px; padding: 12px; background: #f8fafc; border-radius: 6px; font-size: 13px;">
    <strong style="font-size: 11px; text-transform: uppercase; color: #64748b;">${this.translate.instant('CUSTOMERS.BILL_TO')}</strong>
    <p style="margin: 6px 0 0; font-weight: 600;">${this.escapeHtml(billingCustomer.company_name || billingCustomer.name)}</p>
    ${billingCustomer.tax_id ? `<p style="margin: 2px 0 0; color: #555;">Tax ID: ${this.escapeHtml(billingCustomer.tax_id)}</p>` : ''}
    ${billingCustomer.address ? `<p style="margin: 2px 0 0; color: #555;">${this.escapeHtml(billingCustomer.address)}</p>` : ''}
    ${billingCustomer.email ? `<p style="margin: 2px 0 0; color: #555;">${this.escapeHtml(billingCustomer.email)}</p>` : ''}
  </div>
  ` : ''}
  <div class="meta">
    <strong>${this.translate.instant('ORDERS.INVOICE')}</strong> #${order.id} &nbsp;|&nbsp;
    ${this.translate.instant('ORDERS.ORDER_TIME')}: ${this.escapeHtml(dateStr)} &nbsp;|&nbsp;
    ${this.translate.instant('ORDERS.TABLE')}: ${this.escapeHtml(order.table_name || '—')}
    ${order.customer_name ? ` &nbsp;|&nbsp; ${this.translate.instant('ORDERS.CUSTOMER')}: ${this.escapeHtml(order.customer_name)}` : ''}
  </div>
  <table>
    <thead>
      <tr>
        <th>${this.translate.instant('COMMON.NAME')}</th>
        <th>${this.translate.instant('COMMON.QUANTITY')}</th>
        <th>${this.translate.instant('COMMON.PRICE')}</th>
        <th>${this.translate.instant('ORDERS.TAX')}</th>
        <th>${this.translate.instant('ORDERS.TOTAL')}</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      ${extraRowHtml}
      ${tipRowsHtml}
    </tbody>
    ${taxSummaryRows}
    ${totalTaxCents > 0 ? `<tr><td colspan="4" style="text-align:right; font-size: 12px;">${this.translate.instant('ORDERS.TOTAL_TAX')}</td><td style="text-align:right">${this.formatPrice(totalTaxCents)}</td></tr>` : ''}
    <tr class="total-row">
      <td colspan="4">${this.translate.instant('ORDERS.TOTAL')}</td>
      <td style="text-align:right">${this.formatPrice(order.total_cents || 0)}</td>
    </tr>
  </table>
  <div class="footer">${this.translate.instant('ORDERS.INVOICE_FOOTER')}</div>
  <script>window.onload = function() { window.print(); window.onafterprint = function() { window.close(); }; }</script>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  }

  private escapeHtml(s: string): string {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  formatPrice(priceCents: number): string {
    return formatMoneyCents(priceCents);
  }

  formatExactTime(dateString: string): string {
    if (!dateString) return 'Unknown';

    try {
      // Parse as UTC if it has timezone indicator, otherwise assume UTC
      // Backend sends ISO format without timezone, so we treat it as UTC
      const dateStr = dateString.endsWith('Z') || dateString.includes('+') || dateString.includes('-', 10)
        ? dateString
        : dateString + 'Z';
      const date = new Date(dateStr);

      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }

      // Explicitly use browser's timezone for display
      const timeZone = this.getBrowserTimezone();
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: timeZone
      });
    } catch {
      return dateString;
    }
  }

  formatOrderTime(dateString: string): string {
    if (!dateString) return 'Unknown';

    // Parse the date string - ensure it's treated as UTC if no timezone is specified
    let date: Date;
    try {
      // If the string doesn't end with Z or timezone, assume it's UTC
      const dateStr = dateString.endsWith('Z') || dateString.includes('+') || dateString.includes('-', 10)
        ? dateString
        : dateString + 'Z';
      date = new Date(dateStr);
    } catch {
      date = new Date(dateString);
    }

    // Check if date is valid
    if (isNaN(date.getTime())) {
      console.warn('Invalid date string:', dateString);
      return 'Invalid date';
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    // Handle negative differences (future dates) - shouldn't happen but just in case
    if (diffMs < 0) {
      return 'Just now';
    }

    // Calculate time differences
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // If less than 1 minute ago
    if (diffSeconds < 60) {
      return diffSeconds < 10 ? 'Just now' : `${diffSeconds}s ago`;
    }
    // If less than 1 hour ago
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    // If less than 24 hours ago
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    // If less than 7 days ago
    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }
    // Otherwise show formatted date and time in local timezone
    const timeZone = this.getBrowserTimezone();
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timeZone
    });
  }

  // Sort items: active (pending, preparing) on top, ready in middle, delivered at bottom
  getSortedItems(items: OrderItem[]): OrderItem[] {
    const statusOrder: Record<string, number> = {
      pending: 0,
      preparing: 1,
      ready: 2,
      delivered: 3,
      cancelled: 4
    };
    return [...items].sort((a, b) => {
      const aOrder = statusOrder[a.status || 'pending'] ?? 5;
      const bOrder = statusOrder[b.status || 'pending'] ?? 5;
      return aOrder - bOrder;
    });
  }

  // Get available status transitions for an order
  getOrderStatusTransitions(currentStatus: string): { forward: string[]; backward: string[] } {
    const transitions: Record<string, { forward: string[]; backward: string[] }> = {
      pending: { forward: ['preparing'], backward: [] },
      preparing: { forward: ['ready'], backward: ['pending'] },
      ready: { forward: ['out_for_delivery', 'completed'], backward: ['preparing'] },
      out_for_delivery: { forward: ['completed'], backward: ['ready'] },
      completed: { forward: [], backward: ['ready'] }, // Paid is handled via modal
      partially_delivered: { forward: ['completed'], backward: [] },
      paid: { forward: [], backward: [] }, // Unmark paid is a separate action (clears paid mark only)
      cancelled: { forward: [], backward: [] }
    };
    const key = (currentStatus ?? '').toString().toLowerCase();
    return transitions[key] ?? { forward: [], backward: [] };
  }

  // Get available status transitions for an item
  getItemStatusTransitions(currentStatus: string): { forward: string[]; backward: string[] } {
    const transitions: Record<string, { forward: string[]; backward: string[] }> = {
      // Ready and delivered happen in a single step now (skip the separate "ready" click).
      pending: { forward: ['preparing'], backward: [] },
      preparing: { forward: ['delivered'], backward: ['pending'] },
      ready: { forward: ['delivered'], backward: ['preparing'] },
      delivered: { forward: [], backward: ['preparing'] },
      cancelled: { forward: [], backward: [] }
    };
    const key = (currentStatus ?? '').toString().toLowerCase();
    return transitions[key] ?? { forward: [], backward: [] };
  }

  scrollToOrder(orderId: number) {
    const el = document.getElementById(`order-card-${orderId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  toggleStatusDropdown(orderId: number) {
    this.statusDropdownOpen.update(current => current === orderId ? null : orderId);
  }

  toggleItemStatusDropdown(orderId: number, itemId: number) {
    const key = `${orderId}-${itemId}`;
    this.itemStatusDropdownOpen.update(current => current === key ? null : key);
  }

  /**
   * Elevate the whole order card while either the order-level or any line-item status menu is open,
   * so the dropdown is not covered by the next card in the grid (sibling z-index / paint order).
   */
  orderCardHasOpenStatusDropdown(orderId: number): boolean {
    if (this.statusDropdownOpen() === orderId) return true;
    const key = this.itemStatusDropdownOpen();
    if (!key) return false;
    const dash = key.indexOf('-');
    if (dash <= 0) return false;
    const oid = Number(key.slice(0, dash));
    return oid === orderId;
  }

  toggleStaffUrgent(order: Order, event?: Event): void {
    event?.stopPropagation();
    if (!this.canUpdateStatus()) return;
    if (order.status === 'cancelled') return;
    const next = !order.staff_urgent;
    this.api.setOrderStaffUrgent(order.id, next).subscribe({
      next: (res) => {
        this.orders.update((list) =>
          list.map((o) => (o.id === order.id ? { ...o, staff_urgent: res.staff_urgent } : o))
        );
      },
    });
  }

  updateStatus(order: Order, status: string) {
    this.statusDropdownOpen.set(null); // Close dropdown
    this.api.updateOrderStatus(order.id, status).subscribe({
      next: () => {
        this.orders.update(list =>
          list.map(o => o.id === order.id ? { ...o, status } : o)
        );
      }
    });
  }

  unmarkPaid(order: Order) {
    this.statusDropdownOpen.set(null);
    this.api.unmarkOrderPaid(order.id).subscribe({
      next: (res) => {
        this.orders.update(list =>
          list.map(o => {
            if (o.id !== order.id) return o;
            return {
              ...o,
              status: res.new_status,
              paid_at: null,
              payment_method: null
            };
          })
        );
      }
    });
  }

  deleteOrder(order: Order) {
    this.openConfirmModal(
      this.translate.instant('ORDERS.DELETE_ORDER_CONFIRM'),
      () => {
        this.api.deleteOrder(order.id).subscribe({
          next: () => {
            this.orders.update(list => list.filter(o => o.id !== order.id));
            this.showToast(this.translate.instant('ORDERS.DELETE_ORDER_DONE'), 'success');
          },
          error: () => this.showToast(this.translate.instant('ORDERS.DELETE_ORDER_FAILED'), 'error')
        });
      },
      { confirmText: this.translate.instant('ORDERS.DELETE_ORDER') }
    );
  }

  updateItemStatus(orderId: number, itemId: number, status: string) {
    this.api.updateOrderItemStatus(orderId, itemId, status).subscribe({
      next: () => {
        this.loadOrders();
      },
      error: (err) => {
        console.error('Failed to update item status:', err);
        this.showToast(this.translate.instant('ORDERS.FAILED_TO_UPDATE_STATUS'), 'error');
      }
    });
  }

  resetItemStatus(orderId: number, itemId: number) {
    this.api.resetItemStatus(orderId, itemId).subscribe({
      next: () => {
        this.loadOrders();
      },
      error: () => {
        this.showToast(this.translate.instant('ORDERS.FAILED_TO_RESET_STATUS'), 'error');
      }
    });
  }

  cancelItemWithReason(orderId: number, itemId: number) {
    this.openConfirmModal(
      this.translate.instant('ORDERS.CANCELLATION_REASON'),
      () => {
        if (!this.confirmReason.trim()) {
          this.showToast(this.translate.instant('ORDERS.REASON_REQUIRED'), 'error');
          return;
        }
        this.api.cancelOrderItemStaff(orderId, itemId, this.confirmReason).subscribe({
          next: () => {
            this.loadOrders();
          },
          error: () => {
            this.showToast(this.translate.instant('ORDERS.FAILED_TO_CANCEL_ITEM'), 'error');
          }
        });
      },
      { requireReason: true, confirmText: this.translate.instant('COMMON.CONFIRM') }
    );
  }

  updateItemQuantity(orderId: number, itemId: number, quantity: number) {
    if (quantity <= 0) {
      this.showToast(this.translate.instant('ORDERS.QUANTITY_MIN_ERROR'), 'error');
      return;
    }
    // Debounce quantity updates to avoid too many API calls
    if (this.quantityDebounceTimeout) {
      clearTimeout(this.quantityDebounceTimeout);
    }
    this.quantityDebounceTimeout = setTimeout(() => {
      this.api.updateOrderItemQuantityStaff(orderId, itemId, quantity).subscribe({
        next: () => {
          this.loadOrders();
        },
        error: () => {
          this.showToast(this.translate.instant('ORDERS.FAILED_TO_UPDATE_ITEM'), 'error');
        }
      });
    }, 400);
  }

  removeItemStaff(orderId: number, itemId: number, itemStatus: string, onSuccess?: () => void) {
    // Reason required for ready/delivered (audit and tax)
    if (itemStatus === 'ready' || itemStatus === 'delivered') {
      this.openConfirmModal(
        this.translate.instant('ORDERS.REMOVAL_REASON'),
        () => {
          if (!this.confirmReason.trim()) {
            this.showToast(this.translate.instant('ORDERS.REMOVAL_REASON_REQUIRED'), 'error');
            return;
          }
          this.doRemoveItem(orderId, itemId, this.confirmReason, onSuccess);
        },
        { requireReason: true, confirmText: this.translate.instant('COMMON.CONFIRM') }
      );
    } else {
      this.openConfirmModal(
        this.translate.instant('ORDERS.REMOVE_ITEM_CONFIRM'),
        () => this.doRemoveItem(orderId, itemId, undefined, onSuccess),
        { confirmText: this.translate.instant('COMMON.CONFIRM') }
      );
    }
  }

  private doRemoveItem(orderId: number, itemId: number, reason?: string, onSuccess?: () => void) {
    this.api.removeOrderItemStaff(orderId, itemId, reason).subscribe({
      next: () => {
        this.showToast(this.translate.instant('ORDERS.ITEM_REMOVED'), 'success');
        this.loadOrders();
        onSuccess?.();
      },
      error: () => {
        this.showToast(this.translate.instant('ORDERS.FAILED_TO_REMOVE_ITEM'), 'error');
      }
    });
  }

  openFinishPaymentModal(order: Order) {
    this.statusDropdownOpen.set(null);
    this.paymentModalFinishMode.set(true);
    this.orderToMarkPaid.set(order);
    this.paymentMethod = 'cash';
    this.paymentTipPercent = 0;
    this.paymentAmountPaidInput = '';
    this.paymentTipAmountInput = '';
    this.partialPaymentAmountInput = '';
    this.partialPaymentPayerLabel = '';
    this.selectedSplitLineIds = new Set();
  }

  closePaymentModal() {
    this.orderToMarkPaid.set(null);
    this.paymentExtraInput = null;
    this.extraEditorOpen.set(false);
    this.paymentModalFinishMode.set(false);
    this.processingPayment.set(false);
    this.paymentTipPercent = 0;
    this.paymentAmountPaidInput = '';
    this.paymentTipAmountInput = '';
    this.partialPaymentAmountInput = '';
    this.partialPaymentPayerLabel = '';
    this.selectedSplitLineIds = new Set();
  }

  paymentAmountDueCents(order: Order): number {
    if (order.amount_due_cents != null && order.amount_due_cents >= 0) {
      return order.amount_due_cents;
    }
    return this.paymentGrandTotalCents(order);
  }

  paymentAmountRemainingCents(order: Order): number {
    if (order.amount_remaining_cents != null && order.amount_remaining_cents >= 0) {
      return order.amount_remaining_cents;
    }
    const paid = order.amount_paid_cents || 0;
    return Math.max(0, this.paymentAmountDueCents(order) - paid);
  }

  payableSplitLines(order: Order): OrderItem[] {
    const allocated = new Set<number>();
    for (const p of order.payments || []) {
      for (const id of p.order_item_ids || []) {
        allocated.add(id);
      }
    }
    return (order.items || []).filter(
      (i) =>
        i.id != null &&
        !i.removed_by_customer &&
        i.status !== 'cancelled' &&
        !allocated.has(i.id),
    );
  }

  isSplitLineSelected(itemId: number | undefined | null): boolean {
    return itemId != null && this.selectedSplitLineIds.has(itemId);
  }

  toggleSplitLine(itemId: number | undefined | null): void {
    if (itemId == null) return;
    if (this.selectedSplitLineIds.has(itemId)) {
      this.selectedSplitLineIds.delete(itemId);
    } else {
      this.selectedSplitLineIds.add(itemId);
    }
    // Force change detection for Set mutations.
    this.selectedSplitLineIds = new Set(this.selectedSplitLineIds);
    if (this.selectedSplitLineIds.size > 0) {
      this.partialPaymentAmountInput = '';
    }
  }

  selectedSplitLineTotalCents(order: Order): number {
    const selected = this.selectedSplitLineIds;
    if (selected.size === 0) return 0;
    return this.payableSplitLines(order)
      .filter((i) => i.id != null && selected.has(i.id))
      .reduce((s, i) => s + (i.price_cents || 0) * (i.quantity || 0), 0);
  }

  confirmPartialPayment() {
    const order = this.orderToMarkPaid();
    if (!order || !this.paymentMethod) return;
    const lineIds = Array.from(this.selectedSplitLineIds);
    const remaining = this.paymentAmountRemainingCents(order);
    let body: {
      amount_cents?: number;
      payment_method: string;
      payer_label?: string | null;
      order_item_ids?: number[];
    };
    if (lineIds.length > 0) {
      const lineTotal = this.selectedSplitLineTotalCents(order);
      if (lineTotal < 1) {
        this.showToast(this.translate.instant('ORDERS.PARTIAL_PAYMENT_AMOUNT_REQUIRED'), 'error');
        return;
      }
      if (lineTotal > remaining) {
        this.showToast(this.translate.instant('ORDERS.PARTIAL_PAYMENT_EXCEEDS'), 'error');
        return;
      }
      body = {
        order_item_ids: lineIds,
        payment_method: this.paymentMethod,
        payer_label: this.partialPaymentPayerLabel.trim() || null,
      };
    } else {
      const cents = this.parseMoneyMajorToCents(this.partialPaymentAmountInput);
      if (cents < 1) {
        this.showToast(this.translate.instant('ORDERS.PARTIAL_PAYMENT_AMOUNT_REQUIRED'), 'error');
        return;
      }
      if (cents > remaining) {
        this.showToast(this.translate.instant('ORDERS.PARTIAL_PAYMENT_EXCEEDS'), 'error');
        return;
      }
      body = {
        amount_cents: cents,
        payment_method: this.paymentMethod,
        payer_label: this.partialPaymentPayerLabel.trim() || null,
      };
    }
    this.processingPayment.set(true);
    this.api.recordOrderPayment(order.id, body).subscribe({
      next: (res) => {
        this.processingPayment.set(false);
        this.partialPaymentAmountInput = '';
        this.partialPaymentPayerLabel = '';
        this.selectedSplitLineIds = new Set();
        if (res.status === 'paid' || res.paid_at) {
          this.showToast(this.translate.instant('COMMON.SUCCESS'), 'success');
          this.closePaymentModal();
          this.loadOrders();
          return;
        }
        const updated: Order = {
          ...order,
          amount_due_cents: res.amount_due_cents,
          amount_paid_cents: res.amount_paid_cents,
          amount_remaining_cents: res.amount_remaining_cents,
          payments: res.payments,
        };
        this.orderToMarkPaid.set(updated);
        this.showToast(this.translate.instant('ORDERS.PARTIAL_PAYMENT_RECORDED'), 'success');
        this.loadOrders();
      },
      error: (err) => {
        this.processingPayment.set(false);
        const detail = err?.error?.detail || this.translate.instant('ORDERS.FAILED_TO_MARK_PAID');
        this.showToast(
          typeof detail === 'string' ? detail : this.translate.instant('ORDERS.FAILED_TO_MARK_PAID'),
          'error',
        );
      },
    });
  }

  orderPaymentSubtotal(order: Order): number {
    const extra = order.extra_charge_cents || 0;
    if (order.subtotal_cents != null && order.subtotal_cents >= 0) {
      return order.subtotal_cents + extra;
    }
    const items = (order.items || []).filter(
      i => !i.removed_by_customer && i.status !== 'cancelled'
    );
    return items.reduce((s, i) => s + (i.price_cents || 0) * (i.quantity || 0), 0) + extra;
  }

  /** Additional-charge amount typed in the payment modal; null = show the order's saved value. */
  paymentExtraInput: string | null = null;
  /** The extra-charge row and quick amounts stay hidden until staff asks for them. */
  extraEditorOpen = signal(false);

  readonly extraQuickAmounts = [1000, 2000, 5000, 10000];

  addExtraAmount(pesos: number): void {
    const order = this.orderToMarkPaid();
    if (!order) return;
    const current = this.parseMoneyMajorToCents(this.extraChargeInputValue(order)) / 100;
    this.paymentExtraInput = String(current + pesos);
  }

  extraChargeInputValue(order: Order): string {
    if (this.paymentExtraInput !== null) return this.paymentExtraInput;
    const c = order.extra_charge_cents || 0;
    return c > 0 ? (c / 100).toString() : '';
  }


  applyExtraCharge(): void {
    const order = this.orderToMarkPaid();
    if (!order) return;
    const cents = this.parseMoneyMajorToCents(this.extraChargeInputValue(order));
    this.api.setOrderExtraCharge(order.id, cents).subscribe({
      next: res => {
        this.orderToMarkPaid.set({
          ...order,
          extra_charge_cents: res.extra_charge_cents,
          extra_charge_note: res.extra_charge_note,
        });
        this.paymentExtraInput = null;
        this.extraEditorOpen.set(false);
        this.paymentAmountPaidInput = '';
        this.paymentTipAmountInput = '';
        this.loadOrders();
        this.showToast(this.translate.instant('ORDERS.EXTRA_CHARGE_SAVED'), 'success');
      },
      error: () => this.showToast(this.translate.instant('ORDERS.EXTRA_CHARGE_FAILED'), 'error'),
    });
  }

  tipEntryModeOverpayment(): boolean {
    return this.tenantSettings()?.tip_entry_mode === 'overpayment';
  }

  /** Exposed for payment modal template */
  paymentTipAmountDisplayCents(): number {
    return this.parseMoneyMajorToCents(this.paymentTipAmountInput);
  }

  private parseMoneyMajorToCents(s: string): number {
    const t = (s || '').replace(',', '.').trim();
    if (!t) return 0;
    const n = parseFloat(t);
    if (Number.isNaN(n) || n < 0) return 0;
    return Math.round(n * 100);
  }

  onPaymentAmountPaidChange(): void {
    const order = this.orderToMarkPaid();
    if (!order) return;
    const sub = this.orderPaymentSubtotal(order);
    const paid = this.parseMoneyMajorToCents(this.paymentAmountPaidInput);
    const tip = Math.max(0, paid - sub);
    this.paymentTipAmountInput = (tip / 100).toFixed(2);
  }

  tipPresetsForPayment(): number[] {
    const s = this.tenantSettings();
    const raw = s?.tip_preset_percents;
    if (raw == null) {
      return [5, 10, 15, 20];
    }
    if (raw.length === 0) {
      return [];
    }
    const seen = new Set<number>();
    const out: number[] = [];
    for (const p of raw) {
      const v = Math.floor(Number(p));
      if (v > 0 && v <= 100 && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
      if (out.length >= 4) {
        break;
      }
    }
    return out;
  }

  paymentTipPreviewCents(order: Order | null | undefined): number {
    if (!order) return 0;
    const sub = this.orderPaymentSubtotal(order);
    const p = this.paymentTipPercent;
    if (!p || sub <= 0) return 0;
    return Math.floor((sub * p + 50) / 100);
  }

  paymentGrandTotalCents(order: Order | null | undefined): number {
    if (!order) return 0;
    return this.orderPaymentSubtotal(order) + this.paymentTipPreviewCents(order);
  }

  paymentOverpaymentGrandTotalCents(): number {
    const order = this.orderToMarkPaid();
    if (!order) return 0;
    return this.orderPaymentSubtotal(order) + this.parseMoneyMajorToCents(this.paymentTipAmountInput);
  }

  confirmMarkAsPaid() {
    const order = this.orderToMarkPaid();
    if (!order || !this.paymentMethod) return;

    this.processingPayment.set(true);
    const presetOpts = { tipEntryMode: 'preset' as const, tipPercent: null };
    const req = this.paymentModalFinishMode()
      ? this.api.finishOrder(order.id, this.paymentMethod, presetOpts)
      : this.api.markOrderPaid(order.id, this.paymentMethod, presetOpts);
    req.subscribe({
      next: () => {
        this.processingPayment.set(false);
        this.closePaymentModal();
        this.loadOrders();
      },
      error: () => {
        this.processingPayment.set(false);
        this.showToast(
          this.translate.instant(
            this.paymentModalFinishMode() ? 'ORDERS.FAILED_TO_FINISH' : 'ORDERS.FAILED_TO_MARK_PAID'
          ),
          'error'
        );
      }
    });
  }
}
