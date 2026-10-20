import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { getCategoryLabel } from '../shared/product-category-label.util';

export interface PickerProduct {
  id: number;
  name: string;
  price_cents: number;
  category?: string | null;
  image_url?: string | null;
}

export interface PickedLine {
  product_id: number;
  name: string;
  price_cents: number;
  quantity: number;
}

const ALL = '__all__';
const NONE = '__none__';
const HUES = [14, 32, 48, 98, 150, 186, 212, 262, 300, 340];

/**
 * Full-screen product picker (same look as "Nueva venta" in Venta en barra):
 * categories on the left, searchable product tiles in the middle, ticket on the right.
 * Emits the chosen lines; the parent decides what to do with them.
 */
@Component({
  selector: 'app-product-picker',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  template: `
    <div class="pp-overlay" role="dialog" aria-modal="true" [attr.aria-label]="title()" (keydown.escape)="closed.emit()">
      <header class="pp-top">
        <h2>{{ title() }}</h2>
        <div class="pp-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            #searchBox
            type="search"
            autofocus
            [ngModel]="search()"
            (ngModelChange)="search.set($event)"
            (keydown.enter)="addFirstMatch()"
            [placeholder]="'QUICK_SALE.SEARCH_PH' | translate"
            [attr.aria-label]="'QUICK_SALE.SEARCH_PH' | translate"
          />
          @if (search()) {
            <button type="button" class="pp-clear" (click)="search.set(''); searchBox.focus()" aria-label="×">×</button>
          }
        </div>
        <button type="button" class="pp-close" (click)="closed.emit()" [attr.aria-label]="'COMMON.CLOSE' | translate">✕</button>
      </header>

      <div class="pp-body">
        <nav class="pp-cats" [attr.aria-label]="'QUICK_SALE.CATEGORIES' | translate">
          <button type="button" [class.active]="activeCategory() === ALL" (click)="selectCategory(ALL)">
            <span>{{ 'QUICK_SALE.ALL' | translate }}</span><small>{{ products().length }}</small>
          </button>
          @for (c of categories(); track c.key) {
            <button type="button" [class.active]="activeCategory() === c.key" (click)="selectCategory(c.key)">
              <span>{{ c.label }}</span><small>{{ c.count }}</small>
            </button>
          }
        </nav>

        <main class="pp-products">
          @if (search()) {
            <p class="pp-found">{{ filtered().length }} {{ 'QUICK_SALE.RESULTS' | translate }}</p>
          }
          @if (filtered().length === 0) {
            <p class="pp-empty">{{ 'QUICK_SALE.NO_RESULTS' | translate }}</p>
          } @else {
            <div class="pp-grid">
              @for (p of filtered(); track p.id) {
                <button type="button" class="pp-tile" [class.in-cart]="qtyInCart(p.id) > 0" (click)="add(p)">
                  <span class="pp-thumb" [style.--hue]="hue(p.category)">
                    @if (p.image_url) {
                      <img [src]="p.image_url" alt="" loading="lazy" />
                    } @else {
                      <b>{{ initial(p.name) }}</b>
                    }
                  </span>
                  @if (qtyInCart(p.id) > 0) {
                    <span class="pp-badge">{{ qtyInCart(p.id) }}</span>
                  }
                  <span class="pp-tile-name">{{ p.name }}</span>
                  <span class="pp-tile-price">{{ formatPrice(p.price_cents) }}</span>
                </button>
              }
            </div>
          }
        </main>

        <aside class="pp-ticket">
          <h3>{{ 'QUICK_SALE.TICKET' | translate }}</h3>
          @if (cart().length === 0) {
            <p class="pp-empty">{{ 'QUICK_SALE.TICKET_EMPTY' | translate }}</p>
          } @else {
            <ul class="pp-lines">
              @for (line of cart(); track line.product_id) {
                <li>
                  <span class="pp-line-name">{{ line.name }}</span>
                  <span class="pp-stepper">
                    <button type="button" (click)="changeQty(line.product_id, -1)" aria-label="−">−</button>
                    <b>{{ line.quantity }}</b>
                    <button type="button" (click)="changeQty(line.product_id, 1)" aria-label="+">+</button>
                  </span>
                  <span class="pp-line-price">{{ formatPrice(line.price_cents * line.quantity) }}</span>
                </li>
              }
            </ul>
          }
          <div class="pp-checkout">
            <div class="pp-total">
              <span>{{ 'QUICK_SALE.TOTAL' | translate }}</span>
              <strong>{{ formatPrice(total()) }}</strong>
            </div>
            <div class="pp-actions">
              <button type="button" class="btn btn-secondary btn-sm" [disabled]="cart().length === 0" (click)="cart.set([])">
                {{ 'QUICK_SALE.CLEAR' | translate }}
              </button>
              <button type="button" class="btn btn-primary pp-confirm" [disabled]="cart().length === 0 || busy()" (click)="confirmed.emit(cart())">
                {{ confirmLabel() }}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `,
  styles: `
    .pp-overlay {
      position: fixed; inset: 0; z-index: 1300; display: flex; flex-direction: column;
      background: var(--color-bg, #f3f4f6); color: var(--color-text, #111827);
    }
    .pp-top {
      display: flex; align-items: center; gap: 1rem; padding: 0.625rem 1rem;
      background: var(--color-surface, #fff); border-bottom: 1px solid var(--color-border, #e5e7eb);
    }
    .pp-top h2 { margin: 0; font-size: 1.0625rem; font-weight: 600; white-space: nowrap; }
    .pp-search {
      flex: 1; display: flex; align-items: center; gap: 0.5rem; max-width: 40rem; min-height: 46px; padding: 0 0.875rem;
      border: 1px solid var(--color-border, #d1d5db); border-radius: 12px; background: var(--color-bg, #f9fafb);
      color: var(--color-text-muted, #6b7280);
    }
    .pp-search:focus-within { border-color: var(--color-primary, #c2612c); box-shadow: 0 0 0 3px var(--color-primary-light, #fbe9df); }
    .pp-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font: inherit; font-size: 1rem; color: var(--color-text, #111827); }
    .pp-clear { border: none; background: none; font-size: 1.375rem; line-height: 1; cursor: pointer; color: inherit; }
    .pp-close {
      margin-inline-start: auto; width: 44px; height: 44px; border: 1px solid var(--color-border, #d1d5db);
      border-radius: 10px; background: var(--color-surface, #fff); color: inherit; font-size: 1.125rem; cursor: pointer;
    }
    .pp-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 12.5rem minmax(0, 1fr) 21rem; }
    .pp-cats {
      display: flex; flex-direction: column; gap: 0.25rem; padding: 0.75rem; overflow-y: auto;
      background: var(--color-surface, #fff); border-inline-end: 1px solid var(--color-border, #e5e7eb);
    }
    .pp-cats button {
      display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; min-height: 46px; padding: 0 0.75rem;
      border: none; border-radius: 10px; background: transparent; color: var(--color-text, #111827);
      font: inherit; font-size: 0.9375rem; text-align: start; cursor: pointer;
    }
    .pp-cats button small { color: var(--color-text-muted, #6b7280); font-variant-numeric: tabular-nums; }
    .pp-cats button:hover { background: var(--color-bg, #f3f4f6); }
    .pp-cats button.active { background: var(--color-primary, #c2612c); color: #fff; font-weight: 600; }
    .pp-cats button.active small { color: rgba(255, 255, 255, 0.85); }
    .pp-products { overflow-y: auto; padding: 1rem; }
    .pp-found { margin: 0 0 0.75rem; font-size: 0.8125rem; color: var(--color-text-muted, #6b7280); }
    .pp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 0.75rem; }
    .pp-tile {
      position: relative; display: flex; flex-direction: column; gap: 0.25rem; padding: 0.5rem 0.5rem 0.625rem; text-align: start;
      border: 2px solid transparent; border-radius: 14px; background: var(--color-surface, #fff); color: inherit; font: inherit;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); cursor: pointer; transition: transform 0.08s, box-shadow 0.12s, border-color 0.12s;
    }
    .pp-tile:hover { box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12); }
    .pp-tile:active { transform: scale(0.97); }
    .pp-tile.in-cart { border-color: var(--color-primary, #c2612c); }
    .pp-thumb {
      display: flex; align-items: center; justify-content: center; aspect-ratio: 4 / 3; overflow: hidden; border-radius: 10px;
      background: hsl(var(--hue, 30) 70% 90%); color: hsl(var(--hue, 30) 55% 32%);
    }
    .pp-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .pp-thumb b { font-size: 2rem; font-weight: 700; }
    .pp-tile-name {
      padding-inline: 0.25rem; font-size: 0.875rem; font-weight: 500; line-height: 1.25; min-height: 2.5em;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .pp-tile-price { padding-inline: 0.25rem; font-weight: 700; color: var(--color-primary, #c2612c); font-variant-numeric: tabular-nums; }
    .pp-badge {
      position: absolute; top: 0.25rem; inset-inline-end: 0.25rem; min-width: 26px; height: 26px; padding: 0 7px;
      display: inline-flex; align-items: center; justify-content: center; border-radius: 999px;
      background: var(--color-primary, #c2612c); color: #fff; font-size: 0.8125rem; font-weight: 700; box-shadow: 0 1px 4px rgba(0,0,0,.3);
    }
    .pp-empty { margin: 0.75rem 0; font-size: 0.9375rem; color: var(--color-text-muted, #6b7280); }
    .pp-ticket {
      display: flex; flex-direction: column; min-height: 0; padding: 1rem; gap: 0.5rem;
      background: var(--color-surface, #fff); border-inline-start: 1px solid var(--color-border, #e5e7eb);
    }
    .pp-ticket h3 { margin: 0; font-size: 1rem; font-weight: 600; }
    .pp-ticket .pp-empty { flex: 1; }
    .pp-lines { flex: 1; min-height: 0; list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.625rem; overflow-y: auto; }
    .pp-lines li { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 0.5rem; font-size: 0.9375rem; }
    .pp-line-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pp-line-price { min-width: 5rem; text-align: end; font-variant-numeric: tabular-nums; font-weight: 600; }
    .pp-stepper { display: inline-flex; align-items: center; gap: 0.25rem; }
    .pp-stepper button {
      width: 32px; height: 32px; border: 1px solid var(--color-border, #d1d5db); border-radius: 8px;
      background: var(--color-surface, #fff); color: inherit; font-size: 1.125rem; line-height: 1; cursor: pointer;
    }
    .pp-stepper b { min-width: 1.5rem; text-align: center; font-variant-numeric: tabular-nums; }
    .pp-checkout { display: flex; flex-direction: column; gap: 0.625rem; padding-top: 0.75rem; border-top: 1px dashed var(--color-border, #d1d5db); }
    .pp-total { display: flex; justify-content: space-between; align-items: baseline; }
    .pp-total strong { font-size: 1.75rem; font-variant-numeric: tabular-nums; }
    .pp-actions { display: flex; gap: 0.5rem; }
    .pp-confirm { flex: 1; min-height: 52px; font-size: 1.0625rem; font-weight: 700; }
    @media (max-width: 900px) {
      .pp-body { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr) auto; }
      .pp-cats { flex-direction: row; overflow-x: auto; overflow-y: hidden; border-inline-end: none; border-bottom: 1px solid var(--color-border, #e5e7eb); }
      .pp-cats button { flex-shrink: 0; white-space: nowrap; min-height: 40px; }
      .pp-ticket { max-height: 45vh; border-inline-start: none; border-top: 1px solid var(--color-border, #e5e7eb); }
      .pp-top h2 { display: none; }
    }
  `,
})
export class ProductPickerComponent {
  private readonly translate = inject(TranslateService);

  readonly products = input.required<PickerProduct[]>();
  readonly title = input('');
  readonly confirmLabel = input('');
  readonly busy = input(false);
  readonly confirmed = output<PickedLine[]>();
  readonly closed = output<void>();

  readonly ALL = ALL;
  readonly search = signal('');
  readonly activeCategory = signal<string>(ALL);
  readonly cart = signal<PickedLine[]>([]);

  readonly total = computed(() => this.cart().reduce((sum, l) => sum + l.price_cents * l.quantity, 0));

  readonly categories = computed(() => {
    const counts = new Map<string, number>();
    for (const p of this.products()) {
      const k = p.category || NONE;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({
        key,
        count,
        label: key === NONE ? this.translate.instant('QUICK_SALE.OTHER') : getCategoryLabel(key, this.translate),
      }))
      .sort((a, b) => (a.key === NONE ? 1 : b.key === NONE ? -1 : a.label.localeCompare(b.label, 'es')));
  });

  /** Searching looks through every category; otherwise the selected category is shown. */
  readonly filtered = computed(() => {
    const q = this.normalize(this.search());
    const cat = this.activeCategory();
    return this.products()
      .filter((p) => {
        if (q) return this.normalize(p.name).includes(q);
        return cat === ALL || (p.category || NONE) === cat;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  });

  selectCategory(key: string): void {
    this.activeCategory.set(key);
    this.search.set('');
  }

  /** COP with thousands dots, e.g. "$ 12.500" (cents are pesos x 100). */
  formatPrice(cents: number): string {
    return `$ ${(cents / 100).toLocaleString('es-CO', {
      maximumFractionDigits: 0,
      useGrouping: 'always',
    } as unknown as Intl.NumberFormatOptions)}`;
  }

  hue(category?: string | null): number {
    const s = category || '';
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return HUES[h % HUES.length];
  }

  initial(name: string): string {
    return (name.trim()[0] || '?').toUpperCase();
  }

  qtyInCart(productId: number): number {
    return this.cart().find((l) => l.product_id === productId)?.quantity ?? 0;
  }

  add(product: PickerProduct): void {
    this.cart.update((lines) => {
      if (lines.some((l) => l.product_id === product.id)) {
        return lines.map((l) => (l.product_id === product.id ? { ...l, quantity: Math.min(99, l.quantity + 1) } : l));
      }
      return [...lines, { product_id: product.id, name: product.name, price_cents: product.price_cents, quantity: 1 }];
    });
  }

  /** Enter in the search box adds the first match and clears the search (fast keyboard flow). */
  addFirstMatch(): void {
    const first = this.filtered()[0];
    if (first) {
      this.add(first);
      this.search.set('');
    }
  }

  changeQty(productId: number, delta: number): void {
    this.cart.update((lines) =>
      lines
        .map((l) => (l.product_id === productId ? { ...l, quantity: Math.min(99, l.quantity + delta) } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  private normalize(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
}
