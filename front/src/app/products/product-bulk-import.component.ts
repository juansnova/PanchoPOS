import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  ApiService,
  ProductBulkImportConfirmResult,
  ProductBulkImportPreviewResponse,
  ProductBulkImportPreviewRow,
} from '../services/api.service';
import { getSubcategoryLabel as resolveSubcategoryLabel } from '../shared/product-subcategory-label.util';
import { getCategoryLabel as resolveCategoryLabel } from '../shared/product-category-label.util';

type ImportSource = 'json' | 'csv' | 'vision';

@Component({
  selector: 'app-product-bulk-import',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    <div class="modal-overlay" (click)="onBackdropClick()">
      <div class="modal bulk-import-modal" (click)="$event.stopPropagation()">
        <div class="bulk-import-header">
          <h3>{{ 'PRODUCTS.BULK_IMPORT_TITLE' | translate }}</h3>
          <button type="button" class="icon-btn" (click)="closed.emit()" [attr.aria-label]="'COMMON.CLOSE' | translate">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <p class="bulk-import-lede">{{ 'PRODUCTS.BULK_IMPORT_LEDE' | translate }}</p>

        @if (error()) {
          <div class="error-banner bulk-import-error">{{ error() }}</div>
        }

        @if (step() === 'source') {
          <div class="source-tabs">
            <button type="button" class="source-tab" [class.active]="source() === 'json'" (click)="source.set('json')">
              {{ 'PRODUCTS.BULK_IMPORT_TAB_JSON' | translate }}
            </button>
            <button type="button" class="source-tab" [class.active]="source() === 'csv'" (click)="source.set('csv')">
              {{ 'PRODUCTS.BULK_IMPORT_TAB_CSV' | translate }}
            </button>
            <button
              type="button"
              class="source-tab"
              [class.active]="source() === 'vision'"
              (click)="source.set('vision')"
              [disabled]="!visionConfigured()"
            >
              {{ 'PRODUCTS.BULK_IMPORT_TAB_VISION' | translate }}
            </button>
          </div>

          @if (source() === 'json') {
            <div class="form-group">
              <label for="bulk-json-file">{{ 'PRODUCTS.BULK_IMPORT_JSON_FILE' | translate }}</label>
              <input id="bulk-json-file" type="file" accept="application/json,.json" (change)="onJsonFileSelected($event)" />
            </div>
            <div class="form-group">
              <label for="bulk-json-paste">{{ 'PRODUCTS.BULK_IMPORT_JSON_PASTE' | translate }}</label>
              <textarea
                id="bulk-json-paste"
                rows="8"
                [(ngModel)]="jsonText"
                [placeholder]="'PRODUCTS.BULK_IMPORT_JSON_PLACEHOLDER' | translate"
              ></textarea>
              <small class="field-hint">{{ 'PRODUCTS.BULK_IMPORT_JSON_HINT' | translate }}</small>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" (click)="closed.emit()">{{ 'COMMON.CANCEL' | translate }}</button>
              <button type="button" class="btn btn-primary" (click)="loadJsonPreview()" [disabled]="loading()">
                {{ loading() ? ('COMMON.LOADING' | translate) : ('PRODUCTS.BULK_IMPORT_PREVIEW' | translate) }}
              </button>
            </div>
          } @else if (source() === 'csv') {
            <div class="form-group">
              <label for="bulk-csv-file">{{ 'PRODUCTS.BULK_IMPORT_CSV_FILE' | translate }}</label>
              <input
                id="bulk-csv-file"
                type="file"
                accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain"
                (change)="onCsvFileSelected($event)"
              />
            </div>
            <div class="form-group">
              <label for="bulk-csv-paste">{{ 'PRODUCTS.BULK_IMPORT_CSV_PASTE' | translate }}</label>
              <textarea
                id="bulk-csv-paste"
                rows="8"
                [(ngModel)]="csvText"
                [placeholder]="'PRODUCTS.BULK_IMPORT_CSV_PLACEHOLDER' | translate"
              ></textarea>
              <small class="field-hint">{{ 'PRODUCTS.BULK_IMPORT_CSV_HINT' | translate }}</small>
            </div>
            @if (visionConfigured()) {
              <label class="checkbox-row">
                <input type="checkbox" [(ngModel)]="csvUseAiMapping" />
                <span>{{ 'PRODUCTS.BULK_IMPORT_CSV_AI_MAPPING' | translate }}</span>
              </label>
            }
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" (click)="closed.emit()">{{ 'COMMON.CANCEL' | translate }}</button>
              <button type="button" class="btn btn-primary" (click)="loadCsvPreview()" [disabled]="loading()">
                {{ loading() ? ('COMMON.LOADING' | translate) : ('PRODUCTS.BULK_IMPORT_PREVIEW' | translate) }}
              </button>
            </div>
          } @else {
            <div class="privacy-notice" role="note">
              <strong>{{ 'PRODUCTS.BULK_IMPORT_PRIVACY_TITLE' | translate }}</strong>
              <p>{{ 'PRODUCTS.BULK_IMPORT_PRIVACY_BODY' | translate }}</p>
            </div>
            @if (!visionConfigured()) {
              <p class="field-hint">{{ 'PRODUCTS.BULK_IMPORT_VISION_UNAVAILABLE' | translate }}</p>
            } @else {
              <div class="form-group">
                <label for="bulk-menu-photo">{{ 'PRODUCTS.BULK_IMPORT_MENU_PHOTO' | translate }}</label>
                <input id="bulk-menu-photo" type="file" accept="image/jpeg,image/png,image/webp,image/avif" (change)="onVisionFileSelected($event)" />
                @if (visionFileName()) {
                  <span class="pending-file-name">{{ visionFileName() }}</span>
                }
              </div>
              <div class="modal-actions">
                <button type="button" class="btn btn-secondary" (click)="closed.emit()">{{ 'COMMON.CANCEL' | translate }}</button>
                <button type="button" class="btn btn-primary" (click)="loadVisionPreview()" [disabled]="loading() || !visionFile()">
                  {{ loading() ? ('COMMON.LOADING' | translate) : ('PRODUCTS.BULK_IMPORT_EXTRACT_PREVIEW' | translate) }}
                </button>
              </div>
            }
          }
        } @else {
          <div class="preview-summary">
            {{ 'PRODUCTS.BULK_IMPORT_SUMMARY' | translate: summaryParams() }}
          </div>
          <p class="field-hint">{{ 'PRODUCTS.BULK_IMPORT_REVIEW_HINT' | translate }}</p>

          <div class="table-card bulk-preview-table">
            <div class="products-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{{ 'PRODUCTS.NAME_HEADER' | translate }}</th>
                    <th>{{ 'PRODUCTS.PRICE_HEADER' | translate }}</th>
                    <th>{{ 'PRODUCTS.CATEGORY_HEADER' | translate }}</th>
                    <th>{{ 'PRODUCTS.SUBCATEGORY_HEADER' | translate }}</th>
                    <th>{{ 'PRODUCTS.BULK_IMPORT_ACTION' | translate }}</th>
                    <th>{{ 'PRODUCTS.BULK_IMPORT_STATUS' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of previewRows(); track row.row_index) {
                    <tr [class.row-invalid]="!row.valid">
                      <td>{{ row.row_index + 1 }}</td>
                      <td>
                        <input type="text" class="inline-input" [(ngModel)]="row.name" (ngModelChange)="revalidateRow(row)" />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          class="inline-input inline-input-sm"
                          [ngModel]="rowPriceMajor(row)"
                          (ngModelChange)="setRowPriceMajor(row, $event)"
                        />
                      </td>
                      <td>
                        <select
                          class="inline-input inline-select"
                          [(ngModel)]="row.category"
                          (ngModelChange)="onRowCategoryChange(row)"
                        >
                          <option value=""></option>
                          @for (category of categoryOptionsForRow(row); track category) {
                            <option [value]="category">{{ getCategoryLabel(category) }}</option>
                          }
                        </select>
                      </td>
                      <td>
                        <select
                          class="inline-input inline-select"
                          [(ngModel)]="row.subcategory"
                          (ngModelChange)="revalidateRow(row)"
                          [disabled]="!row.category || subcategoryOptionsForRow(row).length === 0"
                        >
                          <option value=""></option>
                          @for (subcat of subcategoryOptionsForRow(row); track subcat) {
                            <option [value]="subcat">{{ getSubcategoryLabel(subcat) }}</option>
                          }
                        </select>
                      </td>
                      <td>
                        <span class="action-badge" [class.action-update]="row.action === 'update'">
                          {{
                            row.action === 'update'
                              ? ('PRODUCTS.BULK_IMPORT_ACTION_UPDATE' | translate)
                              : ('PRODUCTS.BULK_IMPORT_ACTION_CREATE' | translate)
                          }}
                        </span>
                      </td>
                      <td>
                        @if (row.valid) {
                          <span class="status-ok">{{ 'PRODUCTS.BULK_IMPORT_ROW_OK' | translate }}</span>
                        } @else {
                          <span class="status-error">{{ rowErrorLabel(row) }}</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" (click)="backToSource()" [disabled]="confirming()">
              {{ 'COMMON.BACK' | translate }}
            </button>
            <button type="button" class="btn btn-secondary" (click)="closed.emit()" [disabled]="confirming()">
              {{ 'COMMON.CANCEL' | translate }}
            </button>
            <button
              type="button"
              class="btn btn-primary"
              (click)="confirmImport()"
              [disabled]="confirming() || validRowCount() === 0"
            >
              {{
                confirming()
                  ? ('PRODUCTS.BULK_IMPORT_CONFIRMING' | translate)
                  : ('PRODUCTS.BULK_IMPORT_CONFIRM' | translate:{ count: validRowCount() })
              }}
            </button>
          </div>
        }
      </div>
    </div>
  `,
  styleUrl: './product-bulk-import.component.scss',
})
export class ProductBulkImportComponent implements OnInit {
  private api = inject(ApiService);
  private translate = inject(TranslateService);

  /** Tenant menu categories → subcategories (same map as Products page). */
  categories = input<Record<string, string[]>>({});

  closed = output<void>();
  imported = output<ProductBulkImportConfirmResult>();

  step = signal<'source' | 'preview'>('source');
  source = signal<ImportSource>('json');
  loading = signal(false);
  confirming = signal(false);
  error = signal('');
  visionConfigured = signal(false);
  visionFile = signal<File | null>(null);
  visionFileName = signal('');
  previewRows = signal<ProductBulkImportPreviewRow[]>([]);
  summaryParams = signal<Record<string, number>>({ total: 0, valid: 0, invalid: 0, create: 0, update: 0 });

  jsonText = '';
  csvText = '';
  csvUseAiMapping = false;

  ngOnInit() {
    this.api.getProductBulkImportVisionStatus().subscribe({
      next: (s) => this.visionConfigured.set(!!s.configured),
      error: () => this.visionConfigured.set(false),
    });
  }

  onBackdropClick() {
    if (!this.loading() && !this.confirming()) {
      this.closed.emit();
    }
  }

  onJsonFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.jsonText = String(reader.result || '');
    };
    reader.readAsText(file);
    (event.target as HTMLInputElement).value = '';
  }

  onCsvFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.csvText = String(reader.result || '');
    };
    reader.readAsText(file);
    (event.target as HTMLInputElement).value = '';
  }

  onVisionFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    this.visionFile.set(file || null);
    this.visionFileName.set(file?.name || '');
    (event.target as HTMLInputElement).value = '';
  }

  loadJsonPreview() {
    const raw = this.jsonText.trim();
    if (!raw) {
      this.error.set(this.translate.instant('PRODUCTS.BULK_IMPORT_JSON_EMPTY'));
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      this.error.set(this.translate.instant('PRODUCTS.BULK_IMPORT_JSON_INVALID'));
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.api.previewProductBulkImportJson(payload).subscribe({
      next: (res) => this.applyPreview(res),
      error: (err) => {
        this.error.set(this.mapError(err));
        this.loading.set(false);
      },
    });
  }

  loadCsvPreview() {
    const raw = this.csvText.trim();
    if (!raw) {
      this.error.set(this.translate.instant('PRODUCTS.BULK_IMPORT_CSV_EMPTY'));
      return;
    }
    this.loading.set(true);
    this.error.set('');
    const useAi = this.csvUseAiMapping && this.visionConfigured();
    this.api.previewProductBulkImportCsv(raw, useAi).subscribe({
      next: (res) => this.applyPreview(res),
      error: (err) => {
        this.error.set(this.mapError(err));
        this.loading.set(false);
      },
    });
  }

  loadVisionPreview() {
    const file = this.visionFile();
    if (!file) return;
    this.loading.set(true);
    this.error.set('');
    this.api.previewProductBulkImportVision(file).subscribe({
      next: (res) => this.applyPreview(res),
      error: (err) => {
        this.error.set(this.mapError(err));
        this.loading.set(false);
      },
    });
  }

  private applyPreview(res: ProductBulkImportPreviewResponse) {
    this.previewRows.set(res.items.map((r) => ({ ...r })));
    this.summaryParams.set({
      total: res.summary.total,
      valid: res.summary.valid,
      invalid: res.summary.invalid,
      create: res.summary.create,
      update: res.summary.update,
    });
    this.step.set('preview');
    this.loading.set(false);
  }

  backToSource() {
    this.step.set('source');
    this.previewRows.set([]);
    this.error.set('');
  }

  rowPriceMajor(row: ProductBulkImportPreviewRow): number | null {
    if (row.price_cents == null) return null;
    return row.price_cents / 100;
  }

  setRowPriceMajor(row: ProductBulkImportPreviewRow, value: number | string | null) {
    const num = value === '' || value == null ? null : Number(value);
    row.price_cents = num != null && !Number.isNaN(num) ? Math.round(num * 100) : null;
    this.revalidateRow(row);
  }

  getCategoryKeys(): string[] {
    return Object.keys(this.categories());
  }

  getCategoryLabel(category: string): string {
    return resolveCategoryLabel(category, this.translate);
  }

  getSubcategoryLabel(subcategory: string): string {
    return resolveSubcategoryLabel(subcategory, this.translate);
  }

  getSubcategoriesForCategory(category: string): string[] {
    return this.categories()[category] || [];
  }

  /** Keep imported category visible even when not in tenant catalog. */
  categoryOptionsForRow(row: ProductBulkImportPreviewRow): string[] {
    const keys = this.getCategoryKeys();
    const cat = (row.category || '').trim();
    if (cat && !keys.includes(cat)) {
      return [...keys, cat];
    }
    return keys;
  }

  /** Keep imported subcategory visible when still valid for the row category. */
  subcategoryOptionsForRow(row: ProductBulkImportPreviewRow): string[] {
    const subs = this.getSubcategoriesForCategory(row.category || '');
    const sub = (row.subcategory || '').trim();
    if (sub && !subs.includes(sub)) {
      return [...subs, sub];
    }
    return subs;
  }

  onRowCategoryChange(row: ProductBulkImportPreviewRow) {
    const category = (row.category || '').trim();
    row.category = category || null;
    if (!category) {
      row.subcategory = null;
    } else {
      const valid = this.getSubcategoriesForCategory(category);
      const sub = (row.subcategory || '').trim();
      if (sub && !valid.includes(sub)) {
        row.subcategory = null;
      }
    }
    this.revalidateRow(row);
  }

  revalidateRow(row: ProductBulkImportPreviewRow) {
    const errors: string[] = [];
    const name = (row.name || '').trim();
    if (!name) errors.push('name_required');
    if (row.price_cents == null || row.price_cents <= 0) errors.push('price_must_be_positive');
    if (row.cost_cents != null && row.cost_cents < 0) errors.push('cost_must_be_non_negative');
    row.valid = errors.length === 0;
    row.errors = errors;
    row.action = row.valid ? (row.existing_product_id ? 'update' : 'create') : 'skip';
    row.name = name;
    this.refreshSummary();
  }

  private refreshSummary() {
    const rows = this.previewRows();
    const valid = rows.filter((r) => r.valid);
    this.summaryParams.set({
      total: rows.length,
      valid: valid.length,
      invalid: rows.length - valid.length,
      create: valid.filter((r) => r.action === 'create').length,
      update: valid.filter((r) => r.action === 'update').length,
    });
  }

  validRowCount(): number {
    return this.previewRows().filter((r) => r.valid).length;
  }

  rowErrorLabel(row: ProductBulkImportPreviewRow): string {
    const key = row.errors[0];
    if (!key) return this.translate.instant('PRODUCTS.BULK_IMPORT_ROW_INVALID');
    const map: Record<string, string> = {
      name_required: 'PRODUCTS.NAME_REQUIRED',
      price_required: 'PRODUCTS.PRICE_REQUIRED',
      price_must_be_positive: 'PRODUCTS.PRICE_REQUIRED',
      cost_must_be_non_negative: 'PRODUCTS.BULK_IMPORT_COST_INVALID',
    };
    return this.translate.instant(map[key] || 'PRODUCTS.BULK_IMPORT_ROW_INVALID');
  }

  confirmImport() {
    const rows = this.previewRows().filter((r) => r.valid);
    if (rows.length === 0) return;
    this.confirming.set(true);
    this.error.set('');
    this.api.confirmProductBulkImport(rows).subscribe({
      next: (result) => {
        this.confirming.set(false);
        this.imported.emit(result);
      },
      error: (err) => {
        this.error.set(this.mapError(err));
        this.confirming.set(false);
      },
    });
  }

  private mapError(err: { error?: { detail?: string } }): string {
    const detail = err.error?.detail;
    if (!detail) return this.translate.instant('COMMON.API_REQUEST_FAILED');
    const code = String(detail);
    if (code.startsWith('unknown_csv_columns:')) {
      const cols = code.slice('unknown_csv_columns:'.length);
      return this.translate.instant('API_ERRORS.UNKNOWN_CSV_COLUMNS', { columns: cols });
    }
    if (code.startsWith('unmapped_csv_columns:')) {
      const cols = code.slice('unmapped_csv_columns:'.length);
      return this.translate.instant('API_ERRORS.UNMAPPED_CSV_COLUMNS', { columns: cols });
    }
    const key = `API_ERRORS.${code.toUpperCase()}`;
    const translated = this.translate.instant(key);
    return translated !== key ? translated : code;
  }
}
