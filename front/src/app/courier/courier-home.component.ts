import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiService, CourierInfo, CourierOrderSummary } from '../services/api.service';
import { formatMoneyCents } from '../shared/currency-symbol';

type CourierTab = 'available' | 'mine' | 'completed';

const OPEN_STATUSES = new Set([
  'pending',
  'preparing',
  'ready',
  'out_for_delivery',
  'partially_delivered',
]);
const COMPLETED_STATUSES = new Set(['paid', 'completed', 'cancelled']);
const REFRESH_INTERVAL_MS = 15000;

@Component({
  selector: 'app-courier-home',
  standalone: true,
  imports: [TranslateModule, RouterLink],
  template: `
    <div class="cp">
      <header class="cp-hero">
        <div class="cp-hero-top">
          <p class="cp-eyebrow"><i></i>{{ 'COURIER_HOME.EYEBROW' | translate }}</p>
          <div class="cp-hero-actions">
            <button type="button" class="cp-round" (click)="refresh()" [disabled]="ordersLoading()" [attr.aria-label]="'COURIER_HOME.REFRESH' | translate" [title]="'COURIER_HOME.REFRESH' | translate">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [class.spin]="ordersLoading()"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
            </button>
            <button type="button" class="cp-round" (click)="logout()" [attr.aria-label]="'COURIER_HOME.LOGOUT' | translate" [title]="'COURIER_HOME.LOGOUT' | translate">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>
            </button>
          </div>
        </div>
        <h1 class="cp-hello">{{ 'COURIER_HOME.GREETING' | translate: { name: firstName() } }}</h1>
        @if (profile()?.tenant_name) {
          <p class="cp-tenant">{{ profile()!.tenant_name }}</p>
        }
        <p class="cp-live"><span class="cp-live-dot"></span>{{ 'COURIER_HOME.LIVE' | translate }}</p>
      </header>

      <main class="cp-main">
        @if (profileLoading()) {
          <p class="cp-muted">{{ 'COMMON.LOADING' | translate }}</p>
        } @else if (profileError()) {
          <p class="cp-error">{{ profileError() | translate }}</p>
        } @else {
          <nav class="cp-tabs" aria-label="Order filters">
            <button type="button" class="cp-tab" [class.active]="activeTab() === 'available'" (click)="setTab('available')">
              <span>{{ 'COURIER_ORDERS.TAB_AVAILABLE' | translate }}</span><b>{{ countFor('available') }}</b>
            </button>
            <button type="button" class="cp-tab" [class.active]="activeTab() === 'mine'" (click)="setTab('mine')">
              <span>{{ 'COURIER_ORDERS.TAB_MINE' | translate }}</span><b>{{ countFor('mine') }}</b>
            </button>
            <button type="button" class="cp-tab" [class.active]="activeTab() === 'completed'" (click)="setTab('completed')">
              <span>{{ 'COURIER_ORDERS.TAB_COMPLETED' | translate }}</span><b>{{ countFor('completed') }}</b>
            </button>
          </nav>

          @if (ordersLoading()) {
            <p class="cp-muted">{{ 'COMMON.LOADING' | translate }}</p>
          } @else if (ordersError()) {
            <p class="cp-error">{{ ordersError() | translate }}</p>
          } @else if (filteredOrders().length === 0) {
            <div class="cp-empty">
              <span class="cp-empty-ico" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l4-8h5l3 8M9 9H7M14 9l-2 8"/></svg>
              </span>
              <p>{{ emptyMessageKey() | translate }}</p>
            </div>
          } @else {
            <ul class="cp-list">
              @for (order of filteredOrders(); track order.id) {
                <li>
                  <a class="cp-card" [routerLink]="['/courier/orders', order.id]" [attr.data-status]="order.status">
                    <div class="cp-card-top">
                      <div>
                        <p class="cp-card-eyebrow">{{ 'COURIER_ORDERS.ORDER_WORD' | translate }}</p>
                        <p class="cp-card-num">Nº {{ order.id }}</p>
                      </div>
                      <span class="cp-chip" [attr.data-status]="order.status"><i></i>{{ statusLabelKey(order.status) | translate }}</span>
                    </div>

                    @if (order.customer_name || order.customer_phone) {
                      <div class="cp-person">
                        <span class="cp-avatar" aria-hidden="true">{{ initial(order.customer_name) }}</span>
                        <div>
                          @if (order.customer_name) { <b>{{ order.customer_name }}</b> }
                          @if (order.customer_phone) { <small>{{ order.customer_phone }}</small> }
                        </div>
                      </div>
                    }
                    @if (order.delivery_address) {
                      <p class="cp-addr">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>
                        <span>{{ order.delivery_address }}</span>
                      </p>
                    }
                    <p class="cp-items">{{ order.item_summary }}</p>

                    <div class="cp-card-foot">
                      <span class="cp-time">{{ formatCreatedAt(order.created_at) }}</span>
                      <span class="cp-foot-end">
                        @if (order.total_cents != null) {
                          <b class="cp-total">{{ formatMoney(order.total_cents) }}</b>
                        }
                        <i class="cp-go" aria-hidden="true">→</i>
                      </span>
                    </div>
                  </a>
                </li>
              }
            </ul>
          }
        }
      </main>
    </div>
  `,
  styles: [`
    :host { display: block; background: #faf6f1; min-height: 100vh; }
    .cp { max-width: 560px; margin: 0 auto; min-height: 100vh; }

    .cp-hero {
      position: relative;
      padding: 18px 20px 54px;
      color: #fff;
      border-radius: 0 0 36px 36px;
      background:
        radial-gradient(120% 90% at 100% 0, rgba(232, 154, 82, 0.35), transparent 60%),
        linear-gradient(160deg, #2a1d17, #160e0b);
      overflow: hidden;
    }
    .cp-hero::after { content: ''; position: absolute; right: -40px; bottom: -60px; width: 200px; height: 200px; border-radius: 50%; border: 1.5px dashed rgba(232, 154, 82, 0.35); }
    .cp-hero-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; }
    .cp-eyebrow { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 0.64rem; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; color: #f0a35e; i { width: 18px; height: 1.5px; background: currentColor; } }
    .cp-hero-actions { display: flex; gap: 8px; }
    .cp-round { display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 50%; color: #fff; background: rgba(255, 255, 255, 0.12); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16); cursor: pointer; transition: background 0.2s, transform 0.15s; &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.22); } &:active { transform: scale(0.92); } &:disabled { opacity: 0.6; } }
    .spin { animation: cp-spin 0.9s linear infinite; }
    @keyframes cp-spin { to { transform: rotate(360deg); } }
    .cp-hello { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 500; font-size: clamp(2rem, 9vw, 2.6rem); line-height: 1.05; letter-spacing: -0.025em; }
    .cp-tenant { margin: 6px 0 0; font-size: 0.92rem; color: rgba(255, 255, 255, 0.7); }
    .cp-live { display: inline-flex; align-items: center; gap: 8px; margin: 16px 0 0; padding: 6px 12px 6px 10px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em; color: rgba(255, 255, 255, 0.85); background: rgba(255, 255, 255, 0.1); }
    .cp-live-dot { position: relative; width: 8px; height: 8px; border-radius: 50%; background: #4ade80; &::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; background: #4ade80; opacity: 0.35; animation: cp-pulse 2s infinite; } }
    @keyframes cp-pulse { 0%, 100% { transform: scale(1); opacity: 0.35; } 50% { transform: scale(1.7); opacity: 0; } }

    .cp-main { margin-top: -30px; padding: 0 16px 48px; position: relative; z-index: 1; }
    .cp-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 5px; margin-bottom: 16px; border-radius: 999px; background: #fff; box-shadow: 0 18px 30px -18px rgba(23, 18, 16, 0.45), 0 0 0 1px rgba(193, 90, 30, 0.16); }
    .cp-tab { display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 0 6px; border: 0; border-radius: 999px; background: transparent; font: inherit; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-muted); cursor: pointer; transition: background 0.2s, color 0.2s; }
    .cp-tab b { display: grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; font-family: Georgia, serif; font-style: italic; font-size: 0.82rem; font-weight: 700; letter-spacing: 0; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, #fff); }
    .cp-tab.active { color: #fff; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #000)); box-shadow: 0 10px 18px -10px var(--color-primary); }
    .cp-tab.active b { color: var(--color-primary); background: #fff; }

    .cp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
    .cp-card { display: block; padding: 18px 18px 14px; border-radius: 26px; background: #fff; color: inherit; text-decoration: none; box-shadow: 0 20px 36px -26px rgba(23, 18, 16, 0.5), 0 0 0 1px rgba(193, 90, 30, 0.12); transition: transform 0.2s, box-shadow 0.2s; }
    .cp-card:hover { transform: translateY(-2px); box-shadow: 0 26px 40px -24px rgba(23, 18, 16, 0.55), 0 0 0 1.5px color-mix(in srgb, var(--color-primary) 40%, transparent); }
    .cp-card:active { transform: scale(0.985); }
    .cp-card-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
    .cp-card-eyebrow { margin: 0; font-size: 0.6rem; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; color: var(--color-primary); }
    .cp-card-num { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 1.9rem; line-height: 1; letter-spacing: -0.02em; }
    .cp-chip { display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 12px 0 10px; border-radius: 999px; font-size: 0.66rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #92400e; background: #fef3c7; i { width: 7px; height: 7px; border-radius: 50%; background: #f59e0b; } }
    .cp-chip[data-status='preparing'], .cp-chip[data-status='out_for_delivery'] { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, #fff); i { background: var(--color-primary); } }
    .cp-chip[data-status='ready'], .cp-chip[data-status='paid'], .cp-chip[data-status='completed'] { color: #166534; background: #dcfce7; i { background: #22c55e; } }
    .cp-chip[data-status='cancelled'] { color: #6b7280; background: #f3f4f6; i { background: #9ca3af; } }

    .cp-person { display: flex; align-items: center; gap: 12px; margin-top: 16px; padding-top: 14px; border-top: 1.5px dashed var(--color-border); }
    .cp-avatar { flex: none; display: grid; place-items: center; width: 42px; height: 42px; border-radius: 15px; font-family: Georgia, serif; font-style: italic; font-size: 1.2rem; color: #fff; background: linear-gradient(145deg, #e89a52, #b4551f); box-shadow: 0 10px 16px -10px rgba(120, 50, 10, 0.6); }
    .cp-person b { display: block; font-size: 1rem; }
    .cp-person small { color: var(--color-text-muted); font-size: 0.84rem; font-variant-numeric: tabular-nums; }
    .cp-addr { display: flex; gap: 8px; align-items: flex-start; margin: 12px 0 0; padding: 10px 12px; border-radius: 14px; font-size: 0.9rem; line-height: 1.35; background: color-mix(in srgb, var(--color-primary) 5%, #fff); svg { flex: none; margin-top: 2px; color: var(--color-primary); } }
    .cp-items { margin: 12px 0 0; font-family: Georgia, serif; font-size: 0.98rem; line-height: 1.4; color: var(--color-text-muted); }
    .cp-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px; padding-top: 12px; border-top: 1.5px dashed var(--color-border); }
    .cp-time { font-size: 0.78rem; color: var(--color-text-muted); }
    .cp-foot-end { display: inline-flex; align-items: center; gap: 12px; }
    .cp-total { font-family: Georgia, serif; font-style: italic; font-weight: 500; font-size: 1.35rem; color: var(--color-primary); font-variant-numeric: tabular-nums; }
    .cp-go { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; font-style: normal; color: #fff; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #000)); transition: transform 0.2s; }
    .cp-card:hover .cp-go { transform: translateX(3px); }

    .cp-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 36px 24px; text-align: center; border-radius: 28px; border: 1.5px dashed color-mix(in srgb, var(--color-primary) 35%, var(--color-border)); background: color-mix(in srgb, var(--color-primary) 4%, #fff); }
    .cp-empty p { margin: 0; max-width: 26ch; font-family: Georgia, serif; font-style: italic; font-size: 1.15rem; color: var(--color-text-muted); }
    .cp-empty-ico { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 22px; color: #fff; background: linear-gradient(145deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #000)); box-shadow: 0 16px 24px -14px var(--color-primary); transform: rotate(-4deg); }
    .cp-muted { text-align: center; color: var(--color-text-muted); }
    .cp-error { padding: 12px 16px; border-radius: 16px; color: #b91c1c; background: #fef2f2; }
    @media (prefers-reduced-motion: reduce) { .cp-live-dot::after, .spin { animation: none; } }
  `]
})
export class CourierHomeComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private router = inject(Router);
  private translate = inject(TranslateService);
  private refreshIntervalId: ReturnType<typeof setInterval> | null = null;

  profileLoading = signal(true);
  profileError = signal('');
  profile = signal<CourierInfo | null>(null);

  ordersLoading = signal(true);
  ordersError = signal('');
  orders = signal<CourierOrderSummary[]>([]);
  activeTab = signal<CourierTab>('available');

  firstName = computed(() => {
    const p = this.profile();
    const raw = (p?.full_name || p?.username || '').trim();
    return raw.split(/[\s@]/)[0] || '';
  });

  private ordersFor(tab: CourierTab): CourierOrderSummary[] {
    const all = this.orders();
    const myId = this.profile()?.id ?? null;
    if (tab === 'available') {
      return all.filter((o) => OPEN_STATUSES.has(o.status) && o.courier_user_id == null);
    }
    if (tab === 'completed') {
      return all.filter(
        (o) =>
          COMPLETED_STATUSES.has(o.status) &&
          (o.courier_user_id == null || o.courier_user_id === myId)
      );
    }
    // Mine: open orders assigned to this courier
    if (myId == null) {
      return [];
    }
    return all.filter((o) => OPEN_STATUSES.has(o.status) && o.courier_user_id === myId);
  }

  filteredOrders = computed(() => this.ordersFor(this.activeTab()));

  countFor(tab: CourierTab): number {
    return this.ordersFor(tab).length;
  }

  emptyMessageKey = computed(() => {
    if (this.activeTab() === 'mine') {
      return 'COURIER_ORDERS.EMPTY_MINE';
    }
    if (this.activeTab() === 'completed') {
      return 'COURIER_ORDERS.EMPTY_COMPLETED';
    }
    return 'COURIER_ORDERS.EMPTY_AVAILABLE';
  });

  ngOnInit(): void {
    this.api.getCourierMe().subscribe({
      next: (info) => {
        this.profile.set(info);
        this.profileLoading.set(false);
        this.loadOrders();
        // New orders (e.g. a delivery order just placed) don't push a live update to this
        // page, so poll periodically instead of requiring a manual refresh.
        this.refreshIntervalId = setInterval(() => this.loadOrders(true), REFRESH_INTERVAL_MS);
      },
      error: () => {
        this.profileLoading.set(false);
        this.profileError.set('COURIER_HOME.LOAD_FAILED');
      }
    });
  }

  ngOnDestroy(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
  }

  setTab(tab: CourierTab): void {
    this.activeTab.set(tab);
  }

  refresh(): void {
    if (this.profileLoading() || this.profileError()) {
      return;
    }
    this.loadOrders();
  }

  statusLabelKey(status: string): string {
    return `COURIER_ORDERS.STATUS_${status.toUpperCase()}`;
  }

  initial(name: string | null | undefined): string {
    return (name || '?').trim().charAt(0).toUpperCase() || '?';
  }

  formatCreatedAt(iso: string): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  formatMoney(cents: number): string {
    return formatMoneyCents(cents);
  }

  logout(): void {
    this.api.logout().subscribe(() => {
      void this.router.navigate(['/courier/login']);
    });
  }

  private loadOrders(background = false): void {
    if (!background) {
      this.ordersLoading.set(true);
      this.ordersError.set('');
    }
    this.api.getCourierOrders().subscribe({
      next: (rows) => {
        this.orders.set(rows);
        this.ordersLoading.set(false);
      },
      error: () => {
        if (!background) {
          this.ordersLoading.set(false);
          this.ordersError.set('COURIER_ORDERS.LOAD_FAILED');
        }
      }
    });
  }
}
