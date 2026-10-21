/**
 * Inventory Items Component
 *
 * Main view for managing inventory items (raw materials, supplies).
 * Follows app design patterns from products.component.ts
 */

import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SidebarComponent } from '../../shared/sidebar.component';
import { FocusFirstInputDirective } from '../../shared/focus-first-input.directive';
import { AppSelectComponent, AppSelectOption } from '../../shared/app-select.component';
import { InventoryService } from '../inventory.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  InventoryItem,
  InventoryItemCreate,
  InventoryItemUpdate,
  StockAdjustment,
  Warehouse,
  UnitOfMeasure,
  InventoryCategory,
  inventoryUnitKey,
  inventoryCategoryKey,
} from '../inventory.types';

/** Hand-drawn line icons per unit (24x24, stroke): a grain, kettlebell, scale, sack, drop, tube, bottle, shot glass, mug and jug. */
const UNIT_ICONS: Record<string, string> = {
  piece: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  gram: '<path d="M12 21V9"/><path d="M12 9c-2.5-.2-4-1.8-4-4 2.5.2 4 1.8 4 4zM12 9c2.5-.2 4-1.8 4-4-2.5.2-4 1.8-4 4zM12 14c-2.5-.2-4-1.8-4-4 2.5.2 4 1.8 4 4zM12 14c2.5-.2 4-1.8 4-4-2.5.2-4 1.8-4 4z"/>',
  kilogram: '<circle cx="12" cy="14.5" r="6"/><path d="M8.6 9.8C9 6.2 10.4 4 12 4s3 2.2 3.4 5.8"/><path d="M10 14.5h4"/>',
  ounce: '<path d="M12 4v16M8 20h8M5 7.5h14"/><path d="M5 7.5L2.5 13a2.5 2.5 0 005 0zM19 7.5L16.5 13a2.5 2.5 0 005 0z"/>',
  pound: '<path d="M8.5 3.5h7L14 7c3 1.8 4.5 4.6 4.5 7.5a5 5 0 01-5 5h-3a5 5 0 01-5-5C5.5 11.6 7 8.8 10 7z"/><path d="M9.2 7h5.6"/>',
  milliliter: '<path d="M12 3s6 6.2 6 10.5a6 6 0 01-12 0C6 9.2 12 3 12 3z"/><path d="M9.5 14a2.6 2.6 0 002.5 2.6"/>',
  centiliter: '<path d="M9 3h6M10 3v13a2 2 0 004 0V3"/><path d="M10 12h4M10 8.5h2"/>',
  liter: '<path d="M10 2h4v3l1.6 2.6V20a2 2 0 01-2 2h-3.2a2 2 0 01-2-2V7.6L10 5z"/><path d="M8.4 12.5h7.2"/>',
  fluid_ounce: '<path d="M7 5h10l-1.4 14a1.5 1.5 0 01-1.5 1.4H9.9a1.5 1.5 0 01-1.5-1.4z"/><path d="M7.4 10h9.2"/>',
  cup: '<path d="M5 9h11v6a5 5 0 01-5 5h-1a5 5 0 01-5-5z"/><path d="M16 11h1.6a2.4 2.4 0 010 4.8H16"/><path d="M8.5 3.5c0 1.5 1.3 1.5 1.3 3M12.5 3.5c0 1.5 1.3 1.5 1.3 3"/>',
  gallon: '<path d="M9 2h5v3l3 3v11a3 3 0 01-3 3H9a3 3 0 01-3-3V8l3-3z"/><path d="M6 11H4.5a1.5 1.5 0 000 3H6M10 13.5h4"/>',
};

@Component({
  selector: 'app-inventory-items',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RouterModule,
    SidebarComponent,
    FocusFirstInputDirective,
    TranslateModule,
    AppSelectComponent,
  ],
  template: `
    <app-sidebar>
      <div class="page-header ii-header">
        <div class="ii-title">
          <h1>{{ 'INVENTORY.ITEMS.TITLE' | translate }}</h1>
          <p>{{ 'INVENTORY.ITEMS.SUBTITLE' | translate }}</p>
        </div>
        @if (!showItemModal() && !showAdjustModal()) {
          <button class="ii-new" (click)="openCreateModal()"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>{{ 'INVENTORY.ITEMS.ADD_ITEM' | translate }}</button>
        }
      </div>

      <div class="content">
        <!-- Stats -->
        <div class="ii-kpis">
          <div class="ii-kpi">
            <span class="ii-kpi-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg></span>
            <div><strong>{{ totalItems() }}</strong><small>{{ 'INVENTORY.ITEMS.TOTAL_ITEMS' | translate }}</small></div>
          </div>
          <div class="ii-kpi" [class.ii-kpi-warn]="lowStockCount() > 0">
            <span class="ii-kpi-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg></span>
            <div><strong>{{ lowStockCount() }}</strong><small>{{ 'INVENTORY.ITEMS.LOW_STOCK' | translate }}</small></div>
          </div>
          <div class="ii-kpi ii-kpi-main">
            <span class="ii-kpi-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M14.5 9a2.5 2.5 0 00-5 0c0 3.5 5 1.5 5 5a2.5 2.5 0 01-5 0M12 6v2M12 16v2"/></svg></span>
            <div><strong>{{ formatCurrency(totalValue()) }}</strong><small>{{ 'INVENTORY.ITEMS.TOTAL_VALUE' | translate }}</small></div>
          </div>
        </div>

        <!-- Filters -->
        <div class="ii-filters">
          <label class="ii-search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input type="text" [placeholder]="'INVENTORY.ITEMS.SEARCH_PLACEHOLDER' | translate" [(ngModel)]="searchQuery" (input)="filterItems()" />
          </label>
          <label class="ii-switch">
            <input type="checkbox" [(ngModel)]="showLowStock" (change)="filterItems()" />
            <span class="ii-switch-track" aria-hidden="true"></span>
            <span>{{ 'INVENTORY.ITEMS.LOW_STOCK_ONLY' | translate }}</span>
          </label>
          <div class="ii-view" role="group">
            <button type="button" [class.on]="itemsView() === 'cards'" (click)="setItemsView('cards')" [title]="'INVENTORY.ITEMS.VIEW_CARDS' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg></button>
            <button type="button" [class.on]="itemsView() === 'table'" (click)="setItemsView('table')" [title]="'INVENTORY.ITEMS.VIEW_TABLE' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></button>
          </div>
          <div class="ii-chips" role="group" [attr.aria-label]="'INVENTORY.ITEMS.CATEGORY' | translate">
            <button type="button" class="ii-chip" [class.on]="categoryFilter === ''" (click)="setCategoryFilter('')">
              {{ 'INVENTORY.ITEMS.ALL_CATEGORIES' | translate }} <span>{{ items().length }}</span>
            </button>
            @for (cat of categories; track cat) {
              <button type="button" class="ii-chip" [class.on]="categoryFilter === cat" (click)="setCategoryFilter(cat)">
                <i aria-hidden="true">{{ categoryIcon(cat) }}</i>{{ categoryKey(cat) | translate }} <span>{{ categoryCount(cat) }}</span>
              </button>
            }
          </div>
        </div>

        @if (error()) {
          <div class="error-banner">
            <span>{{ error() }}</span>
            <button class="icon-btn" (click)="error.set('')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        }

        @if (loading()) {
          <div class="empty-state">
            <p>{{ 'INVENTORY.ITEMS.LOADING_ITEMS' | translate }}</p>
          </div>
        } @else if (filteredItems().length === 0) {
          <div class="empty-state">
            <div class="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
              </svg>
            </div>
            <h3>{{ 'INVENTORY.ITEMS.NO_ITEMS_YET' | translate }}</h3>
            <p>{{ 'INVENTORY.ITEMS.NO_ITEMS_DESC' | translate }}</p>
            <button class="btn btn-primary" (click)="openCreateModal()">{{ 'INVENTORY.ITEMS.ADD_ITEM' | translate }}</button>
          </div>
        } @else if (itemsView() === 'cards') {
          <div class="ii-grid">
            @for (item of filteredItems(); track item.id) {
              <article class="ii-card" [attr.data-tone]="stockTone(item)" [class.ii-card-off]="!item.is_active">
                <header class="ii-card-head">
                  <span class="ii-avatar" aria-hidden="true">{{ categoryIcon(item.category) }}</span>
                  <div class="ii-card-title">
                    <h3>{{ item.name || '-' }}</h3>
                    <span class="ii-sku">{{ item.sku || '-' }}@if (item.category) { · {{ categoryKey(item.category) | translate }} }</span>
                  </div>
                  @if (item.is_low_stock) {
                    <span class="ii-badge ii-badge-warn">{{ 'INVENTORY.ITEMS.STATUS_LOW_STOCK' | translate }}</span>
                  } @else if (!item.is_active) {
                    <span class="ii-badge">{{ 'INVENTORY.ITEMS.STATUS_INACTIVE' | translate }}</span>
                  } @else {
                    <span class="ii-badge ii-badge-ok">{{ 'INVENTORY.ITEMS.STATUS_OK' | translate }}</span>
                  }
                </header>
                @if (item.description) {
                  <p class="ii-desc">{{ item.description }}</p>
                }
                <div class="ii-stock">
                  <div class="ii-stock-num" [class.negative]="(item.current_quantity || 0) < 0">
                    <strong>{{ (item.current_quantity || 0).toFixed(2) }}</strong>
                    <span>{{ item.unit ? (unitKey(item.unit) | translate) : '' }}</span>
                  </div>
                  <div class="ii-gauge" role="img" [attr.aria-label]="(item.current_quantity || 0).toFixed(2)">
                    <div class="ii-gauge-fill" [style.width.%]="stockPercent(item)"></div>
                    @if ((item.reorder_level || 0) > 0) {
                      <i class="ii-gauge-mark" [style.left.%]="reorderMarkPercent(item)" [title]="'INVENTORY.ITEMS.REORDER' | translate"></i>
                    }
                  </div>
                  <small class="ii-min">{{ 'INVENTORY.ITEMS.REORDER' | translate }}: {{ (item.reorder_level || 0).toFixed(2) }}</small>
                </div>
                <div class="ii-money">
                  <span><small>{{ 'INVENTORY.ITEMS.AVG_COST' | translate }}</small><b>{{ formatCurrency(item.average_cost_cents || 0) }}</b></span>
                  <span><small>{{ 'INVENTORY.ITEMS.VALUE' | translate }}</small><b>{{ formatCurrency((item.current_quantity || 0) * (item.average_cost_cents || 0)) }}</b></span>
                </div>
                <footer class="ii-actions">
                  <button class="ii-act ii-act-main" (click)="openAdjustModal(item)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>{{ 'INVENTORY.ITEMS.ADJUST_STOCK' | translate }}</button>
                  <button class="ii-act-ico" [title]="'INVENTORY.COMMON.EDIT' | translate" [attr.aria-label]="'INVENTORY.COMMON.EDIT' | translate" (click)="openEditModal(item)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                  <button class="ii-act-ico ii-act-danger" [title]="'INVENTORY.COMMON.DELETE' | translate" [attr.aria-label]="'INVENTORY.COMMON.DELETE' | translate" (click)="confirmDelete(item)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
                </footer>
              </article>
            }
          </div>
        } @else {
          <div class="ii-list" data-testid="inventory-list">
            <div class="ii-list-head" role="row">
              <span>{{ 'INVENTORY.ITEMS.NAME' | translate }}</span>
              <span>{{ 'INVENTORY.ITEMS.CATEGORY' | translate }}</span>
              <span>{{ 'INVENTORY.ITEMS.STOCK' | translate }}</span>
              <span class="ii-col-num">{{ 'INVENTORY.ITEMS.AVG_COST' | translate }}</span>
              <span class="ii-col-num">{{ 'INVENTORY.ITEMS.VALUE' | translate }}</span>
              <span>{{ 'INVENTORY.ITEMS.STATUS' | translate }}</span>
              <span></span>
            </div>
            @for (item of filteredItems(); track item.id) {
              <div class="ii-row" role="row" [attr.data-tone]="stockTone(item)" [class.ii-row-off]="!item.is_active">
                <div class="ii-cell ii-cell-name">
                  <span class="ii-avatar ii-avatar-sm" aria-hidden="true">{{ categoryIcon(item.category) }}</span>
                  <div class="ii-name-text">
                    <b>{{ item.name || '-' }}</b>
                    <small>{{ item.sku || '-' }}@if (item.description) { · {{ item.description }} }</small>
                  </div>
                </div>
                <div class="ii-cell ii-cell-cat" [attr.data-label]="'INVENTORY.ITEMS.CATEGORY' | translate">
                  @if (item.category) {
                    <span class="ii-cat-pill">{{ categoryKey(item.category) | translate }}</span>
                  } @else { - }
                </div>
                <div class="ii-cell ii-cell-stock" [attr.data-label]="'INVENTORY.ITEMS.STOCK' | translate">
                  <div class="ii-stock-line" [class.negative]="(item.current_quantity || 0) < 0">
                    <b>{{ (item.current_quantity || 0).toFixed(2) }}</b>
                    <span>{{ item.unit ? (unitKey(item.unit) | translate) : '' }}</span>
                  </div>
                  <div class="ii-gauge ii-gauge-sm"><div class="ii-gauge-fill" [style.width.%]="stockPercent(item)"></div></div>
                  <small>{{ 'INVENTORY.ITEMS.REORDER' | translate }}: {{ (item.reorder_level || 0).toFixed(2) }}</small>
                </div>
                <div class="ii-cell ii-col-num" [attr.data-label]="'INVENTORY.ITEMS.AVG_COST' | translate">{{ formatCurrency(item.average_cost_cents || 0) }}</div>
                <div class="ii-cell ii-col-num ii-value" [attr.data-label]="'INVENTORY.ITEMS.VALUE' | translate">{{ formatCurrency((item.current_quantity || 0) * (item.average_cost_cents || 0)) }}</div>
                <div class="ii-cell">
                  @if (item.is_low_stock) {
                    <span class="ii-badge ii-badge-warn">{{ 'INVENTORY.ITEMS.STATUS_LOW_STOCK' | translate }}</span>
                  } @else if (!item.is_active) {
                    <span class="ii-badge">{{ 'INVENTORY.ITEMS.STATUS_INACTIVE' | translate }}</span>
                  } @else {
                    <span class="ii-badge ii-badge-ok">{{ 'INVENTORY.ITEMS.STATUS_OK' | translate }}</span>
                  }
                </div>
                <div class="ii-cell ii-cell-actions">
                  <button class="ii-act-ico ii-act-ico-main" [title]="'INVENTORY.ITEMS.ADJUST_STOCK' | translate" [attr.aria-label]="'INVENTORY.ITEMS.ADJUST_STOCK' | translate" (click)="openAdjustModal(item)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V10M18 20V4M6 20v-4"/></svg></button>
                  <button class="ii-act-ico" [title]="'INVENTORY.COMMON.EDIT' | translate" [attr.aria-label]="'INVENTORY.COMMON.EDIT' | translate" (click)="openEditModal(item)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                  <button class="ii-act-ico ii-act-danger" [title]="'INVENTORY.COMMON.DELETE' | translate" [attr.aria-label]="'INVENTORY.COMMON.DELETE' | translate" (click)="confirmDelete(item)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- Create/Edit Modal -->
      @if (showItemModal()) {
        <div class="modal-overlay">
          <div class="modal im" (click)="$event.stopPropagation()" appFocusFirstInput>
            <div class="im-head">
              <span class="im-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg></span>
              <div class="im-head-text">
                <h3>{{ editingItem() ? ('INVENTORY.ITEMS.EDIT_ITEM' | translate) : ('INVENTORY.ITEMS.NEW_ITEM' | translate) }}</h3>
                <p>{{ itemPreview() }}</p>
              </div>
              <button type="button" class="im-close" (click)="closeModals()" [attr.aria-label]="'INVENTORY.COMMON.CANCEL' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            </div>
            <form [formGroup]="itemForm" (ngSubmit)="saveItem()" class="im-form">
              <div class="im-body">
                <section class="im-sec">
                  <h4><i>1</i>{{ 'INVENTORY.ITEMS.FORM_IDENTITY' | translate }}</h4>
                  <div class="im-two">
                    <div class="im-field im-field-sku">
                      <label for="sku">{{ 'INVENTORY.ITEMS.SKU' | translate }}</label>
                      <input type="text" id="sku" formControlName="sku" placeholder="ART-0001" />
                    </div>
                    <div class="im-field">
                      <label for="name">{{ 'INVENTORY.ITEMS.NAME' | translate }}</label>
                      <input type="text" id="name" formControlName="name" placeholder="e.g., All-Purpose Flour" />
                    </div>
                  </div>
                  <div class="im-field">
                    <label for="description">{{ 'INVENTORY.ITEMS.DESCRIPTION' | translate }}</label>
                    <input type="text" id="description" formControlName="description" />
                  </div>
                </section>

                <section class="im-sec">
                  <h4><i>2</i>{{ 'INVENTORY.ITEMS.FORM_MEASURE' | translate }}</h4>
                  <div class="im-two">
                    <div class="im-field">
                      <label for="category">{{ 'INVENTORY.ITEMS.CATEGORY' | translate }}</label>
                      <app-select id="category" formControlName="category" [options]="categoryRichOptions()" [searchable]="false" />
                    </div>
                    <div class="im-field">
                      <label for="unit">{{ 'INVENTORY.ITEMS.UNIT' | translate }}</label>
                      <app-select id="unit" formControlName="unit" [options]="unitRichOptions()" [searchable]="false" />
                    </div>
                  </div>
                </section>

                <section class="im-sec">
                  <h4><i>3</i>{{ 'INVENTORY.ITEMS.FORM_ALERTS' | translate }}</h4>
                  <p class="im-hint">{{ 'INVENTORY.ITEMS.FORM_ALERTS_HINT' | translate }}</p>
                  <div class="im-two">
                    <div class="im-field">
                      <label for="reorder_level">{{ 'INVENTORY.ITEMS.REORDER_LEVEL' | translate }}</label>
                      <div class="im-unit-input">
                        <input type="number" id="reorder_level" formControlName="reorder_level" [step]="stepFor(itemForm.value['unit'])" min="0" />
                        <span>{{ unitShort(itemForm.value['unit']) }}</span>
                      </div>
                    </div>
                    <div class="im-field">
                      <label for="reorder_quantity">{{ 'INVENTORY.ITEMS.REORDER_QTY' | translate }}</label>
                      <div class="im-unit-input">
                        <input type="number" id="reorder_quantity" formControlName="reorder_quantity" [step]="stepFor(itemForm.value['unit'])" min="0" />
                        <span>{{ unitShort(itemForm.value['unit']) }}</span>
                      </div>
                    </div>
                  </div>
                  @if (editingItem()) {
                    <label class="im-active">
                      <input type="checkbox" formControlName="is_active" />
                      <span class="im-switch" aria-hidden="true"></span>
                      <span>{{ 'INVENTORY.ITEMS.ITEM_IS_ACTIVE' | translate }}</span>
                    </label>
                  }
                </section>
              </div>
              <div class="im-foot">
                <button type="button" class="im-btn im-btn-ghost" (click)="closeModals()">{{ 'INVENTORY.COMMON.CANCEL' | translate }}</button>
                <button type="submit" class="im-btn im-btn-main" [disabled]="!itemForm.valid || saving()">
                  {{ saving() ? ('INVENTORY.COMMON.SAVING' | translate) : (editingItem() ? ('INVENTORY.COMMON.UPDATE' | translate) : ('INVENTORY.COMMON.CREATE' | translate)) }}
                </button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Stock Adjustment Modal -->
      @if (showAdjustModal()) {
        <div class="modal-overlay">
          <div class="modal im ad" (click)="$event.stopPropagation()" appFocusFirstInput>
            <div class="im-head">
              <span class="im-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V10M18 20V4M6 20v-4"/></svg></span>
              <div class="im-head-text">
                <h3>{{ 'INVENTORY.ITEMS.ADJUST_STOCK' | translate }}</h3>
                <p>{{ adjustingItem()?.name }}</p>
              </div>
              <button type="button" class="im-close" (click)="closeModals()" [attr.aria-label]="'INVENTORY.COMMON.CANCEL' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            </div>
            <form [formGroup]="adjustForm" (ngSubmit)="submitAdjustment()" class="im-form">
              <div class="im-body">
                <div class="ad-now">
                  <span class="ad-now-ico" aria-hidden="true">{{ categoryIcon(adjustingItem()?.category) }}</span>
                  <div>
                    <small>{{ 'INVENTORY.ITEMS.CURRENT' | translate }}</small>
                    <strong>{{ adjustingItem()?.current_quantity?.toFixed(2) }} <span>{{ unitKey(adjustingItem()!.unit) | translate }}</span></strong>
                  </div>
                </div>

                <section class="im-sec">
                  <h4><i>1</i>{{ 'INVENTORY.ITEMS.ADJUSTMENT_TYPE' | translate }}</h4>
                  <div class="ad-types" role="group" [attr.aria-label]="'INVENTORY.ITEMS.ADJUSTMENT_TYPE' | translate">
                    <button type="button" class="ad-type ad-type-add" [class.on]="adjustType() === 'adjustment_add'" (click)="setAdjustmentType('adjustment_add')">
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg><b>{{ 'INVENTORY.ITEMS.ADD_STOCK' | translate }}</b><small>{{ 'INVENTORY.ITEMS.ADD_STOCK_HINT' | translate }}</small>
                    </button>
                    <button type="button" class="ad-type ad-type-sub" [class.on]="adjustType() === 'adjustment_subtract'" (click)="setAdjustmentType('adjustment_subtract')">
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg><b>{{ 'INVENTORY.ITEMS.REMOVE_STOCK' | translate }}</b><small>{{ 'INVENTORY.ITEMS.REMOVE_STOCK_HINT' | translate }}</small>
                    </button>
                    <button type="button" class="ad-type ad-type-waste" [class.on]="adjustType() === 'waste'" (click)="setAdjustmentType('waste')">
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg><b>{{ 'INVENTORY.ITEMS.RECORD_WASTE' | translate }}</b><small>{{ 'INVENTORY.ITEMS.WASTE_HINT' | translate }}</small>
                    </button>
                  </div>
                </section>

                <section class="im-sec">
                  <h4><i>2</i>{{ 'INVENTORY.ITEMS.QUANTITY' | translate }}</h4>
                  <div class="ad-qty">
                    <button type="button" class="ad-step" (click)="stepAdjustQty(-1)" aria-label="-">−</button>
                    <input type="number" id="adjust_quantity" formControlName="quantity" [step]="stepFor(adjustForm.value['unit'])" [min]="stepFor(adjustForm.value['unit'])" />
                    <button type="button" class="ad-step ad-step-plus" (click)="stepAdjustQty(1)" aria-label="+">+</button>
                  </div>
                  <div class="im-two">
                    <div class="im-field">
                      <label for="adjust_unit">{{ 'INVENTORY.ITEMS.UNIT' | translate }}</label>
                      <app-select id="adjust_unit" formControlName="unit" [options]="unitRichOptions()" [searchable]="false" />
                    </div>
                    <div class="im-field">
                      <label for="adjust_warehouse">{{ 'INVENTORY.WAREHOUSES.WAREHOUSE' | translate }}</label>
                      <app-select id="adjust_warehouse" formControlName="warehouse_id" [options]="warehouseOptions()" [searchable]="false" />
                    </div>
                  </div>
                  @if (adjustResult(); as r) {
                    <div class="ad-result" [attr.data-type]="adjustType()">
                      <span>{{ adjustingItem()?.current_quantity?.toFixed(2) }}</span>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                      <strong [class.negative]="r.value < 0">{{ r.value.toFixed(2) }} {{ unitKey(adjustingItem()!.unit) | translate }}</strong>
                      <small>{{ 'INVENTORY.ITEMS.NEW_STOCK' | translate }}</small>
                    </div>
                  }
                </section>

                <section class="im-sec">
                  <h4><i>3</i>{{ 'INVENTORY.ITEMS.NOTES' | translate }}</h4>
                  <div class="im-field">
                    <input type="text" id="adjust_notes" formControlName="notes" [placeholder]="'INVENTORY.ITEMS.NOTES_PLACEHOLDER' | translate" />
                  </div>
                </section>
              </div>
              <div class="im-foot">
                <button type="button" class="im-btn im-btn-ghost" (click)="closeModals()">{{ 'INVENTORY.COMMON.CANCEL' | translate }}</button>
                <button type="submit" class="im-btn im-btn-main" [disabled]="!adjustForm.valid || saving()">
                  {{ saving() ? ('INVENTORY.ITEMS.PROCESSING' | translate) : ('INVENTORY.ITEMS.APPLY' | translate) }}
                </button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Delete Confirmation Modal -->
      @if (showDeleteModal()) {
        <div class="modal-overlay" (click)="closeModals()">
          <div class="modal modal-sm" (click)="$event.stopPropagation()">
            <h3>{{ 'INVENTORY.ITEMS.DELETE_ITEM' | translate }}</h3>
            <p>{{ 'INVENTORY.ITEMS.DELETE_CONFIRM' | translate:{ name: deletingItem()?.name } }}</p>
            <div class="modal-actions">
              <button class="btn btn-secondary" (click)="closeModals()">{{ 'INVENTORY.COMMON.CANCEL' | translate }}</button>
              <button class="btn btn-danger" (click)="deleteItem()" [disabled]="saving()">
                {{ saving() ? ('INVENTORY.ITEMS.DELETING' | translate) : ('INVENTORY.COMMON.DELETE' | translate) }}
              </button>
            </div>
          </div>
        </div>
      }
    </app-sidebar>
  `,
  styleUrl: './inventory-items.component.scss'
})
export class InventoryItemsComponent implements OnInit {
  private inventoryService = inject(InventoryService);
  private translate = inject(TranslateService);
  private fb = inject(FormBuilder);

  // State signals
  items = signal<InventoryItem[]>([]);
  warehouses = signal<Warehouse[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  showItemModal = signal(false);
  showAdjustModal = signal(false);
  showDeleteModal = signal(false);
  editingItem = signal<InventoryItem | null>(null);
  adjustingItem = signal<InventoryItem | null>(null);
  deletingItem = signal<InventoryItem | null>(null);

  // Filter state
  searchQuery = '';
  categoryFilter = '';
  showLowStock = false;

  // Static data
  units: UnitOfMeasure[] = ['piece', 'gram', 'kilogram', 'ounce', 'pound', 'milliliter', 'centiliter', 'liter', 'fluid_ounce', 'cup', 'gallon'];
  categories: InventoryCategory[] = ['ingredients', 'beverages', 'packaging', 'cleaning', 'equipment', 'other'];

  readonly unitKey = inventoryUnitKey;
  readonly categoryKey = inventoryCategoryKey;

  itemForm: FormGroup = this.fb.group({
    sku: [''],
    name: ['', Validators.required],
    description: [''],
    unit: ['piece', Validators.required],
    category: ['ingredients', Validators.required],
    reorder_level: [0],
    reorder_quantity: [0],
    is_active: [true],
  });

  adjustForm: FormGroup = this.fb.group({
    quantity: [1, [Validators.required, Validators.min(0.01)]],
    unit: ['piece', Validators.required],
    adjustment_type: ['adjustment_add', Validators.required],
    warehouse_id: [null as number | null, Validators.required],
    notes: [''],
  });

  filteredItems = computed(() => {
    let result = this.items();
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      result = result.filter(i => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
    }
    if (this.categoryFilter) {
      result = result.filter(i => i.category === this.categoryFilter);
    }
    if (this.showLowStock) {
      result = result.filter(i => i.is_low_stock);
    }
    return result;
  });

  totalItems = computed(() => this.filteredItems().length);
  lowStockCount = computed(() => this.items().filter(i => i.is_low_stock).length);
  totalValue = computed(() => this.filteredItems().reduce((sum, i) => sum + i.current_quantity * i.average_cost_cents, 0));

  ngOnInit() {
    this.loadItems();
    this.loadWarehouses();
  }

  loadItems() {
    this.loading.set(true);
    this.inventoryService.getItems({ activeOnly: false }).subscribe({
      next: items => { this.items.set(items); this.loading.set(false); },
      error: err => { this.error.set(err.error?.detail || 'Failed to load items'); this.loading.set(false); }
    });
  }

  loadWarehouses() {
    this.inventoryService.getWarehouses().subscribe({
      next: warehouses => this.warehouses.set(warehouses),
      error: err => console.error('Failed to load warehouses:', err)
    });
  }

  filterItems() { this.items.update(items => [...items]); }

  // ----- view + helpers for the card layout -----
  itemsView = signal<'cards' | 'table'>(
    (() => {
      try { return localStorage.getItem('pos.inventory.itemsView') === 'table' ? 'table' : 'cards'; } catch { return 'cards'; }
    })()
  );

  setItemsView(view: 'cards' | 'table'): void {
    this.itemsView.set(view);
    try { localStorage.setItem('pos.inventory.itemsView', view); } catch { /* storage unavailable */ }
  }

  setCategoryFilter(value: string): void {
    this.categoryFilter = value;
    this.filterItems();
  }

  categoryCount(cat: string): number {
    return this.items().filter((i) => i.category === cat).length;
  }

  categoryIcon(cat: string | null | undefined): string {
    const icons: Record<string, string> = {
      ingredients: '🥬', beverages: '🥤', packaging: '📦', cleaning: '🧼', equipment: '🔧', other: '🏷️',
    };
    return icons[cat ?? ''] ?? '🏷️';
  }

  /** ok / low / out: drives the colour of the card and the gauge. */
  stockTone(item: InventoryItem): 'ok' | 'low' | 'out' {
    if ((item.current_quantity || 0) <= 0) return 'out';
    return item.is_low_stock ? 'low' : 'ok';
  }

  /** Gauge: the bar is full at twice the minimum stock (or at any stock when no minimum is set). */
  stockPercent(item: InventoryItem): number {
    const q = Math.max(0, item.current_quantity || 0);
    const min = item.reorder_level || 0;
    if (min <= 0) return q > 0 ? 100 : 0;
    return Math.min(100, (q / (min * 2)) * 100);
  }

  reorderMarkPercent(_item: InventoryItem): number {
    return 50; // the minimum is always drawn at half of the gauge
  }

  /** Short symbol shown next to numeric inputs and in the unit list. */
  unitShort(unit: string | null | undefined): string {
    const m: Record<string, string> = {
      piece: 'pza', gram: 'g', kilogram: 'kg', ounce: 'oz', pound: 'lb', milliliter: 'ml',
      centiliter: 'cl', liter: 'L', fluid_ounce: 'fl oz', cup: 'taza', gallon: 'gal',
    };
    return m[unit ?? ''] ?? '';
  }

  private unitGroup(unit: string): string {
    if (unit === 'piece') return this.translate.instant('INVENTORY.ITEMS.UNIT_GROUP_COUNT');
    if (['gram', 'kilogram', 'ounce', 'pound'].includes(unit)) return this.translate.instant('INVENTORY.ITEMS.UNIT_GROUP_WEIGHT');
    return this.translate.instant('INVENTORY.ITEMS.UNIT_GROUP_VOLUME');
  }

  /** Units grouped as Units / Weight / Volume: the symbol is the icon, the equivalence is the hint. */
  unitRichOptions(): AppSelectOption[] {
    const meta: Record<string, { hint: string; tone: 'a' | 'b' | 'c' }> = {
      piece: { hint: this.translate.instant('INVENTORY.ITEMS.UNIT_HINT_COUNT'), tone: 'c' },
      gram: { hint: this.translate.instant('INVENTORY.ITEMS.UNIT_HINT_WEIGHT_BASE'), tone: 'a' },
      kilogram: { hint: '= 1.000 g', tone: 'a' },
      ounce: { hint: '≈ 28,35 g', tone: 'a' },
      pound: { hint: '≈ 453,6 g', tone: 'a' },
      milliliter: { hint: this.translate.instant('INVENTORY.ITEMS.UNIT_HINT_VOLUME_BASE'), tone: 'b' },
      centiliter: { hint: '= 10 ml', tone: 'b' },
      liter: { hint: '= 1.000 ml', tone: 'b' },
      fluid_ounce: { hint: '≈ 29,6 ml', tone: 'b' },
      cup: { hint: '≈ 240 ml', tone: 'b' },
      gallon: { hint: '≈ 3,785 L', tone: 'b' },
    };
    const order = ['piece', 'gram', 'kilogram', 'ounce', 'pound', 'milliliter', 'centiliter', 'liter', 'fluid_ounce', 'cup', 'gallon'];
    return order
      .filter((u) => this.units.includes(u as UnitOfMeasure))
      .map((u) => ({
        value: u,
        label: this.translate.instant(this.unitKey(u)),
        sub: meta[u].hint,
        svg: UNIT_ICONS[u],
        tone: meta[u].tone,
        group: this.unitGroup(u),
      }));
  }

  categoryRichOptions(): AppSelectOption[] {
    return this.categories.map((c) => ({
      value: c,
      label: this.translate.instant(this.categoryKey(c)),
      sub: this.translate.instant('INVENTORY.ITEMS.CATEGORY_DESC_' + c.toUpperCase()),
      icon: this.categoryIcon(c),
    }));
  }

  /** Header line of the form: "🥬 Harina · kg" once something is typed. */
  itemPreview(): string {
    const v = this.itemForm.value;
    const parts: string[] = [];
    if (v['category']) parts.push(this.categoryIcon(v['category']) + ' ' + this.translate.instant(this.categoryKey(v['category'])));
    if (v['unit']) parts.push(this.unitShort(v['unit']));
    return parts.join(' · ');
  }

  unitOptions(): AppSelectOption[] {
    return this.units.map((u) => ({ value: u, label: this.translate.instant(this.unitKey(u)) }));
  }

  categoryOptions(): AppSelectOption[] {
    return this.categories.map((c) => ({ value: c, label: this.categoryIcon(c) + ' ' + this.translate.instant(this.categoryKey(c)) }));
  }

  warehouseOptions(): AppSelectOption[] {
    return this.warehouses().map((w) => ({
      value: w.id,
      label: w.name,
      sub: w.is_default ? this.translate.instant('INVENTORY.WAREHOUSES.DEFAULT_BADGE') : undefined,
    }));
  }

  /** Arrow step: whole numbers for countable/small units, decimals for large ones. */
  stepFor(unit: string | null | undefined): number {
    return ['piece', 'gram', 'milliliter', 'centiliter'].includes(unit ?? '') ? 1 : 0.01;
  }

  private nextSku(): string {
    const taken = new Set(this.items().map(i => i.sku));
    let n = this.items().length + 1;
    while (taken.has('ART-' + String(n).padStart(4, '0'))) n++;
    return 'ART-' + String(n).padStart(4, '0');
  }

  openCreateModal() {
    this.editingItem.set(null);
    this.itemForm.reset({ sku: this.nextSku(), name: '', description: '', unit: 'piece', category: 'ingredients', reorder_level: 0, reorder_quantity: 0, is_active: true });
    this.showItemModal.set(true);
  }

  openEditModal(item: InventoryItem) {
    this.editingItem.set(item);
    this.itemForm.patchValue({ sku: item.sku, name: item.name, description: item.description || '', unit: item.unit, category: item.category, reorder_level: item.reorder_level, reorder_quantity: item.reorder_quantity, is_active: item.is_active });
    this.showItemModal.set(true);
  }

  openAdjustModal(item: InventoryItem) {
    this.adjustingItem.set(item);
    const defaultWh = this.warehouses().find(w => w.is_default) || this.warehouses()[0];
    this.adjustForm.reset({
      quantity: 1,
      unit: item.unit,
      adjustment_type: 'adjustment_add',
      warehouse_id: defaultWh?.id ?? null,
      notes: '',
    });
    this.adjustType.set('adjustment_add');
    this.showAdjustModal.set(true);
  }

  /** Current adjustment type (signal mirror of the form so the template and result react). */
  adjustType = signal('adjustment_add');

  /** Quantity +/- buttons (step depends on the unit). */
  stepAdjustQty(dir: 1 | -1): void {
    const step = this.stepFor(this.adjustForm.value['unit']);
    const cur = Number(this.adjustForm.value['quantity']) || 0;
    const next = Math.max(step, Math.round((cur + dir * step) * 100) / 100);
    this.adjustForm.patchValue({ quantity: next });
  }

  /** New stock after applying the adjustment; only shown when the unit matches the item's. */
  adjustResult(): { value: number } | null {
    const item = this.adjustingItem();
    const v = this.adjustForm.value;
    const qty = Number(v['quantity']);
    if (!item || !Number.isFinite(qty) || qty <= 0 || v['unit'] !== item.unit) return null;
    this.adjustType(); // re-evaluate when the type changes
    const sign = v['adjustment_type'] === 'adjustment_add' ? 1 : -1;
    return { value: (item.current_quantity || 0) + sign * qty };
  }

  setAdjustmentType(type: string) {
    this.adjustType.set(type);
    this.adjustForm.patchValue({ adjustment_type: type });
  }

  confirmDelete(item: InventoryItem) {
    this.deletingItem.set(item);
    this.showDeleteModal.set(true);
  }

  closeModals() {
    this.showItemModal.set(false);
    this.showAdjustModal.set(false);
    this.showDeleteModal.set(false);
    this.editingItem.set(null);
    this.adjustingItem.set(null);
    this.deletingItem.set(null);
  }

  saveItem() {
    if (!this.itemForm.valid) return;
    this.saving.set(true);
    const data = this.itemForm.value;

    if (this.editingItem()) {
      this.inventoryService.updateItem(this.editingItem()!.id, data).subscribe({
        next: () => { this.saving.set(false); this.closeModals(); this.loadItems(); },
        error: err => { this.error.set(err.error?.detail || 'Failed to update'); this.saving.set(false); }
      });
    } else {
      this.inventoryService.createItem(data).subscribe({
        next: () => { this.saving.set(false); this.closeModals(); this.loadItems(); },
        error: err => { this.error.set(err.error?.detail || 'Failed to create'); this.saving.set(false); }
      });
    }
  }

  submitAdjustment() {
    if (!this.adjustForm.valid || !this.adjustingItem()) return;
    this.saving.set(true);
    const data = this.adjustForm.value;
    const adjustment: StockAdjustment = {
      quantity: data.quantity,
      unit: data.unit,
      adjustment_type: data.adjustment_type,
      notes: data.notes || undefined,
      warehouse_id: data.warehouse_id || undefined,
    };

    this.inventoryService.adjustStock(this.adjustingItem()!.id, adjustment).subscribe({
      next: () => { this.saving.set(false); this.closeModals(); this.loadItems(); },
      error: err => { this.error.set(err.error?.detail || 'Adjustment failed'); this.saving.set(false); }
    });
  }

  deleteItem() {
    if (!this.deletingItem()) return;
    this.saving.set(true);
    this.inventoryService.deleteItem(this.deletingItem()!.id).subscribe({
      next: () => { this.saving.set(false); this.closeModals(); this.loadItems(); },
      error: err => { this.error.set(err.error?.detail || 'Delete failed'); this.saving.set(false); }
    });
  }

  formatCurrency(cents: number): string { return this.inventoryService.formatCurrency(cents); }
}
