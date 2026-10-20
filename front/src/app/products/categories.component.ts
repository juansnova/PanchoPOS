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
      <div class="split-view">
        <!-- Sidebar: categories -->
        <aside class="category-sidebar">
          <div class="sidebar-header">
            <div>
              <h3>{{ 'CATALOG.CATEGORY_LABEL' | translate }}</h3>
              <small>{{ mainCategories().length }}</small>
            </div>
            <button type="button" class="round-add" [class.on]="showAddCategoryForm()" (click)="showAddCategoryForm.set(!showAddCategoryForm())" [title]="'PRODUCTS.ADD_CATEGORY' | translate" [attr.aria-label]="'PRODUCTS.ADD_CATEGORY' | translate">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
          @if (showAddCategoryForm()) {
            <div class="add-category-form">
              <div class="form-group">
                <label>{{ 'PRODUCTS.NEW_CATEGORY_NAME' | translate }}</label>
                <input type="text" [(ngModel)]="newCategoryName" [placeholder]="'PRODUCTS.ENTER_CATEGORY_NAME' | translate">
              </div>
              <div class="form-group">
                <label>{{ 'PRODUCTS.NEW_CATEGORY_FIRST_SUBCATEGORY' | translate }}</label>
                <input type="text" [(ngModel)]="newCategoryFirstSubcategory" [placeholder]="'PRODUCTS.ENTER_SUBCATEGORY_NAME' | translate" (keyup.enter)="addCategory()">
              </div>
              <div class="input-row">
                <button type="button" class="pill pill-ghost" (click)="cancelAddCategory()">{{ 'COMMON.CANCEL' | translate }}</button>
                <button type="button" class="pill pill-main" (click)="addCategory()" [disabled]="!newCategoryName.trim() || !newCategoryFirstSubcategory.trim()">{{ 'COMMON.OK' | translate }}</button>
              </div>
            </div>
          }
          <div class="sidebar-list">
            @for (category of mainCategories(); track category) {
              <button type="button" class="category-item" [class.active]="selectedCategory() === category" [style.--h]="hue(category)" (click)="selectCategory(category)">
                <span class="cat-avatar" aria-hidden="true">{{ initial(category) }}</span>
                <span class="cat-text">
                  <span class="cat-name">{{ getCategoryLabel(category) }}</span>
                  <small>{{ productCount(category) }} {{ 'PRODUCTS.STATS_PRODUCTS' | translate }}</small>
                </span>
                <span class="count">{{ getSubcategoryCount(category) }}</span>
              </button>
            }
          </div>
        </aside>

        <!-- Main: subcategories -->
        <section class="subcategory-main">
          @if (selectedCategory()) {
            <header class="main-header" [style.--h]="hue(selectedCategory()!)">
              <span class="hero-avatar" aria-hidden="true">{{ initial(selectedCategory()!) }}</span>
              <div class="hero-text">
                @if (renamingCategory()) {
                  <div class="input-row rename-category-row">
                    <input type="text" [(ngModel)]="renameCategoryName" (keyup.enter)="saveRenameCategory()" (keyup.escape)="cancelRenameCategory()" autofocus>
                    <button type="button" class="pill pill-ghost" (click)="cancelRenameCategory()">{{ 'COMMON.CANCEL' | translate }}</button>
                    <button type="button" class="pill pill-main" (click)="saveRenameCategory()" [disabled]="!renameCategoryName.trim()">{{ 'COMMON.OK' | translate }}</button>
                  </div>
                } @else {
                  <h2>{{ getCategoryLabel(selectedCategory()!) }}</h2>
                  <p>
                    <span class="stat-chip"><b>{{ currentSubcategories().length }}</b> {{ 'PRODUCTS.SUBCATEGORY_HEADER' | translate }}</span>
                    <span class="stat-chip"><b>{{ productCount(selectedCategory()!) }}</b> {{ 'PRODUCTS.STATS_PRODUCTS' | translate }}</span>
                  </p>
                }
              </div>
              @if (!renamingCategory()) {
                <div class="main-header-actions">
                  <button type="button" class="round-btn" (click)="startRenameCategory()" [title]="'PRODUCTS.RENAME_CATEGORY' | translate" [attr.aria-label]="'PRODUCTS.RENAME_CATEGORY' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                  <button type="button" class="round-btn danger" (click)="confirmDeleteCategory()" [title]="'PRODUCTS.DELETE_CATEGORY' | translate" [attr.aria-label]="'PRODUCTS.DELETE_CATEGORY' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
                  <button type="button" class="pill pill-main" (click)="showAddForm.set(true)">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    {{ 'PRODUCTS.ADD_SUBCATEGORY' | translate }}
                  </button>
                </div>
              }
            </header>

            @if (showAddForm()) {
              <div class="add-form">
                <label>{{ 'PRODUCTS.SUBCATEGORY_NAME' | translate }}</label>
                <div class="input-row">
                  <input type="text" [(ngModel)]="newSubcategoryName" [placeholder]="'PRODUCTS.ENTER_SUBCATEGORY_NAME' | translate" (keyup.enter)="addSubcategory()" autofocus>
                  <button type="button" class="pill pill-ghost" (click)="showAddForm.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
                  <button type="button" class="pill pill-main" (click)="addSubcategory()" [disabled]="!newSubcategoryName.trim()">{{ 'COMMON.OK' | translate }}</button>
                </div>
              </div>
            }

            <div class="subcategories-grid" [style.--h]="hue(selectedCategory()!)">
              @for (subcat of currentSubcategories(); track subcat) {
                <div class="subcat-card" [class.editing]="editingSubcategory() === subcat">
                  @if (editingSubcategory() === subcat) {
                    <div class="edit-mode">
                      <input type="text" [(ngModel)]="editName" class="edit-input" (keyup.enter)="saveEdit(subcat)" (keyup.escape)="editingSubcategory.set(null)" #editInput autofocus>
                      <div class="subcat-actions always">
                        <button type="button" class="round-btn success" (click)="saveEdit(subcat)" [attr.aria-label]="'COMMON.OK' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>
                        <button type="button" class="round-btn" (click)="editingSubcategory.set(null)" [attr.aria-label]="'COMMON.CANCEL' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                      </div>
                    </div>
                  } @else {
                    <div class="view-mode">
                      <span class="subcat-dot" aria-hidden="true"></span>
                      <span class="subcat-name">{{ subcat }}</span>
                      <div class="subcat-actions">
                        <button type="button" class="round-btn" (click)="startEdit(subcat)" [title]="'COMMON.EDIT' | translate" [attr.aria-label]="'COMMON.EDIT' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        <button type="button" class="round-btn danger" (click)="deleteSubcategory(subcat)" [title]="'COMMON.DELETE' | translate" [attr.aria-label]="'COMMON.DELETE' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
                      </div>
                    </div>
                  }
                </div>
              } @empty {
                <div class="empty-subcategories">
                  <p>{{ 'PRODUCTS.NO_SUBCATEGORIES_FOUND' | translate }}</p>
                </div>
              }
              <button type="button" class="subcat-add" (click)="showAddForm.set(true)">
                <span>+</span> {{ 'PRODUCTS.ADD_SUBCATEGORY' | translate }}
              </button>
            </div>
          } @else {
            <div class="select-prompt">
              <div class="prompt-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <p>{{ 'PRODUCTS.SELECT_CATEGORY_TO_MANAGE' | translate }}</p>
            </div>
          }
        </section>
      </div>

      @if (success()) { <div class="toast success">{{ success() }}</div> }
      @if (error()) { <div class="toast error">{{ error() }}</div> }
      @if (loading()) { <div class="loading-overlay"><div class="spinner"></div></div> }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .categories-container { height: calc(100vh - 250px); min-height: 520px; position: relative; }

    .split-view {
      display: grid; grid-template-columns: 320px 1fr; height: 100%; overflow: hidden;
      background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 24px;
      box-shadow: 0 20px 44px -30px rgba(0, 0, 0, .45);
    }

    /* ---------- Sidebar ---------- */
    .category-sidebar { display: flex; flex-direction: column; min-height: 0; background: var(--color-bg); border-right: 1px solid var(--color-border); }
    .sidebar-header {
      display: flex; align-items: center; justify-content: space-between; padding: 18px 18px 12px;
      h3 { margin: 0; font-size: .78rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--color-text-muted); }
      small { font-size: 1.4rem; font-weight: 800; color: var(--color-text); line-height: 1.1; }
    }
    .round-add {
      display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: 50%; cursor: pointer; color: #fff;
      background: var(--color-primary); box-shadow: 0 10px 18px -8px var(--color-primary); touch-action: manipulation;
      transition: transform .18s, filter .15s;
      &:hover { filter: brightness(1.08); }
      &.on { transform: rotate(45deg); }
    }
    .add-category-form {
      margin: 0 12px 10px; padding: 14px; border-radius: 18px; background: var(--color-surface);
      border: 1.5px dashed var(--color-primary);
      .form-group { margin-bottom: 10px; }
      label { display: block; margin-bottom: 4px; font-size: .7rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-muted); }
      input { width: 100%; min-height: 42px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-bg); box-sizing: border-box; font: inherit; }
      input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
      .input-row { justify-content: flex-end; }
    }
    .sidebar-list { flex: 1; overflow-y: auto; padding: 4px 12px 16px; display: flex; flex-direction: column; gap: 6px; scrollbar-width: thin; }

    .category-item {
      --h: 20;
      display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 12px; border: 1px solid transparent; border-radius: 18px;
      background: transparent; color: var(--color-text); text-align: left; cursor: pointer; font: inherit; touch-action: manipulation;
      transition: background .15s, border-color .15s, transform .12s, box-shadow .15s;
      &:hover { background: var(--color-surface); transform: translateX(2px); }
      &.active {
        background: var(--color-surface); border-color: hsl(var(--h) 70% 50%); box-shadow: 0 12px 24px -18px hsl(var(--h) 70% 40%);
        .cat-name { color: hsl(var(--h) 65% 38%); }
        .count { background: hsl(var(--h) 70% 50%); color: #fff; }
      }
    }
    .cat-avatar {
      flex: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; font-weight: 800; font-size: 1.1rem;
      color: #fff; background: linear-gradient(135deg, hsl(var(--h) 75% 58%), hsl(var(--h) 70% 42%));
      box-shadow: 0 8px 14px -8px hsl(var(--h) 70% 40%);
    }
    .cat-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .cat-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cat-text small { color: var(--color-text-muted); font-size: .75rem; }
    .count {
      flex: none; display: grid; place-items: center; min-width: 28px; height: 28px; padding: 0 8px; border-radius: 999px;
      font-size: .78rem; font-weight: 800; background: var(--color-surface); color: var(--color-text-muted); border: 1px solid var(--color-border);
    }

    /* ---------- Main ---------- */
    .subcategory-main { min-height: 0; overflow-y: auto; padding: 22px; background: var(--color-surface); }
    .main-header {
      --h: 20;
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; padding: 18px; border-radius: 22px;
      background: linear-gradient(135deg, hsl(var(--h) 85% 94%), var(--color-surface) 75%);
      border: 1px solid hsl(var(--h) 60% 82%);
    }
    .hero-avatar {
      flex: none; display: grid; place-items: center; width: 64px; height: 64px; border-radius: 20px; font-size: 1.7rem; font-weight: 800; color: #fff;
      background: linear-gradient(135deg, hsl(var(--h) 75% 58%), hsl(var(--h) 70% 42%)); box-shadow: 0 14px 24px -12px hsl(var(--h) 70% 40%);
    }
    .hero-text { flex: 1; min-width: 200px;
      h2 { margin: 0 0 6px; font-size: 1.6rem; font-weight: 800; letter-spacing: -.01em; }
      p { margin: 0; display: flex; flex-wrap: wrap; gap: 8px; }
    }
    .stat-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-size: .8rem; font-weight: 600; color: var(--color-text-muted); background: var(--color-surface); border: 1px solid var(--color-border); b { color: var(--color-text); font-weight: 800; } }
    .main-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .rename-category-row { flex-wrap: wrap; input { flex: 1; min-width: 160px; max-width: 22rem; min-height: 46px; padding: 0 14px; border: 1.5px solid var(--color-primary); border-radius: 14px; font: inherit; font-size: 1.1rem; font-weight: 700; } }

    .round-btn {
      display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 50%; cursor: pointer;
      background: var(--color-surface); color: var(--color-text-muted); box-shadow: inset 0 0 0 1px var(--color-border); touch-action: manipulation;
      transition: background .15s, color .15s, transform .12s;
      &:hover { background: var(--color-primary-light); color: var(--color-primary); }
      &:active { transform: scale(.92); }
      &.danger:hover { background: rgba(220, 38, 38, .1); color: #dc2626; }
      &.success { background: rgba(22, 163, 74, .12); color: #15803d; box-shadow: none; }
    }
    .pill {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 20px; border: 0; border-radius: 999px;
      font: inherit; font-size: .88rem; font-weight: 800; cursor: pointer; touch-action: manipulation; transition: filter .15s, transform .12s;
      &:active:not(:disabled) { transform: scale(.97); }
      &:disabled { opacity: .45; cursor: default; box-shadow: none; }
    }
    .pill-main { background: var(--color-primary); color: #fff; box-shadow: 0 10px 20px -10px var(--color-primary); &:hover:not(:disabled) { filter: brightness(1.07); } }
    .pill-ghost { background: transparent; color: var(--color-text); box-shadow: inset 0 0 0 1px var(--color-border); &:hover { background: var(--color-bg); } }

    .add-form {
      margin-bottom: 18px; padding: 16px; border-radius: 20px; background: var(--color-primary-light); border: 1.5px dashed var(--color-primary);
      label { display: block; margin-bottom: 8px; font-size: .72rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--color-primary); }
    }
    .input-row {
      display: flex; gap: 8px; flex-wrap: wrap;
      input { flex: 1; min-width: 160px; min-height: 46px; padding: 0 14px; border: 1px solid var(--color-border); border-radius: 14px; background: var(--color-surface); font: inherit; }
      input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
    }

    .subcategories-grid { --h: 20; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
    .subcat-card {
      position: relative; overflow: hidden; padding: 12px 14px; border-radius: 18px; background: var(--color-bg); border: 1px solid var(--color-border);
      transition: border-color .15s, transform .15s, box-shadow .15s;
      &::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 5px; background: hsl(var(--h) 70% 52%); }
      &:hover { border-color: hsl(var(--h) 60% 62%); transform: translateY(-2px); box-shadow: 0 14px 24px -18px rgba(0, 0, 0, .5); }
      &.editing { border-color: var(--color-primary); }
    }
    .view-mode, .edit-mode { display: flex; align-items: center; gap: 10px; min-height: 42px; padding-left: 4px; }
    .subcat-dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: hsl(var(--h) 70% 52%); }
    .subcat-name { flex: 1; min-width: 0; font-weight: 700; overflow-wrap: anywhere; }
    .subcat-actions { display: flex; gap: 4px; opacity: 0; transition: opacity .15s; &.always { opacity: 1; } }
    .subcat-card:hover .subcat-actions, .subcat-card:focus-within .subcat-actions { opacity: 1; }
    @media (hover: none) { .subcat-actions { opacity: 1; } }
    .edit-input { flex: 1; min-width: 0; min-height: 40px; padding: 0 12px; border: 1.5px solid var(--color-primary); border-radius: 12px; font: inherit; &:focus { outline: none; } }
    .subcat-add {
      display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 66px; border-radius: 18px; cursor: pointer;
      border: 1.5px dashed hsl(var(--h) 55% 62%); background: hsl(var(--h) 90% 97%); color: hsl(var(--h) 65% 38%); font: inherit; font-weight: 800;
      touch-action: manipulation; transition: background .15s, transform .12s;
      span { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: hsl(var(--h) 70% 52%); color: #fff; font-size: 1.2rem; line-height: 1; }
      &:hover { background: hsl(var(--h) 90% 94%); }
      &:active { transform: scale(.98); }
    }
    .empty-subcategories { grid-column: 1 / -1; padding: 8px 4px; color: var(--color-text-muted); p { margin: 0; } }

    .select-prompt {
      height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: var(--color-text-muted);
      .prompt-icon { display: grid; place-items: center; width: 110px; height: 110px; margin-bottom: 14px; border-radius: 32px; background: var(--color-primary-light); color: var(--color-primary); }
    }

    /* ---------- Toasts & overlay ---------- */
    .toast { position: fixed; bottom: 2rem; right: 2rem; padding: 14px 22px; border-radius: 16px; color: #fff; font-weight: 700; z-index: 1000; box-shadow: var(--shadow-lg);
      &.success { background: var(--color-success); } &.error { background: var(--color-error); } }
    .loading-overlay { position: absolute; inset: 0; background: rgba(255,255,255,.7); display: flex; align-items: center; justify-content: center; z-index: 10; border-radius: 24px; }
    .spinner { width: 32px; height: 32px; border: 3px solid var(--color-border); border-top-color: var(--color-primary); border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (prefers-reduced-motion: reduce) {
      .category-item, .subcat-card, .round-add { transition: none; }
      .category-item:hover, .subcat-card:hover { transform: none; }
    }
    @media (max-width: 860px) {
      .categories-container { height: auto; }
      .split-view { grid-template-columns: 1fr; height: auto; }
      .category-sidebar { border-right: 0; border-bottom: 1px solid var(--color-border); }
      .sidebar-list { flex-direction: row; overflow-x: auto; overflow-y: hidden; padding-bottom: 12px; }
      .category-item { flex: none; width: auto; min-width: 210px; }
      .subcategory-main { overflow: visible; }
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

  private static readonly HUES = [14, 32, 48, 98, 150, 186, 212, 262, 300, 340];

  /** Stable accent colour per category (hue in degrees). */
  hue(category: string): number {
    let h = 0;
    for (const ch of category) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return CategoriesComponent.HUES[h % CategoriesComponent.HUES.length];
  }

  initial(category: string): string {
    return (this.getCategoryLabel(category) || '?').trim().charAt(0).toUpperCase();
  }

  productCount(category: string): number {
    return this.products().filter((p) => p.category === category).length;
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
