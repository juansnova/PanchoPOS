import { Component, inject, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { SidebarComponent } from '../shared/sidebar.component';
import { TranslateModule } from '@ngx-translate/core';
import { PermissionService } from '../services/permission.service';
import {
  ApiService,
  SalesReport,
  TenantUiModuleKey,
  WorkSession,
  workSessionNetWorkSeconds,
  workSessionOpenExceedsContract,
} from '../services/api.service';
import { formatMoneyCents } from '../shared/currency-symbol';

type Tone = 'ops' | 'cat' | 'adm';

interface Tile {
  route: string;
  title: string;
  desc: string;
  icon: string;
  testid?: string;
}

interface TileGroup {
  key: string;
  tone: Tone;
  tiles: Tile[];
}

function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const ICON = {
  orders: '<path d="M6 2h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4V2z"/><path d="M9 7h6M9 11h6"/>',
  reservations: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  tables: '<rect x="2" y="8" width="20" height="3" rx="1"/><path d="M5 11v9M19 11v9"/>',
  kitchen: '<path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 002.5 2.5z"/>',
  bar: '<path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/><path d="M6 2v2M10 1v3M14 2v2"/>',
  products: '<path d="M20.6 13.4 11 3.8A2 2 0 009.6 3H4a1 1 0 00-1 1v5.6a2 2 0 00.6 1.4l9.6 9.6a2 2 0 002.8 0l4.6-4.6a2 2 0 000-2.8z"/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none"/>',
  customers: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"/>',
  inventory: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  plan: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 15h3"/>',
  reports: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
  users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>',
} as const;

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, SidebarComponent, RouterLink, TranslateModule],
  template: `
    <app-sidebar>
      <div class="db-page">
        <!-- ======================= greeting ======================= -->
        <header class="db-hero">
          <div>
            <span class="db-eyebrow">{{ 'DASHBOARD.TITLE' | translate }}</span>
            <h1>{{ greetKey() | translate: { name: firstName() } }}<span class="db-dot">.</span></h1>
            <p>{{ todayLabel() }}</p>
          </div>

          @if (canViewMyShift()) {
            <a routerLink="/my-shift" class="db-shift" [class.on]="!!shiftOpen()" [class.over]="shiftExceedsContract()" data-testid="dashboard-my-shift">
              <span class="db-shift-ico" aria-hidden="true">
                <i class="db-pulse"></i>
              </span>
              <span class="db-shift-text">
                <small>{{ 'DASHBOARD.MY_SHIFT_TITLE' | translate }}</small>
                @if (shiftStatusLoading()) {
                  <b>{{ 'DASHBOARD.MY_SHIFT_LOADING' | translate }}</b>
                } @else if (shiftOpen()) {
                  <b>{{ shiftElapsed() }}</b>
                  <em>{{ 'DASHBOARD.MY_SHIFT_ON_SHORT' | translate }}</em>
                  @if (shiftExceedsContract()) {
                    <span class="db-overtime" data-testid="dashboard-my-shift-overtime">{{ 'DASHBOARD.MY_SHIFT_OVERTIME' | translate }}</span>
                  }
                } @else {
                  <b>{{ 'DASHBOARD.MY_SHIFT_OFF_SHORT' | translate }}</b>
                  <em>{{ 'DASHBOARD.MY_SHIFT_DESC_OFF' | translate }}</em>
                }
              </span>
              <span class="db-shift-go" aria-hidden="true">→</span>
            </a>
          }
        </header>

        <!-- ======================= today (owners / admins) ======================= -->
        @if (canShowAdminSections() && today(); as t) {
          <section class="db-today" aria-label="today">
            <article class="db-sales">
              <div class="db-sales-top">
                <span class="db-label">{{ 'DASHBOARD.SALES_TODAY' | translate }}</span>
                @if (t.delta !== null) {
                  <span class="db-delta" [class.down]="t.delta < 0">
                    {{ t.delta >= 0 ? '▲' : '▼' }} {{ abs(t.delta) }}% <small>{{ 'DASHBOARD.VS_YESTERDAY' | translate }}</small>
                  </span>
                }
              </div>
              <strong class="db-money">{{ money(t.revenue) }}</strong>
              <svg class="db-spark" viewBox="0 0 320 90" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="dbSparkFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#fff" stop-opacity=".35" />
                    <stop offset="100%" stop-color="#fff" stop-opacity="0" />
                  </linearGradient>
                </defs>
                <path [attr.d]="t.area" fill="url(#dbSparkFill)" />
                <path [attr.d]="t.line" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
                <circle [attr.cx]="t.dotX" [attr.cy]="t.dotY" r="5" fill="#fff" />
              </svg>
              <div class="db-spark-days" aria-hidden="true">
                @for (d of t.days; track d.key) {
                  <span [class.now]="d.today">{{ d.label }}</span>
                }
              </div>
            </article>

            <article class="db-stat">
              <span class="db-label">{{ 'DASHBOARD.ORDERS_TODAY' | translate }}</span>
              <strong>{{ t.orders }}</strong>
              <small>{{ 'DASHBOARD.YESTERDAY' | translate }}: {{ t.ordersYesterday }}</small>
            </article>

            <article class="db-stat">
              <span class="db-label">{{ 'DASHBOARD.AVG_TICKET' | translate }}</span>
              <strong>{{ money(t.avgTicket) }}</strong>
              <small>{{ 'DASHBOARD.TIPS_TODAY' | translate }}: {{ money(t.tips) }}</small>
            </article>

            <a class="db-stat db-team" routerLink="/reports">
              <span class="db-label">{{ 'DASHBOARD.ON_SHIFT_NOW' | translate }}</span>
              <strong>{{ team().length }}</strong>
              <div class="db-faces">
                @for (p of team().slice(0, 5); track p.id) {
                  <span class="db-face" [style.--h]="hueOf(p.user_name)" [title]="p.user_name">{{ initialsOf(p.user_name) }}</span>
                }
                @if (team().length > 5) { <span class="db-face more">+{{ team().length - 5 }}</span> }
                @if (team().length === 0) { <small>{{ 'DASHBOARD.NOBODY' | translate }}</small> }
              </div>
            </a>
          </section>
        } @else if (canShowAdminSections() && todayLoading()) {
          <div class="db-skeleton" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        }

        <!-- ======================= shortcuts ======================= -->
        @for (g of groups(); track g.key) {
          <section class="db-group" [attr.data-tone]="g.tone">
            <h2><i></i>{{ 'DASHBOARD.' + g.key | translate }}</h2>
            <div class="db-tiles">
              @for (tile of g.tiles; track tile.route) {
                <a [routerLink]="tile.route" class="db-tile" [attr.data-testid]="tile.testid ?? null">
                  <span class="db-tile-ico" [innerHTML]="svg(tile.icon, 26)" aria-hidden="true"></span>
                  <span class="db-tile-text">
                    <b>{{ tile.title | translate }}</b>
                    <small>{{ tile.desc | translate }}</small>
                  </span>
                  <span class="db-tile-go" aria-hidden="true">→</span>
                  <span class="db-tile-mark" [innerHTML]="svg(tile.icon, 110)" aria-hidden="true"></span>
                </a>
              }
            </div>
          </section>
        }
      </div>
    </app-sidebar>
  `,
  styles: [`
    .db-page { max-width: 1120px; display: flex; flex-direction: column; gap: 26px; }

    /* ---------- greeting ---------- */
    .db-hero { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 18px; }
    .db-hero h1 { margin: 8px 0 4px; font-family: var(--font-brand, Georgia, serif); font-size: clamp(2rem, 4vw, 2.8rem); font-weight: 500; letter-spacing: -0.025em; line-height: 1.08; }
    .db-dot { color: var(--color-primary); }
    .db-hero p { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 1.05rem; color: var(--color-text-muted); }
    .db-eyebrow { display: inline-flex; align-items: center; gap: 10px; font-size: 0.68rem; font-weight: 800; letter-spacing: 0.22em; text-transform: uppercase; color: var(--color-primary); }
    .db-eyebrow::before { content: ''; width: 26px; height: 2px; background: var(--color-primary); }

    /* ---------- my shift pill ---------- */
    .db-shift { display: flex; align-items: center; gap: 14px; padding: 12px 18px 12px 12px; border-radius: 999px; background: var(--color-surface); border: 1px solid var(--color-border); text-decoration: none; color: inherit; box-shadow: 0 16px 26px -22px rgba(0,0,0,.5); transition: border-color .15s, transform .15s; }
    .db-shift:hover { border-color: var(--color-primary); transform: translateY(-2px); }
    .db-shift-ico { position: relative; display: grid; place-items: center; width: 46px; height: 46px; border-radius: 50%; background: var(--color-bg); box-shadow: inset 0 0 0 1px var(--color-border); }
    .db-pulse { position: relative; width: 12px; height: 12px; border-radius: 50%; background: #94a3b8; }
    .db-shift.on .db-pulse { background: #10b981; }
    .db-shift.on .db-pulse::after { content: ''; position: absolute; inset: -7px; border-radius: 50%; border: 2px solid #10b981; animation: db-ping 1.8s ease-out infinite; }
    .db-shift.on .db-shift-ico { background: #d1fae5; box-shadow: inset 0 0 0 1px #6ee7b7; }
    .db-shift.over .db-pulse { background: #f97316; }
    .db-shift.over .db-pulse::after { border-color: #f97316; }
    @keyframes db-ping { from { transform: scale(.4); opacity: 1; } to { transform: scale(1.2); opacity: 0; } }
    .db-shift-text { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
    .db-shift-text small { font-size: 0.64rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-text-muted); }
    .db-shift-text b { font-family: Georgia, 'Times New Roman', serif; font-size: 1.25rem; font-weight: 500; font-variant-numeric: tabular-nums; }
    .db-shift-text em { font-style: normal; font-size: 0.78rem; font-weight: 600; color: var(--color-text-muted); }
    .db-shift.on .db-shift-text em { color: #047857; }
    .db-overtime { margin-top: 2px; font-size: 0.74rem; font-weight: 800; color: #b45309; }
    .db-shift-go { font-size: 1.2rem; font-weight: 800; color: var(--color-primary); transition: transform .2s; }
    .db-shift:hover .db-shift-go { transform: translateX(4px); }

    /* ---------- today ---------- */
    .db-today { display: grid; grid-template-columns: 1.7fr 1fr 1fr 1fr; gap: 14px; }
    @media (max-width: 1040px) { .db-today { grid-template-columns: 1fr 1fr; } .db-sales { grid-column: 1 / -1; } }
    @media (max-width: 520px) { .db-today { grid-template-columns: minmax(0, 1fr); } }

    .db-sales {
      position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 6px; padding: 22px 24px 16px; border-radius: 30px; color: #fff;
      background: linear-gradient(150deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 58%, #1c1917));
      box-shadow: 0 30px 44px -30px var(--color-primary);
    }
    .db-sales::after { content: ''; position: absolute; right: -80px; top: -120px; width: 300px; height: 300px; border-radius: 50%; border: 1px solid rgba(255,255,255,.22); box-shadow: 0 0 0 36px rgba(255,255,255,.04); pointer-events: none; }
    .db-sales > * { position: relative; z-index: 1; }
    .db-sales-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .db-label { font-size: 0.68rem; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; opacity: .85; }
    .db-delta { display: inline-flex; align-items: baseline; gap: 6px; padding: 3px 12px; border-radius: 999px; background: rgba(255,255,255,.2); font-size: 0.8rem; font-weight: 800; }
    .db-delta small { font-weight: 600; opacity: .85; }
    .db-delta.down { background: rgba(0,0,0,.28); }
    .db-money { font-family: Georgia, 'Times New Roman', serif; font-size: clamp(2.2rem, 4.2vw, 3.3rem); font-weight: 400; letter-spacing: -0.03em; line-height: 1.05; font-variant-numeric: tabular-nums; }
    .db-spark { width: 100%; height: 84px; margin-top: 4px; overflow: visible; }
    .db-spark-days { display: flex; justify-content: space-between; font-size: 0.64rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; opacity: .75; }
    .db-spark-days .now { opacity: 1; text-decoration: underline; text-underline-offset: 3px; }

    .db-stat { display: flex; flex-direction: column; gap: 4px; padding: 20px 22px; border-radius: 28px; background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: 0 18px 28px -26px rgba(0,0,0,.5); text-decoration: none; color: inherit; }
    .db-stat .db-label { color: var(--color-text-muted); opacity: 1; }
    .db-stat strong { font-family: Georgia, 'Times New Roman', serif; font-size: 2.1rem; font-weight: 400; line-height: 1.1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
    .db-stat small { font-size: 0.78rem; font-weight: 600; color: var(--color-text-muted); }
    .db-team { transition: border-color .15s, transform .15s; }
    .db-team:hover { border-color: #10b981; transform: translateY(-2px); }
    .db-team strong { color: #059669; }
    .db-faces { display: flex; align-items: center; margin-top: auto; padding-top: 6px; }
    .db-face { --h: 24; display: grid; place-items: center; width: 34px; height: 34px; margin-left: -8px; border-radius: 50%; border: 2px solid var(--color-surface); color: #fff; font-size: 0.7rem; font-weight: 800; background: linear-gradient(145deg, hsl(var(--h) 72% 56%), hsl(calc(var(--h) + 28) 72% 40%)); }
    .db-face:first-child { margin-left: 0; }
    .db-face.more { background: #1c1917; }
    .db-skeleton { display: grid; grid-template-columns: 1.7fr 1fr 1fr 1fr; gap: 14px; }
    .db-skeleton i { display: block; height: 190px; border-radius: 28px; background: linear-gradient(90deg, var(--color-bg) 25%, color-mix(in srgb, var(--color-border) 60%, var(--color-bg)) 50%, var(--color-bg) 75%); background-size: 200% 100%; animation: db-shimmer 1.4s linear infinite; }
    @keyframes db-shimmer { to { background-position: -200% 0; } }

    /* ---------- shortcut groups ---------- */
    .db-group { --t1: var(--color-primary); --t2: color-mix(in srgb, var(--color-primary) 62%, #000); }
    .db-group[data-tone='cat'] { --t1: #0e9aa7; --t2: #0b5d6b; }
    .db-group[data-tone='adm'] { --t1: #7c5cff; --t2: #4527a8; }
    .db-group h2 { display: flex; align-items: center; gap: 12px; margin: 0 0 14px; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; color: var(--color-text-muted); }
    .db-group h2 i { width: 10px; height: 10px; border-radius: 50%; background: var(--t1); box-shadow: 0 0 0 4px color-mix(in srgb, var(--t1) 22%, transparent); }
    .db-group h2::after { content: ''; flex: 1; height: 1px; background: linear-gradient(90deg, var(--color-border), transparent); }
    .db-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 12px; }

    .db-tile { position: relative; overflow: hidden; display: flex; align-items: center; gap: 16px; padding: 16px 18px; border-radius: 24px; background: var(--color-surface); border: 1px solid var(--color-border); text-decoration: none; color: inherit; transition: transform .18s, border-color .18s, box-shadow .18s; }
    .db-tile:hover { transform: translateY(-3px); border-color: var(--t1); box-shadow: 0 22px 32px -24px var(--t1); }
    .db-tile > * { position: relative; z-index: 1; }
    .db-tile-ico { flex: none; display: grid; place-items: center; width: 54px; height: 54px; border-radius: 18px; color: #fff; background: linear-gradient(145deg, var(--t1), var(--t2)); box-shadow: 0 14px 22px -14px var(--t1), inset 0 1px 0 rgba(255,255,255,.35); }
    .db-tile-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .db-tile-text b { font-family: var(--font-brand, inherit); font-size: 1.04rem; font-weight: 700; }
    .db-tile-text small { font-size: 0.8rem; line-height: 1.35; color: var(--color-text-muted); }
    .db-tile-go { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--color-bg); color: var(--t1); font-weight: 800; transition: transform .2s, background .2s, color .2s; }
    .db-tile:hover .db-tile-go { background: var(--t1); color: #fff; transform: translateX(3px); }
    .db-tile-mark { position: absolute !important; right: -22px; bottom: -34px; z-index: 0 !important; color: var(--t1); opacity: .07; transform: rotate(-12deg); pointer-events: none; }

    @media (prefers-reduced-motion: reduce) {
      .db-shift, .db-tile, .db-team, .db-tile-go, .db-shift-go { transition: none; }
      .db-shift.on .db-pulse::after, .db-skeleton i { animation: none; }
    }
    @media (max-width: 560px) { .db-tiles { grid-template-columns: minmax(0, 1fr); } }
  `]
})
export class DashboardComponent implements OnInit, OnDestroy {
  private permissions = inject(PermissionService);
  private api = inject(ApiService);
  private sanitizer = inject(DomSanitizer);

  user = signal(this.api.getCurrentUser());
  canShowAdminSections = computed(() => this.permissions.isAdmin(this.user()));
  canViewCustomers = computed(() => this.permissions.canAccessRoute(this.user(), '/customers'));
  canViewMyShift = computed(() => this.permissions.canAccessRoute(this.user(), '/my-shift'));
  canViewReservations = computed(() => this.permissions.hasPermission(this.user(), 'reservation:read'));
  canViewTables = computed(() => this.permissions.canAccessRoute(this.user(), '/tables'));
  canViewKitchen = computed(() => this.permissions.canAccessRoute(this.user(), '/kitchen'));
  canViewProducts = computed(() => this.permissions.canAccessRoute(this.user(), '/products'));

  /** Open work session when clocked in; null when not; only loaded when `canViewMyShift`. */
  shiftOpen = signal<WorkSession | null>(null);
  shiftStatusLoading = signal(false);
  private shiftUiTick = signal(0);
  private shiftTicker: ReturnType<typeof setInterval> | null = null;

  shiftExceedsContract = computed(() => {
    this.shiftUiTick();
    return workSessionOpenExceedsContract(this.shiftOpen());
  });

  shiftElapsed = computed(() => {
    this.shiftUiTick();
    const s = this.shiftOpen();
    if (!s) return '';
    const mins = Math.max(0, Math.floor(workSessionNetWorkSeconds(s) / 60));
    return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
  });

  firstName = computed(() => {
    const u = this.user();
    return ((u?.full_name || u?.username || '').trim().split(/\s+/)[0] || '').replace(/@.*/, '');
  });

  greetKey = computed(() => {
    const h = new Date().getHours();
    return h < 12 ? 'DASHBOARD.GREET_MORNING' : h < 19 ? 'DASHBOARD.GREET_AFTERNOON' : 'DASHBOARD.GREET_EVENING';
  });

  todayLabel = computed(() => {
    const s = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  });

  // ---------------------------------------------------------------- today's numbers (owner / admin)
  private report = signal<SalesReport | null>(null);
  team = signal<WorkSession[]>([]);
  todayLoading = signal(false);

  today = computed(() => {
    const r = this.report();
    if (!r) return null;
    const daily = r.summary.daily;
    const now = new Date();
    const todayKey = localIso(now);
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const yKey = localIso(y);
    const by = new Map(daily.map((d) => [d.date, d]));
    const t = by.get(todayKey);
    const yd = by.get(yKey);
    const revenue = t?.revenue_cents ?? 0;
    const orders = t?.order_count ?? 0;
    const ydRevenue = yd?.revenue_cents ?? 0;
    const delta = ydRevenue > 0 ? Math.round(((revenue - ydRevenue) / ydRevenue) * 100) : null;

    // last 7 days, oldest first
    const days: { key: string; label: string; today: boolean; v: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = localIso(d);
      days.push({
        key,
        label: d.toLocaleDateString(undefined, { weekday: 'short' }).replace('.', '').slice(0, 3),
        today: i === 0,
        v: by.get(key)?.revenue_cents ?? 0,
      });
    }
    const max = Math.max(1, ...days.map((d) => d.v));
    const W = 320;
    const H = 90;
    const pts = days.map((d, i) => ({ x: (i / 6) * W, y: H - 8 - (d.v / max) * (H - 22) }));
    const line = pts.reduce((p, c, i) => {
      if (i === 0) return `M${c.x},${c.y}`;
      const prev = pts[i - 1];
      const mx = (prev.x + c.x) / 2;
      return `${p} C${mx},${prev.y} ${mx},${c.y} ${c.x},${c.y}`;
    }, '');
    const last = pts[pts.length - 1];
    return {
      revenue,
      orders,
      ordersYesterday: yd?.order_count ?? 0,
      avgTicket: orders ? Math.round(revenue / orders) : 0,
      tips: t?.tips_cents ?? 0,
      delta,
      days,
      line,
      area: `${line} L${W},${H} L0,${H} Z`,
      dotX: last.x,
      dotY: last.y,
    };
  });

  money(cents: number): string {
    return formatMoneyCents(cents);
  }

  abs(n: number): number {
    return Math.abs(n);
  }

  hueOf(name: string): number {
    let hash = 0;
    for (const ch of name || '?') hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    return hash;
  }

  initialsOf(name: string): string {
    const parts = (name || '?').trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  // ---------------------------------------------------------------- shortcuts
  private iconCache = new Map<string, SafeHtml>();

  svg(inner: string, size: number): SafeHtml {
    const k = `${size}:${inner}`;
    let v = this.iconCache.get(k);
    if (!v) {
      v = this.sanitizer.bypassSecurityTrustHtml(
        `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${size > 40 ? 1.2 : 2}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`,
      );
      this.iconCache.set(k, v);
    }
    return v;
  }

  moduleEnabled(key: TenantUiModuleKey): boolean {
    return this.api.isUiModuleEnabled(key);
  }

  /** Visible shortcuts, grouped by what they are for (same permission / module rules as before). */
  groups(): TileGroup[] {
    const ops: Tile[] = [
      { route: '/staff/orders', title: 'DASHBOARD.ORDERS_TITLE', desc: 'DASHBOARD.ORDERS_DESC', icon: ICON.orders },
    ];
    if (this.canViewTables() && this.moduleEnabled('tables')) {
      ops.push({ route: '/tables', title: 'DASHBOARD.TABLES_TITLE', desc: 'DASHBOARD.TABLES_DESC', icon: ICON.tables });
    }
    if (this.canViewReservations() && this.moduleEnabled('reservations')) {
      ops.push({ route: '/reservations', title: 'DASHBOARD.RESERVATIONS_TITLE', desc: 'DASHBOARD.RESERVATIONS_DESC', icon: ICON.reservations });
    }
    if (this.canViewKitchen() && this.moduleEnabled('kitchen_bar')) {
      ops.push({ route: '/kitchen', title: 'DASHBOARD.KITCHEN_TITLE', desc: 'DASHBOARD.KITCHEN_DESC', icon: ICON.kitchen });
    }
    if (this.moduleEnabled('kitchen_bar')) {
      ops.push({ route: '/bar', title: 'DASHBOARD.BEVERAGES_TITLE', desc: 'DASHBOARD.BEVERAGES_DESC', icon: ICON.bar });
    }

    const cat: Tile[] = [];
    if (this.canViewProducts()) {
      cat.push({ route: '/products', title: 'DASHBOARD.PRODUCTS_TITLE', desc: 'DASHBOARD.PRODUCTS_DESC', icon: ICON.products });
    }
    if (this.canViewCustomers()) {
      cat.push({ route: '/customers', title: 'DASHBOARD.CUSTOMERS_TITLE', desc: 'DASHBOARD.CUSTOMERS_DESC', icon: ICON.customers });
    }
    if (this.canShowAdminSections() && this.moduleEnabled('inventory')) {
      cat.push({ route: '/inventory', title: 'DASHBOARD.INVENTORY_TITLE', desc: 'DASHBOARD.INVENTORY_DESC', icon: ICON.inventory });
    }

    const adm: Tile[] = [];
    if (this.canShowAdminSections()) {
      if (this.moduleEnabled('working_plan')) {
        adm.push({ route: '/working-plan', title: 'DASHBOARD.WORKING_PLAN_TITLE', desc: 'DASHBOARD.WORKING_PLAN_DESC', icon: ICON.plan });
      }
      adm.push({ route: '/reports', title: 'DASHBOARD.REPORTS_TITLE', desc: 'DASHBOARD.REPORTS_DESC', icon: ICON.reports });
      if (this.moduleEnabled('users')) {
        adm.push({ route: '/users', title: 'DASHBOARD.USERS_TITLE', desc: 'DASHBOARD.USERS_DESC', icon: ICON.users });
      }
      adm.push({ route: '/settings', title: 'DASHBOARD.SETTINGS_TITLE', desc: 'DASHBOARD.SETTINGS_DESC', icon: ICON.settings });
    }

    return ([
      { key: 'GROUP_OPS', tone: 'ops', tiles: ops },
      { key: 'GROUP_CATALOG', tone: 'cat', tiles: cat },
      { key: 'GROUP_ADMIN', tone: 'adm', tiles: adm },
    ] as TileGroup[]).filter((g) => g.tiles.length > 0);
  }

  ngOnInit() {
    this.api.ensureTenantUiModulesLoaded().subscribe();
    const u = this.api.getCurrentUser();
    this.user.set(u);

    if (this.permissions.isAdmin(u)) {
      this.loadToday();
    }

    if (this.permissions.canAccessRoute(u, '/my-shift')) {
      this.shiftStatusLoading.set(true);
      this.api.getMyOpenWorkSession().subscribe({
        next: (s) => {
          this.shiftOpen.set(s);
          this.shiftStatusLoading.set(false);
          this.restartTicker(!!s);
        },
        error: () => {
          this.shiftOpen.set(null);
          this.shiftStatusLoading.set(false);
          this.restartTicker(false);
        },
      });
    }
  }

  private loadToday(): void {
    this.todayLoading.set(true);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 6);
    this.api.getSalesReports(localIso(from), localIso(to)).subscribe({
      next: (r) => {
        this.report.set(r);
        this.todayLoading.set(false);
      },
      error: () => this.todayLoading.set(false),
    });
    this.api.getReportWorkSessionsLive().subscribe({
      next: (rows) => this.team.set(rows),
      error: () => this.team.set([]),
    });
  }

  private restartTicker(on: boolean): void {
    if (this.shiftTicker != null) {
      clearInterval(this.shiftTicker);
      this.shiftTicker = null;
    }
    if (on) {
      this.shiftTicker = setInterval(() => this.shiftUiTick.update((x) => x + 1), 60_000);
    }
  }

  ngOnDestroy(): void {
    this.restartTicker(false);
  }
}
