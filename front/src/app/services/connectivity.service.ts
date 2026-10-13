import { Injectable, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type ConnectivityStatus = 'online' | 'offline' | 'degraded';

/**
 * Staff connectivity: browser online/offline + optional /health probe for "backend down".
 * See docs/0063-offline-capable-client.md.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly browserOnline = signal(true);
  private readonly backendReachable = signal(true);

  readonly status = computed<ConnectivityStatus>(() => {
    if (!this.browserOnline()) return 'offline';
    if (!this.backendReachable()) return 'degraded';
    return 'online';
  });

  readonly isOnline = computed(() => this.status() === 'online');

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;
    this.browserOnline.set(typeof navigator !== 'undefined' ? navigator.onLine : true);
    window.addEventListener('online', () => {
      this.browserOnline.set(true);
      void this.probeBackend();
    });
    window.addEventListener('offline', () => {
      this.browserOnline.set(false);
      this.backendReachable.set(false);
    });
    void this.probeBackend();
    setInterval(() => void this.probeBackend(), 30_000);
  }

  async probeBackend(): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId)) return true;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.backendReachable.set(false);
      return false;
    }
    try {
      const base = environment.apiUrl.replace(/\/$/, '');
      await firstValueFrom(this.http.get(`${base}/health`, { responseType: 'text' }));
      this.backendReachable.set(true);
      return true;
    } catch {
      this.backendReachable.set(false);
      return false;
    }
  }
}
