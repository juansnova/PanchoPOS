import { Component, inject, signal, computed, OnInit, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiService, Product } from '../services/api.service';
import { forkJoin } from 'rxjs';
import { getCategoryLabel as resolveCategoryLabel } from '../shared/product-category-label.util';

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    <div class="categories-container">
      <!-- Split View Layout -->
      <div class="split-view">
        <!-- Sidebar: Categories List -->
        <div class="category-sidebar">
          <div class="sidebar-header">
            <h3>{{ 'CATALOG.CATEGORY_LABEL' | translate }}</h3>
            <button class="icon-btn" (click)="showAddCategoryForm.set(!showAddCategoryForm())" [title]="'PRODUCTS.ADD_CATEGORY' | translate">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          </div>
          @if (showAddCategoryForm()) {
            <div class="form-card add-category-form">
              <div class="form-group">
                <label>{{ 'PRODUCTS.NEW_CATEGORY_NAME' | translate }}</label>
                <input type="text" [(ngModel)]="newCategoryName" [placeholder]="'PRODUCTS.ENTER_CATEGORY_NAME' | translate">
              </div>
              <div class="form-group">
                <label>{{ 'PRODUCTS.NEW_CATEGORY_FIRST_SUBCATEGORY' | translate }}</label>
                <input type="text" [(ngModel)]="newCategoryFirstSubcategory" [placeholder]="'PRODUCTS.ENTER_SUBCATEGORY_NAME' | translate" (keyup.enter)="addCategory()">
              </div>
              <div class="input-row">
                <button class="btn btn-secondary btn-sm" (click)="cancelAddCategory()">{{ 'COMMON.CANCEL' | translate }}</button>
                <button class="btn btn-primary btn-sm" (click)="addCategory()" [disabled]="!newCategoryName.trim() || !newCategoryFirstSubcategory.trim()">{{ 'COMMON.OK' | translate }}</button>
              </div>
            </div>
          }
          <div class="sidebar-list">
            @for (category of mainCategories(); track category) {
              <button
                class="category-item"
                [class.active]="selectedCategory() === category"
                (click)="selectCategory(category)">
                <span>{{ getCategoryLabel(category) }}</span>
                <span class="count">{{ getSubcategoryCount(category) }}</span>
              </button>
            }
          </div>
        </div>

        <!-- Main: Subcategories Management -->
        <div class="subcategory-main">
          @if (selectedCategory()) {
            <div class="main-header">
              @if (renamingCategory()) {
                <div class="input-row rename-category-row">
                  <input type="text" [(ngModel)]="renameCategoryName" (keyup.enter)="saveRenameCategory()" (keyup.escape)="cancelRenameCategory()" autofocus>
                  <button class="btn btn-secondary btn-sm" (click)="cancelRenameCategory()">{{ 'COMMON.CANCEL' | translate }}</button>
                  <button class="btn btn-primary btn-sm" (click)="saveRenameCategory()" [disabled]="!renameCategoryName.trim()">{{ 'COMMON.OK' | translate }}</button>
                </div>
              } @else {
                <h2>{{ 'PRODUCTS.MANAGE_SUBCATEGORIES_FOR' | translate:{category: getCategoryLabel(selectedCategory()!) } }}</h2>
              }
              @if (!renamingCategory()) {
              <div class="main-header-actions">
                <button class="icon-btn" (click)="startRenameCategory()" [title]="'PRODUCTS.RENAME_CATEGORY' | translate">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button class="icon-btn danger" (click)="confirmDeleteCategory()" [title]="'PRODUCTS.DELETE_CATEGORY' | translate">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                  </svg>
                </button>
                <button class="btn btn-primary btn-sm" (click)="showAddForm.set(true)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  {{ 'PRODUCTS.ADD_SUBCATEGORY' | translate }}
                </button>
              </div>
              }
            </div>

            @if (showAddForm()) {
              <div class="form-card add-form">
                <div class="form-group">
                  <label>{{ 'PRODUCTS.SUBCATEGORY_NAME' | translate }}</label>
                  <div class="input-row">
                    <input 
                      type="text" 
                      [(ngModel)]="newSubcategoryName" 
                      [placeholder]="'PRODUCTS.ENTER_SUBCATEGORY_NAME' | translate"
                      (keyup.enter)="addSubcategory()">
                    <button class="btn btn-secondary" (click)="showAddForm.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
                    <button class="btn btn-primary" (click)="addSubcategory()" [disabled]="!newSubcategoryName.trim()">{{ 'COMMON.OK' | translate }}</button>
                  </div>
                </div>
              </div>
            }

            <div class="subcategories-grid">
              @for (subcat of currentSubcategories(); track subcat) {
                <div class="subcat-card">
                  @if (editingSubcategory() === subcat) {
                    <div class="edit-mode">
                      <input 
                        type="text" 
                        [(ngModel)]="editName" 
                        class="edit-input"
                        (keyup.enter)="saveEdit(subcat)"
                        (keyup.escape)="editingSubcategory.set(null)"
                        #editInput
                        autofocus>
                      <div class="edit-actions">
                        <button class="icon-btn success" (click)="saveEdit(subcat)">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        </button>
                        <button class="icon-btn" (click)="editingSubcategory.set(null)">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  } @else {
                    <div class="view-mode">
                      <span class="subcat-name">{{ subcat }}</span>
                      <div class="subcat-actions">
                        <button class="icon-btn" (click)="startEdit(subcat)" title="{{ 'COMMON.EDIT' | translate }}">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button class="icon-btn danger" (click)="deleteSubcategory(subcat)" title="{{ 'COMMON.DELETE' | translate }}">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  }
                </div>
              } @empty {
                <div class="empty-subcategories">
                  <p>{{ 'PRODUCTS.NO_SUBCATEGORIES_FOUND' | translate }}</p>
                </div>
              }
            </div>
          } @else {
            <div class="select-prompt">
              <div class="prompt-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <p>{{ 'PRODUCTS.SELECT_CATEGORY_TO_MANAGE' | translate }}</p>
            </div>
          }
        </div>
      </div>

      <!-- Toasts/Messages -->
      @if (success()) { <div class="toast success">{{ success() }}</div> }
      @if (error()) { <div class="toast error">{{ error() }}</div> }
      @if (loading()) { <div class="loading-overlay"><div class="spinner"></div></div> }
    </div>
  `,
  styles: [`
    .categories-container {
      height: calc(100vh - 250px);
      min-height: 500px;
      position: relative;
    }

    .split-view {
      display: grid;
      grid-template-columns: 280px 1fr;
      gap: 0;
      height: 100%;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }

    /* Sidebar */
    .category-sidebar {
      border-right: 1px solid var(--color-border);
      background: var(--color-bg);
      display: flex;
      flex-direction: column;
    }

    .sidebar-header {
      padding: var(--space-4);
      border-bottom: 1px solid var(--color-border);
      background: var(--color-surface);
      display: flex;
      align-items: center;
      justify-content: space-between;
      h3 { margin: 0; font-size: 0.875rem; text-transform: uppercase; color: var(--color-text-muted); }
    }

    .add-category-form {
      margin: var(--space-3);
      padding: var(--space-3);
      background: var(--color-bg);
      border: 1px dashed var(--color-primary);
      border-radius: var(--radius-md);

      .form-group { margin-bottom: var(--space-2); }
      label { display: block; font-size: 0.75rem; color: var(--color-text-muted); margin-bottom: var(--space-1); }
      input { width: 100%; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-sizing: border-box; }
      .input-row { justify-content: flex-end; margin-top: var(--space-2); }
    }

    .sidebar-list {
      flex: 1;
      overflow-y: auto;
      padding: var(--space-2);
    }

    .category-item {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--space-3) var(--space-4);
      background: none;
      border: none;
      border-radius: var(--radius-md);
      color: var(--color-text);
      font-weight: 500;
      text-align: left;
      cursor: pointer;
      transition: all 0.15s ease;
      margin-bottom: 2px;

      &:hover { background: var(--color-surface); }
      &.active { background: var(--color-primary); color: white; .count { background: rgba(255,255,255,0.2); color: white; } }

      .count {
        font-size: 0.75rem;
        background: var(--color-bg);
        color: var(--color-text-muted);
        padding: 2px 8px;
        border-radius: 10px;
      }
    }

    /* Main Area */
    .subcategory-main {
      padding: var(--space-6);
      overflow-y: auto;
      background: var(--color-surface);
    }

    .main-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--space-6);
      gap: var(--space-3);
      h2 { margin: 0; font-size: 1.25rem; font-weight: 600; }
    }

    .main-header-actions {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-shrink: 0;
    }

    .rename-category-row {
      flex: 1;
      input { padding: var(--space-2) var(--space-3); border: 1px solid var(--color-primary); border-radius: var(--radius-md); font-size: 1.125rem; font-weight: 600; flex: 1; max-width: 20rem; }
    }

    .select-prompt {
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--color-text-muted);
      text-align: center;
      .prompt-icon { margin-bottom: var(--space-4); opacity: 0.3; }
    }

    .subcategories-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: var(--space-4);
    }

    .subcat-card {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--space-3) var(--space-4);
      transition: border-color 0.15s;

      &:hover { border-color: var(--color-primary); }
    }

    .view-mode, .edit-mode {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-2);
    }

    .subcat-name { font-weight: 500; }

    .subcat-actions, .edit-actions {
      display: flex;
      gap: var(--space-1);
    }

    .edit-input {
      flex: 1;
      padding: var(--space-1) var(--space-2);
      border: 1px solid var(--color-primary);
      border-radius: var(--radius-sm);
      font-size: 0.9375rem;
      &:focus { outline: none; }
    }

    .icon-btn {
      background: none;
      border: none;
      padding: var(--space-2);
      border-radius: var(--radius-sm);
      color: var(--color-text-muted);
      cursor: pointer;
      &:hover { background: rgba(0,0,0,0.05); color: var(--color-text); }
      &.danger:hover { background: rgba(220, 38, 38, 0.1); color: var(--color-error); }
      &.success:hover { background: rgba(22, 163, 74, 0.1); color: var(--color-success); }
    }

    .btn-sm { padding: var(--space-2) var(--space-3); font-size: 0.8125rem; }

    .add-form {
      margin-bottom: var(--space-6);
      padding: var(--space-4);
      background: var(--color-bg);
      border: 1px dashed var(--color-primary);
    }

    .input-row {
      display: flex;
      gap: var(--space-2);
      input { flex: 1; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    }

    /* Toasts & Overlay */
    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      padding: 1rem 1.5rem;
      border-radius: var(--radius-md);
      color: white;
      z-index: 1000;
      box-shadow: var(--shadow-lg);
      &.success { background: var(--color-success); }
      &.error { background: var(--color-error); }
    }

    .loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(255,255,255,0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
    }

    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--color-border);
      border-top-color: var(--color-primary);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 768px) {
      .split-view { grid-template-columns: 1fr; }
      .category-sidebar { border-right: none; border-bottom: 1px solid var(--color-border); max-height: 200px; }
    }
  `]
})
export class CategoriesComponent implements OnInit {
  private api = inject(ApiService);
  private translate = inject(TranslateService);

  /** Notify parent (Products tab) to refresh shared category map. */
  categoriesChanged = output<void>();

  products = signal<Product[]>([]);
  categoriesMap = signal<Record<string, string[]>>({});
  selectedCategory = signal<string | null>(null);
  loading = signal(false);
  error = signal('');
  success = signal('');

  // UI State
  showAddForm = signal(false);
  showAddCategoryForm = signal(false);
  newCategoryName = '';
  newCategoryFirstSubcategory = '';
  renamingCategory = signal(false);
  renameCategoryName = '';
  categoryLabelOverrides = signal<Record<string, string>>({});
  newSubcategoryName = '';
  editingSubcategory = signal<string | null>(null);
  editName = '';

  mainCategories = computed(() => Object.keys(this.categoriesMap()).sort());
  currentSubcategories = computed(() => {
    const cat = this.selectedCategory();
    if (!cat) return [];
    return (this.categoriesMap()[cat] || []).filter(s => !!s).sort();
  });

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.loading.set(true);
    forkJoin({
      products: this.api.getProducts(),
      categories: this.api.getCatalogCategories(),
      labels: this.api.getTenantCategoryLabels(),
    }).subscribe({
      next: ({ products, categories, labels }) => {
        this.products.set(products);
        this.categoriesMap.set(categories);
        this.categoryLabelOverrides.set(labels);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.translate.instant('PRODUCTS.FAILED_TO_LOAD'));
        this.loading.set(false);
      },
    });
  }

  private applyCategoriesMap(map: Record<string, string[]>) {
    this.categoriesMap.set(map);
    this.categoriesChanged.emit();
  }

  private apiErrorMessage(err: { error?: { detail?: string } }, fallbackKey: string): string {
    const detail = err?.error?.detail;
    if (detail === 'Subcategory already exists') {
      return this.translate.instant('PRODUCTS.SUBCATEGORY_ALREADY_EXISTS');
    }
    if (detail === 'Category already exists') {
      return this.translate.instant('PRODUCTS.CATEGORY_ALREADY_EXISTS');
    }
    if (detail === "Standard categories can't be deleted") {
      return this.translate.instant('PRODUCTS.CATEGORY_DELETE_STANDARD_BLOCKED');
    }
    if (detail === 'Category is in use by products') {
      return this.translate.instant('PRODUCTS.CATEGORY_DELETE_IN_USE_BLOCKED');
    }
    return this.translate.instant(fallbackKey);
  }

  getSubcategoryCount(category: string): number {
    return (this.categoriesMap()[category] || []).length;
  }

  getCategoryLabel(category: string): string {
    return resolveCategoryLabel(category, this.translate, this.categoryLabelOverrides());
  }

  startRenameCategory() {
    const cat = this.selectedCategory();
    if (!cat) return;
    this.renameCategoryName = this.getCategoryLabel(cat);
    this.renamingCategory.set(true);
  }

  cancelRenameCategory() {
    this.renamingCategory.set(false);
    this.renameCategoryName = '';
  }

  saveRenameCategory() {
    const cat = this.selectedCategory();
    const newName = this.renameCategoryName.trim();
    if (!cat || !newName) return;
    if (newName === this.getCategoryLabel(cat)) {
      this.cancelRenameCategory();
      return;
    }

    this.loading.set(true);
    this.api.renameTenantCategory(cat, newName).subscribe({
      next: (map) => {
        this.applyCategoriesMap(map);
        // The renamed category's underlying key may or may not change (see backend docs);
        // reload labels too and re-select whichever key now matches the new display name.
        this.api.getTenantCategoryLabels().subscribe((labels) => {
          this.categoryLabelOverrides.set(labels);
          const stillPresent = Object.keys(map).find((k) => this.getCategoryLabel(k) === newName);
          this.selectedCategory.set(stillPresent ?? cat);
        });
        this.cancelRenameCategory();
        this.loading.set(false);
        this.showSuccess('PRODUCTS.CATEGORY_RENAMED');
      },
      error: (err) => {
        this.error.set(this.apiErrorMessage(err, 'PRODUCTS.FAILED_TO_RENAME_CATEGORY'));
        this.loading.set(false);
        setTimeout(() => this.error.set(''), 4000);
      },
    });
  }

  confirmDeleteCategory() {
    const cat = this.selectedCategory();
    if (!cat) return;
    if (!confirm(this.translate.instant('PRODUCTS.DELETE_CATEGORY_CONFIRM', { category: this.getCategoryLabel(cat) }))) {
      return;
    }

    this.loading.set(true);
    this.api.deleteTenantCategory(cat).subscribe({
      next: (map) => {
        this.applyCategoriesMap(map);
        this.selectedCategory.set(null);
        this.loading.set(false);
        this.showSuccess('PRODUCTS.CATEGORY_DELETED');
      },
      error: (err) => {
        this.error.set(this.apiErrorMessage(err, 'PRODUCTS.FAILED_TO_DELETE_CATEGORY'));
        this.loading.set(false);
        setTimeout(() => this.error.set(''), 4000);
      },
    });
  }

  selectCategory(category: string) {
    this.selectedCategory.set(category);
    this.showAddForm.set(false);
    this.editingSubcategory.set(null);
  }

  cancelAddCategory() {
    this.showAddCategoryForm.set(false);
    this.newCategoryName = '';
    this.newCategoryFirstSubcategory = '';
  }

  /** Creates a brand-new top-level category. A category only exists once it has a subcategory. */
  addCategory() {
    const cat = this.newCategoryName.trim();
    const sub = this.newCategoryFirstSubcategory.trim();
    if (!cat || !sub) return;

    if (this.mainCategories().some((c) => c.toLowerCase() === cat.toLowerCase())) {
      this.error.set(this.translate.instant('PRODUCTS.CATEGORY_ALREADY_EXISTS'));
      setTimeout(() => this.error.set(''), 3000);
      return;
    }

    this.loading.set(true);
    this.api.createTenantSubcategory(cat, sub).subscribe({
      next: (map) => {
        this.applyCategoriesMap(map);
        this.selectedCategory.set(cat);
        this.cancelAddCategory();
        this.loading.set(false);
        this.showSuccess('PRODUCTS.CATEGORY_ADDED');
      },
      error: (err) => {
        this.error.set(this.apiErrorMessage(err, 'PRODUCTS.FAILED_TO_UPDATE_SUBCATEGORY'));
        this.loading.set(false);
        setTimeout(() => this.error.set(''), 4000);
      },
    });
  }

  addSubcategory() {
    const name = this.newSubcategoryName.trim();
    const cat = this.selectedCategory();
    if (!name || !cat) return;

    if (this.currentSubcategories().includes(name)) {
      this.error.set(this.translate.instant('PRODUCTS.SUBCATEGORY_ALREADY_EXISTS'));
      setTimeout(() => this.error.set(''), 3000);
      return;
    }

    this.loading.set(true);
    this.api.createTenantSubcategory(cat, name).subscribe({
      next: (map) => {
        this.applyCategoriesMap(map);
        this.newSubcategoryName = '';
        this.showAddForm.set(false);
        this.loading.set(false);
        this.showSuccess('PRODUCTS.SUBCATEGORY_ADDED');
      },
      error: (err) => {
        this.error.set(this.apiErrorMessage(err, 'PRODUCTS.FAILED_TO_UPDATE_SUBCATEGORY'));
        this.loading.set(false);
        setTimeout(() => this.error.set(''), 4000);
      },
    });
  }

  startEdit(subcat: string) {
    this.editingSubcategory.set(subcat);
    this.editName = subcat;
  }

  saveEdit(oldName: string) {
    const newName = this.editName.trim();
    const cat = this.selectedCategory();
    if (!newName || !cat || newName === oldName) {
      this.editingSubcategory.set(null);
      return;
    }

    this.loading.set(true);
    
    // Find all products in this category and subcategory
    const productsToUpdate = this.products().filter(p => p.category === cat && p.subcategory === oldName);
    
    if (productsToUpdate.length === 0) {
      this.api.renameTenantSubcategory(cat, oldName, newName).subscribe({
        next: (map) => {
          this.applyCategoriesMap(map);
          this.loading.set(false);
          this.editingSubcategory.set(null);
          this.showSuccess('PRODUCTS.SUBCATEGORY_UPDATED');
        },
        error: (err) => {
          this.error.set(this.apiErrorMessage(err, 'PRODUCTS.FAILED_TO_UPDATE_SUBCATEGORY'));
          this.loading.set(false);
        },
      });
      return;
    }

    const requests = [
      ...productsToUpdate.map((p) => this.api.updateProduct(p.id!, { subcategory: newName })),
      this.api.renameTenantSubcategory(cat, oldName, newName),
    ];

    forkJoin(requests).subscribe({
      next: (results) => {
        const map = results[results.length - 1] as Record<string, string[]>;
        this.applyCategoriesMap(map);
        this.products.update((list) =>
          list.map((p) => {
            if (p.category === cat && p.subcategory === oldName) {
              return { ...p, subcategory: newName };
            }
            return p;
          }),
        );
        this.loading.set(false);
        this.editingSubcategory.set(null);
        this.showSuccess('PRODUCTS.SUBCATEGORY_UPDATED');
      },
      error: (err) => {
        this.error.set(this.apiErrorMessage(err, 'PRODUCTS.FAILED_TO_UPDATE_SUBCATEGORY'));
        this.loading.set(false);
      },
    });
  }

  deleteSubcategory(name: string) {
    const cat = this.selectedCategory();
    if (!cat) return;

    if (!confirm(this.translate.instant('PRODUCTS.DELETE_SUBCATEGORY_CONFIRM', { name }))) {
      return;
    }

    this.loading.set(true);
    const productsToUpdate = this.products().filter(p => p.category === cat && p.subcategory === name);

    if (productsToUpdate.length === 0) {
      this.api.deleteTenantSubcategory(cat, name).subscribe({
        next: (map) => {
          this.applyCategoriesMap(map);
          this.loading.set(false);
          this.showSuccess('PRODUCTS.SUBCATEGORY_DELETED');
        },
        error: (err) => {
          this.error.set(this.apiErrorMessage(err, 'PRODUCTS.FAILED_TO_UPDATE_SUBCATEGORY'));
          this.loading.set(false);
        },
      });
      return;
    }

    const requests = [
      ...productsToUpdate.map((p) => this.api.updateProduct(p.id!, { subcategory: null as any })),
      this.api.deleteTenantSubcategory(cat, name),
    ];

    forkJoin(requests).subscribe({
      next: (results) => {
        const map = results[results.length - 1] as Record<string, string[]>;
        this.applyCategoriesMap(map);
        this.products.update((list) =>
          list.map((p) => {
            if (p.category === cat && p.subcategory === name) {
              return { ...p, subcategory: undefined };
            }
            return p;
          }),
        );
        this.loading.set(false);
        this.showSuccess('PRODUCTS.SUBCATEGORY_DELETED');
      },
      error: (err) => {
        this.error.set(this.apiErrorMessage(err, 'PRODUCTS.FAILED_TO_UPDATE_SUBCATEGORY'));
        this.loading.set(false);
      },
    });
  }

  private showSuccess(key: string) {
    this.success.set(this.translate.instant(key));
    setTimeout(() => this.success.set(''), 3000);
  }
}
