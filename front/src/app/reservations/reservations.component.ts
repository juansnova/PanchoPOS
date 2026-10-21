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
  ],
  template: `
    <app-sidebar>
      <div class="page-header rs-header">
        <div class="rs-title">
          <h1>{{ 'RESERVATIONS.TITLE' | translate }}</h1>
          <p>{{ filterDateLabel() }}</p>
        </div>
        <div class="page-header-actions">
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
      <div class="rs-kpis" data-testid="reservations-kpis">
        <div class="rs-kpi"><span>{{ 'RESERVATIONS.KPI_RESERVATIONS' | translate }}</span><strong>{{ resStats().total }}</strong></div>
        <div class="rs-kpi"><span>{{ 'RESERVATIONS.KPI_GUESTS' | translate }}</span><strong>{{ resStats().guests }}</strong></div>
        <div class="rs-kpi rs-kpi-info"><span>{{ 'RESERVATIONS.KPI_PENDING' | translate }}</span><strong>{{ resStats().booked }}</strong></div>
        <div class="rs-kpi rs-kpi-ok"><span>{{ 'RESERVATIONS.KPI_SEATED' | translate }}</span><strong>{{ resStats().seated }}</strong></div>
      </div>

      <div class="rs-filters">
        <label class="rs-field rs-field-date"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><input type="date" [(ngModel)]="filterDate" (ngModelChange)="load()" aria-label="date" /></label>
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
            <article class="rv-card" [class]="'rv-card status-' + r.status">
              <header class="rv-head">
                <div class="rv-time">
                  <strong>{{ timeLabel(r.reservation_time) }}</strong>
                  <small>{{ dayLabel(r.reservation_date) }}</small>
                </div>
                <div class="rv-who">
                  <h3>{{ r.customer_name }}</h3>
                  <span class="rv-party"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>{{ r.party_size }}</span>
                </div>
                <div class="rv-badges">
                  <span class="status-badge" [class]="r.status">{{ getStatusLabel(r.status) | translate }}</span>
                  @if (isSlotOverbooked(r)) {
                    <span class="overbooked-badge">{{ 'RESERVATIONS.OVERBOOKED' | translate }}</span>
                  }
                </div>
              </header>
              <div class="rv-body">
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
                  @if (r.guest_birthday_month && r.guest_birthday_day) {
                    <span class="rv-tag rv-tag-bday"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-8a2 2 0 00-2-2H6a2 2 0 00-2 2v8M4 16s1.5-1 4-1 4 2 8 2 4-1 4-1M12 11V7M12 7a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/></svg>{{ formatGuestBirthday(r) }}</span>
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
                <footer class="rv-actions">
                  @if (r.status === 'booked') {
                    <button class="rv-btn rv-btn-main" (click)="openSeat(r)">{{ 'RESERVATIONS.SEAT' | translate }}</button>
                    <button class="rv-btn" (click)="openEdit(r)">{{ 'RESERVATIONS.EDIT' | translate }}</button>
                    @if (r.customer_email || r.customer_phone) {
                      <button class="rv-btn" (click)="sendReminder(r)" [disabled]="sendingReminderId() === r.id" [title]="'RESERVATIONS.SEND_REMINDER' | translate">
                        {{ sendingReminderId() === r.id ? ('COMMON.LOADING' | translate) : ('RESERVATIONS.SEND_REMINDER' | translate) }}
                      </button>
                    }
                    <button class="rv-btn rv-btn-warn" (click)="confirmNoShow(r)">{{ 'RESERVATIONS.NO_SHOW' | translate }}</button>
                    <button class="rv-btn rv-btn-danger" (click)="confirmCancel(r)">{{ 'RESERVATIONS.CANCEL' | translate }}</button>
                  } @else {
                    <button class="rv-btn rv-btn-main" (click)="finish(r)">{{ 'RESERVATIONS.FINISH' | translate }}</button>
                  }
                </footer>
              }
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
          <div class="modal-content" (click)="$event.stopPropagation()" appFocusFirstInput>
            <div class="modal-header">
              <h3>{{ editingReservation() ? ('RESERVATIONS.EDIT' | translate) : ('RESERVATIONS.NEW' | translate) }}</h3>
              <button type="button" class="close-btn" (click)="closeForm()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <form (ngSubmit)="saveReservation()" class="reservation-modal-form">
              <div class="modal-body">
                <p class="reservation-modal-hint">{{ 'BOOK.WEEK_GRID_HINT' | translate }}</p>
                <div class="res-booking-controls">
                  <div class="form-group">
                    <label for="res-modal-party">{{ 'RESERVATIONS.PARTY_SIZE' | translate }}</label>
                    <input
                      id="res-modal-party"
                      type="number"
                      name="partySize"
                      min="1"
                      [max]="maxPartySize()"
                      required
                      [(ngModel)]="formPartySize"
                      (ngModelChange)="loadSlotCapacity()"
                    />
                  </div>
                  @if (hasMealSplit()) {
                    <div class="form-group">
                      <label for="res-modal-service">{{ 'BOOK.SERVICE_TYPE' | translate }}</label>
                      <select id="res-modal-service" [(ngModel)]="formService" name="formService" (ngModelChange)="loadSlotCapacity()">
                        <option value="all">{{ serviceOptionLabel('all') }}</option>
                        <option value="lunch">{{ serviceOptionLabel('lunch') }}</option>
                        <option value="dinner">{{ serviceOptionLabel('dinner') }}</option>
                      </select>
                    </div>
                  }
                  <div class="form-group res-seating-group">
                    <span class="label-block">{{ 'BOOK.SEATING_PREFERENCE' | translate }}</span>
                    <div class="radio-row">
                      <label class="radio-label">
                        <input type="radio" name="resSeating" [(ngModel)]="formSeating" (ngModelChange)="onSeatingPreferenceChange(); loadSlotCapacity()" value="no_preference" />
                        {{ 'BOOK.SEATING_ANY' | translate }}
                      </label>
                      <label class="radio-label">
                        <input type="radio" name="resSeating" [(ngModel)]="formSeating" (ngModelChange)="onSeatingPreferenceChange(); loadSlotCapacity()" value="indoor" />
                        {{ 'BOOK.SEATING_INDOOR' | translate }}
                      </label>
                      <label class="radio-label">
                        <input type="radio" name="resSeating" [(ngModel)]="formSeating" (ngModelChange)="onSeatingPreferenceChange(); loadSlotCapacity()" value="terrace" />
                        {{ 'BOOK.SEATING_TERRACE' | translate }}
                      </label>
                    </div>
                  </div>
                  @if (bookZones().length >= 1 && bookZonesForSeating().length === 0) {
                    <div class="form-error form-hint-block">{{ 'BOOK.NO_ZONE_FOR_SEATING' | translate }}</div>
                  }
                  @if (bookZonesForSeating().length >= 2) {
                    <div class="form-group">
                      <label for="res-modal-zone">{{ 'BOOK.LOCATION_ZONE' | translate }}</label>
                      <select id="res-modal-zone" [(ngModel)]="formFloorId" name="resFloorId" required (ngModelChange)="loadSlotCapacity()">
                        <option [ngValue]="null" disabled>{{ 'BOOK.LOCATION_ZONE_PLACEHOLDER' | translate }}</option>
                        @for (z of bookZonesForSeating(); track z.id) {
                          <option [ngValue]="z.id">{{ z.name }}</option>
                        }
                      </select>
                    </div>
                  }
                  <div class="form-group">
                    <label for="res-modal-dietary">{{ 'RESERVATIONS.CUSTOMER_NOTES' | translate }}</label>
                    <textarea
                      id="res-modal-dietary"
                      class="res-dietary-notes"
                      [(ngModel)]="formDietaryNotes"
                      name="resDietaryNotes"
                      rows="2"
                      [placeholder]="'BOOK.ALLERGIES_DETAIL_PLACEHOLDER' | translate"
                    ></textarea>
                  </div>
                </div>
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
                    [(selectedDate)]="formDate"
                    [(selectedTime)]="formTime"
                    (selectedDateChange)="loadSlotCapacity()"
                    (selectedTimeChange)="loadSlotCapacity()"
                  />
                }
                @if (slotCapacity(); as cap) {
                  <p class="slot-capacity">{{ 'RESERVATIONS.SEATS_LEFT' | translate }}: {{ cap.seats_left }} · {{ 'RESERVATIONS.TABLES_LEFT' | translate }}: {{ cap.tables_left }}</p>
                }
                <div class="form-group">
                  <label for="res-modal-name">{{ 'RESERVATIONS.CUSTOMER_NAME' | translate }}</label>
                  <input id="res-modal-name" type="text" name="customerName" [(ngModel)]="formName" required autocomplete="name" />
                </div>
                <div class="form-group">
                  <label for="res-modal-phone">{{ 'RESERVATIONS.CUSTOMER_PHONE' | translate }}</label>
                  <div class="phone-with-prefill">
                    <input id="res-modal-phone" type="tel" name="customerPhone" [(ngModel)]="formPhone" required autocomplete="tel" />
                    @if (!editingReservation()) {
                      <button type="button" class="btn btn-ghost btn-sm" (click)="prefillFromPhone()" [disabled]="prefillLoading() || !formPhone.trim()" [title]="'RESERVATIONS.PREFILL_FROM_PHONE' | translate">
                        {{ prefillLoading() ? ('COMMON.LOADING' | translate) : ('RESERVATIONS.PREFILL_FROM_PHONE' | translate) }}
                      </button>
                    }
                  </div>
                  @if (prefillMessage()) {
                    <small class="prefill-message" [class.prefill-success]="prefillSuccess()">{{ prefillMessage() }}</small>
                  }
                </div>
                <div class="form-group">
                  <label for="res-modal-email">{{ 'RESERVATIONS.CUSTOMER_EMAIL' | translate }}</label>
                  <input
                    id="res-modal-email"
                    type="email"
                    name="customerEmail"
                    [(ngModel)]="formEmail"
                    placeholder="your@email.com"
                    autocomplete="email"
                  />
                </div>
                <div class="form-group">
                  <span class="label-block">{{ 'RESERVATIONS.BIRTHDAY' | translate }}</span>
                  <div class="birthday-selects">
                    <select id="res-modal-bday-month" [(ngModel)]="formBirthdayMonth" name="resBdayMonth">
                      <option [ngValue]="null">{{ 'BOOK.BIRTHDAY_MONTH' | translate }}</option>
                      @for (m of birthdayMonths; track m.value) {
                        <option [ngValue]="m.value">{{ m.labelKey | translate }}</option>
                      }
                    </select>
                    <select id="res-modal-bday-day" [(ngModel)]="formBirthdayDay" name="resBdayDay">
                      <option [ngValue]="null">{{ 'BOOK.BIRTHDAY_DAY' | translate }}</option>
                      @for (d of birthdayDays; track d) {
                        <option [ngValue]="d">{{ d }}</option>
                      }
                    </select>
                  </div>
                  <small class="field-hint">{{ 'BOOK.BIRTHDAY_HINT' | translate }}</small>
                </div>
                <div class="form-group">
                  <label for="res-modal-notes">{{ 'RESERVATIONS.RESERVATION_NOTES' | translate }}</label>
                  <textarea
                    id="res-modal-notes"
                    name="clientNotes"
                    [(ngModel)]="formClientNotes"
                    rows="2"
                    [placeholder]="'RESERVATIONS.RESERVATION_NOTES_PLACEHOLDER' | translate"
                  ></textarea>
                </div>
                <div class="form-group">
                  <label for="res-modal-owner-notes">{{ 'RESERVATIONS.OWNER_NOTES' | translate }}</label>
                  <textarea
                    id="res-modal-owner-notes"
                    name="ownerNotes"
                    [(ngModel)]="formOwnerNotes"
                    rows="2"
                    [placeholder]="'RESERVATIONS.OWNER_NOTES_PLACEHOLDER' | translate"
                  ></textarea>
                </div>
                @if (formError()) {
                  <div class="form-error">{{ formError() }}</div>
                }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-ghost" (click)="closeForm()">{{ 'COMMON.CANCEL' | translate }}</button>
                <button type="submit" class="btn btn-primary">{{ 'COMMON.SAVE' | translate }}</button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Seat modal -->
      @if (reservationToSeat()) {
        <div class="modal-overlay">
          <div class="modal-content" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h3>{{ 'RESERVATIONS.SEAT_AT_TABLE' | translate }}</h3>
              <button class="close-btn" (click)="closeSeatModal()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div class="modal-body">
              @if (upcomingNoTableCount() !== null && upcomingNoTableCount()! > 0) {
                <p class="upcoming-no-table-warning">{{ 'RESERVATIONS.UPCOMING_NO_TABLE' | translate: { count: upcomingNoTableCount()! } }}</p>
              }
              <p>{{ 'RESERVATIONS.PARTY_SIZE' | translate }}: {{ reservationToSeat()?.party_size }}</p>
              <div class="table-list">
                @for (t of availableTablesForSeat(); track t.id) {
                  <div class="table-option-wrap">
                    @if (t.upcoming_reservation) {
                      <p class="table-upcoming-warning">{{ 'RESERVATIONS.TABLE_UPCOMING' | translate: { table: t.name, time: t.upcoming_reservation.reservation_time, name: t.upcoming_reservation.customer_name } }}</p>
                    }
                    <button class="table-option" (click)="seatAt(t.id!)">
                      {{ t.name }} ({{ t.seat_count }} {{ 'TABLES.SEATS' | translate | lowercase }})
                    </button>
                  </div>
                }
              </div>
              @if (availableTablesForSeat().length === 0) {
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
      @if (reservationToNoShow()) {
        <app-confirmation-modal
          title="RESERVATIONS.NO_SHOW_CONFIRM_TITLE"
          message="RESERVATIONS.NO_SHOW_CONFIRM_MESSAGE"
          [confirmText]="'RESERVATIONS.NO_SHOW'"
          cancelText="COMMON.CANCEL"
          confirmBtnClass="btn-primary"
          (confirm)="doNoShow()"
          (cancel)="reservationToNoShow.set(null)"
        />
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
    .reservation-card.status-booked { border-left: 4px solid #3b82f6; }
    .reservation-card.status-seated { border-left: 4px solid #16a34a; }
    .reservation-card.status-finished { border-left: 4px solid #6b7280; }
    .reservation-card.status-cancelled { border-left: 4px solid #dc2626; opacity: 0.85; }
    .reservation-card.status-no_show { border-left: 4px solid #b45309; opacity: 0.9; }
    .card-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; flex-wrap: wrap; }
    .res-id { font-weight: 600; color: #6b7280; }
    .res-name { font-weight: 600; }
    .status-badge { font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 4px; }
    .status-badge.booked { background: #dbeafe; color: #1d4ed8; }
    .status-badge.seated { background: #dcfce7; color: #15803d; }
    .status-badge.finished { background: #f3f4f6; color: #4b5563; }
    .status-badge.cancelled { background: #fee2e2; color: #b91c1c; }
    .status-badge.no_show { background: #ffedd5; color: #c2410c; }
    .status-badge.waiting { background: #fef3c7; color: #b45309; }
    .status-badge.notified { background: #dbeafe; color: #1d4ed8; }
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
    .birthday-selects { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .birthday-selects select { flex: 1; min-width: 7rem; }
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
    .rs-kpi-info strong { color: #1d4ed8; }
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
    .rv-card { --rc: #3b82f6; position: relative; display: flex; flex-direction: column; overflow: hidden; border-radius: 22px; background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 12px 28px -20px rgba(0,0,0,.35); border-left-width: 1px !important; transition: transform .18s, box-shadow .18s; }
    .rv-card:hover { transform: translateY(-3px); box-shadow: 0 2px 4px rgba(0,0,0,.05), 0 20px 34px -20px rgba(0,0,0,.4); }
    .rv-card::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 5px; background: var(--rc); }
    .rv-card.status-booked, .rv-card.status-notified { --rc: #3b82f6; }
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
    .rv-tag-bday { background: #fdf0f6; color: #be185d; }
    .rv-tag-warn { background: #fef3c7; color: #a16207; }
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
  formBirthdayMonth: number | null = null;
  formBirthdayDay: number | null = null;
  readonly birthdayMonths = [
    { value: 1, labelKey: 'BOOK.MONTH_01' },
    { value: 2, labelKey: 'BOOK.MONTH_02' },
    { value: 3, labelKey: 'BOOK.MONTH_03' },
    { value: 4, labelKey: 'BOOK.MONTH_04' },
    { value: 5, labelKey: 'BOOK.MONTH_05' },
    { value: 6, labelKey: 'BOOK.MONTH_06' },
    { value: 7, labelKey: 'BOOK.MONTH_07' },
    { value: 8, labelKey: 'BOOK.MONTH_08' },
    { value: 9, labelKey: 'BOOK.MONTH_09' },
    { value: 10, labelKey: 'BOOK.MONTH_10' },
    { value: 11, labelKey: 'BOOK.MONTH_11' },
    { value: 12, labelKey: 'BOOK.MONTH_12' },
  ];
  readonly birthdayDays = Array.from({ length: 31 }, (_, i) => i + 1);
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

  formatGuestBirthday(r: Reservation): string {
    const m = r.guest_birthday_month;
    const d = r.guest_birthday_day;
    if (!m || !d) return '';
    const monthKey = `BOOK.MONTH_${String(m).padStart(2, '0')}`;
    return `${this.translate.instant(monthKey)} ${d}`;
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
    this.formBirthdayMonth = null;
    this.formBirthdayDay = null;
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
    this.formBirthdayMonth = r.guest_birthday_month ?? null;
    this.formBirthdayDay = r.guest_birthday_day ?? null;
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
    const hasBirthday = this.formBirthdayMonth != null && this.formBirthdayDay != null;
    if (
      (this.formBirthdayMonth != null && this.formBirthdayDay == null) ||
      (this.formBirthdayMonth == null && this.formBirthdayDay != null)
    ) {
      this.formError.set(this.translate.instant('BOOK.BIRTHDAY_INCOMPLETE'));
      return;
    }
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
      guest_birthday_month: hasBirthday ? this.formBirthdayMonth : undefined,
      guest_birthday_day: hasBirthday ? this.formBirthdayDay : undefined,
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
        guest_birthday_month: hasBirthday ? this.formBirthdayMonth : null,
        guest_birthday_day: hasBirthday ? this.formBirthdayDay : null,
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
    return tables.filter(t => (t.status === 'available' || t.status === 'reserved') && (t.seat_count ?? 0) >= r.party_size);
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
