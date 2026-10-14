/** This deployment (Pancho Panza, Colombia) only operates in Colombian pesos (COP). */
export function currencySymbol(): string {
  return '$';
}

/** Format price cents as Colombian pesos (e.g. 125000 -> "$ 1.250"). */
export function formatMoneyCents(priceCents: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    currencyDisplay: 'symbol',
  }).format(priceCents / 100);
}
