import { Component, inject, signal, computed, OnInit, OnDestroy, HostListener } from '@angular/core';
import { DomSanitizer, SafeHtml, SafeResourceUrl, SafeStyle } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { CommonModule, SlicePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ApiService, BankAccount, Product, OrderItemCreate, TableCartResponse, TenantSummary } from '../services/api.service';
import { AudioService } from '../services/audio.service';
import { environment } from '../../environments/environment';
import { FocusFirstInputDirective } from '../shared/focus-first-input.directive';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { getSubcategoryLabel as resolveSubcategoryLabel } from '../shared/product-subcategory-label.util';
import { getCategoryLabel as resolveCategoryLabel } from '../shared/product-category-label.util';
import { productStockLeft } from '../shared/product-stock.util';
import { resolveMenuPrimaryColor } from '../shared/public-brand-colors';
import { formatMoneyCents } from '../shared/currency-symbol';

interface CartItem {
  product: Product;
  quantity: number;
  notes: string;
  status?: string;  // Item status from backend
  itemId?: number;  // Backend item ID for editing
  /** Shared draft cart line id (server) */
  lineId?: string;
  sessionId?: string;
  customerName?: string | null;
}

interface PlacedOrder {
  id: number;
  items: CartItem[];
  notes: string;
  total: number;
  status: string;
  extraCents?: number;
  extraNote?: string;
}

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [CommonModule, FormsModule, FocusFirstInputDirective, TranslateModule, SlicePipe],
  templateUrl: './menu.component.html',
  styleUrl: './menu.component.scss'
})
export class MenuComponent implements OnInit, OnDestroy {
  readonly resolvePublicPrimaryColor = resolveMenuPrimaryColor;
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private audio = inject(AudioService);
  private sanitizer = inject(DomSanitizer);
  private translate = inject(TranslateService);

  // Core state
  loading = signal(true);
  error = signal(false);
  tableClosed = signal(false);
  closedTableName = signal('');
  closedTenantName = signal('');
  closedTenantLogo = signal<string | null>(null);
  closedTenantId = signal<number | null>(null);
  products = signal<Product[]>([]);
  filteredProducts = signal<Product[]>([]);
  selectedCategory = signal<string | null>(null);
  selectedSubcategory = signal<string | null>(null);
  availableCategories = signal<string[]>([]);
  availableSubcategories = signal<string[]>([]);

  // Tenant info
  tenantName = signal('');
  tableName = signal('');
  tenantLogo = signal<string | null>(null);
  tenantDescription = signal<string | null>(null);
  tenantPhone = signal<string | null>(null);
  tenantWhatsapp = signal<string | null>(null);
  tenantAddress = signal<string | null>(null);
  tenantWebsite = signal<string | null>(null);
  immediatePaymentRequired = signal(false);
  locationCheckEnabled = signal(false);
  tenantPublicBackgroundColor = signal<string | null>(null);
  tenantPublicPrimaryColor = signal<string | null>(null);
  // Transfer options (Nequi / QR / Llave) configured in Settings → Payments
  tenantPaymentNequi = signal<string | null>(null);
  tenantPaymentLlave = signal<string | null>(null);
  tenantPaymentHolder = signal<string | null>(null);
  tenantBankAccounts = signal<BankAccount[]>([]);
  tenantPaymentQrUrl = signal<string | null>(null);
  hasTransferOptions = computed(
    () =>
      !!(
        this.tenantPaymentNequi() ||
        this.tenantPaymentLlave() ||
        this.tenantPaymentQrUrl() ||
        this.tenantBankAccounts().length
      ),
  );
  tenantHeaderBackgroundFilename = signal<string | null>(null);

  // Cart & Orders
  cart = signal<CartItem[]>([]);
  /** When true, cart mutations go to the shared table cart API (#349). */
  sharedCartEnabled = signal(false);
  orderNotes = '';
  /** Cart line keys with expanded per-item comment field */
  expandedCommentKeys = signal<Set<string>>(new Set());
  readonly maxNoteLength = 500;
  submitting = signal(false);
  placedOrders = signal<PlacedOrder[]>([]);
  showSuccessToast = signal(false);
  lastOrderId = signal(0);
  ordersExpanded = signal(true);
  menuExpanded = signal(true);
  private notesSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Product details toggles (legacy)
  showIngredientsFor = signal<number | null>(null);
  showDescriptionFor = signal<number | null>(null);

  // New UI state
  isScrolled = signal(false);
  cartExpanded = signal(false);
  /** Product ids in cart — grid/featured cards get a light “in cart” background. */
  productIdsInCart = computed(() => {
    const ids = new Set<number>();
    for (const line of this.cart()) {
      const id = line.product.id;
      if (id != null) ids.add(id);
    }
    return ids;
  });
  /** Brief highlight on the menu card after add (same pattern as cart line flash). */
  justAddedProductIds = signal<Set<number>>(new Set());
  /** Brief highlight for a specific cart line. */
  justAddedCartKeys = signal<Set<string>>(new Set());
  selectedProduct = signal<Product | null>(null);
  /** Quantity chosen in the product detail sheet. */
  detailQty = signal(1);

  // Customer identity
  customerName = signal('');
  showNameModal = signal(false);
  nameInputValue = '';

  // Table session
  requiresOrderCode = signal(false);
  /** Logged-in waiter/owner: may edit items even after they reach the kitchen. */
  isStaff = signal(false);
  orderCode = signal('');
  tableIsActive = signal(true);  // Default true for backward compatibility

  // Payment options
  showPaymentOptions = signal(false);
  paymentOptionsStep = signal<'choose' | 'transfer' | 'message' | 'success'>('choose');
  // True when the "message" step was opened directly (header call-waiter button), not via checkout
  callWaiterDirectEntry = signal(false);
  paymentMessageTarget = signal<'waiter' | null>(null);
  transferMethod = signal<'nequi' | 'qr' | 'llave' | 'bank' | null>(null);
  transferCopied = signal(false);
  paymentMessage = signal('');
  paymentRequestSending = signal(false);
  paymentRequestSuccess = signal(false);
  waiterCallCooldown = signal(false);

  paymentAmount = signal(0);

  // Internal
  private tableToken = '';
  private tenantId = 0;
  private ws: WebSocket | null = null;
  private sessionId = '';

  // Computed
  tableGreeting = computed(() => {
    const name = this.customerName();
    const table = this.tableName();
    if (name) {
      return `Hey, ${name}! · ${table}`;
    }
    return table;
  });

  isPaid = computed(() => {
    const orders = this.placedOrders();
    if (orders.length === 0) return false;
    return orders[0].status === 'paid';
  });

  // Featured products (first 5 with images, for now)
  /**
   * "Todos" shows the menu grouped by category (same order as the chips); a single
   * category shows one group without a header.
   */
  productGroups = computed(() => {
    const list = this.filteredProducts();
    if (this.selectedCategory() !== null) {
      return [{ category: null as string | null, label: '', items: list }];
    }
    const byCat = new Map<string, Product[]>();
    for (const p of list) {
      const key = p.category || '';
      byCat.set(key, [...(byCat.get(key) ?? []), p]);
    }
    const order = [...this.availableCategories(), ...[...byCat.keys()].filter((k) => !this.availableCategories().includes(k))];
    return order
      .filter((k) => byCat.has(k))
      .map((k) => ({ category: k as string | null, label: k ? this.getCategoryLabel(k) : '', items: byCat.get(k)! }));
  });

  // ---------------------------------------------------------------- restaurant info (social, hours, address)
  info = signal<TenantSummary | null>(null);

  private hostIs(url: string | null | undefined, hosts: string[]): boolean {
    try {
      const h = new URL(url || '').hostname.replace(/^www\./, '').toLowerCase();
      return hosts.some((x) => h === x || h.endsWith('.' + x));
    } catch {
      return false;
    }
  }

  /** Social / web links that really point where they claim to (a Maps link in the Instagram field is skipped). */
  socials = computed(() => {
    const t = this.info();
    const out: { key: string; url: string; label: string; icon: SafeHtml }[] = [];
    if (!t) return out;
    if (this.hostIs(t.public_instagram_url, ['instagram.com']))
      out.push({ key: 'instagram', url: t.public_instagram_url!, label: 'Instagram', icon: this.sanitizer.bypassSecurityTrustHtml('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="0.8" fill="currentColor"/>') });
    if (this.hostIs(t.public_facebook_url, ['facebook.com', 'fb.com', 'fb.me']))
      out.push({ key: 'facebook', url: t.public_facebook_url!, label: 'Facebook', icon: this.sanitizer.bypassSecurityTrustHtml('<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>') });
    if (t.website && /^https?:\/\//i.test(t.website))
      out.push({ key: 'web', url: t.website, label: 'Web', icon: this.sanitizer.bypassSecurityTrustHtml('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>') });
    if (t.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t.email))
      out.push({ key: 'email', url: 'mailto:' + t.email, label: 'Email', icon: this.sanitizer.bypassSecurityTrustHtml('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/>') });
    return out;
  });

  mapsUrl = computed(() => {
    const t = this.info();
    return t?.public_google_maps_url?.trim() || t?.public_openstreetmap_url?.trim() || null;
  });

  private static readonly DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  private fmtTime(hhmm: string): string {
    const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
    if (!m) return hhmm || '';
    return new Date(2000, 0, 1, +m[1], +m[2]).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  /** Opening ranges of a day as "open–close" strings ([] = closed). */
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
    const raw = this.info()?.opening_hours;
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : null;
    } catch {
      return null;
    }
  }

  private nowInTenant(): { dayKey: string; minutes: number } {
    const tz = this.info()?.timezone?.trim();
    let d = new Date();
    if (tz) {
      try {
        d = new Date(d.toLocaleString('en-US', { timeZone: tz }));
      } catch { /* keep local time */ }
    }
    return { dayKey: MenuComponent.DAY_KEYS[d.getDay()], minutes: d.getHours() * 60 + d.getMinutes() };
  }

  /** Week table for the "about" section; the current day is flagged. */
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

  /** Today's opening text for the hero (e.g. "9:00 – 22:00"), or null when unknown. */
  todayHours = computed(() => {
    const d = this.weekHours().find((x) => x.today);
    return d ? (d.closed ? null : d.text) : null;
  });

  /** Open / closed right now, with the next change. */
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

  featuredProducts = computed(() => {
    return this.products()
      .filter(p => p.image_filename)
      .slice(0, 6);
  });

  // Listen for scroll to update sticky nav state
  @HostListener('window:scroll')
  onScroll() {
    this.isScrolled.set(window.scrollY > 200);
  }

  ngOnInit() {
    this.tableToken = this.route.snapshot.params['token'];
    this.initializeSession();
    this.loadMenu();
    this.loadStoredOrders();
  }

  ngOnDestroy() {
    this.ws?.close();
    for (const t of this.notesSyncTimers.values()) {
      clearTimeout(t);
    }
    this.notesSyncTimers.clear();
  }

  // ============================================
  // SESSION & CUSTOMER NAME
  // ============================================
  private initializeSession() {
    const sessionKey = `session_${this.tableToken}`;
    let sessionId = localStorage.getItem(sessionKey);

    if (!sessionId) {
      sessionId = this.generateUUID();
      localStorage.setItem(sessionKey, sessionId);
    }
    this.sessionId = sessionId;

    const nameKey = `customer_name_${this.tableToken}`;
    const customerName = localStorage.getItem(nameKey);

    if (!customerName) {
      this.showNameModal.set(true);
    } else {
      this.customerName.set(customerName);
    }
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  skipName() {
    this.showNameModal.set(false);
    this.nameInputValue = '';
  }

  confirmName() {
    const name = this.nameInputValue.trim();
    if (name) {
      this.customerName.set(name);
      localStorage.setItem(`customer_name_${this.tableToken}`, name);
    }
    this.showNameModal.set(false);
    this.nameInputValue = '';
  }

  // ============================================
  // MENU LOADING
  // ============================================
  loadMenu() {
    this.api.getMenu(this.tableToken).subscribe({
      next: data => {
        const productsWithSource = data.products.map((product: Product) => ({
          ...product,
          _source: product._source || 'unknown'
        }));
        this.products.set(productsWithSource);
        this.tenantName.set(data.tenant_name);
        this.tableName.set(data.table_name);
        this.tenantId = data.tenant_id;
        if (data.tenant_id) {
          this.api.getPublicTenant(data.tenant_id).subscribe({
            next: (t) => this.info.set(t),
            error: () => this.info.set(null),
          });
        }

        this.connectWebSocket();

        const categories = new Set<string>();
        productsWithSource.forEach((product: Product) => {
          if (product.category) {
            categories.add(product.category);
          }
        });
        this.availableCategories.set(Array.from(categories).sort((a, b) => this.categoryRank(a) - this.categoryRank(b) || a.localeCompare(b)));

        this.updateSubcategories(null);
        this.applyFilter(null, null);

        if (data.tenant_logo && data.tenant_id) {
          this.tenantLogo.set(`${environment.apiUrl}/uploads/${data.tenant_id}/logo/${data.tenant_logo}`);
        }

        this.tenantDescription.set(data.tenant_description || null);
        this.tenantPhone.set(data.tenant_phone || null);
        this.tenantWhatsapp.set(data.tenant_whatsapp || null);
        this.tenantAddress.set(data.tenant_address || null);
        this.tenantWebsite.set(data.tenant_website || null);
        this.immediatePaymentRequired.set(data.tenant_immediate_payment_required || false);
        this.locationCheckEnabled.set(data.tenant_location_check_enabled || false);
        this.tenantPublicBackgroundColor.set(data.tenant_public_background_color ?? null);
        this.tenantPublicPrimaryColor.set(data.tenant_public_primary_color ?? null);
        this.tenantHeaderBackgroundFilename.set(data.tenant_header_background_filename ?? null);

        this.tenantPaymentNequi.set(data.tenant_payment_nequi_number || null);
        this.tenantPaymentLlave.set(data.tenant_payment_llave || null);
        this.tenantPaymentHolder.set(data.tenant_payment_account_holder || null);
        this.tenantBankAccounts.set(data.tenant_payment_bank_accounts || []);
        this.tenantPaymentQrUrl.set(
          data.tenant_payment_qr_filename && data.tenant_id
            ? `${environment.apiUrl}/uploads/${data.tenant_id}/payment_qr/${data.tenant_payment_qr_filename}`
            : null,
        )

        // Table session status
        this.tableIsActive.set(data.table_is_active !== false);  // Default true for backward compatibility
        this.requiresOrderCode.set(data.requires_order_code === true);
        this.isStaff.set(data.is_staff === true);
        if (!this.orderCode()) {
          try {
            this.orderCode.set(sessionStorage.getItem(`order_code_${this.tableToken}`) ?? '');
          } catch {
            // storage unavailable: guest types the code again
          }
        }
        this.sharedCartEnabled.set(data.table_shared_cart === true);

        // Check if the table session has changed (table was closed and reopened).
        // If active_order_id differs from what we stored, clear stale data and
        // start a fresh customer session so new customers don't inherit old data.
        const storedOrderId = localStorage.getItem(`active_order_${this.tableToken}`);
        const currentOrderId = data.active_order_id ? String(data.active_order_id) : null;

        if (currentOrderId && storedOrderId !== currentOrderId) {
          // Table session changed -- clear all stale data
          localStorage.removeItem(`session_${this.tableToken}`);
          localStorage.removeItem(`customer_name_${this.tableToken}`);
          localStorage.removeItem(`orders_${this.tableToken}`);
          this.placedOrders.set([]);
          this.customerName.set('');
          this.cart.set([]);

          // Re-initialize session with fresh IDs
          const newSessionId = this.generateUUID();
          localStorage.setItem(`session_${this.tableToken}`, newSessionId);
          this.sessionId = newSessionId;
          this.showNameModal.set(true);

          // Store new active_order_id
          localStorage.setItem(`active_order_${this.tableToken}`, currentOrderId);
        } else if (currentOrderId) {
          localStorage.setItem(`active_order_${this.tableToken}`, currentOrderId);
        }

        if (this.sharedCartEnabled()) {
          this.loadSharedCart();
        }

        this.loading.set(false);
      },
      error: (err) => {
        if (err.status === 403 && err.error?.detail?.code === 'TABLE_CLOSED') {
          const detail = err.error.detail;
          this.tableClosed.set(true);
          this.closedTableName.set(detail.table_name || '');
          this.closedTenantName.set(detail.tenant_name || '');
          this.closedTenantId.set(detail.tenant_id || null);
          // Listen for staff reopening this table (table_activated)
          this.connectWebSocket();
          this.tenantPublicBackgroundColor.set(detail.tenant_public_background_color ?? null);
          this.tenantPublicPrimaryColor.set(detail.tenant_public_primary_color ?? null);
          this.tenantHeaderBackgroundFilename.set(detail.tenant_header_background_filename ?? null);
          if (detail.tenant_logo && detail.tenant_id) {
            this.closedTenantLogo.set(
              `${environment.apiUrl}/uploads/${detail.tenant_id}/logo/${detail.tenant_logo}`
            );
          }
        } else {
          this.error.set(true);
        }
        this.loading.set(false);
      }
    });
  }

  // ============================================
  // WEBSOCKET
  // ============================================
  connectWebSocket() {
    if (this.ws || !this.tableToken) return;
    
    let wsUrl = environment.wsUrl;
    // Handle relative URLs (e.g. '/ws')
    if (wsUrl.startsWith('/')) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}${wsUrl}`;
    }
    // Handle absolute HTTP URLs
    else if (wsUrl.startsWith('http')) {
      wsUrl = wsUrl.replace(/^http/, 'ws').replace(/^https/, 'wss');
    }

    // environment.wsUrl already includes /ws, so we just append the path
    // If environment.wsUrl is absolute (e.g. ws://host:port/ws), it works
    // If it was relative, we fixed it above
    this.ws = new WebSocket(`${wsUrl}/table/${this.tableToken}`);
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'table_closed') {
          // Staff has closed this table -- show the closed screen; the code dies with the session
          this.tableIsActive.set(false);
          this.orderCode.set('');
          try {
            sessionStorage.removeItem(`order_code_${this.tableToken}`);
          } catch {
            // ignore
          }
          this.tableClosed.set(true);
          this.closedTenantName.set(this.tenantName());
          this.closedTenantLogo.set(this.tenantLogo());
          this.closedTableName.set(this.tableName());
          // Forget this guest session so the next guests start clean (shared devices too)
          this.clearGuestSession();
          this.ws?.close();
          return;
        } else if (data.type === 'status_update') {
          this.audio.playCustomerStatusChange();
          this.placedOrders.update(orders => orders.map(o => o.id === data.order_id ? { ...o, status: data.status } : o));
          this.saveOrders();
          this.loadStoredOrders();
        } else if (data.type === 'item_status_update') {
          this.audio.playCustomerStatusChange();
          if (data.status) {
            this.placedOrders.update(orders =>
              orders.map(o => o.id === data.order_id ? { ...o, status: data.status } : o)
            );
          }
          this.loadStoredOrders();
        } else if (data.type === 'table_activated') {
          // Staff opened the table again: start a fresh guest session
          if (this.tableClosed()) {
            window.location.reload();
          }
        } else if (data.type === 'order_paid') {
          this.loadStoredOrders();
        } else if (data.type === 'item_removed' || data.type === 'item_updated' || data.type === 'order_cancelled' || data.type === 'items_added' || data.type === 'new_order') {
          this.audio.playCustomerOrderChange();
          this.loadStoredOrders();
        } else if (data.type === 'cart_updated') {
          if (this.sharedCartEnabled()) {
            this.loadSharedCart();
          }
        }
      } catch { }
    };
    this.ws.onclose = () => {
      this.ws = null;
      setTimeout(() => this.connectWebSocket(), 5000);
    };
  }

  saveOrders() {
    localStorage.setItem(`orders_${this.tableToken}`, JSON.stringify(this.placedOrders()));
  }

  /** Drop the current guest's order, cart and name for this table. */
  private clearGuestSession() {
    for (const key of ['session', 'customer_name', 'orders', 'active_order']) {
      localStorage.removeItem(`${key}_${this.tableToken}`);
    }
    this.placedOrders.set([]);
    this.cart.set([]);
    this.customerName.set('');
  }

  // ============================================
  // CATEGORY FILTERING
  // ============================================
  selectCategory(category: string | null) {
    this.selectedCategory.set(category);
    this.selectedSubcategory.set(null);
    this.updateSubcategories(category);
    this.applyFilter(category, null);
    // Scroll to top of products section
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  selectSubcategory(subcategoryCode: string | null) {
    this.selectedSubcategory.set(subcategoryCode);
    this.applyFilter(this.selectedCategory(), subcategoryCode);
  }

  updateSubcategories(category: string | null) {
    if (!category) {
      this.availableSubcategories.set([]);
      return;
    }

    const subcategoryCodes = new Set<string>();

    this.products().forEach((product: Product) => {
      if (product.category === category) {
        if (product.subcategory_codes && product.subcategory_codes.length > 0) {
          product.subcategory_codes.forEach(code => subcategoryCodes.add(code));
        } else {
          if (product.subcategory) {
            const wineTypeCode = this.getWineTypeCodeFromString(product.wine_type || product.subcategory);
            if (wineTypeCode) {
              subcategoryCodes.add(wineTypeCode);
            }
            if (product.subcategory.includes('Wine by Glass')) {
              subcategoryCodes.add('WINE_BY_GLASS');
            }
            const otherCodes = this.extractOtherSubcategoryCodes(product.subcategory);
            otherCodes.forEach(code => subcategoryCodes.add(code));
          }
        }
      }
    });

    const orderedCodes = [
      'WINE_RED', 'WINE_WHITE', 'WINE_SPARKLING', 'WINE_ROSE', 'WINE_SWEET', 'WINE_FORTIFIED',
      'HOT_DRINKS', 'COLD_DRINKS', 'ALCOHOLIC', 'NON_ALCOHOLIC', 'BEER', 'COCKTAILS', 'SOFT_DRINKS',
      'APPETIZERS', 'SALADS', 'SOUPS', 'BREAD_DIPS',
      'MEAT', 'FISH', 'POULTRY', 'VEGETARIAN', 'VEGAN', 'PASTA', 'RICE', 'PIZZA',
      'CAKES', 'ICE_CREAM', 'FRUIT', 'CHEESE',
      'VEGETABLES', 'POTATOES', 'BREAD',
      'WINE_BY_GLASS'
    ];

    const subcategories: string[] = [];
    orderedCodes.forEach(code => {
      if (subcategoryCodes.has(code)) {
        subcategories.push(code);
      }
    });

    this.availableSubcategories.set(subcategories);
  }

  extractOtherSubcategoryCodes(subcategory: string): string[] {
    const codes: string[] = [];
    const subcatLower = subcategory.toLowerCase();

    if (subcategory === 'Appetizers' || subcatLower.includes('appetizers')) codes.push('APPETIZERS');
    if (subcategory === 'Salads' || subcatLower.includes('salads')) codes.push('SALADS');
    if (subcategory === 'Soups' || subcatLower.includes('soups')) codes.push('SOUPS');
    if (subcategory === 'Bread & Dips' || (subcatLower.includes('bread') && subcatLower.includes('dips'))) codes.push('BREAD_DIPS');
    if (subcategory === 'Meat') codes.push('MEAT');
    if (subcategory === 'Fish') codes.push('FISH');
    if (subcategory === 'Poultry') codes.push('POULTRY');
    if (subcategory === 'Vegetarian') codes.push('VEGETARIAN');
    if (subcategory === 'Vegan') codes.push('VEGAN');
    if (subcategory === 'Pasta') codes.push('PASTA');
    if (subcategory === 'Rice') codes.push('RICE');
    if (subcategory === 'Pizza') codes.push('PIZZA');
    if (subcategory === 'Cakes') codes.push('CAKES');
    if (subcategory === 'Ice Cream') codes.push('ICE_CREAM');
    if (subcategory === 'Fruit') codes.push('FRUIT');
    if (subcategory === 'Cheese') codes.push('CHEESE');
    if (subcategory === 'Hot Drinks') codes.push('HOT_DRINKS');
    if (subcategory === 'Cold Drinks') codes.push('COLD_DRINKS');
    if (subcategory === 'Alcoholic') codes.push('ALCOHOLIC');
    if (subcategory === 'Non-Alcoholic') codes.push('NON_ALCOHOLIC');
    if (subcategory === 'Beer') codes.push('BEER');
    if (subcategory === 'Cocktails') codes.push('COCKTAILS');
    if (subcategory === 'Soft Drinks') codes.push('SOFT_DRINKS');
    if (subcategory === 'Vegetables') codes.push('VEGETABLES');
    if (subcategory === 'Potatoes') codes.push('POTATOES');
    if (subcategory === 'Bread') codes.push('BREAD');

    return codes;
  }

  getWineTypeCodeFromString(wineType: string | undefined): string | null {
    if (!wineType) return null;
    if (wineType === 'Red Wine') return 'WINE_RED';
    if (wineType === 'White Wine') return 'WINE_WHITE';
    if (wineType === 'Sparkling Wine') return 'WINE_SPARKLING';
    if (wineType === 'Rosé Wine') return 'WINE_ROSE';
    if (wineType === 'Sweet Wine') return 'WINE_SWEET';
    if (wineType === 'Fortified Wine') return 'WINE_FORTIFIED';
    return null;
  }

  /** Number of dishes in a category chip (null = all), for the filter counters. */
  /**
   * Menu order: starters first, then mains, fast food, chicken, desserts, sides, anything else,
   * and beverages always last.
   */
  private categoryRank(category: string): number {
    const text = `${category} ${this.getCategoryLabel(category)}`.toLowerCase();
    if (/starter|entrada/.test(text)) return 0;
    if (/main course|plato principal|plato fuerte/.test(text)) return 1;
    if (/fast|r[aá]pid/.test(text)) return 2;
    if (/pollo|chicken/.test(text)) return 3;
    if (/dessert|postre/.test(text)) return 4;
    if (/side|acompa/.test(text)) return 5;
    if (/beverage|bebida|drink/.test(text)) return 99;
    return 10;
  }

  categoryCount(category: string | null): number {
    const all = this.products();
    return category ? all.filter((p) => p.category === category).length : all.length;
  }

  applyFilter(category: string | null, subcategoryCode: string | null) {
    let filtered = this.products();

    if (category) {
      filtered = filtered.filter(p => p.category === category);
    }

    if (subcategoryCode) {
      if (subcategoryCode === 'WINE_BY_GLASS') {
        filtered = filtered.filter(p =>
          p.subcategory_codes?.includes('WINE_BY_GLASS') ||
          (p.subcategory && p.subcategory.includes('Wine by Glass'))
        );
      } else {
        filtered = filtered.filter(p => {
          if (p.subcategory_codes && p.subcategory_codes.includes(subcategoryCode)) {
            return true;
          }
          const wineTypeCode = this.getWineTypeCodeFromString(p.wine_type);
          return wineTypeCode === subcategoryCode;
        });
      }
    }

    filtered = filtered.map(p => ({
      ...p,
      _source: p._source || 'unknown'
    }));

    this.filteredProducts.set(filtered);
  }

  getSubcategoryLabel(subcategoryCode: string): string {
    return resolveSubcategoryLabel(subcategoryCode, this.translate);
  }

  getCategoryLabel(category: string): string {
    return resolveCategoryLabel(category, this.translate);
  }

  // ============================================
  // PRODUCT HELPERS
  // ============================================
  /** Safe URL for tenant logo (needed for SVG, which Angular may block in img src). */
  getLogoSafeUrl(url: string | null): SafeResourceUrl | null {
    if (!url) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  headerBackgroundStyle(): SafeStyle | null {
    const fn = this.tenantHeaderBackgroundFilename();
    if (!fn || !this.tenantId) return null;
    const url = this.api.getTenantHeaderBackgroundUrl(fn, this.tenantId);
    return url ? this.sanitizer.bypassSecurityTrustStyle('url("' + url + '")') : null;
  }

  /** Plain URL (not CSS) for rendering the custom banner as an <img>, so it keeps its own aspect ratio. */
  headerBackgroundImgUrl(): string | null {
    const fn = this.tenantHeaderBackgroundFilename();
    if (!fn || !this.tenantId) return null;
    return this.api.getTenantHeaderBackgroundUrl(fn, this.tenantId);
  }

  /** Build WhatsApp wa.me link from phone string (e.g. +34 612 345 678 -> https://wa.me/34612345678). */
  getWhatsAppUrl(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    return `https://wa.me/${digits}`;
  }

  getProductImageUrl(product: Product): string | null {
    if (!product.image_filename || !product.tenant_id) return null;
    if (product.image_filename.startsWith('providers/')) {
      return `${environment.apiUrl}/uploads/${product.image_filename}`;
    } else {
      return `${environment.apiUrl}/uploads/${product.tenant_id}/products/${product.image_filename}`;
    }
  }

  getProductKey(product: Product): string {
    if (!product) return 'null-product';
    const source = product._source || 'unknown';
    const id = product.id ?? 'no-id';
    const name = product.name || 'no-name';
    const price = product.price_cents ?? 0;
    return `${source}-${id}-${name}-${price}`;
  }

  getCartLineKey(item: Pick<CartItem, 'product' | 'notes' | 'lineId' | 'sessionId'>): string {
    if (item.lineId) {
      return `line:${item.lineId}`;
    }
    const notePart = (item.notes || '').trim();
    const sess = item.sessionId || this.sessionId || '';
    return `${this.getProductKey(item.product)}|${notePart}|${sess}`;
  }

  isMyCartItem(item: CartItem): boolean {
    if (!item.sessionId) return true;
    return item.sessionId === this.sessionId;
  }

  private applySharedCartResponse(res: TableCartResponse): void {
    if (!res.shared) {
      this.sharedCartEnabled.set(false);
      return;
    }
    this.sharedCartEnabled.set(true);
    const mapped: CartItem[] = (res.items || []).map(line => ({
      lineId: line.line_id,
      sessionId: line.session_id,
      customerName: line.customer_name ?? null,
      product: {
        id: line.product_id,
        name: line.product_name,
        price_cents: line.price_cents,
        _source: (line.source as Product['_source']) || undefined,
      } as Product,
      quantity: line.quantity,
      notes: line.notes || '',
    }));
    this.cart.set(mapped);
    if (mapped.length > 0 && !this.cartExpanded()) {
      // Keep collapsed summary visible; do not force expand on remote updates
    }
  }

  loadSharedCart(): void {
    if (!this.tableToken) return;
    this.api.getTableCart(this.tableToken).subscribe({
      next: res => this.applySharedCartResponse(res),
      error: () => {
        // Fall back to local cart if shared cart API fails
        this.sharedCartEnabled.set(false);
      },
    });
  }

  private syncCartFromResponse(res: TableCartResponse, flashProduct?: Product, flashKey?: string): void {
    this.applySharedCartResponse(res);
    if (flashProduct && flashKey) {
      this.flashProductAdded(flashProduct, flashKey);
    }
    if (this.cart().length === 1) {
      this.cartExpanded.set(true);
    }
  }

  toggleCartItemComment(item: CartItem): void {
    const key = this.getCartLineKey(item);
    this.expandedCommentKeys.update(set => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Expand cart sheet so the guest can review lines and place the order (#360). */
  openCartCheckout(event: Event): void {
    event.stopPropagation();
    this.cartExpanded.set(true);
  }

  isCartItemCommentExpanded(item: CartItem): boolean {
    return this.expandedCommentKeys().has(this.getCartLineKey(item));
  }

  updateCartItemNotes(item: CartItem, notes: string): void {
    const trimmed = notes.slice(0, this.maxNoteLength);
    const oldKey = this.getCartLineKey(item);
    if (!this.isMyCartItem(item)) {
      return;
    }
    this.cart.update(items =>
      items.map(i => (this.getCartLineKey(i) === oldKey ? { ...i, notes: trimmed } : i))
    );
    if (trimmed.trim()) {
      this.expandedCommentKeys.update(set => {
        const next = new Set(set);
        next.add(this.getCartLineKey({ ...item, notes: trimmed }));
        next.delete(oldKey);
        return next;
      });
    }
    if (this.sharedCartEnabled() && item.lineId) {
      const lineId = item.lineId;
      const prev = this.notesSyncTimers.get(lineId);
      if (prev) clearTimeout(prev);
      this.notesSyncTimers.set(
        lineId,
        setTimeout(() => {
          this.notesSyncTimers.delete(lineId);
          this.api
            .updateTableCartItem(this.tableToken, lineId, {
              session_id: this.sessionId,
              notes: trimmed,
            })
            .subscribe({
              next: res => this.applySharedCartResponse(res),
              error: () => this.loadSharedCart(),
            });
        }, 400)
      );
    }
  }

  getWineTypeClass(wineType: string): string {
    const type = wineType.toLowerCase();
    if (type.includes('red')) return 'red';
    if (type.includes('white')) return 'white';
    if (type.includes('sparkling')) return 'sparkling';
    if (type.includes('rosé') || type.includes('rose')) return 'rose';
    if (type.includes('sweet')) return 'sweet';
    if (type.includes('fortified')) return 'fortified';
    return 'other';
  }

  getWineTypeLabel(wineType: string): string {
    if (wineType.includes('Red')) return 'Tinto';
    if (wineType.includes('White')) return 'Blanco';
    if (wineType.includes('Sparkling')) return 'Espumoso';
    if (wineType.includes('Rosé') || wineType.includes('Rose')) return 'Rosado';
    if (wineType.includes('Sweet')) return 'Dulce';
    if (wineType.includes('Fortified')) return 'Generoso';
    return wineType;
  }

  // ============================================
  // DIETARY INFO HELPERS
  // ============================================
  hasDietaryInfo(product: Product): boolean {
    return this.isVegetarian(product) || this.isVegan(product) || this.isGlutenFree(product);
  }

  isVegetarian(product: Product): boolean {
    const ingredients = product.ingredients?.toLowerCase() || '';
    const subcategory = product.subcategory?.toLowerCase() || '';
    return subcategory.includes('vegetarian') ||
      ingredients.includes('vegetariano') ||
      ingredients.includes('vegetarian');
  }

  isVegan(product: Product): boolean {
    const ingredients = product.ingredients?.toLowerCase() || '';
    const subcategory = product.subcategory?.toLowerCase() || '';
    return subcategory.includes('vegan') ||
      ingredients.includes('vegano') ||
      ingredients.includes('vegan');
  }

  isGlutenFree(product: Product): boolean {
    const ingredients = product.ingredients?.toLowerCase() || '';
    return ingredients.includes('sin gluten') ||
      ingredients.includes('gluten-free') ||
      ingredients.includes('gluten free');
  }

  // ============================================
  // PRODUCT DETAIL (legacy toggles + new modal)
  // ============================================
  toggleIngredients(productId: number) {
    this.showIngredientsFor.update(current => current === productId ? null : productId);
  }

  toggleDescription(productId: number) {
    this.showDescriptionFor.update(current => current === productId ? null : productId);
  }

  openProductDetail(product: Product) {
    this.detailQty.set(1);
    this.selectedProduct.set(product);
    document.body.style.overflow = 'hidden';
  }

  closeProductDetail() {
    this.selectedProduct.set(null);
    document.body.style.overflow = '';
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.selectedProduct()) {
      this.closeProductDetail();
    }
  }

  // ============================================
  // CART OPERATIONS
  // ============================================
  addToCart(product: Product, qty = 1) {
    const newLine: CartItem = {
      product,
      quantity: qty,
      notes: '',
      sessionId: this.sessionId,
      customerName: this.customerName() || null,
    };
    const lineKey = this.getCartLineKey(newLine);

    if (this.sharedCartEnabled()) {
      this.api
        .addTableCartItem(this.tableToken, {
          session_id: this.sessionId,
          customer_name: this.customerName() || undefined,
          product_id: product.id!,
          quantity: qty,
          source: product._source || undefined,
        })
        .subscribe({
          next: res => this.syncCartFromResponse(res, product, lineKey),
          error: () => {
            // Local fallback if shared cart write fails
            this.sharedCartEnabled.set(false);
            this.addToCartLocal(product, qty);
          },
        });
      return;
    }

    this.addToCartLocal(product, qty);
  }

  private addToCartLocal(product: Product, qty = 1) {
    const newLine: CartItem = {
      product,
      quantity: qty,
      notes: '',
      sessionId: this.sessionId,
    };
    const lineKey = this.getCartLineKey(newLine);
    this.cart.update(items => {
      const existing = items.find(i => this.getCartLineKey(i) === lineKey);
      if (existing) {
        return items.map(i =>
          this.getCartLineKey(i) === lineKey ? { ...i, quantity: i.quantity + qty } : i
        );
      }
      return [...items, newLine];
    });
    this.flashProductAdded(product, lineKey);
    if (this.cart().length === 1) {
      this.cartExpanded.set(true);
    }
  }

  /** Add to cart from product detail sheet and close it. */
  addToCartFromDetail() {
    const product = this.selectedProduct();
    if (!product) return;
    this.addToCart(product, this.detailQty());
    this.closeProductDetail();
  }

  changeDetailQty(delta: number): void {
    this.detailQty.set(Math.min(20, Math.max(1, this.detailQty() + delta)));
  }

  /** "papa, yuca, res" -> ["papa", "yuca", "res"] for the ingredient chips. */
  ingredientList(product: Product): string[] {
    return (product.ingredients || '')
      .split(/[,;·\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  incrementItem(item: CartItem) {
    if (!this.isMyCartItem(item)) return;
    const lineKey = this.getCartLineKey(item);
    if (this.sharedCartEnabled() && item.lineId) {
      this.api
        .updateTableCartItem(this.tableToken, item.lineId, {
          session_id: this.sessionId,
          quantity: item.quantity + 1,
        })
        .subscribe({
          next: res => this.syncCartFromResponse(res, item.product, lineKey),
          error: () => this.loadSharedCart(),
        });
      return;
    }
    this.cart.update(items =>
      items.map(i => (this.getCartLineKey(i) === lineKey ? { ...i, quantity: i.quantity + 1 } : i))
    );
    this.flashProductAdded(item.product, lineKey);
  }

  decrementItem(item: CartItem) {
    if (!this.isMyCartItem(item)) return;
    const lineKey = this.getCartLineKey(item);
    if (this.sharedCartEnabled() && item.lineId) {
      if (item.quantity <= 1) {
        this.api.deleteTableCartItem(this.tableToken, item.lineId, this.sessionId).subscribe({
          next: res => this.applySharedCartResponse(res),
          error: () => this.loadSharedCart(),
        });
      } else {
        this.api
          .updateTableCartItem(this.tableToken, item.lineId, {
            session_id: this.sessionId,
            quantity: item.quantity - 1,
          })
          .subscribe({
            next: res => this.applySharedCartResponse(res),
            error: () => this.loadSharedCart(),
          });
      }
      return;
    }
    if (item.quantity <= 1) {
      this.cart.update(items => items.filter(i => this.getCartLineKey(i) !== lineKey));
    } else {
      this.cart.update(items =>
        items.map(i => (this.getCartLineKey(i) === lineKey ? { ...i, quantity: i.quantity - 1 } : i))
      );
    }
  }

  isProductInMenuCart(product: Product): boolean {
    const id = product.id;
    if (id == null) return false;
    return this.productIdsInCart().has(id);
  }

  isProductJustAdded(product: Product): boolean {
    const id = product.id;
    if (id == null) return false;
    return this.justAddedProductIds().has(id);
  }

  isCartLineJustAdded(item: CartItem): boolean {
    return this.justAddedCartKeys().has(this.getCartLineKey(item));
  }

  /** Subtle tint while in cart + short pulse when quantity changes from the menu. */
  private flashProductAdded(product: Product, cartLineKey: string): void {
    const pid = product.id;
    if (pid != null) {
      this.justAddedProductIds.update(s => new Set(s).add(pid));
      setTimeout(() => {
        this.justAddedProductIds.update(s => {
          const next = new Set(s);
          next.delete(pid);
          return next;
        });
      }, 1200);
    }
    this.justAddedCartKeys.update(s => new Set(s).add(cartLineKey));
    setTimeout(() => {
      this.justAddedCartKeys.update(s => {
        const next = new Set(s);
        next.delete(cartLineKey);
        return next;
      });
    }, 1200);
  }

  getTotalItems(): number {
    return this.cart().reduce((sum, item) => sum + item.quantity, 0);
  }

  getTotal(): number {
    return this.cart().reduce((sum, item) => sum + item.product.price_cents * item.quantity, 0);
  }

  formatPrice(priceCents: number): string {
    return formatMoneyCents(priceCents);
  }

  stockLeft(product: Product): number | null {
    return productStockLeft(product);
  }

  sortItems(items: CartItem[]): CartItem[] {
    return [...items].sort((a, b) => {
      if (a.itemId && b.itemId) {
        return b.itemId - a.itemId;
      }
      if (a.itemId && !b.itemId) return -1;
      if (!a.itemId && b.itemId) return 1;
      return 0;
    });
  }

  // ============================================
  // ORDER SUBMISSION
  // ============================================
  submitOrder() {
    // Ignore extra taps while a submit is running (location lookup can take a few seconds)
    if (this.submitting()) return;
    // Check if table is active
    if (!this.tableIsActive()) {
      alert('This table is not accepting orders. Please ask staff for assistance.');
      return;
    }
    const myLines = this.cart().filter(item => this.isMyCartItem(item));
    if (myLines.length === 0) {
      alert(this.translate.instant('MENU.PLACE_OWN_ITEMS_ONLY'));
      return;
    }
    if (this.requiresOrderCode() && !/^\d{4}$/.test(this.orderCode())) {
      alert(this.translate.instant('MENU.ORDER_CODE_REQUIRED'));
      return;
    }
    // Lock the button right away (before the location lookup) and tag this submit so the
    // server ignores any repeat of it.
    this.submitting.set(true);
    this.doSubmitOrder(myLines, this.generateUUID());
  }

  private async doSubmitOrder(myLines: CartItem[], requestId: string) {
    const items: OrderItemCreate[] = myLines.map(item => ({
      product_id: item.product.id!,
      quantity: item.quantity,
      notes: item.notes?.trim() || undefined,
      source: item.product._source || undefined,
    }));

    // Only ask for location when this restaurant actually uses the location-check
    // anti-fraud feature; otherwise the permission prompt is pointless friction.
    let latitude: number | null = null;
    let longitude: number | null = null;

    try {
      if (this.locationCheckEnabled() && 'geolocation' in navigator) {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            timeout: 5000,
            maximumAge: 60000
          });
        });
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
      }
    } catch {
      // Location denied or unavailable - continue without it
    }

    this.api.submitOrder(this.tableToken, {
      request_id: requestId,
      items,
      notes: this.orderNotes.trim() || undefined,
      session_id: this.sessionId,
      table_code: this.requiresOrderCode() ? this.orderCode() : undefined,
      customer_name: this.customerName() || undefined,
      latitude,
      longitude
    }).subscribe({
      next: (response: any) => {
        const orderId = response.order_id;
        if (this.requiresOrderCode()) {
          try {
            sessionStorage.setItem(`order_code_${this.tableToken}`, this.orderCode());
          } catch {
            // storage unavailable: nothing to remember
          }
        }

        if (response.session_id && response.session_id !== this.sessionId) {
          console.warn('Session ID mismatch - order may belong to different session');
        }

        if (response.customer_name && response.customer_name !== this.customerName()) {
          this.customerName.set(response.customer_name);
          localStorage.setItem(`customer_name_${this.tableToken}`, response.customer_name);
        }

        this.orderNotes = '';
        this.expandedCommentKeys.set(new Set());
        this.lastOrderId.set(orderId);
        this.showSuccessToast.set(true);
        setTimeout(() => this.showSuccessToast.set(false), 3000);
        this.ordersExpanded.set(true);
        this.submitting.set(false);

        if (this.sharedCartEnabled()) {
          // Backend already dropped this session's draft lines; refresh to keep others'
          this.loadSharedCart();
        } else {
          this.cart.set([]);
          this.cartExpanded.set(false);
        }

        this.loadStoredOrders();

        // Auto-trigger payment if immediate payment is required
        if (this.immediatePaymentRequired()) {
          setTimeout(() => {
            const currentOrder = this.placedOrders().find(o => o.id === orderId);
            if (currentOrder) {
              this.startCheckout(currentOrder);
            }
          }, 500);
        }
      },
      error: (err) => {
        this.submitting.set(false);
        // Same submit already being processed by the server: not an error for the guest
        if (err.status === 409) return;
        const detail = err.error?.detail;
        if (err.status === 403 && detail === 'invalid_table_code') {
          this.orderCode.set('');
          try {
            sessionStorage.removeItem(`order_code_${this.tableToken}`);
          } catch {
            // ignore
          }
          alert(this.translate.instant('MENU.ORDER_CODE_INVALID'));
          return;
        }
        if (err.status === 429 && detail === 'too_many_code_attempts') {
          alert(this.translate.instant('MENU.ORDER_CODE_LOCKED'));
          return;
        }
        const errorMsg = typeof detail === 'string' ? detail : 'Failed to place order.';

        if (errorMsg.includes('active') || errorMsg.includes('accepting')) {
          alert('This table is not accepting orders. Please ask staff for assistance.');
        } else {
          alert(errorMsg);
        }
      }
    });
  }

  // ============================================
  // ORDER MANAGEMENT
  // ============================================
  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pending',
      preparing: 'Preparing',
      ready: 'Ready',
      partially_delivered: 'Partially Delivered',
      paid: 'Paid',
      completed: 'Done',
      cancelled: 'Cancelled'
    };
    return labels[status] || status;
  }

  getItemStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pending',
      preparing: 'Preparing',
      ready: 'Ready',
      delivered: 'Delivered',
      cancelled: 'Cancelled'
    };
    return labels[status] || status;
  }

  getSortedOrderItems(items: CartItem[]): CartItem[] {
    return this.sortItems(items);
  }

  // ============================================
  // ORDER STORAGE
  // ============================================
  loadStoredOrders() {
    // Fetch the table's active shared order from the backend.
    // The backend returns the order linked to table.active_order_id,
    // which is the single shared order for the current table session.
    this.api.getCurrentOrder(this.tableToken, this.sessionId).subscribe({
      next: (response) => {
        if (response.order && response.order.items?.length > 0) {
          const activeItems = response.order.items.filter((item: any) => !item.removed_by_customer);
          const order: PlacedOrder = {
            id: response.order.id,
            items: this.sortItems(activeItems.map((item: any) => ({
              product: {
                id: item.product_id,
                name: item.product_name,
                price_cents: item.price_cents
              } as Product,
              quantity: item.quantity,
              notes: item.notes || '',
              status: item.status,
              itemId: item.id
            } as CartItem))),
            notes: response.order.notes || '',
            total: response.order.total_cents,
            status: response.order.status,
            extraCents: response.order.extra_charge_cents || 0,
            extraNote: response.order.extra_charge_note || ''
          };
          this.placedOrders.set([order]);
          this.saveOrders();
        } else {
          // No active order with items -- clear displayed orders
          this.placedOrders.set([]);
          this.saveOrders();
        }
      },
      error: () => {
        this.loadFromLocalStorageFallback();
      }
    });
  }

  private loadFromLocalStorageFallback() {
    const stored = localStorage.getItem(`orders_${this.tableToken}`);
    if (stored) {
      try {
        const orders: PlacedOrder[] = JSON.parse(stored);
        const activeOrders = orders.filter(o => o.status !== 'paid' && o.status !== 'completed');
        activeOrders.forEach(o => o.items = this.sortItems(o.items));
        this.placedOrders.set(activeOrders);
        if (activeOrders.length !== orders.length) {
          this.saveOrders();
        }
      } catch { }
    }
  }

  /** Staff-only additional charge editor (amount in major units, like the rest of the app). */
  extraEditOrderId = signal<number | null>(null);
  extraAmountInput = '';

  readonly extraQuickAmounts = [1000, 2000, 5000, 10000];

  addExtraAmount(pesos: number) {
    const n = parseFloat((this.extraAmountInput || '').replace(',', '.'));
    this.extraAmountInput = String((Number.isNaN(n) ? 0 : n) + pesos);
  }

  openExtraCharge(order: PlacedOrder) {
    this.extraAmountInput = order.extraCents ? String(order.extraCents / 100) : '';
    this.extraEditOrderId.set(order.id);
  }

  saveExtraCharge(orderId: number) {
    const n = parseFloat((this.extraAmountInput || '').replace(',', '.'));
    const cents = Number.isNaN(n) || n < 0 ? 0 : Math.round(n * 100);
    this.api.setOrderExtraCharge(orderId, cents).subscribe({
      next: () => {
        this.extraEditOrderId.set(null);
        this.loadStoredOrders();
      },
      error: (err) => alert(err.error?.detail || 'Failed to save extra charge')
    });
  }

  /** Customers edit only pending items; staff can edit any item that is not delivered/cancelled. */
  canEditItem(item: { status?: string; itemId?: number }): boolean {
    if (this.isPaid() || !item.itemId) return false;
    return this.isStaff() ? item.status !== 'cancelled' : item.status === 'pending';
  }

  canCancelOrder(order: PlacedOrder): boolean {
    // Can cancel if order is pending and has no items in preparing/ready/delivered status
    if (order.status === 'paid' || order.status === 'completed' || order.status === 'cancelled') {
      return false;
    }
    if (this.isStaff()) {
      return true;
    }
    // Check if any items are being prepared, ready, or delivered
    const hasNonPendingItems = order.items.some(item =>
      item.status === 'preparing' || item.status === 'ready' || item.status === 'delivered'
    );
    return !hasNonPendingItems;
  }

  cancelOrder(orderId: number) {
    if (!confirm('Are you sure you want to cancel this entire order?')) {
      return;
    }

    this.api.cancelOrder(this.tableToken, orderId, this.sessionId).subscribe({
      next: () => {
        this.placedOrders.set([]);
        localStorage.removeItem(`orders_${this.tableToken}`);
        alert('Order cancelled');
      },
      error: (err) => {
        const errorMsg = err.error?.detail || 'Failed to cancel order';
        if (errorMsg.includes('delivered')) {
          alert('Cannot cancel order with delivered items');
        } else if (errorMsg.includes('preparing') || errorMsg.includes('ready')) {
          alert('Cannot cancel order with items that are being prepared or ready');
        } else {
          alert(errorMsg);
        }
      }
    });
  }

  removeItemFromOrder(orderId: number, itemId: number) {
    if (!confirm('Are you sure you want to remove this item from your order?')) {
      return;
    }

    const currentOrder = this.placedOrders().find(o => o.id === orderId);
    const itemToRemove = currentOrder?.items.find(item => item.itemId === itemId);
    const productId = itemToRemove?.product.id;

    this.api.removeOrderItem(this.tableToken, orderId, itemId, this.sessionId).subscribe({
      next: () => {
        this.loadStoredOrders();
        if (productId) {
          this.cart.update(items => items.filter(i => i.product.id !== productId));
        }
      },
      error: (err) => {
        const errorMsg = err.error?.detail || 'Failed to remove item';
        if (errorMsg.includes('delivered')) {
          alert('Cannot remove items that have already been delivered');
        } else {
          alert(errorMsg);
        }
      }
    });
  }

  updateItemQuantity(orderId: number, itemId: number, quantity: number) {
    if (quantity <= 0) {
      alert('Quantity must be at least 1');
      return;
    }
    this.api.updateOrderItemQuantity(this.tableToken, orderId, itemId, quantity, this.sessionId).subscribe({
      next: () => {
        this.loadStoredOrders();
      },
      error: (err) => {
        const errorMsg = err.error?.detail || 'Failed to update quantity';
        if (errorMsg.includes('preparing') || errorMsg.includes('ready') || errorMsg.includes('delivered')) {
          alert('Cannot modify items that are being prepared, ready, or delivered');
        } else {
          alert(errorMsg);
        }
      }
    });
  }

  // ============================================
  // PAYMENT
  // ============================================
  startCheckout(order: PlacedOrder) {
    this.paymentAmount.set(order.total);
    this.paymentOptionsStep.set('choose');
    this.paymentMessage.set('');
    this.paymentMessageTarget.set(null);
    this.paymentRequestSuccess.set(false);
    this.callWaiterDirectEntry.set(false);
    this.showPaymentOptions.set(true);
  }

  // --- Payment options handlers ---

  /** Show where to transfer (informational only — staff confirms the payment in Orders). */
  selectTransfer(method: 'nequi' | 'qr' | 'llave' | 'bank') {
    this.transferMethod.set(method);
    this.transferCopied.set(false);
    this.paymentOptionsStep.set('transfer');
  }

  transferValue(): string {
    const m = this.transferMethod();
    if (m === 'nequi') return this.tenantPaymentNequi() ?? '';
    if (m === 'llave') return this.tenantPaymentLlave() ?? '';
    return '';
  }

  copyTransferValue() {
    this.copyText(this.transferValue());
  }

  copyText(value: string) {
    if (!value || !navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(
      () => {
        this.transferCopied.set(true);
        setTimeout(() => this.transferCopied.set(false), 2000);
      },
      () => {},
    );
  }

  selectCallWaiter() {
    this.paymentMessageTarget.set('waiter');
    this.paymentOptionsStep.set('message');
  }

  /** Always-visible entry point (header): call the waiter without needing a placed order first. */
  openCallWaiter() {
    if (this.waiterCallCooldown()) return;
    this.callWaiterDirectEntry.set(true);
    this.paymentMessage.set('');
    this.paymentMessageTarget.set('waiter');
    this.paymentRequestSuccess.set(false);
    this.paymentOptionsStep.set('message');
    this.showPaymentOptions.set(true);
  }

  submitPaymentRequest() {
    const target = this.paymentMessageTarget();
    const typed = this.paymentMessage().trim();
    const message = typed || (target === 'waiter' ? this.translate.instant('PAYMENTS.CALL_WAITER_DEFAULT_MESSAGE') : undefined);
    this.paymentRequestSending.set(true);

    if (target === 'waiter') {
      this.api.callWaiter(this.tableToken, message).subscribe({
        next: () => {
          this.paymentRequestSending.set(false);
          this.paymentOptionsStep.set('success');
          this.paymentRequestSuccess.set(true);
          // Cooldown to prevent spamming
          this.waiterCallCooldown.set(true);
          setTimeout(() => this.waiterCallCooldown.set(false), 30000);
        },
        error: (err) => {
          this.paymentRequestSending.set(false);
          alert(err.error?.detail || 'Failed to call waiter.');
        }
      });
    }
  }

  closePaymentOptions() {
    this.showPaymentOptions.set(false);
    this.paymentMessage.set('');
    this.paymentMessageTarget.set(null);
    this.transferMethod.set(null);
    this.callWaiterDirectEntry.set(false);
  }

  backToPaymentOptions() {
    if (this.callWaiterDirectEntry()) {
      // Opened straight into "call waiter" from the header — there's no order-based
      // "choose payment method" screen to go back to, so just close.
      this.closePaymentOptions();
      return;
    }
    this.paymentOptionsStep.set('choose');
    this.paymentMessage.set('');
    this.paymentMessageTarget.set(null);
    this.transferMethod.set(null);
  }
}
