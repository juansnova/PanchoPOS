import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ChangeDetectionStrategy,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService, KitchenDisplaySettings, KitchenStation, Order, OrderItem, OrderLineModifiers } from '../services/api.service';
import { AudioService } from '../services/audio.service';
import { PermissionService } from '../services/permission.service';
import { Subscription } from 'rxjs';
import { FocusFirstInputDirective } from '../shared/focus-first-input.directive';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

const REFRESH_INTERVAL_MS = 15000;
const SOUND_STORAGE_KEY = 'kitchen-display-sound';

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  mozCancelFullScreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};

function getFullscreenElement(): Element | null {
  const d = document as FullscreenDocument;
  return (
    document.fullscreenElement ??
    d.webkitFullscreenElement ??
    d.mozFullScreenElement ??
    d.msFullscreenElement ??
    null
  );
}

function requestFullscreenOnElement(el: HTMLElement): Promise<void> | void {
  const e = el as FullscreenCapableElement;
  if (typeof e.requestFullscreen === 'function') {
    return e.requestFullscreen();
  }
  if (typeof e.webkitRequestFullscreen === 'function') {
    return Promise.resolve(e.webkitRequestFullscreen());
  }
  if (typeof e.mozRequestFullScreen === 'function') {
    return Promise.resolve(e.mozRequestFullScreen());
  }
  if (typeof e.msRequestFullscreen === 'function') {
    return Promise.resolve(e.msRequestFullscreen());
  }
}

function exitDocumentFullscreen(): Promise<void> | void {
  const d = document as FullscreenDocument;
  if (typeof document.exitFullscreen === 'function') {
    return document.exitFullscreen();
  }
  if (typeof d.webkitExitFullscreen === 'function') {
    return Promise.resolve(d.webkitExitFullscreen());
  }
  if (typeof d.mozCancelFullScreen === 'function') {
    return Promise.resolve(d.mozCancelFullScreen());
  }
  if (typeof d.msExitFullscreen === 'function') {
    return Promise.resolve(d.msExitFullscreen());
  }
}

/** Category filter used only for the bar view; kitchen shows every category. */
const VIEW_CATEGORY: Record<string, string> = {
  kitchen: 'Main Course',
  bar: 'Beverages',
};

@Component({
  selector: 'app-kitchen-display',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslateModule, FormsModule, FocusFirstInputDirective],
  template: `
    <div class="kitchen-view" #kitchenRoot>
      <header class="kitchen-header">
        <a routerLink="/staff/orders" class="back-link">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15,18 9,12 15,6"/>
          </svg>
          {{ 'KITCHEN_DISPLAY.BACK_TO_ORDERS' | translate }}
        </a>
        <div class="kd-title-wrap">
          <h1 class="kitchen-title">{{ pageTitle() }}</h1>
          <div class="kd-stats" data-testid="kitchen-stats">
            <span class="kd-stat kd-stat-pending"><i></i><b>{{ orderCounts().pending }}</b> {{ 'KITCHEN_DISPLAY.STAT_PENDING' | translate }}</span>
            <span class="kd-stat kd-stat-preparing"><i></i><b>{{ orderCounts().preparing }}</b> {{ 'KITCHEN_DISPLAY.STAT_PREPARING' | translate }}</span>
            <span class="kd-stat kd-stat-ready"><i></i><b>{{ orderCounts().ready }}</b> {{ 'KITCHEN_DISPLAY.STAT_READY' | translate }}</span>
          </div>
        </div>
        <div class="header-actions">
          @if (stationsForCurrentView().length > 0) {
            <label class="station-filter">
              <span class="station-filter-label">{{ 'KITCHEN_DISPLAY.STATION' | translate }}</span>
              <select
                class="station-filter-select"
                [ngModel]="stationSelection()"
                (ngModelChange)="onStationSelectChange($event)"
              >
                <option [ngValue]="'all'">{{ 'KITCHEN_DISPLAY.ALL_STATIONS' | translate }}</option>
                @for (s of stationsForCurrentView(); track s.id) {
                  <option [ngValue]="s.id">{{ s.name }}</option>
                }
              </select>
            </label>
          }
          <button
            type="button"
            class="fullscreen-btn"
            data-testid="kitchen-fullscreen-toggle"
            (click)="toggleFullscreen()"
            [title]="(isFullscreen() ? 'COMMON.EXIT_FULLSCREEN' : 'COMMON.ENTER_FULLSCREEN') | translate"
          >
            @if (isFullscreen()) {
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
              </svg>
              {{ 'COMMON.EXIT_FULLSCREEN' | translate }}
            } @else {
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
              </svg>
              {{ 'COMMON.ENTER_FULLSCREEN' | translate }}
            }
          </button>
          <button type="button" class="timer-settings-btn" (click)="openTimerSettingsModal()" [title]="'KITCHEN_DISPLAY.TIMER_SETTINGS' | translate">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            {{ 'KITCHEN_DISPLAY.TIMER_SETTINGS' | translate }}
          </button>
          <label class="sound-toggle">
            <input type="checkbox" [checked]="soundEnabled()" (change)="toggleSound($event)" />
            <span class="sound-label">{{ soundEnabled() ? ('KITCHEN_DISPLAY.SOUND_ON' | translate) : ('KITCHEN_DISPLAY.SOUND_OFF' | translate) }}</span>
          </label>
          <span class="kd-clock" aria-hidden="true">{{ clockLabel() }}</span>
          <span class="last-refresh" [title]="lastRefreshExact()">{{ 'KITCHEN_DISPLAY.LAST_REFRESH' | translate }}: {{ lastRefreshRelative() }}</span>
        </div>
      </header>

      <main class="kitchen-main">
        @if (loading()) {
          <div class="empty-state">
            <p>{{ 'ORDERS.LOADING' | translate }}</p>
          </div>
        } @else if (activeOrders().length === 0) {
          <div class="empty-state">
            <div class="empty-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
              </svg>
            </div>
            <h2>{{ 'KITCHEN_DISPLAY.NO_ACTIVE_ORDERS' | translate }}</h2>
            <p>{{ 'KITCHEN_DISPLAY.NO_ACTIVE_ORDERS_DESC' | translate }}</p>
          </div>
        } @else {
          <div class="order-grid">
            @for (order of activeOrders(); track order.id) {
              <article class="order-card status-{{ order.status }} {{ getTimerColorClass(order) }}" [class.order-card-urgent]="order.staff_urgent">
                <div class="order-header">
                  <div class="order-meta">
                    <span class="order-id">#{{ order.id }}</span>
                    <span class="order-table">{{ order.table_name }}</span>
                    @if (order.staff_urgent) {
                      <span class="urgent-badge">{{ 'KITCHEN_DISPLAY.URGENT' | translate }}</span>
                    }
                    @if (order.customer_name) {
                      <span class="order-customer">{{ 'ORDERS.CUSTOMER' | translate }}: {{ order.customer_name }}</span>
                    }
                    <span class="order-time" [title]="formatExactTime(order.created_at)">{{ formatOrderTime(order.created_at) }}</span>
                    <span class="order-waiting" [title]="formatExactTime(order.created_at)">{{ 'KITCHEN_DISPLAY.WAITING' | translate }}: {{ formatWaitingTime(order.created_at) }}</span>
                  </div>
                  <span class="status-badge status-{{ order.status }}">{{ getStatusLabel(order.status) }}</span>
                </div>
                <div class="order-timer-bar-wrap" [attr.aria-label]="'KITCHEN_DISPLAY.TIMER_BAR_HINT' | translate">
                  <div class="order-timer-bar-track">
                    <div class="order-timer-bar-fill" [class]="getTimerBarFillClass(order)" [style.width.%]="getTimerBarPercent(order)"></div>
                  </div>
                </div>
                <ul class="order-items">
                  @for (item of getSortedItems(order.items); track item.id) {
                    @if (!item.removed_by_customer) {
                      <li class="order-item">
                        <span class="item-qty">{{ item.quantity }}×</span>
                        <span class="item-name">{{ item.product_name }}</span>
                        @if (hasCustomization(item)) {
                          <span class="item-customization">{{ formatCustomizationItem(item) }}</span>
                        }
                        @if (item.notes) {
                          <span class="item-notes"><strong>{{ 'KITCHEN_DISPLAY.ITEM_COMMENT' | translate }}:</strong> {{ item.notes }}</span>
                        }
                        @if (canUpdateItemStatus() && item.id != null && item.status !== 'delivered' && item.status !== 'cancelled') {
                          <div class="item-status-control">
                            <button
                              type="button"
                              class="item-status-badge clickable"
                              [class]="'status-' + (item.status || 'pending')"
                              (click)="toggleItemStatusDropdown(order.id, item.id!)"
                              [title]="'ORDERS.CLICK_TO_CHANGE_STATUS' | translate">
                              {{ getItemStatusLabel(item.status || 'pending') }}
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6,9 12,15 18,9"/>
                              </svg>
                            </button>
                            @if (itemStatusDropdownOpen() === order.id + '-' + item.id) {
                              <div class="status-dropdown item-status-dropdown" data-testid="kitchen-item-status-dropdown" (click)="$event.stopPropagation()">
                                @if (getItemStatusTransitions(item.status || 'pending').backward.length > 0) {
                                  <div class="dropdown-section">
                                    <div class="dropdown-label">{{ 'ORDERS.GO_BACK' | translate }}</div>
                                    @for (status of getItemStatusTransitions(item.status || 'pending').backward; track status) {
                                      <button type="button" class="dropdown-item backward" (click)="updateItemStatus(order.id, item.id!, status); itemStatusDropdownOpen.set(null)">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15,18 9,12 15,6"/></svg>
                                        {{ getItemStatusLabel(status) }}
                                      </button>
                                    }
                                  </div>
                                }
                                @if (getItemStatusTransitions(item.status || 'pending').forward.length > 0) {
                                  <div class="dropdown-section">
                                    <div class="dropdown-label">{{ 'ORDERS.MOVE_FORWARD' | translate }}</div>
                                    @for (status of getItemStatusTransitions(item.status || 'pending').forward; track status) {
                                      <button type="button" class="dropdown-item forward" (click)="updateItemStatus(order.id, item.id!, status); itemStatusDropdownOpen.set(null)">
                                        {{ getItemStatusLabel(status) }}
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,18 15,12 9,6"/></svg>
                                      </button>
                                    }
                                  </div>
                                }
                              </div>
                            }
                          </div>
                        } @else {
                          <span class="item-status" [class]="'status-' + (item.status || 'pending')">{{ getItemStatusLabel(item.status || 'pending') }}</span>
                        }
                      </li>
                    }
                  }
                </ul>
                @if (order.notes) {
                  <div class="order-notes">{{ 'KITCHEN_DISPLAY.NOTES' | translate }}: {{ order.notes }}</div>
                }
              </article>
            }
          </div>
        }
      </main>
      @if (timerSettingsModalOpen()) {
        <div class="modal-backdrop" (click)="closeTimerSettingsModal()"></div>
        <div class="modal ts-modal" role="dialog" aria-labelledby="timer-settings-title" appFocusFirstInput>
          <header class="ts-head">
            <span class="ts-head-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>
            </span>
            <div>
              <h2 id="timer-settings-title" class="ts-title">{{ 'KITCHEN_DISPLAY.TIMER_SETTINGS_TITLE' | translate }}</h2>
              <p class="ts-sub">{{ 'KITCHEN_DISPLAY.TIMER_SETTINGS_SUB' | translate }}</p>
            </div>
            <button type="button" class="ts-close" (click)="closeTimerSettingsModal()" [attr.aria-label]="'COMMON.CANCEL' | translate">×</button>
          </header>

          <section class="ts-card ts-auto">
            <div class="ts-card-title">
              <span class="ts-pill">{{ 'KITCHEN_DISPLAY.AUTO_PREP_BADGE' | translate }}</span>
              <h3>{{ 'KITCHEN_DISPLAY.AUTO_PREP_TITLE' | translate }}</h3>
            </div>

            <div class="ts-flow" aria-hidden="true">
              <span class="ts-node ts-node-pending">{{ 'KITCHEN_DISPLAY.AUTO_PREP_FROM' | translate }}</span>
              <span class="ts-rail"><i class="ts-rail-dot"></i></span>
              <span class="ts-node ts-node-preparing">{{ 'KITCHEN_DISPLAY.AUTO_PREP_TO' | translate }}</span>
            </div>

            <div class="ts-stepper">
              <button type="button" class="ts-step" (click)="stepAutoPrep(-5)" [disabled]="timerSettingsForm().auto_preparing_seconds <= 0" aria-label="-5">−</button>
              <label class="ts-big">
                <input type="number" min="0" max="3600" step="5" inputmode="numeric"
                  [ngModel]="timerSettingsForm().auto_preparing_seconds" (ngModelChange)="updateTimerFormAutoPrep($event)" />
                <span>{{ (timerSettingsForm().auto_preparing_seconds === 0 ? 'KITCHEN_DISPLAY.AUTO_PREP_INSTANT' : 'KITCHEN_DISPLAY.AUTO_PREP_UNIT') | translate }}</span>
              </label>
              <button type="button" class="ts-step" (click)="stepAutoPrep(5)" aria-label="+5">+</button>
            </div>

            <div class="ts-chips">
              @for (n of autoPrepPresets; track n) {
                <button type="button" class="ts-chip" [class.on]="timerSettingsForm().auto_preparing_seconds === n"
                  (click)="updateTimerFormAutoPrep(n)">{{ n === 0 ? ('KITCHEN_DISPLAY.AUTO_PREP_NOW' | translate) : n + ' s' }}</button>
              }
            </div>
            <p class="ts-hint">{{ 'KITCHEN_DISPLAY.AUTO_PREPARING_HINT' | translate }}</p>
          </section>

          <section class="ts-card">
            <div class="ts-card-title">
              <h3>{{ 'KITCHEN_DISPLAY.WAIT_COLORS_TITLE' | translate }}</h3>
            </div>
            <div class="ts-scale" aria-hidden="true"></div>
            <div class="ts-colors">
              <label class="ts-color ts-yellow">
                <span class="ts-dot"></span><span class="ts-color-name">{{ 'KITCHEN_DISPLAY.COLOR_YELLOW' | translate }}</span>
                <input type="number" min="0" step="1" [ngModel]="timerSettingsForm().yellow_minutes" (ngModelChange)="updateTimerFormYellow($event)" />
                <small>{{ 'KITCHEN_DISPLAY.MIN_SHORT' | translate }}</small>
              </label>
              <label class="ts-color ts-orange">
                <span class="ts-dot"></span><span class="ts-color-name">{{ 'KITCHEN_DISPLAY.COLOR_ORANGE' | translate }}</span>
                <input type="number" min="0" step="1" [ngModel]="timerSettingsForm().orange_minutes" (ngModelChange)="updateTimerFormOrange($event)" />
                <small>{{ 'KITCHEN_DISPLAY.MIN_SHORT' | translate }}</small>
              </label>
              <label class="ts-color ts-red">
                <span class="ts-dot"></span><span class="ts-color-name">{{ 'KITCHEN_DISPLAY.COLOR_RED' | translate }}</span>
                <input type="number" min="0" step="1" [ngModel]="timerSettingsForm().red_minutes" (ngModelChange)="updateTimerFormRed($event)" />
                <small>{{ 'KITCHEN_DISPLAY.MIN_SHORT' | translate }}</small>
              </label>
            </div>
          </section>

          <footer class="ts-actions">
            <button type="button" class="ts-btn ts-btn-ghost" (click)="closeTimerSettingsModal()">{{ 'COMMON.CANCEL' | translate }}</button>
            <button type="button" class="ts-btn ts-btn-primary" (click)="saveTimerSettings()">{{ 'COMMON.SAVE' | translate }}</button>
          </footer>
        </div>
      }
    </div>
  `,
  styles: [`
    .kitchen-view {
      min-height: 100vh;
      background: var(--color-bg);
      display: flex;
      flex-direction: column;
    }
    .kitchen-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--space-4);
      padding: var(--space-4) var(--space-6);
      background: var(--color-surface);
      border-bottom: 2px solid var(--color-border);
      box-shadow: var(--shadow-sm);
    }
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--color-primary);
      font-weight: 500;
      text-decoration: none;
      font-size: 1rem;
    }
    .back-link:hover { text-decoration: underline; }
    .kitchen-title {
      font-size: clamp(1.5rem, 4vw, 2.25rem);
      font-weight: 700;
      color: var(--color-text);
      margin: 0;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: var(--space-5);
      flex-wrap: wrap;
    }
    .timer-settings-btn,
    .fullscreen-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      font-size: 0.9375rem;
      font-weight: 500;
      color: var(--color-primary);
      background: transparent;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      cursor: pointer;
    }
    .timer-settings-btn:hover,
    .fullscreen-btn:hover { background: var(--color-bg); }
    .sound-toggle {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      cursor: pointer;
      font-size: 1rem;
      font-weight: 500;
      color: var(--color-text);
    }
    .sound-toggle input { cursor: pointer; width: 18px; height: 18px; }
    .last-refresh {
      font-size: 0.875rem;
      color: var(--color-text-muted);
    }
    .station-filter {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: 0.9375rem;
      font-weight: 500;
      color: var(--color-text);
    }
    .station-filter-label { white-space: nowrap; }
    .station-filter-select {
      min-width: 160px;
      padding: var(--space-2) var(--space-3);
      font-size: 1rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-text);
    }
    .kitchen-main {
      flex: 1;
      padding: var(--space-5) var(--space-6);
      overflow: auto;
    }
    .empty-state {
      text-align: center;
      padding: var(--space-8);
      background: var(--color-surface);
      border: 1px dashed var(--color-border);
      border-radius: var(--radius-lg);
    }
    .empty-state .empty-icon { color: var(--color-text-muted); margin-bottom: var(--space-4); }
    .empty-state h2 { margin: 0 0 var(--space-2); font-size: 1.5rem; color: var(--color-text); }
    .empty-state p { margin: 0; color: var(--color-text-muted); }
    .order-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: var(--space-5);
      align-items: start;
    }
    .order-card {
      background: var(--color-surface);
      border: 2px solid var(--color-border);
      border-left: 6px solid var(--color-warning);
      border-radius: var(--radius-lg);
      overflow: visible;
      box-shadow: var(--shadow-md);
    }
    .order-card.status-preparing { border-left-color: #3B82F6; }
    .order-card.status-ready { border-left-color: var(--color-success); }
    .order-card-urgent {
      box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.45), var(--shadow-sm);
    }
    .urgent-badge {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      background: rgba(220, 38, 38, 0.15);
      color: #b91c1c;
    }
    .order-timer-bar-wrap {
      padding: 0 var(--space-5) var(--space-3);
    }
    .order-timer-bar-track {
      height: 8px;
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.08);
      overflow: hidden;
    }
    .order-timer-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.35s ease-out, background 0.25s;
      min-width: 0;
    }
    .timer-fill-green { background: linear-gradient(90deg, #16a34a, #22c55e); }
    .timer-fill-yellow { background: linear-gradient(90deg, #ca8a04, #eab308); }
    .timer-fill-orange { background: linear-gradient(90deg, #ea580c, #f97316); }
    .timer-fill-red { background: linear-gradient(90deg, #b91c1c, #ef4444); }
    .order-card.timer-green { border-left-color: #22c55e; }
    .order-card.timer-yellow { border-left-color: #eab308; }
    .order-card.timer-orange { border-left-color: #f97316; }
    .order-card.timer-red { border-left-color: #ef4444; }
    .order-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: var(--space-4) var(--space-5);
      border-bottom: 2px solid var(--color-border);
      background: var(--color-bg);
    }
    .order-meta {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }
    .order-id {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--color-text);
    }
    .order-table {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--color-primary);
    }
    .order-customer { font-size: 1rem; color: var(--color-text-muted); }
    .order-time { font-size: 1rem; color: var(--color-text-muted); }
    .order-waiting { font-size: 1.125rem; font-weight: 700; color: var(--color-text); }
    .status-badge {
      padding: var(--space-2) var(--space-4);
      border-radius: 20px;
      font-size: 0.9375rem;
      font-weight: 700;
    }
    .status-badge.pending { background: rgba(245, 158, 11, 0.2); color: var(--color-warning); }
    .status-badge.preparing { background: rgba(59, 130, 246, 0.2); color: #3B82F6; }
    .status-badge.ready { background: var(--color-success-light); color: var(--color-success); }
    .status-badge.partially_delivered { background: var(--color-success-light); color: var(--color-success); }
    .order-items {
      list-style: none;
      margin: 0;
      padding: var(--space-4) var(--space-5);
    }
    .order-item {
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) 0;
      font-size: 1.125rem;
      line-height: 1.4;
      border-bottom: 1px solid var(--color-border);
    }
    .order-item:last-child { border-bottom: none; }
    .item-qty {
      font-weight: 700;
      color: var(--color-primary);
      font-size: 1.25rem;
    }
    .item-name { font-weight: 600; color: var(--color-text); }
    .item-notes {
      grid-column: 1 / -1;
      font-size: 1rem;
      font-weight: 600;
      color: #b45309;
      background: rgba(245, 158, 11, 0.12);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-sm);
      border-left: 3px solid var(--color-warning);
      white-space: pre-wrap;
      word-break: break-word;
      font-style: normal;
    }
    .item-customization {
      grid-column: 2 / 4;
      font-size: 0.8125rem;
      color: var(--color-text-muted);
    }
    .item-status {
      font-size: 0.8125rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
    }
    .item-status.status-pending { background: rgba(245, 158, 11, 0.15); color: var(--color-warning); }
    .item-status.status-preparing { background: rgba(59, 130, 246, 0.15); color: #3B82F6; }
    .item-status.status-ready { background: var(--color-success-light); color: var(--color-success); }
    .item-status.status-delivered { background: var(--color-bg); color: var(--color-text-muted); }
    .item-status-control {
      position: relative;
      display: inline-flex;
      z-index: 10;
    }
    .order-item:hover .item-status-control {
      z-index: 50;
    }
    .item-status-badge.clickable {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-height: 44px;
      padding: var(--space-2) var(--space-3);
      font-size: 0.875rem;
      font-weight: 600;
      border-radius: 14px;
      border: 1px solid var(--color-border);
      cursor: pointer;
      background: inherit;
      transition: all 0.15s;
    }
    .item-status-badge.clickable:hover {
      filter: brightness(0.95);
      transform: scale(1.05);
    }
    .item-status-badge.status-pending.clickable { background: rgba(245, 158, 11, 0.15); color: var(--color-warning); }
    .item-status-badge.status-preparing.clickable { background: rgba(59, 130, 246, 0.15); color: #3B82F6; }
    .item-status-badge.status-ready.clickable { background: var(--color-success-light); color: var(--color-success); }
    .status-dropdown {
      position: absolute;
      top: 100%;
      right: 0;
      left: auto;
      margin-top: 6px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 100;
      min-width: 160px;
      overflow: hidden;
    }
    .dropdown-section {
      padding: 8px 0;
    }
    .dropdown-section:not(:last-child) {
      border-bottom: 1px solid var(--color-border);
    }
    .dropdown-label {
      padding: 6px 12px;
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .dropdown-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      width: 100%;
      min-height: 48px;
      padding: var(--space-3) var(--space-4);
      background: none;
      border: none;
      text-align: left;
      font-size: 1rem;
      font-weight: 500;
      color: var(--color-text);
      cursor: pointer;
      transition: background 0.15s;
    }
    .dropdown-item:hover {
      background: var(--color-bg);
    }
    .dropdown-item.forward {
      color: var(--color-primary);
    }
    .dropdown-item.backward {
      color: var(--color-text-muted);
    }
    .dropdown-item svg {
      flex-shrink: 0;
    }
    .order-notes {
      padding: var(--space-3) var(--space-5);
      background: rgba(245, 158, 11, 0.12);
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-text);
      border-top: 1px solid var(--color-border);
      border-left: 4px solid var(--color-warning);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 1000;
    }
    .modal {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-md);
      padding: var(--space-6);
      z-index: 1001;
      min-width: 320px;
      max-width: 90vw;
    }
    .ts-modal {
      width: min(520px, 94vw); max-height: 92vh; overflow-y: auto; padding: 0;
      border-radius: 20px; border: 1px solid var(--color-border);
      box-shadow: 0 24px 60px rgba(0,0,0,.28);
    }
    .ts-head {
      display: flex; align-items: center; gap: 14px; padding: 20px 20px 16px;
      background: linear-gradient(135deg, var(--color-primary-light, #fff3e0), transparent 75%);
    }
    .ts-head-icon {
      flex: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px;
      background: var(--color-primary); color: #fff; box-shadow: 0 6px 16px rgba(0,0,0,.18);
    }
    .ts-title { margin: 0; font-size: 1.2rem; line-height: 1.2; }
    .ts-sub { margin: 2px 0 0; font-size: .85rem; color: var(--color-text-muted); }
    .ts-close {
      margin-left: auto; flex: none; width: 36px; height: 36px; border-radius: 50%; border: 0;
      background: transparent; color: var(--color-text-muted); font-size: 1.6rem; line-height: 1; cursor: pointer;
    }
    .ts-close:hover { background: var(--color-bg); color: var(--color-text); }
    .ts-card {
      margin: 0 16px 14px; padding: 16px; border-radius: 16px;
      background: var(--color-bg); border: 1px solid var(--color-border);
    }
    .ts-auto { border-color: var(--color-primary); box-shadow: inset 0 0 0 1px var(--color-primary); }
    .ts-card-title { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .ts-card-title h3 { margin: 0; font-size: 1rem; }
    .ts-pill {
      padding: 3px 10px; border-radius: 999px; font-size: .7rem; font-weight: 800; letter-spacing: .06em;
      text-transform: uppercase; background: var(--color-primary); color: #fff;
    }
    .ts-flow { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
    .ts-node { flex: none; padding: 6px 12px; border-radius: 999px; font-size: .8rem; font-weight: 700; }
    .ts-node-pending { background: rgba(245,158,11,.18); color: var(--color-warning); }
    .ts-node-preparing { background: rgba(37,99,235,.14); color: var(--color-primary); }
    .ts-rail { position: relative; flex: 1; height: 4px; border-radius: 4px; background: var(--color-border); overflow: hidden; }
    .ts-rail-dot {
      position: absolute; top: 0; left: 0; width: 38%; height: 100%; border-radius: 4px;
      background: linear-gradient(90deg, transparent, var(--color-primary));
      animation: ts-run 1.8s ease-in-out infinite;
    }
    @keyframes ts-run { from { transform: translateX(-100%); } to { transform: translateX(270%); } }
    .ts-stepper { display: flex; align-items: center; justify-content: center; gap: 14px; }
    .ts-step {
      flex: none; width: 52px; height: 52px; border-radius: 16px; border: 1px solid var(--color-border);
      background: var(--color-surface); color: var(--color-text); font-size: 1.7rem; line-height: 1;
      cursor: pointer; touch-action: manipulation; transition: transform .12s, background .15s, border-color .15s;
    }
    .ts-step:hover:not(:disabled) { border-color: var(--color-primary); color: var(--color-primary); }
    .ts-step:active:not(:disabled) { transform: scale(.94); }
    .ts-step:disabled { opacity: .35; cursor: default; }
    .ts-big { display: flex; flex-direction: column; align-items: center; min-width: 120px; margin: 0; }
    .ts-big input {
      width: 120px; border: 0; background: transparent; text-align: center; font-size: 3rem; font-weight: 800;
      line-height: 1; color: var(--color-primary); -moz-appearance: textfield; appearance: textfield; padding: 0;
    }
    .ts-big input::-webkit-outer-spin-button, .ts-big input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .ts-big input:focus { outline: none; }
    .ts-big span { font-size: .8rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .08em; }
    .ts-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 14px; }
    .ts-chip {
      min-height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--color-border);
      background: var(--color-surface); color: var(--color-text); font: inherit; font-size: .85rem; font-weight: 600;
      cursor: pointer; touch-action: manipulation; transition: background .15s, color .15s, border-color .15s;
    }
    .ts-chip:hover { border-color: var(--color-primary); }
    .ts-chip.on { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
    .ts-hint { margin: 12px 0 0; text-align: center; font-size: .78rem; color: var(--color-text-muted); }
    .ts-scale {
      height: 10px; border-radius: 999px; margin-bottom: 14px;
      background: linear-gradient(90deg, #22c55e 0%, #eab308 38%, #f97316 66%, #dc2626 100%);
    }
    .ts-colors { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .ts-color {
      display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: 8px; row-gap: 6px;
      margin: 0; padding: 10px; border-radius: 12px; background: var(--color-surface); border: 1px solid var(--color-border);
    }
    .ts-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--c); }
    .ts-yellow { --c: #eab308; } .ts-orange { --c: #f97316; } .ts-red { --c: #dc2626; }
    .ts-color-name { font-size: .8rem; font-weight: 700; }
    .ts-color input {
      grid-column: 1 / 2; width: 100%; min-width: 0; box-sizing: border-box; padding: 6px 8px; text-align: center;
      font-size: 1.1rem; font-weight: 700; border: 1px solid var(--color-border); border-radius: 8px;
      background: var(--color-bg); color: var(--color-text);
    }
    .ts-color input:focus { outline: 2px solid var(--c); outline-offset: 0; }
    .ts-color small { color: var(--color-text-muted); font-size: .75rem; }
    .ts-actions { display: flex; justify-content: flex-end; gap: 10px; padding: 4px 16px 18px; }
    .ts-btn { min-height: 44px; padding: 0 22px; border-radius: 12px; font: inherit; font-weight: 700; cursor: pointer; touch-action: manipulation; }
    .ts-btn-ghost { background: transparent; border: 1px solid var(--color-border); color: var(--color-text); }
    .ts-btn-primary { background: var(--color-primary); border: 0; color: #fff; box-shadow: 0 6px 16px rgba(0,0,0,.18); }
    @media (prefers-reduced-motion: reduce) { .ts-rail-dot { animation: none; width: 100%; } }
    @media (max-width: 420px) { .ts-colors { grid-template-columns: 1fr; } .ts-big input { font-size: 2.5rem; } }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-3);
    }
    .modal-actions .btn-primary, .modal-actions .btn-secondary {
      padding: var(--space-2) var(--space-4);
      font-size: 1rem;
      font-weight: 500;
      border-radius: var(--radius-md);
      cursor: pointer;
    }
    .modal-actions .btn-primary {
      background: var(--color-primary);
      color: white;
      border: none;
    }
    .modal-actions .btn-secondary {
      background: var(--color-bg);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    /* ===== Cocina / Bar: rediseño (tema claro) ===== */
    .kitchen-view {
      background:
        radial-gradient(1000px 460px at 8% -12%, rgba(222, 124, 52, 0.14), transparent 60%),
        radial-gradient(900px 440px at 100% 0%, rgba(34, 197, 94, 0.07), transparent 60%),
        var(--color-bg);
    }
    .kitchen-header {
      gap: 14px 24px; padding: 14px 28px; border-bottom: 0; box-shadow: 0 10px 30px -24px rgba(0, 0, 0, .5);
      background: rgba(255, 255, 255, .88); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      position: sticky; top: 0; z-index: 20;
    }
    .kitchen-header::after {
      content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
      background: linear-gradient(90deg, transparent, #de7c34 30%, #f59e0b 60%, transparent);
    }
    .back-link {
      min-height: 44px; padding: 0 16px 0 10px; border-radius: 999px; background: var(--color-bg); color: var(--color-text);
      font-weight: 700; transition: background .15s;
    }
    .back-link:hover { text-decoration: none; background: var(--color-primary-light); color: var(--color-primary); }
    .kd-title-wrap { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; flex: 1 1 auto; min-width: 0; }
    .kitchen-title { font-size: clamp(1.6rem, 3.4vw, 2.4rem); font-weight: 800; letter-spacing: -0.01em; }
    .kd-stats { display: flex; flex-wrap: wrap; gap: 8px; }
    .kd-stat {
      display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; font-size: .85rem; font-weight: 700;
      color: var(--ci); background: color-mix(in srgb, var(--c) 14%, #fff); border: 1px solid color-mix(in srgb, var(--c) 45%, #fff);
    }
    .kd-stat b { font-size: 1.15rem; font-weight: 800; color: var(--color-text); font-variant-numeric: tabular-nums; }
    .kd-stat i { width: 9px; height: 9px; border-radius: 50%; background: var(--c); }
    .kd-stat-pending { --c: #eab308; --ci: #a16207; }
    .kd-stat-preparing { --c: #de7c34; --ci: #c2410c; }
    .kd-stat-ready { --c: #22c55e; --ci: #15803d; }
    .header-actions { gap: 12px; }
    .timer-settings-btn, .fullscreen-btn {
      min-height: 44px; padding: 0 16px; border-radius: 999px; font-weight: 700; color: var(--color-text);
      background: var(--color-surface); border: 1px solid var(--color-border); transition: background .15s, border-color .15s, color .15s;
    }
    .timer-settings-btn:hover, .fullscreen-btn:hover { background: var(--color-primary-light); border-color: var(--color-primary); color: var(--color-primary); }
    .sound-toggle { min-height: 44px; padding: 0 14px; border-radius: 999px; background: var(--color-surface); border: 1px solid var(--color-border); font-weight: 700; }
    .sound-toggle input { accent-color: #de7c34; }
    .station-filter-select { min-height: 44px; border-radius: 999px; padding: 0 16px; font-weight: 700; }
    .kd-clock {
      min-width: 86px; text-align: center; padding: 6px 16px; border-radius: 14px; font-size: 1.6rem; font-weight: 800; letter-spacing: .02em;
      font-variant-numeric: tabular-nums; color: var(--color-text); background: var(--color-surface); border: 1px solid var(--color-border);
    }
    .last-refresh { font-size: .8rem; }

    .kitchen-main { padding: 26px 28px 40px; }
    .empty-state { padding: 70px 24px; border-radius: 28px; border: 1.5px dashed var(--color-border); background: rgba(255, 255, 255, .7); }
    .empty-state .empty-icon { display: inline-grid; place-items: center; width: 110px; height: 110px; border-radius: 32px; background: var(--color-primary-light); color: var(--color-primary); }
    .empty-state h2 { font-size: 1.9rem; font-weight: 800; }

    .order-grid { grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 22px; }
    .order-card {
      --tc: #22c55e; --ti: #15803d;
      position: relative; overflow: visible; border: 1px solid var(--color-border); border-left-width: 1px; border-radius: 24px;
      background: var(--color-surface);
      box-shadow: 0 1px 2px rgba(0, 0, 0, .05), 0 22px 36px -26px var(--tc);
      animation: kd-in .25s ease-out;
    }
    /* Coloured strip: sits exactly over the card's top border so it never pokes out of the rounded corners */
    .order-card::before {
      content: ''; position: absolute; top: -1px; left: -1px; right: -1px; height: 7px; border-radius: 24px 24px 0 0;
      background: linear-gradient(90deg, var(--tc), color-mix(in srgb, var(--tc) 60%, #fff));
      pointer-events: none;
    }
    @keyframes kd-in { from { opacity: 0; transform: translateY(10px) scale(.985); } }
    .order-card.timer-green { --tc: #22c55e; --ti: #15803d; border-left-color: var(--color-border); }
    .order-card.timer-yellow { --tc: #eab308; --ti: #a16207; border-left-color: var(--color-border); }
    .order-card.timer-orange { --tc: #f97316; --ti: #c2410c; border-left-color: var(--color-border); }
    .order-card.timer-red { --tc: #ef4444; --ti: #b91c1c; border-left-color: var(--color-border); animation: kd-in .25s ease-out, kd-alert 1.6s ease-in-out infinite .3s; }
    @keyframes kd-alert {
      50% { box-shadow: 0 0 0 2px rgba(239, 68, 68, .5), 0 0 30px -4px rgba(239, 68, 68, .5); }
    }
    .order-card.status-preparing, .order-card.status-ready { border-left-color: var(--color-border); }
    .order-card-urgent { outline: 2px solid #ef4444; outline-offset: 3px; }

    .order-header { padding: 24px 20px 12px; border-bottom: 0; background: transparent; align-items: flex-start; gap: 10px; }
    .order-meta { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px 10px; flex: 1; min-width: 0; }
    .order-table { order: 0; flex: 1 1 100%; font-size: 2rem; font-weight: 800; line-height: 1.05; color: var(--color-text); letter-spacing: -0.01em; }
    .order-id { order: 1; padding: 3px 12px; border-radius: 999px; font-size: .85rem; font-weight: 800; color: #fff; background: var(--tc); }
    .urgent-badge {
      order: 2; padding: 3px 12px; border-radius: 999px; font-size: .75rem; font-weight: 800; color: #fff; background: #dc2626;
      animation: kd-blink 1.1s ease-in-out infinite;
    }
    @keyframes kd-blink { 50% { opacity: .55; } }
    .order-customer { order: 3; padding: 3px 12px; border-radius: 999px; font-size: .85rem; font-weight: 700; color: var(--color-primary); background: var(--color-primary-light); }
    .order-time { order: 4; font-size: .9rem; font-weight: 600; }
    .order-waiting {
      order: 5; margin-left: auto; display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 14px;
      font-size: 1.35rem; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--ti);
      background: color-mix(in srgb, var(--tc) 14%, #fff); border: 1px solid color-mix(in srgb, var(--tc) 45%, #fff);
    }
    .order-waiting::before { content: '⏱'; font-size: 1.05rem; }
    .status-badge { padding: 7px 14px; font-size: .78rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
    .status-badge.pending { background: rgba(234, 179, 8, .18); color: #a16207; }
    .status-badge.preparing { background: var(--color-primary-light); color: #c2410c; }
    .status-badge.ready, .status-badge.partially_delivered { background: rgba(34, 197, 94, .16); color: #15803d; }

    .order-timer-bar-wrap { padding: 0 20px 14px; }
    .order-timer-bar-track { height: 10px; border-radius: 999px; background: rgba(0, 0, 0, .07); }
    .order-timer-bar-fill { border-radius: 999px; }

    .order-items { padding: 4px 16px 16px; display: flex; flex-direction: column; gap: 8px; }
    .order-item {
      grid-template-columns: auto 1fr auto; padding: 12px; border: 1px solid var(--color-border); border-radius: 18px;
      background: var(--color-bg); font-size: 1.2rem;
    }
    .order-item:last-child { border-bottom: 1px solid var(--color-border); }
    .item-qty {
      display: grid; place-items: center; min-width: 48px; height: 48px; padding: 0 8px; border-radius: 14px; font-size: 1.45rem; font-weight: 800;
      color: #fff; background: linear-gradient(135deg, #de7c34, #b8561a); box-shadow: 0 8px 16px -10px #b8561a;
    }
    .item-name { font-size: 1.25rem; font-weight: 700; line-height: 1.2; }
    .item-customization { grid-column: 2 / -1; font-size: .9rem; }
    .item-notes { border-radius: 12px; border-left-width: 4px; }
    .item-status { padding: 4px 12px; font-size: .78rem; font-weight: 800; border-radius: 999px; }
    .item-status.status-pending, .item-status-badge.status-pending.clickable { background: rgba(234, 179, 8, .18); color: #a16207; }
    .item-status.status-preparing, .item-status-badge.status-preparing.clickable { background: var(--color-primary-light); color: #c2410c; }
    .item-status.status-ready, .item-status-badge.status-ready.clickable { background: rgba(34, 197, 94, .16); color: #15803d; }
    .item-status-badge.clickable { min-height: 44px; padding: 0 14px; border-radius: 999px; border-color: transparent; font-weight: 800; }
    .item-status-badge.clickable:hover { filter: brightness(.96); transform: scale(1.04); }
    .status-dropdown { border-radius: 16px; box-shadow: 0 24px 40px -18px rgba(0, 0, 0, .35); }

    .order-notes {
      margin: 0 16px 16px; padding: 12px 14px; border-radius: 16px; border-left: 4px solid var(--color-warning);
      background: rgba(245, 158, 11, .12); color: #92400e; font-weight: 700;
    }

    @media (prefers-reduced-motion: reduce) {
      .order-card, .order-card.timer-red, .urgent-badge { animation: none; }
    }
    @media (max-width: 720px) {
      .kitchen-header { padding: 12px 14px; }
      .kitchen-main { padding: 16px 12px 30px; }
      .order-grid { grid-template-columns: 1fr; }
      .kd-clock { display: none; }
    }
  `],
})
export class KitchenDisplayComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('kitchenRoot', { read: ElementRef }) kitchenRootRef?: ElementRef<HTMLElement>;

  private api = inject(ApiService);
  private audio = inject(AudioService);
  private translate = inject(TranslateService);
  private permissions = inject(PermissionService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private refreshIntervalId: ReturnType<typeof setInterval> | null = null;
  private wsSub: Subscription | null = null;
  private routeDataSub: Subscription | null = null;
  private queryParamSub: Subscription | null = null;
  private initialLoadDone = false;
  private pendingBackgroundRefresh = false;

  orders = signal<Order[]>([]);
  loading = signal(true);
  lastRefreshAt = signal<Date | null>(null);
  soundEnabled = signal(true);
  itemStatusDropdownOpen = signal<string | null>(null);
  /** 'kitchen' = cocina (Main Course), 'bar' = beverages only */
  viewMode = signal<'kitchen' | 'bar'>('kitchen');
  /** Loaded prep stations; filtered per view by display_route */
  kitchenStations = signal<KitchenStation[]>([]);
  /** KDS station filter when tenant has stations for this view */
  stationSelection = signal<number | 'all'>('all');
  /** Current time for live timer (updates every second). */
  now = signal(Date.now());
  /** Timer thresholds (minutes) for card color. Defaults 5, 10, 15. */
  timerSettings = signal<KitchenDisplaySettings>({
    yellow_minutes: 5,
    orange_minutes: 10,
    red_minutes: 15,
    auto_preparing_seconds: 30,
  });
  timerSettingsModalOpen = signal(false);
  timerSettingsForm = signal<KitchenDisplaySettings>({
    yellow_minutes: 5,
    orange_minutes: 10,
    red_minutes: 15,
    auto_preparing_seconds: 30,
  });
  private tickIntervalId: ReturnType<typeof setInterval> | null = null;

  /** True when this view’s root element is the browser fullscreen element. */
  isFullscreen = signal(false);

  canUpdateItemStatus = computed(() =>
    this.permissions.hasPermission(this.permissions.getCurrentUser(), 'order:item_status')
  );

  pageTitle = computed(() =>
    this.viewMode() === 'bar'
      ? this.translate.instant('BAR_DISPLAY.TITLE')
      : this.translate.instant('KITCHEN_DISPLAY.TITLE')
  );

  stationsForCurrentView = computed(() => {
    const route = this.viewMode() === 'bar' ? 'bar' : 'kitchen';
    return [...this.kitchenStations()]
      .filter((s) => s.display_route === route)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  });

  /** Orders that are active (including paid but not yet delivered); category or station filter. */
  activeOrders = computed(() => {
    const view = this.viewMode();
    const category = VIEW_CATEGORY[view] ?? '';
    const routeKey = view === 'bar' ? 'bar' : 'kitchen';
    const useStations = this.stationsForCurrentView().length > 0;
    const sel = this.stationSelection();

    // Kitchen is the "see everything" pass: it shows main course AND beverages.
    // Bar stays specialized: beverages only.
    const itemVisible = (i: OrderItem): boolean => {
      if (i.removed_by_customer) return false;
      if (!(i.status === 'pending' || i.status === 'preparing' || i.status === 'ready')) return false;
      if (view === 'kitchen') {
        if (!useStations || sel === 'all') return true;
        return i.kitchen_station_id === sel;
      }
      if (!useStations) {
        return i.category === category;
      }
      const kr =
        i.kitchen_station_route ||
        (i.category === 'Beverages' ? 'bar' : 'kitchen');
      if (kr !== routeKey) return false;
      if (sel === 'all') return true;
      return i.kitchen_station_id === sel;
    };

    const list = this.orders().filter((o) => {
      if (!['pending', 'preparing', 'ready', 'partially_delivered', 'paid'].includes(o.status)) return false;
      const items = (o.items ?? []).filter(itemVisible);
      return items.length > 0;
    });
    const mapped = list.map((o) => ({
      ...o,
      staff_urgent: !!o.staff_urgent,
      items: (o.items ?? []).filter(itemVisible),
    }));
    return mapped.sort((a, b) => {
      if (!!a.staff_urgent !== !!b.staff_urgent) {
        return a.staff_urgent ? -1 : 1;
      }
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return ta - tb;
    });
  });

  /** Orders on screen by overall status (header chips). */
  orderCounts = computed(() => {
    const out = { pending: 0, preparing: 0, ready: 0 };
    for (const o of this.activeOrders()) {
      if (o.status === 'pending') out.pending++;
      else if (o.status === 'preparing') out.preparing++;
      else if (o.status === 'ready' || o.status === 'partially_delivered') out.ready++;
    }
    return out;
  });

  /** Wall clock for the header (ticks with the per-second `now` signal). */
  clockLabel = computed(() => {
    return new Date(this.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  });

  lastRefreshRelative = computed(() => {
    const at = this.lastRefreshAt();
    if (!at) return '—';
    const sec = Math.floor((Date.now() - at.getTime()) / 1000);
    if (sec < 10) return '< 10s';
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    return `${min}m`;
  });

  lastRefreshExact = computed(() => {
    const at = this.lastRefreshAt();
    return at ? at.toLocaleTimeString() : '';
  });

  ngOnInit(): void {
    const stored = localStorage.getItem(SOUND_STORAGE_KEY);
    this.soundEnabled.set(stored !== 'false');
    this.audio.setEnabled(this.soundEnabled());

    const view = (this.route.snapshot.data['view'] as 'kitchen' | 'bar') || 'kitchen';
    this.viewMode.set(view);
    this.routeDataSub = this.route.data.subscribe((data) => {
      const v = (data['view'] as 'kitchen' | 'bar') || 'kitchen';
      this.viewMode.set(v);
    });

    this.queryParamSub = this.route.queryParamMap.subscribe((qm) => {
      const s = qm.get('station');
      if (s == null || s === '' || s === 'all') {
        this.stationSelection.set('all');
      } else {
        const n = Number.parseInt(s, 10);
        if (Number.isFinite(n)) {
          this.stationSelection.set(n);
        }
      }
    });

    this.api.getKitchenStations().subscribe({
      next: (list) => this.kitchenStations.set(list),
      error: () => this.kitchenStations.set([]),
    });

    this.loadTimerSettings();
    this.loadOrders({ initial: true });
    this.refreshIntervalId = setInterval(
      () => this.loadOrders({ background: true }),
      REFRESH_INTERVAL_MS
    );
    this.tickIntervalId = setInterval(() => this.now.set(Date.now()), 1000);

    try {
      this.api.connectWebSocket();
      this.wsSub = this.api.orderUpdates$.subscribe((update: unknown) => {
        if (update && typeof update === 'object' && 'type' in update) {
          const type = (update as { type: string }).type;
          if (this.soundEnabled() && ['new_order', 'items_added'].includes(type)) {
            this.audio.playRestaurantOrderChange();
          }
          this.loadOrders({ background: true });
        }
      });
    } catch {
      // continue without WebSocket
    }

    document.addEventListener('click', this.closeItemStatusDropdown);

    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this.onFullscreenChange);
    document.addEventListener('mozfullscreenchange', this.onFullscreenChange);
    document.addEventListener('MSFullscreenChange', this.onFullscreenChange);
  }

  ngAfterViewInit(): void {
    this.syncFullscreenState();
  }

  ngOnDestroy(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
    if (this.tickIntervalId) {
      clearInterval(this.tickIntervalId);
      this.tickIntervalId = null;
    }
    this.wsSub?.unsubscribe();
    this.routeDataSub?.unsubscribe();
    this.queryParamSub?.unsubscribe();
    document.removeEventListener('click', this.closeItemStatusDropdown);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', this.onFullscreenChange);
    document.removeEventListener('mozfullscreenchange', this.onFullscreenChange);
    document.removeEventListener('MSFullscreenChange', this.onFullscreenChange);
    void this.exitFullscreenIfActive();
  }

  onStationSelectChange(value: number | 'all'): void {
    this.stationSelection.set(value);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { station: value === 'all' ? undefined : value },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  loadTimerSettings(): void {
    this.api.getKitchenDisplaySettings().subscribe({
      next: (s) => this.timerSettings.set(s),
      error: () => {},
    });
  }

  /** Elapsed minutes since order created_at (uses live now() for updates). */
  getElapsedMinutes(createdAt: string): number {
    const created = this.parseOrderDate(createdAt);
    if (!created) return 0;
    return (this.now() - created) / 60000;
  }

  /** CSS class for timer-based card color: timer-green, timer-yellow, timer-orange, timer-red. */
  getTimerColorClass(order: Order): string {
    const min = this.getElapsedMinutes(order.created_at);
    const s = this.timerSettings();
    if (min >= (s.red_minutes ?? 15)) return 'timer-red';
    if (min >= (s.orange_minutes ?? 10)) return 'timer-orange';
    if (min >= (s.yellow_minutes ?? 5)) return 'timer-yellow';
    return 'timer-green';
  }

  /** Fill width 0–100% toward red threshold (visual progress of wait time). */
  getTimerBarPercent(order: Order): number {
    const min = this.getElapsedMinutes(order.created_at);
    const cap = this.timerSettings().red_minutes ?? 15;
    if (cap <= 0) return 0;
    return Math.min(100, (min / cap) * 100);
  }

  getTimerBarFillClass(order: Order): string {
    return this.getTimerColorClass(order).replace('timer-', 'timer-fill-');
  }

  /** Format waiting time with seconds (mm:ss or h:mm:ss) so it ticks every second. */
  formatWaitingTime(createdAt: string): string {
    const created = this.parseOrderDate(createdAt);
    if (!created) return '—';
    const totalSeconds = Math.floor((this.now() - created) / 1000);
    if (totalSeconds < 0) return '0:00';
    const s = totalSeconds % 60;
    const m = Math.floor(totalSeconds / 60) % 60;
    const h = Math.floor(totalSeconds / 3600);
    const pad = (n: number) => (n < 10 ? '0' + n : String(n));
    if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
    return `${m}:${pad(s)}`;
  }

  private parseOrderDate(dateString: string): number | null {
    if (!dateString) return null;
    const str =
      dateString.endsWith('Z') || dateString.includes('+') || dateString.includes('-', 10)
        ? dateString
        : dateString + 'Z';
    const date = new Date(str).getTime();
    return isNaN(date) ? null : date;
  }

  openTimerSettingsModal(): void {
    this.timerSettingsForm.set({ ...this.timerSettings() });
    this.timerSettingsModalOpen.set(true);
  }

  closeTimerSettingsModal(): void {
    this.timerSettingsModalOpen.set(false);
  }

  updateTimerFormYellow(v: number): void {
    this.timerSettingsForm.update((f) => ({ ...f, yellow_minutes: Math.max(0, Number(v) || 0) }));
  }
  updateTimerFormOrange(v: number): void {
    this.timerSettingsForm.update((f) => ({ ...f, orange_minutes: Math.max(0, Number(v) || 0) }));
  }
  updateTimerFormRed(v: number): void {
    this.timerSettingsForm.update((f) => ({ ...f, red_minutes: Math.max(0, Number(v) || 0) }));
  }

  readonly autoPrepPresets = [0, 15, 30, 45, 60, 90];

  stepAutoPrep(delta: number): void {
    this.updateTimerFormAutoPrep(this.timerSettingsForm().auto_preparing_seconds + delta);
  }

  updateTimerFormAutoPrep(v: number): void {
    this.timerSettingsForm.update((f) => ({ ...f, auto_preparing_seconds: Math.min(3600, Math.max(0, Math.round(Number(v) || 0))) }));
  }

  saveTimerSettings(): void {
    const form = this.timerSettingsForm();
    this.api.updateKitchenDisplaySettings(form).subscribe({
      next: (s) => {
        this.timerSettings.set(s);
        this.closeTimerSettingsModal();
      },
      error: () => {},
    });
  }

  private closeItemStatusDropdown = (e: Event): void => {
    const target = e.target as HTMLElement;
    if (!target.closest('.item-status-control')) {
      if (this.itemStatusDropdownOpen()) {
        this.itemStatusDropdownOpen.set(null);
        this.flushPendingBackgroundRefresh();
      }
    }
  };

  private onFullscreenChange = (): void => {
    this.syncFullscreenState();
  };

  private syncFullscreenState(): void {
    const root = this.kitchenRootRef?.nativeElement;
    const fs = getFullscreenElement();
    this.isFullscreen.set(!!root && fs === root);
  }

  toggleFullscreen(): void {
    if (this.isFullscreen()) {
      void this.exitFullscreenIfActive();
      return;
    }
    const root = this.kitchenRootRef?.nativeElement;
    const target = root ?? document.documentElement;
    const p = requestFullscreenOnElement(target);
    if (p && typeof (p as Promise<void>).catch === 'function') {
      (p as Promise<void>).catch(() => {});
    }
  }

  private exitFullscreenIfActive(): Promise<void> | void {
    if (!getFullscreenElement()) return;
    const p = exitDocumentFullscreen();
    if (p && typeof (p as Promise<void>).catch === 'function') {
      return (p as Promise<void>).catch(() => {});
    }
    return p;
  }

  loadOrders(options?: { initial?: boolean; background?: boolean }): void {
    const isInitial = options?.initial ?? (!options?.background && !this.initialLoadDone);
    const isBackground = options?.background ?? !isInitial;

    if (isBackground && this.itemStatusDropdownOpen()) {
      this.pendingBackgroundRefresh = true;
      return;
    }
    this.pendingBackgroundRefresh = false;

    if (isInitial) {
      this.loading.set(true);
    }

    this.api.getOrders(false).subscribe({
      next: (list) => {
        this.orders.set(list);
        this.lastRefreshAt.set(new Date());
        if (isInitial) {
          this.loading.set(false);
          this.initialLoadDone = true;
        }
      },
      error: () => {
        if (isInitial) {
          this.loading.set(false);
          this.initialLoadDone = true;
        }
      },
    });
  }

  private flushPendingBackgroundRefresh(): void {
    if (!this.pendingBackgroundRefresh) return;
    this.pendingBackgroundRefresh = false;
    this.loadOrders({ background: true });
  }

  toggleSound(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.soundEnabled.set(checked);
    this.audio.setEnabled(checked);
    localStorage.setItem(SOUND_STORAGE_KEY, String(checked));
  }

  getStatusLabel(status: string): string {
    return this.translate.instant('ORDER_STATUS.' + status) || status;
  }

  getItemStatusLabel(status: string): string {
    return this.translate.instant('ITEM_STATUS.' + status) || status;
  }

  hasCustomization(item: OrderItem): boolean {
    if (item?.line_modifiers_summary?.trim()) return true;
    const m = item?.line_modifiers;
    if (!m || typeof m !== 'object') return false;
    return (
      (!!m.remove && m.remove.length > 0) ||
      (!!m.add && m.add.length > 0) ||
      (!!m.substitute && m.substitute.length > 0)
    );
  }

  private formatLineModifiersFromJson(m: OrderLineModifiers | null | undefined): string {
    if (!m) return '';
    const parts: string[] = [];
    if (m.remove?.length) parts.push(`Remove: ${m.remove.join(', ')}`);
    if (m.add?.length) parts.push(`Add: ${m.add.join(', ')}`);
    if (m.substitute?.length) {
      parts.push(`Sub: ${m.substitute.map(s => `${s.from}→${s.to}`).join(', ')}`);
    }
    return parts.join(' · ');
  }

  formatCustomizationItem(item: OrderItem): string {
    const snapM = item.line_modifiers_summary?.trim();
    return snapM || this.formatLineModifiersFromJson(item.line_modifiers ?? undefined);
  }

  /** Items sorted by status; show pending, preparing, and ready (hide delivered/cancelled so paid orders stay until delivered). */
  getSortedItems(items: OrderItem[]): OrderItem[] {
    const order: Record<string, number> = {
      pending: 0,
      preparing: 1,
      ready: 2,
      delivered: 3,
      cancelled: 4,
    };
    const notYetDelivered = [...items].filter(
      (i) => !i.removed_by_customer && (i.status === 'pending' || i.status === 'preparing' || i.status === 'ready')
    );
    return notYetDelivered.sort((a, b) => {
      const aOrder = order[a.status || 'pending'] ?? 5;
      const bOrder = order[b.status || 'pending'] ?? 5;
      return aOrder - bOrder;
    });
  }

  formatOrderTime(dateString: string): string {
    if (!dateString) return '—';
    const dateStr =
      dateString.endsWith('Z') || dateString.includes('+') || dateString.includes('-', 10)
        ? dateString
        : dateString + 'Z';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '—';
    const diffMs = Date.now() - date.getTime();
    if (diffMs < 60_000) return '< 1m ago';
    if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  formatExactTime(dateString: string): string {
    if (!dateString) return '';
    const dateStr =
      dateString.endsWith('Z') || dateString.includes('+') || dateString.includes('-', 10)
        ? dateString
        : dateString + 'Z';
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? dateString : date.toLocaleString();
  }

  getItemStatusTransitions(currentStatus: string): { forward: string[]; backward: string[] } {
    const transitions: Record<string, { forward: string[]; backward: string[] }> = {
      // Ready and delivered happen in a single step now (skip the separate "ready" click).
      pending: { forward: ['preparing'], backward: [] },
      preparing: { forward: ['delivered'], backward: ['pending'] },
      ready: { forward: ['delivered'], backward: ['preparing'] },
      delivered: { forward: [], backward: ['preparing'] },
      cancelled: { forward: [], backward: [] },
    };
    const key = (currentStatus ?? '').toString().toLowerCase();
    return transitions[key] ?? { forward: [], backward: [] };
  }

  toggleItemStatusDropdown(orderId: number, itemId: number): void {
    const key = `${orderId}-${itemId}`;
    const wasOpen = this.itemStatusDropdownOpen() === key;
    this.itemStatusDropdownOpen.update((current) => (current === key ? null : key));
    if (wasOpen) {
      this.flushPendingBackgroundRefresh();
    }
  }

  updateItemStatus(orderId: number, itemId: number, status: string): void {
    this.itemStatusDropdownOpen.set(null);
    this.api.updateOrderItemStatus(orderId, itemId, status).subscribe({
      next: () => this.loadOrders({ background: true }),
      error: () => this.loadOrders({ background: true }),
    });
  }
}
