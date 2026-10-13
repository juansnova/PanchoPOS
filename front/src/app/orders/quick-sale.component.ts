import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OfflineOrderQueueService } from '../services/offline-order-queue.service';
import { PermissionService } from '../services/permission.service';
import { ApiService } from '../services/api.service';

interface QuickSaleLine {
  product_id: number;
  name: string;
  price_cents: number;
  quantity: number;
}

/**
 * Quick sale for a walk-up customer at the bar/counter who does not want a table.
 * Reuses the "Take Away" virtual table so the order needs no real table assignment.
 */
@Component({
  selector: 'app-quick-sale',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  template: `
    <section class="quick-sale">
      <div class="quick-sale-head">
        <h2>{{ 'QUICK_SALE.TITLE' | translate }}</h2>
      </div>
      <p class="quick-sale-hint">{{ 'QUICK_SALE.HINT' | translate }}</p>
      @if (!hasCounterTable()) {
        <p class="quick-sale-error">{{ 'QUICK_SALE.NO_COUNTER_TABLE' | translate }}</p>
      } @else if (products().length === 0) {
        <p class="quick-sale-error">{{ 'QUICK_SALE.NO_PRODUCTS' | translate }}</p>
        <button type="button" class="btn btn-secondary btn-sm" (click)="refreshProducts()">
          {{ 'QUICK_SALE.REFRESH' | translate }}
        </button>
      } @else {
        <div class="quick-sale-form">
          <label>
            <span>{{ 'QUICK_SALE.PRODUCT' | translate }}</span>
            <select [(ngModel)]="productId">
              <option [ngValue]="null">{{ 'QUICK_SALE.SELECT_PRODUCT' | translate }}</option>
              @for (p of products(); track p.id) {
                <option [ngValue]="p.id">{{ p.name }} ({{ formatPrice(p.price_cents) }})</option>
              }
            </select>
          </label>
          <label>
            <span>{{ 'QUICK_SALE.QTY' | translate }}</span>
            <input type="number" min="1" max="99" [(ngModel)]="quantity" />
          </label>
          <button type="button" class="btn btn-secondary" [disabled]="productId == null" (click)="addToCart()">
            {{ 'QUICK_SALE.ADD' | translate }}
          </button>
        </div>

        @if (cart().length > 0) {
          <ul class="quick-sale-cart">
            @for (line of cart(); track line.product_id) {
              <li>
                <span class="cart-qty">{{ line.quantity }}×</span>
                <span class="cart-name">{{ line.name }}</span>
                <span class="cart-price">{{ formatPrice(line.price_cents * line.quantity) }}</span>
                <button type="button" class="cart-remove" (click)="removeFromCart(line.product_id)">×</button>
              </li>
            }
          </ul>

          <div class="quick-sale-form">
            <label>
              <span>{{ 'QUICK_SALE.CUSTOMER' | translate }}</span>
              <input type="text" [(ngModel)]="customerName" [placeholder]="'QUICK_SALE.CUSTOMER_PH' | translate" />
            </label>
            <label>
              <span>{{ 'QUICK_SALE.PAYMENT' | translate }}</span>
              <select [(ngModel)]="paymentIntent">
                <option value="cash">{{ 'QUICK_SALE.PAYMENT_CASH' | translate }}</option>
                <option value="card">{{ 'QUICK_SALE.PAYMENT_CARD' | translate }}</option>
              </select>
            </label>
            <span class="quick-sale-total">{{ 'QUICK_SALE.TOTAL' | translate }}: {{ formatPrice(cartTotalCents()) }}</span>
            <button type="button" class="btn btn-primary" [disabled]="!canSubmit()" (click)="submit()">
              {{ 'QUICK_SALE.CHARGE' | translate }}
            </button>
          </div>
        }
      }
      @if (messageKey()) {
        <p class="quick-sale-msg" role="status">
          {{ messageKey()! | translate }}
          @if (lastOrderId()) { (#{{ lastOrderId() }}) }
        </p>
      }
    </section>
  `,
  styles: `
    .quick-sale {
      margin-bottom: 1rem;
      padding: 0.75rem 1rem;
      border: 1px solid var(--color-border, #e5e7eb);
      border-radius: 6px;
      background: var(--color-surface, #fff);
    }
    .quick-sale-head h2 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }
    .quick-sale-hint {
      margin: 0.35rem 0 0.75rem;
      font-size: 0.8125rem;
      color: var(--color-text-muted, #6b7280);
    }
    .quick-sale-error {
      color: #991b1b;
      font-size: 0.875rem;
    }
    .quick-sale-form {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: flex-end;
    }
    .quick-sale-form label {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.75rem;
    }
    .quick-sale-form select,
    .quick-sale-form input[type='text'],
    .quick-sale-form input[type='number'] {
      min-width: 8rem;
      padding: 0.35rem 0.5rem;
      border: 1px solid var(--color-border, #d1d5db);
      border-radius: 4px;
    }
    .quick-sale-total {
      font-size: 0.875rem;
      font-weight: 600;
    }
    .quick-sale-cart {
      list-style: none;
      margin: 0.5rem 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      max-height: 12rem;
      overflow-y: auto;
    }
    .quick-sale-cart li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
    }
    .cart-qty {
      font-weight: 600;
      min-width: 2rem;
    }
    .cart-name {
      flex: 1;
    }
    .cart-remove {
      border: none;
      background: none;
      color: #991b1b;
      font-size: 1rem;
      cursor: pointer;
      line-height: 1;
      padding: 0 0.25rem;
    }
    .quick-sale-msg {
      margin: 0.5rem 0 0;
      font-size: 0.875rem;
      color: #065f46;
    }
    .btn-sm {
      font-size: 0.8125rem;
      padding: 0.25rem 0.5rem;
    }
  `,
})
export class QuickSaleComponent implements OnInit {
  private readonly queue = inject(OfflineOrderQueueService);
  private readonly permissions = inject(PermissionService);
  private readonly api = inject(ApiService);

  productId: number | null = null;
  quantity = 1;
  customerName = '';
  paymentIntent: 'cash' | 'card' = 'cash';

  readonly submitting = signal(false);
  readonly messageKey = signal<string | null>(null);
  readonly lastOrderId = signal<number | null>(null);
  readonly cart = signal<QuickSaleLine[]>([]);

  readonly products = computed(() => this.queue.cache()?.products ?? []);
  readonly hasCounterTable = computed(() => !!this.queue.cache()?.take_away_table);
  readonly cartTotalCents = computed(() =>
    this.cart().reduce((sum, line) => sum + line.price_cents * line.quantity, 0)
  );

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

  formatPrice(cents: number): string {
    return (cents / 100).toFixed(2);
  }

  addToCart(): void {
    if (this.productId == null || this.quantity < 1) return;
    const product = this.products().find((p) => p.id === this.productId);
    if (!product) return;
    const qty = this.quantity;
    this.cart.update((lines) => {
      const existing = lines.find((l) => l.product_id === product.id);
      if (existing) {
        return lines.map((l) =>
          l.product_id === product.id ? { ...l, quantity: l.quantity + qty } : l
        );
      }
      return [...lines, { product_id: product.id, name: product.name, price_cents: product.price_cents, quantity: qty }];
    });
    this.productId = null;
    this.quantity = 1;
  }

  removeFromCart(productId: number): void {
    this.cart.update((lines) => lines.filter((l) => l.product_id !== productId));
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
        },
        error: () => {
          this.submitting.set(false);
          this.messageKey.set('QUICK_SALE.SUBMIT_FAILED');
        },
      });
  }

  private newKey(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    }
    return `sale${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  }
}
