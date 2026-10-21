import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService, KitchenStation, Product, ProductBulkImportConfirmResult, Tax } from '../services/api.service';
import { PermissionService } from '../services/permission.service';
import { SidebarComponent } from '../shared/sidebar.component';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { formatMoneyCents } from '../shared/currency-symbol';
import { getSubcategoryLabel as resolveSubcategoryLabel } from '../shared/product-subcategory-label.util';
import { MAX_IMAGE_UPLOAD_BYTES, MAX_IMAGE_UPLOAD_MB } from '../shared/image-upload-limits';
import { CopAmountDirective } from '../shared/cop-amount.directive';
import { CategoriesComponent } from './categories.component';
import { AppSelectComponent, AppSelectOption } from '../shared/app-select.component';
import { ProductBulkImportComponent } from './product-bulk-import.component';
import { InventoryService } from '../inventory/inventory.service';
import { InventoryItem, ProductRecipeItem, UnitOfMeasure, inventoryUnitKey } from '../inventory/inventory.types';
import { getCategoryLabel as resolveCategoryLabel } from '../shared/product-category-label.util';

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [
    FormsModule,
    CopAmountDirective,
    SidebarComponent,
    CommonModule,
    TranslateModule,
    CategoriesComponent,
    ProductBulkImportComponent,
    AppSelectComponent,
  ],
  template: `
    <app-sidebar>
        <section class="pr-hero">
          <div class="pr-hero-top">
            <p class="pr-eyebrow"><i></i>{{ 'PRODUCTS.TITLE' | translate }}</p>
            @if (activeTab() === 'products' && !showAddForm() && !editingProduct() && canEditProducts()) {
              <div class="pr-hero-actions">
                @if (products().length > 0) {
                  <button type="button" class="pr-link-danger btn-delete-all" (click)="confirmDeleteAll()" [disabled]="deletingAll()">
                    {{ 'PRODUCTS.DELETE_ALL' | translate }}
                  </button>
                }
                <button type="button" class="pr-ghost" (click)="openBulkImport()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                  {{ 'PRODUCTS.BULK_IMPORT' | translate }}
                </button>
                <button class="pr-add" (click)="openAddForm()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  {{ 'PRODUCTS.ADD_PRODUCT' | translate }}
                </button>
              </div>
            }
          </div>
          <div class="pr-hero-main">
            <h1 class="pr-title">{{ 'PRODUCTS.HEADLINE_A' | translate }} <em>{{ 'PRODUCTS.HEADLINE_B' | translate }}</em></h1>
            @if (activeTab() === 'products' && products().length > 0) {
              <dl class="pr-kpis">
                <div><dt>{{ 'PRODUCTS.STATS_PRODUCTS' | translate }}</dt><dd>{{ products().length }}</dd></div>
                <div><dt>{{ 'PRODUCTS.KPI_OOS' | translate }}</dt><dd [class.warn]="oosCount() > 0">{{ oosCount() }}</dd></div>
                <div><dt>{{ 'PRODUCTS.STATS_LOW' | translate }}</dt><dd [class.warn]="lowStockCount() > 0">{{ lowStockCount() }}</dd></div>
                @if (avgMargin() !== null) {
                  <div><dt>{{ 'PRODUCTS.KPI_MARGIN' | translate }}</dt><dd class="green">{{ avgMargin() }}%</dd></div>
                }
              </dl>
            }
          </div>
        </section>

        <!-- Main Tab Navigation (Button Style like Settings) -->
        <div class="main-tabs-container">
          <div class="main-tabs">
            <button 
              type="button" 
              class="main-tab" 
              [class.active]="activeTab() === 'products'"
              (click)="activeTab.set('products')">
              <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7"/>
                <rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/>
              </svg>
              <span>{{ 'NAV.PRODUCTS' | translate }}</span>
            </button>
            
            <button 
              type="button" 
              class="main-tab" 
              [class.active]="activeTab() === 'categories'"
              (click)="activeTab.set('categories')">
              <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              <span>{{ 'PRODUCTS.PRODUCT_CATEGORIES' | translate }}</span>
            </button>
          </div>
        </div>

        <div class="content">
          @if (activeTab() === 'categories') {
            <app-categories (categoriesChanged)="onCategoriesChanged()"></app-categories>
          } @else {
            @if (showAddForm() || editingProduct()) {
              <div class="form-card">
                 <div class="pf-hero">
                   <div class="pf-plate-wrap">
                     <div class="pf-plate" [class.empty]="!pendingImagePreview() && !editingProduct()?.image_filename">
                       @if (pendingImagePreview()) {
                         <img [src]="pendingImagePreview()" alt="">
                       } @else if (editingProduct()?.image_filename) {
                         <img [src]="getImageUrl(editingProduct()!)" alt="" (error)="handleImageError($event)">
                       } @else {
                         <span class="pf-plate-initial" aria-hidden="true">{{ (formData.name || '?').trim().charAt(0).toUpperCase() || '?' }}</span>
                       }
                     </div>
                     @if (canEditProducts()) {
                       <input type="file" #fileInput accept="image/jpeg,image/png,image/webp,image/avif" (change)="handleImageSelect($event)" style="display:none" data-testid="product-image-input">
                       <button type="button" class="pf-photo-btn" (click)="fileInput.click()" [disabled]="uploading()">
                         <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
                         {{ uploading() ? ('PRODUCTS.UPLOADING' | translate) : ((pendingImageFile() || editingProduct()?.image_filename) ? ('PRODUCTS.CHANGE_IMAGE' | translate) : ('PRODUCTS.UPLOAD_IMAGE' | translate)) }}
                       </button>
                     }
                   </div>
                   <div class="pf-hero-text">
                     <p class="pf-eyebrow"><i></i>{{ editingProduct() ? ('PRODUCTS.EDIT_PRODUCT' | translate) : ('PRODUCTS.NEW_PRODUCT' | translate) }}</p>
                     <h3 class="pf-live-name">{{ formData.name.trim() || ('PRODUCTS.NAME_PLACEHOLDER' | translate) }}</h3>
                     <div class="pf-live-meta">
                       <span class="pf-live-price">{{ formPriceLabel() }}</span>
                       @if (formData.category) { <span class="pf-live-chip">{{ getCategoryLabel(formData.category) }}</span> }
                       @if (formMargin(); as fm) { <span class="pf-live-chip pf-live-margin" [class.low]="fm < 30">{{ fm }}% {{ 'PRODUCTS.MARGIN' | translate }}</span> }
                       @if (formData.out_of_stock) { <span class="pf-live-chip pf-live-oos">{{ 'PRODUCTS.OUT_OF_STOCK_SHORT' | translate }}</span> }
                     </div>
                     @if (pendingImageFile()) { <small class="pf-pending">{{ pendingImageFile()?.name }}</small> }
                     <small class="pf-img-hint">{{ 'PRODUCTS.IMAGE_UPLOAD_HINT' | translate:{ maxMb: maxImageUploadMb } }}</small>
                   </div>
                   <button type="button" class="pf-close" (click)="cancelForm()" [attr.aria-label]="'PRODUCTS.CANCEL' | translate">
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                   </button>
                 </div>
                 @if (error()) {
                   <div class="error-banner form-inline-error" role="alert">
                     <span>{{ error() }}</span>
                     <button type="button" class="icon-btn" (click)="error.set('')" [attr.aria-label]="'COMMON.CLOSE' | translate">
                       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                         <path d="M18 6L6 18M6 6l12 12"/>
                       </svg>
                     </button>
                   </div>
                 }
                 @if (!canEditProducts()) {
                   <p class="form-readonly-hint">{{ 'PRODUCTS.ONLY_OWNERS_CAN_EDIT' | translate }}</p>
                 }
                <form (submit)="saveProduct($event)" class="pf-form">
                  <section class="pf-sec">
                   <h4 class="pf-sec-title">{{ 'PRODUCTS.FORM_BASICS' | translate }}</h4>
                   <div class="form-row">
                     <div class="form-group">
                       <label for="name">{{ 'PRODUCTS.PRODUCT_NAME' | translate }} <span class="required" aria-hidden="true">*</span></label>
                       <input id="name" type="text" [(ngModel)]="formData.name" name="name" required [placeholder]="'PRODUCTS.NAME_PLACEHOLDER' | translate" [readonly]="!canEditProducts()" [class.input-error]="productFormErrors()?.name" (ngModelChange)="clearProductFormError('name')">
                       @if (productFormErrors()?.name) {
                         <span class="field-error" role="alert">{{ 'PRODUCTS.NAME_REQUIRED' | translate }}</span>
                       }
                     </div>
                     <div class="form-group form-group-sm">
                       <label for="price">{{ 'PRODUCTS.PRODUCT_PRICE' | translate }} <span class="required" aria-hidden="true">*</span></label>
                       <div class="price-input">
                         <span class="currency">{{ currency() }}</span>
                         <input id="price" copAmount [(ngModel)]="formData.price" name="price" required [placeholder]="'PRODUCTS.PRICE_PLACEHOLDER' | translate" [readonly]="!canEditProducts()" [class.input-error]="productFormErrors()?.price" (ngModelChange)="clearProductFormError('price')">
                       </div>
                       @if (productFormErrors()?.price) {
                         <span class="field-error" role="alert">{{ 'PRODUCTS.PRICE_REQUIRED' | translate }}</span>
                       }
                     </div>
                     <div class="form-group form-group-sm">
                       <label for="cost">{{ 'PRODUCTS.COST_PRICE' | translate }}</label>
                       <div class="price-input">
                         <span class="currency">{{ currency() }}</span>
                         <input id="cost" copAmount [(ngModel)]="formData.cost" name="cost" [placeholder]="'PRODUCTS.COST_PLACEHOLDER' | translate" [readonly]="!canEditProducts()">
                       </div>
                       <small class="field-hint">{{ 'PRODUCTS.COST_HINT' | translate }}</small>
                     </div>
                   </div>
                   @if (formMargin(); as fm) {
                     <div class="pf-profit">
                       <div class="pf-gauge"><span class="pf-gauge-cost" [style.width.%]="100 - fm"></span><span class="pf-gauge-margin" [class.low]="fm < 30" [style.width.%]="fm"></span></div>
                       <p><b [class.low]="fm < 30">{{ formProfitLabel() }}</b> · {{ 'PRODUCTS.PROFIT_PER_PLATE' | translate }}</p>
                     </div>
                   }
                   <div class="form-group">
                     <label for="description">{{ 'PRODUCTS.DESCRIPTION_LABEL' | translate }}</label>
                     <textarea id="description" [(ngModel)]="formData.description" name="description" [placeholder]="'PRODUCTS.DESCRIPTION_PLACEHOLDER' | translate" rows="3" [readonly]="!canEditProducts()"></textarea>
                   </div>
                  </section>
                  <section class="pf-sec">
                   <h4 class="pf-sec-title">{{ 'PRODUCTS.FORM_CATEGORY' | translate }}</h4>
                   <div class="form-row">
                     <div class="form-group">
                       <label for="category">{{ 'PRODUCTS.CATEGORY_LABEL' | translate }}</label>
                       <app-select
                         id="category"
                         name="category"
                         [(ngModel)]="formData.category"
                         [options]="categoryOptions()"
                         [placeholder]="'PRODUCTS.SELECT_CATEGORY' | translate"
                         [clearable]="true"
                         [emptyValue]="''"
                         [disabled]="!canEditProducts()"
                         (changed)="onCategoryChange()" />
                     </div>
                     <div class="form-group">
                       <label for="subcategory">{{ 'PRODUCTS.SUBCATEGORY_LABEL' | translate }}</label>
                       <app-select
                         id="subcategory"
                         name="subcategory"
                         [(ngModel)]="formData.subcategory"
                         [options]="subcategoryOptions()"
                         [placeholder]="'PRODUCTS.SELECT_SUBCATEGORY' | translate"
                         [clearable]="true"
                         [emptyValue]="''"
                         [disabled]="!canEditProducts() || !formData.category || availableSubcategories().length === 0" />
                     </div>
                   </div>
                  </section>
                  <section class="pf-sec">
                   <h4 class="pf-sec-title">{{ 'PRODUCTS.FORM_AVAILABILITY' | translate }}</h4>
                   <label class="pf-oos" [class.on]="formData.out_of_stock" data-testid="product-out-of-stock">
                     <input type="checkbox" [(ngModel)]="formData.out_of_stock" name="out_of_stock" [disabled]="!canEditProducts()">
                     <span class="pf-switch" aria-hidden="true"></span>
                     <span class="pf-oos-text">
                       <b>{{ 'PRODUCTS.OUT_OF_STOCK' | translate }}</b>
                       <small>{{ 'PRODUCTS.OUT_OF_STOCK_HINT' | translate }}</small>
                     </span>
                   </label>
                   <div class="form-group stock-alert-section" data-testid="product-stock-alert">
                     <label class="checkbox-label">
                       <input
                         type="checkbox"
                         [(ngModel)]="formData.stock_alert_enabled"
                         name="stock_alert_enabled"
                         [disabled]="!canEditProducts()"
                       />
                       {{ 'PRODUCTS.STOCK_ALERT_ENABLED' | translate }}
                     </label>
                     <small class="field-hint">{{ 'PRODUCTS.STOCK_ALERT_HINT' | translate }}</small>
                     @if (formData.stock_alert_enabled) {
                       <div class="form-row stock-alert-fields">
                         <div class="form-group form-group-sm">
                           <label for="stock_qty">{{ 'PRODUCTS.STOCK_QTY' | translate }}</label>
                           <input
                             id="stock_qty"
                             type="number"
                             min="0"
                             step="1"
                             [(ngModel)]="formData.stock_qty"
                             name="stock_qty"
                             [readonly]="!canEditProducts()"
                           />
                         </div>
                         <div class="form-group form-group-sm">
                           <label for="stock_alert_level">{{ 'PRODUCTS.STOCK_ALERT_LEVEL' | translate }}</label>
                           <input
                             id="stock_alert_level"
                             type="number"
                             min="0"
                             step="1"
                             [(ngModel)]="formData.stock_alert_level"
                             name="stock_alert_level"
                             [readonly]="!canEditProducts()"
                           />
                         </div>
                       </div>
                     }
                   </div>
                  </section>
                   @if (canEditProducts() && showAddForm() && !editingProduct()?.id) {
                     <p class="pf-recipe-note">{{ 'PRODUCTS.RECIPE_AFTER_SAVE' | translate }}</p>
                   }

                   @if (canEditProducts() && editingProduct()?.id) {
                     <section class="pf-recipe product-recipe-section">
                       <header class="pf-recipe-head">
                         <span class="pf-recipe-icon" aria-hidden="true">
                           <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6.5L4.6 18.2A2 2 0 006.3 21h11.4a2 2 0 001.7-2.8L14 9.5V3"/><path d="M7.5 15h9"/></svg>
                         </span>
                         <div class="pf-recipe-titles">
                           <h4>{{ 'PRODUCTS.RECIPE_TITLE' | translate }}</h4>
                           <p>{{ 'PRODUCTS.RECIPE_HINT' | translate }}</p>
                         </div>
                         @if (recipeItems().length > 0) {
                           <span class="pf-recipe-count">{{ recipeItems().length }}</span>
                         }
                       </header>

                       @if (recipeLoading()) {
                         <p class="questions-loading">{{ 'PRODUCTS.RECIPE_LOADING' | translate }}</p>
                       } @else {
                         @if (recipeItems().length > 0) {
                           <ul class="pf-ingredients" role="list">
                             @for (ri of recipeItems(); track ri.id; let idx = $index) {
                               <li class="pf-ing">
                                 <span class="pf-ing-avatar" aria-hidden="true">{{ (ri.inventory_item_name || '?').charAt(0).toUpperCase() }}</span>
                                 <span class="pf-ing-name">{{ ri.inventory_item_name }}</span>
                                 <span class="pf-ing-qty">{{ ri.quantity_required }} {{ unitKey(ri.unit) | translate }}</span>
                                 <button type="button" class="pf-ing-del" (click)="removeRecipeRow(idx)" [disabled]="recipeSaving()"
                                   [attr.title]="'PRODUCTS.QUESTION_DELETE' | translate" [attr.aria-label]="'PRODUCTS.QUESTION_DELETE' | translate">
                                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                                 </button>
                               </li>
                             }
                           </ul>
                         } @else {
                           <div class="pf-recipe-empty">
                             <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3.3 7.5L12 12.5l8.7-5M12 22V12.5"/></svg>
                             <span>{{ 'PRODUCTS.RECIPE_NONE' | translate }}</span>
                           </div>
                         }

                         @if (inventoryItems().length === 0) {
                           <p class="field-hint">{{ 'PRODUCTS.RECIPE_NO_INVENTORY_ITEMS' | translate }}</p>
                         } @else {
                           <div class="pf-recipe-add">
                             <h5>{{ 'PRODUCTS.RECIPE_ADD_TITLE' | translate }}</h5>
                             <div class="pf-recipe-fields">
                               <div class="form-group pf-rf-item">
                                 <label for="recipe-item">{{ 'PRODUCTS.RECIPE_ITEM_LABEL' | translate }}</label>
                                 <app-select
                                   id="recipe-item"
                                   name="recipe-item"
                                   [(ngModel)]="recipeDraft.inventory_item_id"
                                   [options]="inventoryOptions()"
                                   [placeholder]="'COMMON.SELECT' | translate"
                                   [searchable]="true"
                                   [emptyValue]="null"
                                   [disabled]="recipeSaving()" />
                               </div>
                               <div class="form-group pf-rf-qty">
                                 <label for="recipe-qty">{{ 'PRODUCTS.RECIPE_QTY_LABEL' | translate }}</label>
                                 <input id="recipe-qty" type="number" name="recipe-qty" min="0.01" step="0.01" [(ngModel)]="recipeDraft.quantity_required" [disabled]="recipeSaving()">
                               </div>
                               <div class="form-group pf-rf-unit">
                                 <label for="recipe-unit">{{ 'PRODUCTS.RECIPE_UNIT_LABEL' | translate }}</label>
                                 <app-select
                                   id="recipe-unit"
                                   name="recipe-unit"
                                   [(ngModel)]="recipeDraft.unit"
                                   [options]="unitOptions()"
                                   [disabled]="recipeSaving()" />
                               </div>
                             </div>
                             <button type="button" class="pf-recipe-btn" (click)="addRecipeRow()" [disabled]="recipeSaving() || recipeDraft.inventory_item_id == null">
                               <span aria-hidden="true">+</span> {{ 'PRODUCTS.RECIPE_ADD' | translate }}
                             </button>
                           </div>
                         }
                       }
                     </section>
                   }

                   <div class="form-actions pf-actions">
                     <button type="button" class="pf-cancel" (click)="cancelForm()">{{ 'PRODUCTS.CANCEL' | translate }}</button>
                     <button type="submit" class="pf-save" [disabled]="saving() || !canEditProducts()">
                       {{ saving() ? ('PRODUCTS.SAVING' | translate) : (editingProduct() ? ('PRODUCTS.UPDATE' | translate) : ('PRODUCTS.ADD_PRODUCT_BUTTON' | translate)) }}
                     </button>
                   </div>
                </form>
              </div>
            } @else {

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
            @if (successMessage()) {
              <div class="success-banner">
                <span>{{ successMessage() }}</span>
                <button class="icon-btn" (click)="successMessage.set('')">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            }

             @if (loading()) {
               <div class="empty-state">
                 <p>{{ 'PRODUCTS.LOADING_PRODUCTS' | translate }}</p>
               </div>
             } @else if (products().length === 0) {
               <div class="empty-state">
                 <div class="empty-icon">
                   <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                     <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
                   </svg>
                 </div>
                 <h3>{{ 'PRODUCTS.NO_PRODUCTS' | translate }}</h3>
                 <p>{{ 'PRODUCTS.NO_PRODUCTS_DESC' | translate }}</p>
                 @if (canEditProducts()) {
                 <button class="btn btn-primary" (click)="openAddForm()">{{ 'PRODUCTS.ADD_PRODUCT' | translate }}</button>
               }
               </div>
            } @else {
              <!-- Search + view -->
              <div class="search-row pr-searchbar">
                <label for="products-search" class="visually-hidden">{{ 'PRODUCTS.SEARCH_PLACEHOLDER' | translate }}</label>
                <input
                  id="products-search"
                  type="search"
                  class="search-input"
                  [value]="searchQuery()"
                  (input)="onSearchChange($event)"
                  [placeholder]="'PRODUCTS.SEARCH_PLACEHOLDER' | translate"
                  autocomplete="off"
                />
                <div class="pr-view" role="group" [attr.aria-label]="'PRODUCTS.VIEW' | translate">
                  <button type="button" class="pr-view-btn" [class.on]="productsView() === 'cards'" (click)="setProductsView('cards')" [title]="'PRODUCTS.VIEW_CARDS' | translate">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
                    <span>{{ 'PRODUCTS.VIEW_CARDS' | translate }}</span>
                  </button>
                  <button type="button" class="pr-view-btn" [class.on]="productsView() === 'table'" (click)="setProductsView('table')" [title]="'PRODUCTS.VIEW_TABLE' | translate">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    <span>{{ 'PRODUCTS.VIEW_TABLE' | translate }}</span>
                  </button>
                </div>
              </div>
              <!-- Category Filters (Ribbon Style) -->
              <div class="filters-section">
                @if (availableCategories().length > 0) {
                  <div class="ribbon-container">
                    <div class="ribbon">
                      <button 
                        class="ribbon-tab" 
                        [class.active]="selectedCategory() === null"
                        (click)="selectCategory(null)">
                        {{ 'CATALOG.ALL_CATEGORIES' | translate }}<b>{{ products().length }}</b>
                      </button>
                      @for (category of availableCategories(); track category) {
                        <button 
                          class="ribbon-tab" 
                          [class.active]="selectedCategory() === category"
                          (click)="selectCategory(category)">
                          {{ getCategoryLabel(category) }}<b>{{ categoryCount(category) }}</b>
                        </button>
                      }
                    </div>
                  </div>
                }
                
                <!-- Subcategory Filters (Ribbon Style - Smaller) -->
                @if (selectedCategory() && availableSubcategoriesForFilter().length > 0) {
                  <div class="ribbon-container subribbon">
                    <div class="ribbon">
                      <button 
                        class="ribbon-tab tab-sm" 
                        [class.active]="selectedSubcategory() === null"
                        (click)="selectSubcategory(null)">
                        {{ 'PRODUCTS.ALL_ITEMS_IN' | translate:{category: getCategoryLabel(selectedCategory()!) } }}
                      </button>
                      @for (subcategory of availableSubcategoriesForFilter(); track subcategory) {
                        <button 
                          class="ribbon-tab tab-sm" 
                          [class.active]="selectedSubcategory() === subcategory"
                          (click)="selectSubcategory(subcategory)">
                          {{ getSubcategoryLabel(subcategory) }}
                        </button>
                      }
                    </div>
                  </div>
                }
              </div>

              @if (productsView() === 'cards') {
                <div class="pr-grid" data-testid="products-cards">
                  @for (product of filteredProducts(); track product.id) {
                    <article class="pr-card pz" [style.--h]="catHue(product.category)" [class.pr-card--low]="product.stock_alert_enabled && isProductLowStock(product)" [class.pr-card--oos]="product.out_of_stock">
                    <div class="pz-top">
                      <span class="pz-cat">{{ product.category ? getCategoryLabel(product.category) : '—' }}@if (product.subcategory) { <i>·</i> {{ getSubcategoryLabel(product.subcategory) }} }</span>
                      @if (product.stock_alert_enabled) {
                      <span class="pz-stock" [class.low]="isProductLowStock(product)"
                        [attr.title]="'PRODUCTS.STOCK_BADGE_TITLE' | translate:{qty: product.stock_qty ?? 0, level: product.stock_alert_level ?? 0}">
                        {{ (isProductLowStock(product) ? 'PRODUCTS.STOCK_LOW' : 'PRODUCTS.STOCK_OK') | translate }} · {{ product.stock_qty ?? 0 }}
                      </span>
                    }
                    </div>
                    <div class="pz-plate">
                      <span class="pz-ring" aria-hidden="true"></span>
                      @if (product.image_filename) {
                        <img [src]="getImageUrl(product)" alt="" loading="lazy" (error)="handleImageError($event)">
                      } @else {
                        <span class="pz-initial" aria-hidden="true">{{ product.name.charAt(0).toUpperCase() }}</span>
                      }
                      @if (product.out_of_stock) {
                        <span class="pz-stamp">{{ 'PRODUCTS.OUT_OF_STOCK_SHORT' | translate }}</span>
                      }
                    </div>
                    <h3 class="pr-name">{{ product.name }}</h3>
                    @if (product.ingredients) {
                      <p class="pr-ingredients">{{ product.ingredients }}</p>
                    }
                    <div class="pz-money">
                      <span class="pz-price">{{ formatPrice(product.price_cents) }}</span>
                      @if (marginPct(product); as mg) {
                        <div class="pz-gauge" [attr.title]="('PRODUCTS.COST_HEADER' | translate) + ' ' + formatPrice(product.cost_cents ?? 0) + ' · ' + mg + '% ' + ('PRODUCTS.MARGIN' | translate)">
                          <span class="pz-gauge-cost" [style.width.%]="100 - mg"></span>
                          <span class="pz-gauge-margin" [class.low]="mg < 30" [style.width.%]="mg"></span>
                        </div>
                        <div class="pz-gauge-lbl">
                          <span>{{ 'PRODUCTS.COST_HEADER' | translate }} {{ formatPrice(product.cost_cents ?? 0) }}</span>
                          <b [class.low]="mg < 30">{{ mg }}% {{ 'PRODUCTS.MARGIN' | translate }}</b>
                        </div>
                      } @else {
                        <span class="pz-nocost">{{ 'PRODUCTS.NO_COST' | translate }}</span>
                      }
                    </div>
                    <div class="pz-acts">
                      @if (canEditProducts()) {
                        <button class="pr-act" [class.pr-act-on]="product.out_of_stock" (click)="toggleOutOfStock(product)"
                          [attr.title]="(product.out_of_stock ? 'PRODUCTS.PUT_BACK_ON_MENU' : 'PRODUCTS.REMOVE_FROM_MENU') | translate"
                          [attr.aria-label]="(product.out_of_stock ? 'PRODUCTS.PUT_BACK_ON_MENU' : 'PRODUCTS.REMOVE_FROM_MENU') | translate">
                          @if (product.out_of_stock) { <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> } @else { <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> }
                        </button>
                      }
                      <button class="pr-act pz-edit" (click)="startEdit(product)" [attr.title]="'PRODUCTS.EDIT_TOOLTIP' | translate" [attr.aria-label]="'PRODUCTS.EDIT_TOOLTIP' | translate">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>{{ 'PRODUCTS.EDIT_TOOLTIP' | translate }}</span>
                      </button>
                      @if (canEditProducts()) {
                        <button class="pr-act pr-act-danger" (click)="confirmDelete(product)" [disabled]="deleting() === product.id" [attr.title]="'PRODUCTS.DELETE_TOOLTIP' | translate" [attr.aria-label]="'PRODUCTS.DELETE_TOOLTIP' | translate">
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                        </button>
                      }
                    </div>
                    </article>
                  } @empty {
                    <p class="pr-empty">{{ 'PRODUCTS.NO_PRODUCTS' | translate }}</p>
                  }
                </div>
              } @else {
              <div class="pc-menu" data-testid="products-table">
                @for (g of productGroups(); track g.key; let gi = $index) {
                  <section class="pc-group" [style.--h]="catHue(g.key)">
                    <header class="pc-head">
                      <span class="pc-num">{{ gi + 1 < 10 ? '0' : '' }}{{ gi + 1 }}</span>
                      <h3>{{ g.key ? getCategoryLabel(g.key) : ('PRODUCTS.NO_CATEGORY' | translate) }}</h3>
                      <span class="pc-line" aria-hidden="true"></span>
                      <span class="pc-count">{{ g.items.length }}</span>
                    </header>
                    <ul class="pc-list">
                      @for (product of g.items; track product.id) {
                        <li class="pc-row" [class.oos]="product.out_of_stock" [class.low]="product.stock_alert_enabled && isProductLowStock(product)">
                          <span class="pc-thumb">
                            @if (product.image_filename) {
                              <img [src]="getImageUrl(product)" alt="" loading="lazy" (error)="handleImageError($event)">
                            } @else {
                              <b aria-hidden="true">{{ product.name.charAt(0).toUpperCase() }}</b>
                            }
                          </span>
                          <div class="pc-main">
                            <div class="pc-line1">
                              <span class="pc-name">{{ product.name }}</span>
                              @if (product.out_of_stock) { <em class="pc-oos">{{ 'PRODUCTS.OUT_OF_STOCK_SHORT' | translate }}</em> }
                              <span class="pc-dots" aria-hidden="true"></span>
                              <span class="pc-price">{{ formatPrice(product.price_cents) }}</span>
                            </div>
                            <div class="pc-line2">
                              @if (product.ingredients) { <span class="pc-ing">{{ product.ingredients }}</span> }
                              @if (editingCategoryProductId() === product.id && canEditProducts()) {
                                <select class="inline-select" [(ngModel)]="editingCategory" (change)="onCategoryChangeInline()" (blur)="saveCategoryInline(product)" (keydown.escape)="cancelCategoryEdit()" [attr.data-product-id]="product.id">
                                  <option value="">None</option>
                                  @for (category of getCategoryKeys(); track category) {
                                    <option [value]="category">{{ getCategoryLabel(category) }}</option>
                                  }
                                </select>
                                <select class="inline-select" [(ngModel)]="editingSubcategory" [disabled]="!editingCategory || getSubcategoriesForCategory(editingCategory || '').length === 0" (blur)="saveCategoryInline(product)" (keydown.escape)="cancelCategoryEdit()">
                                  <option value="">None</option>
                                  @for (subcat of getSubcategoriesForCategory(editingCategory); track subcat) {
                                    <option [value]="subcat">{{ getSubcategoryLabel(subcat) }}</option>
                                  }
                                </select>
                              } @else {
                                <button type="button" class="pc-chip" [class.clickable]="canEditProducts()" (click)="canEditProducts() && startCategoryEdit(product, $event)">
                                  {{ product.subcategory ? getSubcategoryLabel(product.subcategory) : (product.category ? getCategoryLabel(product.category) : '—') }}
                                </button>
                              }
                              @if (marginPct(product); as mg) {
                                <span class="pc-chip pc-margin" [class.low]="mg < 30" [attr.title]="('PRODUCTS.COST_HEADER' | translate) + ' ' + formatPrice(product.cost_cents ?? 0)">{{ mg }}% {{ 'PRODUCTS.MARGIN' | translate }}</span>
                              }
                              @if (product.stock_alert_enabled) {
                                <span class="pc-chip pc-stock" data-testid="product-stock-cell" [class.low]="isProductLowStock(product)"
                                  [attr.title]="'PRODUCTS.STOCK_BADGE_TITLE' | translate:{qty: product.stock_qty ?? 0, level: product.stock_alert_level ?? 0}">
                                  {{ (isProductLowStock(product) ? 'PRODUCTS.STOCK_LOW' : 'PRODUCTS.STOCK_OK') | translate }} {{ product.stock_qty ?? 0 }}/{{ product.stock_alert_level ?? 0 }}
                                </span>
                              }
                            </div>
                          </div>
                          <div class="pc-acts">
                            @if (canEditProducts()) {
                              <button class="pr-act" [class.pr-act-on]="product.out_of_stock" (click)="toggleOutOfStock(product)"
                                [attr.title]="(product.out_of_stock ? 'PRODUCTS.PUT_BACK_ON_MENU' : 'PRODUCTS.REMOVE_FROM_MENU') | translate"
                                [attr.aria-label]="(product.out_of_stock ? 'PRODUCTS.PUT_BACK_ON_MENU' : 'PRODUCTS.REMOVE_FROM_MENU') | translate">
                                @if (product.out_of_stock) { <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> } @else { <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> }
                              </button>
                            }
                            <button class="pr-act" (click)="startEdit(product)" [attr.title]="'PRODUCTS.EDIT_TOOLTIP' | translate" [attr.aria-label]="'PRODUCTS.EDIT_TOOLTIP' | translate"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                            @if (canEditProducts()) {
                              <button class="pr-act pr-act-danger" (click)="confirmDelete(product)" [attr.title]="'PRODUCTS.DELETE_TOOLTIP' | translate" [disabled]="deleting() === product.id"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
                            }
                          </div>
                        </li>
                      }
                    </ul>
                  </section>
                }
              </div>
              }
            }
            }
          }

           @if (productToDelete()) {
             <div class="modal-overlay" (click)="productToDelete.set(null)">
               <div class="modal" (click)="$event.stopPropagation()">
                 <h3>{{ 'PRODUCTS.DELETE_PRODUCT_TITLE' | translate }}</h3>
                 <p>{{ 'PRODUCTS.DELETE_PRODUCT_CONFIRM' | translate:{name: productToDelete()?.name} }}</p>
                 <div class="modal-actions">
                   <button class="btn btn-secondary" (click)="productToDelete.set(null)">{{ 'PRODUCTS.CANCEL' | translate }}</button>
                   <button class="btn btn-danger" (click)="deleteProduct()">{{ 'PRODUCTS.DELETE_PRODUCT' | translate }}</button>
                 </div>
               </div>
             </div>
           }
           @if (showDeleteAllModal()) {
             <div class="modal-overlay" (click)="showDeleteAllModal.set(false)">
               <div class="modal" (click)="$event.stopPropagation()">
                 <h3>{{ 'PRODUCTS.DELETE_ALL_TITLE' | translate }}</h3>
                 <p>{{ 'PRODUCTS.DELETE_ALL_CONFIRM' | translate:{count: products().length} }}</p>
                 <div class="modal-actions">
                   <button class="btn btn-secondary" (click)="showDeleteAllModal.set(false)" [disabled]="deletingAll()">{{ 'PRODUCTS.CANCEL' | translate }}</button>
                   <button class="btn btn-danger" (click)="deleteAllProducts()" [disabled]="deletingAll()">{{ 'PRODUCTS.DELETE_ALL_BUTTON' | translate }}</button>
                 </div>
               </div>
             </div>
           }
           @if (bulkImportOpen()) {
             <app-product-bulk-import
               [categories]="categories()"
               (closed)="closeBulkImport()"
               (imported)="onBulkImportDone($event)"
             />
           }
        </div>
    </app-sidebar>
  `,
  styleUrl: './products.component.scss'
})
export class ProductsComponent implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);
  private permissions = inject(PermissionService);
  private translate = inject(TranslateService);
  private inventoryService = inject(InventoryService);

  canEditProducts = computed(() => this.permissions.hasPermission(this.permissions.getCurrentUser(), 'product:write'));

  activeTab = signal<'products' | 'categories'>('products');
  /** Card grid (default) or the classic table; remembered per browser. */
  productsView = signal<'cards' | 'table'>(
    (() => {
      try { return localStorage.getItem('pos.products.view') === 'table' ? 'table' : 'cards'; } catch { return 'cards'; }
    })()
  );
  /** Quick "Fuera de stock" switch from the list/cards (hides it from the customer menu). */
  toggleOutOfStock(product: Product): void {
    if (!this.canEditProducts() || !product.id) return;
    this.api.updateProduct(product.id, { out_of_stock: !product.out_of_stock }).subscribe({
      next: (updated) => {
        this.products.update(list => list.map(p => (p.id === updated.id ? updated : p)));
        this.applyFilters();
      },
      error: (err) => this.error.set(err.error?.detail || 'Failed to update'),
    });
  }

  categoryOptions(): AppSelectOption[] {
    return this.getCategoryKeys().map((k) => ({ value: k, label: this.getCategoryLabel(k) }));
  }

  subcategoryOptions(): AppSelectOption[] {
    return this.availableSubcategories().map((k) => ({ value: k, label: this.getSubcategoryLabel(k) }));
  }

  inventoryOptions(): AppSelectOption[] {
    return this.inventoryItems().map((inv) => ({ value: inv.id, label: inv.name, sub: inv.sku }));
  }

  unitOptions(): AppSelectOption[] {
    return this.recipeUnits.map((u) => ({ value: u, label: this.translate.instant(this.unitKey(u)) }));
  }

  setProductsView(view: 'cards' | 'table'): void {
    this.productsView.set(view);
    try { localStorage.setItem('pos.products.view', view); } catch { /* storage unavailable */ }
  }
  /** Products taken off the menu (out of stock). */
  oosCount = computed(() => this.products().filter((p) => p.out_of_stock).length);

  /** Gross margin % of a product, or null when there is no cost. */
  marginPct(p: Product): number | null {
    const price = p.price_cents || 0;
    const cost = p.cost_cents;
    if (cost == null || cost <= 0 || price <= 0) return null;
    return Math.round(((price - cost) / price) * 100);
  }

  /** Average margin over the products that have a cost. */
  avgMargin = computed(() => {
    const m = this.products().map((p) => this.marginPct(p)).filter((x): x is number => x !== null);
    return m.length ? Math.round(m.reduce((a, b) => a + b, 0) / m.length) : null;
  });

  /** Warm hue (12-49) of a category: tints cards and list groups so categories read at a glance. */
  catHue(category: string | null | undefined): number {
    let h = 0;
    for (const ch of category || '') h = (h * 31 + ch.charCodeAt(0)) % 360;
    // Warm range only (orange to amber), never purple or blue.
    return 12 + (h % 38);
  }

  /** Visible products grouped by category, for the "carta" list view. */
  productGroups = computed(() => {
    const map = new Map<string, Product[]>();
    for (const p of this.filteredProducts()) {
      const k = p.category || '';
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return [...map.entries()].map(([key, items]) => ({ key, items }));
  });

  /** Price typed in the form, as a formatted amount. */
  formPriceLabel(): string {
    return formatMoneyCents(Math.round((Number(this.formData.price) || 0) * 100));
  }

  /** Live margin % from the price and cost typed in the form (null until both are valid). */
  formMargin(): number | null {
    const price = Number(this.formData.price) || 0;
    const cost = Number(this.formData.cost);
    if (price <= 0 || !(cost > 0) || cost >= price * 10) return null;
    return Math.max(0, Math.round(((price - cost) / price) * 100));
  }

  /** "Ganas $X" per plate. */
  formProfitLabel(): string {
    const price = Number(this.formData.price) || 0;
    const cost = Number(this.formData.cost) || 0;
    return formatMoneyCents(Math.round((price - cost) * 100));
  }

  categoryCount(category: string): number {
    return this.products().filter((p) => p.category === category).length;
  }

  lowStockCount = computed(() => this.products().filter(p => p.stock_alert_enabled && this.isProductLowStock(p)).length);
  products = signal<Product[]>([]);
  filteredProducts = signal<Product[]>([]);
  loading = signal(true);
  saving = signal(false);
  deleting = signal<number | null>(null);
  deletingAll = signal(false);
  showAddForm = signal(false);
  editingProduct = signal<Product | null>(null);
  productToDelete = signal<Product | null>(null);
  showDeleteAllModal = signal(false);
  bulkImportOpen = signal(false);
  error = signal('');
  successMessage = signal('');
  /** Set when submit was attempted with invalid required fields; cleared on edit or cancel */
  productFormErrors = signal<{ name?: boolean; price?: boolean } | null>(null);
  formData: {
    name: string;
    price: number;
    cost: number | null;
    ingredients: string;
    description: string;
    category: string;
    subcategory: string;
    tax_id?: number | null;
    available_from?: string;
    available_until?: string;
    kitchen_station_id?: number | null;
    stock_alert_enabled: boolean;
    stock_qty: number;
    stock_alert_level: number;
    out_of_stock: boolean;
  } = {
    name: '',
    price: 0,
    cost: null,
    ingredients: '',
    description: '',
    category: '',
    subcategory: '',
    kitchen_station_id: null,
    stock_alert_enabled: false,
    stock_qty: 0,
    stock_alert_level: 5,
    out_of_stock: false,
  };
  productTaxes = signal<Tax[]>([]);
  kitchenStations = signal<KitchenStation[]>([]);
  readonly maxImageUploadMb = MAX_IMAGE_UPLOAD_MB;
  uploading = signal(false);
  pendingImageFile = signal<File | null>(null);
  pendingImagePreview = signal<string | null>(null);
  /** This deployment only operates in Colombian pesos (COP). */
  currency(): string { return '$'; }
  currencyCode(): string { return 'COP'; }
  categories = signal<Record<string, string[]>>({});
  availableSubcategories = signal<string[]>([]);
  editingCategoryProductId = signal<number | null>(null);
  editingCategory: string = '';
  editingSubcategory: string = '';
  // Filter state
  searchQuery = signal('');
  selectedCategory = signal<string | null>(null);
  selectedSubcategory = signal<string | null>(null);
  availableCategories = signal<string[]>([]);
  availableSubcategoriesForFilter = signal<string[]>([]);

  /** Recipe (BOM): which inventory items get deducted when this product is sold, and how much. */
  readonly unitKey = inventoryUnitKey;
  readonly recipeUnits: UnitOfMeasure[] = ['piece', 'gram', 'kilogram', 'ounce', 'pound', 'milliliter', 'centiliter', 'liter', 'fluid_ounce', 'cup', 'gallon'];
  recipeItems = signal<ProductRecipeItem[]>([]);
  recipeLoading = signal(false);
  recipeSaving = signal(false);
  inventoryItems = signal<InventoryItem[]>([]);
  recipeDraft: { inventory_item_id: number | null; quantity_required: number; unit: UnitOfMeasure } = {
    inventory_item_id: null,
    quantity_required: 1,
    unit: 'piece',
  };

  ngOnInit() {
    this.loadTenantSettingsThenProducts();
    this.loadCategories();
    // Load all taxes (not only "valid today") so dropdowns aren't empty due to validity-period edge cases.
    this.api.getTaxes(false).subscribe({ next: (list) => this.productTaxes.set(list), error: () => this.productTaxes.set([]) });
    this.api.getKitchenStations().subscribe({
      next: (list) => this.kitchenStations.set(list),
      error: () => this.kitchenStations.set([]),
    });
  }

  categoryLabelOverrides = signal<Record<string, string>>({});

  loadCategories() {
    this.api.getCatalogCategories().subscribe({
      next: (cats) => {
        this.categories.set(cats);
        this.onCategoryChange();
        if (this.selectedCategory()) {
          this.updateAvailableSubcategories(this.selectedCategory());
        }
      },
      error: (err) => {
        console.error('Failed to load categories:', err);
      }
    });
    this.api.getTenantCategoryLabels().subscribe({
      next: (labels) => this.categoryLabelOverrides.set(labels),
      error: () => this.categoryLabelOverrides.set({}),
    });
  }

  onCategoriesChanged() {
    this.loadCategories();
  }

  getCategoryKeys(): string[] {
    return Object.keys(this.categories());
  }

  /** Tenant rename override > built-in Spanish translation > raw value for custom categories. */
  getCategoryLabel(category: string): string {
    return resolveCategoryLabel(category, this.translate, this.categoryLabelOverrides());
  }

  getSubcategoryLabel(subcategory: string): string {
    return resolveSubcategoryLabel(subcategory, this.translate);
  }

  getSubcategoriesForCategory(category: string): string[] {
    return this.categories()[category] || [];
  }

  onCategoryChange() {
    // Update available subcategories when category changes
    const selectedCategory = this.formData.category;
    if (selectedCategory && this.categories()[selectedCategory]) {
      this.availableSubcategories.set(this.categories()[selectedCategory]);
    } else {
      this.availableSubcategories.set([]);
      this.formData.subcategory = '';
    }
  }

  onCategoryChangeInline() {
    // Update subcategory when category changes inline
    const selectedCategory = this.editingCategory;
    if (selectedCategory && this.categories()[selectedCategory]) {
      // Keep subcategory if it's still valid, otherwise clear it
      const validSubcats = this.categories()[selectedCategory];
      if (this.editingSubcategory && !validSubcats.includes(this.editingSubcategory)) {
        this.editingSubcategory = '';
      }
    } else {
      this.editingSubcategory = '';
    }
  }

  startCategoryEdit(product: Product, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    if (!product.id) return;
    // Don't start editing if already editing this product or another product
    if (this.editingCategoryProductId() === product.id) return;
    if (this.editingCategoryProductId() !== null) {
      // Save current edit first
      const currentProduct = this.products().find(p => p.id === this.editingCategoryProductId());
      if (currentProduct) {
        this.saveCategoryInline(currentProduct);
      }
    }
    this.editingCategoryProductId.set(product.id);
    this.editingCategory = product.category || '';
    this.editingSubcategory = product.subcategory || '';
    // Focus the category select after a brief delay
    setTimeout(() => {
      const select = document.querySelector(`[data-product-id="${product.id}"]`) as HTMLSelectElement;
      if (select) select.focus();
    }, 10);
  }

  cancelCategoryEdit() {
    this.editingCategoryProductId.set(null);
    this.editingCategory = '';
    this.editingSubcategory = '';
  }

  saveCategoryInline(product: Product) {
    if (!product.id || this.editingCategoryProductId() !== product.id) return;

    const category = this.editingCategory || undefined;
    const subcategory = this.editingSubcategory || undefined;

    // Only update if changed
    if (category === product.category && subcategory === product.subcategory) {
      this.cancelCategoryEdit();
      return;
    }

    this.saving.set(true);
    this.api.updateProduct(product.id, { category, subcategory }).subscribe({
      next: (updated) => {
        this.products.update(list => list.map(p => p.id === updated.id ? updated : p));
        this.updateAvailableCategories();
        this.updateAvailableSubcategories(this.selectedCategory());
        this.applyFilters();
        this.cancelCategoryEdit();
        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.detail || 'Failed to update category');
        this.cancelCategoryEdit();
        this.saving.set(false);
      }
    });
  }

  loadTenantSettingsThenProducts() {
    this.api.getTenantSettings().subscribe({
      next: () => {
        this.loadProducts();
      },
      error: (err) => {
        console.error('Failed to load tenant settings:', err);
        this.loadProducts();
      },
    });
  }

  isProductLowStock(product: Product): boolean {
    if (!product.stock_alert_enabled) return false;
    return (product.stock_qty ?? 0) <= (product.stock_alert_level ?? 0);
  }

  formatPrice(priceCents: number): string {
    return formatMoneyCents(priceCents);
  }

  loadProducts() {
    this.loading.set(true);
    this.api.getProducts().subscribe({
      next: (products) => {
        this.products.set(products);
        this.updateAvailableCategories();
        this.applyFilters();
        this.loading.set(false);
      },
      error: (err) => {
        if (err.status === 401) { this.router.navigate(['/login']); }
        else { this.error.set(err.error?.detail || 'Failed to load products'); }
        this.loading.set(false);
      }
    });
  }

  updateAvailableCategories() {
    const categories = new Set<string>();
    this.products().forEach((product: Product) => {
      if (product.category) {
        categories.add(product.category);
      }
    });
    this.availableCategories.set(Array.from(categories).sort());
  }

  selectCategory(category: string | null) {
    this.selectedCategory.set(category);
    this.selectedSubcategory.set(null);
    this.updateAvailableSubcategories(category);
    this.applyFilters();
  }

  selectSubcategory(subcategory: string | null) {
    this.selectedSubcategory.set(subcategory);
    this.applyFilters();
  }

  updateAvailableSubcategories(category: string | null) {
    if (!category) {
      this.availableSubcategoriesForFilter.set([]);
      return;
    }

    const subcategories = new Set<string>();
    this.products().forEach((product: Product) => {
      if (product.category === category && product.subcategory) {
        subcategories.add(product.subcategory);
      }
    });
    this.availableSubcategoriesForFilter.set(Array.from(subcategories).sort());
  }

  onSearchChange(event: Event) {
    this.searchQuery.set((event.target as HTMLInputElement).value);
    this.applyFilters();
  }

  applyFilters() {
    let filtered = this.products();

    // Filter by search (name, ingredients, description, category, subcategory)
    const q = this.searchQuery().trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(p => {
        const name = (p.name || '').toLowerCase();
        const ingredients = (p.ingredients || '').toLowerCase();
        const description = (p.description || '').toLowerCase();
        const category = (p.category || '').toLowerCase();
        const subcategory = (p.subcategory || '').toLowerCase();
        return name.includes(q) || ingredients.includes(q) || description.includes(q) || category.includes(q) || subcategory.includes(q);
      });
    }

    // Filter by category
    if (this.selectedCategory()) {
      filtered = filtered.filter(p => p.category === this.selectedCategory());
    }

    // Filter by subcategory
    if (this.selectedSubcategory()) {
      filtered = filtered.filter(p => p.subcategory === this.selectedSubcategory());
    }

    this.filteredProducts.set(filtered);
  }

  startEdit(product: Product) {
    // Cancel any inline category editing
    if (this.editingCategoryProductId() === product.id) {
      this.cancelCategoryEdit();
    }
    this.productFormErrors.set(null);
    this.editingProduct.set(product);
    this.formData = {
      name: product.name,
      price: product.price_cents / 100,
      cost: product.cost_cents != null ? product.cost_cents / 100 : null,
      ingredients: product.ingredients || '',
      description: product.description || '',
      category: product.category || '',
      subcategory: product.subcategory || '',
      tax_id: product.tax_id ?? null,
      available_from: product.available_from || '',
      available_until: product.available_until || '',
      kitchen_station_id: product.kitchen_station_id ?? null,
      stock_alert_enabled: !!product.stock_alert_enabled,
      stock_qty: product.stock_qty ?? 0,
      stock_alert_level: product.stock_alert_level ?? 0,
      out_of_stock: !!product.out_of_stock,
    };
    this.onCategoryChange(); // Update available subcategories
    this.showAddForm.set(false);
    if (product.id) {
      this.loadProductRecipe(product.id);
      this.loadInventoryItemsForRecipe();
    } else {
      this.clearRecipeState();
    }
  }

  openAddForm() {
    this.productFormErrors.set(null);
    this.formData = {
      name: '',
      price: 0,
      cost: null,
      ingredients: '',
      description: '',
      category: '',
      subcategory: '',
      tax_id: null,
      available_from: '',
      available_until: '',
      kitchen_station_id: null,
      stock_alert_enabled: false,
      stock_qty: 0,
      stock_alert_level: 5,
      out_of_stock: false,
    };
    this.showAddForm.set(true);
    this.clearRecipeState();
  }

  cancelForm() {
    this.showAddForm.set(false);
    this.editingProduct.set(null);
    this.formData = {
      name: '',
      price: 0,
      cost: null,
      ingredients: '',
      description: '',
      category: '',
      subcategory: '',
      tax_id: null,
      available_from: '',
      available_until: '',
      kitchen_station_id: null,
      stock_alert_enabled: false,
      stock_qty: 0,
      stock_alert_level: 5,
      out_of_stock: false,
    };
    this.availableSubcategories.set([]);
    this.productFormErrors.set(null);
    this.clearPendingImage();
    this.clearRecipeState();
  }

  openBulkImport() {
    this.bulkImportOpen.set(true);
  }

  closeBulkImport() {
    this.bulkImportOpen.set(false);
  }

  onBulkImportDone(result: ProductBulkImportConfirmResult) {
    this.bulkImportOpen.set(false);
    this.loadProducts();
    this.successMessage.set(
      this.translate.instant('PRODUCTS.BULK_IMPORT_SUCCESS', {
        created: result.created,
        updated: result.updated,
      })
    );
  }

  private clearRecipeState() {
    this.recipeItems.set([]);
    this.recipeLoading.set(false);
    this.recipeSaving.set(false);
    this.recipeDraft = { inventory_item_id: null, quantity_required: 1, unit: 'piece' };
  }

  loadProductRecipe(productId: number) {
    this.recipeLoading.set(true);
    this.inventoryService.getProductRecipe(productId).subscribe({
      next: (recipe) => {
        this.recipeItems.set(recipe.items || []);
        this.recipeLoading.set(false);
      },
      error: () => {
        this.recipeItems.set([]);
        this.recipeLoading.set(false);
      },
    });
  }

  loadInventoryItemsForRecipe() {
    this.inventoryService.getItems({ activeOnly: true }).subscribe({
      next: (items) => this.inventoryItems.set(items),
      error: () => this.inventoryItems.set([]),
    });
  }

  /** Adds the draft ingredient to the recipe and persists the whole list immediately. */
  addRecipeRow() {
    const productId = this.editingProduct()?.id;
    if (!productId || this.recipeDraft.inventory_item_id == null) return;
    const qty = Number(this.recipeDraft.quantity_required);
    if (!(qty > 0)) return;

    const items = [
      ...this.recipeItems().map((ri) => ({
        inventory_item_id: ri.inventory_item_id,
        quantity_required: ri.quantity_required,
        unit: ri.unit,
        waste_percentage: ri.waste_percentage,
        notes: ri.notes,
      })),
      { inventory_item_id: this.recipeDraft.inventory_item_id, quantity_required: qty, unit: this.recipeDraft.unit },
    ];
    this.saveRecipe(productId, items);
  }

  removeRecipeRow(index: number) {
    const productId = this.editingProduct()?.id;
    if (!productId) return;
    const items = this.recipeItems()
      .filter((_, idx) => idx !== index)
      .map((ri) => ({
        inventory_item_id: ri.inventory_item_id,
        quantity_required: ri.quantity_required,
        unit: ri.unit,
        waste_percentage: ri.waste_percentage,
        notes: ri.notes,
      }));
    this.saveRecipe(productId, items);
  }

  private saveRecipe(
    productId: number,
    items: { inventory_item_id: number; quantity_required: number; unit: UnitOfMeasure; waste_percentage?: number; notes?: string | null }[]
  ) {
    this.recipeSaving.set(true);
    this.inventoryService.updateProductRecipe(productId, { items }).subscribe({
      next: () => {
        this.recipeDraft = { inventory_item_id: null, quantity_required: 1, unit: 'piece' };
        this.loadProductRecipe(productId);
        this.recipeSaving.set(false);
      },
      error: () => {
        this.recipeSaving.set(false);
      },
    });
  }

  clearProductFormError(field: 'name' | 'price') {
    const current = this.productFormErrors();
    if (!current) return;
    const next = { ...current };
    delete next[field];
    const nextState = Object.keys(next).length ? next : null;
    this.productFormErrors.set(nextState);
    if (!nextState) this.error.set('');
  }

  clearPendingImage() {
    this.pendingImageFile.set(null);
    if (this.pendingImagePreview()) {
      URL.revokeObjectURL(this.pendingImagePreview()!);
      this.pendingImagePreview.set(null);
    }
  }

  saveProduct(event: Event) {
    event.preventDefault();
    if (!this.canEditProducts()) return;

    const nameInvalid = !this.formData.name?.trim();
    const priceInvalid = this.formData.price == null || Number(this.formData.price) <= 0;
    if (nameInvalid || priceInvalid) {
      this.productFormErrors.set({ name: nameInvalid, price: priceInvalid });
      this.error.set(this.translate.instant('PRODUCTS.FILL_REQUIRED_FIELDS'));
      return;
    }

    this.productFormErrors.set(null);
    this.error.set('');
    this.saving.set(true);
    const productData: Record<string, unknown> = {
      name: this.formData.name,
      price_cents: Math.round(this.formData.price * 100),
      cost_cents: this.formData.cost != null && this.formData.cost >= 0 ? Math.round(this.formData.cost * 100) : undefined,
      ingredients: this.formData.ingredients || undefined,
      // Always sent (blank clears it on edit): `undefined` would be dropped and the old text would stay.
      description: (this.formData.description || '').trim(),
      category: this.formData.category || undefined,
      subcategory: this.formData.subcategory || undefined,
      tax_id: this.formData.tax_id,
      // The date window is not edited anymore: null clears leftovers from older products.
      available_from: null,
      available_until: null,
      out_of_stock: !!this.formData.out_of_stock,
      kitchen_station_id: this.formData.kitchen_station_id ?? null,
      stock_alert_enabled: !!this.formData.stock_alert_enabled,
      stock_qty: Math.max(0, Math.floor(Number(this.formData.stock_qty) || 0)),
      stock_alert_level: Math.max(0, Math.floor(Number(this.formData.stock_alert_level) || 0)),
    };

    const editing = this.editingProduct();
    if (editing?.id) {
      this.api.updateProduct(editing.id, productData as Partial<Product>).subscribe({
        next: (updated) => {
          this.products.update(list => list.map(p => p.id === updated.id ? updated : p));
          this.updateAvailableCategories();
          this.applyFilters();
          this.cancelForm();
          this.saving.set(false);
        },
        error: (err) => { this.error.set(err.error?.detail || 'Failed to update'); this.saving.set(false); }
      });
    } else {
      this.api.createProduct(productData as unknown as Product).subscribe({
        next: (product) => {
          this.products.update(list => [...list, product]);
          this.updateAvailableCategories();
          this.applyFilters();
          // Upload pending image if one was selected
          const pendingFile = this.pendingImageFile();
          if (pendingFile && product.id) {
            this.uploading.set(true);
            this.api.uploadProductImage(product.id, pendingFile).subscribe({
              next: (updated) => {
                this.products.update(list => list.map(p => p.id === updated.id ? updated : p));
                this.clearPendingImage();
                this.uploading.set(false);
              },
              error: (err) => {
                this.error.set(
                  err.error?.detail || this.translate.instant('PRODUCTS.PRODUCT_CREATED_BUT_IMAGE_FAILED'),
                );
                this.clearPendingImage();
                this.uploading.set(false);
              }
            });
          } else {
            this.clearPendingImage();
          }
          this.cancelForm();
          this.saving.set(false);
        },
        error: (err) => { this.error.set(err.error?.detail || 'Failed to create'); this.saving.set(false); }
      });
    }
  }

  confirmDelete(product: Product) { this.productToDelete.set(product); }

  confirmDeleteAll() {
    this.showDeleteAllModal.set(true);
  }

  deleteAllProducts() {
    if (this.deletingAll()) return;
    this.deletingAll.set(true);
    this.api.deleteAllProducts().subscribe({
      next: (res) => {
        this.showDeleteAllModal.set(false);
        this.products.set([]);
        this.filteredProducts.set([]);
        this.updateAvailableCategories();
        this.applyFilters();
        this.deletingAll.set(false);
        this.error.set('');
        this.successMessage.set(
          this.translate.instant('PRODUCTS.DELETE_ALL_SUCCESS', { count: res.count })
        );
      },
      error: (err) => {
        this.error.set(err.error?.detail || this.translate.instant('PRODUCTS.FAILED_TO_DELETE_ALL'));
        this.deletingAll.set(false);
      },
    });
  }

  deleteProduct() {
    const product = this.productToDelete();
    if (!product?.id) return;
    this.deleting.set(product.id);
    this.productToDelete.set(null);
    this.api.deleteProduct(product.id).subscribe({
      next: () => {
        this.products.update(list => list.filter(p => p.id !== product.id));
        this.updateAvailableCategories();
        this.applyFilters();
        this.deleting.set(null);
      },
      error: (err) => { this.error.set(err.error?.detail || 'Failed to delete'); this.deleting.set(null); }
    });
  }

  getImageUrl(product: Product): string | null {
    return this.api.getProductImageUrl(product);
  }

  handleImageError(event: Event) {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    const wrapper = img.closest('.image-preview-wrapper');
    if (wrapper) {
      let placeholder = wrapper.querySelector('.no-image') as HTMLElement;
      if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.className = 'no-image';
        placeholder.title = 'No image';
        placeholder.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
        wrapper.insertBefore(placeholder, img);
      } else {
        placeholder.style.display = 'flex';
      }
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    } else {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
  }

  handleImageSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      this.error.set(
        this.translate.instant('COMMON.IMAGE_FILE_TOO_LARGE', { maxMb: MAX_IMAGE_UPLOAD_MB }),
      );
      input.value = '';
      return;
    }

    const editing = this.editingProduct();
    if (editing?.id) {
      // Direct upload for existing products
      this.uploading.set(true);
      this.error.set('');
      this.api.uploadProductImage(editing.id, file).subscribe({
        next: (updated) => {
          this.products.update(list => list.map(p => p.id === updated.id ? updated : p));
          this.editingProduct.set(updated);
          this.uploading.set(false);
        },
        error: (err) => {
          this.error.set(
            err.error?.detail || this.translate.instant('PRODUCTS.FAILED_TO_UPLOAD_IMAGE'),
          );
          this.uploading.set(false);
        }
      });
    } else {
      // Store file for upload after product creation
      this.error.set('');
      this.clearPendingImage();
      this.pendingImageFile.set(file);
      this.pendingImagePreview.set(URL.createObjectURL(file));
    }
    // Reset input to allow selecting the same file again
    input.value = '';
  }
}