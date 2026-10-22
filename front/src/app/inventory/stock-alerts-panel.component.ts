import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { InventoryService } from './inventory.service';
import { StockAlert } from './inventory.types';
import { StockAlertsService } from './stock-alerts.service';
import { unitShort } from './unit-select-options';

/**
 * Notices for the administrator: an ingredient ran out (and which dishes it affects) or is running
 * low. Nothing is hidden from the menu automatically: the admin withdraws the dishes, keeps
 * selling them (stock may have arrived without being registered) or registers the incoming stock.
 */
@Component({
  selector: 'app-stock-alerts-panel',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  template: `
    @if (alerts().length > 0) {
      <section class="sa" aria-live="polite" data-testid="stock-alerts-panel">
        <header class="sa-head">
          <div>
            <p class="sa-eyebrow"><i></i>{{ 'INVENTORY.ALERTS.EYEBROW' | translate }}</p>
            <h2>{{ 'INVENTORY.ALERTS.TITLE' | translate }}</h2>
            <p class="sa-sub">{{ 'INVENTORY.ALERTS.SUBTITLE' | translate }}</p>
          </div>
          @if (attention() > 0) {
            <span class="sa-count">{{ attention() }}</span>
          }
        </header>

        <ul class="sa-list">
          @for (a of alerts(); track a.id) {
            <li class="sa-card" [attr.data-kind]="a.kind" [attr.data-status]="a.status" [class.done]="!a.needs_attention">
              <div class="sa-top">
                <span class="sa-badge">
                  <i></i>{{ badgeKey(a) | translate }}
                </span>
                <h3>{{ a.item.name }}</h3>
                <span class="sa-qty">{{ qty(a.item.current_quantity) }} {{ unit(a.item.unit) }}</span>
              </div>

              <p class="sa-text">{{ textKey(a) | translate: params(a) }}</p>

              @if (a.products.length > 0) {
                <ul class="sa-dishes" [attr.aria-label]="'INVENTORY.ALERTS.AFFECTED' | translate">
                  @for (p of a.products; track p.id) {
                    <li [class.out]="p.withdrawn">{{ p.name }}@if (p.withdrawn) { <small>{{ 'INVENTORY.ALERTS.WITHDRAWN_TAG' | translate }}</small> }</li>
                  }
                </ul>
              }

              @if (a.kind === 'out' && a.status === 'open') {
                <p class="sa-hint">{{ 'INVENTORY.ALERTS.OUT_HINT' | translate }}</p>
              }

              <div class="sa-actions">
                @if (a.kind === 'out' && a.status === 'open') {
                  <button type="button" class="sa-btn sa-btn-danger" [disabled]="busy() === a.id" (click)="withdraw(a)">{{ 'INVENTORY.ALERTS.ACT_WITHDRAW' | translate }}</button>
                  <button type="button" class="sa-btn" [disabled]="busy() === a.id" (click)="keep(a)">{{ 'INVENTORY.ALERTS.ACT_KEEP' | translate }}</button>
                }
                @if (a.kind === 'low' && a.status === 'open') {
                  <button type="button" class="sa-btn" [disabled]="busy() === a.id" (click)="keep(a)">{{ 'INVENTORY.ALERTS.ACT_ACK' | translate }}</button>
                }
                @if (a.status === 'restocked' || (a.status === 'withdrawn' && hasWithdrawn(a))) {
                  <button type="button" class="sa-btn sa-btn-main" [disabled]="busy() === a.id" (click)="offerAgain(a)">{{ 'INVENTORY.ALERTS.ACT_OFFER' | translate }}</button>
                }
                @if (a.status !== 'restocked') {
                  <a class="sa-btn sa-btn-ghost" routerLink="/inventory/purchase-orders">{{ 'INVENTORY.ALERTS.ACT_RECEIVE' | translate }}<i aria-hidden="true">→</i></a>
                }
              </div>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .sa { margin: 0 0 var(--space-5, 1.25rem); padding: 22px 22px 18px; border-radius: 26px; background: #fff; box-shadow: 0 22px 40px -28px rgba(23, 18, 16, .5), 0 0 0 1px color-mix(in srgb, var(--color-primary) 18%, transparent); }
    .sa-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .sa-eyebrow { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-size: .62rem; font-weight: 800; letter-spacing: .2em; text-transform: uppercase; color: var(--color-primary); }
    .sa-eyebrow i { width: 16px; height: 1.5px; background: currentColor; }
    .sa h2 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 500; font-size: 1.6rem; letter-spacing: -.02em; }
    .sa-sub { margin: 4px 0 0; font-size: .88rem; color: var(--color-text-muted); max-width: 60ch; }
    .sa-count { flex: none; display: grid; place-items: center; min-width: 34px; height: 34px; padding: 0 10px; border-radius: 17px; font-family: Georgia, serif; font-style: italic; font-weight: 700; font-size: 1.05rem; color: #fff; background: linear-gradient(145deg, #ef4444, #b91c1c); box-shadow: 0 10px 16px -8px #dc2626; }
    .sa-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .sa-card { padding: 14px 16px; border-radius: 20px; background: color-mix(in srgb, var(--color-primary) 4%, #fff); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 14%, transparent); }
    .sa-card[data-kind='out'][data-status='open'] { background: #fff6f5; box-shadow: inset 0 0 0 1.5px #f6c9c5; }
    .sa-card[data-kind='low'][data-status='open'] { background: #fffaf0; box-shadow: inset 0 0 0 1.5px #f6e0a8; }
    .sa-card[data-status='restocked'] { background: #f2fbf5; box-shadow: inset 0 0 0 1.5px #bfe5cb; }
    .sa-card.done { opacity: .78; }
    .sa-top { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
    .sa-top h3 { margin: 0; flex: 1 1 8rem; min-width: 0; font-family: Georgia, serif; font-weight: 500; font-size: 1.25rem; line-height: 1.2; }
    .sa-badge { display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 12px 0 10px; border-radius: 999px; font-size: .66rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #92400e; background: #fef3c7; }
    .sa-badge i { width: 7px; height: 7px; border-radius: 50%; background: #f59e0b; }
    .sa-card[data-kind='out'] .sa-badge { color: #b91c1c; background: #fee2e2; }
    .sa-card[data-kind='out'] .sa-badge i { background: #ef4444; }
    .sa-card[data-status='restocked'] .sa-badge { color: #166534; background: #dcfce7; }
    .sa-card[data-status='restocked'] .sa-badge i { background: #22c55e; }
    .sa-card[data-status='withdrawn'] .sa-badge, .sa-card[data-status='kept'] .sa-badge { color: #57493f; background: #f1ece6; }
    .sa-card[data-status='withdrawn'] .sa-badge i, .sa-card[data-status='kept'] .sa-badge i { background: #9a8b7e; }
    .sa-qty { font-family: Georgia, serif; font-style: italic; font-size: 1.15rem; color: var(--color-primary); font-variant-numeric: tabular-nums; }
    .sa-text { margin: 8px 0 0; font-size: .92rem; line-height: 1.45; }
    .sa-dishes { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; padding: 0; }
    .sa-dishes li { padding: 5px 12px; border-radius: 999px; font-size: .82rem; font-weight: 700; background: #fff; box-shadow: inset 0 0 0 1.5px var(--color-border); }
    .sa-dishes li.out { color: #b91c1c; box-shadow: inset 0 0 0 1.5px #f6c9c5; text-decoration: line-through; text-decoration-color: #f0a29c; }
    .sa-dishes small { margin-left: 6px; font-size: .66rem; text-transform: uppercase; letter-spacing: .06em; text-decoration: none; display: inline-block; }
    .sa-hint { margin: 10px 0 0; font-size: .82rem; color: var(--color-text-muted); }
    .sa-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .sa-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 0 16px; border: 0; border-radius: 999px; font: inherit; font-size: .85rem; font-weight: 800; text-decoration: none; color: var(--color-text); background: #fff; box-shadow: inset 0 0 0 1.5px var(--color-border); cursor: pointer; transition: transform .15s, box-shadow .2s, background .2s, color .2s; }
    .sa-btn:hover:not(:disabled) { box-shadow: inset 0 0 0 1.5px var(--color-primary); color: var(--color-primary); }
    .sa-btn:active:not(:disabled) { transform: scale(.97); }
    .sa-btn:disabled { opacity: .55; cursor: progress; }
    .sa-btn-danger { color: #fff; background: #dc2626; box-shadow: none; }
    .sa-btn-danger:hover:not(:disabled) { color: #fff; background: #b91c1c; box-shadow: none; }
    .sa-btn-main { color: #fff; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #000)); box-shadow: 0 12px 18px -12px var(--color-primary); }
    .sa-btn-main:hover:not(:disabled) { color: #fff; box-shadow: 0 14px 20px -10px var(--color-primary); }
    .sa-btn-ghost { background: transparent; box-shadow: none; color: var(--color-primary); padding: 0 6px; }
    .sa-btn-ghost i { font-style: normal; transition: transform .2s; }
    .sa-btn-ghost:hover { box-shadow: none; }
    .sa-btn-ghost:hover i { transform: translateX(3px); }
    @media (max-width: 560px) { .sa { padding: 18px 14px 14px; border-radius: 22px; } .sa-btn { flex: 1 1 100%; } .sa-btn-ghost { flex: none; } }
  `],
})
export class StockAlertsPanelComponent implements OnInit {
  private inventory = inject(InventoryService);
  private store = inject(StockAlertsService);

  readonly alerts = this.store.alerts;
  readonly attention = this.store.attentionCount;
  readonly busy = signal<number | null>(null);

  ngOnInit(): void {
    this.store.refresh();
  }

  badgeKey(a: StockAlert): string {
    if (a.status === 'restocked') return 'INVENTORY.ALERTS.BADGE_RESTOCKED';
    if (a.status === 'withdrawn') return 'INVENTORY.ALERTS.BADGE_WITHDRAWN';
    if (a.status === 'kept') return 'INVENTORY.ALERTS.BADGE_KEPT';
    return a.kind === 'out' ? 'INVENTORY.ALERTS.BADGE_OUT' : 'INVENTORY.ALERTS.BADGE_LOW';
  }

  textKey(a: StockAlert): string {
    if (a.status === 'restocked') return 'INVENTORY.ALERTS.TEXT_RESTOCKED';
    if (a.kind === 'out') return 'INVENTORY.ALERTS.TEXT_OUT';
    return 'INVENTORY.ALERTS.TEXT_LOW';
  }

  params(a: StockAlert): Record<string, string | number> {
    return {
      name: a.item.name,
      qty: this.qty(a.item.current_quantity),
      unit: this.unit(a.item.unit),
      min: this.qty(a.item.reorder_level),
      suggested: this.qty(a.item.suggested_order_quantity),
    };
  }

  qty(n: number): string {
    return Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  }

  unit(u: string): string {
    return unitShort(u as never) || u;
  }

  hasWithdrawn(a: StockAlert): boolean {
    return a.products.some((p) => p.withdrawn);
  }

  withdraw(a: StockAlert): void {
    this.run(a, this.inventory.withdrawAlertProducts(a.id));
  }

  keep(a: StockAlert): void {
    this.run(a, this.inventory.keepAlertProducts(a.id));
  }

  offerAgain(a: StockAlert): void {
    this.run(a, this.inventory.offerAlertProductsAgain(a.id));
  }

  private run(a: StockAlert, call: ReturnType<InventoryService['withdrawAlertProducts']>): void {
    this.busy.set(a.id);
    call.subscribe({
      next: () => {
        this.busy.set(null);
        this.store.refresh();
      },
      error: () => this.busy.set(null),
    });
  }
}
