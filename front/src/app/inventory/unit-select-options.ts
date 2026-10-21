import { TranslateService } from '@ngx-translate/core';
import { AppSelectOption } from '../shared/app-select.component';
import { UnitOfMeasure, inventoryUnitKey } from './inventory.types';

/** Hand-drawn line icons per unit (24x24, stroke): a grain, kettlebell, scale, sack, drop, tube, bottle, shot glass, mug and jug. */
export const UNIT_ICONS: Record<string, string> = {
  piece: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  gram: '<path d="M12 21V9"/><path d="M12 9c-2.5-.2-4-1.8-4-4 2.5.2 4 1.8 4 4zM12 9c2.5-.2 4-1.8 4-4-2.5.2-4 1.8-4 4zM12 14c-2.5-.2-4-1.8-4-4 2.5.2 4 1.8 4 4zM12 14c2.5-.2 4-1.8 4-4-2.5.2-4 1.8-4 4z"/>',
  kilogram: '<circle cx="12" cy="14.5" r="6"/><path d="M8.6 9.8C9 6.2 10.4 4 12 4s3 2.2 3.4 5.8"/><path d="M10 14.5h4"/>',
  ounce: '<path d="M12 4v16M8 20h8M5 7.5h14"/><path d="M5 7.5L2.5 13a2.5 2.5 0 005 0zM19 7.5L16.5 13a2.5 2.5 0 005 0z"/>',
  pound: '<path d="M8.5 3.5h7L14 7c3 1.8 4.5 4.6 4.5 7.5a5 5 0 01-5 5h-3a5 5 0 01-5-5C5.5 11.6 7 8.8 10 7z"/><path d="M9.2 7h5.6"/>',
  milliliter: '<path d="M12 3s6 6.2 6 10.5a6 6 0 01-12 0C6 9.2 12 3 12 3z"/><path d="M9.5 14a2.6 2.6 0 002.5 2.6"/>',
  centiliter: '<path d="M9 3h6M10 3v13a2 2 0 004 0V3"/><path d="M10 12h4M10 8.5h2"/>',
  liter: '<path d="M10 2h4v3l1.6 2.6V20a2 2 0 01-2 2h-3.2a2 2 0 01-2-2V7.6L10 5z"/><path d="M8.4 12.5h7.2"/>',
  fluid_ounce: '<path d="M7 5h10l-1.4 14a1.5 1.5 0 01-1.5 1.4H9.9a1.5 1.5 0 01-1.5-1.4z"/><path d="M7.4 10h9.2"/>',
  cup: '<path d="M5 9h11v6a5 5 0 01-5 5h-1a5 5 0 01-5-5z"/><path d="M16 11h1.6a2.4 2.4 0 010 4.8H16"/><path d="M8.5 3.5c0 1.5 1.3 1.5 1.3 3M12.5 3.5c0 1.5 1.3 1.5 1.3 3"/>',
  gallon: '<path d="M9 2h5v3l3 3v11a3 3 0 01-3 3H9a3 3 0 01-3-3V8l3-3z"/><path d="M6 11H4.5a1.5 1.5 0 000 3H6M10 13.5h4"/>',
};

/** Short symbol shown next to numeric inputs and in the unit list. */
export function unitShort(unit: string | null | undefined): string {
  const m: Record<string, string> = {
    piece: 'pza', gram: 'g', kilogram: 'kg', ounce: 'oz', pound: 'lb', milliliter: 'ml',
    centiliter: 'cl', liter: 'L', fluid_ounce: 'fl oz', cup: 'taza', gallon: 'gal',
  };
  return m[unit ?? ''] ?? '';
}

/** Units grouped as Units / Weight / Volume with a drawn icon and the equivalence as hint (shared by every unit dropdown). */
export function unitSelectOptions(translate: TranslateService, units: UnitOfMeasure[]): AppSelectOption[] {
  const t = (k: string) => translate.instant(k);
  const meta: Record<string, { hint: string; tone: 'a' | 'b' | 'c'; group: string }> = {
    piece: { hint: t('INVENTORY.ITEMS.UNIT_HINT_COUNT'), tone: 'c', group: t('INVENTORY.ITEMS.UNIT_GROUP_COUNT') },
    gram: { hint: t('INVENTORY.ITEMS.UNIT_HINT_WEIGHT_BASE'), tone: 'a', group: t('INVENTORY.ITEMS.UNIT_GROUP_WEIGHT') },
    kilogram: { hint: '= 1.000 g', tone: 'a', group: t('INVENTORY.ITEMS.UNIT_GROUP_WEIGHT') },
    ounce: { hint: '≈ 28,35 g', tone: 'a', group: t('INVENTORY.ITEMS.UNIT_GROUP_WEIGHT') },
    pound: { hint: '≈ 453,6 g', tone: 'a', group: t('INVENTORY.ITEMS.UNIT_GROUP_WEIGHT') },
    milliliter: { hint: t('INVENTORY.ITEMS.UNIT_HINT_VOLUME_BASE'), tone: 'b', group: t('INVENTORY.ITEMS.UNIT_GROUP_VOLUME') },
    centiliter: { hint: '= 10 ml', tone: 'b', group: t('INVENTORY.ITEMS.UNIT_GROUP_VOLUME') },
    liter: { hint: '= 1.000 ml', tone: 'b', group: t('INVENTORY.ITEMS.UNIT_GROUP_VOLUME') },
    fluid_ounce: { hint: '≈ 29,6 ml', tone: 'b', group: t('INVENTORY.ITEMS.UNIT_GROUP_VOLUME') },
    cup: { hint: '≈ 240 ml', tone: 'b', group: t('INVENTORY.ITEMS.UNIT_GROUP_VOLUME') },
    gallon: { hint: '≈ 3,785 L', tone: 'b', group: t('INVENTORY.ITEMS.UNIT_GROUP_VOLUME') },
  };
  const order = ['piece', 'gram', 'kilogram', 'ounce', 'pound', 'milliliter', 'centiliter', 'liter', 'fluid_ounce', 'cup', 'gallon'];
  return order
    .filter((u) => units.includes(u as UnitOfMeasure))
    .map((u) => ({
      value: u,
      label: translate.instant(inventoryUnitKey(u)),
      sub: meta[u].hint,
      svg: UNIT_ICONS[u],
      tone: meta[u].tone,
      group: meta[u].group,
    }));
}
