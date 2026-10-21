import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { OfflineOrderQueueService } from '../services/offline-order-queue.service';
import { PermissionService } from '../services/permission.service';
import { ApiService } from '../services/api.service';
import { getCategoryLabel } from '../shared/product-category-label.util';

interface QuickSaleLine {
  product_id: number;
  name: string;
  price_cents: number;
  quantity: number;
}

const ALL = '__all__';
const NONE = '__none__';
const HUES = [12, 18, 24, 30, 36, 42, 48];

/**
 * Quick sale for a walk-up customer at the bar/counter who does not want a table.
 * Reuses the "Take Away" virtual table so the order needs no real table assignment.
 *
 * Collapsed it is a slim bar; "Nueva venta" opens a full-screen point of sale:
 * categories on the left, searchable product tiles in the middle, ticket on the right.
 */
@Component({
  selector: 'app-quick-sale',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  template: `
    <section class="qs-bar">
      <div class="qs-bar-text">
        <h2>{{ 'QUICK_SALE.TITLE' | translate }}</h2>
        <p>{{ 'QUICK_SALE.HINT' | translate }}</p>
      </div>
      @if (hasCounterTable() && products().length > 0) {
        <button type="button" class="btn btn-primary qs-open" (click)="open()">
          @if (cart().length > 0) {
            {{ 'QUICK_SALE.CONTINUE' | translate }} · {{ cartCount() }} · {{ formatPrice(cartTotalCents()) }}
          } @else {
            + {{ 'QUICK_SALE.NEW' | translate }}
          }
        </button>
      }
      @if (!hasCounterTable()) {
        <p class="qs-error">{{ 'QUICK_SALE.NO_COUNTER_TABLE' | translate }}</p>
      } @else if (products().length === 0) {
        <p class="qs-error">{{ 'QUICK_SALE.NO_PRODUCTS' | translate }}</p>
        <button type="button" class="btn btn-secondary btn-sm" (click)="refreshProducts()">{{ 'QUICK_SALE.REFRESH' | translate }}</button>
      }
      @if (messageKey() && !isOpen()) {
        <p class="qs-msg" role="status">
          {{ messageKey()! | translate }}
          @if (lastOrderId()) { (#{{ lastOrderId() }}) }
        </p>
      }
    </section>

    @if (isOpen()) {
      <div class="qs-overlay" role="dialog" aria-modal="true" [attr.aria-label]="'QUICK_SALE.TITLE' | translate" (keydown.escape)="close()">
        <header class="qs-top">
          <h2>{{ 'QUICK_SALE.TITLE' | translate }}</h2>
          <div class="qs-search">
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
              <button type="button" class="qs-clear" (click)="search.set(''); searchBox.focus()" aria-label="×">×</button>
            }
          </div>
          <button type="button" class="qs-close" (click)="close()" [attr.aria-label]="'COMMON.CLOSE' | translate">✕</button>
        </header>

        <div class="qs-body">
          <nav class="qs-cats" [attr.aria-label]="'QUICK_SALE.CATEGORIES' | translate">
            <button type="button" [class.active]="activeCategory() === ALL" (click)="selectCategory(ALL)">
              <span>{{ 'QUICK_SALE.ALL' | translate }}</span><small>{{ products().length }}</small>
            </button>
            @for (c of categories(); track c.key) {
              <button type="button" [class.active]="activeCategory() === c.key" (click)="selectCategory(c.key)">
                <span>{{ c.label }}</span><small>{{ c.count }}</small>
              </button>
            }
          </nav>

          <main class="qs-products">
            @if (search()) {
              <p class="qs-found">{{ filtered().length }} {{ 'QUICK_SALE.RESULTS' | translate }}</p>
            }
            @if (filtered().length === 0) {
              <p class="qs-empty">{{ 'QUICK_SALE.NO_RESULTS' | translate }}</p>
            } @else {
              <div class="qs-grid">
                @for (p of filtered(); track p.id) {
                  <button type="button" class="qs-tile" [class.in-cart]="qtyInCart(p.id) > 0" (click)="add(p)">
                    <span class="qs-thumb" [style.--hue]="hue(p.category)">
                      @if (p.image_url) {
                        <img [src]="p.image_url" alt="" loading="lazy" />
                      } @else {
                        <b>{{ initial(p.name) }}</b>
                      }
                    </span>
                    @if (qtyInCart(p.id) > 0) {
                      <span class="qs-badge">{{ qtyInCart(p.id) }}</span>
                    }
                    <span class="qs-tile-name">{{ p.name }}</span>
                    <span class="qs-tile-price">{{ formatPrice(p.price_cents) }}</span>
                    <span class="qs-add" aria-hidden="true">+</span>
                  </button>
                }
              </div>
            }
          </main>

          <aside class="qs-ticket">
            <div class=\"qs-ticket-head\">
              <div>
                <p class=\"qs-eyebrow\"><i></i>{{ 'MENU.YOUR_ORDER_EYEBROW' | translate }}</p>
                <h3>{{ 'QUICK_SALE.TICKET' | translate }}</h3>
              </div>
              @if (cart().length > 0) { <span class=\"qs-count\">{{ cart().length }}</span> }
            </div>
            @if (cart().length === 0) {
              <div class="qs-ticket-empty"><span class="qs-empty-ico" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg></span><p>{{ 'QUICK_SALE.TICKET_EMPTY' | translate }}</p></div>
            } @else {
              <ul class="qs-lines">
                @for (line of cart(); track line.product_id) {
                  <li>
                    <span class="qs-line-name">{{ line.name }}</span>
                    <span class="qs-stepper">
                      <button type="button" (click)="changeQty(line.product_id, -1)" aria-label="−">−</button>
                      <b>{{ line.quantity }}</b>
                      <button type="button" (click)="changeQty(line.product_id, 1)" aria-label="+">+</button>
                    </span>
                    <span class="qs-line-price">{{ formatPrice(line.price_cents * line.quantity) }}</span>
                  </li>
                }
              </ul>
            }
            <div class="qs-checkout">
              <div class="qs-total">
                <span>{{ 'QUICK_SALE.TOTAL' | translate }}</span>
                <strong>{{ formatPrice(cartTotalCents()) }}</strong>
              </div>
              <input type="text" class="qs-customer" [(ngModel)]="customerName"
                [placeholder]="'QUICK_SALE.CUSTOMER_PH' | translate" [attr.aria-label]="'QUICK_SALE.CUSTOMER' | translate" />
              <div class="qs-pay" role="group" [attr.aria-label]="'QUICK_SALE.PAYMENT' | translate">
                <button type="button" [class.active]="paymentIntent === 'cash'" (click)="paymentIntent = 'cash'">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>
                  <span>{{ 'QUICK_SALE.PAYMENT_CASH' | translate }}</span>
                </button>
                <button type="button" [class.active]="paymentIntent === 'card'" (click)="paymentIntent = 'card'">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>
                  <span>{{ 'QUICK_SALE.PAYMENT_CARD' | translate }}</span>
                </button>
                <button type="button" [class.active]="paymentIntent === 'transfer'" (click)="paymentIntent = 'transfer'">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h13l-3-3M17 17H4l3 3"/></svg>
                  <span>{{ 'QUICK_SALE.PAYMENT_TRANSFER' | translate }}</span>
                </button>
              </div>
              @if (messageKey() === 'QUICK_SALE.SUBMIT_FAILED') {
                <p class="qs-error" role="alert">{{ messageKey()! | translate }}</p>
              }
              <div class="qs-actions">
                <button type="button" class="btn btn-secondary btn-sm" [disabled]="cart().length === 0" (click)="cart.set([])">{{ 'QUICK_SALE.CLEAR' | translate }}</button>
                <button type="button" class="btn btn-primary qs-charge" [disabled]="!canSubmit()" (click)="submit()">
                  {{ 'QUICK_SALE.CHARGE' | translate }} {{ formatPrice(cartTotalCents()) }}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    }
  `,
  styles: `
    .qs-bar {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1rem;
      margin-bottom: 1rem; padding: 0.75rem 1rem;
      border: 1px solid var(--color-border, #e5e7eb); border-radius: 10px; background: var(--color-surface, #fff);
    }
    .qs-bar-text { flex: 1; min-width: 14rem; }
    .qs-bar-text h2 { margin: 0; font-size: 1.0625rem; font-weight: 600; }
    .qs-bar-text p { margin: 0.125rem 0 0; font-size: 0.8125rem; color: var(--color-text-muted, #6b7280); }
    .qs-open { min-height: 44px; padding-inline: 1.25rem; font-weight: 600; }
    .qs-error { margin: 0; color: #991b1b; font-size: 0.875rem; }
    .qs-msg { flex-basis: 100%; margin: 0; font-size: 0.875rem; font-weight: 500; color: #065f46; }
    .btn-sm { font-size: 0.8125rem; padding: 0.25rem 0.5rem; }

    .qs-overlay {
      position: fixed; inset: 0; z-index: 1100; display: flex; flex-direction: column;
      background: var(--color-bg, #f3f4f6); color: var(--color-text, #111827);
    }
    .qs-top {
      display: flex; align-items: center; gap: 1rem; padding: 0.625rem 1rem;
      background: var(--color-surface, #fff); border-bottom: 1px solid var(--color-border, #e5e7eb);
    }
    .qs-top h2 { margin: 0; font-size: 1.0625rem; font-weight: 600; white-space: nowrap; }
    .qs-search {
      flex: 1; display: flex; align-items: center; gap: 0.5rem; max-width: 40rem; min-height: 46px; padding: 0 0.875rem;
      border: 1px solid var(--color-border, #d1d5db); border-radius: 12px; background: var(--color-bg, #f9fafb);
      color: var(--color-text-muted, #6b7280);
    }
    .qs-search:focus-within { border-color: var(--color-primary, #c2612c); box-shadow: 0 0 0 3px var(--color-primary-light, #fbe9df); }
    .qs-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font: inherit; font-size: 1rem; color: var(--color-text, #111827); }
    .qs-clear { border: none; background: none; font-size: 1.375rem; line-height: 1; cursor: pointer; color: inherit; }
    .qs-close {
      margin-inline-start: auto; width: 44px; height: 44px; border: 1px solid var(--color-border, #d1d5db);
      border-radius: 10px; background: var(--color-surface, #fff); color: inherit; font-size: 1.125rem; cursor: pointer;
    }

    .qs-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 12.5rem minmax(0, 1fr) 21rem; }

    .qs-cats {
      display: flex; flex-direction: column; gap: 0.25rem; padding: 0.75rem; overflow-y: auto;
      background: var(--color-surface, #fff); border-inline-end: 1px solid var(--color-border, #e5e7eb);
    }
    .qs-cats button {
      display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; min-height: 46px; padding: 0 0.75rem;
      border: none; border-radius: 10px; background: transparent; color: var(--color-text, #111827);
      font: inherit; font-size: 0.9375rem; text-align: start; cursor: pointer;
    }
    .qs-cats button small { color: var(--color-text-muted, #6b7280); font-variant-numeric: tabular-nums; }
    .qs-cats button:hover { background: var(--color-bg, #f3f4f6); }
    .qs-cats button.active { background: var(--color-primary, #c2612c); color: #fff; font-weight: 600; }
    .qs-cats button.active small { color: rgba(255, 255, 255, 0.85); }

    .qs-products { overflow-y: auto; padding: 1rem; }
    .qs-found { margin: 0 0 0.75rem; font-size: 0.8125rem; color: var(--color-text-muted, #6b7280); }
    .qs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 0.75rem; }
    .qs-tile {
      position: relative; display: flex; flex-direction: column; gap: 0.25rem; padding: 0.5rem 0.5rem 0.625rem; text-align: start;
      border: 2px solid transparent; border-radius: 14px; background: var(--color-surface, #fff); color: inherit; font: inherit;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); cursor: pointer; transition: transform 0.08s, box-shadow 0.12s, border-color 0.12s;
    }
    .qs-tile:hover { box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12); }
    .qs-tile:active { transform: scale(0.97); }
    .qs-tile.in-cart { border-color: var(--color-primary, #c2612c); }
    .qs-thumb {
      display: flex; align-items: center; justify-content: center; aspect-ratio: 4 / 3; overflow: hidden; border-radius: 10px;
      background: hsl(var(--hue, 30) 70% 90%); color: hsl(var(--hue, 30) 55% 32%);
    }
    .qs-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .qs-thumb b { font-size: 2rem; font-weight: 700; }
    .qs-tile-name {
      padding-inline: 0.25rem; font-size: 0.875rem; font-weight: 500; line-height: 1.25; min-height: 2.5em;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .qs-tile-price { padding-inline: 0.25rem; font-weight: 700; color: var(--color-primary, #c2612c); font-variant-numeric: tabular-nums; }
    .qs-badge {
      position: absolute; top: 0.25rem; inset-inline-end: 0.25rem; min-width: 26px; height: 26px; padding: 0 7px;
      display: inline-flex; align-items: center; justify-content: center; border-radius: 999px;
      background: var(--color-primary, #c2612c); color: #fff; font-size: 0.8125rem; font-weight: 700; box-shadow: 0 1px 4px rgba(0,0,0,.3);
    }
    .qs-empty { margin: 0.75rem 0; font-size: 0.9375rem; color: var(--color-text-muted, #6b7280); }

    .qs-ticket {
      display: flex; flex-direction: column; min-height: 0; padding: 1rem; gap: 0.5rem;
      background: var(--color-surface, #fff); border-inline-start: 1px solid var(--color-border, #e5e7eb);
    }
    .qs-ticket h3 { margin: 0; font-size: 1rem; font-weight: 600; }
    .qs-lines { flex: 1; min-height: 0; list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.625rem; overflow-y: auto; }
    .qs-lines li { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 0.5rem; font-size: 0.9375rem; }
    .qs-line-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qs-line-price { min-width: 5rem; text-align: end; font-variant-numeric: tabular-nums; font-weight: 600; }
    .qs-stepper { display: inline-flex; align-items: center; gap: 0.25rem; }
    .qs-stepper button {
      width: 32px; height: 32px; border: 1px solid var(--color-border, #d1d5db); border-radius: 8px;
      background: var(--color-surface, #fff); color: inherit; font-size: 1.125rem; line-height: 1; cursor: pointer;
    }
    .qs-stepper b { min-width: 1.5rem; text-align: center; font-variant-numeric: tabular-nums; }
    .qs-checkout { display: flex; flex-direction: column; gap: 0.625rem; padding-top: 0.75rem; border-top: 1px dashed var(--color-border, #d1d5db); }
    .qs-ticket .qs-empty { flex: 1; }
    .qs-total { display: flex; justify-content: space-between; align-items: baseline; }
    .qs-total strong { font-size: 1.75rem; font-variant-numeric: tabular-nums; }
    .qs-customer {
      min-height: 42px; padding: 0 0.75rem; border: 1px solid var(--color-border, #d1d5db);
      border-radius: 10px; background: var(--color-bg, #f9fafb); font: inherit; color: inherit;
    }
    .qs-pay { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.4rem; }
    .qs-pay button {
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
      min-width: 0; min-height: 58px; padding: 6px 4px; border: 1.5px solid var(--color-border, #d1d5db); border-radius: 14px;
      background: var(--color-bg, #f9fafb); color: var(--color-text-muted, #6b7280); font: inherit; cursor: pointer;
      touch-action: manipulation; transition: border-color .15s, background .15s, color .15s;
    }
    .qs-pay button span { max-width: 100%; font-size: 0.78rem; font-weight: 600; line-height: 1.1; text-align: center; overflow-wrap: anywhere; }
    .qs-pay button:hover { border-color: var(--color-primary, #c2612c); }
    .qs-pay button.active {
      background: var(--color-primary, #c2612c); border-color: var(--color-primary, #c2612c); color: #fff;
      box-shadow: 0 6px 14px -6px var(--color-primary, #c2612c);
    }
    .qs-actions { display: flex; gap: 0.5rem; }
    .qs-charge { flex: 1; min-height: 52px; font-size: 1.0625rem; font-weight: 700; }

    @media (max-width: 900px) {
      .qs-body { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr) auto; }
      .qs-cats { flex-direction: row; overflow-x: auto; overflow-y: hidden; border-inline-end: none; border-bottom: 1px solid var(--color-border, #e5e7eb); }
      .qs-cats button { flex-shrink: 0; white-space: nowrap; min-height: 40px; }
      .qs-ticket { max-height: 45vh; border-inline-start: none; border-top: 1px solid var(--color-border, #e5e7eb); }
      .qs-top h2 { display: none; }
    }
    /* ===== v2: warm, ticket-style point of sale ===== */
    .qs-overlay { background: radial-gradient(120% 80% at 100% 0, rgba(232, 154, 82, 0.10), transparent 55%), #faf6f1; }
    .qs-top { gap: 1rem; padding: 0.75rem 1.25rem; background: #fff; border-bottom: 0; box-shadow: 0 12px 24px -22px rgba(23, 18, 16, 0.5); position: relative; z-index: 2; }
    .qs-top h2 { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 500; font-size: 1.5rem; letter-spacing: -0.02em; }
    .qs-search { min-height: 50px; padding: 0 1.1rem; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--color-primary, #c2612c) 4%, #fff); box-shadow: inset 0 0 0 1.5px var(--color-border, #e5e7eb); transition: box-shadow 0.2s, background 0.2s; }
    .qs-search svg { color: var(--color-primary, #c2612c); }
    .qs-search:focus-within { background: #fff; border: 0; box-shadow: inset 0 0 0 2px var(--color-primary, #c2612c), 0 0 0 5px color-mix(in srgb, var(--color-primary, #c2612c) 14%, transparent); }
    .qs-clear { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: color-mix(in srgb, var(--color-primary, #c2612c) 10%, #fff); color: var(--color-primary, #c2612c); font-size: 1.1rem; }
    .qs-close { width: 46px; height: 46px; border: 0; border-radius: 50%; background: #fff; box-shadow: inset 0 0 0 1.5px var(--color-border, #e5e7eb); transition: transform 0.15s, box-shadow 0.2s; }
    .qs-close:hover { box-shadow: inset 0 0 0 2px var(--color-primary, #c2612c); }
    .qs-close:active { transform: scale(0.92); }

    .qs-body { grid-template-columns: 14rem minmax(0, 1fr) 23rem; }
    .qs-cats { gap: 0.4rem; padding: 1rem 0.85rem; background: transparent; border: 0; }
    .qs-cats button { min-height: 52px; padding: 0 0.6rem 0 1rem; border-radius: 18px; font-weight: 600; background: transparent; transition: background 0.2s, box-shadow 0.2s, transform 0.15s; }
    .qs-cats button:hover { background: #fff; box-shadow: 0 10px 18px -14px rgba(23, 18, 16, 0.5); }
    .qs-cats button:active { transform: scale(0.98); }
    .qs-cats button small { display: grid; place-items: center; min-width: 30px; height: 30px; padding: 0 8px; border-radius: 15px; font-family: Georgia, serif; font-style: italic; font-size: 0.9rem; color: var(--color-primary, #c2612c); background: color-mix(in srgb, var(--color-primary, #c2612c) 10%, #fff); }
    .qs-cats button.active { color: #fff; background: linear-gradient(135deg, var(--color-primary, #c2612c), color-mix(in srgb, var(--color-primary, #c2612c) 62%, #000)); box-shadow: 0 16px 24px -14px var(--color-primary, #c2612c); }
    .qs-cats button.active small { color: var(--color-primary, #c2612c); background: #fff; }

    .qs-products { padding: 1.1rem 1.25rem 2rem; }
    .qs-found { font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.7rem; }
    .qs-grid { grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr)); gap: 1rem; }
    .qs-tile { gap: 0.4rem; padding: 0.55rem 0.55rem 0.8rem; border: 0; border-radius: 24px; background: #fff; box-shadow: 0 18px 30px -24px rgba(23, 18, 16, 0.5), 0 0 0 1px rgba(193, 90, 30, 0.1); transition: transform 0.2s, box-shadow 0.2s; }
    .qs-tile:hover { transform: translateY(-3px); box-shadow: 0 26px 36px -22px rgba(23, 18, 16, 0.55), 0 0 0 1.5px color-mix(in srgb, var(--color-primary, #c2612c) 45%, transparent); }
    .qs-tile:active { transform: scale(0.97); }
    .qs-tile.in-cart { box-shadow: 0 22px 34px -22px var(--color-primary, #c2612c), 0 0 0 2.5px var(--color-primary, #c2612c); }
    .qs-thumb { border-radius: 18px; aspect-ratio: 4 / 3; background: linear-gradient(145deg, hsl(var(--hue, 30) 85% 66%), hsl(var(--hue, 30) 70% 42%)); color: rgba(255, 255, 255, 0.95); }
    .qs-thumb b { font-family: Georgia, serif; font-style: italic; font-weight: 500; font-size: 2.6rem; text-shadow: 0 4px 10px rgba(0, 0, 0, 0.25); }
    .qs-tile-name { padding-inline: 0.35rem; font-family: Georgia, 'Times New Roman', serif; font-size: 1rem; font-weight: 500; line-height: 1.2; min-height: 2.4em; }
    .qs-tile-price { padding-inline: 0.35rem; font-family: Georgia, serif; font-style: italic; font-weight: 600; font-size: 1.15rem; }
    .qs-add { position: absolute; right: 0.9rem; bottom: 0.7rem; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; font-size: 1.25rem; font-weight: 700; line-height: 1; color: #fff; background: linear-gradient(145deg, var(--color-primary, #c2612c), color-mix(in srgb, var(--color-primary, #c2612c) 62%, #000)); box-shadow: 0 10px 16px -8px var(--color-primary, #c2612c); transition: transform 0.2s; }
    .qs-tile:hover .qs-add { transform: scale(1.12) rotate(90deg); }
    .qs-badge { top: 1rem; inset-inline-end: 1rem; min-width: 30px; height: 30px; font-family: Georgia, serif; font-style: italic; font-size: 0.95rem; color: var(--color-primary, #c2612c); background: #fff; box-shadow: 0 8px 14px -6px rgba(0, 0, 0, 0.45); animation: qs-pop 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.4); }
    @keyframes qs-pop { from { transform: scale(0.4); opacity: 0; } }

    .qs-ticket { gap: 0.6rem; padding: 1.25rem 1.1rem; margin: 0.75rem 0.75rem 0.75rem 0; border: 0; border-radius: 28px; background: #fff; box-shadow: 0 24px 44px -28px rgba(23, 18, 16, 0.5), 0 0 0 1px rgba(193, 90, 30, 0.12); }
    .qs-ticket-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 0.5rem; }
    .qs-ticket h3 { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 500; font-size: 1.7rem; letter-spacing: -0.02em; line-height: 1; }
    .qs-eyebrow { margin: 0 0 4px; display: flex; align-items: center; gap: 8px; font-size: 0.6rem; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; color: var(--color-primary, #c2612c); }
    .qs-eyebrow i { width: 16px; height: 1.5px; background: currentColor; }
    .qs-count { display: grid; place-items: center; min-width: 30px; height: 30px; padding: 0 9px; border-radius: 15px; font-family: Georgia, serif; font-style: italic; font-weight: 700; color: var(--color-primary, #c2612c); background: color-mix(in srgb, var(--color-primary, #c2612c) 12%, #fff); }
    .qs-ticket-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; border-radius: 22px; border: 1.5px dashed color-mix(in srgb, var(--color-primary, #c2612c) 35%, var(--color-border, #e5e7eb)); background: color-mix(in srgb, var(--color-primary, #c2612c) 3%, #fff); padding: 1.5rem; }
    .qs-ticket-empty p { margin: 0; max-width: 18ch; font-family: Georgia, serif; font-style: italic; font-size: 1.05rem; color: var(--color-text-muted, #6b7280); }
    .qs-empty-ico { display: grid; place-items: center; width: 58px; height: 58px; border-radius: 20px; color: #fff; background: linear-gradient(145deg, var(--color-primary, #c2612c), color-mix(in srgb, var(--color-primary, #c2612c) 60%, #000)); box-shadow: 0 14px 22px -12px var(--color-primary, #c2612c); transform: rotate(-4deg); }
    .qs-lines { gap: 0.5rem; }
    .qs-lines li { grid-template-columns: 1fr auto; row-gap: 6px; padding: 10px 12px; border-radius: 18px; background: color-mix(in srgb, var(--color-primary, #c2612c) 4%, #fff); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary, #c2612c) 10%, transparent); }
    .qs-line-name { grid-column: 1 / -1; white-space: normal; font-family: Georgia, serif; font-size: 1rem; line-height: 1.2; }
    .qs-line-price { min-width: 0; font-weight: 800; letter-spacing: -0.01em; }
    .qs-stepper { gap: 2px; padding: 3px; border-radius: 999px; background: #fff; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary, #c2612c) 18%, transparent); }
    .qs-stepper button { width: 30px; height: 30px; border: 0; border-radius: 50%; color: var(--color-primary, #c2612c); background: #fff; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-primary, #c2612c) 30%, transparent); transition: transform 0.15s; }
    .qs-stepper button:last-child { color: #fff; background: linear-gradient(145deg, var(--color-primary, #c2612c), color-mix(in srgb, var(--color-primary, #c2612c) 62%, #000)); box-shadow: 0 6px 10px -5px var(--color-primary, #c2612c); }
    .qs-stepper button:active { transform: scale(0.88); }
    .qs-stepper b { min-width: 28px; font-family: Georgia, serif; font-style: italic; }
    .qs-checkout { gap: 0.7rem; padding-top: 0.9rem; border-top: 1.5px dashed var(--color-border, #e5e7eb); }
    .qs-total span { font-size: 0.66rem; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-text-muted, #6b7280); }
    .qs-total strong { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 500; font-size: 2.1rem; letter-spacing: -0.02em; color: var(--color-primary, #c2612c); }
    .qs-actions { gap: 0.6rem; }
    .qs-actions .btn-secondary { min-height: 52px; padding: 0 1rem; border: 0; border-radius: 999px; font-weight: 700; color: #b91c1c; background: #fef2f2; }
    .qs-actions .btn-secondary:disabled { opacity: 0.45; }
    .qs-confirm, .qs-charge { min-height: 52px; border: 0; border-radius: 999px; font-weight: 800; color: #fff; background: linear-gradient(135deg, var(--color-primary, #c2612c), color-mix(in srgb, var(--color-primary, #c2612c) 60%, #000)); box-shadow: 0 16px 24px -14px var(--color-primary, #c2612c); transition: transform 0.15s; }
    .qs-confirm:active, .qs-charge:active { transform: scale(0.97); }
    .qs-confirm:disabled, .qs-charge:disabled { opacity: 0.5; box-shadow: none; }
    .qs-customer { min-height: 46px; padding: 0 1rem; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--color-primary, #c2612c) 4%, #fff); box-shadow: inset 0 0 0 1.5px var(--color-border, #e5e7eb); outline: none; transition: box-shadow 0.2s; }
    .qs-customer:focus { box-shadow: inset 0 0 0 2px var(--color-primary, #c2612c), 0 0 0 4px color-mix(in srgb, var(--color-primary, #c2612c) 14%, transparent); }
    .qs-pay { gap: 0.5rem; }
    .qs-pay button { min-height: 62px; border: 0; border-radius: 20px; background: #fff; box-shadow: inset 0 0 0 1.5px var(--color-border, #e5e7eb); }
    .qs-pay button:hover { box-shadow: inset 0 0 0 2px var(--color-primary, #c2612c); }
    .qs-pay button.active { color: #fff; background: linear-gradient(135deg, var(--color-primary, #c2612c), color-mix(in srgb, var(--color-primary, #c2612c) 60%, #000)); box-shadow: 0 14px 22px -12px var(--color-primary, #c2612c); }
    @media (max-width: 900px) {
      .qs-cats { flex-direction: row; padding: 0.75rem 1rem; }
      .qs-cats button { min-height: 44px; border-radius: 999px; }
      .qs-ticket { margin: 0 0.75rem 0.75rem; max-height: 45vh; }
    }
    .qs-stepper { justify-self: start; align-self: center; }
    @media (prefers-reduced-motion: reduce) { .qs-badge { animation: none; } .qs-tile, .qs-add { transition: none; } }

  `,
})
export class QuickSaleComponent implements OnInit {
  private readonly queue = inject(OfflineOrderQueueService);
  private readonly permissions = inject(PermissionService);
  private readonly api = inject(ApiService);
  private readonly translate = inject(TranslateService);

  readonly ALL = ALL;
  customerName = '';
  paymentIntent: 'cash' | 'card' | 'transfer' = 'cash';

  readonly isOpen = signal(false);
  readonly search = signal('');
  readonly activeCategory = signal<string>(ALL);
  readonly submitting = signal(false);
  readonly messageKey = signal<string | null>(null);
  readonly lastOrderId = signal<number | null>(null);
  readonly cart = signal<QuickSaleLine[]>([]);

  readonly products = computed(() => this.queue.cache()?.products ?? []);
  readonly hasCounterTable = computed(() => !!this.queue.cache()?.take_away_table);
  readonly cartTotalCents = computed(() =>
    this.cart().reduce((sum, line) => sum + line.price_cents * line.quantity, 0)
  );
  readonly cartCount = computed(() => this.cart().reduce((n, l) => n + l.quantity, 0));

  /** Categories with product counts; products without a category go under "Otros". */
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

  ngOnInit(): void {
    if (!this.canUse()) return;
    this.queue.refreshCacheFromServer();
  }

  canUse(): boolean {
    const u = this.api.getCurrentUser();
    return (
      this.permissions.hasPermission(u, 'order:update_status') &&
      this.permissions.hasPermission(u, 'order:mark_paid')
    );
  }

  refreshProducts(): void {
    this.queue.refreshCacheFromServer();
  }

  open(): void {
    this.messageKey.set(null);
    this.search.set('');
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

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

  add(product: { id: number; name: string; price_cents: number }): void {
    this.messageKey.set(null);
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

  canSubmit(): boolean {
    return this.canUse() && this.cart().length > 0 && this.hasCounterTable() && !this.submitting();
  }

  submit(): void {
    if (!this.canSubmit()) return;
    const table = this.queue.cache()?.take_away_table;
    if (!table) return;

    this.submitting.set(true);
    this.messageKey.set(null);
    this.lastOrderId.set(null);

    this.api
      .syncOfflineCashOrder({
        idempotency_key: this.newKey(),
        table_id: table.id,
        items: this.cart().map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
        customer_name: this.customerName.trim() || undefined,
        payment_intent: this.paymentIntent,
        send_to_kitchen: true,
      })
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          this.lastOrderId.set(res.order_id);
          this.messageKey.set(
            res.needs_payment ? 'QUICK_SALE.RECORDED_NEEDS_CARD' : 'QUICK_SALE.RECORDED'
          );
          this.cart.set([]);
          this.customerName = '';
          this.isOpen.set(false);
        },
        error: () => {
          this.submitting.set(false);
          this.messageKey.set('QUICK_SALE.SUBMIT_FAILED');
        },
      });
  }

  private normalize(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  private newKey(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    }
    return `sale${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  }
}
