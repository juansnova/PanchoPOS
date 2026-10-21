import { Component, inject, signal, computed, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { LowerCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  Reservation,
  ReservationCreate,
  ReservationUpdate,
  ReservationStatus,
  WaitingListEntry,
  WaitingListStatus,
  CanvasTable,
  OverbookingReport,
  TenantSummary,
  ReservationBookZone,
} from '../services/api.service';
import { PermissionService } from '../services/permission.service';
import { SidebarComponent } from '../shared/sidebar.component';
import { ConfirmationModalComponent } from '../shared/confirmation-modal.component';
import { FocusFirstInputDirective } from '../shared/focus-first-input.directive';
import { ReservationWeekSlotGridComponent } from '../shared/reservation-week-slot-grid.component';
import { AppDatePickerComponent } from '../shared/app-date-picker.component';
import { tenantOpeningHoursHasMealSplit, resolveBookingServiceLabel } from '../shared/booking-meal-split';
import { reservationDietaryNotesDisplay, reservationDietaryNotesFormValue } from '../shared/reservation-dietary-notes';
import { contactEmailValid, contactPhoneValid } from '../shared/contact-validators';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrorMessageService } from '../services/api-error-message.service';

@Component({
  selector: 'app-reservations',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    SidebarComponent,
    TranslateModule,
    ConfirmationModalComponent,
    FocusFirstInputDirective,
    LowerCasePipe,
    ReservationWeekSlotGridComponent,
    AppDatePickerComponent,
  ],
  template: `
    <app-sidebar>
      <section class="rs-hero">
        <div class="rs-hero-top">
          <p class="rs-eyebrow"><i></i>{{ 'RESERVATIONS.TITLE' | translate }}</p>
          <div class="rs-hero-actions">
            @if (tenantId != null) {
              <div class="rs-links" [attr.aria-label]="'RESERVATIONS.SHARE_LINKS' | translate">
                <a [routerLink]="['/book', tenantId]" target="_blank" rel="noopener" class="rs-link"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>{{ 'RESERVATIONS.LINK_BOOKING' | translate }}</a>
                <a [routerLink]="['/waitlist', tenantId]" target="_blank" rel="noopener" class="rs-link"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>{{ 'RESERVATIONS.LINK_WAITLIST' | translate }}</a>
                <a [routerLink]="['/feedback', tenantId]" target="_blank" rel="noopener" class="rs-link"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>{{ 'RESERVATIONS.LINK_FEEDBACK' | translate }}</a>
              </div>
            }
            <a [routerLink]="['/settings']" [queryParams]="{ section: 'reservations' }" class="rs-icon-btn" [title]="'RESERVATIONS.EDIT_RESERVATION_OPTIONS' | translate" aria-label="{{ 'RESERVATIONS.EDIT_RESERVATION_OPTIONS' | translate }}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></a>
            @if (canWrite()) {
              <button class="rs-new" (click)="openCreate()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>{{ 'RESERVATIONS.NEW' | translate }}</button>
            }
          </div>
        </div>

        @if (viewTab() === 'reservations') {
          <div class="rs-hero-main">
            <h1 class="rs-date">
              <span class="rs-date-num">{{ filterParts().day }}</span>
              <span class="rs-date-txt">
                <b>{{ filterParts().weekday }}</b>
                <span>{{ filterParts().month }} {{ filterParts().year }}</span>
              </span>
              @if (isFilterToday()) { <em class="rs-today">{{ 'RESERVATIONS.TODAY_PILL' | translate }}</em> }
            </h1>
            <dl class="rs-stats" data-testid="reservations-kpis">
              <div><dt>{{ 'RESERVATIONS.KPI_RESERVATIONS' | translate }}</dt><dd>{{ resStats().total }}</dd></div>
              <div><dt>{{ 'RESERVATIONS.KPI_GUESTS' | translate }}</dt><dd>{{ resStats().guests }}</dd></div>
              <div class="rs-stat-info"><dt>{{ 'RESERVATIONS.KPI_PENDING' | translate }}</dt><dd>{{ resStats().booked }}</dd></div>
              <div class="rs-stat-ok"><dt>{{ 'RESERVATIONS.KPI_SEATED' | translate }}</dt><dd>{{ resStats().seated }}</dd></div>
            </dl>
          </div>

          <div class="rs-flow" aria-hidden="true">
            <span class="rs-flow-b" [style.flex-grow]="flow().booked"></span>
            <span class="rs-flow-s" [style.flex-grow]="flow().seated"></span>
            <span class="rs-flow-f" [style.flex-grow]="flow().finished"></span>
          </div>

          <div class="rs-strip">
            <button type="button" class="rs-strip-arrow" (click)="shiftDay(-1)" [attr.aria-label]="'RESERVATIONS.PREV_DAY' | translate">‹</button>
            <div class="rs-days" role="group">
              @for (d of stripDays(); track d.date) {
                <button type="button" class="rs-day" [class.on]="d.date === filterDate" [class.today]="d.today" (click)="pickDate(d.date)">
                  <small>{{ d.weekday }}</small>
                  <b>{{ d.day }}</b>
                </button>
              }
            </div>
            <button type="button" class="rs-strip-arrow" (click)="shiftDay(1)" [attr.aria-label]="'RESERVATIONS.NEXT_DAY' | translate">›</button>
            <app-date-picker class="rs-picker" [compact]="true" [clearable]="false" [ngModel]="filterDate" (ngModelChange)="pickDate($event)" />
            @if (!isFilterToday()) {
              <button type="button" class="rs-gotoday" (click)="goToday()">{{ 'RESERVATIONS.GO_TODAY' | translate }}</button>
            }
          </div>
        }
      </section>

      <div class="rs-tabs" role="tablist">
        <button type="button" role="tab" class="rs-tab" [class.active]="viewTab() === 'reservations'" (click)="setViewTab('reservations')">
          {{ 'RESERVATIONS.TAB_RESERVATIONS' | translate }}
          <span class="rs-tab-count">{{ reservations().length }}</span>
        </button>
        <button type="button" role="tab" class="rs-tab" [class.active]="viewTab() === 'waitlist'" (click)="setViewTab('waitlist')">
          {{ 'RESERVATIONS.TAB_WAITLIST' | translate }}
          @if (waitingList().length > 0) { <span class="rs-tab-count">{{ waitingList().length }}</span> }
        </button>
      </div>

      @if (viewTab() === 'reservations') {
      <div class="rs-filters">
        <label class="rs-field rs-field-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input type="text" [(ngModel)]="filterPhone" (ngModelChange)="load()" placeholder="{{ 'RESERVATIONS.SEARCH_PHONE' | translate }}" /></label>
        <button class="rs-refresh" (click)="load()">{{ 'ORDERS.REFRESH' | translate }}</button>
        <div class="rs-chips" role="group">
          <button type="button" class="rs-chip" [class.on]="filterStatus === ''" (click)="setStatusFilter('')">{{ 'RESERVATIONS.ALL_STATUSES' | translate }}</button>
          <button type="button" class="rs-chip" [class.on]="filterStatus === 'booked'" (click)="setStatusFilter('booked')">{{ 'RESERVATIONS.STATUS_BOOKED' | translate }}</button>
          <button type="button" class="rs-chip" [class.on]="filterStatus === 'seated'" (click)="setStatusFilter('seated')">{{ 'RESERVATIONS.STATUS_SEATED' | translate }}</button>
          <button type="button" class="rs-chip" [class.on]="filterStatus === 'finished'" (click)="setStatusFilter('finished')">{{ 'RESERVATIONS.STATUS_FINISHED' | translate }}</button>
          <button type="button" class="rs-chip" [class.on]="filterStatus === 'cancelled'" (click)="setStatusFilter('cancelled')">{{ 'RESERVATIONS.STATUS_CANCELLED' | translate }}</button>
          <button type="button" class="rs-chip" [class.on]="filterStatus === 'no_show'" (click)="setStatusFilter('no_show')">{{ 'RESERVATIONS.STATUS_NO_SHOW' | translate }}</button>
        </div>
      </div>

      @if (loading()) {
        <div class="empty-state"><p>{{ 'RESERVATIONS.LOADING' | translate }}</p></div>
      } @else if (reservations().length === 0) {
        <div class="rs-empty">
          <div class="rs-empty-ico"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></div>
          <p>{{ 'RESERVATIONS.NONE' | translate }}</p>
          @if (canWrite()) {
            <button class="rs-new" (click)="openCreate()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>{{ 'RESERVATIONS.NEW' | translate }}</button>
          }
        </div>
      } @else {
        <div class="reservation-grid">
          @for (r of reservations(); track r.id) {
            <article class="tk" [class]="'tk status-' + r.status" [class.is-late]="!!r.delay_notice && (r.status === 'booked' || r.status === 'seated')">
              <div class="tk-stub">
                <span class="tk-time">{{ timeLabel(r.reservation_time) }}</span>
                <span class="tk-day">{{ dayLabel(r.reservation_date) }}</span>
                <span class="tk-num">#{{ r.id }}</span>
              </div>
              <div class="tk-perf" aria-hidden="true"></div>
              <div class="tk-main">
                <header class="tk-head">
                  <span class="tk-avatar" [style.--h]="hue(r.customer_name)" aria-hidden="true">{{ initial(r.customer_name) }}</span>
                  <div class="tk-who">
                    <h3>{{ r.customer_name }}</h3>
                    <span class="tk-party">
                      <span class="tk-dots" aria-hidden="true">
                        @for (i of partyDots(r.party_size); track i) { <i></i> }
                        @if (r.party_size > 8) { <em>+{{ r.party_size - 8 }}</em> }
                      </span>
                      {{ r.party_size }} {{ 'RESERVATIONS.PERSONS_SHORT' | translate }}
                    </span>
                  </div>
                  <div class="tk-badges">
                    <span class="status-badge" [class]="r.status">{{ getStatusLabel(r.status) | translate }}</span>
                    @if (r.delay_notice && (r.status === 'booked' || r.status === 'seated')) {
                      <span class="rv-late-badge">{{ 'RESERVATIONS.LATE_BADGE' | translate }}</span>
                    }
                    @if (isSlotOverbooked(r)) {
                      <span class="overbooked-badge">{{ 'RESERVATIONS.OVERBOOKED' | translate }}</span>
                    }
                  </div>
                </header>
                @if (r.delay_notice && (r.status === 'booked' || r.status === 'seated')) {
                  <div class="rv-delay" role="status">
                    <span class="rv-delay-bell" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>
                    </span>
                    <div>
                      <b>{{ 'RESERVATIONS.DELAY_NOTICE' | translate }}</b>
                      <p>{{ r.delay_notice }}</p>
                    </div>
                  </div>
                }
                <div class="tk-body">
                  <div class="rv-line"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.12.9.34 1.78.65 2.62a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.46-1.27a2 2 0 012.11-.45c.84.31 1.72.53 2.62.65A2 2 0 0122 16.92z"/></svg><span>{{ r.customer_phone }}</span></div>
                  @if (r.customer_email) {
                    <div class="rv-line"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/></svg><span>{{ r.customer_email }}</span></div>
                  }
                  <div class="rv-tags">
                    <span class="rv-tag rv-tag-table"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10h18M5 10v9M19 10v9M7 10V6h10v4"/></svg>{{ getTableDisplay(r) }}</span>
                    @if (r.service_type) {
                      <span class="rv-tag">{{ serviceTypeLabel(r.service_type) }}</span>
                    }
                    @if (r.seating_preference) {
                      <span class="rv-tag">{{ seatingLabel(r.seating_preference) }}</span>
                    }
                    @if (!dietaryNotesLine(r) && r.allergies_has) {
                      <span class="rv-tag rv-tag-warn">{{ 'BOOK.ALLERGIES_HAS' | translate }}</span>
                    }
                  </div>
                  @if (r.client_notes) {
                    <div class="rv-note"><b>{{ 'RESERVATIONS.RESERVATION_NOTES' | translate }}</b>{{ r.client_notes }}</div>
                  }
                  @if (dietaryNotesLine(r); as dn) {
                    <div class="rv-note rv-note-warn"><b>{{ 'RESERVATIONS.CUSTOMER_NOTES' | translate }}</b>{{ dn }}</div>
                  }
                  @if (r.owner_notes) {
                    <div class="rv-note rv-note-owner"><b>{{ 'RESERVATIONS.OWNER_NOTES' | translate }}</b>{{ r.owner_notes }}</div>
                  }
                  @if (r.client_ip || r.client_user_agent || r.client_fingerprint != null || r.client_screen_width != null) {
                  <details class="client-tech">
                    <summary>{{ 'RESERVATIONS.CLIENT_TECH_SUMMARY' | translate }}</summary>
                    <div class="client-tech-inner">
                      @if (r.client_ip) { <div><strong>{{ 'RESERVATIONS.CLIENT_TECH_IP' | translate }}:</strong> {{ r.client_ip }}</div> }
                      @if (r.client_user_agent) { <div class="ua" title="{{ r.client_user_agent }}"><strong>{{ 'RESERVATIONS.CLIENT_TECH_USER_AGENT' | translate }}:</strong> {{ r.client_user_agent.length > 60 ? r.client_user_agent.slice(0, 60) + '…' : r.client_user_agent }}</div> }
                      @if (r.client_fingerprint) { <div><strong>{{ 'RESERVATIONS.CLIENT_TECH_FINGERPRINT' | translate }}:</strong> {{ r.client_fingerprint }}</div> }
                      @if (r.client_screen_width != null || r.client_screen_height != null) { <div><strong>{{ 'RESERVATIONS.CLIENT_TECH_SCREEN' | translate }}:</strong> {{ r.client_screen_width }}×{{ r.client_screen_height }}</div> }
                    </div>
                  </details>
                }
                </div>
                @if (canWrite() && (r.status === 'booked' || r.status === 'seated')) {
                  <footer class="tk-actions">
                    @if (r.status === 'booked') {
                      <button class="tk-btn tk-btn-main" (click)="openSeat(r)">{{ 'RESERVATIONS.SEAT' | translate }}<i>→</i></button>
                      <button class="tk-btn" (click)="openEdit(r)">{{ 'RESERVATIONS.EDIT' | translate }}</button>
                      @if (r.customer_email || r.customer_phone) {
                        <button class="tk-btn" (click)="sendReminder(r)" [disabled]="sendingReminderId() === r.id" [title]="'RESERVATIONS.SEND_REMINDER' | translate">
                          {{ sendingReminderId() === r.id ? ('COMMON.LOADING' | translate) : ('RESERVATIONS.SEND_REMINDER' | translate) }}
                        </button>
                      }
                      <span class="tk-spacer"></span>
                      <button class="tk-btn tk-btn-warn" (click)="confirmNoShow(r)">{{ 'RESERVATIONS.NO_SHOW' | translate }}</button>
                      <button class="tk-btn tk-btn-danger" (click)="confirmCancel(r)">{{ 'RESERVATIONS.CANCEL' | translate }}</button>
                    } @else {
                      <button class="tk-btn tk-btn-main" (click)="finish(r)">{{ 'RESERVATIONS.FINISH' | translate }}<i>→</i></button>
                    }
                  </footer>
                }
              </div>
            </article>
          }
        </div>
      }
      }

      @if (viewTab() === 'waitlist') {
        <div class="rs-filters">
          <label class="rs-field rs-field-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input type="text" [(ngModel)]="waitlistFilterPhone" (ngModelChange)="loadWaitlist()" placeholder="{{ 'RESERVATIONS.SEARCH_PHONE' | translate }}" /></label>
          <select [(ngModel)]="waitlistFilterStatus" (ngModelChange)="loadWaitlist()" class="rs-select">
            <option value="">{{ 'RESERVATIONS.WL_ACTIVE_ONLY' | translate }}</option>
            <option value="waiting">{{ 'RESERVATIONS.WL_STATUS_WAITING' | translate }}</option>
            <option value="notified">{{ 'RESERVATIONS.WL_STATUS_NOTIFIED' | translate }}</option>
            <option value="seated">{{ 'RESERVATIONS.WL_STATUS_SEATED' | translate }}</option>
            <option value="cancelled">{{ 'RESERVATIONS.WL_STATUS_CANCELLED' | translate }}</option>
            <option value="no_show">{{ 'RESERVATIONS.WL_STATUS_NO_SHOW' | translate }}</option>
          </select>
          <button class="rs-refresh" (click)="loadWaitlist()">{{ 'ORDERS.REFRESH' | translate }}</button>
        </div>

        @if (waitlistLoading()) {
          <div class="empty-state"><p>{{ 'RESERVATIONS.LOADING' | translate }}</p></div>
        } @else if (waitingList().length === 0) {
          <div class="rs-empty">
            <div class="rs-empty-ico"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg></div>
            <p>{{ 'RESERVATIONS.WL_NONE' | translate }}</p>
          </div>
        } @else {
          <div class="reservation-grid">
            @for (w of waitingList(); track w.id) {
              <article class="rv-card" [class]="'rv-card status-' + w.status">
                <header class="rv-head">
                  <div class="rv-time rv-time-wait">
                    <strong>{{ w.party_size }}</strong>
                    <small>{{ 'RESERVATIONS.PARTY_SIZE' | translate }}</small>
                  </div>
                  <div class="rv-who">
                    <h3>{{ w.customer_name }}</h3>
                    <span class="rv-party rv-id">#{{ w.id }}</span>
                  </div>
                  <div class="rv-badges">
                    <span class="status-badge" [class]="w.status">{{ getWaitlistStatusLabel(w.status) | translate }}</span>
                  </div>
                </header>
                <div class="rv-body">
                  <div class="rv-line"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.12.9.34 1.78.65 2.62a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.46-1.27a2 2 0 012.11-.45c.84.31 1.72.53 2.62.65A2 2 0 0122 16.92z"/></svg><span>{{ w.customer_phone }}</span></div>
                  @if (w.created_at) {
                    <div class="rv-line rv-line-muted"><span>{{ 'RESERVATIONS.WL_JOINED' | translate }}: {{ formatWaitlistTime(w.created_at) }}</span></div>
                  }
                  @if (w.notified_at) {
                    <div class="rv-line rv-line-muted"><span>{{ 'RESERVATIONS.WL_NOTIFIED' | translate }}: {{ formatWaitlistTime(w.notified_at) }}</span></div>
                  }
                </div>
                @if (canWrite() && (w.status === 'waiting' || w.status === 'notified')) {
                  <footer class="rv-actions">
                    <button class="rv-btn rv-btn-main" (click)="convertWaitlistToReservation(w)">{{ 'RESERVATIONS.WL_BOOK_TABLE' | translate }}</button>
                    @if (w.status === 'waiting') {
                      <button class="rv-btn" (click)="updateWaitlistStatus(w, 'notified')">{{ 'RESERVATIONS.WL_MARK_NOTIFIED' | translate }}</button>
                    }
                    <button class="rv-btn" (click)="updateWaitlistStatus(w, 'seated')">{{ 'RESERVATIONS.WL_MARK_SEATED' | translate }}</button>
                    <button class="rv-btn rv-btn-warn" (click)="updateWaitlistStatus(w, 'no_show')">{{ 'RESERVATIONS.NO_SHOW' | translate }}</button>
                    <button class="rv-btn rv-btn-danger" (click)="updateWaitlistStatus(w, 'cancelled')">{{ 'RESERVATIONS.CANCEL' | translate }}</button>
                  </footer>
                }
              </article>
            }
          </div>
        }
      }

      <!-- Create/Edit modal -->
      @if (showForm()) {
        <div class="modal-overlay">
          <div class="modal-content rf" (click)="$event.stopPropagation()" appFocusFirstInput>
            <div class="rf-head">
              @if (editingReservation(); as er) {
                <span class="tk-avatar rf-avatar" [style.--h]="hue(er.customer_name)" aria-hidden="true">{{ initial(er.customer_name) }}</span>
              } @else {
                <span class="rf-icon" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span>
              }
              <div class="rf-head-text">
                <small>{{ editingReservation() ? ('RESERVATIONS.EDIT' | translate) : ('RESERVATIONS.NEW' | translate) }}@if (editingReservation(); as er2) { · #{{ er2.id }} }</small>
                <h3>{{ editingReservation()?.customer_name || formName || ('RESERVATIONS.NEW' | translate) }}</h3>
                @if (formSummary()) { <p><span>{{ formSummary() }}</span></p> }
              </div>
              <button type="button" class="rf-close" (click)="closeForm()" [attr.aria-label]="'COMMON.CANCEL' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            </div>
            <form (ngSubmit)="saveReservation()" class="reservation-modal-form rf-form">
              <div class="rf-body">
                <section class="rf-sec">
                  <h4><i>1</i>{{ 'RESERVATIONS.FORM_PARTY_TITLE' | translate }}</h4>
                  <div class="rf-party">
                    <button type="button" class="rf-step" (click)="stepParty(-1)" [disabled]="formPartySize <= 1" aria-label="-1">−</button>
                    <label class="rf-party-box" for="res-modal-party">
                      <input id="res-modal-party" type="number" name="partySize" min="1" [max]="maxPartySize()" required
                        [(ngModel)]="formPartySize" (ngModelChange)="loadSlotCapacity()" />
                      <span>{{ 'RESERVATIONS.PARTY_SIZE' | translate }}</span>
                      <span class="rf-dots" aria-hidden="true">@for (i of partyDots(formPartySize); track i) { <i></i> }</span>
                    </label>
                    <button type="button" class="rf-step rf-step-plus" (click)="stepParty(1)" [disabled]="formPartySize >= maxPartySize()" aria-label="+1">+</button>
                  </div>

                  @if (hasMealSplit()) {
                    <div class="rf-group">
                      <span class="rf-label">{{ 'BOOK.SERVICE_TYPE' | translate }}</span>
                      <div class="rf-seg" role="group">
                        <button type="button" [class.on]="formService === 'all'" (click)="setFormService('all')">{{ serviceOptionLabel('all') }}</button>
                        <button type="button" [class.on]="formService === 'lunch'" (click)="setFormService('lunch')">{{ serviceOptionLabel('lunch') }}</button>
                        <button type="button" [class.on]="formService === 'dinner'" (click)="setFormService('dinner')">{{ serviceOptionLabel('dinner') }}</button>
                      </div>
                    </div>
                  }

                  <div class="rf-group">
                    <span class="rf-label">{{ 'BOOK.SEATING_PREFERENCE' | translate }}</span>
                    <div class="rf-cards" role="group">
                      <button type="button" class="rf-card-opt" [class.on]="formSeating === 'no_preference'" (click)="setFormSeating('no_preference')"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg><span>{{ 'BOOK.SEATING_ANY' | translate }}</span></button>
                      <button type="button" class="rf-card-opt" [class.on]="formSeating === 'indoor'" (click)="setFormSeating('indoor')"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg><span>{{ 'BOOK.SEATING_INDOOR' | translate }}</span></button>
                      <button type="button" class="rf-card-opt" [class.on]="formSeating === 'terrace'" (click)="setFormSeating('terrace')"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><span>{{ 'BOOK.SEATING_TERRACE' | translate }}</span></button>
                    </div>
                  </div>

                  @if (bookZones().length >= 1 && bookZonesForSeating().length === 0) {
                    <div class="form-error form-hint-block">{{ 'BOOK.NO_ZONE_FOR_SEATING' | translate }}</div>
                  }
                  @if (bookZonesForSeating().length >= 2) {
                    <div class="rf-group">
                      <label class="rf-label" for="res-modal-zone">{{ 'BOOK.LOCATION_ZONE' | translate }}</label>
                      <select id="res-modal-zone" [(ngModel)]="formFloorId" name="resFloorId" required (ngModelChange)="loadSlotCapacity()">
                        <option [ngValue]="null" disabled>{{ 'BOOK.LOCATION_ZONE_PLACEHOLDER' | translate }}</option>
                        @for (z of bookZonesForSeating(); track z.id) {
                          <option [ngValue]="z.id">{{ z.name }}</option>
                        }
                      </select>
                    </div>
                  }
                </section>

                <section class="rf-sec">
                  <h4><i>2</i>{{ 'RESERVATIONS.FORM_WHEN_TITLE' | translate }}</h4>
                  <p class="reservation-modal-hint">{{ 'BOOK.WEEK_GRID_HINT' | translate }}</p>
                  @if (tenantId != null) {
                    <app-reservation-week-slot-grid
                      [tenantId]="tenantId"
                      [partySize]="formPartySize"
                      [timezone]="tenantSummary()?.timezone ?? null"
                      [weekAnchorSeed]="formDate"
                      [excludeReservationId]="editingReservation()?.id ?? null"
                      [serviceType]="hasMealSplit() ? formService : 'all'"
                      [openingHoursJson]="tenantSummary()?.opening_hours ?? null"
                      [bookFloorId]="formFloorId"
                      [elegant]="true"
                      [(selectedDate)]="formDate"
                      [(selectedTime)]="formTime"
                      (selectedDateChange)="loadSlotCapacity()"
                      (selectedTimeChange)="loadSlotCapacity()"
                    />
                  }
                  @if (slotCapacity(); as cap) {
                    <div class="rf-capacity">
                      <span><b>{{ cap.seats_left }}</b> {{ 'RESERVATIONS.SEATS_LEFT' | translate }}</span>
                      <span><b>{{ cap.tables_left }}</b> {{ 'RESERVATIONS.TABLES_LEFT' | translate }}</span>
                    </div>
                  }
                </section>

                <section class="rf-sec">
                  <h4><i>3</i>{{ 'RESERVATIONS.FORM_GUEST_TITLE' | translate }}</h4>
                  <div class="rf-two">
                    <div class="rf-group">
                      <label class="rf-label" for="res-modal-name">{{ 'RESERVATIONS.CUSTOMER_NAME' | translate }}</label>
                      <input id="res-modal-name" type="text" name="customerName" [(ngModel)]="formName" required autocomplete="name" />
                    </div>
                    <div class="rf-group">
                      <label class="rf-label" for="res-modal-phone">{{ 'RESERVATIONS.CUSTOMER_PHONE' | translate }}</label>
                      <div class="phone-with-prefill">
                        <input id="res-modal-phone" type="tel" name="customerPhone" [(ngModel)]="formPhone" required autocomplete="tel" />
                        @if (!editingReservation()) {
                          <button type="button" class="rf-prefill" (click)="prefillFromPhone()" [disabled]="prefillLoading() || !formPhone.trim()" [title]="'RESERVATIONS.PREFILL_FROM_PHONE' | translate">
                            {{ prefillLoading() ? ('COMMON.LOADING' | translate) : ('RESERVATIONS.PREFILL_FROM_PHONE' | translate) }}
                          </button>
                        }
                      </div>
                      @if (prefillMessage()) {
                        <small class="prefill-message" [class.prefill-success]="prefillSuccess()">{{ prefillMessage() }}</small>
                      }
                    </div>
                  </div>
                  <div class="rf-group">
                    <label class="rf-label" for="res-modal-email">{{ 'RESERVATIONS.CUSTOMER_EMAIL' | translate }}</label>
                    <input id="res-modal-email" type="email" name="customerEmail" [(ngModel)]="formEmail" placeholder="your@email.com" autocomplete="email" />
                  </div>
                </section>

                <section class="rf-sec">
                  <h4><i>4</i>{{ 'RESERVATIONS.FORM_NOTES_TITLE' | translate }}</h4>
                  <div class="rf-group">
                    <label class="rf-label" for="res-modal-dietary">{{ 'RESERVATIONS.CUSTOMER_NOTES' | translate }}</label>
                    <textarea id="res-modal-dietary" class="res-dietary-notes" [(ngModel)]="formDietaryNotes" name="resDietaryNotes" rows="2"
                      [placeholder]="'BOOK.ALLERGIES_DETAIL_PLACEHOLDER' | translate"></textarea>
                  </div>
                  <div class="rf-group">
                    <label class="rf-label" for="res-modal-notes">{{ 'RESERVATIONS.RESERVATION_NOTES' | translate }}</label>
                    <textarea id="res-modal-notes" name="clientNotes" [(ngModel)]="formClientNotes" rows="2"
                      [placeholder]="'RESERVATIONS.RESERVATION_NOTES_PLACEHOLDER' | translate"></textarea>
                  </div>
                  <div class="rf-group">
                    <label class="rf-label" for="res-modal-owner-notes">{{ 'RESERVATIONS.OWNER_NOTES' | translate }}</label>
                    <textarea id="res-modal-owner-notes" name="ownerNotes" [(ngModel)]="formOwnerNotes" rows="2"
                      [placeholder]="'RESERVATIONS.OWNER_NOTES_PLACEHOLDER' | translate"></textarea>
                  </div>
                </section>

                @if (formError()) {
                  <div class="form-error rf-error">{{ formError() }}</div>
                }
              </div>
              <div class="rf-foot">
                <span class="rf-foot-sum">{{ formSummary() }}</span>
                <button type="button" class="rf-btn rf-btn-ghost" (click)="closeForm()">{{ 'COMMON.CANCEL' | translate }}</button>
                <button type="submit" class="rf-btn rf-btn-main">{{ 'COMMON.SAVE' | translate }}<i>→</i></button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Seat modal -->
      @if (reservationToSeat(); as sr) {
        <div class="modal-overlay" (click)="closeSeatModal()">
          <div class="sm" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
            <div class="sm-head">
              <span class="tk-avatar sm-avatar" [style.--h]="hue(sr.customer_name)" aria-hidden="true">{{ initial(sr.customer_name) }}</span>
              <div class="sm-head-text">
                <small>{{ 'RESERVATIONS.SEAT_AT_TABLE' | translate }}</small>
                <h3>{{ sr.customer_name }}</h3>
                <p>
                  <span class="tk-dots" aria-hidden="true">@for (i of partyDots(sr.party_size); track i) { <i></i> }</span>
                  {{ sr.party_size }} {{ 'RESERVATIONS.PERSONS_SHORT' | translate }} · {{ timeLabel(sr.reservation_time) }}
                </p>
              </div>
              <button type="button" class="rf-close" (click)="closeSeatModal()" [attr.aria-label]="'COMMON.CLOSE' | translate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            </div>
            <div class="sm-body">
              @if (upcomingNoTableCount() !== null && upcomingNoTableCount()! > 0) {
                <p class="sm-warn">{{ 'RESERVATIONS.UPCOMING_NO_TABLE' | translate: { count: upcomingNoTableCount()! } }}</p>
              }
              @if (availableTablesForSeat().length > 0) {
                <p class="sm-hint">{{ 'RESERVATIONS.SEAT_PICK_HINT' | translate }}</p>
                <div class="sm-grid">
                  @for (t of availableTablesForSeat(); track t.id) {
                    <button type="button" class="sm-table" [class.best]="t.seat_count === bestFitSeats()" [class.warn]="!!t.upcoming_reservation" (click)="seatAt(t.id!)">
                      @if (t.seat_count === bestFitSeats()) { <span class="sm-best">{{ 'RESERVATIONS.BEST_FIT' | translate }}</span> }
                      <svg class="sm-ring" viewBox="0 0 48 48" aria-hidden="true">
                        <circle cx="24" cy="24" r="10" class="sm-top"/>
                        @for (c of chairs(t.seat_count ?? 0); track $index) { <circle [attr.cx]="c.x" [attr.cy]="c.y" r="3.2" class="sm-chair"/> }
                      </svg>
                      <b>{{ t.name }}</b>
                      <small>{{ t.seat_count }} {{ 'TABLES.SEATS' | translate | lowercase }}</small>
                      @if (t.upcoming_reservation) {
                        <span class="sm-up">{{ 'RESERVATIONS.TABLE_UPCOMING' | translate: { table: t.name, time: t.upcoming_reservation.reservation_time, name: t.upcoming_reservation.customer_name } }}</span>
                      }
                    </button>
                  }
                </div>
              } @else {
                <p class="no-tables">{{ 'RESERVATIONS.NO_AVAILABLE_TABLES' | translate }}</p>
              }
            </div>
          </div>
        </div>
      }

      <!-- Cancel confirm -->
      @if (reservationToCancel()) {
        <app-confirmation-modal
          title="RESERVATIONS.CANCEL_CONFIRM_TITLE"
          message="RESERVATIONS.CANCEL_CONFIRM_MESSAGE"
          [confirmText]="'RESERVATIONS.YES_CANCEL_RESERVATION'"
          cancelText="COMMON.CLOSE"
          confirmBtnClass="btn-danger"
          [showSecondaryButton]="false"
          (confirm)="doCancel()"
          (cancel)="reservationToCancel.set(null)"
        />
      }
      <!-- No-show confirm -->
      @if (reservationToNoShow(); as nr) {
        <div class="modal-overlay" (click)="reservationToNoShow.set(null)">
          <div class="ns" (click)="$event.stopPropagation()" role="alertdialog" aria-modal="true">
            <span class="ns-ico" aria-hidden="true">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M17 8l5 5M22 8l-5 5"/></svg>
            </span>
            <h3>{{ 'RESERVATIONS.NO_SHOW_CONFIRM_TITLE' | translate }}</h3>
            <div class="ns-guest">
              <span class="tk-avatar" [style.--h]="hue(nr.customer_name)" aria-hidden="true">{{ initial(nr.customer_name) }}</span>
              <div>
                <b>{{ nr.customer_name }}</b>
                <small>{{ nr.party_size }} {{ 'RESERVATIONS.PERSONS_SHORT' | translate }} · {{ dayLabel(nr.reservation_date) }} · {{ timeLabel(nr.reservation_time) }}</small>
              </div>
            </div>
            <p>{{ 'RESERVATIONS.NO_SHOW_CONFIRM_MESSAGE' | translate }}</p>
            <div class="ns-actions">
              <button type="button" class="rf-btn rf-btn-ghost" (click)="reservationToNoShow.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
              <button type="button" class="rf-btn ns-go" (click)="doNoShow()">{{ 'RESERVATIONS.NO_SHOW' | translate }}</button>
            </div>
          </div>
        </div>
      }
    </app-sidebar>
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .page-header-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .btn-icon { display: inline-flex; align-items: center; gap: 0.35rem; }
    .btn-icon .icon-settings { flex-shrink: 0; }
    .filters { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
    .filter-input, .filter-select { padding: 0.35rem 0.5rem; border: 1px solid #ccc; border-radius: 4px; }
    .reservation-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
    .reservation-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; background: #fff; }
    .reservation-card.status-booked { border-left: 4px solid var(--color-primary); }
    .reservation-card.status-seated { border-left: 4px solid #16a34a; }
    .reservation-card.status-finished { border-left: 4px solid #6b7280; }
    .reservation-card.status-cancelled { border-left: 4px solid #dc2626; opacity: 0.85; }
    .reservation-card.status-no_show { border-left: 4px solid #b45309; opacity: 0.9; }
    .card-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; flex-wrap: wrap; }
    .res-id { font-weight: 600; color: #6b7280; }
    .res-name { font-weight: 600; }
    .status-badge { font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 4px; }
    .status-badge.booked { background: var(--color-primary-light); color: var(--color-primary); }
    .status-badge.seated { background: #dcfce7; color: #15803d; }
    .status-badge.finished { background: #f3f4f6; color: #4b5563; }
    .status-badge.cancelled { background: #fee2e2; color: #b91c1c; }
    .status-badge.no_show { background: #ffedd5; color: #c2410c; }
    .status-badge.waiting { background: #fef3c7; color: #b45309; }
    .status-badge.notified { background: var(--color-primary-light); color: var(--color-primary); }
    .view-tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; border-bottom: 1px solid #e5e7eb; }
    .view-tab { padding: 0.5rem 1rem; border: none; background: transparent; cursor: pointer; font-weight: 500; color: #6b7280; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .view-tab.active { color: var(--color-primary, #2563eb); border-bottom-color: var(--color-primary, #2563eb); }
    .card-body { font-size: 0.9rem; color: #4b5563; margin-bottom: 0.75rem; }
    .table-assigned { font-weight: 500; }
    .card-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .modal-content { background: #fff; border-radius: var(--radius-md, 8px); max-width: min(720px, 96vw); width: 100%; max-height: 90vh; overflow: auto; box-shadow: var(--shadow-lg, 0 12px 32px rgba(0,0,0,0.1)); }
    .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem; border-bottom: 1px solid #e5e7eb; }
    .modal-body { padding: 1rem; }
    .modal-footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 1rem; border-top: 1px solid #e5e7eb; }
    .reservation-modal-hint { font-size: 0.875rem; color: var(--color-text-muted); margin: 0 0 var(--space-3) 0; line-height: 1.45; }
    .form-error { color: var(--color-error); font-size: 0.875rem; margin-top: var(--space-2); }
    .form-hint-block { margin-bottom: 0.5rem; }
    .table-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .table-option { padding: 0.5rem 1rem; text-align: left; border: 1px solid #e5e7eb; border-radius: 4px; background: #fff; cursor: pointer; }
    .table-option:hover { background: #f3f4f6; }
    .no-tables { color: #6b7280; }
    .overbooked-badge { font-size: 0.7rem; padding: 0.15rem 0.4rem; border-radius: 4px; background: #fef2f2; color: #b91c1c; margin-left: 0.25rem; }
    .slot-capacity { font-size: 0.875rem; color: #4b5563; margin-bottom: 0.5rem; }
    .upcoming-no-table-warning { background: #fef3c7; padding: 0.5rem; border-radius: 4px; margin-bottom: 0.75rem; font-size: 0.875rem; }
    .table-option-wrap { margin-bottom: 0.5rem; }
    .table-upcoming-warning { font-size: 0.8rem; color: #b45309; margin-bottom: 0.25rem; }
    .empty-state { text-align: center; padding: 2rem; color: #6b7280; }
    .btn.danger { color: #dc2626; }
    .btn.no-show-btn { color: #b45309; }
    .res-notes { font-size: 0.85rem; margin-top: 0.25rem; }
    .client-notes { color: #4b5563; }
    .owner-notes { color: #6b21a8; }
    .client-tech { margin-top: 0.5rem; font-size: 0.8rem; color: #6b7280; }
    .client-tech summary { cursor: pointer; }
    .client-tech-inner { margin-top: 0.25rem; padding-left: 0.5rem; }
    .client-tech .ua { word-break: break-all; }
    .phone-with-prefill { display: flex; gap: 0.5rem; align-items: center; }
    .phone-with-prefill input { flex: 1; min-width: 0; width: auto; }
    .prefill-message { display: block; margin-top: 0.25rem; font-size: 0.8rem; color: #6b7280; }
    .prefill-message.prefill-success { color: #15803d; }
    .res-meta { font-size: 0.85rem; color: #4b5563; }
    .field-hint { display: block; margin-top: 0.25rem; font-size: 0.8rem; color: #6b7280; }
    .res-booking-controls { margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid #e5e7eb; }
    .res-seating-group .label-block { display: block; font-weight: 500; margin-bottom: 0.35rem; }
    .res-seating-group .radio-row { display: flex; flex-wrap: wrap; gap: 0.75rem 1rem; align-items: center; }
    .res-seating-group .radio-label { display: inline-flex; align-items: center; gap: 0.5rem; font-weight: normal; font-size: 1rem; line-height: 1.4; cursor: pointer; }
    .reservation-modal-form input[type="radio"],
    .reservation-modal-form input[type="checkbox"] { width: 1.125em; height: 1.125em; flex-shrink: 0; margin: 0; padding: 0; border: none; background: transparent; accent-color: var(--color-primary, #2563eb); vertical-align: middle; }
    .res-dietary-notes { display: block; width: 100%; margin-top: 0.35rem; padding: 0.35rem 0.5rem; border: 1px solid #ccc; border-radius: 4px; }

    /* ===== Reservaciones: rediseño ===== */
    .rs-header { margin-bottom: 14px; gap: 12px; flex-wrap: wrap; }
    .rs-title h1 { margin: 0; font-size: 1.75rem; font-weight: 800; letter-spacing: -0.01em; }
    .rs-title p { margin: 2px 0 0; color: var(--color-text-muted); font-weight: 600; font-size: .9rem; }
    .rs-links { display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-radius: 999px; background: var(--color-surface); border: 1px solid var(--color-border); }
    .rs-link { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border-radius: 999px; color: var(--color-text-muted); font-size: .8rem; font-weight: 700; text-decoration: none; transition: background .15s, color .15s; }
    .rs-link:hover { background: var(--color-primary-light); color: var(--color-primary); }
    .rs-icon-btn { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-muted); }
    .rs-icon-btn:hover { background: var(--color-primary-light); color: var(--color-primary); border-color: var(--color-primary); }
    .rs-new { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 22px; border: 0; border-radius: 999px; background: var(--color-primary); color: #fff; font: inherit; font-weight: 800; cursor: pointer; box-shadow: 0 10px 20px -10px var(--color-primary); touch-action: manipulation; }
    .rs-new:hover { filter: brightness(1.07); }

    .rs-tabs { display: inline-flex; gap: 4px; padding: 5px; margin-bottom: 14px; border-radius: 999px; background: var(--color-surface); border: 1px solid var(--color-border); }
    .rs-tab { display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 20px; border: 0; border-radius: 999px; background: transparent; color: var(--color-text-muted); font: inherit; font-weight: 700; cursor: pointer; }
    .rs-tab:hover { background: var(--color-bg); color: var(--color-text); }
    .rs-tab.active { background: var(--color-primary); color: #fff; box-shadow: 0 8px 16px -8px var(--color-primary); }
    .rs-tab-count { display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px; background: var(--color-primary-light); color: var(--color-primary); font-size: .75rem; font-weight: 800; }
    .rs-tab.active .rs-tab-count { background: rgba(255,255,255,.25); color: #fff; }

    .rs-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 14px; }
    .rs-kpi { display: flex; flex-direction: column; gap: 2px; padding: 14px 18px; border-radius: 18px; background: var(--color-surface); border: 1px solid var(--color-border); }
    .rs-kpi span { font-size: .72rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-muted); }
    .rs-kpi strong { font-size: 1.8rem; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.1; }
    .rs-kpi-info strong { color: var(--color-primary); }
    .rs-kpi-ok strong { color: #15803d; }

    .rs-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 16px; }
    .rs-field { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; border-radius: 999px; background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-muted); }
    .rs-field:focus-within { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
    .rs-field input { border: 0; outline: 0; background: transparent; color: var(--color-text); font: inherit; font-weight: 600; min-width: 0; padding: 0; }
    .rs-field-search { flex: 1 1 220px; max-width: 340px; }
    .rs-field-search input { width: 100%; }
    .rs-select { min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--color-border); background: var(--color-surface); font: inherit; font-weight: 600; }
    .rs-refresh { min-height: 44px; padding: 0 18px; border-radius: 999px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text); font: inherit; font-weight: 700; cursor: pointer; }
    .rs-refresh:hover { background: var(--color-bg); }
    .rs-chips { display: flex; flex-wrap: wrap; gap: 6px; flex: 1 1 100%; }
    .rs-chip { min-height: 38px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-muted); font: inherit; font-size: .85rem; font-weight: 700; cursor: pointer; transition: background .15s, color .15s, border-color .15s; }
    .rs-chip:hover { border-color: var(--color-primary); color: var(--color-primary); }
    .rs-chip.on { background: var(--color-primary-light); border-color: var(--color-primary); color: var(--color-primary); box-shadow: inset 0 0 0 1px var(--color-primary); }

    .rs-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 56px 16px; border-radius: 24px; border: 1.5px dashed var(--color-border); background: var(--color-surface); color: var(--color-text-muted); font-weight: 600; text-align: center; }
    .rs-empty-ico { display: grid; place-items: center; width: 84px; height: 84px; border-radius: 26px; background: var(--color-primary-light); color: var(--color-primary); }
    .rs-empty p { margin: 0; }

    .reservation-grid { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px; }
    .rv-card { --rc: var(--color-primary); position: relative; display: flex; flex-direction: column; overflow: hidden; border-radius: 22px; background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 12px 28px -20px rgba(0,0,0,.35); border-left-width: 1px !important; transition: transform .18s, box-shadow .18s; }
    .rv-card:hover { transform: translateY(-3px); box-shadow: 0 2px 4px rgba(0,0,0,.05), 0 20px 34px -20px rgba(0,0,0,.4); }
    .rv-card::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 5px; background: var(--rc); }
    .rv-card.status-booked, .rv-card.status-notified { --rc: var(--color-primary); }
    .rv-card.status-waiting { --rc: #d4a017; }
    .rv-card.status-seated { --rc: #22a05a; }
    .rv-card.status-finished { --rc: #9ca3af; }
    .rv-card.status-cancelled { --rc: #dc2626; opacity: .8; }
    .rv-card.status-no_show { --rc: #d9772b; opacity: .88; }
    .rv-head { display: flex; align-items: center; gap: 14px; padding: 20px 18px 10px; }
    .rv-time { flex: none; display: flex; flex-direction: column; align-items: center; min-width: 76px; padding: 8px 10px; border-radius: 16px; background: color-mix(in srgb, var(--rc) 12%, var(--color-surface)); }
    .rv-time strong { font-size: 1.5rem; font-weight: 800; line-height: 1.05; font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--rc) 70%, #000); }
    .rv-time small { font-size: .68rem; font-weight: 700; text-transform: capitalize; color: var(--color-text-muted); }
    .rv-who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .rv-who h3 { margin: 0; font-size: 1.1rem; font-weight: 800; line-height: 1.2; overflow-wrap: anywhere; }
    .rv-party { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; padding: 2px 10px; border-radius: 999px; background: var(--color-bg); color: var(--color-text); font-size: .85rem; font-weight: 800; }
    .rv-id { color: var(--color-text-muted); }
    .rv-badges { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; align-self: flex-start; }
    .status-badge { padding: 4px 12px; border-radius: 999px; font-size: .72rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
    .rv-body { padding: 4px 18px 14px; display: flex; flex-direction: column; gap: 8px; }
    .rv-line { display: flex; align-items: center; gap: 8px; font-size: .9rem; font-weight: 600; color: var(--color-text); }
    .rv-line svg { flex: none; color: var(--color-text-muted); }
    .rv-line-muted { color: var(--color-text-muted); font-weight: 500; font-size: .82rem; }
    .rv-tags { display: flex; flex-wrap: wrap; gap: 6px; }
    .rv-tag { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 8px; background: var(--color-bg); color: var(--color-text-muted); font-size: .78rem; font-weight: 700; }
    .rv-tag-table { background: var(--color-primary-light); color: var(--color-primary); }
    .rv-tag-warn { background: #fef3c7; color: #a16207; }
    .rv-late-badge { padding: 3px 9px; border-radius: 999px; font-size: .68rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #92400e; background: #fde68a; animation: rv-late-pulse 2s ease-in-out infinite; }
    .rv-delay { display: flex; gap: 12px; align-items: flex-start; margin: 0 14px 6px; padding: 12px 14px; border-radius: 16px; background: linear-gradient(135deg, #fef3c7, #fde68a); color: #78350f; box-shadow: inset 0 0 0 1px rgba(180, 83, 9, .18); }
    .rv-delay b { display: block; font-size: .66rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #92400e; }
    .rv-delay p { margin: 2px 0 0; font-size: .92rem; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
    .rv-delay div { min-width: 0; }
    .rv-delay-bell { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; color: #fff; background: #d97706; box-shadow: 0 0 0 0 rgba(217, 119, 6, .5); animation: rv-bell-ring 2s ease-out infinite; }
    @keyframes rv-bell-ring { 0% { box-shadow: 0 0 0 0 rgba(217, 119, 6, .5); } 70%, 100% { box-shadow: 0 0 0 10px rgba(217, 119, 6, 0); } }
    @keyframes rv-late-pulse { 50% { opacity: .7; } }
    @media (prefers-reduced-motion: reduce) { .rv-delay-bell, .rv-late-badge { animation: none; } }
    .rv-note { padding: 8px 12px; border-radius: 12px; background: var(--color-bg); font-size: .85rem; line-height: 1.35; }
    .rv-note b { display: block; font-size: .68rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-muted); margin-bottom: 1px; }
    .rv-note-warn { background: #fef3c7; color: #6f5106; border-left: 3px solid #d4a017; }
    .rv-note-owner { background: #f5f0ff; color: #5b21b6; border-left: 3px solid #8b5cf6; }
    .rv-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 14px 14px; border-top: 1px solid var(--color-border); background: color-mix(in srgb, var(--color-bg) 60%, var(--color-surface)); }
    .rv-btn { min-height: 38px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text); font: inherit; font-size: .82rem; font-weight: 700; cursor: pointer; touch-action: manipulation; transition: background .15s, border-color .15s, color .15s; }
    .rv-btn:hover:not(:disabled) { border-color: var(--color-primary); color: var(--color-primary); }
    .rv-btn:disabled { opacity: .5; cursor: default; }
    .rv-btn-main { background: var(--color-primary); border-color: var(--color-primary); color: #fff; box-shadow: 0 8px 16px -10px var(--color-primary); }
    .rv-btn-main:hover:not(:disabled) { color: #fff; filter: brightness(1.07); }
    .rv-btn-warn { color: #a8531a; }
    .rv-btn-warn:hover:not(:disabled) { border-color: #d9772b; color: #a8531a; background: #fbe9d9; }
    .rv-btn-danger { color: #b91c1c; }
    .rv-btn-danger:hover:not(:disabled) { border-color: #dc2626; color: #b91c1c; background: #fde8e6; }

    .modal-content { border-radius: 24px; box-shadow: 0 30px 70px -18px rgba(0,0,0,.45); }
    .modal-header { padding: 18px 20px; background: linear-gradient(135deg, var(--color-primary-light), transparent 80%); border-bottom: 0; }
    .modal-header h3 { margin: 0; font-size: 1.25rem; font-weight: 800; }
    .modal-body { padding: 4px 20px 12px; }
    .modal-footer { padding: 14px 20px 18px; }
    .modal-content input:not([type='radio']):not([type='checkbox']), .modal-content select, .modal-content textarea { border-radius: 12px; }
    .modal-footer .btn { border-radius: 999px; font-weight: 800; min-height: 44px; padding: 0 22px; }
    .table-option { border-radius: 14px; padding: 12px 16px; font-weight: 700; }
    .table-option:hover { background: var(--color-primary-light); border-color: var(--color-primary); }

    @media (prefers-reduced-motion: reduce) { .rv-card, .rv-card:hover { transition: none; transform: none; } }
    @media (max-width: 600px) { .rs-links { display: none; } .rv-head { flex-wrap: wrap; } .rv-badges { flex-direction: row; margin-left: auto; } }

    /* ===== Reservaciones: portada del día, tiques, mesas ===== */
    .rs-hero { position: relative; margin-bottom: 16px; padding: 22px 26px 20px; border-radius: 30px; overflow: hidden; background: radial-gradient(70% 120% at 0% 0%, color-mix(in srgb, var(--color-primary) 16%, #fff), transparent 70%), #fffdfa; border: 1px solid var(--color-border); box-shadow: 0 30px 50px -40px rgba(60, 30, 10, .55); }
    .rs-hero-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
    .rs-eyebrow { display: flex; align-items: center; gap: 10px; margin: 0; font-size: .7rem; font-weight: 800; letter-spacing: .22em; text-transform: uppercase; color: var(--color-primary); }
    .rs-eyebrow i { width: 28px; height: 2px; background: var(--color-primary); }
    .rs-hero-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .rs-hero-main { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
    .rs-date { display: flex; align-items: center; gap: 18px; margin: 0; font-weight: 400; flex-wrap: wrap; }
    .rs-date-num { font-family: Georgia, 'Times New Roman', serif; font-size: clamp(4.6rem, 9vw, 7rem); line-height: .85; font-weight: 500; letter-spacing: -.04em; color: var(--color-primary); }
    .rs-date-txt { display: flex; flex-direction: column; gap: 2px; }
    .rs-date-txt b { font-family: Georgia, 'Times New Roman', serif; font-size: clamp(1.5rem, 3vw, 2.2rem); font-style: italic; font-weight: 500; line-height: 1.05; }
    .rs-date-txt span { font-size: .78rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: var(--color-text-muted); }
    .rs-today { align-self: flex-start; padding: 5px 14px; border-radius: 999px; font-style: normal; font-size: .7rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: #fff; background: var(--color-primary); box-shadow: 0 10px 16px -10px var(--color-primary); }
    .rs-stats { display: flex; margin: 0; }
    .rs-stats > div { padding: 2px 22px; border-left: 1px dashed var(--color-border); }
    .rs-stats > div:first-child { border-left: 0; padding-left: 0; }
    .rs-stats dt { font-size: .64rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--color-text-muted); }
    .rs-stats dd { margin: 2px 0 0; font-family: Georgia, 'Times New Roman', serif; font-size: 2.3rem; line-height: 1; font-variant-numeric: tabular-nums; }
    .rs-stat-info dd { color: var(--color-primary); }
    .rs-stat-ok dd { color: #15803d; }
    .rs-flow { display: flex; gap: 3px; height: 6px; margin: 18px 0 16px; border-radius: 999px; overflow: hidden; background: var(--color-border); }
    .rs-flow span { flex: 0 1 0; min-width: 0; transition: flex-grow .4s; }
    .rs-flow-b { background: var(--color-primary); }
    .rs-flow-s { background: #22a05a; }
    .rs-flow-f { background: #a8a29e; }

    .rs-strip { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .rs-strip-arrow { flex: none; width: 40px; height: 40px; border: 0; border-radius: 50%; background: #fff; color: var(--color-primary); font-size: 1.3rem; font-weight: 800; line-height: 1; cursor: pointer; box-shadow: 0 6px 12px -8px rgba(0,0,0,.4), 0 0 0 1px var(--color-border); }
    .rs-strip-arrow:hover { background: var(--color-primary); color: #fff; }
    .rs-days { display: flex; gap: 6px; flex: 1 1 auto; min-width: 0; overflow-x: auto; scrollbar-width: none; padding: 2px; }
    .rs-days::-webkit-scrollbar { display: none; }
    .rs-day { flex: 1 0 54px; display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 8px 4px 9px; border: 0; border-radius: 18px; background: transparent; color: var(--color-text); font: inherit; cursor: pointer; transition: background .15s; position: relative; }
    .rs-day small { font-size: .62rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--color-text-muted); }
    .rs-day b { font-family: Georgia, 'Times New Roman', serif; font-size: 1.35rem; font-weight: 500; font-variant-numeric: tabular-nums; }
    .rs-day:hover { background: color-mix(in srgb, var(--color-primary) 10%, #fff); }
    .rs-day.today::after { content: ''; position: absolute; bottom: 3px; width: 5px; height: 5px; border-radius: 50%; background: var(--color-primary); }
    .rs-day.on { color: #fff; background: linear-gradient(150deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 62%, #000)); box-shadow: 0 14px 20px -12px var(--color-primary); }
    .rs-day.on small { color: rgba(255,255,255,.85); }
    .rs-day.on.today::after { background: #fff; }
    .rs-gotoday { flex: none; min-height: 40px; padding: 0 16px; border: 1px solid var(--color-primary); border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 10%, #fff); color: var(--color-primary); font: inherit; font-size: .82rem; font-weight: 800; cursor: pointer; }
    .rs-gotoday:hover { background: var(--color-primary); color: #fff; }
    @media (max-width: 700px) { .rs-hero { padding: 18px 16px; } .rs-stats > div { padding: 2px 14px; } .rs-picker { order: 5; } }

    /* ticket card */
    .reservation-grid { grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); }
    .tk { --rc: var(--color-primary); position: relative; display: flex; min-width: 0; border-radius: 24px; background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 18px 32px -24px rgba(60, 30, 10, .5); transition: transform .18s, box-shadow .18s; }
    .tk:hover { transform: translateY(-3px); box-shadow: 0 2px 4px rgba(0,0,0,.05), 0 26px 38px -24px rgba(60, 30, 10, .55); }
    .tk.status-booked { --rc: var(--color-primary); }
    .tk.status-seated { --rc: #22a05a; }
    .tk.status-finished { --rc: #9ca3af; }
    .tk.status-cancelled { --rc: #dc2626; opacity: .78; }
    .tk.status-no_show { --rc: #d9772b; opacity: .88; }
    .tk.is-late { box-shadow: 0 0 0 2px #fbbf24, 0 18px 32px -24px rgba(180, 83, 9, .55); }
    .tk-stub { flex: none; width: 104px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 20px 10px; border-radius: 23px 0 0 23px; color: #fff; text-align: center; background: linear-gradient(160deg, var(--rc), color-mix(in srgb, var(--rc) 58%, #000)); }
    .tk-time { font-family: Georgia, 'Times New Roman', serif; font-size: 1.95rem; font-style: italic; line-height: 1; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
    .tk-day { font-size: .66rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; opacity: .9; }
    .tk-num { margin-top: 8px; padding: 2px 9px; border-radius: 999px; font-size: .68rem; font-weight: 800; background: rgba(255,255,255,.2); }
    .tk-perf { position: relative; flex: none; width: 0; border-left: 2px dashed var(--color-border); }
    .tk-perf::before, .tk-perf::after { content: ''; position: absolute; left: -13px; width: 24px; height: 24px; border-radius: 50%; background: var(--color-bg); box-shadow: inset 0 0 0 1px var(--color-border); }
    .tk-perf::before { top: -13px; clip-path: inset(50% 0 0 0); }
    .tk-perf::after { bottom: -13px; clip-path: inset(0 0 50% 0); }
    .tk-main { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 16px 16px 14px; gap: 10px; }
    .tk-head { display: flex; align-items: flex-start; gap: 12px; }
    .tk-avatar { --h: 20; flex: none; display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; font-weight: 800; font-size: 1.05rem; color: hsl(var(--h) 55% 28%); background: hsl(var(--h) 70% 88%); box-shadow: inset 0 0 0 2px hsl(var(--h) 70% 76%); }
    .tk-who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
    .tk-who h3 { margin: 0; font-size: 1.08rem; font-weight: 800; line-height: 1.2; overflow-wrap: anywhere; }
    .tk-party { display: inline-flex; align-items: center; gap: 8px; font-size: .8rem; font-weight: 700; color: var(--color-text-muted); }
    .tk-dots { display: inline-flex; align-items: center; gap: 3px; }
    .tk-dots i { width: 8px; height: 8px; border-radius: 50%; background: var(--rc, var(--color-primary)); }
    .tk-dots em { font-style: normal; font-size: .7rem; font-weight: 800; color: var(--color-primary); }
    .tk-badges { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .tk-body { display: flex; flex-direction: column; gap: 8px; }
    .tk .rv-delay { margin: 0; }
    .tk-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding-top: 12px; border-top: 1px dashed var(--color-border); }
    .tk-spacer { flex: 1; }
    .tk-btn { min-height: 36px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--color-bg); color: var(--color-text); font: inherit; font-size: .8rem; font-weight: 700; cursor: pointer; touch-action: manipulation; transition: background .15s, color .15s; }
    .tk-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--color-primary) 12%, #fff); color: var(--color-primary); }
    .tk-btn:disabled { opacity: .5; cursor: default; }
    .tk-btn-main { display: inline-flex; align-items: center; gap: 8px; padding: 0 18px; color: #fff; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 70%, #000)); box-shadow: 0 12px 18px -12px var(--color-primary); }
    .tk-btn-main:hover:not(:disabled) { color: #fff; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 70%, #000)); filter: brightness(1.08); }
    .tk-btn-main i { font-style: normal; transition: transform .2s; }
    .tk-btn-main:hover i { transform: translateX(3px); }
    .tk-btn-warn { color: #a8531a; background: transparent; }
    .tk-btn-warn:hover:not(:disabled) { background: #fbe9d9; color: #a8531a; }
    .tk-btn-danger { color: #b91c1c; background: transparent; }
    .tk-btn-danger:hover:not(:disabled) { background: #fde8e6; color: #b91c1c; }
    @media (max-width: 480px) {
      .reservation-grid { grid-template-columns: minmax(0, 1fr); }
      .tk { flex-direction: column; }
      .tk-stub { width: auto; flex-direction: row; justify-content: space-between; gap: 10px; padding: 12px 16px; border-radius: 23px 23px 0 0; }
      .tk-num { margin: 0; }
      .tk-perf { width: auto; height: 0; border-left: 0; border-top: 2px dashed var(--color-border); }
      .tk-perf::before, .tk-perf::after { display: none; }
    }
    @media (prefers-reduced-motion: reduce) { .tk, .tk:hover { transition: none; transform: none; } .rs-flow span { transition: none; } }

    /* seat-at-table modal */
    .sm { width: 100%; max-width: min(640px, 96vw); max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; border-radius: 28px; background: var(--color-surface); box-shadow: 0 30px 70px -18px rgba(0,0,0,.5); }
    .sm-head { display: flex; align-items: center; gap: 14px; padding: 20px 22px 16px; background: linear-gradient(150deg, color-mix(in srgb, var(--color-primary) 16%, #fff), transparent 80%); }
    .sm-avatar { width: 54px; height: 54px; font-size: 1.3rem; }
    .sm-head-text { flex: 1; min-width: 0; }
    .sm-head-text small { display: block; font-size: .64rem; font-weight: 800; letter-spacing: .2em; text-transform: uppercase; color: var(--color-primary); }
    .sm-head-text h3 { margin: 2px 0 4px; font-family: Georgia, 'Times New Roman', serif; font-size: 1.5rem; font-weight: 500; overflow-wrap: anywhere; }
    .sm-head-text p { display: flex; align-items: center; gap: 8px; margin: 0; font-size: .85rem; font-weight: 700; color: var(--color-text-muted); }
    .sm-head-text .tk-dots i { background: var(--color-primary); }
    .sm-body { padding: 8px 22px 22px; overflow-y: auto; }
    .sm-hint { margin: 0 0 12px; font-size: .85rem; font-weight: 600; color: var(--color-text-muted); }
    .sm-warn { margin: 0 0 12px; padding: 10px 14px; border-radius: 14px; background: #fef3c7; color: #78350f; font-size: .85rem; font-weight: 600; }
    .sm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 12px; }
    .sm-table { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 16px 10px 14px; border: 1.5px solid var(--color-border); border-radius: 22px; background: #fffdfa; color: var(--color-text); font: inherit; cursor: pointer; touch-action: manipulation; transition: transform .15s, border-color .15s, box-shadow .15s; }
    .sm-table:hover { transform: translateY(-3px); border-color: var(--color-primary); box-shadow: 0 18px 26px -18px var(--color-primary); }
    .sm-table.best { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 7%, #fff); }
    .sm-table.warn { border-color: #fbbf24; }
    .sm-table b { font-size: 1rem; font-weight: 800; overflow-wrap: anywhere; text-align: center; }
    .sm-table small { font-size: .74rem; font-weight: 700; color: var(--color-text-muted); }
    .sm-ring { width: 64px; height: 64px; margin-bottom: 6px; }
    .sm-top { fill: color-mix(in srgb, var(--color-primary) 18%, #fff); stroke: var(--color-primary); stroke-width: 1.5; }
    .sm-chair { fill: var(--color-primary); }
    .sm-best { position: absolute; top: -9px; padding: 2px 10px; border-radius: 999px; font-size: .62rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #fff; background: var(--color-primary); box-shadow: 0 8px 12px -8px var(--color-primary); }
    .sm-up { margin-top: 6px; font-size: .68rem; font-weight: 700; line-height: 1.25; text-align: center; color: #b45309; }
    @media (prefers-reduced-motion: reduce) { .sm-table, .sm-table:hover { transition: none; transform: none; } }

    /* no-show modal */
    .ns { width: 100%; max-width: min(440px, 94vw); padding: 28px 26px 22px; display: flex; flex-direction: column; align-items: center; text-align: center; border-radius: 28px; background: var(--color-surface); box-shadow: 0 30px 70px -18px rgba(0,0,0,.5); }
    .ns-ico { display: grid; place-items: center; width: 68px; height: 68px; margin-bottom: 12px; border-radius: 50%; color: #b45309; background: #fef3c7; box-shadow: 0 0 0 8px #fffbeb; }
    .ns h3 { margin: 0 0 14px; font-family: Georgia, 'Times New Roman', serif; font-size: 1.55rem; font-weight: 500; }
    .ns-guest { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; border-radius: 18px; background: var(--color-bg); border: 1px dashed var(--color-border); text-align: left; }
    .ns-guest div { min-width: 0; }
    .ns-guest b { display: block; font-weight: 800; overflow-wrap: anywhere; }
    .ns-guest small { font-size: .78rem; font-weight: 700; color: var(--color-text-muted); }
    .ns p { margin: 14px 0 20px; font-size: .92rem; line-height: 1.5; color: var(--color-text-muted); }
    .ns-actions { display: flex; gap: 10px; width: 100%; }
    .ns-actions .rf-btn { flex: 1; padding: 0 12px; }
    .rf-btn.ns-go { border: 0; color: #fff; background: linear-gradient(135deg, #f59e0b, #b45309); box-shadow: 0 12px 20px -12px #b45309; }
    .rf-btn.ns-go:hover { filter: brightness(1.06); }

    /* ===== Nueva reservación (formulario) ===== */
    .rf { max-width: min(760px, 96vw); padding: 0; display: flex; flex-direction: column; overflow: hidden; border-radius: 26px; }
    .rf-head { display: flex; align-items: center; gap: 14px; padding: 18px 22px 16px; background: linear-gradient(135deg, var(--color-primary-light), transparent 80%); }
    .rf-icon { flex: none; display: grid; place-items: center; width: 50px; height: 50px; border-radius: 16px; background: var(--color-primary); color: #fff; box-shadow: 0 10px 18px -10px var(--color-primary); }
    .rf-head-text { flex: 1; min-width: 0; }
    .rf-head-text h3 { margin: 0; font-size: 1.3rem; font-weight: 800; }
    .rf-head-text p { margin: 2px 0 0; min-height: 1.1em; font-size: .88rem; font-weight: 700; color: var(--color-primary); }
    .rf-close { flex: none; width: 40px; height: 40px; border: 0; border-radius: 50%; background: transparent; color: var(--color-text-muted); cursor: pointer; display: grid; place-items: center; }
    .rf-close:hover { background: var(--color-bg); color: var(--color-text); }
    .rf-form { display: flex; flex-direction: column; min-height: 0; flex: 1; }
    .rf-body { padding: 4px 22px 8px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
    .rf-sec { padding: 16px; border-radius: 20px; background: var(--color-bg); border: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 14px; }
    .rf-sec h4 { margin: 0; display: flex; align-items: center; gap: 10px; font-size: .8rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--color-text-muted); }
    .rf-sec h4 i { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--color-primary); color: #fff; font-style: normal; font-size: .75rem; letter-spacing: 0; }
    .rf-group { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .rf-label { font-size: .78rem; font-weight: 700; color: var(--color-text-muted); margin: 0; }
    .rf-two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 560px) { .rf-two { grid-template-columns: 1fr; } }
    .rf input:not([type='radio']):not([type='checkbox']), .rf select, .rf textarea { width: 100%; min-height: 46px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); color: var(--color-text); font: inherit; font-weight: 600; box-sizing: border-box; }
    .rf textarea { padding: 10px 12px; min-height: 72px; }
    .rf input:focus, .rf select:focus, .rf textarea:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }

    .rf-party { display: flex; align-items: center; justify-content: center; gap: 16px; }
    .rf-step { flex: none; width: 52px; height: 52px; border-radius: 16px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text); font-size: 1.6rem; line-height: 1; cursor: pointer; touch-action: manipulation; transition: transform .12s, border-color .15s; }
    .rf-step:hover:not(:disabled) { border-color: var(--color-primary); color: var(--color-primary); }
    .rf-step:active:not(:disabled) { transform: scale(.92); }
    .rf-step:disabled { opacity: .4; cursor: default; }
    .rf-step-plus { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
    .rf-step-plus:hover:not(:disabled) { color: #fff; filter: brightness(1.08); }
    .rf-party-box { display: flex; flex-direction: column; align-items: center; min-width: 110px; margin: 0; }
    .rf .rf-party-box input { width: 96px; min-height: 0; padding: 0; border: 0; background: transparent; box-shadow: none; text-align: center; font-size: 2.6rem; font-weight: 800; line-height: 1.1; color: var(--color-primary); -moz-appearance: textfield; appearance: textfield; }
    .rf .rf-party-box input::-webkit-outer-spin-button, .rf .rf-party-box input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .rf-party-box span { font-size: .72rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--color-text-muted); }

    .rf-seg { display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-radius: 999px; background: var(--color-surface); border: 1px solid var(--color-border); align-self: flex-start; }
    .rf-seg button { min-height: 38px; padding: 0 18px; border: 0; border-radius: 999px; background: transparent; color: var(--color-text-muted); font: inherit; font-weight: 700; cursor: pointer; }
    .rf-seg button.on { background: var(--color-primary); color: #fff; box-shadow: 0 6px 12px -8px var(--color-primary); }
    .rf-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .rf-card-opt { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 68px; padding: 8px 6px; border-radius: 16px; border: 1.5px solid var(--color-border); background: var(--color-surface); color: var(--color-text-muted); font: inherit; font-size: .82rem; font-weight: 700; cursor: pointer; touch-action: manipulation; transition: border-color .15s, background .15s, color .15s; }
    .rf-card-opt span { text-align: center; line-height: 1.15; }
    .rf-card-opt:hover { border-color: var(--color-primary); }
    .rf-card-opt.on { border-color: var(--color-primary); background: var(--color-primary-light); color: var(--color-primary); box-shadow: inset 0 0 0 1px var(--color-primary); }

    .rf-capacity { display: flex; flex-wrap: wrap; gap: 8px; }
    .rf-capacity span { padding: 6px 14px; border-radius: 999px; background: rgba(34,197,94,.12); color: #15803d; font-size: .82rem; font-weight: 700; }
    .rf-capacity b { font-weight: 800; font-size: .95rem; }
    .rf-prefill { flex: none; min-height: 46px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--color-primary); background: var(--color-primary-light); color: var(--color-primary); font: inherit; font-size: .8rem; font-weight: 800; cursor: pointer; white-space: nowrap; }
    .rf-prefill:disabled { opacity: .5; cursor: default; }
    .rf-error { padding: 10px 12px; border-radius: 12px; background: rgba(220,38,38,.08); }
    .rf-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 22px 18px; border-top: 1px solid var(--color-border); background: var(--color-surface); }
    .rf-btn { min-height: 48px; padding: 0 28px; border-radius: 999px; font: inherit; font-weight: 800; cursor: pointer; touch-action: manipulation; }
    .rf-btn-ghost { background: transparent; border: 1px solid var(--color-border); color: var(--color-text); }
    .rf-btn-main { border: 0; background: var(--color-primary); color: #fff; box-shadow: 0 10px 20px -10px var(--color-primary); }
    .rf-btn-main:hover { filter: brightness(1.07); }

    /* ===== Nueva / editar reservación: acabado ===== */
    .modal-overlay { backdrop-filter: blur(3px); background: rgba(28, 25, 23, .45); }
    .rf { border-radius: 30px; background: #fffdfa; box-shadow: 0 40px 90px -24px rgba(40, 20, 5, .6); }
    .rf-head { position: relative; padding: 24px 26px 20px; background: radial-gradient(90% 160% at 0% 0%, color-mix(in srgb, var(--color-primary) 24%, #fff), transparent 72%), #fffdfa; }
    .rf-head::after { content: ''; position: absolute; left: 20px; right: 20px; bottom: 0; border-bottom: 2px dashed var(--color-border); }
    .rf-icon, .rf-avatar { flex: none; width: 58px; height: 58px; border-radius: 20px; }
    .rf-icon { background: linear-gradient(150deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #000)); box-shadow: 0 16px 24px -14px var(--color-primary); }
    .rf-avatar { border-radius: 50%; font-size: 1.5rem; }
    .rf-head-text small { display: block; font-size: .66rem; font-weight: 800; letter-spacing: .22em; text-transform: uppercase; color: var(--color-primary); }
    .rf-head-text h3 { margin: 2px 0 6px; font-family: Georgia, 'Times New Roman', serif; font-size: 1.85rem; font-weight: 500; letter-spacing: -.02em; line-height: 1.1; overflow-wrap: anywhere; }
    .rf-head-text p { margin: 0; }
    .rf-head-text p span { display: inline-block; padding: 4px 14px; border-radius: 999px; font-size: .8rem; font-weight: 800; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, #fff); }
    .rf-body { padding: 18px 24px 10px; gap: 16px; }
    .rf-sec { padding: 20px 20px 22px; gap: 16px; border-radius: 24px; background: #fff; border: 1px solid var(--color-border); box-shadow: 0 18px 30px -26px rgba(60, 30, 10, .5); }
    .rf-sec h4 { gap: 12px; font-family: Georgia, 'Times New Roman', serif; font-size: 1.15rem; font-weight: 500; font-style: italic; letter-spacing: 0; text-transform: none; color: var(--color-text); }
    .rf-sec h4 i { width: 30px; height: 30px; font-family: inherit; font-size: .9rem; font-style: normal; font-weight: 800; background: linear-gradient(150deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 62%, #000)); box-shadow: 0 10px 14px -8px var(--color-primary); }
    .rf-label { font-size: .64rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    .rf input:not([type='radio']):not([type='checkbox']), .rf select, .rf textarea { border-radius: 16px; background: #fffdfa; }
    .rf-step { border-radius: 50%; width: 54px; height: 54px; box-shadow: 0 8px 14px -10px rgba(0,0,0,.4); }
    .rf-step-plus { background: linear-gradient(150deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 62%, #000)); box-shadow: 0 14px 20px -12px var(--color-primary); }
    .rf .rf-party-box input { font-family: Georgia, 'Times New Roman', serif; font-size: 3.4rem; font-weight: 500; }
    .rf-dots { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; min-height: 9px; margin-top: 4px; max-width: 110px; }
    .rf-dots i { width: 8px; height: 8px; border-radius: 50%; background: var(--color-primary); }
    .rf-seg { border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 7%, #fff); border-color: transparent; }
    .rf-seg button.on { background: linear-gradient(150deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 62%, #000)); box-shadow: 0 10px 14px -8px var(--color-primary); }
    .rf-card-opt { border-radius: 20px; }
    .rf-card-opt.on { background: linear-gradient(150deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 62%, #000)); border-color: transparent; color: #fff; box-shadow: 0 14px 20px -12px var(--color-primary); }
    .rf-capacity span { background: color-mix(in srgb, var(--color-primary) 10%, #fff); color: var(--color-primary); }
    .rf-foot { position: relative; align-items: center; padding: 16px 24px 20px; background: #fffdfa; border-top: 2px dashed var(--color-border); }
    .rf-foot-sum { flex: 1; min-width: 0; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 1.05rem; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rf-btn-main { display: inline-flex; align-items: center; gap: 10px; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 66%, #000)); box-shadow: 0 16px 24px -14px var(--color-primary); }
    .rf-btn-main i { font-style: normal; transition: transform .2s; }
    .rf-btn-main:hover i { transform: translateX(4px); }
    @media (max-width: 560px) { .rf-foot-sum { display: none; } .rf-head { padding: 18px 18px 16px; } .rf-body { padding: 14px 14px 8px; } }
  `],
})
export class ReservationsComponent implements OnInit, OnDestroy {
  @ViewChild(ReservationWeekSlotGridComponent) private weekSlotGrid?: ReservationWeekSlotGridComponent;

  private api = inject(ApiService);
  private permissions = inject(PermissionService);
  private translate = inject(TranslateService);
  private apiErr = inject(ApiErrorMessageService);

  /** Public tenant (timezone for week grid, same as /book). */
  tenantSummary = signal<TenantSummary | null>(null);

  loading = signal(false);
  reservations = signal<Reservation[]>([]);

  /** Header numbers for the loaded list (cancelled / no-show do not count as guests). */
  resStats = computed(() => {
    const list = this.reservations();
    const active = list.filter((r) => r.status !== 'cancelled' && r.status !== 'no_show');
    return {
      total: active.length,
      guests: active.reduce((sum, r) => sum + (r.party_size || 0), 0),
      booked: list.filter((r) => r.status === 'booked').length,
      seated: list.filter((r) => r.status === 'seated').length,
    };
  });

  /** Big date of the hero (weekday / day / month / year). */
  filterParts(): { weekday: string; day: string; month: string; year: string } {
    const d = new Date((this.filterDate || '') + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return { weekday: '', day: '', month: '', year: '' };
    const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
    return {
      weekday: cap(d.toLocaleDateString(undefined, { weekday: 'long' })),
      day: String(d.getDate()),
      month: cap(d.toLocaleDateString(undefined, { month: 'long' })),
      year: String(d.getFullYear()),
    };
  }

  isFilterToday(): boolean {
    return this.filterDate === this.localCalendarTodayYyyyMmDd();
  }

  /** Seven days around the selected one, for the quick day strip. */
  stripDays(): { date: string; weekday: string; day: number; today: boolean }[] {
    const base = new Date((this.filterDate || this.localCalendarTodayYyyyMmDd()) + 'T12:00:00');
    const today = this.localCalendarTodayYyyyMmDd();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i - 3);
      const date = this.localCalendarTodayYyyyMmDd(d);
      return {
        date,
        weekday: d.toLocaleDateString(undefined, { weekday: 'short' }).replace('.', ''),
        day: d.getDate(),
        today: date === today,
      };
    });
  }

  pickDate(date: string | null): void {
    if (!date || date === this.filterDate) return;
    this.filterDate = date;
    this.load();
  }

  shiftDay(delta: number): void {
    const d = new Date((this.filterDate || this.localCalendarTodayYyyyMmDd()) + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    this.pickDate(this.localCalendarTodayYyyyMmDd(d));
  }

  goToday(): void {
    this.pickDate(this.localCalendarTodayYyyyMmDd());
  }

  /** Share of the day's pending / seated / finished reservations (bar in the hero). */
  flow = computed(() => {
    const list = this.reservations();
    const n = (st: string) => list.filter((r) => r.status === st).length;
    return { booked: n('booked'), seated: n('seated'), finished: n('finished') };
  });

  hue(name: string): number {
    let h = 0;
    for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }

  initial(name: string): string {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  partyDots(n: number): number[] {
    return Array.from({ length: Math.max(0, Math.min(8, n || 0)) }, (_, i) => i);
  }

  /** Chair positions around a round table (viewBox 48). */
  chairs(n: number): { x: number; y: number }[] {
    const count = Math.max(0, Math.min(12, n));
    return Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 - Math.PI / 2;
      return { x: +(24 + 17 * Math.cos(a)).toFixed(2), y: +(24 + 17 * Math.sin(a)).toFixed(2) };
    });
  }

  /** Smallest table that still fits the party: highlighted as the ideal choice. */
  bestFitSeats = computed(() => {
    const seats = this.availableTablesForSeat().map((t) => t.seat_count ?? 0);
    return seats.length ? Math.min(...seats) : -1;
  });

  stepParty(delta: number): void {
    const next = Math.min(this.maxPartySize(), Math.max(1, (Number(this.formPartySize) || 1) + delta));
    if (next === this.formPartySize) return;
    this.formPartySize = next;
    this.loadSlotCapacity();
  }

  setFormService(value: 'all' | 'lunch' | 'dinner'): void {
    this.formService = value;
    this.loadSlotCapacity();
  }

  setFormSeating(value: string): void {
    this.formSeating = value as typeof this.formSeating;
    this.onSeatingPreferenceChange();
    this.loadSlotCapacity();
  }

  /** Header line of the form: "4 personas · mié 21 oct · 20:00" once something is chosen. */
  formSummary(): string {
    const parts: string[] = [];
    if (this.formPartySize) parts.push(`${this.formPartySize} ${this.translate.instant('RESERVATIONS.PERSONS_SHORT')}`);
    if (this.formDate) parts.push(this.dayLabel(this.formDate));
    if (this.formTime) parts.push(this.timeLabel(this.formTime));
    return parts.join(' · ');
  }

  setStatusFilter(value: string): void {
    this.filterStatus = value;
    this.load();
  }

  /** "Martes, 21 de octubre" for the selected date. */
  filterDateLabel(): string {
    if (!this.filterDate) return '';
    const d = new Date(this.filterDate + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return '';
    const label = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  timeLabel(time: string): string {
    return (time || '').slice(0, 5);
  }

  dayLabel(date: string): string {
    const d = new Date((date || '') + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return date;
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  viewTab = signal<'reservations' | 'waitlist'>('reservations');
  waitlistLoading = signal(false);
  waitingList = signal<WaitingListEntry[]>([]);
  waitlistFilterPhone = '';
  waitlistFilterStatus = '';
  tablesWithStatus = signal<CanvasTable[]>([]);
  filterDate = '';
  filterPhone = '';
  filterStatus = '';
  showForm = signal(false);
  editingReservation = signal<Reservation | null>(null);
  formName = '';
  formPhone = '';
  formEmail = '';
  formClientNotes = '';
  formOwnerNotes = '';
  formDate = '';
  formTime = '';
  formPartySize = 1;
  /** lunch/dinner/all — week grid when opening hours have a break */
  formService: 'all' | 'lunch' | 'dinner' = 'all';
  /** Allergies / special requirements (synced to allergies_* and customer_notes on save). */
  formDietaryNotes = '';
  formSeating: 'no_preference' | 'indoor' | 'terrace' = 'no_preference';
  /** Bookable floor for zone-scoped slot grid (same semantics as public /book `formFloorId`). */
  formFloorId: number | null = null;
  bookZones = signal<ReservationBookZone[]>([]);
  formError = signal<string | null>(null);
  reservationToSeat = signal<Reservation | null>(null);
  reservationToCancel = signal<Reservation | null>(null);
  reservationToNoShow = signal<Reservation | null>(null);
  sendingReminderId = signal<number | null>(null);
  overbookingReport = signal<OverbookingReport | null>(null);
  slotCapacity = signal<{ seats_left: number; tables_left: number } | null>(null);
  upcomingNoTableCount = signal<number | null>(null);
  prefillLoading = signal(false);
  prefillMessage = signal<string | null>(null);
  prefillSuccess = signal(false);

  canWrite = () => this.permissions.hasPermission(this.permissions.getCurrentUser(), 'reservation:write');

  hasMealSplit = computed(() => tenantOpeningHoursHasMealSplit(this.tenantSummary()?.opening_hours ?? null));

  serviceOptionLabel(service: 'all' | 'lunch' | 'dinner'): string {
    return resolveBookingServiceLabel(
      this.tenantSummary()?.opening_hours ?? null,
      service,
      {
        all: this.translate.instant('BOOK.SERVICE_ALL'),
        lunch: this.translate.instant('BOOK.SERVICE_LUNCH'),
        dinner: this.translate.instant('BOOK.SERVICE_DINNER'),
      },
      this.formDate || null,
    );
  }

  maxPartySize = computed(() => {
    const cap = this.tenantSummary()?.reservation_max_guests_per_slot;
    if (cap != null && cap > 0) return Math.min(20, cap);
    return 20;
  });

  get tenantId(): number | undefined {
    const tid = this.permissions.getCurrentUser()?.tenant_id;
    return tid ?? undefined;
  }

  private wsSub?: Subscription;

  ngOnInit() {
    const tid = this.permissions.getCurrentUser()?.tenant_id;
    if (tid) {
      this.api.getPublicTenant(tid).subscribe({
        next: (t) => {
          this.tenantSummary.set(t);
          this.api.getReservationBookZones(tid).subscribe({
            next: (z) => {
              this.bookZones.set(z.floors);
              if (this.showForm()) this.onSeatingPreferenceChange();
            },
            error: () => this.bookZones.set([]),
          });
        },
        error: () => this.tenantSummary.set(null),
      });
    }
    const today = this.localCalendarTodayYyyyMmDd();
    this.filterDate = today;
    this.load();
    this.loadTables();
    try {
      this.api.connectWebSocket();
      this.wsSub = this.api.reservationUpdates$.subscribe(() => {
        if (this.viewTab() === 'waitlist') {
          this.loadWaitlist();
        } else {
          this.load();
          this.loadTables();
        }
      });
    } catch {
      // continue without WebSocket
    }
  }

  ngOnDestroy() {
    this.wsSub?.unsubscribe();
  }

  setViewTab(tab: 'reservations' | 'waitlist') {
    this.viewTab.set(tab);
    if (tab === 'waitlist') {
      this.loadWaitlist();
    } else {
      this.load();
    }
  }

  loadWaitlist() {
    this.waitlistLoading.set(true);
    const status = this.waitlistFilterStatus || undefined;
    this.api.getWaitingList({
      phone: this.waitlistFilterPhone || undefined,
      status,
      active_only: !status,
    }).subscribe({
      next: (list) => {
        this.waitingList.set(list);
        this.waitlistLoading.set(false);
      },
      error: () => this.waitlistLoading.set(false),
    });
  }

  getWaitlistStatusLabel(s: WaitingListStatus): string {
    const key: Record<string, string> = {
      waiting: 'RESERVATIONS.WL_STATUS_WAITING',
      notified: 'RESERVATIONS.WL_STATUS_NOTIFIED',
      seated: 'RESERVATIONS.WL_STATUS_SEATED',
      cancelled: 'RESERVATIONS.WL_STATUS_CANCELLED',
      no_show: 'RESERVATIONS.WL_STATUS_NO_SHOW',
    };
    return key[s] ?? s;
  }

  formatWaitlistTime(iso: string): string {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  updateWaitlistStatus(entry: WaitingListEntry, status: WaitingListStatus) {
    this.api.updateWaitingListStatus(entry.id, status).subscribe({
      next: () => this.loadWaitlist(),
      error: () => {},
    });
  }

  convertWaitlistToReservation(entry: WaitingListEntry) {
    this.setViewTab('reservations');
    this.openCreate();
    this.formName = entry.customer_name;
    this.formPhone = entry.customer_phone;
    this.formPartySize = entry.party_size;
    this.api.updateWaitingListStatus(entry.id, 'seated').subscribe({
      next: () => this.loadWaitlist(),
      error: () => {},
    });
  }

  load() {
    this.loading.set(true);
    this.api.getReservations({
      date: this.filterDate || undefined,
      status: this.filterStatus || undefined,
      phone: this.filterPhone || undefined,
    }).subscribe({
      next: (list) => { this.reservations.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    if (this.filterDate) {
      this.api.getOverbookingReport(this.filterDate).subscribe({
        next: (report) => this.overbookingReport.set(report),
        error: () => this.overbookingReport.set(null),
      });
    } else {
      this.overbookingReport.set(null);
    }
  }

  loadTables() {
    this.api.getTablesWithStatus().subscribe((list) => this.tablesWithStatus.set(list));
  }

  getStatusLabel(s: ReservationStatus): string {
    const key: Record<string, string> = {
      booked: 'RESERVATIONS.STATUS_BOOKED',
      seated: 'RESERVATIONS.STATUS_SEATED',
      finished: 'RESERVATIONS.STATUS_FINISHED',
      cancelled: 'RESERVATIONS.STATUS_CANCELLED',
      no_show: 'RESERVATIONS.STATUS_NO_SHOW',
    };
    return key[s] ?? s;
  }

  serviceTypeLabel(s: string): string {
    if (s === 'lunch' || s === 'dinner') {
      return resolveBookingServiceLabel(
        this.tenantSummary()?.opening_hours ?? null,
        s,
        {
          all: this.translate.instant('BOOK.SERVICE_ALL'),
          lunch: this.translate.instant('BOOK.SERVICE_LUNCH'),
          dinner: this.translate.instant('BOOK.SERVICE_DINNER'),
        },
      );
    }
    return s;
  }

  seatingLabel(s: string): string {
    const k: Record<string, string> = {
      indoor: 'BOOK.SEATING_INDOOR',
      terrace: 'BOOK.SEATING_TERRACE',
      no_preference: 'BOOK.SEATING_ANY',
    };
    return this.translate.instant(k[s] || s);
  }


  getTableName(tableId: number): string {
    return this.tablesWithStatus().find(t => t.id === tableId)?.name ?? String(tableId);
  }

  /** Table to show in list: API table_name, or lookup by id, or "not assigned". */
  getTableDisplay(r: Reservation): string {
    if (r.table_name) return r.table_name;
    if (r.table_id != null) return this.getTableName(r.table_id);
    return this.translate.instant('RESERVATIONS.TABLE_NOT_ASSIGNED');
  }

  dietaryNotesLine(r: Reservation): string | null {
    return reservationDietaryNotesDisplay(r);
  }

  isSlotOverbooked(r: Reservation): boolean {
    const report = this.overbookingReport();
    if (!report?.slots?.length) return false;
    const timeKey = r.reservation_time.slice(0, 5);
    const slot = report.slots.find(s => s.reservation_time === timeKey || s.reservation_time === r.reservation_time);
    return slot ? (slot.over_seats || slot.over_tables) : false;
  }

  /** Local calendar date YYYY-MM-DD (staff UI; avoids UTC midnight shifting the day). */
  private localCalendarTodayYyyyMmDd(d = new Date()): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Today YYYY-MM-DD in tenant TZ (fallback: staff browser local calendar). */
  private tenantTodayForForm(): string {
    const tz = this.tenantSummary()?.timezone?.trim();
    if (tz) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    }
    return this.localCalendarTodayYyyyMmDd();
  }

  /** Floors that match the current seating preference (aligned with public /book). */
  bookZonesForSeating(): ReservationBookZone[] {
    return this.bookZones().filter((z) => this.zoneMatchesSeating(z, this.formSeating));
  }

  private zoneMatchesSeating(
    z: ReservationBookZone,
    pref: 'no_preference' | 'indoor' | 'terrace',
  ): boolean {
    const zone = (z.seating_zone || 'any').toLowerCase();
    if (zone === 'any') return true;
    if (pref === 'no_preference') return true;
    if (pref === 'indoor') return zone === 'indoor';
    if (pref === 'terrace') return zone === 'outdoor';
    return true;
  }

  onSeatingPreferenceChange(): void {
    const opts = this.bookZonesForSeating();
    if (opts.length === 1) {
      this.formFloorId = opts[0].id;
    } else if (opts.length === 0) {
      this.formFloorId = null;
    } else if (this.formFloorId != null && !opts.some((x) => x.id === this.formFloorId)) {
      this.formFloorId = null;
    }
  }

  openCreate() {
    this.editingReservation.set(null);
    this.formName = '';
    this.formPhone = '';
    this.formEmail = '';
    this.formClientNotes = '';
    this.formOwnerNotes = '';
    this.formDate = this.tenantTodayForForm();
    this.formTime = '';
    this.formPartySize = 2;
    this.formService = 'all';
    this.formDietaryNotes = '';
    this.formSeating = 'no_preference';
    this.formFloorId = null;
    this.onSeatingPreferenceChange();
    this.formError.set(null);
    this.prefillMessage.set(null);
    this.slotCapacity.set(null);
    this.showForm.set(true);
    this.loadSlotCapacity();
  }

  loadSlotCapacity() {
    if (!this.formDate?.trim() || !this.formTime?.trim() || !this.showForm()) return;
    const timeNorm = this.formTime.length >= 5 ? this.formTime.slice(0, 5) : this.formTime;
    const excludeId = this.editingReservation()?.id;
    const floorId =
      this.formFloorId != null && !Number.isNaN(this.formFloorId) ? this.formFloorId : undefined;
    this.api.getSlotCapacity(this.formDate, timeNorm, excludeId, floorId).subscribe({
      next: (cap) => this.slotCapacity.set({ seats_left: cap.seats_left, tables_left: cap.tables_left }),
      error: () => this.slotCapacity.set(null),
    });
  }

  prefillFromPhone() {
    if (this.editingReservation() || !this.formPhone.trim()) return;
    this.prefillMessage.set(null);
    this.prefillLoading.set(true);
    this.api.getReservationPrefillByPhone(this.formPhone).subscribe({
      next: (r) => {
        this.prefillLoading.set(false);
        if (r) {
          this.formName = r.customer_name ?? '';
          this.formEmail = r.customer_email ?? '';
          this.formClientNotes = r.client_notes ?? '';
          this.formOwnerNotes = r.owner_notes ?? '';
          this.formPartySize = r.party_size ?? this.formPartySize;
          const st = (r.service_type || '').toLowerCase();
          this.formService = st === 'lunch' || st === 'dinner' ? (st as 'lunch' | 'dinner') : 'all';
          this.formDietaryNotes = reservationDietaryNotesFormValue(r);
          const sp = (r.seating_preference || 'no_preference').toLowerCase();
          this.formSeating =
            sp === 'indoor' || sp === 'terrace' ? sp : 'no_preference';
          this.formFloorId = r.preferred_floor_id ?? null;
          this.onSeatingPreferenceChange();
          this.prefillSuccess.set(true);
          this.prefillMessage.set(this.translate.instant('RESERVATIONS.PREFILL_SUCCESS'));
        } else {
          this.prefillSuccess.set(false);
          this.prefillMessage.set(this.translate.instant('RESERVATIONS.PREFILL_NONE'));
        }
      },
      error: () => {
        this.prefillLoading.set(false);
        this.prefillSuccess.set(false);
        this.prefillMessage.set(this.translate.instant('RESERVATIONS.PREFILL_NONE'));
      },
    });
  }

  openEdit(r: Reservation) {
    this.editingReservation.set(r);
    this.formName = r.customer_name;
    this.formPhone = r.customer_phone;
    this.formEmail = r.customer_email ?? '';
    this.formClientNotes = r.client_notes ?? '';
    this.formOwnerNotes = r.owner_notes ?? '';
    this.formDate = r.reservation_date.slice(0, 10);
    this.formTime = r.reservation_time.length >= 5 ? r.reservation_time.slice(0, 5) : r.reservation_time;
    this.formPartySize = r.party_size;
    const st = (r.service_type || '').toLowerCase();
    this.formService = st === 'lunch' || st === 'dinner' ? (st as 'lunch' | 'dinner') : 'all';
    this.formDietaryNotes = reservationDietaryNotesFormValue(r);
    const sp = (r.seating_preference || 'no_preference').toLowerCase();
    this.formSeating = sp === 'indoor' || sp === 'terrace' ? sp : 'no_preference';
    this.formFloorId = r.preferred_floor_id ?? null;
    this.onSeatingPreferenceChange();
    this.formError.set(null);
    this.slotCapacity.set(null);
    this.showForm.set(true);
    queueMicrotask(() => this.loadSlotCapacity());
  }

  closeForm() {
    this.showForm.set(false);
    this.editingReservation.set(null);
    this.formFloorId = null;
    this.prefillMessage.set(null);
  }

  saveReservation() {
    this.formError.set(null);
    if (!contactPhoneValid(this.formPhone)) {
      this.formError.set(this.translate.instant('BOOK.INVALID_PHONE'));
      return;
    }
    const em = this.formEmail.trim();
    if (em && !contactEmailValid(em)) {
      this.formError.set(this.translate.instant('BOOK.INVALID_EMAIL'));
      return;
    }
    const timeNorm = this.formTime?.trim()
      ? this.formTime.length >= 5
        ? this.formTime.slice(0, 5)
        : this.formTime
      : '';
    if (!this.formDate?.trim() || !timeNorm) {
      this.formError.set(this.translate.instant('BOOK.PICK_SLOT'));
      return;
    }
    if (this.bookZones().length >= 1 && this.bookZonesForSeating().length === 0) {
      this.formError.set(this.translate.instant('BOOK.NO_ZONE_FOR_SEATING'));
      return;
    }
    if (
      this.bookZonesForSeating().length >= 2 &&
      (this.formFloorId == null || Number.isNaN(this.formFloorId))
    ) {
      this.formError.set(this.translate.instant('BOOK.LOCATION_ZONE_REQUIRED'));
      return;
    }
    const ed0 = this.editingReservation();
    const origDate = ed0 ? ed0.reservation_date.slice(0, 10) : '';
    const origTime = ed0
      ? ed0.reservation_time.length >= 5
        ? ed0.reservation_time.slice(0, 5)
        : ed0.reservation_time
      : '';
    const unchangedSlot = !!ed0 && origDate === this.formDate.trim() && origTime === timeNorm;
    if (!unchangedSlot) {
      const stSlot = this.weekSlotGrid?.slotState(this.formDate.trim(), timeNorm) ?? 'out_of_hours';
      if (stSlot !== 'available') {
        this.formError.set(this.translate.instant('BOOK.SLOT_UNAVAILABLE'));
        return;
      }
    }
    const ps = Number(this.formPartySize);
    const maxP = this.maxPartySize();
    if (!Number.isFinite(ps) || ps < 1 || ps > maxP) {
      this.formError.set(this.translate.instant('RESERVATIONS.ERROR_PARTY_SIZE_RANGE'));
      return;
    }
    const user = this.api.getCurrentUser();
    const tenantId = user?.tenant_id;
    if (!tenantId && !this.editingReservation()) {
      this.formError.set(this.translate.instant('RESERVATIONS.ERROR_MISSING_TENANT'));
      return;
    }
    const svc = this.hasMealSplit() && this.formService !== 'all' ? this.formService : null;
    const dietary = this.formDietaryNotes.trim();
    const preferredFloorId =
      this.formFloorId != null && !Number.isNaN(this.formFloorId) ? this.formFloorId : undefined;
    const payload: ReservationCreate = {
      customer_name: this.formName.trim(),
      customer_phone: this.formPhone.trim(),
      customer_email: this.formEmail.trim() || undefined,
      reservation_date: this.formDate.trim(),
      reservation_time: timeNorm,
      party_size: ps,
      client_notes: this.formClientNotes.trim() || undefined,
      customer_notes: dietary || undefined,
      service_type: svc,
      seating_preference: this.formSeating,
      allergies_has: dietary.length > 0,
      allergies_detail: dietary || undefined,
      preferred_floor_id: preferredFloorId,
    };
    if (!this.editingReservation() && tenantId) (payload as ReservationCreate).tenant_id = tenantId;
    if (this.editingReservation()) {
      const update: ReservationUpdate = {
        customer_name: payload.customer_name,
        customer_phone: payload.customer_phone,
        customer_email: payload.customer_email,
        reservation_date: this.formDate.trim(),
        reservation_time: timeNorm,
        party_size: ps,
        client_notes: this.formClientNotes.trim() || undefined,
        customer_notes: dietary.length > 0 ? dietary : null,
        owner_notes: this.formOwnerNotes.trim() || undefined,
        service_type: svc,
        seating_preference: this.formSeating,
        allergies_has: dietary.length > 0,
        allergies_detail: dietary.length > 0 ? dietary : null,
        preferred_floor_id: preferredFloorId ?? null,
      };
      this.api.updateReservation(this.editingReservation()!.id, update).subscribe({
        next: () => { this.closeForm(); this.load(); this.loadTables(); },
        error: (e) => this.formError.set(this.apiErr.fromHttpError(e, 'RESERVATIONS.ERROR_FAILED_UPDATE')),
      });
    } else {
      this.api.createReservation(payload).subscribe({
        next: () => { this.closeForm(); this.load(); this.loadTables(); },
        error: (e) => this.formError.set(this.apiErr.fromHttpError(e, 'RESERVATIONS.ERROR_FAILED_CREATE')),
      });
    }
  }

  openSeat(r: Reservation) {
    this.reservationToSeat.set(r);
    this.upcomingNoTableCount.set(null);
    this.loadTables();
    const dateStr = r.reservation_date.slice(0, 10);
    this.api.getUpcomingNoTableCount(dateStr, r.id).subscribe({
      next: (res) => this.upcomingNoTableCount.set(res.count),
      error: () => this.upcomingNoTableCount.set(0),
    });
  }

  closeSeatModal() {
    this.reservationToSeat.set(null);
    this.upcomingNoTableCount.set(null);
  }

  availableTablesForSeat = computed(() => {
    const r = this.reservationToSeat();
    const tables = this.tablesWithStatus();
    if (!r) return [];
    return tables
      .filter(t => (t.status === 'available' || t.status === 'reserved') && (t.seat_count ?? 0) >= r.party_size)
      .sort((a, b) => (a.seat_count ?? 0) - (b.seat_count ?? 0));
  });

  seatAt(tableId: number) {
    const r = this.reservationToSeat();
    if (!r) return;
    this.api.seatReservation(r.id, tableId).subscribe({
      next: () => { this.closeSeatModal(); this.load(); this.loadTables(); },
      error: (e) => alert(this.apiErr.fromHttpError(e, 'RESERVATIONS.ERROR_FAILED_SEAT')),
    });
  }

  confirmCancel(r: Reservation) {
    this.reservationToCancel.set(r);
  }

  doCancel() {
    const r = this.reservationToCancel();
    if (!r) return;
    this.api.updateReservationStatus(r.id, 'cancelled').subscribe({
      next: () => { this.reservationToCancel.set(null); this.load(); this.loadTables(); },
      error: () => this.reservationToCancel.set(null),
    });
  }

  confirmNoShow(r: Reservation) {
    this.reservationToNoShow.set(r);
  }

  doNoShow() {
    const r = this.reservationToNoShow();
    if (!r) return;
    this.api.updateReservationStatus(r.id, 'no_show').subscribe({
      next: () => { this.reservationToNoShow.set(null); this.load(); this.loadTables(); },
      error: () => this.reservationToNoShow.set(null),
    });
  }

  sendReminder(r: Reservation) {
    this.sendingReminderId.set(r.id);
    this.api.sendReservationReminder(r.id).subscribe({
      next: (res) => {
        this.sendingReminderId.set(null);
        const msg = this.reminderSuccessMessage(res);
        alert(msg);
      },
      error: (e) => {
        this.sendingReminderId.set(null);
        alert(this.apiErr.fromHttpError(e, 'RESERVATIONS.REMINDER_FAILED'));
      },
    });
  }

  private reminderSuccessMessage(res: { email_sent: boolean; whatsapp_sent: boolean }): string {
    if (res.email_sent && res.whatsapp_sent) {
      return this.translate.instant('RESERVATIONS.REMINDER_SENT_EMAIL_AND_WHATSAPP');
    }
    if (res.whatsapp_sent) {
      return this.translate.instant('RESERVATIONS.REMINDER_SENT_WHATSAPP');
    }
    if (res.email_sent) {
      return this.translate.instant('RESERVATIONS.REMINDER_SENT_EMAIL');
    }
    return this.translate.instant('RESERVATIONS.REMINDER_FAILED');
  }

  finish(r: Reservation) {
    this.api.finishReservation(r.id).subscribe({
      next: () => { this.load(); this.loadTables(); },
      error: (e) => alert(this.apiErr.fromHttpError(e, 'RESERVATIONS.ERROR_FAILED')),
    });
  }
}
