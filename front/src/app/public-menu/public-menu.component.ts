import {
  Component,
  computed,
  inject,
  signal,
  OnInit,
  DestroyRef,
  afterNextRender,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl, SafeStyle, Title } from '@angular/platform-browser';
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

  categories(): PublicTenantMenuCategory[] {
    return this.menu()?.categories ?? [];
  }

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
