import { TranslateService } from '@ngx-translate/core';

/** English display strings from `back/app/category_codes.py` (CATEGORY_CODES values) -> i18n key. */
const CATEGORY_KEY_MAP: Record<string, string> = {
  Starters: 'PRODUCTS.CATEGORY_STARTERS',
  'Main Course': 'PRODUCTS.CATEGORY_MAIN_COURSE',
  Desserts: 'PRODUCTS.CATEGORY_DESSERTS',
  Beverages: 'PRODUCTS.CATEGORY_BEVERAGES',
  Sides: 'PRODUCTS.CATEGORY_SIDES',
};

/**
 * Display label for a product category.
 * Priority: tenant rename override (from GET /tenant/categories/labels) > built-in Spanish
 * translation for the 5 standard categories > raw name (tenant-created custom categories,
 * which the owner already types in their own language).
 */
export function getCategoryLabel(
  category: string,
  translate: TranslateService,
  overrides?: Record<string, string> | null
): string {
  const override = overrides?.[category];
  if (override) return override;
  const key = CATEGORY_KEY_MAP[category];
  if (key) return translate.instant(key);
  return category;
}
