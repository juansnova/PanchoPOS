import { Injectable, signal } from '@angular/core';

const TABLES_AREA_STORAGE_KEY = 'pos.tables.area';

export type TablesArea = 'canvas' | 'list';

/**
 * Remembers whether the user last used the floor plan (/tables/canvas) or the list view (/tables)
 * so the sidebar "Tables" link and in-app navigation can restore context.
 */
@Injectable({ providedIn: 'root' })
export class TablesAreaPreferenceService {
  /** Route path for sidebar and switches: `/tables/canvas` or `/tables`. */
  readonly entryPath = signal<string>(this.readPathFromStorage());

  private readPathFromStorage(): string {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return '/tables';
      const v = window.localStorage.getItem(TABLES_AREA_STORAGE_KEY);
      return v === 'canvas' ? '/tables/canvas' : '/tables';
    } catch {
      return '/tables';
    }
  }

  setArea(area: TablesArea): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(TABLES_AREA_STORAGE_KEY, area);
      }
    } catch {
      /* ignore */
    }
    this.entryPath.set(area === 'canvas' ? '/tables/canvas' : '/tables');
  }
}
