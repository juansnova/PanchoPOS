import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
  ApiService,
  CourierDeliveryPaymentMethod,
  CourierOrderAction,
  CourierOrderDetail,
} from '../services/api.service';
import { formatMoneyCents } from '../shared/currency-symbol';

@Component({
  selector: 'app-courier-order-detail',
  standalone: true,
  imports: [TranslateModule, RouterLink],
  template: `
    <div class="cd">
      <header class="cd-bar">
        <a routerLink="/courier" class="cd-back" [attr.aria-label]="'COURIER_ORDERS.BACK' | translate" [title]="'COURIER_ORDERS.BACK' | translate">←</a>
        @if (order()) {
          <span class="cd-chip" [attr.data-status]="order()!.status"><i></i>{{ statusLabelKey(order()!.status) | translate }}</span>
        }
      </header>

      <main class="cd-main">
        @if (loading()) {
          <p class="cd-muted">{{ 'COMMON.LOADING' | translate }}</p>
        } @else if (error()) {
          <p class="cd-error">{{ error() | translate }}</p>
        } @else if (order()) {
          <section class="cd-hero">
            <p class="cd-eyebrow"><i></i>{{ 'COURIER_ORDERS.ORDER_WORD' | translate }}</p>
            <h1 class="cd-num">Nº {{ order()!.id }}</h1>
            <p class="cd-created">{{ formatCreatedAt(order()!.created_at) }}</p>

            <ol class="cd-steps" [attr.data-step]="step()" aria-hidden="true">
              <li><i>1</i><span>{{ 'COURIER_ORDERS.STEP_ACCEPTED' | translate }}</span></li>
              <li><i>2</i><span>{{ 'COURIER_ORDERS.STEP_ON_WAY' | translate }}</span></li>
              <li><i>3</i><span>{{ 'COURIER_ORDERS.STEP_DELIVERED' | translate }}</span></li>
            </ol>
          </section>

          @if (order()!.customer_name || order()!.customer_phone) {
            <section class="cd-card cd-person">
              <span class="cd-avatar" aria-hidden="true">{{ initial(order()!.customer_name) }}</span>
              <div class="cd-person-text">
                <small>{{ 'COURIER_ORDERS.CUSTOMER' | translate }}</small>
                <b>{{ order()!.customer_name || order()!.customer_phone }}</b>
                @if (order()!.customer_name && order()!.customer_phone) {
                  <span>{{ order()!.customer_phone }}</span>
                }
              </div>
              @if (order()!.customer_phone) {
                <a class="cd-call" [href]="'tel:' + order()!.customer_phone" [attr.aria-label]="'COURIER_ORDERS.CALL' | translate" [title]="'COURIER_ORDERS.CALL' | translate">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>
                </a>
              }
            </section>
          }

          <section class="cd-card cd-route">
            <ol class="cd-stops">
              <li class="cd-stop cd-stop-pickup">
                <span class="cd-pin" aria-hidden="true">A</span>
                <div>
                  <small>{{ 'COURIER_ORDERS.PICKUP' | translate }}</small>
                  @if (order()!.pickup_name) { <b>{{ order()!.pickup_name }}</b> }
                  <p>{{ order()!.pickup_address || ('COURIER_ORDERS.NO_ADDRESS' | translate) }}</p>
                </div>
              </li>
              <li class="cd-stop cd-stop-drop">
                <span class="cd-pin cd-pin-end" aria-hidden="true">B</span>
                <div>
                  <small>{{ 'COURIER_ORDERS.DELIVERY' | translate }}</small>
                  @if (order()!.delivery_address) {
                    <b>{{ order()!.delivery_address }}</b>
                    <a class="cd-maps" [href]="mapsUrl()" target="_blank" rel="noopener noreferrer">
                      {{ 'COURIER_ORDERS.OPEN_MAPS' | translate }} <i>→</i>
                    </a>
                  } @else {
                    <p>{{ 'COURIER_ORDERS.DELIVERY_ADDRESS_UNAVAILABLE' | translate }}</p>
                  }
                </div>
              </li>
            </ol>
            @if (order()!.delivery_notes) {
              <div class="cd-notes">
                <small>{{ 'COURIER_ORDERS.NOTES' | translate }}</small>
                <p>{{ order()!.delivery_notes }}</p>
              </div>
            }
            @if (order()!.external_order_ref) {
              <p class="cd-ref">{{ 'COURIER_ORDERS.EXTERNAL_REF' | translate }}: {{ order()!.external_order_ref }}</p>
            }
          </section>

          <section class="cd-card cd-items">
            <div class="cd-items-head">
              <p class="cd-eyebrow"><i></i>{{ 'COURIER_ORDERS.ITEMS' | translate }}</p>
              <span class="cd-count">{{ totalUnits() }}</span>
            </div>
            <ul>
              @for (item of order()!.items; track $index) {
                <li>
                  <span class="cd-qty">{{ item.quantity }}×</span>
                  <div>
                    <b>{{ item.product_name }}</b>
                    @if (item.notes) { <small>{{ item.notes }}</small> }
                  </div>
                </li>
              }
            </ul>
            <div class="cd-total">
              <span>{{ 'COURIER_ORDERS.TOTAL' | translate }}</span>
              <b>{{ formatMoney(order()!.total_cents) }}</b>
            </div>
          </section>

          @if (primaryActions().length || canReject()) {
            <div class="cd-dock-space"></div>
            <section class="cd-dock" aria-label="Order actions">
              @if (actionError()) {
                <p class="cd-error cd-dock-error">{{ actionError() | translate }}</p>
              }
              @if (canReject()) {
                <button type="button" class="cd-btn cd-btn-ghost" [disabled]="actionBusy()" (click)="runAction('reject')">
                  {{ 'COURIER_ORDERS.ACTION_REJECT' | translate }}
                </button>
              }
              @for (action of primaryActions(); track action) {
                <button type="button" class="cd-btn cd-btn-main" [disabled]="actionBusy()" (click)="runAction(action)">
                  {{ actionLabelKey(action) | translate }}<i aria-hidden="true">→</i>
                </button>
              }
            </section>
          }
        }
      </main>
    </div>

    @if (paymentPromptOpen()) {
      <div class="cd-backdrop" (click)="cancelDeliveredPrompt()">
        <div class="cd-sheet" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
          <span class="cd-grab" aria-hidden="true"></span>
          <h2>{{ 'COURIER_ORDERS.PAYMENT_PROMPT_TITLE' | translate }}</h2>
          <p class="cd-muted">{{ 'COURIER_ORDERS.PAYMENT_PROMPT_HINT' | translate }}</p>
          <div class="cd-pay">
            <button type="button" class="cd-pay-opt" [disabled]="actionBusy()" (click)="confirmDelivered('cash')">
              <span class="cd-pay-ico" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>
              </span>
              <b>{{ 'COURIER_ORDERS.PAYMENT_CASH' | translate }}</b>
            </button>
            <button type="button" class="cd-pay-opt" [disabled]="actionBusy()" (click)="confirmDelivered('transfer')">
              <span class="cd-pay-ico" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/></svg>
              </span>
              <b>{{ 'COURIER_ORDERS.PAYMENT_TRANSFER' | translate }}</b>
            </button>
          </div>
          <button type="button" class="cd-cancel" [disabled]="actionBusy()" (click)="cancelDeliveredPrompt()">
            {{ 'COMMON.CANCEL' | translate }}
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; background: #faf6f1; min-height: 100vh; }
    .cd { max-width: 560px; margin: 0 auto; min-height: 100vh; }
    .cd-bar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: color-mix(in srgb, #faf6f1 88%, transparent); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
    .cd-back { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; font-size: 1.25rem; text-decoration: none; color: var(--color-text); background: #fff; box-shadow: 0 10px 18px -12px rgba(23, 18, 16, 0.5), 0 0 0 1px rgba(193, 90, 30, 0.14); transition: transform 0.15s; &:active { transform: scale(0.92); } }
    .cd-chip { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 14px 0 12px; border-radius: 999px; font-size: 0.7rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #92400e; background: #fef3c7; i { width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; } }
    .cd-chip[data-status='preparing'], .cd-chip[data-status='out_for_delivery'] { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, #fff); i { background: var(--color-primary); } }
    .cd-chip[data-status='ready'], .cd-chip[data-status='paid'], .cd-chip[data-status='completed'] { color: #166534; background: #dcfce7; i { background: #22c55e; } }
    .cd-chip[data-status='cancelled'] { color: #6b7280; background: #f3f4f6; i { background: #9ca3af; } }

    .cd-main { padding: 4px 16px 32px; display: flex; flex-direction: column; gap: 14px; }
    .cd-eyebrow { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 0.62rem; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; color: var(--color-primary); i { width: 16px; height: 1.5px; background: currentColor; } }

    .cd-hero { padding: 24px 22px 20px; border-radius: 30px; color: #fff; background: radial-gradient(120% 90% at 100% 0, rgba(232, 154, 82, 0.35), transparent 60%), linear-gradient(160deg, #2a1d17, #160e0b); box-shadow: 0 26px 44px -26px rgba(23, 18, 16, 0.7); overflow: hidden; position: relative; }
    .cd-hero .cd-eyebrow { color: #f0a35e; }
    .cd-num { margin: 6px 0 0; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 500; font-size: 3rem; line-height: 1; letter-spacing: -0.03em; }
    .cd-created { margin: 8px 0 0; font-size: 0.82rem; color: rgba(255, 255, 255, 0.65); }
    .cd-steps { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 24px 6px 0; padding: 0; list-style: none; }
    .cd-steps::before { content: ''; position: absolute; top: 12px; left: 12px; right: 12px; height: 2px; background: repeating-linear-gradient(90deg, rgba(255,255,255,0.3) 0 6px, transparent 6px 10px); }
    .cd-steps::after { content: ''; position: absolute; top: 12px; left: 12px; width: 0; height: 2px; border-radius: 2px; background: #f0a35e; transition: width 0.5s cubic-bezier(0.2, 0.8, 0.2, 1); }
    .cd-steps[data-step='2']::after { width: calc(50% - 12px); }
    .cd-steps[data-step='3']::after { width: calc(100% - 24px); }
    .cd-steps li { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 7px; font-size: 0.6rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255, 255, 255, 0.55); }
    .cd-steps li:first-child { align-items: flex-start; }
    .cd-steps li:last-child { align-items: flex-end; }
    .cd-steps li i { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; font-style: normal; font-size: 0.72rem; background: #2a1d17; box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.3); }
    .cd-steps[data-step='1'] li:nth-child(-n+1), .cd-steps[data-step='2'] li:nth-child(-n+2), .cd-steps[data-step='3'] li { color: #fff; i { color: #2a1d17; background: #f0a35e; box-shadow: 0 0 0 4px rgba(240, 163, 94, 0.25); } }

    .cd-card { padding: 18px; border-radius: 26px; background: #fff; box-shadow: 0 20px 36px -26px rgba(23, 18, 16, 0.5), 0 0 0 1px rgba(193, 90, 30, 0.12); }
    .cd-person { display: flex; align-items: center; gap: 14px; }
    .cd-avatar { flex: none; display: grid; place-items: center; width: 52px; height: 52px; border-radius: 18px; font-family: Georgia, serif; font-style: italic; font-size: 1.5rem; color: #fff; background: linear-gradient(145deg, #e89a52, #b4551f); box-shadow: 0 12px 18px -12px rgba(120, 50, 10, 0.6); }
    .cd-person-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .cd-person-text small, .cd-stop small, .cd-notes small { font-size: 0.6rem; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-text-muted); }
    .cd-person-text b { font-size: 1.1rem; }
    .cd-person-text span { font-size: 0.86rem; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
    .cd-call { flex: none; display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; color: #fff; text-decoration: none; background: linear-gradient(145deg, #22c55e, #15803d); box-shadow: 0 14px 22px -12px #16a34a; transition: transform 0.15s; &:active { transform: scale(0.92); } }

    .cd-stops { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0; }
    .cd-stop { position: relative; display: flex; gap: 14px; padding-bottom: 20px; }
    .cd-stop:last-child { padding-bottom: 0; }
    .cd-stop:not(:last-child)::before { content: ''; position: absolute; left: 17px; top: 38px; bottom: 2px; border-left: 2px dashed color-mix(in srgb, var(--color-primary) 40%, transparent); }
    .cd-pin { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; font-weight: 800; font-size: 0.85rem; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, #fff); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-primary) 30%, transparent); }
    .cd-pin-end { color: #fff; background: linear-gradient(145deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #000)); box-shadow: 0 10px 16px -10px var(--color-primary); }
    .cd-stop div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .cd-stop b { font-family: Georgia, 'Times New Roman', serif; font-weight: 500; font-size: 1.12rem; line-height: 1.25; }
    .cd-stop p { margin: 0; font-size: 0.92rem; line-height: 1.4; color: var(--color-text-muted); }
    .cd-maps { align-self: flex-start; margin-top: 6px; display: inline-flex; align-items: center; gap: 8px; min-height: 38px; padding: 0 16px; border-radius: 999px; font-size: 0.82rem; font-weight: 800; text-decoration: none; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 9%, #fff); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-primary) 30%, transparent); i { font-style: normal; transition: transform 0.2s; } &:hover i { transform: translateX(3px); } }
    .cd-notes { margin-top: 16px; padding: 12px 14px; border-radius: 16px; background: #fffbeb; box-shadow: inset 0 0 0 1px #fde68a; small { color: #92400e; } p { margin: 4px 0 0; font-size: 0.92rem; line-height: 1.4; } }
    .cd-ref { margin: 12px 0 0; font-size: 0.8rem; color: var(--color-text-muted); }

    .cd-items-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .cd-count { display: grid; place-items: center; min-width: 28px; height: 28px; padding: 0 8px; border-radius: 14px; font-family: Georgia, serif; font-style: italic; font-weight: 700; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, #fff); }
    .cd-items ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .cd-items li { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; border-bottom: 1.5px dashed var(--color-border); }
    .cd-qty { flex: none; display: grid; place-items: center; min-width: 40px; height: 32px; padding: 0 6px; border-radius: 11px; font-family: Georgia, serif; font-style: italic; font-weight: 700; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 10%, #fff); }
    .cd-items li div { display: flex; flex-direction: column; gap: 2px; padding-top: 4px; }
    .cd-items li b { font-family: Georgia, serif; font-weight: 500; font-size: 1.05rem; line-height: 1.25; }
    .cd-items li small { font-size: 0.84rem; color: var(--color-text-muted); }
    .cd-total { display: flex; align-items: baseline; justify-content: space-between; padding-top: 14px; }
    .cd-total span { font-size: 0.66rem; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-text-muted); }
    .cd-total b { font-family: Georgia, serif; font-style: italic; font-weight: 500; font-size: 1.9rem; color: var(--color-primary); font-variant-numeric: tabular-nums; }

    .cd-dock-space { height: 96px; }
    .cd-dock { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: flex; gap: 10px; flex-wrap: wrap; max-width: 560px; margin: 0 auto; padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); background: linear-gradient(transparent, #faf6f1 40%); }
    .cd-dock-error { width: 100%; margin: 0; }
    .cd-btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 56px; padding: 0 22px; border: 0; border-radius: 999px; font: inherit; font-size: 1rem; font-weight: 800; cursor: pointer; transition: transform 0.15s, box-shadow 0.2s; &:active { transform: scale(0.97); } &:disabled { opacity: 0.6; cursor: default; } }
    .cd-btn-main { flex: 1; color: #fff; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #000)); box-shadow: 0 18px 28px -14px var(--color-primary); i { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; font-style: normal; background: rgba(255, 255, 255, 0.22); } }
    .cd-btn-ghost { color: #b91c1c; background: #fff; box-shadow: inset 0 0 0 1.5px #fecaca; }
    .cd-muted { color: var(--color-text-muted); text-align: center; }
    .cd-error { padding: 12px 16px; border-radius: 16px; color: #b91c1c; background: #fef2f2; font-size: 0.9rem; font-weight: 600; }

    .cd-backdrop { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: flex-end; justify-content: center; padding: 16px; background: rgba(23, 18, 16, 0.55); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); animation: cd-fade 0.2s ease-out; }
    .cd-sheet { width: 100%; max-width: 480px; padding: 12px 20px 22px; text-align: center; border-radius: 30px; background: #fffdfa; box-shadow: 0 40px 80px -24px rgba(23, 18, 16, 0.6); animation: cd-up 0.28s cubic-bezier(0.2, 0.8, 0.2, 1); }
    .cd-grab { display: block; width: 38px; height: 4px; margin: 0 auto 16px; border-radius: 2px; background: var(--color-border); }
    .cd-sheet h2 { margin: 0; font-family: Georgia, serif; font-style: italic; font-weight: 500; font-size: 1.8rem; letter-spacing: -0.02em; }
    .cd-sheet .cd-muted { margin: 6px auto 0; max-width: 32ch; font-size: 0.9rem; }
    .cd-pay { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0 8px; }
    .cd-pay-opt { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 20px 12px; border: 0; border-radius: 24px; font: inherit; cursor: pointer; background: #fff; box-shadow: inset 0 0 0 1.5px var(--color-border), 0 14px 24px -20px rgba(23, 18, 16, 0.5); transition: transform 0.15s, box-shadow 0.2s; &:hover { box-shadow: inset 0 0 0 2px var(--color-primary), 0 18px 28px -18px var(--color-primary); } &:active { transform: scale(0.96); } &:disabled { opacity: 0.6; } }
    .cd-pay-ico { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 20px; color: #fff; background: linear-gradient(145deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #000)); box-shadow: 0 14px 22px -12px var(--color-primary); }
    .cd-pay-opt b { font-size: 1rem; }
    .cd-cancel { width: 100%; min-height: 48px; border: 0; background: transparent; font: inherit; font-weight: 700; color: var(--color-text-muted); cursor: pointer; }
    @keyframes cd-fade { from { opacity: 0; } }
    @keyframes cd-up { from { transform: translateY(24px); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .cd-backdrop, .cd-sheet { animation: none; } }
  `]
})
export class CourierOrderDetailComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);

  loading = signal(true);
  error = signal('');
  order = signal<CourierOrderDetail | null>(null);
  actionBusy = signal(false);
  actionError = signal('');
  paymentPromptOpen = signal(false);

  private allowed = computed(() => new Set(this.order()?.allowed_actions ?? []));

  primaryActions = computed(() => {
    const order: CourierOrderAction[] = ['accept', 'picked_up', 'delivered'];
    return order.filter((a) => this.allowed().has(a));
  });

  canReject = computed(() => this.allowed().has('reject'));

  /** 0 = not accepted yet, 1 = accepted, 2 = on the way, 3 = delivered. */
  step = computed(() => {
    const o = this.order();
    if (!o) return 0;
    if (['paid', 'completed'].includes(o.status)) return 3;
    if (o.status === 'out_for_delivery') return 2;
    return o.courier_user_id != null ? 1 : 0;
  });

  totalUnits = computed(() => (this.order()?.items ?? []).reduce((n, i) => n + i.quantity, 0));

  mapsUrl = computed(
    () =>
      'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent(this.order()?.delivery_address ?? '')
  );

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      this.loading.set(false);
      this.error.set('COURIER_ORDERS.NOT_FOUND');
      return;
    }
    this.loadOrder(id);
  }

  runAction(action: CourierOrderAction): void {
    if (this.actionBusy()) {
      return;
    }
    // Delivered requires the courier to say how they collected payment first.
    if (action === 'delivered') {
      this.actionError.set('');
      this.paymentPromptOpen.set(true);
      return;
    }
    this.executeAction(action);
  }

  confirmDelivered(paymentMethod: CourierDeliveryPaymentMethod): void {
    this.paymentPromptOpen.set(false);
    this.executeAction('delivered', paymentMethod);
  }

  cancelDeliveredPrompt(): void {
    this.paymentPromptOpen.set(false);
  }

  private executeAction(action: CourierOrderAction, paymentMethod?: CourierDeliveryPaymentMethod): void {
    const current = this.order();
    if (!current || this.actionBusy()) {
      return;
    }
    this.actionBusy.set(true);
    this.actionError.set('');
    this.api.courierOrderAction(current.id, action, paymentMethod).subscribe({
      next: (detail) => {
        this.order.set(detail);
        this.actionBusy.set(false);
      },
      error: (err) => {
        this.actionBusy.set(false);
        this.actionError.set(
          err.status === 400 ? 'COURIER_ORDERS.ACTION_NOT_ALLOWED' : 'COURIER_ORDERS.ACTION_FAILED'
        );
      },
    });
  }

  actionLabelKey(action: CourierOrderAction): string {
    return `COURIER_ORDERS.ACTION_${action.toUpperCase()}`;
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

  private loadOrder(id: number): void {
    this.loading.set(true);
    this.api.getCourierOrder(id).subscribe({
      next: (detail) => {
        this.order.set(detail);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.status === 404 ? 'COURIER_ORDERS.NOT_FOUND' : 'COURIER_ORDERS.LOAD_FAILED');
      },
    });
  }
}
