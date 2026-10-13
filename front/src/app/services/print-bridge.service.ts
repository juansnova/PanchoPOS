import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService, PrintBridgeStatus, PrintJobCreateResponse } from './api.service';

export type PrintViaBridgeResult =
  | { ok: true; via: 'bridge'; response: PrintJobCreateResponse }
  | { ok: false; via: 'fallback'; reason: 'offline' | 'error'; message?: string };

/**
 * Enqueue kitchen/receipt jobs when a LAN print agent is online; otherwise signal browser fallback.
 */
@Injectable({ providedIn: 'root' })
export class PrintBridgeService {
  private readonly api = inject(ApiService);

  readonly lastBridgeWarning = signal<string | null>(null);

  clearWarning(): void {
    this.lastBridgeWarning.set(null);
  }

  async getStatus(): Promise<PrintBridgeStatus> {
    return firstValueFrom(this.api.getPrintBridgeStatus());
  }

  /**
   * Try silent LAN print via backend queue. Returns fallback when agent offline or request fails.
   */
  async tryEnqueue(
    jobType: 'kitchen' | 'receipt',
    orderId: number,
    printerRole?: string,
  ): Promise<PrintViaBridgeResult> {
    try {
      const status = await this.getStatus();
      if (!status.agent_online) {
        this.lastBridgeWarning.set('ORDERS.PRINT_BRIDGE_OFFLINE');
        return { ok: false, via: 'fallback', reason: 'offline' };
      }
      const response = await firstValueFrom(
        this.api.createPrintJob({
          job_type: jobType,
          order_id: orderId,
          printer_role: printerRole ?? null,
        }),
      );
      if (!response.bridge?.agent_online) {
        this.lastBridgeWarning.set('ORDERS.PRINT_BRIDGE_OFFLINE');
        return { ok: false, via: 'fallback', reason: 'offline' };
      }
      this.lastBridgeWarning.set(null);
      return { ok: true, via: 'bridge', response };
    } catch (e: unknown) {
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message?: string }).message || '')
          : '';
      this.lastBridgeWarning.set('ORDERS.PRINT_BRIDGE_OFFLINE');
      return { ok: false, via: 'fallback', reason: 'error', message };
    }
  }
}
