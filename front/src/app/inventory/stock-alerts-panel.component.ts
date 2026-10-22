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
            <span class="sa-count" [attr.title]="'INVENTORY.ALERTS.TITLE' | translate">{{ attention() }}</span>
          }
        </header>

        <ul class="sa-list">
          @for (a of alerts(); track a.id) {
            <li class="sa-card" [attr.data-kind]="a.kind" [attr.data-status]="a.status" [class.done]="!a.needs_attention">
              <div class="sa-main">
                <div class="sa-top">
                  <span class="sa-badge"><i></i>{{ badgeKey(a) | translate }}</span>
                  <p class="sa-name">{{ a.item.name }}</p>
                </div>
                <p class="sa-text">{{ textKey(a) | translate: params(a) }}</p>

                <div class="sa-meter" [attr.aria-label]="qty(a.item.current_quantity) + ' ' + unit(a.item.unit)">
                  <div class="sa-track">
                    <i class="sa-fill" [style.width.%]="meterPct(a)"></i>
                    @if (a.item.reorder_level > 0) {
                      <b class="sa-min" [style.left.%]="minPct(a)" [attr.title]="'INVENTORY.ALERTS.MIN_LABEL' | translate: params(a)"></b>
                    }
                  </div>
                  <div class="sa-scale">
                    <span>0</span>
                    @if (a.item.reorder_level > 0) {
                      <span class="sa-scale-min" [style.left.%]="minPct(a)">{{ 'INVENTORY.ALERTS.MIN_LABEL' | translate: params(a) }}</span>
                    }
                  </div>
                </div>

                @if (a.products.length > 0) {
                  <ul class="sa-dishes" [attr.aria-label]="'INVENTORY.ALERTS.AFFECTED' | translate">
                    @for (p of a.products; track p.id) {
                      <li [class.out]="p.withdrawn">
                        <i aria-hidden="true">{{ initial(p.name) }}</i>
                        <span>{{ p.name }}</span>
                        @if (p.withdrawn) { <small>{{ 'INVENTORY.ALERTS.WITHDRAWN_TAG' | translate }}</small> }
                      </li>
                    }
                  </ul>
                }

                @if (a.kind === 'out' && a.status === 'open') {
                  <p class="sa-hint">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>
                    {{ 'INVENTORY.ALERTS.OUT_HINT' | translate }}
                  </p>
                }
              </div>

              <aside class="sa-side">
                <p class="sa-big" [attr.data-kind]="a.kind">
                  <b>{{ qty(a.item.current_quantity) }}</b>
                  <span>{{ unit(a.item.unit) }}</span>
                </p>
                @if (a.item.suggested_order_quantity > 0 && a.status !== 'restocked') {
                  <p class="sa-suggest">{{ 'INVENTORY.ALERTS.SUGGEST' | translate: params(a) }}</p>
                }
              </aside>

              <footer class="sa-actions">
                @if (a.status !== 'restocked') {
                  <a class="sa-link" routerLink="/inventory/purchase-orders">{{ 'INVENTORY.ALERTS.ACT_RECEIVE' | translate }}<i aria-hidden="true">→</i></a>
                }
                <span class="sa-spacer"></span>
                @if (a.kind === 'out' && a.status === 'open') {
                  <button type="button" class="sa-btn" [disabled]="busy() === a.id" (click)="keep(a)">{{ 'INVENTORY.ALERTS.ACT_KEEP' | translate }}</button>
                  <button type="button" class="sa-btn sa-btn-danger" [disabled]="busy() === a.id" (click)="withdraw(a)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.1 10.1 0 0112 20c-7 0-11-8-11-8a18.5 18.5 0 015.1-5.9M9.9 4.2A9.1 9.1 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.2 3.2M1 1l22 22"/></svg>
                    {{ 'INVENTORY.ALERTS.ACT_WITHDRAW' | translate }}
                  </button>
                }
                @if (a.kind === 'low' && a.status === 'open') {
                  <button type="button" class="sa-btn" [disabled]="busy() === a.id" (click)="keep(a)">{{ 'INVENTORY.ALERTS.ACT_ACK' | translate }}</button>
                }
                @if (a.status === 'restocked' || (a.status === 'withdrawn' && hasWithdrawn(a))) {
                  <button type="button" class="sa-btn sa-btn-main" [disabled]="busy() === a.id" (click)="offerAgain(a)">{{ 'INVENTORY.ALERTS.ACT_OFFER' | translate }}</button>
                }
              </footer>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .sa { margin: 0 0 var(--space-5, 1.25rem); padding: 24px 24px 20px; border-radius: 28px; background: #fff; box-shadow: 0 24px 44px -30px rgba(23, 18, 16, .5), 0 0 0 1px color-mix(in srgb, var(--color-primary) 18%, transparent); }
    .sa-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
    .sa-eyebrow { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-size: .62rem; font-weight: 800; letter-spacing: .2em; text-transform: uppercase; color: var(--color-primary); }
    .sa-eyebrow i { width: 16px; height: 1.5px; background: currentColor; }
    .sa h2 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 500; font-size: 1.7rem; letter-spacing: -.02em; line-height: 1.1; }
    .sa-sub { margin: 6px 0 0; font-size: .88rem; color: var(--color-text-muted); max-width: 62ch; }
    .sa-count { flex: none; display: grid; place-items: center; min-width: 36px; height: 36px; padding: 0 11px; border-radius: 18px; font-family: Georgia, serif; font-style: italic; font-weight: 700; font-size: 1.1rem; color: #fff; background: linear-gradient(145deg, #ef4444, #b91c1c); box-shadow: 0 12px 18px -8px #dc2626; }
    .sa-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }

    /* ---- one notice = a ticket: info on the left, the stock figure on the right, decision bar below ---- */
    .sa-card { --tone: var(--color-primary); --tint: #fdf6ef; position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 20px; padding: 20px 22px 0; border-radius: 22px; background: var(--tint); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--tone) 30%, transparent); overflow: hidden; }
    .sa-card[data-kind='out'] { --tone: #dc2626; --tint: #fff5f4; }
    .sa-card[data-kind='low'] { --tone: #d97706; --tint: #fffaf0; }
    .sa-card[data-status='restocked'] { --tone: #16a34a; --tint: #f3fbf6; }
    .sa-card[data-status='withdrawn'], .sa-card[data-status='kept'] { --tone: #8a7b6f; --tint: #faf7f3; }
    .sa-card.done { opacity: .85; }
    .sa-main { min-width: 0; }
    .sa-top { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
    .sa-badge { display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 12px 0 10px; border-radius: 999px; font-size: .64rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--tone); background: color-mix(in srgb, var(--tone) 14%, #fff); }
    .sa-badge i { width: 7px; height: 7px; border-radius: 50%; background: var(--tone); box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone) 22%, transparent); }
    .sa-name { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-weight: 500; font-size: 1.45rem; line-height: 1.15; letter-spacing: -.01em; text-transform: capitalize; }
    .sa-text { margin: 10px 0 0; font-size: .92rem; line-height: 1.45; color: var(--color-text); max-width: 58ch; }

    .sa-meter { margin-top: 14px; max-width: 420px; }
    .sa-track { position: relative; height: 10px; border-radius: 999px; background: color-mix(in srgb, var(--tone) 12%, #fff); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 22%, transparent); }
    .sa-fill { position: absolute; left: 0; top: 0; bottom: 0; min-width: 0; border-radius: 999px; background: linear-gradient(90deg, color-mix(in srgb, var(--tone) 70%, #fff), var(--tone)); transition: width .6s cubic-bezier(.2, .8, .2, 1); }
    .sa-min { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--color-text); opacity: .55; }
    .sa-scale { position: relative; display: flex; justify-content: space-between; margin-top: 6px; font-size: .66rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-muted); height: 12px; }
    .sa-scale-min { position: absolute; transform: translateX(-50%); white-space: nowrap; }

    .sa-dishes { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 0; padding: 0; }
    .sa-dishes li { display: inline-flex; align-items: center; gap: 8px; padding: 4px 14px 4px 4px; border-radius: 999px; font-size: .84rem; font-weight: 700; background: #fff; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--tone) 22%, var(--color-border)); }
    .sa-dishes i { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; font-style: normal; font-family: Georgia, serif; font-size: .9rem; color: #fff; background: linear-gradient(145deg, #e89a52, #b4551f); }
    .sa-dishes li.out { color: var(--color-text-muted); }
    .sa-dishes li.out span { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--tone) 50%, transparent); }
    .sa-dishes li.out i { filter: grayscale(1); opacity: .6; }
    .sa-dishes small { font-size: .62rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--tone); }
    .sa-hint { display: flex; align-items: flex-start; gap: 8px; margin: 14px 0 0; padding: 10px 12px; border-radius: 14px; font-size: .84rem; line-height: 1.4; color: var(--color-text-muted); background: rgba(255, 255, 255, .7); }
    .sa-hint svg { flex: none; margin-top: 2px; color: var(--tone); }

    .sa-side { align-self: start; text-align: right; padding-top: 2px; }
    .sa-big { margin: 0; display: flex; align-items: baseline; justify-content: flex-end; gap: 6px; line-height: 1; color: var(--tone); }
    .sa-big b { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 500; font-size: 3rem; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
    .sa-big span { font-size: .8rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--color-text-muted); }
    .sa-suggest { margin: 8px 0 0; max-width: 16ch; margin-left: auto; font-size: .74rem; line-height: 1.35; color: var(--color-text-muted); }

    .sa-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 18px -22px 0; padding: 14px 22px; border-top: 1.5px dashed color-mix(in srgb, var(--tone) 35%, transparent); background: rgba(255, 255, 255, .55); }
    .sa-spacer { flex: 1; }
    .sa-link { display: inline-flex; align-items: center; gap: 8px; padding: 8px 4px; font-size: .86rem; font-weight: 800; text-decoration: none; color: var(--color-primary); }
    .sa-link i { font-style: normal; transition: transform .2s; }
    .sa-link:hover i { transform: translateX(3px); }
    .sa-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px; padding: 0 18px; border: 0; border-radius: 999px; font: inherit; font-size: .86rem; font-weight: 800; color: var(--color-text); background: #fff; box-shadow: inset 0 0 0 1.5px var(--color-border); cursor: pointer; transition: transform .15s, box-shadow .2s, background .2s, color .2s; }
    .sa-btn:hover:not(:disabled) { box-shadow: inset 0 0 0 1.5px var(--color-text); }
    .sa-btn:active:not(:disabled) { transform: scale(.97); }
    .sa-btn:disabled { opacity: .55; cursor: progress; }
    .sa-btn-danger { color: #fff; background: linear-gradient(135deg, #ef4444, #b91c1c); box-shadow: 0 14px 20px -14px #dc2626; }
    .sa-btn-danger:hover:not(:disabled) { box-shadow: 0 14px 20px -12px #dc2626; }
    .sa-btn-main { color: #fff; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #000)); box-shadow: 0 14px 20px -14px var(--color-primary); }
    .sa-btn-main:hover:not(:disabled) { box-shadow: 0 14px 20px -12px var(--color-primary); }

    @media (max-width: 640px) {
      .sa { padding: 18px 14px 14px; border-radius: 22px; }
      .sa-card { grid-template-columns: minmax(0, 1fr); padding: 16px 16px 0; }
      .sa-side { order: -1; text-align: left; margin-bottom: 6px; }
      .sa-big { justify-content: flex-start; }
      .sa-big b { font-size: 2.3rem; }
      .sa-suggest { margin-left: 0; max-width: none; }
      .sa-actions { margin: 16px -16px 0; padding: 12px 16px; }
      .sa-btn { flex: 1 1 auto; }
      .sa-spacer { display: none; }
      .sa-link { flex: 1 1 100%; justify-content: center; order: 3; }
    }
    @media (prefers-reduced-motion: reduce) { .sa-fill { transition: none; } .sa-link i, .sa-btn { transition: none; } }
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

  /** The meter spans 0 .. twice the minimum level (or the current stock when that is larger). */
  private scale(a: StockAlert): number {
    const { current_quantity: cur, reorder_level: min } = a.item;
    return Math.max(min * 2, cur, 1);
  }

  meterPct(a: StockAlert): number {
    return Math.max(0, Math.min(100, (a.item.current_quantity / this.scale(a)) * 100));
  }

  minPct(a: StockAlert): number {
    return Math.max(0, Math.min(100, (a.item.reorder_level / this.scale(a)) * 100));
  }

  initial(name: string): string {
    return (name.trim().charAt(0) || '?').toUpperCase();
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
