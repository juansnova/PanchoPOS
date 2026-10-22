import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import { ApiService, StaffActivity, WorkSession, workSessionNetWorkSeconds } from '../services/api.service';
import { AppDatePickerComponent } from '../shared/app-date-picker.component';

/** Local calendar day as YYYY-MM-DD (never UTC, so "today" is the restaurant's today). */
function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

@Component({
  selector: 'app-shift-supervision',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, AppDatePickerComponent],
  template: `
    <div class="sv-page" data-testid="shift-supervision-page">
      <header class="sv-hero">
        <div>
          <span class="sv-eyebrow">{{ 'SHIFT_SUPERVISION.EYEBROW' | translate }}</span>
          <h1>{{ 'SHIFT_SUPERVISION.TITLE' | translate }}</h1>
          <p>{{ 'SHIFT_SUPERVISION.SUBTITLE' | translate }}</p>
        </div>
        <div class="sv-now">
          <div><strong>{{ working() }}</strong><span>{{ 'SHIFT_SUPERVISION.WORKING' | translate }}</span></div>
          <div class="amber"><strong>{{ onBreak() }}</strong><span>{{ 'SHIFT_SUPERVISION.ON_BREAK' | translate }}</span></div>
        </div>
      </header>

      @if (error()) {
        <div class="sv-error">{{ error() }}</div>
      }

      <!-- ===================== live ===================== -->
      <section class="sv-card sv-live">
        <div class="sv-card-head">
          <span class="sv-badge"><i class="sv-dot"></i>{{ 'SHIFT_SUPERVISION.LIVE_BADGE' | translate }}</span>
          <h2>{{ 'SHIFT_SUPERVISION.LIVE_TITLE' | translate }}</h2>
        </div>
        @if (loadingLive()) {
          <div class="sv-skeleton"><i></i><i></i><i></i></div>
        } @else if (live().length === 0) {
          <div class="sv-empty">
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5" /></svg>
            <p>{{ 'SHIFT_SUPERVISION.LIVE_EMPTY' | translate }}</p>
          </div>
        } @else {
          <div class="sv-live-grid">
            @for (row of live(); track row.id) {
              <article class="sv-person" [class.brk]="row.on_break">
                <span class="sv-avatar" [style.--h]="hueOf(row.user_name)">{{ initialsOf(row.user_name) }}</span>
                <div class="sv-person-main">
                  <b>{{ row.user_name }}</b>
                  <div class="sv-person-tags">
                    @if (row.user_role) { <span class="sv-role">{{ roleLabel(row.user_role) }}</span> }
                    <span class="sv-state" [class.brk]="row.on_break">
                      {{ (row.on_break ? 'SHIFT_SUPERVISION.ON_BREAK' : 'SHIFT_SUPERVISION.WORKING') | translate }}
                    </span>
                  </div>
                  <small>{{ 'SHIFT_SUPERVISION.SINCE' | translate }} {{ timeOnly(row.started_at) }}</small>
                </div>
                <strong class="sv-elapsed">{{ elapsed(row) }}</strong>
              </article>
            }
          </div>
        }
      </section>

      <!-- ===================== range ===================== -->
      <section class="sv-card sv-range">
        <div class="sv-range-top">
          <div>
            <p class="sv-range-eyebrow"><i></i>{{ 'SHIFT_SUPERVISION.RANGE_EYEBROW' | translate }}</p>
            <h2>{{ 'SHIFT_SUPERVISION.RANGE_TITLE' | translate }}</h2>
            <p class="sv-muted">{{ 'SHIFT_SUPERVISION.RANGE_HINT' | translate }}</p>
          </div>
          <div class="sv-presets" role="group">
            @for (p of presets; track p.days) {
              <button type="button" [class.on]="activeDays() === p.days" (click)="setRange(p.days)" [disabled]="loadingRange()">{{ p.label | translate }}</button>
            }
          </div>
        </div>

        <div class="sv-leaves">
          <div class="sv-leaf">
            <span class="sv-leaf-head"><i></i><i></i>{{ 'SHIFT_SUPERVISION.FROM' | translate }}</span>
            <div class="sv-leaf-body">
              <app-date-picker [compact]="true" [clearable]="false" [(ngModel)]="fromDate" />
            </div>
          </div>

          <div class="sv-stamp" aria-hidden="true">
            <b>{{ rangeDays() }}</b>
            <small>{{ 'SHIFT_SUPERVISION.RANGE_DAYS' | translate }}</small>
          </div>

          <div class="sv-leaf">
            <span class="sv-leaf-head"><i></i><i></i>{{ 'SHIFT_SUPERVISION.TO' | translate }}</span>
            <div class="sv-leaf-body">
              <app-date-picker [compact]="true" [clearable]="false" [min]="fromDate" [(ngModel)]="toDate" />
            </div>
          </div>
        </div>

        <button type="button" class="sv-go" (click)="loadRange()" [disabled]="loadingRange()">
          {{ loadingRange() ? ('SHIFT_SUPERVISION.LOADING' | translate) : ('SHIFT_SUPERVISION.APPLY' | translate) }}<i aria-hidden="true">→</i>
        </button>
      </section>

      <!-- ===================== activity ===================== -->
      <section class="sv-block">
        <div class="sv-block-head">
          <h2>{{ 'SHIFT_SUPERVISION.ACTIVITY_TITLE' | translate }}</h2>
          <p class="sv-muted">{{ 'SHIFT_SUPERVISION.ACTIVITY_HINT' | translate }}</p>
        </div>
        @if (loadingRange()) {
          <div class="sv-skeleton"><i></i><i></i></div>
        } @else if (activity().length === 0) {
          <div class="sv-empty"><p>{{ 'SHIFT_SUPERVISION.ACTIVITY_EMPTY' | translate }}</p></div>
        } @else {
          @let tt = totals();
          <div class="sv-totals">
            <div><strong>{{ tt.hours }}</strong><span>{{ 'SHIFT_SUPERVISION.COL_HOURS' | translate }}</span></div>
            <div><strong>{{ tt.shifts }}</strong><span>{{ 'SHIFT_SUPERVISION.COL_SHIFTS' | translate }}</span></div>
            <div><strong>{{ tt.prepared }}</strong><span>{{ 'SHIFT_SUPERVISION.COL_PREPARED' | translate }}</span></div>
            <div><strong>{{ tt.paid }}</strong><span>{{ 'SHIFT_SUPERVISION.COL_ORDERS_PAID' | translate }}</span></div>
          </div>
          <div class="sv-people">
            @for (a of activity(); track a.user_id) {
              <article class="sv-act">
                <div class="sv-act-top">
                  <span class="sv-avatar" [style.--h]="hueOf(a.user_name)">{{ initialsOf(a.user_name) }}</span>
                  <div class="sv-act-name">
                    <b>{{ a.user_name }}</b>
                    <div class="sv-person-tags">
                      @if (a.user_role) { <span class="sv-role">{{ roleLabel(a.user_role) }}</span> }
                      @if (a.user_id === topHours()) { <span class="sv-star">★ {{ 'SHIFT_SUPERVISION.TOP_HOURS' | translate }}</span> }
                      @if (a.user_id === topPaid()) { <span class="sv-star">★ {{ 'SHIFT_SUPERVISION.TOP_PAID' | translate }}</span> }
                    </div>
                  </div>
                  <div class="sv-act-hours">
                    <strong>{{ formatHours(a.worked_minutes) }}</strong>
                    <span>{{ a.shifts_count }} {{ 'SHIFT_SUPERVISION.COL_SHIFTS' | translate }}</span>
                  </div>
                </div>
                <div class="sv-bar" aria-hidden="true"><i [style.width.%]="hoursPct(a)"></i></div>
                <div class="sv-act-stats">
                  <div><strong>{{ a.items_prepared }}</strong><span>{{ 'SHIFT_SUPERVISION.COL_PREPARED' | translate }}</span></div>
                  <div><strong>{{ a.items_delivered }}</strong><span>{{ 'SHIFT_SUPERVISION.COL_DELIVERED' | translate }}</span></div>
                  <div [class.warn]="a.items_removed > 0"><strong>{{ a.items_removed }}</strong><span>{{ 'SHIFT_SUPERVISION.COL_REMOVED' | translate }}</span></div>
                  <div><strong>{{ a.orders_paid }}</strong><span>{{ 'SHIFT_SUPERVISION.COL_ORDERS_PAID' | translate }}</span></div>
                </div>
              </article>
            }
          </div>
        }
      </section>

      <!-- ===================== history ===================== -->
      <section class="sv-block">
        <div class="sv-block-head">
          <h2>{{ 'SHIFT_SUPERVISION.HISTORY_TITLE' | translate }}</h2>
        </div>
        @if (loadingRange()) {
          <div class="sv-skeleton"><i></i><i></i><i></i></div>
        } @else if (history().length === 0) {
          <div class="sv-empty"><p>{{ 'SHIFT_SUPERVISION.HISTORY_EMPTY' | translate }}</p></div>
        } @else {
          <div class="sv-rows">
            <div class="sv-row sv-row-head">
              <span>{{ 'SHIFT_SUPERVISION.COL_EMPLOYEE' | translate }}</span>
              <span>{{ 'SHIFT_SUPERVISION.COL_DAY' | translate }}</span>
              <span>{{ 'SHIFT_SUPERVISION.COL_START' | translate }}</span>
              <span>{{ 'SHIFT_SUPERVISION.COL_END' | translate }}</span>
              <span>{{ 'SHIFT_SUPERVISION.COL_DURATION' | translate }}</span>
            </div>
            @for (row of visibleHistory(); track row.id) {
              <div class="sv-row" [class.open]="!row.ended_at">
                <div class="sv-who">
                  <span class="sv-avatar sm" [style.--h]="hueOf(row.user_name)">{{ initialsOf(row.user_name) }}</span>
                  <b>{{ row.user_name }}</b>
                </div>
                <span class="sv-day">{{ dayLabel(row.started_at) }}</span>
                <span class="sv-t">{{ timeOnly(row.started_at) }}</span>
                <span class="sv-t">
                  @if (row.ended_at) { {{ timeOnly(row.ended_at) }} } @else { <em class="sv-open">{{ 'SHIFT_SUPERVISION.WORKING' | translate }}</em> }
                </span>
                <span class="sv-dur">{{ formatDuration(row) }}</span>
              </div>
            }
          </div>
          @if (history().length > 12) {
            <button type="button" class="sv-more" (click)="showAll.set(!showAll())">
              {{ (showAll() ? 'SHIFT_SUPERVISION.SHOW_LESS' : 'SHIFT_SUPERVISION.SHOW_ALL') | translate: { n: history().length } }}
            </button>
          }
        }
      </section>
    </div>
  `,
  styles: `
    .sv-page { max-width: 1020px; display: flex; flex-direction: column; gap: 18px; }
    .sv-muted { margin: 2px 0 0; font-size: 0.86rem; color: var(--color-text-muted); }

    /* ---- hero ---- */
    .sv-hero { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px; }
    .sv-hero h1 { margin: 6px 0 2px; font-size: 2rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; }
    .sv-hero p { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-style: italic; color: var(--color-text-muted); max-width: 48ch; }
    .sv-eyebrow { display: inline-flex; align-items: center; gap: 10px; font-size: 0.68rem; font-weight: 800; letter-spacing: 0.22em; text-transform: uppercase; color: var(--color-primary); }
    .sv-eyebrow::before { content: ''; width: 26px; height: 2px; background: var(--color-primary); }
    .sv-now { display: flex; gap: 26px; }
    .sv-now div { display: flex; align-items: baseline; gap: 8px; }
    .sv-now strong { font-family: Georgia, 'Times New Roman', serif; font-size: 3rem; font-weight: 500; line-height: 1; color: #059669; font-variant-numeric: tabular-nums; }
    .sv-now .amber strong { color: #d97706; }
    .sv-now span { font-size: 0.7rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-text-muted); }

    .sv-error { padding: 12px 18px; border-radius: 16px; background: #fee2e2; color: #991b1b; font-weight: 700; }

    .sv-card { padding: 22px 24px; border-radius: 28px; background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: 0 18px 30px -28px rgba(0,0,0,.45); }
    .sv-card h2, .sv-block h2 { margin: 0; font-size: 1.2rem; font-weight: 800; }

    /* ---- live ---- */
    .sv-live { background: linear-gradient(135deg, color-mix(in srgb, #10b981 8%, var(--color-surface)), var(--color-surface) 55%); border-color: color-mix(in srgb, #10b981 26%, var(--color-border)); }
    .sv-card-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
    .sv-badge { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px; border-radius: 999px; background: #d1fae5; color: #047857; font-size: 0.66rem; font-weight: 800; letter-spacing: 0.16em; }
    .sv-dot { position: relative; width: 8px; height: 8px; border-radius: 50%; background: #10b981; }
    .sv-dot::after { content: ''; position: absolute; inset: -5px; border-radius: 50%; border: 1.5px solid #10b981; animation: sv-ping 1.8s ease-out infinite; }
    @keyframes sv-ping { from { transform: scale(.5); opacity: 1; } to { transform: scale(1.3); opacity: 0; } }
    .sv-live-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
    .sv-person { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 22px; background: var(--color-surface); border: 1px solid color-mix(in srgb, #10b981 35%, var(--color-border)); box-shadow: 0 14px 24px -22px #10b981; }
    .sv-person.brk { border-color: color-mix(in srgb, #f59e0b 45%, var(--color-border)); box-shadow: 0 14px 24px -22px #f59e0b; }
    .sv-person-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .sv-person-main b, .sv-act-name b { font-size: 1.02rem; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sv-person-main small { font-size: 0.76rem; font-weight: 600; color: var(--color-text-muted); }
    .sv-person-tags { display: flex; flex-wrap: wrap; gap: 5px; }
    .sv-role { padding: 1px 9px; border-radius: 999px; background: var(--color-bg); border: 1px solid var(--color-border); font-size: 0.68rem; font-weight: 800; color: var(--color-text-muted); }
    .sv-state { padding: 1px 9px; border-radius: 999px; background: #d1fae5; color: #047857; font-size: 0.68rem; font-weight: 800; }
    .sv-state.brk { background: #fef3c7; color: #b45309; }
    .sv-star { padding: 1px 9px; border-radius: 999px; background: #fef3c7; color: #92400e; font-size: 0.68rem; font-weight: 800; }
    .sv-elapsed { font-family: Georgia, 'Times New Roman', serif; font-size: 1.5rem; font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; }

    .sv-avatar { --h: 24; flex: none; display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; color: #fff; font-size: 1rem; font-weight: 800; background: linear-gradient(145deg, hsl(var(--h) 72% 56%), hsl(calc(var(--h) + 28) 72% 40%)); box-shadow: 0 10px 16px -10px hsl(var(--h) 72% 40%); }
    .sv-avatar.sm { width: 36px; height: 36px; font-size: 0.78rem; }

    .sv-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 24px 16px; border-radius: 20px; border: 2px dashed var(--color-border); color: var(--color-text-muted); text-align: center; }
    .sv-empty p { margin: 0; font-weight: 700; }
    .sv-skeleton { display: flex; flex-direction: column; gap: 8px; }
    .sv-skeleton i { display: block; height: 60px; border-radius: 20px; background: linear-gradient(90deg, var(--color-bg) 25%, color-mix(in srgb, var(--color-border) 60%, var(--color-bg)) 50%, var(--color-bg) 75%); background-size: 200% 100%; animation: sv-shimmer 1.4s linear infinite; }
    @keyframes sv-shimmer { to { background-position: -200% 0; } }

    /* ---- range ---- */
    .sv-range { position: relative; z-index: 4; }
    .sv-range-top { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px; }
    .sv-controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
    .sv-field { display: flex; flex-direction: column; gap: 6px; width: 220px; }
    .sv-field label { font-size: 0.68rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-text-muted); }
    .sv-arrow { padding-bottom: 12px; font-weight: 800; color: var(--color-primary); }
    .sv-go { min-height: 46px; padding: 0 26px; border: 0; border-radius: 999px; color: #fff; font: inherit; font-weight: 800; cursor: pointer; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 70%, #000)); box-shadow: 0 14px 22px -14px var(--color-primary); }
    .sv-go:hover:not(:disabled) { filter: brightness(1.08); }
    .sv-go:disabled { opacity: .6; cursor: not-allowed; }
    .sv-presets { display: inline-flex; gap: 2px; margin-top: 16px; padding: 4px; border-radius: 999px; background: var(--color-bg); box-shadow: inset 0 0 0 1px var(--color-border); }
    .sv-presets button { min-height: 34px; padding: 0 16px; border: 0; border-radius: 999px; background: transparent; color: var(--color-text-muted); font: inherit; font-size: 0.82rem; font-weight: 800; cursor: pointer; }
    .sv-presets button:hover:not(.on):not(:disabled) { color: var(--color-text); }
    .sv-presets button.on { background: #1c1917; color: #fff; }

    /* ---- activity ---- */
    .sv-block-head { margin-bottom: 14px; }
    .sv-totals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
    .sv-totals div { display: flex; flex-direction: column; gap: 4px; padding: 16px 18px; border-radius: 22px; color: #fff; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 62%, #000)); box-shadow: 0 18px 28px -22px var(--color-primary); }
    .sv-totals div:nth-child(2) { background: linear-gradient(135deg, #0e7490, #164e63); box-shadow: 0 18px 28px -22px #0e7490; }
    .sv-totals div:nth-child(3) { background: linear-gradient(135deg, #059669, #065f46); box-shadow: 0 18px 28px -22px #059669; }
    .sv-totals div:nth-child(4) { background: linear-gradient(135deg, #7c3aed, #4c1d95); box-shadow: 0 18px 28px -22px #7c3aed; }
    .sv-totals strong { font-family: Georgia, 'Times New Roman', serif; font-size: 1.9rem; font-weight: 500; line-height: 1; font-variant-numeric: tabular-nums; }
    .sv-totals span { font-size: 0.68rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,.82); }
    .sv-people { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
    .sv-act { padding: 18px 20px; border-radius: 26px; background: var(--color-surface); border: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 14px; transition: border-color .15s, box-shadow .15s; }
    .sv-act:hover { border-color: var(--color-primary); box-shadow: 0 18px 28px -24px var(--color-primary); }
    .sv-act-top { display: flex; align-items: center; gap: 14px; }
    .sv-act-name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .sv-act-hours { text-align: right; display: flex; flex-direction: column; }
    .sv-act-hours strong { font-family: Georgia, 'Times New Roman', serif; font-size: 1.55rem; font-weight: 500; line-height: 1; font-variant-numeric: tabular-nums; }
    .sv-act-hours span { font-size: 0.72rem; font-weight: 700; color: var(--color-text-muted); }
    .sv-bar { height: 8px; border-radius: 999px; background: var(--color-bg); box-shadow: inset 0 0 0 1px var(--color-border); overflow: hidden; }
    .sv-bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 55%, #fbbf24)); transition: width .5s ease; }
    .sv-act { container-type: inline-size; min-width: 0; }
    .sv-act-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    @container (max-width: 400px) { .sv-act-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .sv-act-stats div { display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0; padding: 10px 6px; border-radius: 16px; background: var(--color-bg); text-align: center; }
    .sv-act-stats strong { font-size: 1.15rem; font-weight: 800; font-variant-numeric: tabular-nums; }
    .sv-act-stats span { font-size: 0.6rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--color-text-muted); overflow-wrap: anywhere; hyphens: auto; line-height: 1.15; }
    .sv-act-stats .warn strong { color: #b45309; }

    /* ---- history ---- */
    .sv-rows { display: flex; flex-direction: column; gap: 6px; max-height: min(60vh, 560px); overflow-y: auto; overscroll-behavior: contain; padding-right: 6px; }
    .sv-row { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr) 96px 110px 110px; align-items: center; gap: 14px; padding: 9px 14px; border-radius: 18px; background: var(--color-surface); border: 1px solid var(--color-border); box-sizing: border-box; }
    .sv-row:not(.sv-row-head):hover { border-color: var(--color-primary); }
    .sv-row.open { background: #ecfdf5; border-color: #6ee7b7; }
    .sv-row-head { position: sticky; top: 0; z-index: 2; min-height: 48px; border-radius: 16px; border: 1px solid color-mix(in srgb, var(--color-primary) 32%, var(--color-border)); border-bottom: 4px double var(--color-primary); background: linear-gradient(180deg, rgba(255,255,255,.7), rgba(255,255,255,0) 55%), color-mix(in srgb, var(--color-primary) 11%, var(--color-surface)); box-shadow: 0 0 0 4px var(--color-surface); }
    .sv-row-head span { font-family: Georgia, 'Times New Roman', serif; font-size: 1rem; font-style: italic; text-transform: capitalize; color: color-mix(in srgb, var(--color-primary) 38%, #1c1917); }
    .sv-who { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .sv-who b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 800; }
    .sv-day { font-family: Georgia, 'Times New Roman', serif; font-style: italic; }
    .sv-t { font-weight: 800; font-variant-numeric: tabular-nums; }
    .sv-open { font-style: normal; padding: 3px 12px; border-radius: 999px; background: #d1fae5; color: #047857; font-size: .78rem; }
    .sv-dur { justify-self: start; padding: 5px 14px; border-radius: 999px; background: #1c1917; color: #fff; font-size: .85rem; font-weight: 800; font-variant-numeric: tabular-nums; }
    .sv-row.open .sv-dur { background: #059669; }
    .sv-more { display: block; margin: 14px auto 0; min-height: 40px; padding: 0 22px; border-radius: 999px; border: 1px dashed var(--color-border); background: transparent; color: var(--color-text); font: inherit; font-weight: 800; cursor: pointer; }
    .sv-more:hover { border-color: var(--color-primary); color: var(--color-primary); }


    /* ===== responsive pass ===== */
    .sv-page { width: 100%; min-width: 0; box-sizing: border-box; }
    .sv-page > * { min-width: 0; }
    .sv-live-grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }
    .sv-people { grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); }
    .sv-person { min-width: 0; }
    .sv-act-top { flex-wrap: wrap; row-gap: 10px; }
    .sv-act-name { flex: 1 1 8rem; }
    .sv-act-hours { flex: none; }
    .sv-act-name b, .sv-person-main b { max-width: 100%; }
    .sv-presets { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
    .sv-presets::-webkit-scrollbar { display: none; }
    .sv-presets button { flex: none; white-space: nowrap; }
    .sv-controls { min-width: 0; }

    @container (max-width: 360px) {
      .sv-act-hours { flex-basis: 100%; flex-direction: row; align-items: baseline; justify-content: space-between; padding-top: 10px; border-top: 1.5px dashed var(--color-border); text-align: left; }
    }

    @media (max-width: 1100px) {
      .sv-hero { align-items: flex-start; }
    }
    @media (max-width: 760px) {
      .sv-page { gap: 14px; }
      .sv-hero h1 { font-size: 1.65rem; }
      .sv-hero { flex-direction: column; align-items: stretch; gap: 14px; }
      .sv-now { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .sv-now div { flex-direction: column; align-items: flex-start; gap: 2px; padding: 14px 16px; border-radius: 22px; background: var(--color-surface); border: 1px solid var(--color-border); }
      .sv-now strong { font-size: 2.4rem; }
      .sv-card { padding: 18px 16px; border-radius: 24px; }
      .sv-card-head { flex-wrap: wrap; gap: 8px; }
      .sv-range-top { flex-direction: column; align-items: stretch; }
      .sv-controls { display: grid; grid-template-columns: 1fr 1fr; align-items: end; gap: 10px; }
      .sv-controls .sv-go { grid-column: 1 / -1; width: 100%; }
      .sv-presets { display: flex; width: 100%; box-sizing: border-box; }
      .sv-presets button { flex: 1 0 auto; padding: 0 12px; }
      .sv-totals div { padding: 14px 14px; border-radius: 20px; }
      .sv-totals strong { font-size: 1.65rem; }
      .sv-act { padding: 16px; border-radius: 22px; }
      .sv-rows { padding-right: 0; max-height: none; }
      .sv-row { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 10px; padding: 12px 14px; align-items: start; }
      .sv-who { grid-column: 1 / -1; }
      .sv-day { grid-column: 1 / -1; font-size: 0.9rem; color: var(--color-text-muted); }
      .sv-dur { grid-column: auto; justify-self: end; align-self: center; }
    }
    @media (max-width: 420px) {
      .sv-person { flex-wrap: wrap; }
      .sv-elapsed { flex-basis: 100%; padding-top: 10px; border-top: 1.5px dashed var(--color-border); font-size: 1.4rem; }
      .sv-controls { grid-template-columns: minmax(0, 1fr); }
      .sv-avatar { width: 42px; height: 42px; }
    }

    /* ===== date range card v5: white + orange desk calendar with tear-off leaves ===== */
    .sv-range {
      position: relative; z-index: 4; display: flex; flex-direction: column; gap: 20px; padding: 26px 26px 24px;
      border: 0; border-radius: 30px; overflow: hidden;
      background:
        radial-gradient(90% 120% at 100% 0, color-mix(in srgb, var(--color-primary) 16%, transparent), transparent 55%),
        #fff;
      box-shadow: 0 26px 46px -30px rgba(23, 18, 16, 0.5), 0 0 0 1px color-mix(in srgb, var(--color-primary) 20%, transparent);
    }
    .sv-range::before { content: ''; position: absolute; right: -50px; bottom: -70px; width: 220px; height: 220px; border-radius: 50%; border: 1.5px dashed color-mix(in srgb, var(--color-primary) 35%, transparent); pointer-events: none; }
    .sv-range-top { position: relative; align-items: flex-start; }
    .sv-range-eyebrow { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-size: 0.62rem; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; color: var(--color-primary); }
    .sv-range-eyebrow i { width: 18px; height: 1.5px; background: currentColor; }
    .sv-range h2 { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 500; font-size: 1.9rem; letter-spacing: -0.02em; line-height: 1.05; color: var(--color-text); }
    .sv-range .sv-muted { margin-top: 6px; }

    .sv-range .sv-presets { margin: 0; padding: 4px; gap: 2px; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 8%, #fff); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 22%, transparent); }
    .sv-range .sv-presets button { min-height: 36px; padding: 0 16px; font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-primary); }
    .sv-range .sv-presets button:hover:not(.on):not(:disabled) { color: color-mix(in srgb, var(--color-primary) 70%, #000); }
    .sv-range .sv-presets button.on { color: #fff; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 62%, #000)); box-shadow: 0 12px 18px -10px var(--color-primary); }

    .sv-leaves { position: relative; display: flex; align-items: center; gap: 14px; }
    .sv-leaf { flex: 1 1 0; min-width: 0; border-radius: 18px; background: #fff; box-shadow: 0 20px 28px -22px color-mix(in srgb, var(--color-primary) 70%, #000), 0 0 0 1.5px color-mix(in srgb, var(--color-primary) 40%, transparent); }
    .sv-leaf-head { position: relative; display: flex; align-items: center; justify-content: center; min-height: 30px; padding: 0 12px; border-radius: 17px 17px 0 0; font-size: 0.62rem; font-weight: 800; letter-spacing: 0.24em; text-transform: uppercase; color: #fff; background: linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 88%, #fff), color-mix(in srgb, var(--color-primary) 72%, #000)); }
    .sv-leaf-head i { position: absolute; top: 50%; width: 9px; height: 9px; margin-top: -4.5px; border-radius: 50%; background: #fff; box-shadow: inset 0 1px 2px color-mix(in srgb, var(--color-primary) 60%, #000); }
    .sv-leaf-head i:nth-child(1) { left: 16px; }
    .sv-leaf-head i:nth-child(2) { right: 16px; }
    .sv-leaf-body { padding: 10px; }
    .sv-leaf-body .sv-field { width: 100%; }

    .sv-stamp { flex: none; display: grid; place-items: center; width: 74px; height: 74px; border-radius: 50%; color: var(--color-primary); background: #fff; border: 2px double color-mix(in srgb, var(--color-primary) 70%, transparent); box-shadow: 0 14px 22px -16px var(--color-primary); transform: rotate(-8deg); text-align: center; }
    .sv-stamp b { font-family: Georgia, serif; font-style: italic; font-weight: 500; font-size: 1.9rem; line-height: 0.9; }
    .sv-stamp small { display: block; margin-top: -14px; font-size: 0.56rem; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; }

    .sv-range .sv-go { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 12px; align-self: stretch; min-height: 54px; padding: 0 10px 0 26px; border-radius: 999px; font-size: 1rem; font-weight: 800; color: #fff; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #000)); box-shadow: 0 18px 28px -14px var(--color-primary); transition: transform 0.15s; }
    .sv-range .sv-go:hover:not(:disabled) { filter: brightness(1.06); }
    .sv-range .sv-go:active:not(:disabled) { transform: scale(0.98); }
    .sv-range .sv-go i { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; font-style: normal; color: var(--color-primary); background: #fff; transition: transform 0.2s; }
    .sv-range .sv-go:hover:not(:disabled) i { transform: translateX(3px); }
    @media (max-width: 760px) {
      .sv-range { padding: 20px 16px; border-radius: 26px; }
      .sv-range-top { flex-direction: column; gap: 14px; }
      .sv-range h2 { font-size: 1.6rem; }
      .sv-range .sv-presets { align-self: stretch; }
      .sv-leaves { flex-direction: column; align-items: stretch; gap: 10px; }
      .sv-stamp { width: 62px; height: 62px; align-self: center; margin: -4px 0; }
      .sv-stamp b { font-size: 1.6rem; }
    }
    @media (prefers-reduced-motion: reduce) { .sv-dot::after, .sv-skeleton i { animation: none; } .sv-bar i { transition: none; } }
    @media (max-width: 760px) {
      .sv-totals { grid-template-columns: 1fr 1fr; }
      .sv-row-head { display: none; }
      .sv-row { grid-template-columns: 1fr 1fr; row-gap: 8px; }
      .sv-who { grid-column: 1 / -1; }
      .sv-field { width: 100%; }
      .sv-arrow { display: none; }
    }
  `,
})
export class ShiftSupervisionComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private translate = inject(TranslateService);

  error = signal<string | null>(null);

  loadingLive = signal(true);
  live = signal<WorkSession[]>([]);

  loadingRange = signal(true);
  history = signal<WorkSession[]>([]);
  activity = signal<StaffActivity[]>([]);
  showAll = signal(false);

  fromDate: string;
  toDate: string;

  readonly presets = [
    { days: 7, label: 'SHIFT_SUPERVISION.PRESET_7' },
    { days: 14, label: 'SHIFT_SUPERVISION.PRESET_14' },
    { days: 30, label: 'SHIFT_SUPERVISION.PRESET_30' },
  ];

  private tick = signal(0);
  private timer: ReturnType<typeof setInterval> | null = null;

  working = computed(() => this.live().filter((r) => !r.on_break).length);
  onBreak = computed(() => this.live().filter((r) => r.on_break).length);

  totals = computed(() => {
    const rows = this.activity();
    const mins = rows.reduce((s, r) => s + r.worked_minutes, 0);
    return {
      hours: this.formatHours(mins),
      shifts: rows.reduce((s, r) => s + r.shifts_count, 0),
      prepared: rows.reduce((s, r) => s + r.items_prepared, 0),
      paid: rows.reduce((s, r) => s + r.orders_paid, 0),
    };
  });

  private maxMinutes = computed(() => Math.max(1, ...this.activity().map((a) => a.worked_minutes)));

  topHours = computed(() => {
    const rows = this.activity().filter((a) => a.worked_minutes > 0);
    return rows.length > 1 ? rows.reduce((b, a) => (a.worked_minutes > b.worked_minutes ? a : b)).user_id : null;
  });

  topPaid = computed(() => {
    const rows = this.activity().filter((a) => a.orders_paid > 0);
    return rows.length > 1 ? rows.reduce((b, a) => (a.orders_paid > b.orders_paid ? a : b)).user_id : null;
  });

  visibleHistory = computed(() => (this.showAll() ? this.history() : this.history().slice(0, 12)));

  /** Which preset (7 / 14 / 30 days ending today) matches the selected dates. */
  /** Inclusive number of days between the two dates (shown on the range pass). */
  rangeDays(): number {
    const a = new Date(this.fromDate + 'T00:00:00');
    const b = new Date(this.toDate + 'T00:00:00');
    const n = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  activeDays(): number | null {
    const today = localIso(new Date());
    for (const p of this.presets) {
      const from = new Date();
      from.setDate(from.getDate() - (p.days - 1));
      if (this.toDate === today && this.fromDate === localIso(from)) return p.days;
    }
    return null;
  }

  constructor() {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    this.toDate = localIso(today);
    this.fromDate = localIso(weekAgo);
  }

  ngOnInit(): void {
    this.loadLive();
    this.loadRange();
    this.timer = setInterval(() => this.tick.update((n) => n + 1), 30000);
  }

  ngOnDestroy(): void {
    if (this.timer != null) clearInterval(this.timer);
  }

  setRange(days: number): void {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    this.toDate = localIso(to);
    this.fromDate = localIso(from);
    this.loadRange();
  }

  loadLive(): void {
    this.loadingLive.set(true);
    this.api.getReportWorkSessionsLive().subscribe({
      next: (rows) => {
        this.live.set(rows);
        this.loadingLive.set(false);
      },
      error: () => {
        this.error.set(this.translate.instant('SHIFT_SUPERVISION.ERR_LOAD'));
        this.loadingLive.set(false);
      },
    });
  }

  loadRange(): void {
    this.loadingRange.set(true);
    forkJoin({
      history: this.api.getReportWorkSessions(this.fromDate, this.toDate),
      activity: this.api.getReportStaffActivity(this.fromDate, this.toDate),
    }).subscribe({
      next: ({ history, activity }) => {
        this.history.set(history);
        this.activity.set([...activity].sort((a, b) => b.worked_minutes - a.worked_minutes));
        this.showAll.set(false);
        this.loadingRange.set(false);
      },
      error: () => {
        this.error.set(this.translate.instant('SHIFT_SUPERVISION.ERR_LOAD'));
        this.loadingRange.set(false);
      },
    });
  }

  hoursPct(a: StaffActivity): number {
    return Math.max(a.worked_minutes ? 4 : 0, (a.worked_minutes / this.maxMinutes()) * 100);
  }

  /** Net time worked so far in an open session (re-evaluated every 30 s). */
  elapsed(row: WorkSession): string {
    void this.tick();
    const sec = workSessionNetWorkSeconds(row);
    return this.formatHours(Math.floor(sec / 60));
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

  roleLabel(role: string | null | undefined): string {
    if (!role) return '';
    return this.translate.instant(`USERS.ROLES.${role.toUpperCase()}`);
  }

  timeOnly(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  dayLabel(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const s = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  formatDuration(row: WorkSession): string {
    if (row.duration_minutes != null && row.duration_minutes >= 0) {
      return row.duration_minutes === 0 ? '<1 min' : this.formatHours(row.duration_minutes);
    }
    if (!row.ended_at && row.open_duration_minutes != null) {
      return this.formatHours(row.open_duration_minutes);
    }
    return '—';
  }

  formatHours(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
}
