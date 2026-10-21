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
const HUES = [12, 18, 24, 30, 36, 42, 48];

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
                  <span class="pp-add" aria-hidden="true">+</span>
                </button>
              }
            </div>
          }
        </main>

        <aside class="pp-ticket">
          <div class=\"pp-ticket-head\">
            <div>
              <p class=\"pp-eyebrow\"><i></i>{{ 'MENU.YOUR_ORDER_EYEBROW' | translate }}</p>
              <h3>{{ 'QUICK_SALE.TICKET' | translate }}</h3>
            </div>
            @if (cart().length > 0) { <span class=\"pp-count\">{{ cart().length }}</span> }
          </div>
          @if (cart().length === 0) {
            <div class="pp-ticket-empty"><span class="pp-empty-ico" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg></span><p>{{ 'QUICK_SALE.TICKET_EMPTY' | translate }}</p></div>
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
    /* ===== v2: warm, ticket-style point of sale ===== */
    .pp-overlay { background: radial-gradient(120% 80% at 100% 0, rgba(232, 154, 82, 0.10), transparent 55%), #faf6f1; }
    .pp-top { gap: 1rem; padding: 0.75rem 1.25rem; background: #fff; border-bottom: 0; box-shadow: 0 12px 24px -22px rgba(23, 18, 16, 0.5); position: relative; z-index: 2; }
    .pp-top h2 { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 500; font-size: 1.5rem; letter-spacing: -0.02em; }
    .pp-search { min-height: 50px; padding: 0 1.1rem; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--color-primary, #c2612c) 4%, #fff); box-shadow: inset 0 0 0 1.5px var(--color-border, #e5e7eb); transition: box-shadow 0.2s, background 0.2s; }
    .pp-search svg { color: var(--color-primary, #c2612c); }
    .pp-search:focus-within { background: #fff; border: 0; box-shadow: inset 0 0 0 2px var(--color-primary, #c2612c), 0 0 0 5px color-mix(in srgb, var(--color-primary, #c2612c) 14%, transparent); }
    .pp-clear { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: color-mix(in srgb, var(--color-primary, #c2612c) 10%, #fff); color: var(--color-primary, #c2612c); font-size: 1.1rem; }
    .pp-close { width: 46px; height: 46px; border: 0; border-radius: 50%; background: #fff; box-shadow: inset 0 0 0 1.5px var(--color-border, #e5e7eb); transition: transform 0.15s, box-shadow 0.2s; }
    .pp-close:hover { box-shadow: inset 0 0 0 2px var(--color-primary, #c2612c); }
    .pp-close:active { transform: scale(0.92); }

    .pp-body { grid-template-columns: 14rem minmax(0, 1fr) 23rem; }
    .pp-cats { gap: 0.4rem; padding: 1rem 0.85rem; background: transparent; border: 0; }
    .pp-cats button { min-height: 52px; padding: 0 0.6rem 0 1rem; border-radius: 18px; font-weight: 600; background: transparent; transition: background 0.2s, box-shadow 0.2s, transform 0.15s; }
    .pp-cats button:hover { background: #fff; box-shadow: 0 10px 18px -14px rgba(23, 18, 16, 0.5); }
    .pp-cats button:active { transform: scale(0.98); }
    .pp-cats button small { display: grid; place-items: center; min-width: 30px; height: 30px; padding: 0 8px; border-radius: 15px; font-family: Georgia, serif; font-style: italic; font-size: 0.9rem; color: var(--color-primary, #c2612c); background: color-mix(in srgb, var(--color-primary, #c2612c) 10%, #fff); }
    .pp-cats button.active { color: #fff; background: linear-gradient(135deg, var(--color-primary, #c2612c), color-mix(in srgb, var(--color-primary, #c2612c) 62%, #000)); box-shadow: 0 16px 24px -14px var(--color-primary, #c2612c); }
    .pp-cats button.active small { color: var(--color-primary, #c2612c); background: #fff; }

    .pp-products { padding: 1.1rem 1.25rem 2rem; }
    .pp-found { font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.7rem; }
    .pp-grid { grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr)); gap: 1rem; }
    .pp-tile { gap: 0.4rem; padding: 0.55rem 0.55rem 0.8rem; border: 0; border-radius: 24px; background: #fff; box-shadow: 0 18px 30px -24px rgba(23, 18, 16, 0.5), 0 0 0 1px rgba(193, 90, 30, 0.1); transition: transform 0.2s, box-shadow 0.2s; }
    .pp-tile:hover { transform: translateY(-3px); box-shadow: 0 26px 36px -22px rgba(23, 18, 16, 0.55), 0 0 0 1.5px color-mix(in srgb, var(--color-primary, #c2612c) 45%, transparent); }
    .pp-tile:active { transform: scale(0.97); }
    .pp-tile.in-cart { box-shadow: 0 22px 34px -22px var(--color-primary, #c2612c), 0 0 0 2.5px var(--color-primary, #c2612c); }
    .pp-thumb { border-radius: 18px; aspect-ratio: 4 / 3; background: linear-gradient(145deg, hsl(var(--hue, 30) 85% 66%), hsl(var(--hue, 30) 70% 42%)); color: rgba(255, 255, 255, 0.95); }
    .pp-thumb b { font-family: Georgia, serif; font-style: italic; font-weight: 500; font-size: 2.6rem; text-shadow: 0 4px 10px rgba(0, 0, 0, 0.25); }
    .pp-tile-name { padding-inline: 0.35rem; font-family: Georgia, 'Times New Roman', serif; font-size: 1rem; font-weight: 500; line-height: 1.2; min-height: 2.4em; }
    .pp-tile-price { padding-inline: 0.35rem; font-family: Georgia, serif; font-style: italic; font-weight: 600; font-size: 1.15rem; }
    .pp-add { position: absolute; right: 0.9rem; bottom: 0.7rem; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; font-size: 1.25rem; font-weight: 700; line-height: 1; color: #fff; background: linear-gradient(145deg, var(--color-primary, #c2612c), color-mix(in srgb, var(--color-primary, #c2612c) 62%, #000)); box-shadow: 0 10px 16px -8px var(--color-primary, #c2612c); transition: transform 0.2s; }
    .pp-tile:hover .pp-add { transform: scale(1.12) rotate(90deg); }
    .pp-badge { top: 1rem; inset-inline-end: 1rem; min-width: 30px; height: 30px; font-family: Georgia, serif; font-style: italic; font-size: 0.95rem; color: var(--color-primary, #c2612c); background: #fff; box-shadow: 0 8px 14px -6px rgba(0, 0, 0, 0.45); animation: pp-pop 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.4); }
    @keyframes pp-pop { from { transform: scale(0.4); opacity: 0; } }

    .pp-ticket { gap: 0.6rem; padding: 1.25rem 1.1rem; margin: 0.75rem 0.75rem 0.75rem 0; border: 0; border-radius: 28px; background: #fff; box-shadow: 0 24px 44px -28px rgba(23, 18, 16, 0.5), 0 0 0 1px rgba(193, 90, 30, 0.12); }
    .pp-ticket-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 0.5rem; }
    .pp-ticket h3 { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 500; font-size: 1.7rem; letter-spacing: -0.02em; line-height: 1; }
    .pp-eyebrow { margin: 0 0 4px; display: flex; align-items: center; gap: 8px; font-size: 0.6rem; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; color: var(--color-primary, #c2612c); }
    .pp-eyebrow i { width: 16px; height: 1.5px; background: currentColor; }
    .pp-count { display: grid; place-items: center; min-width: 30px; height: 30px; padding: 0 9px; border-radius: 15px; font-family: Georgia, serif; font-style: italic; font-weight: 700; color: var(--color-primary, #c2612c); background: color-mix(in srgb, var(--color-primary, #c2612c) 12%, #fff); }
    .pp-ticket-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; border-radius: 22px; border: 1.5px dashed color-mix(in srgb, var(--color-primary, #c2612c) 35%, var(--color-border, #e5e7eb)); background: color-mix(in srgb, var(--color-primary, #c2612c) 3%, #fff); padding: 1.5rem; }
    .pp-ticket-empty p { margin: 0; max-width: 18ch; font-family: Georgia, serif; font-style: italic; font-size: 1.05rem; color: var(--color-text-muted, #6b7280); }
    .pp-empty-ico { display: grid; place-items: center; width: 58px; height: 58px; border-radius: 20px; color: #fff; background: linear-gradient(145deg, var(--color-primary, #c2612c), color-mix(in srgb, var(--color-primary, #c2612c) 60%, #000)); box-shadow: 0 14px 22px -12px var(--color-primary, #c2612c); transform: rotate(-4deg); }
    .pp-lines { gap: 0.5rem; }
    .pp-lines li { grid-template-columns: 1fr auto; row-gap: 6px; padding: 10px 12px; border-radius: 18px; background: color-mix(in srgb, var(--color-primary, #c2612c) 4%, #fff); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary, #c2612c) 10%, transparent); }
    .pp-line-name { grid-column: 1 / -1; white-space: normal; font-family: Georgia, serif; font-size: 1rem; line-height: 1.2; }
    .pp-line-price { min-width: 0; font-weight: 800; letter-spacing: -0.01em; }
    .pp-stepper { gap: 2px; padding: 3px; border-radius: 999px; background: #fff; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary, #c2612c) 18%, transparent); }
    .pp-stepper button { width: 30px; height: 30px; border: 0; border-radius: 50%; color: var(--color-primary, #c2612c); background: #fff; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-primary, #c2612c) 30%, transparent); transition: transform 0.15s; }
    .pp-stepper button:last-child { color: #fff; background: linear-gradient(145deg, var(--color-primary, #c2612c), color-mix(in srgb, var(--color-primary, #c2612c) 62%, #000)); box-shadow: 0 6px 10px -5px var(--color-primary, #c2612c); }
    .pp-stepper button:active { transform: scale(0.88); }
    .pp-stepper b { min-width: 28px; font-family: Georgia, serif; font-style: italic; }
    .pp-checkout { gap: 0.7rem; padding-top: 0.9rem; border-top: 1.5px dashed var(--color-border, #e5e7eb); }
    .pp-total span { font-size: 0.66rem; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-text-muted, #6b7280); }
    .pp-total strong { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 500; font-size: 2.1rem; letter-spacing: -0.02em; color: var(--color-primary, #c2612c); }
    .pp-actions { gap: 0.6rem; }
    .pp-actions .btn-secondary { min-height: 52px; padding: 0 1rem; border: 0; border-radius: 999px; font-weight: 700; color: #b91c1c; background: #fef2f2; }
    .pp-actions .btn-secondary:disabled { opacity: 0.45; }
    .pp-confirm, .pp-charge { min-height: 52px; border: 0; border-radius: 999px; font-weight: 800; color: #fff; background: linear-gradient(135deg, var(--color-primary, #c2612c), color-mix(in srgb, var(--color-primary, #c2612c) 60%, #000)); box-shadow: 0 16px 24px -14px var(--color-primary, #c2612c); transition: transform 0.15s; }
    .pp-confirm:active, .pp-charge:active { transform: scale(0.97); }
    .pp-confirm:disabled, .pp-charge:disabled { opacity: 0.5; box-shadow: none; }
    .pp-customer { min-height: 46px; padding: 0 1rem; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--color-primary, #c2612c) 4%, #fff); box-shadow: inset 0 0 0 1.5px var(--color-border, #e5e7eb); outline: none; transition: box-shadow 0.2s; }
    .pp-customer:focus { box-shadow: inset 0 0 0 2px var(--color-primary, #c2612c), 0 0 0 4px color-mix(in srgb, var(--color-primary, #c2612c) 14%, transparent); }
    .pp-pay { gap: 0.5rem; }
    .pp-pay button { min-height: 62px; border: 0; border-radius: 20px; background: #fff; box-shadow: inset 0 0 0 1.5px var(--color-border, #e5e7eb); }
    .pp-pay button:hover { box-shadow: inset 0 0 0 2px var(--color-primary, #c2612c); }
    .pp-pay button.active { color: #fff; background: linear-gradient(135deg, var(--color-primary, #c2612c), color-mix(in srgb, var(--color-primary, #c2612c) 60%, #000)); box-shadow: 0 14px 22px -12px var(--color-primary, #c2612c); }
    @media (max-width: 900px) {
      .pp-cats { flex-direction: row; padding: 0.75rem 1rem; }
      .pp-cats button { min-height: 44px; border-radius: 999px; }
      .pp-ticket { margin: 0 0.75rem 0.75rem; max-height: 45vh; }
    }
    .pp-stepper { justify-self: start; align-self: center; }
    @media (prefers-reduced-motion: reduce) { .pp-badge { animation: none; } .pp-tile, .pp-add { transition: none; } }

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
