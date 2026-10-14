import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

/** FastAPI-style `detail` object with stable `code` for ngx-translate. */
export interface StructuredApiErrorDetail {
  code: string;
  message?: string;
  params?: Record<string, string | number>;
  [key: string]: unknown;
}

function isStructuredDetail(d: unknown): d is StructuredApiErrorDetail {
  return (
    !!d &&
    typeof d === 'object' &&
    !Array.isArray(d) &&
    typeof (d as StructuredApiErrorDetail).code === 'string'
  );
}

@Injectable({ providedIn: 'root' })
export class ApiErrorMessageService {
  private translate = inject(TranslateService);

  /**
   * User-facing message: prefers `API_ERRORS.<CODE>` from current UI language,
   * then server `message` (Accept-Language), then validation `msg`, then fallback i18n key.
   */
  fromHttpError(
    err: HttpErrorResponse | { error?: unknown; status?: number },
    fallbackKey: string,
  ): string {
    const body =
      err && typeof err === 'object' && 'error' in err
        ? (err as HttpErrorResponse).error
        : undefined;
    const detail = body && typeof body === 'object' ? (body as { detail?: unknown }).detail : undefined;

    if (typeof detail === 'string' && detail.trim().length > 0) {
      return detail;
    }

    if (isStructuredDetail(detail)) {
      const i18nKey = `API_ERRORS.${detail.code.replace(/-/g, '_').toUpperCase()}`;
      const params = detail.params as Record<string, string | number> | undefined;
      const translated = this.translate.instant(i18nKey, params);
      if (translated && translated !== i18nKey) {
        return translated;
      }
      if (typeof detail.message === 'string' && detail.message.trim().length > 0) {
        return detail.message;
      }
    }

    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: unknown };
      if (first && typeof first.msg === 'string' && first.msg.trim().length > 0) {
        return first.msg;
      }
    }

    return this.translate.instant(fallbackKey);
  }
}
