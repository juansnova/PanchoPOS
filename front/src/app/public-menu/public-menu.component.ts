import {
  Component,
  computed,
  inject,
  signal,
  OnInit,
  DestroyRef,
  afterNextRender,
  HostListener,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml, SafeResourceUrl, SafeStyle, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { merge } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  ApiService,
  PublicSatisfechoDeliveryConfig,
  PublicTenantMenuCategory,
  PublicTenantMenuProduct,
  PublicTenantMenuResponse,
  TenantSummary,
} from '../services/api.service';
import { PublicGuestHeaderComponent } from '../shared/public-guest-header.component';
import { resolveMenuPrimaryColor } from '../shared/public-brand-colors';
import { getCategoryLabel as resolveCategoryLabel } from '../shared/product-category-label.util';
import { publicMenuTenantRef } from '../shared/public-menu-path';
import { publicBookRouterLink } from '../shared/public-book-path';
import { LanguageService } from '../services/language.service';
import { LegalLinksComponent } from '../shared/legal-links.component';
import { contactPhoneValid } from '../shared/contact-validators';
import { productStockLeft } from '../shared/product-stock.util';
import { formatMoneyCents } from '../shared/currency-symbol';

interface CartLine {
  product: PublicTenantMenuProduct;
  quantity: number;
}

/** 'browse' is the menu grid (read-only until something is added to the cart). */
type OrderStep = 'browse' | 'cart' | 'address' | 'success';

@Component({
  selector: 'app-public-menu',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, PublicGuestHeaderComponent, LegalLinksComponent],
  templateUrl: './public-menu.component.html',
  styleUrls: ['../book/book.component.scss', './public-menu.component.scss'],
})
export class PublicMenuComponent implements OnInit {
  readonly resolvePublicPrimaryColor = resolveMenuPrimaryColor;
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ApiService);
  private translate = inject(TranslateService);
  private language = inject(LanguageService);
  private sanitizer = inject(DomSanitizer);
  private title = inject(Title);
  private destroyRef = inject(DestroyRef);

  tenantId = signal(0);
  tenant = signal<TenantSummary | null>(null);
  menu = signal<PublicTenantMenuResponse | null>(null);
  logoUrl = signal<string | null>(null);
  loading = signal(true);
  menuLoading = signal(false);
  errorKind = signal<'invalid_tenant' | 'tenant_not_found' | 'menu_load_failed' | null>(null);
  /** Sticky category filter: null shows every category. */
  selectedCategoryId = signal<string | null>(null);

  googleMapsUrl = computed(() => this.tenant()?.public_google_maps_url?.trim() || null);
  openstreetmapUrl = computed(() => this.tenant()?.public_openstreetmap_url?.trim() || null);
  facebookUrl = computed(() => this.tenant()?.public_facebook_url?.trim() || null);
  instagramUrl = computed(() => this.tenant()?.public_instagram_url?.trim() || null);

  // ---- Ordering (Satisfecho Delivery), merged in so the menu and checkout are one page ----
  step = signal<OrderStep>('browse');
  cart = signal<CartLine[]>([]);

  customerName = '';
  customerPhone = '';
  deliveryAddress = '';
  deliveryNotes = '';
  postalCode = '';
  formError = signal<string | null>(null);
  submitting = signal(false);

  deliveryConfig = signal<PublicSatisfechoDeliveryConfig | null>(null);
  deliveryLat = signal<number | null>(null);
  deliveryLng = signal<number | null>(null);

  orderId = signal<number | null>(null);
  publicOrderToken = signal<string | null>(null);
  totalCents = signal(0);
  subtotalCents = signal(0);
  deliveryFeeCents = signal(0);

  cartCount = computed(() => this.cart().reduce((n, l) => n + l.quantity, 0));
  cartTotalCents = computed(() => {
    const items = this.cart().reduce((sum, l) => sum + l.product.price_cents * l.quantity, 0);
    const fee = this.deliveryConfig()?.delivery_fee_cents ?? 0;
    return items + (fee > 0 ? fee : 0);
  });
  cartSubtotalCents = computed(() =>
    this.cart().reduce((sum, l) => sum + l.product.price_cents * l.quantity, 0),
  );

  /** Fixed bottom total + next-step CTA while browsing; other steps have their own inline actions. */
  showFloatingCheckoutBar = computed(() => this.step() === 'browse' && this.cartCount() > 0);

  onFloatingCta(): void {
    this.goToCart();
  }

  constructor() {
    afterNextRender(() => this.updateDocumentTitle());
  }

  ngOnInit(): void {
    const langParam = this.route.snapshot.queryParamMap.get('lang');
    if (langParam?.trim()) {
      this.language.setLanguage(langParam.trim());
    }

    merge(
      this.translate.onLangChange,
      this.translate.onTranslationChange,
      this.translate.onDefaultLangChange,
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.updateDocumentTitle();
        if (this.tenant() && !this.errorKind()) {
          this.reloadMenu();
        }
      });

    const refParam = (this.route.snapshot.paramMap.get('tenantId') || '').trim();
    if (!refParam) {
      this.errorKind.set('invalid_tenant');
      this.loading.set(false);
      this.updateDocumentTitle();
      return;
    }
    const numericId = /^\d+$/.test(refParam) ? parseInt(refParam, 10) : NaN;
    if (Number.isFinite(numericId) && numericId >= 1) {
      this.tenantId.set(numericId);
    }
    this.updateDocumentTitle();

    this.api.getPublicTenant(refParam).subscribe({
      next: (t) => {
        this.tenant.set(t);
        this.tenantId.set(t.id);
        this.logoUrl.set(this.api.getTenantLogoUrl(t.logo_filename ?? undefined, t.id));
        const canonical = String(publicMenuTenantRef(t));
        if (canonical && canonical !== refParam) {
          void this.router.navigate(['/public-menu', canonical], {
            replaceUrl: true,
            queryParamsHandling: 'preserve',
          });
        }
        this.loadMenu(t.id);
        this.loadDeliveryConfig(t.id);
      },
      error: () => {
        this.errorKind.set('tenant_not_found');
        this.loading.set(false);
        this.updateDocumentTitle();
      },
    });
  }

  private loadMenu(tenantId: number): void {
    this.menuLoading.set(true);
    this.api.getPublicTenantMenu(tenantId).subscribe({
      next: (data) => {
        this.menu.set(data);
        this.menuLoading.set(false);
        this.loading.set(false);
        this.updateDocumentTitle();
      },
      error: () => {
        this.errorKind.set('menu_load_failed');
        this.menuLoading.set(false);
        this.loading.set(false);
        this.updateDocumentTitle();
      },
    });
  }

  private reloadMenu(): void {
    const tid = this.tenantId();
    if (!tid) return;
    this.menuLoading.set(true);
    this.api.getPublicTenantMenu(tid).subscribe({
      next: (data) => {
        this.menu.set(data);
        this.menuLoading.set(false);
      },
      error: () => {
        this.menuLoading.set(false);
      },
    });
  }

  private loadDeliveryConfig(tid: number): void {
    this.api.getPublicSatisfechoDeliveryConfig(tid).subscribe({
      next: (cfg) => {
        this.deliveryConfig.set(cfg);
        if (cfg.delivery_radius_meters) {
          this.requestDeliveryLocation();
        }
      },
      error: () => {
        this.deliveryConfig.set(null);
      },
    });
  }

  requestDeliveryLocation(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.deliveryLat.set(pos.coords.latitude);
        this.deliveryLng.set(pos.coords.longitude);
      },
      () => {
        /* optional; server rejects if radius configured and coords missing */
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
    );
  }

  /** Menu order: starters, mains, fast food, chicken, desserts, sides, anything else; beverages last. */
  private categoryRank(name: string): number {
    const text = `${name} ${this.getCategoryLabel(name)}`.toLowerCase();
    if (/starter|entrada/.test(text)) return 0;
    if (/main course|plato principal|plato fuerte|almuerzo|carne|pescado|especial/.test(text)) return 1;
    if (/fast|r[aá]pid|hamburgues|perro|picada|papas|infantil/.test(text)) return 2;
    if (/pollo|chicken/.test(text)) return 3;
    if (/dessert|postre/.test(text)) return 4;
    if (/side|acompa/.test(text)) return 5;
    if (/beverage|bebida|drink|agua|cerveza|gaseosa|jugo|granizada|licor|vino|caf[eé]/.test(text)) return 99;
    return 10;
  }

  /**
   * The API groups by subcategory; this page filters by the main category (like the table menu),
   * keeping the subcategory on each product and sorting inside the group by it.
   */
  private sortedCategories = computed<PublicTenantMenuCategory[]>(() => {
    const products = (this.menu()?.categories ?? []).flatMap((c) => c.products);
    const groups = new Map<string, PublicTenantMenuProduct[]>();
    for (const p of products) {
      const key = (p.category || '').trim() || 'Other';
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    return [...groups.entries()]
      .map(([name, items]) => ({
        id: name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'other',
        name,
        products: [...items].sort(
          (a, b) => (a.subcategory || '').localeCompare(b.subcategory || '') || a.name.localeCompare(b.name),
        ),
      }))
      .sort((a, b) => this.categoryRank(a.name) - this.categoryRank(b.name) || a.name.localeCompare(b.name));
  });

  // ---------------------------------------------------------------- featured carousel (arrows + progress)
  featPos = signal({ w: 100, l: 0, atStart: true, atEnd: true, overflow: false });
  private featEl: HTMLElement | null = null;

  @ViewChild('fs') set featScroller(ref: ElementRef<HTMLElement> | undefined) {
    this.featEl = ref?.nativeElement ?? null;
    if (this.featEl) queueMicrotask(() => this.onFeatScroll(this.featEl!));
  }

  onFeatScroll(el: HTMLElement): void {
    const sw = el.scrollWidth || 1;
    const cw = el.clientWidth;
    this.featPos.set({
      w: Math.min(100, (cw / sw) * 100),
      l: (el.scrollLeft / sw) * 100,
      atStart: el.scrollLeft <= 2,
      atEnd: el.scrollLeft + cw >= sw - 2,
      overflow: sw > cw + 4,
    });
  }

  scrollFeat(el: HTMLElement, dir: number): void {
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  }

  @HostListener('window:resize')
  onFeatResize(): void {
    if (this.featEl) this.onFeatScroll(this.featEl);
  }

  /** Up to six available dishes with a photo (first categories first). */
  featuredProducts = computed(() =>
    this.sortedCategories()
      .flatMap((c) => c.products)
      .filter((p) => p.available && p.image_url)
      .slice(0, 6),
  );

  categories(): PublicTenantMenuCategory[] {
    return this.sortedCategories();
  }

  // ---------------------------------------------------------------- restaurant info (social, hours, maps)
  private hostIs(url: string | null | undefined, hosts: string[]): boolean {
    try {
      const h = new URL(url || '').hostname.replace(/^www\./, '').toLowerCase();
      return hosts.some((x) => h === x || h.endsWith('.' + x));
    } catch {
      return false;
    }
  }

  /** Social / web links that really point where they claim to. */
  socials = computed(() => {
    const t = this.tenant();
    const out: { key: string; url: string; label: string; icon: SafeHtml }[] = [];
    if (!t) return out;
    const html = (v: string) => this.sanitizer.bypassSecurityTrustHtml(v);
    if (this.hostIs(t.public_instagram_url, ['instagram.com']))
      out.push({ key: 'instagram', url: t.public_instagram_url!, label: 'Instagram', icon: html('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="0.8" fill="currentColor"/>') });
    if (this.hostIs(t.public_facebook_url, ['facebook.com', 'fb.com', 'fb.me']))
      out.push({ key: 'facebook', url: t.public_facebook_url!, label: 'Facebook', icon: html('<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>') });
    if (t.website && /^https?:\/\//i.test(t.website))
      out.push({ key: 'web', url: t.website, label: 'Web', icon: html('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>') });
    if (t.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t.email))
      out.push({ key: 'email', url: 'mailto:' + t.email, label: 'Email', icon: html('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/>') });
    return out;
  });

  mapsUrl = computed(() => this.googleMapsUrl() || this.openstreetmapUrl() || null);

  private static readonly DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  private fmtTime(hhmm: string): string {
    const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
    if (!m) return hhmm || '';
    return new Date(2000, 0, 1, +m[1], +m[2]).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  private dayRanges(d: Record<string, unknown> | undefined): { from: string; to: string }[] {
    if (!d || d['closed']) return [];
    if (d['hasBreak']) {
      const r: { from: string; to: string }[] = [];
      if (d['morningOpen'] && d['morningClose']) r.push({ from: String(d['morningOpen']), to: String(d['morningClose']) });
      if (d['eveningOpen'] && d['eveningClose']) r.push({ from: String(d['eveningOpen']), to: String(d['eveningClose']) });
      return r;
    }
    return d['open'] && d['close'] ? [{ from: String(d['open']), to: String(d['close']) }] : [];
  }

  private parsedHours(): Record<string, Record<string, unknown>> | null {
    const raw = this.tenant()?.opening_hours;
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : null;
    } catch {
      return null;
    }
  }

  private nowInTenant(): { dayKey: string; minutes: number } {
    const tz = this.tenant()?.timezone?.trim();
    let d = new Date();
    if (tz) {
      try {
        d = new Date(d.toLocaleString('en-US', { timeZone: tz }));
      } catch { /* keep local time */ }
    }
    return { dayKey: PublicMenuComponent.DAY_KEYS[d.getDay()], minutes: d.getHours() * 60 + d.getMinutes() };
  }

  weekHours = computed(() => {
    const hours = this.parsedHours();
    if (!hours) return [];
    const today = this.nowInTenant().dayKey;
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((k) => {
      const ranges = this.dayRanges(hours[k]);
      return {
        key: k,
        labelKey: 'SETTINGS.DAY_' + k.toUpperCase(),
        today: k === today,
        closed: ranges.length === 0,
        text: ranges.map((r) => `${this.fmtTime(r.from)} – ${this.fmtTime(r.to)}`).join('  ·  '),
      };
    });
  });

  todayHours = computed(() => {
    const d = this.weekHours().find((x) => x.today);
    return d ? (d.closed ? null : d.text) : null;
  });

  openStatus = computed<{ open: boolean; time: string } | null>(() => {
    const hours = this.parsedHours();
    if (!hours) return null;
    const { dayKey, minutes } = this.nowInTenant();
    const toMin = (t: string) => {
      const m = /^(\d{1,2}):(\d{2})/.exec(t);
      return m ? +m[1] * 60 + +m[2] : 0;
    };
    const ranges = this.dayRanges(hours[dayKey]);
    for (const r of ranges) {
      if (minutes >= toMin(r.from) && minutes < toMin(r.to)) return { open: true, time: this.fmtTime(r.to) };
    }
    const next = ranges.find((r) => toMin(r.from) > minutes);
    return { open: false, time: next ? this.fmtTime(next.from) : '' };
  });

  /** Total dishes across categories (shown in the "all" filter chip). */
  totalProducts(): number {
    return this.categories().reduce((n, c) => n + c.products.length, 0);
  }

  /** Categories to render: all of them, or just the one picked from the sticky chip nav. */
  visibleCategories(): PublicTenantMenuCategory[] {
    const sel = this.selectedCategoryId();
    const all = this.categories();
    return sel ? all.filter((c) => c.id === sel) : all;
  }

  selectCategory(categoryId: string | null): void {
    this.selectedCategoryId.set(categoryId);
  }

  /** Translation for known API category names; falls back to raw value (tenant-custom categories). */
  getCategoryLabel(category: string): string {
    if (!category || category === 'other' || category === 'Other') {
      return this.translate.instant('PUBLIC_MENU.CATEGORY_OTHER');
    }
    return resolveCategoryLabel(category, this.translate);
  }

  displayName(): string {
    return this.menu()?.tenant_name?.trim() || this.tenant()?.name?.trim() || '';
  }

  getLogoSafeUrl(url: string | null): SafeResourceUrl | string {
    if (!url) return '';
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  headerBackgroundStyle(): SafeStyle | null {
    const filename = this.tenant()?.header_background_filename;
    const tid = this.tenant()?.id;
    if (!filename || tid == null) return null;
    const url = this.api.getTenantHeaderBackgroundUrl(filename, tid);
    return this.sanitizer.bypassSecurityTrustStyle(`url('${url}')`);
  }

  /** Plain URL (not CSS) for rendering the custom banner as an <img>, so it keeps its own aspect ratio. */
  headerBackgroundImgUrl(): string | null {
    const filename = this.tenant()?.header_background_filename;
    const tid = this.tenant()?.id;
    if (!filename || tid == null) return null;
    return this.api.getTenantHeaderBackgroundUrl(filename, tid) || null;
  }

  productImageUrl(url: string | null | undefined): string {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    const base = environment.apiUrl.replace(/\/$/, '');
    return url.startsWith('/') ? base + url : `${base}/${url}`;
  }

  formatPrice(product: { price_cents: number }): string {
    return formatMoneyCents(product.price_cents);
  }

  formatCents(cents: number): string {
    return formatMoneyCents(cents);
  }

  stockLeft(product: PublicTenantMenuProduct): number | null {
    return productStockLeft(product);
  }

  /** Build WhatsApp wa.me link from phone string (e.g. +34 612 345 678 -> https://wa.me/34612345678). */
  getWhatsAppUrl(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    return `https://wa.me/${digits}`;
  }

  /** Canonical guest booking link (#415). */
  bookRouterLink(): (string | number)[] {
    const t = this.tenant();
    if (t) return publicBookRouterLink(t);
    return ['/book', this.tenantId()];
  }

  // ---- Cart ----

  addToCart(product: PublicTenantMenuProduct): void {
    if (!product.available) return;
    this.cart.update((lines) => {
      const idx = lines.findIndex((l) => l.product.id === product.id);
      if (idx >= 0) {
        const next = [...lines];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...lines, { product, quantity: 1 }];
    });
  }

  setQty(productId: number, quantity: number): void {
    this.cart.update((lines) => {
      if (quantity <= 0) return lines.filter((l) => l.product.id !== productId);
      return lines.map((l) => (l.product.id === productId ? { ...l, quantity } : l));
    });
  }

  /** Current cart quantity for a product card's stepper (0 = not in cart yet). */
  cartQtyFor(productId: number): number {
    return this.cart().find((l) => l.product.id === productId)?.quantity ?? 0;
  }

  goToCart(): void {
    if (this.cartCount() < 1) return;
    this.step.set('cart');
  }

  goToAddress(): void {
    if (this.cartCount() < 1) return;
    this.formError.set(null);
    this.step.set('address');
  }

  goToMenu(): void {
    this.step.set('browse');
  }

  orderAgain(): void {
    this.orderId.set(null);
    this.publicOrderToken.set(null);
    this.totalCents.set(0);
    this.formError.set(null);
    this.customerName = '';
    this.customerPhone = '';
    this.deliveryAddress = '';
    this.deliveryNotes = '';
    this.cart.set([]);
    this.step.set('browse');
  }

  submitAddress(): void {
    this.formError.set(null);
    const address = this.deliveryAddress.trim();
    const phone = this.customerPhone.trim();
    const cfg = this.deliveryConfig();
    if (!address) {
      this.formError.set(this.translate.instant('DELIVERY_CHECKOUT.ADDRESS_REQUIRED'));
      return;
    }
    if (!phone || !contactPhoneValid(phone)) {
      this.formError.set(this.translate.instant('DELIVERY_CHECKOUT.PHONE_INVALID'));
      return;
    }
    if (cfg?.postal_codes_required && !this.postalCode.trim()) {
      this.formError.set(this.translate.instant('DELIVERY_CHECKOUT.POSTAL_REQUIRED'));
      return;
    }
    if (cfg?.delivery_radius_meters && (this.deliveryLat() == null || this.deliveryLng() == null)) {
      this.formError.set(this.translate.instant('DELIVERY_CHECKOUT.LOCATION_REQUIRED'));
      this.requestDeliveryLocation();
      return;
    }
    if (this.cartCount() < 1) {
      this.formError.set(this.translate.instant('DELIVERY_CHECKOUT.CART_EMPTY'));
      return;
    }

    this.submitting.set(true);
    this.api
      .createPublicSatisfechoDeliveryOrder(this.tenantId(), {
        items: this.cart().map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
        })),
        delivery_address: address,
        customer_phone: phone,
        customer_name: this.customerName.trim() || null,
        notes: this.deliveryNotes.trim() || null,
        postal_code: this.postalCode.trim() || null,
        delivery_latitude: this.deliveryLat(),
        delivery_longitude: this.deliveryLng(),
      })
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          this.orderId.set(res.id);
          this.publicOrderToken.set(res.public_order_token);
          this.totalCents.set(res.total_cents);
          this.subtotalCents.set(res.subtotal_cents ?? res.total_cents);
          this.deliveryFeeCents.set(res.delivery_fee_cents ?? 0);
          // Payment is cash/transfer at delivery: go straight to order tracking.
          this.cart.set([]);
          this.goToTrack();
        },
        error: (err) => {
          this.submitting.set(false);
          const detail = err.error?.detail;
          let msg = this.translate.instant('DELIVERY_CHECKOUT.CREATE_FAILED');
          if (typeof detail === 'string') {
            if (detail.includes('outside the delivery zone')) {
              msg = this.translate.instant('DELIVERY_CHECKOUT.OUTSIDE_ZONE');
            } else if (detail.includes('outside the delivery radius')) {
              msg = this.translate.instant('DELIVERY_CHECKOUT.OUTSIDE_RADIUS');
            } else if (detail.includes('postal_code')) {
              msg = this.translate.instant('DELIVERY_CHECKOUT.POSTAL_REQUIRED');
            } else if (detail.includes('location')) {
              msg = this.translate.instant('DELIVERY_CHECKOUT.LOCATION_REQUIRED');
            } else {
              msg = detail;
            }
          }
          this.formError.set(msg);
        },
      });
  }

  goToTrack(): void {
    const oid = this.orderId();
    const token = this.publicOrderToken();
    if (!oid || !token) return;
    void this.router.navigate(['/delivery', this.tenantId(), 'track'], {
      queryParams: { order_id: oid, public_order_token: token },
    });
  }

  private updateDocumentTitle(): void {
    const name = this.displayName();
    const err = this.errorKind();
    let key: string;
    if (this.loading() && !err) {
      key = 'PUBLIC_MENU.LOADING';
    } else if (err === 'invalid_tenant') {
      key = 'PUBLIC_MENU.INVALID_TENANT';
    } else if (err === 'tenant_not_found') {
      key = 'PUBLIC_MENU.TENANT_NOT_FOUND';
    } else if (err === 'menu_load_failed') {
      key = 'PUBLIC_MENU.LOAD_FAILED';
    } else if (name) {
      this.title.setTitle(`${name} — ${this.translate.instant('PUBLIC_MENU.PAGE_TITLE')}`);
      return;
    } else {
      key = 'PUBLIC_MENU.PAGE_TITLE';
    }
    this.title.setTitle(this.translate.instant(key));
  }
}
