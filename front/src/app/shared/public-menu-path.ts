/** Prefer public_slug for /public-menu links; fall back to numeric id (#413). */
export function publicMenuTenantRef(tenant: {
  id: number;
  public_slug?: string | null;
}): string | number {
  const slug = tenant.public_slug?.trim();
  return slug || tenant.id;
}

export function publicMenuPath(tenant: {
  id: number;
  public_slug?: string | null;
}): string {
  return `/public-menu/${publicMenuTenantRef(tenant)}`;
}
