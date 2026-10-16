import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { ApiService } from '../services/api.service';
import { AudioService } from '../services/audio.service';
import { WaiterAlertService } from '../services/waiter-alert.service';

/**
 * Global "customer is calling" banner for staff. Lives in the app root so the waiter sees it
 * on any page (tables, orders, kitchen...), not only on Orders.
 */
@Component({
  selector: 'app-waiter-alert-banner',
  imports: [TranslateModule],
  template: `
    @if (alerts.firstPending(); as alert) {
      <div class="waiter-alert-banner" [class.payment]="alert.type === 'payment_requested'">
        <div class="waiter-alert-icon">
          @if (alert.type === 'call_waiter') {
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          } @else {
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
              <line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
          }
        </div>
        <div class="waiter-alert-text">
          <strong>{{ alert.tableName }}</strong>
          <span>{{ alert.type === 'call_waiter' ? ('NOTIFICATIONS.CALL_WAITER_YOURS' | translate) : ('NOTIFICATIONS.PAYMENT_REQUEST_YOURS' | translate) }}</span>
          @if (alert.message) {
            <span class="waiter-alert-message">"{{ alert.message }}"</span>
          }
        </div>
        <button type="button" class="waiter-alert-dismiss" (click)="alerts.remove(alert.id)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    }
  `,
  styles: [`
    .waiter-alert-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 2000;
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px 20px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white;
      animation: slideDown 0.3s ease, pulse 1.5s ease-in-out 3;
      box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);
    }
    .waiter-alert-banner.payment {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      box-shadow: 0 4px 20px rgba(245, 158, 11, 0.4);
    }
    .waiter-alert-icon { flex-shrink: 0; display: flex; align-items: center; animation: ring 0.6s ease-in-out 3; }
    .waiter-alert-text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .waiter-alert-text strong { font-size: 1rem; }
    .waiter-alert-text span { font-size: 0.875rem; opacity: 0.9; }
    .waiter-alert-message { font-style: italic; margin-top: 2px; }
    .waiter-alert-dismiss {
      background: rgba(255,255,255,0.2);
      border: none;
      border-radius: 8px;
      color: white;
      cursor: pointer;
      padding: 8px;
      display: flex;
    }
    .waiter-alert-dismiss:hover { background: rgba(255,255,255,0.35); }
    @keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.85; } }
    @keyframes ring { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(15deg); } 75% { transform: rotate(-15deg); } }
  `],
})
export class WaiterAlertBannerComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private audio = inject(AudioService);
  readonly alerts = inject(WaiterAlertService);
  private subs = new Subscription();

  ngOnInit() {
    // Keep the tenant WebSocket open for logged-in waiters/owners on every page.
    this.subs.add(this.api.user$.subscribe(user => {
      if (user && (user.role === 'waiter' || user.role === 'owner')) this.api.connectWebSocket();
    }));

    this.subs.add(this.api.orderUpdates$.subscribe((update: any) => {
      if (update?.type !== 'call_waiter' && update?.type !== 'payment_requested') return;
      const user = this.api.getCurrentUser();
      if (!user) return;
      // Only the assigned waiter is alerted; if the table has nobody assigned, fall back to the owner.
      const assignedId = update.assigned_waiter_id;
      const isForMe = assignedId ? assignedId === user.id : user.role === 'owner';
      if (isForMe) {
        this.alerts.add(update.table_name || 'Table', update.message || '', update.type);
        this.audio.playUrgentWaiterAlert();
      }
    }));
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
