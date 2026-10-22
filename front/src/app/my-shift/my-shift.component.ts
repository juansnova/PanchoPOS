import {
  Component,
  Injector,
  OnDestroy,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, forkJoin, from, Observable, of } from 'rxjs';
import { catchError, finalize, switchMap } from 'rxjs/operators';
import { Html5Qrcode } from 'html5-qrcode';
import { SidebarComponent } from '../shared/sidebar.component';
import { TranslateModule } from '@ngx-translate/core';
import {
  ApiService,
  ClockQrStatus,
  WorkSession,
  WorkSessionClockPayload,
  workSessionNetWorkSeconds,
  workSessionOpenExceedsContract,
} from '../services/api.service';
import { PermissionService } from '../services/permission.service';
import { ShiftSupervisionComponent } from '../shift-supervision/shift-supervision.component';

const MY_SHIFT_QR_READER_ID = 'my-shift-qr-reader';

@Component({
  selector: 'app-my-shift',
  standalone: true,
  imports: [CommonModule, SidebarComponent, TranslateModule, ShiftSupervisionComponent],
  template: `
    <app-sidebar>
      @if (isSupervisor()) {
        <app-shift-supervision />
      } @else {
      <div class="ms-page" data-testid="my-shift-page">
        <header class="ms-hero">
          <div>
            <span class="ms-eyebrow">{{ 'MY_SHIFT.TITLE' | translate }}</span>
            <h1>{{ greetKey() | translate: { name: firstName() } }}</h1>
            <p>{{ todayLabel() }}</p>
          </div>
          <div class="ms-chips">
            @if (clockStatus()?.clock_qr_required && !qrBlocked()) {
              <span class="ms-chip ok">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                {{ 'MY_SHIFT.VENUE_OK_SHORT' | translate }}
              </span>
            }
            @if (clockStatus()?.clock_qr_location_verify) {
              <span class="ms-chip">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
                {{ 'MY_SHIFT.LOCATION_SHORT' | translate }}
              </span>
            }
          </div>
        </header>

        @if (clockStatus()?.clock_qr_required && qrBlocked()) {
          <div class="ms-scan">
            <span class="ms-scan-ico" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M7 12h10" /></svg>
            </span>
            <div>
              <b>{{ 'MY_SHIFT.SCAN_TITLE' | translate }}</b>
              <p>{{ 'MY_SHIFT.QR_HINT' | translate }}</p>
            </div>
            <button type="button" class="ms-btn ms-btn-dark" (click)="openVenueScan()" [disabled]="scanStarting()">
              {{ scanStarting() ? ('MY_SHIFT.SCANNER_STARTING' | translate) : ('MY_SHIFT.SCAN_VENUE_QR' | translate) }}
            </button>
          </div>
        }

        @if (exceedsContract()) {
          <div class="ms-overtime" role="status" data-testid="my-shift-overtime-banner">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>
            <div>
              <strong>{{ 'MY_SHIFT.OVERTIME_TITLE' | translate }}</strong>
              <p>{{ 'MY_SHIFT.OVERTIME_BODY' | translate: { hours: contractHours() } }}</p>
            </div>
          </div>
        }

        @if (error()) {
          <div class="ms-error">{{ error() }}</div>
        }

        @if (qrBlocked()) {
          <div class="ms-error" role="alert">{{ 'MY_SHIFT.ERR_QR' | translate }}</div>
        }

        @if (scanOpen()) {
          <div
            class="scan-backdrop"
            role="dialog"
            aria-modal="true"
            [attr.aria-label]="'MY_SHIFT.SCANNER_TITLE' | translate"
            (click)="closeVenueScan()"
          >
            <div class="scan-modal" (click)="$event.stopPropagation()">
              <h2 class="scan-title">{{ 'MY_SHIFT.SCANNER_TITLE' | translate }}</h2>
              <p class="scan-help">{{ 'MY_SHIFT.SCANNER_HELP' | translate }}</p>
              @if (scanError()) {
                <div class="ms-error" role="alert">{{ scanError()! | translate }}</div>
                <button type="button" class="ms-btn ms-btn-dark scan-wide" (click)="retryVenueScan()">
                  {{ 'MY_SHIFT.SCAN_RETRY' | translate }}
                </button>
              }
              <div [id]="qrReaderId" class="qr-reader-host"></div>
              <button type="button" class="ms-btn ms-btn-ghost scan-wide" (click)="closeVenueScan()">
                {{ 'COMMON.CANCEL' | translate }}
              </button>
            </div>
          </div>
        }

        <div class="ms-grid">
          <!-- ===================== the punch clock ===================== -->
          <section class="ms-clock" [class.on]="open() && !open()!.on_break" [class.brk]="open()?.on_break" [class.over]="exceedsContract()">
            @if (loading()) {
              <p class="ms-muted">{{ 'MY_SHIFT.LOADING' | translate }}</p>
            } @else {
              <div class="ms-ring">
                <svg viewBox="0 0 240 240" aria-hidden="true">
                  <defs>
                    <linearGradient id="msRingOn" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#34d399" /><stop offset="100%" stop-color="#059669" /></linearGradient>
                    <linearGradient id="msRingBrk" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fbbf24" /><stop offset="100%" stop-color="#d97706" /></linearGradient>
                    <linearGradient id="msRingOver" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fb923c" /><stop offset="100%" stop-color="#dc2626" /></linearGradient>
                  </defs>
                  <circle class="ms-ticks" cx="120" cy="120" r="112" />
                  <circle class="ms-track" cx="120" cy="120" r="96" />
                  <circle
                    class="ms-prog"
                    cx="120" cy="120" r="96"
                    [attr.stroke]="exceedsContract() ? 'url(#msRingOver)' : open()?.on_break ? 'url(#msRingBrk)' : 'url(#msRingOn)'"
                    [attr.stroke-dasharray]="ringCircumference"
                    [attr.stroke-dashoffset]="ringOffset()"
                  />
                </svg>
                <div class="ms-ring-center">
                  @if (open(); as s) {
                    <span class="ms-state">
                      <i></i>{{ (s.on_break ? 'MY_SHIFT.STATUS_BREAK' : 'MY_SHIFT.STATUS_ON') | translate }}
                    </span>
                    <div class="ms-time" aria-live="off">
                      <b>{{ clockParts().h }}:{{ clockParts().m }}</b><small>{{ clockParts().s }}</small>
                    </div>
                    <span class="ms-sub">
                      @if (s.on_break) { {{ 'MY_SHIFT.BREAK_FOR' | translate }} {{ breakLabel() }} }
                      @else { {{ 'MY_SHIFT.NET_ELAPSED' | translate }} }
                    </span>
                  } @else {
                    <span class="ms-state off"><i></i>{{ 'MY_SHIFT.STATUS_OFF' | translate }}</span>
                    <div class="ms-time faint"><b>00:00</b><small>00</small></div>
                    <span class="ms-sub">{{ 'MY_SHIFT.READY' | translate }}</span>
                  }
                </div>
              </div>

              <div class="ms-actions">
                @if (open(); as s) {
                  @if (s.on_break) {
                    <button type="button" class="ms-btn ms-btn-amber ms-btn-xl" (click)="endBreak()" [disabled]="actionLoading() || qrBlocked()">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                      {{ actionLoading() ? ('MY_SHIFT.WORKING' | translate) : ('MY_SHIFT.END_BREAK' | translate) }}
                    </button>
                  } @else {
                    <button type="button" class="ms-btn ms-btn-ghost ms-btn-xl" (click)="startBreak()" [disabled]="actionLoading() || qrBlocked()">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
                      {{ actionLoading() ? ('MY_SHIFT.WORKING' | translate) : ('MY_SHIFT.START_BREAK' | translate) }}
                    </button>
                    <button type="button" class="ms-btn ms-btn-dark ms-btn-xl" (click)="endShift()" [disabled]="actionLoading() || qrBlocked()">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                      {{ actionLoading() ? ('MY_SHIFT.WORKING' | translate) : ('MY_SHIFT.END_SHIFT' | translate) }}
                    </button>
                  }
                } @else {
                  <button type="button" class="ms-btn ms-btn-green ms-btn-xl ms-btn-wide" (click)="startShift()" [disabled]="actionLoading() || qrBlocked()">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                    {{ actionLoading() ? ('MY_SHIFT.WORKING' | translate) : ('MY_SHIFT.START_SHIFT' | translate) }}
                  </button>
                }
              </div>
            }
          </section>

          <!-- ===================== side: this shift + 30-day summary ===================== -->
          <aside class="ms-side">
            @if (open(); as s) {
              <div class="ms-info">
                <div><span>{{ 'MY_SHIFT.STARTED' | translate }}</span><b>{{ timeOnly(s.started_at) }}</b></div>
                <div><span>{{ 'MY_SHIFT.GOAL' | translate }}</span><b>{{ contractHours() }} h</b></div>
                <div><span>{{ 'MY_SHIFT.PROGRESS' | translate }}</span><b>{{ ringPercent() }}%</b></div>
              </div>
            }
            @let st = stats();
            <div class="ms-stats">
              <div><strong>{{ st.hours }}</strong><span>{{ 'MY_SHIFT.STAT_HOURS' | translate }}</span></div>
              <div><strong>{{ st.days }}</strong><span>{{ 'MY_SHIFT.STAT_DAYS' | translate }}</span></div>
              <div><strong>{{ st.avg }}</strong><span>{{ 'MY_SHIFT.STAT_AVG' | translate }}</span></div>
            </div>

            <div class="ms-bars" role="img" [attr.aria-label]="'MY_SHIFT.BARS_TITLE' | translate">
              <div class="ms-bars-head">
                <b>{{ 'MY_SHIFT.BARS_TITLE' | translate }}</b>
                <span>{{ 'MY_SHIFT.BARS_HINT' | translate }}</span>
              </div>
              <div class="ms-bars-row">
                @for (b of bars(); track b.key) {
                  <div class="ms-bar" [class.today]="b.today" [title]="b.title">
                    <i [style.height.%]="b.pct" [class.has]="b.hours > 0"></i>
                    <span>{{ b.label }}</span>
                  </div>
                }
              </div>
            </div>

            <p class="ms-audit">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" /></svg>
              {{ 'MY_SHIFT.AUDIT_HINT' | translate }}
            </p>
          </aside>
        </div>

        <section class="ms-history">
          <div class="ms-history-head">
            <h2>{{ 'MY_SHIFT.HISTORY_TITLE' | translate }}</h2>
          </div>
          @if (history().length === 0) {
            <div class="ms-empty">
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              <p>{{ 'MY_SHIFT.NO_HISTORY' | translate }}</p>
            </div>
          } @else {
            <ul class="ms-list">
              @for (row of visibleHistory(); track row.id) {
                <li [class.open]="!row.ended_at">
                  <div class="ms-date">
                    <small>{{ dayChip(row).wd }}</small>
                    <b>{{ dayChip(row).d }}</b>
                  </div>
                  <div class="ms-range">
                    <span>{{ timeOnly(row.started_at) }}</span>
                    <i aria-hidden="true">→</i>
                    <span>{{ row.ended_at ? timeOnly(row.ended_at) : ('MY_SHIFT.IN_PROGRESS' | translate) }}</span>
                  </div>
                  <span class="ms-dur">{{ formatDuration(row) }}</span>
                </li>
              }
            </ul>
            @if (history().length > 8) {
              <button type="button" class="ms-more" (click)="showAllHistory.set(!showAllHistory())">
                {{ (showAllHistory() ? 'MY_SHIFT.SHOW_LESS' : 'MY_SHIFT.SHOW_MORE') | translate }}
              </button>
            }
          }
        </section>
      </div>
      }
    </app-sidebar>
  `,
  styles: `
    .ms-page { max-width: 1020px; display: flex; flex-direction: column; gap: 18px; }
    .ms-muted { color: var(--color-text-muted); margin: 0; }

    /* ---------- greeting ---------- */
    .ms-hero { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; }
    .ms-hero h1 { margin: 6px 0 2px; font-size: 2rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; }
    .ms-hero p { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 1.05rem; color: var(--color-text-muted); }
    .ms-eyebrow { display: inline-flex; align-items: center; gap: 10px; font-size: 0.68rem; font-weight: 800; letter-spacing: 0.22em; text-transform: uppercase; color: var(--color-primary); }
    .ms-eyebrow::before { content: ''; width: 26px; height: 2px; background: var(--color-primary); }
    .ms-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .ms-chip { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 999px; background: var(--color-surface); border: 1px solid var(--color-border); font-size: 0.78rem; font-weight: 800; color: var(--color-text-muted); }
    .ms-chip.ok { background: #d1fae5; border-color: #6ee7b7; color: #047857; }

    /* ---------- venue QR prompt ---------- */
    .ms-scan { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; padding: 18px 22px; border-radius: 24px; background: linear-gradient(135deg, #fffbeb, var(--color-surface)); border: 1px solid #fcd34d; }
    .ms-scan > div { flex: 1; min-width: 220px; }
    .ms-scan b { font-size: 1.05rem; }
    .ms-scan p { margin: 2px 0 0; font-size: 0.85rem; color: var(--color-text-muted); }
    .ms-scan-ico { display: grid; place-items: center; width: 54px; height: 54px; border-radius: 18px; color: #fff; background: linear-gradient(145deg, #f59e0b, #b45309); box-shadow: 0 12px 20px -12px #d97706; }

    .ms-overtime { display: flex; gap: 14px; align-items: flex-start; padding: 16px 20px; border-radius: 22px; background: linear-gradient(135deg, #fff7ed, var(--color-surface)); border: 1px solid #fdba74; color: #9a3412; }
    .ms-overtime strong { display: block; font-weight: 800; }
    .ms-overtime p { margin: 2px 0 0; font-size: 0.86rem; line-height: 1.45; color: var(--color-text); }
    .ms-error { padding: 12px 18px; border-radius: 16px; background: #fee2e2; color: #991b1b; font-weight: 700; }

    /* ---------- layout ---------- */
    .ms-grid { display: grid; grid-template-columns: minmax(300px, 400px) 1fr; gap: 18px; align-items: stretch; }
    @media (max-width: 860px) { .ms-grid { grid-template-columns: minmax(0, 1fr); } }

    /* ---------- the clock ---------- */
    .ms-clock {
      --c1: #94a3b8; --c2: #64748b;
      display: flex; flex-direction: column; align-items: center; gap: 22px;
      padding: 28px 24px 26px; border-radius: 32px;
      background: radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--c1) 14%, var(--color-surface)), var(--color-surface) 70%);
      border: 1px solid color-mix(in srgb, var(--c1) 35%, var(--color-border));
      box-shadow: 0 30px 50px -36px var(--c2);
      transition: background .3s, border-color .3s;
    }
    .ms-clock.on { --c1: #10b981; --c2: #047857; }
    .ms-clock.brk { --c1: #f59e0b; --c2: #b45309; }
    .ms-clock.over { --c1: #f97316; --c2: #b91c1c; }

    .ms-ring { position: relative; width: min(100%, 280px); aspect-ratio: 1; }
    .ms-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .ms-ticks { fill: none; stroke: color-mix(in srgb, var(--c1) 45%, var(--color-border)); stroke-width: 6; stroke-dasharray: 1.2 10.2; }
    .ms-track { fill: none; stroke: color-mix(in srgb, var(--c1) 14%, var(--color-bg)); stroke-width: 14; }
    .ms-prog { fill: none; stroke-width: 14; stroke-linecap: round; transition: stroke-dashoffset .9s ease, stroke .3s; filter: drop-shadow(0 6px 8px color-mix(in srgb, var(--c2) 40%, transparent)); }
    .ms-ring-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; text-align: center; }
    .ms-state { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px; border-radius: 999px; background: color-mix(in srgb, var(--c1) 16%, transparent); color: var(--c2); font-size: 0.7rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
    .ms-state i { width: 8px; height: 8px; border-radius: 50%; background: var(--c1); animation: ms-pulse 1.8s ease-in-out infinite; }
    .ms-state.off i { animation: none; background: #94a3b8; }
    .ms-state.off { color: var(--color-text-muted); background: var(--color-bg); }
    @keyframes ms-pulse { 50% { transform: scale(1.7); opacity: .45; } }
    .ms-time { display: flex; align-items: baseline; gap: 4px; font-family: Georgia, 'Times New Roman', serif; font-variant-numeric: tabular-nums; color: var(--color-text); }
    .ms-time b { font-size: 3.1rem; font-weight: 500; letter-spacing: -0.03em; line-height: 1; }
    .ms-time small { font-size: 1.25rem; color: var(--c2); }
    .ms-time.faint { opacity: .3; }
    .ms-sub { font-size: 0.78rem; font-weight: 700; color: var(--color-text-muted); }

    .ms-actions { display: flex; flex-wrap: wrap; gap: 10px; width: 100%; }
    .ms-actions .ms-btn { flex: 1; }

    .ms-btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 46px; padding: 0 22px; border-radius: 999px; border: 1px solid transparent; font: inherit; font-weight: 800; cursor: pointer; touch-action: manipulation; transition: transform .15s, filter .15s, background .15s, color .15s; }
    .ms-btn:disabled { opacity: .55; cursor: not-allowed; }
    .ms-btn:hover:not(:disabled) { transform: translateY(-1px); }
    .ms-btn-xl { min-height: 58px; font-size: 1rem; }
    .ms-btn-wide { width: 100%; }
    .ms-btn-green { color: #fff; background: linear-gradient(135deg, #10b981, #047857); box-shadow: 0 16px 26px -14px #059669; }
    .ms-btn-amber { color: #fff; background: linear-gradient(135deg, #f59e0b, #b45309); box-shadow: 0 16px 26px -14px #d97706; }
    .ms-btn-dark { color: #fff; background: #1c1917; box-shadow: 0 16px 26px -16px rgba(0,0,0,.7); }
    .ms-btn-dark:hover:not(:disabled) { background: #b91c1c; }
    .ms-btn-ghost { color: var(--color-text); background: var(--color-surface); border-color: var(--color-border); }
    .ms-btn-ghost:hover:not(:disabled) { border-color: #d97706; color: #b45309; }
    @media (prefers-reduced-motion: reduce) { .ms-prog, .ms-btn { transition: none; } .ms-state i { animation: none; } }

    /* ---------- side column ---------- */
    .ms-side { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
    .ms-info { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .ms-info div { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; border-radius: 20px; background: var(--color-surface); border: 1px solid var(--color-border); }
    .ms-info span, .ms-stats span { font-size: 0.66rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-text-muted); }
    .ms-info b { font-family: Georgia, 'Times New Roman', serif; font-size: 1.5rem; font-weight: 500; font-variant-numeric: tabular-nums; }

    .ms-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .ms-stats div { display: flex; flex-direction: column; gap: 4px; padding: 16px 18px; border-radius: 22px; color: #fff; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 62%, #000)); box-shadow: 0 18px 28px -22px var(--color-primary); }
    .ms-stats div:nth-child(2) { background: linear-gradient(135deg, #0e7490, #164e63); box-shadow: 0 18px 28px -22px #0e7490; }
    .ms-stats div:nth-child(3) { background: linear-gradient(135deg, #7c3aed, #4c1d95); box-shadow: 0 18px 28px -22px #7c3aed; }
    .ms-stats strong { font-family: Georgia, 'Times New Roman', serif; font-size: 1.9rem; font-weight: 500; line-height: 1; font-variant-numeric: tabular-nums; }
    .ms-stats span { color: rgba(255,255,255,.8); }

    .ms-bars { flex: 1; padding: 18px 20px; border-radius: 24px; background: var(--color-surface); border: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 14px; min-height: 170px; }
    .ms-bars-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .ms-bars-head b { font-weight: 800; }
    .ms-bars-head span { font-size: 0.74rem; color: var(--color-text-muted); font-weight: 600; }
    .ms-bars-row { flex: 1; display: grid; grid-template-columns: repeat(14, minmax(0, 1fr)); gap: 6px; align-items: end; }
    .ms-bar { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 6px; height: 100%; min-height: 110px; }
    .ms-bar i { display: block; width: 100%; max-width: 22px; min-height: 4px; border-radius: 8px 8px 4px 4px; background: var(--color-bg); box-shadow: inset 0 0 0 1px var(--color-border); transition: height .5s ease; }
    .ms-bar i.has { background: linear-gradient(180deg, color-mix(in srgb, var(--color-primary) 60%, #fbbf24), var(--color-primary)); box-shadow: 0 8px 12px -8px var(--color-primary); }
    .ms-bar span { font-size: 0.66rem; font-weight: 800; color: var(--color-text-muted); }
    .ms-bar.today span { color: var(--color-primary); }
    .ms-bar.today i { outline: 2px solid color-mix(in srgb, var(--color-primary) 40%, transparent); outline-offset: 2px; }

    .ms-audit { display: flex; gap: 8px; margin: 0; font-size: 0.76rem; line-height: 1.45; color: var(--color-text-muted); }
    .ms-audit svg { flex: none; margin-top: 2px; }

    /* ---------- history ---------- */
    .ms-history { padding: 22px 24px; border-radius: 28px; background: var(--color-surface); border: 1px solid var(--color-border); }
    .ms-history h2 { margin: 0 0 14px; font-size: 1.2rem; font-weight: 800; }
    .ms-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 24px; border-radius: 20px; border: 2px dashed var(--color-border); color: var(--color-text-muted); }
    .ms-empty p { margin: 0; font-weight: 700; }
    .ms-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .ms-list li { display: grid; grid-template-columns: 64px 1fr auto; align-items: center; gap: 16px; padding: 10px 16px 10px 10px; border-radius: 20px; background: var(--color-bg); border: 1px solid transparent; transition: border-color .15s, background .15s; }
    .ms-list li:hover { border-color: var(--color-primary); background: var(--color-surface); }
    .ms-list li.open { background: #ecfdf5; border-color: #6ee7b7; }
    .ms-date { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 64px; height: 58px; border-radius: 16px; background: var(--color-surface); box-shadow: inset 0 0 0 1px var(--color-border); }
    .ms-date small { font-size: 0.64rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-primary); }
    .ms-date b { font-family: Georgia, 'Times New Roman', serif; font-size: 1.5rem; font-weight: 500; line-height: 1; }
    .ms-range { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .ms-range i { font-style: normal; color: var(--color-primary); }
    .ms-dur { padding: 6px 16px; border-radius: 999px; background: #1c1917; color: #fff; font-size: 0.85rem; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .ms-list li.open .ms-dur { background: #059669; }
    .ms-more { display: block; margin: 14px auto 0; min-height: 40px; padding: 0 22px; border-radius: 999px; border: 1px dashed var(--color-border); background: transparent; color: var(--color-text); font: inherit; font-weight: 800; cursor: pointer; }
    .ms-more:hover { border-color: var(--color-primary); color: var(--color-primary); }

    /* ---------- QR scanner modal ---------- */
    .scan-backdrop { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,.55); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 1rem; box-sizing: border-box; }
    .scan-modal { background: var(--color-surface, #fff); border-radius: 28px; padding: 1.5rem; max-width: 420px; width: 100%; max-height: min(90vh, 680px); overflow: auto; box-shadow: 0 40px 80px -24px rgba(0,0,0,.55); }
    .scan-title { margin: 0 0 .4rem; font-size: 1.25rem; font-weight: 800; }
    .scan-help { margin: 0 0 .9rem; font-size: .88rem; color: var(--color-text-muted); }
    .qr-reader-host { min-height: 220px; margin-bottom: 1rem; border-radius: 18px; overflow: hidden; }
    .scan-wide { width: 100%; margin-bottom: .6rem; }

    @media (max-width: 560px) {
      .ms-hero h1 { font-size: 1.6rem; }
      .ms-info, .ms-stats { grid-template-columns: 1fr 1fr 1fr; }
      .ms-time b { font-size: 2.6rem; }
      .ms-list li { grid-template-columns: 56px 1fr; }
      .ms-list .ms-dur { grid-column: 2; justify-self: start; }
      .ms-history { padding: 18px 14px; }
    }
  `,
})
export class MyShiftComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private injector = inject(Injector);
  private permissions = inject(PermissionService);

  /** Owner/admin: supervise employee shifts instead of clocking their own. */
  isSupervisor = computed(() => this.permissions.isAdmin(this.api.getCurrentUser()));

  /** Host element id for html5-qrcode (template binding). */
  readonly qrReaderId = MY_SHIFT_QR_READER_ID;

  loading = signal(true);
  actionLoading = signal(false);
  error = signal<string | null>(null);
  open = signal<WorkSession | null>(null);
  history = signal<WorkSession[]>([]);
  clockStatus = signal<ClockQrStatus | null>(null);
  /** From ?clock_qr=, scan, or sessionStorage */
  clockQrToken = signal<string | null>(null);

  scanOpen = signal(false);
  scanError = signal<string | null>(null);
  scanStarting = signal(false);

  private overtimeTick = signal(0);
  private overtimeTimer: ReturnType<typeof setInterval> | null = null;
  private querySub: { unsubscribe: () => void } | null = null;
  private html5Qr: Html5Qrcode | null = null;
  private scanDecodeHandled = false;

  exceedsContract = computed(() => {
    this.overtimeTick();
    return workSessionOpenExceedsContract(this.open());
  });

  contractHours = computed(() => {
    const m = this.open()?.contract_threshold_minutes ?? 480;
    return Math.round(m / 60);
  });

  qrBlocked = computed(() => {
    const st = this.clockStatus();
    if (!st?.clock_qr_required) return false;
    const u = this.api.getCurrentUser();
    const tid = u?.tenant_id;
    const fromUrl = this.clockQrToken();
    const stored = tid != null ? sessionStorage.getItem(`clock_qr_${tid}`) : null;
    const token = (fromUrl || stored || '').trim();
    return !token;
  });

  openElapsedLabel = computed(() => {
    this.overtimeTick();
    const s = this.open();
    if (!s || s.ended_at) return '';
    const sec = workSessionNetWorkSeconds(s);
    const mins = Math.max(0, Math.floor(sec / 60));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  });

  // ---------------------------------------------------------------- punch-clock display
  readonly ringCircumference = 2 * Math.PI * 96;
  showAllHistory = signal(false);

  firstName = computed(() => {
    const u = this.api.getCurrentUser();
    return ((u?.full_name || u?.username || '').trim().split(/\s+/)[0] || '').replace(/@.*/, '');
  });

  greetKey = computed(() => {
    this.overtimeTick();
    const h = new Date().getHours();
    return h < 12 ? 'MY_SHIFT.GREET_MORNING' : h < 19 ? 'MY_SHIFT.GREET_AFTERNOON' : 'MY_SHIFT.GREET_EVENING';
  });

  todayLabel = computed(() => {
    const s = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  });

  private netSeconds = computed(() => {
    this.overtimeTick();
    const s = this.open();
    return s && !s.ended_at ? Math.floor(workSessionNetWorkSeconds(s)) : 0;
  });

  clockParts = computed(() => {
    const sec = this.netSeconds();
    const p = (n: number) => String(n).padStart(2, '0');
    return { h: p(Math.floor(sec / 3600)), m: p(Math.floor((sec % 3600) / 60)), s: p(sec % 60) };
  });

  private ringFraction = computed(() => {
    const goal = (this.open()?.contract_threshold_minutes ?? 480) * 60;
    return Math.min(1, this.netSeconds() / goal);
  });

  ringOffset = computed(() => this.ringCircumference * (1 - this.ringFraction()));
  ringPercent = computed(() => {
    const goal = (this.open()?.contract_threshold_minutes ?? 480) * 60;
    return Math.round((this.netSeconds() / goal) * 100);
  });

  breakLabel = computed(() => {
    this.overtimeTick();
    const b = this.open()?.break_started_at;
    if (!b) return '0:00';
    const sec = Math.max(0, Math.floor((Date.now() - new Date(b).getTime()) / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  });

  private fmtHours(min: number): string {
    return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  }

  /** Totals of the last 30 days (closed sessions only). */
  stats = computed(() => {
    const rows = this.history().filter((r) => r.ended_at && r.duration_minutes != null);
    const mins = rows.reduce((s, r) => s + (r.duration_minutes ?? 0), 0);
    const days = new Set(rows.map((r) => new Date(r.started_at).toDateString())).size;
    return { hours: this.fmtHours(mins), days, avg: days ? this.fmtHours(Math.round(mins / days)) : '—' };
  });

  /** Hours worked on each of the last 14 days. */
  bars = computed(() => {
    const per = new Map<string, number>();
    for (const r of this.history()) {
      if (r.duration_minutes == null) continue;
      const k = new Date(r.started_at).toDateString();
      per.set(k, (per.get(k) ?? 0) + r.duration_minutes);
    }
    const out: { key: string; label: string; hours: number; pct: number; today: boolean; title: string }[] = [];
    const today = new Date();
    let max = 8 * 60;
    for (const v of per.values()) max = Math.max(max, v);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const mins = per.get(d.toDateString()) ?? 0;
      out.push({
        key: d.toDateString(),
        label: d.toLocaleDateString(undefined, { weekday: 'narrow' }).toUpperCase(),
        hours: mins,
        pct: mins ? Math.max(8, (mins / max) * 100) : 0,
        today: i === 0,
        title: `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${this.fmtHours(mins)}`,
      });
    }
    return out;
  });

  visibleHistory = computed(() => (this.showAllHistory() ? this.history() : this.history().slice(0, 8)));

  dayChip(row: WorkSession): { wd: string; d: number } {
    const d = new Date(row.started_at);
    return { wd: d.toLocaleDateString(undefined, { weekday: 'short' }).replace('.', ''), d: d.getDate() };
  }

  timeOnly(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  ngOnInit(): void {
    if (this.isSupervisor()) {
      this.loading.set(false);
      return;
    }
    this.querySub = this.route.queryParamMap.subscribe((q) => {
      const t = q.get('clock_qr');
      if (t?.trim()) {
        this.persistClockQrToken(t.trim());
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { clock_qr: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });
    this.refreshAll();
    this.overtimeTimer = setInterval(() => this.overtimeTick.update((n) => n + 1), 1000);
  }

  ngOnDestroy(): void {
    this.querySub?.unsubscribe();
    if (this.overtimeTimer != null) {
      clearInterval(this.overtimeTimer);
      this.overtimeTimer = null;
    }
    void this.stopVenueScanner();
  }

  openVenueScan(): void {
    this.scanError.set(null);
    this.scanStarting.set(true);
    this.scanOpen.set(true);
    afterNextRender(
      () => {
        void this.startVenueScanner();
      },
      { injector: this.injector }
    );
  }

  closeVenueScan(): void {
    void this.stopVenueScanner();
    this.scanOpen.set(false);
    this.scanStarting.set(false);
    this.scanError.set(null);
    this.scanDecodeHandled = false;
  }

  retryVenueScan(): void {
    this.scanError.set(null);
    this.scanDecodeHandled = false;
    this.scanStarting.set(true);
    void this.startVenueScanner();
  }

  private async startVenueScanner(): Promise<void> {
    this.scanDecodeHandled = false;
    try {
      await this.stopVenueScanner();
      const inst = new Html5Qrcode(MY_SHIFT_QR_READER_ID);
      this.html5Qr = inst;
      await inst.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (text) => this.onVenueQrDecoded(text),
        () => {}
      );
    } catch {
      this.scanError.set('MY_SHIFT.SCANNER_CAMERA_ERROR');
      this.html5Qr = null;
    } finally {
      this.scanStarting.set(false);
    }
  }

  private async stopVenueScanner(): Promise<void> {
    const inst = this.html5Qr;
    this.html5Qr = null;
    if (!inst) return;
    try {
      await inst.stop();
    } catch {
      /* not running */
    }
    try {
      await inst.clear();
    } catch {
      /* ignore */
    }
  }

  private onVenueQrDecoded(text: string): void {
    if (this.scanDecodeHandled) return;
    const token = this.extractClockQrFromScan(text);
    if (!token) {
      this.scanDecodeHandled = true;
      void this.stopVenueScanner();
      this.scanError.set('MY_SHIFT.SCAN_INVALID');
      return;
    }
    this.scanDecodeHandled = true;
    this.persistClockQrToken(token);
    void this.stopVenueScanner();
    this.scanOpen.set(false);
    this.scanError.set(null);
  }

  /**
   * Accepts full URLs with ?clock_qr=, relative paths, or the raw 64-char hex token.
   */
  private extractClockQrFromScan(raw: string): string | null {
    const s = raw.trim();
    if (!s) return null;
    if (/^[a-fA-F0-9]{64}$/.test(s)) return s.toLowerCase();
    let u: URL | null = null;
    try {
      u = new URL(s);
    } catch {
      try {
        u = new URL(s, window.location.origin);
      } catch {
        u = null;
      }
    }
    if (u) {
      const q = u.searchParams.get('clock_qr');
      if (q?.trim()) return this.normalizeClockQrToken(q.trim());
    }
    const m = s.match(/[?&]clock_qr=([^&\s#]+)/i);
    if (m?.[1]) {
      try {
        const decoded = decodeURIComponent(m[1]).trim();
        return decoded ? this.normalizeClockQrToken(decoded) : null;
      } catch {
        return m[1].trim() ? this.normalizeClockQrToken(m[1].trim()) : null;
      }
    }
    return null;
  }

  private normalizeClockQrToken(t: string): string {
    if (/^[a-fA-F0-9]{64}$/.test(t)) return t.toLowerCase();
    return t;
  }

  private persistClockQrToken(token: string): void {
    const trimmed = token.trim();
    if (!trimmed) return;
    const normalized = this.normalizeClockQrToken(trimmed);
    this.clockQrToken.set(normalized);
    const u = this.api.getCurrentUser();
    const tid = u?.tenant_id;
    if (tid != null) {
      sessionStorage.setItem(`clock_qr_${tid}`, normalized);
    }
  }

  private rangeLastDays(n: number): { from: string; to: string } {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - n);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }

  private effectiveClockQr(): string | undefined {
    const u = this.api.getCurrentUser();
    const tid = u?.tenant_id;
    const t =
      (this.clockQrToken() || (tid != null ? sessionStorage.getItem(`clock_qr_${tid}`) : null) || '').trim();
    return t || undefined;
  }

  private buildClockPayload(): Observable<WorkSessionClockPayload> {
    const st = this.clockStatus();
    const payload: WorkSessionClockPayload = {};
    const q = this.effectiveClockQr();
    if (q) payload.clock_qr = q;
    if (st?.clock_qr_location_verify) {
      return from(
        new Promise<WorkSessionClockPayload>((resolve, reject) => {
          if (!('geolocation' in navigator)) {
            reject(new Error('no geolocation'));
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              resolve({
                ...payload,
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              });
            },
            () => reject(new Error('geo denied')),
            { timeout: 15000, maximumAge: 120000 }
          );
        })
      ).pipe(
        catchError(() => {
          this.error.set(
            'Location is required for clock actions at this venue. Allow access in your browser and try again.'
          );
          return EMPTY;
        })
      );
    }
    return of(payload);
  }

  refreshAll(): void {
    this.loading.set(true);
    this.error.set(null);
    const { from, to } = this.rangeLastDays(30);
    forkJoin({
      open: this.api.getMyOpenWorkSession(),
      history: this.api.getMyWorkSessions(from, to),
      qr: this.api.getMyClockQrStatus(),
    }).subscribe({
      next: ({ open, history, qr }) => {
        this.open.set(open);
        this.history.set(history);
        this.clockStatus.set(qr);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Could not load shift data');
      },
    });
  }

  startShift(): void {
    this.actionLoading.set(true);
    this.error.set(null);
    this.buildClockPayload()
      .pipe(
        switchMap((payload) => this.api.startMyWorkSession(payload)),
        finalize(() => this.actionLoading.set(false))
      )
      .subscribe({
        next: (s) => {
          this.open.set(s);
          this.refreshHistoryOnly();
        },
        error: (err) => {
          this.error.set(err?.error?.detail || 'Could not start shift');
        },
      });
  }

  endShift(): void {
    this.actionLoading.set(true);
    this.error.set(null);
    this.buildClockPayload()
      .pipe(
        switchMap((payload) => this.api.endMyWorkSession(payload)),
        finalize(() => this.actionLoading.set(false))
      )
      .subscribe({
        next: () => {
          this.open.set(null);
          this.refreshHistoryOnly();
        },
        error: (err) => {
          this.error.set(err?.error?.detail || 'Could not end shift');
        },
      });
  }

  startBreak(): void {
    this.actionLoading.set(true);
    this.error.set(null);
    this.api.startMyWorkSessionBreak().subscribe({
      next: (s) => {
        this.open.set(s);
        this.actionLoading.set(false);
        this.refreshHistoryOnly();
      },
      error: (err) => {
        this.actionLoading.set(false);
        this.error.set(err?.error?.detail || 'Could not start break');
      },
    });
  }

  endBreak(): void {
    this.actionLoading.set(true);
    this.error.set(null);
    this.buildClockPayload()
      .pipe(
        switchMap((payload) => this.api.endMyWorkSessionBreak(payload)),
        finalize(() => this.actionLoading.set(false))
      )
      .subscribe({
        next: (s) => {
          this.open.set(s);
          this.refreshHistoryOnly();
        },
        error: (err) => {
          const d = err?.error?.detail;
          this.error.set(
            typeof d === 'string' && d.toLowerCase().includes('qr')
              ? 'Scan the venue QR code (or use the staff link with the token) to end your break.'
              : d || 'Could not end break'
          );
        },
      });
  }

  private refreshHistoryOnly(): void {
    const { from, to } = this.rangeLastDays(30);
    this.api.getMyWorkSessions(from, to).subscribe({
      next: (rows) => this.history.set(rows),
      error: () => {},
    });
  }

  formatDt(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  formatDuration(row: WorkSession): string {
    if (row.duration_minutes != null && row.duration_minutes >= 0) {
      const h = Math.floor(row.duration_minutes / 60);
      const m = row.duration_minutes % 60;
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    }
    if (!row.ended_at) return '…';
    return '—';
  }
}
