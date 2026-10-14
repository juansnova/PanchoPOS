import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

// Single-restaurant deployment (Pancho Panza, Colombia): the app only ships
// Spanish UI copy (front/public/i18n/es.json), so the language is fixed.
export type LanguageCode = 'es';

const LANGUAGE: LanguageCode = 'es';
const LOCALE = 'es-CO';

@Injectable({
  providedIn: 'root'
})
export class LanguageService {
  private translate = inject(TranslateService);

  currentLanguage = signal<LanguageCode>(LANGUAGE);
  currentLocale = signal<string>(LOCALE);

  constructor() {
    this.translate.addLangs([LANGUAGE]);
    this.translate.setDefaultLang(LANGUAGE);
    this.translate.use(LANGUAGE);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = LANGUAGE;
      document.documentElement.dir = 'ltr';
    }
  }

  /** No-op: the app only ships Spanish. Kept so existing callers don't need to change. */
  setLanguage(_lang: string): void {}

  getLanguage(): LanguageCode {
    return LANGUAGE;
  }

  getLocale(): string {
    return LOCALE;
  }

  /**
   * Format a number using the current locale
   */
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.currentLocale(), options).format(value);
  }

  /**
   * Format currency using the current locale and specified currency code
   */
  formatCurrency(value: number, currencyCode: string): string {
    return new Intl.NumberFormat(this.currentLocale(), {
      style: 'currency',
      currency: currencyCode,
      currencyDisplay: 'symbol'
    }).format(value);
  }

  /**
   * Format a date using the current locale
   */
  formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat(this.currentLocale(), options).format(dateObj);
  }

  /**
   * Get Accept-Language header value for API requests
   */
  getAcceptLanguageHeader(): string {
    return 'es;q=1.0';
  }
}
