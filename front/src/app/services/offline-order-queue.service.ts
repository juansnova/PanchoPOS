import { Injectable, computed, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ApiService, Product, Table } from './api.service';
import { ConnectivityService } from './connectivity.service';

const QUEUE_KEY = 'pos_offline_cash_queue_v1';
const CACHE_KEY = 'pos_offline_cache_v1';

export type OfflinePaymentIntent = 'cash' | 'card';

export interface OfflineCashQueueItem {
  idempotency_key: string;
  table_id: number;
  items: { product_id: number; quantity: number; notes?: string }[];
  customer_name?: string;
  notes?: string;
  /** cash = paid on sync; card = unpaid ticket, collect card online (#333). */
  payment_intent: OfflinePaymentIntent;
  client_created_at: string;
  product_names?: string[];
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
  order_id?: number;
  needs_payment?: boolean;
}

interface OfflineCache {
  tenant_id: number | null;
  products: { id: number; name: string; price_cents: number }[];
  take_away_table: { id: number; name: string } | null;
  updated_at: string;
}

/**
 * Local queue + product/table cache for offline sales (#319 cash, #333 deferred card).
 */
@Injectable({ providedIn: 'root' })
export class OfflineOrderQueueService {
  private readonly api = inject(ApiService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly queueSignal = signal<OfflineCashQueueItem[]>([]);
  private readonly cacheSignal = signal<OfflineCache | null>(null);
  private flushing = false;

  readonly queue = this.queueSignal.asReadonly();
  readonly pendingCount = computed(
    () => this.queueSignal().filter((q) => q.status === 'pending' || q.status === 'failed').length
  );
  readonly cache = this.cacheSignal.asReadonly();

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadFromStorage();
    window.addEventListener('online', () => void this.flush());
    setInterval(() => {
      if (this.connectivity.isOnline() && this.pendingCount() > 0) {
        void this.flush();
      }
    }, 15_000);
  }

  refreshCacheFromServer(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const user = this.api.getCurrentUser();
    if (!user?.tenant_id) return;
    this.api.getProducts().subscribe({
      next: (products: Product[]) => {
        this.api.getTables().subscribe({
          next: (tables: Table[]) => {
            const takeAway = tables.find((t) => this.isTakeAwayName(t.name));
            const cache: OfflineCache = {
              tenant_id: user.tenant_id ?? null,
              products: (products || [])
                .filter((p) => p.id != null)
                .map((p) => ({
                  id: p.id as number,
                  name: p.name,
                  price_cents: p.price_cents,
                })),
              take_away_table: takeAway?.id
                ? { id: takeAway.id, name: takeAway.name }
                : null,
              updated_at: new Date().toISOString(),
            };
            this.cacheSignal.set(cache);
            try {
              localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
            } catch {
              /* ignore quota */
            }
          },
        });
      },
    });
  }

  enqueueCashSale(opts: {
    productId: number;
    quantity: number;
    customerName?: string;
    paymentIntent?: OfflinePaymentIntent;
  }): OfflineCashQueueItem | null {
    const cache = this.cacheSignal();
    const table = cache?.take_away_table;
    if (!table) return null;
    const product = cache?.products.find((p) => p.id === opts.productId);
    if (!product || opts.quantity < 1) return null;

    const intent: OfflinePaymentIntent = opts.paymentIntent === 'card' ? 'card' : 'cash';
    const item: OfflineCashQueueItem = {
      idempotency_key: this.newKey(),
      table_id: table.id,
      items: [{ product_id: opts.productId, quantity: opts.quantity }],
      customer_name: opts.customerName?.trim() || undefined,
      payment_intent: intent,
      client_created_at: new Date().toISOString(),
      product_names: [product.name],
      status: 'pending',
    };
    const next = [...this.queueSignal(), item];
    this.queueSignal.set(next);
    this.persistQueue(next);
    if (this.connectivity.isOnline()) {
      void this.flush();
    }
    return item;
  }

  async flush(): Promise<void> {
    if (this.flushing || !isPlatformBrowser(this.platformId)) return;
    if (!this.connectivity.isOnline()) return;
    const user = this.api.getCurrentUser();
    if (!user) return;

    this.flushing = true;
    try {
      const items = [...this.queueSignal()];
      for (let i = 0; i < items.length; i++) {
        const q = items[i];
        if (q.status === 'synced') continue;
        if (q.status !== 'pending' && q.status !== 'failed' && q.status !== 'syncing') continue;

        items[i] = { ...q, status: 'syncing', error: undefined };
        this.queueSignal.set([...items]);
        this.persistQueue(items);

        try {
          const res = await firstValueFrom(
            this.api.syncOfflineCashOrder({
              idempotency_key: q.idempotency_key,
              table_id: q.table_id,
              items: q.items,
              customer_name: q.customer_name,
              notes: q.notes,
              client_created_at: q.client_created_at,
              payment_intent: q.payment_intent || 'cash',
            })
          );
          items[i] = {
            ...items[i],
            status: 'synced',
            order_id: res.order_id,
            needs_payment: !!res.needs_payment,
            error: undefined,
          };
        } catch (err: unknown) {
          const detail = this.errorDetail(err);
          const retryable = this.isRetryable(err);
          items[i] = {
            ...items[i],
            status: retryable ? 'pending' : 'failed',
            error: detail,
          };
          if (retryable) break; // stop flush on network blip; resume later
        }
        this.queueSignal.set([...items]);
        this.persistQueue(items);
      }
      // Drop synced items older than keep window (keep last few for UI feedback)
      const trimmed = this.queueSignal().filter(
        (q) => q.status !== 'synced' || this.recentSynced(q)
      );
      // Keep at most 5 synced for toast history
      let syncedKept = 0;
      const cleaned = trimmed.filter((q) => {
        if (q.status !== 'synced') return true;
        syncedKept += 1;
        return syncedKept <= 5;
      });
      this.queueSignal.set(cleaned);
      this.persistQueue(cleaned);
    } finally {
      this.flushing = false;
    }
  }

  private recentSynced(q: OfflineCashQueueItem): boolean {
    try {
      const t = Date.parse(q.client_created_at);
      return Number.isFinite(t) && Date.now() - t < 3600_000;
    } catch {
      return false;
    }
  }

  private loadFromStorage(): void {
    try {
      const rawQ = localStorage.getItem(QUEUE_KEY);
      if (rawQ) {
        const parsed = JSON.parse(rawQ) as OfflineCashQueueItem[];
        if (Array.isArray(parsed)) {
          // Backfill payment_intent for queue items written before #333.
          this.queueSignal.set(
            parsed.map((q) => ({
              ...q,
              payment_intent: q.payment_intent === 'card' ? 'card' : 'cash',
            }))
          );
        }
      }
      const rawC = localStorage.getItem(CACHE_KEY);
      if (rawC) {
        const parsed = JSON.parse(rawC) as OfflineCache;
        if (parsed && typeof parsed === 'object') this.cacheSignal.set(parsed);
      }
    } catch {
      /* ignore corrupt */
    }
  }

  private persistQueue(items: OfflineCashQueueItem[]): void {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    } catch {
      /* ignore */
    }
  }

  private newKey(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    }
    return `offline${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  }

  private isTakeAwayName(name: string | undefined): boolean {
    const n = (name || '').trim().toLowerCase();
    return n === 'take away' || n === 'home ordering' || n === 'takeaway' || n === 'take-away';
  }

  private errorDetail(err: unknown): string {
    const e = err as { error?: { detail?: unknown }; message?: string; status?: number };
    const d = e?.error?.detail;
    if (typeof d === 'string') return d;
    if (e?.message) return e.message;
    return 'Sync failed';
  }

  private isRetryable(err: unknown): boolean {
    const status = (err as { status?: number })?.status;
    if (status == null) return true;
    return status >= 500 || status === 0;
  }
}
