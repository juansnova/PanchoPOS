import { Injectable, inject, signal } from '@angular/core';
import { InventoryService } from './inventory.service';
import { StockAlert } from './inventory.types';

/**
 * Stock notices for the administrator. One shared state so the sidebar badge and the
 * notices panel always agree; the sidebar polls, the panel refreshes after each decision.
 */
@Injectable({ providedIn: 'root' })
export class StockAlertsService {
  private inventory = inject(InventoryService);

  readonly alerts = signal<StockAlert[]>([]);
  readonly attentionCount = signal(0);
  readonly loaded = signal(false);

  refresh(): void {
    this.inventory.getStockAlerts().subscribe({
      next: (res) => {
        this.alerts.set(res.alerts);
        this.attentionCount.set(res.attention_count);
        this.loaded.set(true);
      },
      error: () => {
        /* Not an admin / module off: leave the badge hidden. */
      },
    });
  }
}
