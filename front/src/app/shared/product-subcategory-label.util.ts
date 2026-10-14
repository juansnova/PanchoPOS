import { TranslateService } from '@ngx-translate/core';

/** English display strings from `back/app/category_codes.py` → subcategory code. */
export const SUBCATEGORY_STRING_TO_CODE: Record<string, string> = {
  Appetizers: 'APPETIZERS',
  Salads: 'SALADS',
  Soups: 'SOUPS',
  'Bread & Dips': 'BREAD_DIPS',
  Meat: 'MEAT',
  Fish: 'FISH',
  Poultry: 'POULTRY',
  Vegetarian: 'VEGETARIAN',
  Vegan: 'VEGAN',
  Pasta: 'PASTA',
  Rice: 'RICE',
  Pizza: 'PIZZA',
  Cakes: 'CAKES',
  'Ice Cream': 'ICE_CREAM',
  Fruit: 'FRUIT',
  Cheese: 'CHEESE',
  'Hot Drinks': 'HOT_DRINKS',
  'Cold Drinks': 'COLD_DRINKS',
  Alcoholic: 'ALCOHOLIC',
  'Non-Alcoholic': 'NON_ALCOHOLIC',
  Wine: 'WINE',
  Beer: 'BEER',
  Cocktails: 'COCKTAILS',
  'Soft Drinks': 'SOFT_DRINKS',
  'Red Wine': 'WINE_RED',
  'White Wine': 'WINE_WHITE',
  'Sparkling Wine': 'WINE_SPARKLING',
  'Rosé Wine': 'WINE_ROSE',
  'Sweet Wine': 'WINE_SWEET',
  'Fortified Wine': 'WINE_FORTIFIED',
  'Wine by Glass': 'WINE_BY_GLASS',
  Vegetables: 'VEGETABLES',
  Potatoes: 'POTATOES',
  Bread: 'BREAD',
};

const SUBCATEGORY_CODES = new Set(Object.values(SUBCATEGORY_STRING_TO_CODE));

export function resolveSubcategoryCode(subcategory: string): string | null {
  if (!subcategory) return null;
  if (SUBCATEGORY_CODES.has(subcategory)) return subcategory;
  return SUBCATEGORY_STRING_TO_CODE[subcategory] ?? null;
}

export function getSubcategoryI18nKey(subcategory: string): string | null {
  const code = resolveSubcategoryCode(subcategory);
  return code ? `PRODUCTS.SUBCATEGORY_${code}` : null;
}

/** Localized label for standard subcategories; custom tenant names pass through unchanged. */
export function getSubcategoryLabel(subcategory: string, translate: TranslateService): string {
  const key = getSubcategoryI18nKey(subcategory);
  if (key) return translate.instant(key);
  return subcategory;
}
