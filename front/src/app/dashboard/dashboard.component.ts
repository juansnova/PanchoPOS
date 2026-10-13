import { Component, inject, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SidebarComponent } from '../shared/sidebar.component';
import { TranslateModule } from '@ngx-translate/core';
import { PermissionService } from '../services/permission.service';
import {
  ApiService,
  TenantUiModuleKey,
  WorkSession,
  workSessionOpenExceedsContract,
} from '../services/api.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, SidebarComponent, RouterLink, TranslateModule],
  template: `
    <app-sidebar>
        <div class="welcome-section">
          <span class="eyebrow">{{ 'DASHBOARD.TITLE' | translate }}</span>
          <h1 class="welcome-title">{{ 'DASHBOARD.WELCOME_BACK' | translate }}<span class="title-dot">.</span></h1>
          <p class="welcome-text">{{ 'DASHBOARD.WELCOME_TEXT' | translate }}</p>
        </div>

        <div class="quick-actions">
          @if (canViewMyShift()) {
            <a routerLink="/my-shift" class="action-card" data-testid="dashboard-my-shift">
              <div class="action-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <span class="action-label">{{ 'DASHBOARD.MY_SHIFT_TITLE' | translate }}</span>
              @if (shiftStatusLoading()) {
                <span class="action-desc">{{ 'DASHBOARD.MY_SHIFT_LOADING' | translate }}</span>
              } @else if (shiftOpen(); as sh) {
                <span class="action-desc action-desc-shift-on">{{ 'DASHBOARD.MY_SHIFT_DESC_ON' | translate }}</span>
                @if (shiftExceedsContract()) {
                  <span class="action-desc action-desc-shift-overtime" data-testid="dashboard-my-shift-overtime">{{
                    'DASHBOARD.MY_SHIFT_OVERTIME' | translate
                  }}</span>
                }
              } @else {
                <span class="action-desc">{{ 'DASHBOARD.MY_SHIFT_DESC_OFF' | translate }}</span>
              }
            </a>
          }
          <a routerLink="/staff/orders" class="action-card">
            <div class="action-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 2h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4V2z"/>
                <line x1="9" y1="7" x2="15" y2="7"/>
                <line x1="9" y1="11" x2="15" y2="11"/>
              </svg>
            </div>
            <span class="action-label">{{ 'DASHBOARD.ORDERS_TITLE' | translate }}</span>
            <span class="action-desc">{{ 'DASHBOARD.ORDERS_DESC' | translate }}</span>
          </a>
          @if (canViewReservations() && moduleEnabled('reservations')) {
          <a routerLink="/reservations" class="action-card">
            <div class="action-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <span class="action-label">{{ 'DASHBOARD.RESERVATIONS_TITLE' | translate }}</span>
            <span class="action-desc">{{ 'DASHBOARD.RESERVATIONS_DESC' | translate }}</span>
          </a>
          }
          @if (canViewTables() && moduleEnabled('tables')) {
          <a routerLink="/tables" class="action-card">
            <div class="action-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="8" width="20" height="3" rx="1"/>
                <line x1="5" y1="11" x2="5" y2="20"/>
                <line x1="19" y1="11" x2="19" y2="20"/>
              </svg>
            </div>
            <span class="action-label">{{ 'DASHBOARD.TABLES_TITLE' | translate }}</span>
            <span class="action-desc">{{ 'DASHBOARD.TABLES_DESC' | translate }}</span>
          </a>
          }
          @if (canViewKitchen() && moduleEnabled('kitchen_bar')) {
          <a routerLink="/kitchen" class="action-card">
            <div class="action-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/>
              </svg>
            </div>
            <span class="action-label">{{ 'DASHBOARD.KITCHEN_TITLE' | translate }}</span>
            <span class="action-desc">{{ 'DASHBOARD.KITCHEN_DESC' | translate }}</span>
          </a>
          }
          @if (moduleEnabled('kitchen_bar')) {
          <a routerLink="/bar" class="action-card">
            <div class="action-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 8h1a4 4 0 010 8h-1"/>
                <path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/>
                <line x1="6" y1="2" x2="6" y2="4"/>
                <line x1="10" y1="1" x2="10" y2="4"/>
                <line x1="14" y1="2" x2="14" y2="4"/>
              </svg>
            </div>
            <span class="action-label">{{ 'DASHBOARD.BEVERAGES_TITLE' | translate }}</span>
            <span class="action-desc">{{ 'DASHBOARD.BEVERAGES_DESC' | translate }}</span>
          </a>
          }
          @if (canViewProducts()) {
          <a routerLink="/products" class="action-card">
            <div class="action-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20.59 13.41L11 3.83A2 2 0 009.57 3H4a1 1 0 00-1 1v5.57a2 2 0 00.59 1.41l9.58 9.58a2 2 0 002.82 0l4.6-4.6a2 2 0 000-2.82z"/>
                <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" stroke="none"/>
              </svg>
            </div>
            <span class="action-label">{{ 'DASHBOARD.PRODUCTS_TITLE' | translate }}</span>
            <span class="action-desc">{{ 'DASHBOARD.PRODUCTS_DESC' | translate }}</span>
          </a>
          }
          @if (canViewCustomers()) {
          <a routerLink="/customers" class="action-card">
            <div class="action-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
              </svg>
            </div>
            <span class="action-label">{{ 'DASHBOARD.CUSTOMERS_TITLE' | translate }}</span>
            <span class="action-desc">{{ 'DASHBOARD.CUSTOMERS_DESC' | translate }}</span>
          </a>
          }
          @if (canShowAdminSections()) {
            @if (moduleEnabled('working_plan')) {
            <a routerLink="/working-plan" class="action-card">
              <div class="action-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <span class="action-label">{{ 'DASHBOARD.WORKING_PLAN_TITLE' | translate }}</span>
              <span class="action-desc">{{ 'DASHBOARD.WORKING_PLAN_DESC' | translate }}</span>
            </a>
            }
            @if (moduleEnabled('inventory')) {
            <a routerLink="/inventory" class="action-card">
              <div class="action-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1"/>
                  <rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/>
                  <rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
              </div>
              <span class="action-label">{{ 'DASHBOARD.INVENTORY_TITLE' | translate }}</span>
              <span class="action-desc">{{ 'DASHBOARD.INVENTORY_DESC' | translate }}</span>
            </a>
            }
            <a routerLink="/reports" class="action-card">
              <div class="action-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
                </svg>
              </div>
              <span class="action-label">{{ 'DASHBOARD.REPORTS_TITLE' | translate }}</span>
              <span class="action-desc">{{ 'DASHBOARD.REPORTS_DESC' | translate }}</span>
            </a>
            @if (moduleEnabled('users')) {
            <a routerLink="/users" class="action-card">
              <div class="action-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
                </svg>
              </div>
              <span class="action-label">{{ 'DASHBOARD.USERS_TITLE' | translate }}</span>
              <span class="action-desc">{{ 'DASHBOARD.USERS_DESC' | translate }}</span>
            </a>
            }
            <a routerLink="/settings" class="action-card">
              <div class="action-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
                </svg>
              </div>
              <span class="action-label">{{ 'DASHBOARD.SETTINGS_TITLE' | translate }}</span>
              <span class="action-desc">{{ 'DASHBOARD.SETTINGS_DESC' | translate }}</span>
            </a>
          }
        </div>

    </app-sidebar>
  `,
  styles: [`
    .welcome-section {
      margin-bottom: var(--space-6);

      .eyebrow {
        display: inline-block;
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--color-brand-accent);
        margin-bottom: var(--space-2);
      }

      .welcome-title {
        font-family: var(--font-brand);
        font-size: clamp(2rem, 4vw, 2.75rem);
        font-weight: 600;
        color: var(--color-text);
        line-height: 1.15;
        margin-bottom: var(--space-2);
      }

      .title-dot {
        color: var(--color-brand-accent);
      }

      .welcome-user {
        color: var(--color-text-muted);
        margin-bottom: var(--space-1);

        strong {
          color: var(--color-text);
        }
      }

      .welcome-text {
        color: var(--color-text-muted);
        font-size: 1.0625rem;
      }
    }

    .quick-actions {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); /* Increased from 200px */
      gap: var(--space-4);
    }

    .action-card {
      position: relative;
      display: flex;
      flex-direction: column;
      padding: var(--space-5);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      text-decoration: none;
      overflow: hidden;
      transition: all 0.2s ease;

      &::before {
        content: '';
        position: absolute;
        inset: 0 0 auto 0;
        height: 3px;
        background: linear-gradient(90deg, var(--color-brand-accent), color-mix(in srgb, var(--color-brand-accent) 40%, transparent));
        transform: scaleX(0);
        transform-origin: left;
        transition: transform 0.25s ease;
      }

      &:hover {
        border-color: var(--color-brand-accent);
        box-shadow: 0 10px 28px color-mix(in srgb, var(--color-brand-accent) 18%, transparent);
        transform: translateY(-3px);

        &::before {
          transform: scaleX(1);
        }

        .action-icon {
          background: var(--color-brand-accent);
          color: #fff;
        }
      }
    }

    .action-icon {
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--color-brand-accent) 14%, transparent);
      border-radius: var(--radius-md);
      color: var(--color-brand-accent);
      margin-bottom: var(--space-4);
      transition: all 0.2s ease;
    }

    .action-label {
      font-family: var(--font-brand);
      font-size: 1.0625rem;
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: var(--space-1);
    }

    .action-desc {
      font-size: 0.875rem;
      color: var(--color-text-muted);
    }

    .action-desc-shift-on {
      color: var(--color-success, #15803d);
      font-weight: 500;
    }

    .action-desc-shift-overtime {
      display: block;
      margin-top: var(--space-1);
      color: var(--color-warning-strong, #b45309);
      font-weight: 500;
    }

    @media (max-width: 768px) {
      .quick-actions {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class DashboardComponent implements OnInit, OnDestroy {
  private permissions = inject(PermissionService);
  private api = inject(ApiService);

  user = signal(this.api.getCurrentUser());
  canShowAdminSections = computed(() => this.permissions.isAdmin(this.user()));
  canViewCustomers = computed(() => this.permissions.canAccessRoute(this.user(), '/customers'));
  canViewMyShift = computed(() => this.permissions.canAccessRoute(this.user(), '/my-shift'));
  canViewReservations = computed(() => this.permissions.hasPermission(this.user(), 'reservation:read'));
  canViewTables = computed(() => this.permissions.canAccessRoute(this.user(), '/tables'));
  canViewKitchen = computed(() => this.permissions.canAccessRoute(this.user(), '/kitchen'));
  canViewProducts = computed(() => this.permissions.canAccessRoute(this.user(), '/products'));

  /** Open work session when clocked in; null when not; only loaded when `canViewMyShift`. */
  shiftOpen = signal<WorkSession | null>(null);
  shiftStatusLoading = signal(false);
  private shiftUiTick = signal(0);
  private shiftTicker: ReturnType<typeof setInterval> | null = null;

  shiftExceedsContract = computed(() => {
    this.shiftUiTick();
    return workSessionOpenExceedsContract(this.shiftOpen());
  });

  ngOnInit() {
    this.api.ensureTenantUiModulesLoaded().subscribe();
    const u = this.api.getCurrentUser();
    this.user.set(u);
    if (this.permissions.canAccessRoute(u, '/my-shift')) {
      this.shiftStatusLoading.set(true);
      this.api.getMyOpenWorkSession().subscribe({
        next: (s) => {
          this.shiftOpen.set(s);
          this.shiftStatusLoading.set(false);
          if (this.shiftTicker != null) {
            clearInterval(this.shiftTicker);
            this.shiftTicker = null;
          }
          if (s) {
            this.shiftTicker = setInterval(() => this.shiftUiTick.update((x) => x + 1), 60_000);
          }
        },
        error: () => {
          this.shiftOpen.set(null);
          this.shiftStatusLoading.set(false);
          if (this.shiftTicker != null) {
            clearInterval(this.shiftTicker);
            this.shiftTicker = null;
          }
        },
      });
    }
  }

  ngOnDestroy(): void {
    if (this.shiftTicker != null) {
      clearInterval(this.shiftTicker);
      this.shiftTicker = null;
    }
  }

  moduleEnabled(key: TenantUiModuleKey): boolean {
    return this.api.isUiModuleEnabled(key);
  }
}
