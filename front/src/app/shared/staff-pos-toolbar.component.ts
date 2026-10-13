import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { ApiService, TenantUiModuleKey } from '../services/api.service';
import { PermissionService } from '../services/permission.service';
import { TablesAreaPreferenceService } from '../services/tables-area-preference.service';
import { StaffLayoutService } from '../services/staff-layout.service';

/**
 * Orders ↔ Tables switcher plus sidebar collapse and fullscreen (icon-only), for staff POS flows.
 */
@Component({
  selector: 'app-staff-pos-toolbar',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule],
  template: `
    @if (showBar()) {
      <div class="staff-pos-toolbar" role="toolbar" [attr.aria-label]="'STAFF_FLOW.TOOLBAR_ARIA' | translate">
        <div class="staff-pos-segment" role="group">
          @if (canOrders()) {
            <a
              routerLink="/staff/orders"
              class="segment-btn"
              [class.active]="isOrdersRoute()"
              data-testid="staff-flow-orders-link">
              {{ 'NAV.ORDERS' | translate }}
            </a>
          }
          @if (canTables()) {
            <a
              [routerLink]="tablesArea.entryPath()"
              class="segment-btn"
              [class.active]="isTablesRoute()"
              data-testid="staff-flow-tables-link">
              {{ 'NAV.TABLES' | translate }}
            </a>
          }
        </div>
        <div class="staff-pos-toolbar-actions">
          <button
            type="button"
            class="icon-toolbar-btn"
            (click)="layout.toggleSidebarCollapsed()"
            [attr.aria-pressed]="layout.sidebarCollapsed()"
            [attr.aria-label]="(layout.sidebarCollapsed() ? 'STAFF_FLOW.SHOW_NAV' : 'STAFF_FLOW.HIDE_NAV') | translate"
            [title]="(layout.sidebarCollapsed() ? 'STAFF_FLOW.SHOW_NAV' : 'STAFF_FLOW.HIDE_NAV') | translate"
            data-testid="staff-flow-toggle-sidebar">
            @if (layout.sidebarCollapsed()) {
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h7"/>
                <polyline points="15,15 18,12 15,9"/>
              </svg>
            } @else {
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M4 6h16M4 12h10M4 18h16"/>
                <polyline points="17,15 14,12 17,9"/>
              </svg>
            }
          </button>
          <button
            type="button"
            class="icon-toolbar-btn"
            (click)="layout.toggleFullscreen()"
            [attr.aria-pressed]="layout.fullscreenActive()"
            [attr.aria-label]="(layout.fullscreenActive() ? 'STAFF_FLOW.EXIT_FULLSCREEN' : 'STAFF_FLOW.ENTER_FULLSCREEN') | translate"
            [title]="(layout.fullscreenActive() ? 'STAFF_FLOW.EXIT_FULLSCREEN' : 'STAFF_FLOW.ENTER_FULLSCREEN') | translate"
            data-testid="staff-flow-toggle-fullscreen">
            @if (layout.fullscreenActive()) {
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/>
              </svg>
            } @else {
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
              </svg>
            }
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    .staff-pos-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--space-3);
      margin-bottom: var(--space-4);
      padding-bottom: var(--space-3);
      border-bottom: 1px solid var(--color-border);
    }
    .staff-pos-segment {
      display: inline-flex;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      overflow: hidden;
      background: var(--color-surface);
    }
    .segment-btn {
      padding: var(--space-2) var(--space-4);
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-text-muted);
      text-decoration: none;
      border: none;
      background: transparent;
      cursor: pointer;
      min-height: 40px;
      display: inline-flex;
      align-items: center;
    }
    .segment-btn:hover {
      color: var(--color-text);
      background: var(--color-bg);
    }
    .segment-btn.active {
      color: var(--color-primary);
      background: var(--color-primary-light);
    }
    .staff-pos-toolbar-actions {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .icon-toolbar-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      padding: 0;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-text);
      cursor: pointer;
    }
    .icon-toolbar-btn:hover {
      background: var(--color-bg);
    }
  `]
})
export class StaffPosToolbarComponent {
  private api = inject(ApiService);
  private permissions = inject(PermissionService);

  protected tablesArea = inject(TablesAreaPreferenceService);
  protected layout = inject(StaffLayoutService);
  private router = inject(Router);

  showBar(): boolean {
    return this.canOrders() || this.canTables();
  }

  canOrders(): boolean {
    return this.permissions.canAccessRoute(this.api.getCurrentUser(), '/staff/orders');
  }

  canTables(): boolean {
    const u = this.api.getCurrentUser();
    return this.moduleEnabled('tables') && this.permissions.canAccessRoute(u, '/tables');
  }

  private moduleEnabled(key: TenantUiModuleKey): boolean {
    return this.api.isUiModuleEnabled(key);
  }

  isOrdersRoute(): boolean {
    return this.router.url.split('?')[0].startsWith('/staff/orders');
  }

  isTablesRoute(): boolean {
    return this.router.url.split('?')[0].startsWith('/tables');
  }
}
