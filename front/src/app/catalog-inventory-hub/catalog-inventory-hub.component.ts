import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { SidebarComponent } from '../shared/sidebar.component';
import { ApiService, TenantUiModuleKey } from '../services/api.service';
import { PermissionService } from '../services/permission.service';

@Component({
  selector: 'app-catalog-inventory-hub',
  standalone: true,
  imports: [CommonModule, SidebarComponent, RouterLink, TranslateModule],
  template: `
    <app-sidebar>
      <div class="page-header">
        <h1 data-testid="catalog-inventory-hub-title">{{ 'CATALOG_INVENTORY_HUB.TITLE' | translate }}</h1>
        <p class="intro">{{ 'CATALOG_INVENTORY_HUB.INTRO' | translate }}</p>
      </div>

      <div class="quick-actions" data-testid="catalog-inventory-hub-tiles">
        @if (canViewInventory() && moduleEnabled('inventory')) {
          <a routerLink="/inventory/items" class="action-card" data-testid="hub-tile-items">
            <div class="action-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
                <polyline points="7.5 4.21 12 6.81 16.5 4.21"/>
              </svg>
            </div>
            <span class="action-label">{{ 'CATALOG_INVENTORY_HUB.ITEMS_TITLE' | translate }}</span>
            <span class="action-desc">{{ 'CATALOG_INVENTORY_HUB.ITEMS_DESC' | translate }}</span>
          </a>

          <a routerLink="/inventory/purchase-orders" class="action-card" data-testid="hub-tile-purchase-orders">
            <div class="action-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <span class="action-label">{{ 'CATALOG_INVENTORY_HUB.PURCHASE_ORDERS_TITLE' | translate }}</span>
            <span class="action-desc">{{ 'CATALOG_INVENTORY_HUB.PURCHASE_ORDERS_DESC' | translate }}</span>
          </a>

          <a routerLink="/inventory/stock" class="action-card" data-testid="hub-tile-stock">
            <div class="action-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="20" x2="18" y2="10"/>
                <line x1="12" y1="20" x2="12" y2="4"/>
                <line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
            </div>
            <span class="action-label">{{ 'CATALOG_INVENTORY_HUB.STOCK_TITLE' | translate }}</span>
            <span class="action-desc">{{ 'CATALOG_INVENTORY_HUB.STOCK_DESC' | translate }}</span>
          </a>

          <a routerLink="/inventory/reports" class="action-card" data-testid="hub-tile-inventory-reports">
            <div class="action-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10,9 9,9 8,9"/>
              </svg>
            </div>
            <span class="action-label">{{ 'CATALOG_INVENTORY_HUB.REPORTS_TITLE' | translate }}</span>
            <span class="action-desc">{{ 'CATALOG_INVENTORY_HUB.REPORTS_DESC' | translate }}</span>
          </a>
        }
      </div>
    </app-sidebar>
  `,
  styles: [
    `
      .page-header {
        margin-bottom: var(--space-6);

        h1 {
          font-size: 1.5rem;
          font-weight: 600;
          color: var(--color-text);
          margin: 0 0 var(--space-2);
        }

        .intro {
          margin: 0;
          color: var(--color-text-muted);
          font-size: 0.9375rem;
        }
      }

      .quick-actions {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: var(--space-4);
      }

      .action-card {
        display: flex;
        flex-direction: column;
        padding: var(--space-5);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        text-decoration: none;
        transition: all 0.15s ease;

        &:hover {
          border-color: var(--color-primary);
          box-shadow: var(--shadow-md);
          transform: translateY(-2px);
        }
      }

      .action-icon {
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-primary-light);
        border-radius: var(--radius-md);
        color: var(--color-primary);
        margin-bottom: var(--space-4);
      }

      .action-label {
        font-size: 1rem;
        font-weight: 600;
        color: var(--color-text);
        margin-bottom: var(--space-1);
      }

      .action-desc {
        font-size: 0.875rem;
        color: var(--color-text-muted);
      }

      @media (max-width: 768px) {
        .quick-actions {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class CatalogInventoryHubComponent implements OnInit {
  private api = inject(ApiService);
  private permissions = inject(PermissionService);

  user = signal(this.api.getCurrentUser());
  canViewInventory = computed(() => this.permissions.isAdmin(this.user()));

  ngOnInit() {
    this.api.ensureTenantUiModulesLoaded().subscribe();
    this.user.set(this.api.getCurrentUser());
  }

  moduleEnabled(key: TenantUiModuleKey): boolean {
    return this.api.isUiModuleEnabled(key);
  }
}
