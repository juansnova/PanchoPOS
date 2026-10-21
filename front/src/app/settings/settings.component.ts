import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  ApiService,
  PersonalProviderPatch,
  Provider,
  ProviderCreate,
  ProviderProduct,
  ProviderProductCreate,
  Tax,
  TenantSettings,
  DEFAULT_TENANT_UI_MODULES,
  TenantUiModuleKey,
  OpeningHoursBaselineRow,
  OpeningHoursOverrideRow,
} from '../services/api.service';
import { SidebarComponent } from '../shared/sidebar.component';
import { AppDatePickerComponent } from '../shared/app-date-picker.component';
import { PermissionService } from '../services/permission.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MAX_IMAGE_UPLOAD_BYTES, MAX_IMAGE_UPLOAD_MB } from '../shared/image-upload-limits';
import { formatMoneyCents } from '../shared/currency-symbol';

type SettingsSectionId =
  | 'general'
  | 'navigation'
  | 'contact'
  | 'hours'
  | 'payments'
  | 'reservations';

/**
 * Extra deep-link ids (query `?section=` or hash `#…`) → canonical section.
 * Docs-friendly: openinghours (#365).
 */
const SETTINGS_SECTION_ALIASES: Record<string, SettingsSectionId> = {
  openinghours: 'hours',
  'opening-hours': 'hours',
};

/** Public hash slug per section (e.g. `/settings#openinghours`). */
const SETTINGS_SECTION_HASH: Record<SettingsSectionId, string> = {
  general: 'general',
  navigation: 'navigation',
  contact: 'contact',
  hours: 'openinghours',
  payments: 'payments',
  reservations: 'reservations',
};

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SidebarComponent,
    TranslateModule,
    AppDatePickerComponent,
  ],
  template: `
    <app-sidebar>
      <header class="st-hero">
        <div class="st-hero-id">
          <span class="st-plaque">
            @if (logoPreview() || settings()?.logo_filename) {
              <img [src]="getDisplayLogoSrc()" alt="" />
            } @else {
              <b>{{ (formData.name || '?').charAt(0).toUpperCase() }}</b>
            }
          </span>
          <div>
            <p class="st-eyebrow"><i></i>{{ 'SETTINGS.TITLE' | translate }}</p>
            <h1>{{ formData.name || settings()?.name || ('SETTINGS.TITLE' | translate) }}</h1>
          </div>
        </div>
        @if (publicUrl()) {
          <div class="st-link">
            <small>{{ 'SETTINGS.PUBLIC_LINK' | translate }}</small>
            <a [href]="publicUrl()" target="_blank" rel="noopener">{{ publicUrl() }}</a>
            <button type="button" (click)="copyPublicLink()">{{ linkCopied() ? ('SETTINGS.LINK_COPIED' | translate) : ('SETTINGS.COPY_LINK' | translate) }}</button>
          </div>
        }
      </header>

      <div class="settings-layout" data-testid="settings-layout">
      <nav class="settings-nav" data-testid="settings-nav" [attr.aria-label]="'SETTINGS.SECTION_NAV_ARIA' | translate">
        <div class="settings-nav-list">
          @for (g of navGroups; track g.labelKey) {
            <p class="st-nav-group">{{ g.labelKey | translate }}</p>
            @for (it of g.items; track it.id) {
              <button
                type="button"
                class="settings-nav-item"
                [attr.data-testid]="it.testid"
                [class.active]="activeSection() === it.id"
                (click)="selectSection(it.id)">
                <span class="st-nav-ico" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="it.icon"/></svg>
                </span>
                <span class="st-nav-txt"><b>{{ it.labelKey | translate }}</b><small>{{ it.descKey | translate }}</small></span>
              </button>
            }
          }
        </div>
      </nav>

      <div class="content">
        @if (loading()) {
          <div class="loading-state">
            <div class="spinner"></div>
            <p>{{ 'SETTINGS.LOADING_SETTINGS' | translate }}</p>
          </div>
        } @else if (activeSection() === 'navigation') {
          <div class="section" data-testid="settings-navigation-section">
            <div class="section-header">
              <h2>{{ 'SETTINGS.UI_MODULES_TITLE' | translate }}</h2>
              <p>{{ 'SETTINGS.UI_MODULES_HINT' | translate }}</p>
            </div>
            <form (ngSubmit)="saveSettings()" class="settings-form" (input)="markDirty()" (change)="markDirty()">
              <div class="st-card st-card-list">
              @for (row of uiModuleRows; track row.key) {
                <div class="form-group checkbox-row">
                  <label class="switch">
                    <input
                      type="checkbox"
                      [id]="'ui_mod_' + row.key"
                      [(ngModel)]="formData.ui_modules![row.key]"
                      [name]="'ui_mod_' + row.key"
                    />
                    <span class="slider round"></span>
                  </label>
                  <div>
                    <label class="check-label" [attr.for]="'ui_mod_' + row.key">{{ row.labelKey | translate }}</label>
                    <p class="hint">{{ row.descKey | translate }}</p>
                  </div>
                </div>
              }
              </div>
              <div class="st-savebar" [class.dirty]="dirty()">
                <span class="st-save-state"><i></i>{{ (dirty() ? 'SETTINGS.UNSAVED' : 'SETTINGS.ALL_SAVED') | translate }}</span>
                <span class="st-save-actions">
                  <button type="button" class="btn btn-secondary" (click)="cancel()">{{ 'SETTINGS.CANCEL' | translate }}</button>
                  <button type="submit" class="btn btn-primary" [disabled]="saving()">
                    {{ saving() ? ('SETTINGS.SAVING' | translate) : ('SETTINGS.SAVE_CHANGES' | translate) }}
                  </button>
                </span>
              </div>
              @if (error()) {
                <div class="toast error">
                  <span>{{ error() }}</span>
                  <button type="button" class="toast-close" (click)="error.set(null)" aria-label="Dismiss">×</button>
                </div>
              }
              @if (success()) {
                <div class="toast success">
                  <span>{{ success() }}</span>
                  <button type="button" class="toast-close" (click)="dismissSuccessToast()" aria-label="Dismiss">×</button>
                </div>
              }
            </form>
          </div>
        } @else {
            <!-- Tenant Settings Sections (Shared Form) -->
            <form (ngSubmit)="saveSettings()" class="settings-form" (input)="markDirty()" (change)="markDirty()">

              <!-- General Section -->
              @if (activeSection() === 'general') {
                <div class="section">
                  <div class="section-header">
                    <h2>{{ 'SETTINGS.BUSINESS_PROFILE' | translate }}</h2>
                    <p>{{ 'SETTINGS.SUBTITLE' | translate }}</p>
                  </div>
                  
                  <div class="st-card">
                  <h3 class="st-card-title">{{ 'SETTINGS.CARD_BRAND_IMAGES' | translate }}</h3>
                  <!-- Logo -->
                  <div class="form-group">
                    <label>{{ 'SETTINGS.LOGO' | translate }}</label>
                    <div class="logo-upload-wrapper">
                      @if (logoPreview() || settings()?.logo_filename) {
                        <div class="current-logo">
                          <img [src]="getDisplayLogoSrc()" alt="Logo" />
                          <button type="button" class="btn-icon-danger" (click)="removeLogo()" title="{{ 'SETTINGS.REMOVE_LOGO' | translate }}">✕</button>
                        </div>
                      }
                      <div class="upload-controls">
                        <input
                          type="file"
                          id="logo-upload"
                          accept="image/jpeg,image/png,image/webp,image/avif,image/svg+xml,.svg"
                          (change)="onLogoSelected($event)"
                          hidden
                        />
                        <label for="logo-upload" class="btn btn-secondary">
                          {{ 'SETTINGS.UPLOAD_LOGO' | translate }}
                        </label>
                        <span class="hint">{{ 'SETTINGS.UPLOAD_LOGO_HINT' | translate }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Header background image -->
                  <div class="form-group">
                    <label>{{ 'SETTINGS.HEADER_BACKGROUND' | translate }}</label>
                    <div class="logo-upload-wrapper">
                      @if (headerBackgroundPreview() || settings()?.header_background_filename) {
                        <div class="current-logo header-bg-preview">
                          <img [src]="getHeaderBackgroundDisplaySrc()" alt="Header background" />
                          <button type="button" class="btn-icon-danger" (click)="removeHeaderBackground()" title="{{ 'SETTINGS.REMOVE_HEADER_BACKGROUND' | translate }}">✕</button>
                        </div>
                      }
                      <div class="upload-controls">
                        <input
                          type="file"
                          id="header-bg-upload"
                          accept="image/jpeg,image/png,image/webp,image/avif"
                          (change)="onHeaderBackgroundSelected($event)"
                          hidden
                        />
                        <label for="header-bg-upload" class="btn btn-secondary">
                          {{ 'SETTINGS.UPLOAD_HEADER_BACKGROUND' | translate }}
                        </label>
                        <span class="hint">{{ 'SETTINGS.HEADER_BACKGROUND_HINT' | translate }}</span>
                      </div>
                    </div>
                  </div>

                  </div>
                  <div class="st-card">
                  <h3 class="st-card-title">{{ 'SETTINGS.CARD_BUSINESS_DATA' | translate }}</h3>
                  <!-- Basic Info -->
                  <div class="form-group">
                    <label for="name">{{ 'SETTINGS.BUSINESS_NAME' | translate }} *</label>
                    <input type="text" id="name" [(ngModel)]="formData.name" name="name" required />
                  </div>

                  <div class="form-group">
                    <label for="description">{{ 'SETTINGS.DESCRIPTION' | translate }}</label>
                    <textarea id="description" [(ngModel)]="formData.description" name="description" rows="3"></textarea>
                  </div>

                  </div>
                </div>
              }

              <!-- Contact Section -->
              @if (activeSection() === 'contact') {
                <div class="section">
                  <div class="section-header">
                    <h2>{{ 'SETTINGS.CONTACT_INFO' | translate }}</h2>
                    <p>{{ 'SETTINGS.CONTACT_INFO_SUBTITLE' | translate }}</p>
                  </div>
                  
                  <div class="st-card">
                  <h3 class="st-card-title">{{ 'SETTINGS.CARD_CONTACT' | translate }}</h3>
                  <div class="form-row">
                    <div class="form-group">
                      <label for="phone">{{ 'SETTINGS.PHONE' | translate }}</label>
                      <input type="tel" id="phone" [(ngModel)]="formData.phone" name="phone" />
                    </div>
                    <div class="form-group">
                      <label for="whatsapp">{{ 'SETTINGS.WHATSAPP' | translate }}</label>
                      <input type="tel" id="whatsapp" [(ngModel)]="formData.whatsapp" name="whatsapp" />
                    </div>
                  </div>
                  
                  <div class="form-group">
                    <label for="email">{{ 'SETTINGS.EMAIL' | translate }}</label>
                    <input type="email" id="email" [(ngModel)]="formData.email" name="email" />
                  </div>
                  
                  </div>
                  <div class="st-card">
                  <h3 class="st-card-title">{{ 'SETTINGS.CARD_PLACE_ONLINE' | translate }}</h3>
                  <div class="form-group">
                    <label for="address">{{ 'SETTINGS.ADDRESS' | translate }}</label>
                    <input type="text" id="address" [(ngModel)]="formData.address" name="address" />
                  </div>

                  <div class="form-row">
                    <div class="form-group">
                      <label for="city">{{ 'SETTINGS.CITY' | translate }}</label>
                      <input type="text" id="city" [(ngModel)]="formData.city" name="city" />
                    </div>
                    <div class="form-group">
                      <label for="public_slug">{{ 'SETTINGS.PUBLIC_SLUG' | translate }}</label>
                      <input
                        type="text"
                        id="public_slug"
                        [(ngModel)]="formData.public_slug"
                        name="public_slug"
                        data-testid="settings-public-slug"
                        autocomplete="off"
                      />
                      <small class="field-hint">{{ 'SETTINGS.PUBLIC_SLUG_HINT' | translate }}</small>
                      @if (formData.public_slug) {
                        <small class="field-hint st-url">{{ publicBookPreview() }}</small>
                      }
                    </div>
                  </div>
                  
                  <div class="form-group">
                    <label for="public_google_maps_url">{{ 'SETTINGS.PUBLIC_GOOGLE_MAPS_URL' | translate }}</label>
                    <input
                      type="url"
                      id="public_google_maps_url"
                      [(ngModel)]="formData.public_google_maps_url"
                      name="public_google_maps_url"
                      [placeholder]="'SETTINGS.PUBLIC_GOOGLE_MAPS_PLACEHOLDER' | translate"
                    />
                    <small class="field-hint">{{ 'SETTINGS.PUBLIC_GOOGLE_MAPS_HINT' | translate }}</small>
                  </div>

                  <div class="form-row">
                    <div class="form-group">
                      <label for="public_facebook_url">{{ 'SETTINGS.PUBLIC_FACEBOOK_URL' | translate }}</label>
                      <input
                        type="url"
                        id="public_facebook_url"
                        [(ngModel)]="formData.public_facebook_url"
                        name="public_facebook_url"
                        [placeholder]="'SETTINGS.PUBLIC_FACEBOOK_PLACEHOLDER' | translate"
                      />
                    </div>
                    <div class="form-group">
                      <label for="public_instagram_url">{{ 'SETTINGS.PUBLIC_INSTAGRAM_URL' | translate }}</label>
                      <input
                        type="url"
                        id="public_instagram_url"
                        [(ngModel)]="formData.public_instagram_url"
                        name="public_instagram_url"
                        [placeholder]="'SETTINGS.PUBLIC_INSTAGRAM_PLACEHOLDER' | translate"
                      />
                    </div>
                  </div>

                  </div>
                  <div class="st-card">
                  <h3 class="st-card-title">{{ 'SETTINGS.CARD_LEGAL' | translate }}</h3>
                  <div class="form-group">
                    <label for="public_terms_of_service_url">{{ 'SETTINGS.PUBLIC_TERMS_OF_SERVICE_URL' | translate }}</label>
                    <input
                      type="url"
                      id="public_terms_of_service_url"
                      [(ngModel)]="formData.public_terms_of_service_url"
                      name="public_terms_of_service_url"
                      [placeholder]="'SETTINGS.PUBLIC_TERMS_OF_SERVICE_PLACEHOLDER' | translate"
                    />
                    <small class="field-hint">{{ 'SETTINGS.PUBLIC_TERMS_OF_SERVICE_HINT' | translate }}</small>
                  </div>

                  <div class="form-group">
                    <label for="public_privacy_policy_url">{{ 'SETTINGS.PUBLIC_PRIVACY_POLICY_URL' | translate }}</label>
                    <input
                      type="url"
                      id="public_privacy_policy_url"
                      [(ngModel)]="formData.public_privacy_policy_url"
                      name="public_privacy_policy_url"
                      [placeholder]="'SETTINGS.PUBLIC_PRIVACY_POLICY_PLACEHOLDER' | translate"
                    />
                    <small class="field-hint">{{ 'SETTINGS.PUBLIC_PRIVACY_POLICY_HINT' | translate }}</small>
                  </div>

                  </div>
                </div>
              }

              <!-- Hours Section -->
              @if (activeSection() === 'hours') {
                <div class="section" data-testid="settings-hours-section">
                  <div class="section-header">
                    <h2>{{ 'SETTINGS.OPENING_HOURS' | translate }}</h2>
                    <p>{{ 'SETTINGS.OPENING_HOURS_SUBTITLE' | translate }}</p>
                  </div>
                  @if (getOpeningHoursSummary()) {
                    <div class="opening-hours-summary">
                      <span class="summary-label">{{ 'SETTINGS.OPENING_HOURS' | translate }}:</span>
                      <span class="summary-text">{{ getOpeningHoursSummary() }}</span>
                    </div>
                  }
                  <div class="copy-to-other-days">
                    <label>{{ 'SETTINGS.COPY_FROM_DAY' | translate }}</label>
                    <select [(ngModel)]="copyFromDayKey" name="copyFromDay">
                      @for (day of daysOfWeek; track day.key) {
                        <option [value]="day.key">{{ day.label | translate }}</option>
                      }
                    </select>
                    <button type="button" class="btn btn-secondary btn-sm" (click)="copyDayToOtherDays(copyFromDayKey)">
                      {{ 'SETTINGS.COPY_TO_OTHER_DAYS' | translate }}
                    </button>
                  </div>
                  <div class="hours-grid">
                    @for (day of daysOfWeek; track day.key) {
                      <div class="day-row" [class.closed]="openingHours[day.key]?.closed">
                        <div class="day-header">
                          <label class="switch">
                            <input
                              type="checkbox"
                              [checked]="!openingHours[day.key]?.closed"
                              (change)="toggleDayClosed(day.key, $event)"
                            />
                            <span class="slider round"></span>
                          </label>
                          <span class="day-name">{{ day.label | translate }}</span>
                        </div>

                        @if (!openingHours[day.key]?.closed) {
                          <div class="hours-inputs">
                            @if (!openingHours[day.key]?.hasBreak) {
                              <div class="time-range">
                                <select [ngModel]="openingHours[day.key]?.open || '09:00'" (ngModelChange)="setOpeningHourValue(day.key, 'open', $event)" [name]="'open-' + day.key">
                                  @for (t of timeOptions; track t) {
                                    <option [value]="t">{{ t }}</option>
                                  }
                                </select>
                                <span>–</span>
                                <select [ngModel]="openingHours[day.key]?.close || '22:00'" (ngModelChange)="setOpeningHourValue(day.key, 'close', $event)" [name]="'close-' + day.key">
                                  @for (t of timeOptions; track t) {
                                    <option [value]="t">{{ t }}</option>
                                  }
                                </select>
                              </div>
                              <div class="service-label-field">
                                <label [for]="'svc-label-' + day.key">{{ 'SETTINGS.SERVICE_LABEL' | translate }}</label>
                                <input
                                  type="text"
                                  [id]="'svc-label-' + day.key"
                                  [name]="'svc-label-' + day.key"
                                  [ngModel]="openingHours[day.key]?.serviceLabel || ''"
                                  (ngModelChange)="setServiceLabelValue(day.key, 'serviceLabel', $event)"
                                  [placeholder]="'SETTINGS.SERVICE_LABEL_PLACEHOLDER' | translate"
                                  maxlength="64"
                                />
                              </div>
                            } @else {
                              <div class="split-shifts">
                                <div class="shift">
                                  <span class="shift-label">{{ 'SETTINGS.MORNING_SHIFT' | translate }}</span>
                                  <select [ngModel]="openingHours[day.key]?.morningOpen" (ngModelChange)="setOpeningHourValue(day.key, 'morningOpen', $event)" [name]="'mo-' + day.key">
                                    @for (t of timeOptions; track t) {
                                      <option [value]="t">{{ t }}</option>
                                    }
                                  </select>
                                  <span>–</span>
                                  <select [ngModel]="openingHours[day.key]?.morningClose" (ngModelChange)="setOpeningHourValue(day.key, 'morningClose', $event)" [name]="'mc-' + day.key">
                                    @for (t of timeOptions; track t) {
                                      <option [value]="t">{{ t }}</option>
                                    }
                                  </select>
                                  <input
                                    type="text"
                                    class="shift-service-label"
                                    [name]="'ml-' + day.key"
                                    [ngModel]="openingHours[day.key]?.morningLabel || ''"
                                    (ngModelChange)="setServiceLabelValue(day.key, 'morningLabel', $event)"
                                    [placeholder]="'SETTINGS.MORNING_LABEL_PLACEHOLDER' | translate"
                                    [attr.aria-label]="'SETTINGS.MORNING_LABEL' | translate"
                                    maxlength="64"
                                  />
                                </div>
                                <div class="shift">
                                  <span class="shift-label">{{ 'SETTINGS.EVENING_SHIFT' | translate }}</span>
                                  <select [ngModel]="openingHours[day.key]?.eveningOpen" (ngModelChange)="setOpeningHourValue(day.key, 'eveningOpen', $event)" [name]="'eo-' + day.key">
                                    @for (t of timeOptions; track t) {
                                      <option [value]="t">{{ t }}</option>
                                    }
                                  </select>
                                  <span>–</span>
                                  <select [ngModel]="openingHours[day.key]?.eveningClose" (ngModelChange)="setOpeningHourValue(day.key, 'eveningClose', $event)" [name]="'ec-' + day.key">
                                    @for (t of timeOptions; track t) {
                                      <option [value]="t">{{ t }}</option>
                                    }
                                  </select>
                                  <input
                                    type="text"
                                    class="shift-service-label"
                                    [name]="'el-' + day.key"
                                    [ngModel]="openingHours[day.key]?.eveningLabel || ''"
                                    (ngModelChange)="setServiceLabelValue(day.key, 'eveningLabel', $event)"
                                    [placeholder]="'SETTINGS.EVENING_LABEL_PLACEHOLDER' | translate"
                                    [attr.aria-label]="'SETTINGS.EVENING_LABEL' | translate"
                                    maxlength="64"
                                  />
                                </div>
                              </div>
                            }
                            <div class="break-option">
                              <label class="checkbox-small">
                                <input type="checkbox" [checked]="openingHours[day.key]?.hasBreak" (change)="toggleBreak(day.key, $event)">
                                {{ 'SETTINGS.HAS_BREAK' | translate }}
                              </label>
                            </div>
                            <div class="personnel-per-shift">
                              <span class="personnel-label">{{ 'SETTINGS.PERSONNEL_PER_SHIFT' | translate }}</span>
                              <div class="personnel-inputs">
                                @for (role of staffRoleKeys; track role.key) {
                                  <div class="personnel-field">
                                    <label [for]="'staff-' + day.key + '-' + role.key">{{ role.labelKey | translate }}</label>
                                    <input type="number" [id]="'staff-' + day.key + '-' + role.key"
                                      [value]="getStaffRequired(day.key, role.key)"
                                      (input)="setStaffRequired(day.key, role.key, $any($event.target).value)"
                                      min="0" max="99" class="input-number" />
                                  </div>
                                }
                              </div>
                            </div>
                          </div>
                        } @else {
                          <span class="closed-badge">{{ 'SETTINGS.CLOSED' | translate }}</span>
                        }
                      </div>
                    }
                  </div>

                  <div class="divider"></div>
                  <div class="section-header">
                    <h3>{{ 'SETTINGS.OPENING_HOURS_PLANNED_TITLE' | translate }}</h3>
                    <p>{{ 'SETTINGS.OPENING_HOURS_PLANNED_HELP' | translate }}</p>
                  </div>

                  <div class="oh-schedule-card">
                    <h4>{{ 'SETTINGS.OPENING_HOURS_BASELINE_SECTION' | translate }}</h4>
                    <p class="hint">{{ 'SETTINGS.OPENING_HOURS_BASELINE_HINT' | translate }}</p>
                    <div class="form-row oh-schedule-form">
                      <div class="form-group">
                        <label for="baseline_eff">{{ 'SETTINGS.OPENING_HOURS_EFFECTIVE_FROM' | translate }}</label>
                        <app-date-picker id="baseline_eff" [clearable]="false" [(ngModel)]="baselineScheduleEffectiveDate" name="baseline_eff" />
                      </div>
                      <div class="form-group flex-grow">
                        <label for="baseline_note">{{ 'SETTINGS.OPENING_HOURS_BASELINE_NOTE' | translate }}</label>
                        <input id="baseline_note" type="text" [(ngModel)]="baselineScheduleNote" name="baseline_note" />
                      </div>
                      <button type="button" class="btn btn-secondary" (click)="addBaselineSchedule()" [disabled]="saving()">
                        {{ 'SETTINGS.OPENING_HOURS_ADD_BASELINE' | translate }}
                      </button>
                    </div>
                    <h4>{{ 'SETTINGS.OPENING_HOURS_BASELINES_LIST' | translate }}</h4>
                    @if (loadingOpeningHoursSchedule()) {
                      <p>{{ 'COMMON.LOADING' | translate }}</p>
                    } @else if (openingHoursScheduleBaselines().length === 0) {
                      <p class="hint">{{ 'SETTINGS.OPENING_HOURS_NO_BASELINES' | translate }}</p>
                    } @else {
                      <table class="oh-schedule-table">
                        <thead>
                          <tr>
                            <th>{{ 'SETTINGS.OPENING_HOURS_EFFECTIVE_FROM' | translate }}</th>
                            <th>{{ 'SETTINGS.OPENING_HOURS_NOTE_SHORT' | translate }}</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (b of openingHoursScheduleBaselines(); track b.id) {
                            <tr>
                              <td>{{ b.effective_from }}</td>
                              <td>{{ b.note || '—' }}</td>
                              <td>
                                <button type="button" class="btn btn-link danger" (click)="deleteBaselineSchedule(b.id)">
                                  {{ 'COMMON.DELETE' | translate }}
                                </button>
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    }
                  </div>

                  <div class="oh-schedule-card">
                    <h4>{{ 'SETTINGS.OPENING_HOURS_OVERRIDE_SECTION' | translate }}</h4>
                    <p class="hint">{{ 'SETTINGS.OPENING_HOURS_OVERRIDE_HINT' | translate }}</p>
                    <div class="form-group checkbox-row">
                      <label class="switch">
                        <input type="checkbox" [(ngModel)]="overrideClosedOnly" name="override_closed" />
                        <span class="slider round"></span>
                      </label>
                      <span>{{ 'SETTINGS.OPENING_HOURS_OVERRIDE_CLOSED' | translate }}</span>
                    </div>
                    <div class="form-row oh-schedule-form">
                      <div class="form-group">
                        <label for="ov_from">{{ 'SETTINGS.OPENING_HOURS_DATE_FROM' | translate }}</label>
                        <app-date-picker id="ov_from" [clearable]="false" [(ngModel)]="overrideDateFrom" name="ov_from" />
                      </div>
                      <div class="form-group">
                        <label for="ov_to">{{ 'SETTINGS.OPENING_HOURS_DATE_TO' | translate }}</label>
                        <app-date-picker id="ov_to" [clearable]="false" [(ngModel)]="overrideDateTo" name="ov_to" />
                      </div>
                      <div class="form-group flex-grow">
                        <label for="ov_note">{{ 'SETTINGS.OPENING_HOURS_BASELINE_NOTE' | translate }}</label>
                        <input id="ov_note" type="text" [(ngModel)]="overrideScheduleNote" name="ov_note" />
                      </div>
                      <button type="button" class="btn btn-secondary" (click)="addOverrideSchedule()" [disabled]="saving()">
                        {{ 'SETTINGS.OPENING_HOURS_ADD_OVERRIDE' | translate }}
                      </button>
                    </div>
                    <h4>{{ 'SETTINGS.OPENING_HOURS_OVERRIDES_LIST' | translate }}</h4>
                    @if (loadingOpeningHoursSchedule()) {
                      <p>{{ 'COMMON.LOADING' | translate }}</p>
                    } @else if (openingHoursScheduleOverrides().length === 0) {
                      <p class="hint">{{ 'SETTINGS.OPENING_HOURS_NO_OVERRIDES' | translate }}</p>
                    } @else {
                      <table class="oh-schedule-table">
                        <thead>
                          <tr>
                            <th>{{ 'SETTINGS.OPENING_HOURS_DATE_FROM' | translate }}</th>
                            <th>{{ 'SETTINGS.OPENING_HOURS_DATE_TO' | translate }}</th>
                            <th>{{ 'SETTINGS.OPENING_HOURS_OVERRIDE_TYPE' | translate }}</th>
                            <th>{{ 'SETTINGS.OPENING_HOURS_NOTE_SHORT' | translate }}</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (o of openingHoursScheduleOverrides(); track o.id) {
                            <tr>
                              <td>{{ o.date_from }}</td>
                              <td>{{ o.date_to }}</td>
                              <td>{{ o.closed ? ('SETTINGS.OPENING_HOURS_TYPE_CLOSED' | translate) : ('SETTINGS.OPENING_HOURS_TYPE_HOURS' | translate) }}</td>
                              <td>{{ o.note || '—' }}</td>
                              <td>
                                <button type="button" class="btn btn-link danger" (click)="deleteOverrideSchedule(o.id)">
                                  {{ 'COMMON.DELETE' | translate }}
                                </button>
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    }
                  </div>
                </div>
              }

              <!-- Payments Section -->
              @if (activeSection() === 'payments') {
                <div class="section">
                  <div class="section-header">
                    <h2>{{ 'SETTINGS.PAYMENT_SETTINGS' | translate }}</h2>
                    <p>{{ 'SETTINGS.PAYMENT_SETTINGS_SUBTITLE' | translate }}</p>
                  </div>
                  
                  <div class="st-card">
                  <h3 class="st-card-title">{{ 'SETTINGS.TRANSFER_PAYMENTS_TITLE' | translate }}</h3>
                  <p class="st-card-desc">{{ 'SETTINGS.TRANSFER_PAYMENTS_HINT' | translate }}</p>
                  <div class="form-group">
                    <label for="payment_nequi_number">{{ 'SETTINGS.PAYMENT_NEQUI_NUMBER' | translate }}</label>
                    <input type="tel" id="payment_nequi_number" [(ngModel)]="formData.payment_nequi_number" name="payment_nequi_number" maxlength="40" class="input-medium" data-testid="settings-payment-nequi" />
                  </div>
                  <div class="form-group">
                    <label for="payment_llave">{{ 'SETTINGS.PAYMENT_LLAVE' | translate }}</label>
                    <input type="text" id="payment_llave" [(ngModel)]="formData.payment_llave" name="payment_llave" maxlength="120" class="input-medium" data-testid="settings-payment-llave" />
                    <p class="hint">{{ 'SETTINGS.PAYMENT_LLAVE_HINT' | translate }}</p>
                  </div>
                  <div class="form-group">
                    <label for="payment_account_holder">{{ 'SETTINGS.PAYMENT_ACCOUNT_HOLDER' | translate }}</label>
                    <input type="text" id="payment_account_holder" [(ngModel)]="formData.payment_account_holder" name="payment_account_holder" maxlength="120" class="input-medium" />
                  </div>
                  </div>
                  <div class="st-card">
                  <h3 class="st-card-title">{{ 'SETTINGS.CARD_BANKS' | translate }}</h3>
                  <div class="form-group">
                    <label>{{ 'SETTINGS.BANK_ACCOUNTS_TITLE' | translate }}</label>
                    <p class="hint">{{ 'SETTINGS.BANK_ACCOUNTS_HINT' | translate }}</p>
                    @for (acc of formData.payment_bank_accounts; track $index) {
                      <div class="form-row st-bank-row" data-testid="settings-bank-account">
                        <input type="text" [(ngModel)]="acc.bank" [name]="'bank_' + $index" maxlength="120" list="bank-suggestions" [placeholder]="'SETTINGS.BANK_NAME' | translate" />
                        <select [(ngModel)]="acc.account_type" [name]="'bank_type_' + $index">
                          <option value="">{{ 'SETTINGS.BANK_ACCOUNT_TYPE' | translate }}</option>
                          <option value="Ahorros">{{ 'SETTINGS.BANK_TYPE_SAVINGS' | translate }}</option>
                          <option value="Corriente">{{ 'SETTINGS.BANK_TYPE_CHECKING' | translate }}</option>
                        </select>
                        <input type="text" [(ngModel)]="acc.account_number" [name]="'bank_num_' + $index" maxlength="120" [placeholder]="'SETTINGS.BANK_ACCOUNT_NUMBER' | translate" />
                        <input type="text" [(ngModel)]="acc.holder" [name]="'bank_holder_' + $index" maxlength="120" [placeholder]="'SETTINGS.PAYMENT_ACCOUNT_HOLDER' | translate" />
                        <button type="button" class="btn btn-link danger" (click)="removeBankAccount($index)">{{ 'COMMON.DELETE' | translate }}</button>
                      </div>
                    }
                    <datalist id="bank-suggestions">
                      <option value="Bancolombia"></option>
                      <option value="Davivienda"></option>
                      <option value="Banco de Bogotá"></option>
                      <option value="BBVA"></option>
                      <option value="Banco de Occidente"></option>
                      <option value="Banco Popular"></option>
                      <option value="Banco Caja Social"></option>
                      <option value="Scotiabank Colpatria"></option>
                      <option value="Nu"></option>
                      <option value="Daviplata"></option>
                    </datalist>
                    <button type="button" class="btn btn-secondary" (click)="addBankAccount()" data-testid="settings-bank-add">{{ 'SETTINGS.BANK_ADD' | translate }}</button>
                  </div>
                  <div class="form-group">
                    <label>{{ 'SETTINGS.PAYMENT_QR' | translate }}</label>
                    @if (paymentQrUrl(); as qrUrl) {
                      <img [src]="qrUrl" alt="QR" class="payment-qr-preview" data-testid="settings-payment-qr-preview" />
                      <button type="button" class="btn btn-secondary" (click)="removePaymentQr()">{{ 'SETTINGS.PAYMENT_QR_REMOVE' | translate }}</button>
                    }
                    <input id="payment-qr-upload" type="file" hidden accept="image/png,image/jpeg,image/webp,image/avif" (change)="onPaymentQrSelected($event)" data-testid="settings-payment-qr-input" />
                    <label for="payment-qr-upload" class="btn btn-secondary st-upload">{{ 'SETTINGS.PAYMENT_QR_UPLOAD' | translate }}</label>
                    <p class="hint">{{ 'SETTINGS.PAYMENT_QR_HINT' | translate }}</p>
                  </div>

                  </div>
                  @if (showDianInvoicingPrep()) {
                    <div class="st-card">
                    <h3 class="st-card-title">{{ 'SETTINGS.DIAN_TITLE' | translate }}</h3>
                    <p class="st-card-desc">{{ 'SETTINGS.DIAN_DESC' | translate }}</p>
                    <div class="form-group">
                      <label for="dian_mode">{{ 'SETTINGS.DIAN_MODE' | translate }}</label>
                      <select id="dian_mode" class="form-select" [(ngModel)]="formData.dian_mode" name="dian_mode">
                        <option value="off">{{ 'SETTINGS.DIAN_MODE_OFF' | translate }}</option>
                        <option value="test">{{ 'SETTINGS.DIAN_MODE_TEST' | translate }}</option>
                        <option value="live">{{ 'SETTINGS.DIAN_MODE_LIVE' | translate }}</option>
                      </select>
                      <p class="hint">{{ 'SETTINGS.DIAN_MODE_HINT' | translate }}</p>
                    </div>
                    <div class="form-group">
                      <label for="dian_tax_regime">{{ 'SETTINGS.DIAN_TAX_REGIME' | translate }}</label>
                      <select id="dian_tax_regime" class="form-select" [(ngModel)]="formData.dian_tax_regime" name="dian_tax_regime">
                        <option [ngValue]="null">{{ 'COMMON.NONE' | translate }}</option>
                        <option value="responsable_iva">{{ 'SETTINGS.DIAN_TAX_REGIME_IVA' | translate }}</option>
                        <option value="regimen_simple">{{ 'SETTINGS.DIAN_TAX_REGIME_SIMPLE' | translate }}</option>
                      </select>
                      <p class="hint">{{ 'SETTINGS.DIAN_TAX_REGIME_HINT' | translate }}</p>
                    </div>
                    <div class="form-group">
                      <label for="dian_client_id">{{ 'SETTINGS.DIAN_CLIENT_ID' | translate }}</label>
                      <input
                        type="text"
                        id="dian_client_id"
                        [(ngModel)]="formData.dian_client_id"
                        name="dian_client_id"
                        maxlength="128"
                        class="input-medium"
                        autocomplete="off"
                      />
                      <p class="hint">{{ 'SETTINGS.DIAN_CLIENT_ID_HINT' | translate }}</p>
                    </div>
                    </div>
                  }

                  <div class="st-card st-card-list">
                  <div class="form-group checkbox-row">
                    <label class="switch">
                      <input type="checkbox" [(ngModel)]="formData.immediate_payment_required" name="immediate_payment_required">
                      <span class="slider round"></span>
                    </label>
                    <div>
                      <label class="check-label">{{ 'SETTINGS.IMMEDIATE_PAYMENT' | translate }}</label>
                      <p class="hint">{{ 'SETTINGS.IMMEDIATE_PAYMENT_HINT' | translate }}</p>
                    </div>
                  </div>

                  </div>
                </div>
              }

              <!-- Reservations Section -->
              @if (activeSection() === 'reservations') {
                <div class="section">
                  <div class="section-header">
                    <h2>{{ 'SETTINGS.RESERVATIONS' | translate }}</h2>
                    <p>{{ 'SETTINGS.RESERVATIONS_SUBTITLE' | translate }}</p>
                  </div>
                  <div class="st-card">
                  <h3 class="st-card-title">{{ 'SETTINGS.CARD_PREPAY' | translate }}</h3>
                  <div class="form-group">
                    <label>{{ 'SETTINGS.RESERVATION_PREPAYMENT' | translate }}</label>
                    <div class="form-row prepayment-amount-row">
                      @if (getPrepaymentMinorDigits() === 0) {
                        <div class="form-group">
                          <label for="reservation_prepayment_major">{{ 'SETTINGS.PREPAYMENT_WHOLE_AMOUNT_LABEL' | translate }}</label>
                          <input
                            type="number"
                            id="reservation_prepayment_major"
                            min="0"
                            step="1"
                            [(ngModel)]="prepaymentMajorUnits"
                            name="reservation_prepayment_major"
                            (ngModelChange)="applyPrepaymentPartsToCents()"
                          />
                          <span class="prepayment-currency-hint">{{ getPrepaymentCurrencyLabel() }}</span>
                        </div>
                      } @else {
                        <div class="form-group">
                          <label for="reservation_prepayment_major">{{ 'SETTINGS.PREPAYMENT_MAJOR_LABEL' | translate }}</label>
                          <input
                            type="number"
                            id="reservation_prepayment_major"
                            min="0"
                            step="1"
                            [(ngModel)]="prepaymentMajorUnits"
                            name="reservation_prepayment_major"
                            (ngModelChange)="applyPrepaymentPartsToCents()"
                          />
                          <span class="prepayment-currency-hint">{{ getPrepaymentCurrencyLabel() }}</span>
                        </div>
                        <div class="form-group">
                          <label for="reservation_prepayment_minor">{{
                            'SETTINGS.PREPAYMENT_MINOR_LABEL' | translate: { max: prepaymentMinorMax() }
                          }}</label>
                          <input
                            type="number"
                            id="reservation_prepayment_minor"
                            min="0"
                            [max]="prepaymentMinorMax()"
                            step="1"
                            [(ngModel)]="prepaymentMinorUnits"
                            name="reservation_prepayment_minor"
                            (ngModelChange)="applyPrepaymentPartsToCents()"
                          />
                        </div>
                      }
                    </div>
                    <small class="field-hint">{{ 'SETTINGS.RESERVATION_PREPAYMENT_HINT' | translate }}</small>
                  </div>
                  <div class="form-group">
                    <label for="reservation_prepayment_text">{{ 'SETTINGS.RESERVATION_PREPAYMENT_TEXT' | translate }}</label>
                    <textarea id="reservation_prepayment_text" [(ngModel)]="formData.reservation_prepayment_text" name="reservation_prepayment_text" rows="3" [placeholder]="'SETTINGS.RESERVATION_PREPAYMENT_TEXT_PLACEHOLDER' | translate"></textarea>
                    <small class="field-hint">{{ 'SETTINGS.RESERVATION_PREPAYMENT_TEXT_HINT' | translate }}</small>
                  </div>
                  <div class="form-group">
                    <label for="reservation_cancellation_policy">{{ 'SETTINGS.RESERVATION_CANCELLATION_POLICY' | translate }}</label>
                    <textarea id="reservation_cancellation_policy" [(ngModel)]="formData.reservation_cancellation_policy" name="reservation_cancellation_policy" rows="2" [placeholder]="'SETTINGS.RESERVATION_CANCELLATION_POLICY_PLACEHOLDER' | translate"></textarea>
                  </div>
                  </div>
                  <div class="st-card st-grid">
                  <h3 class="st-card-title">{{ 'SETTINGS.CARD_CAPACITY' | translate }}</h3>
                  <div class="form-group">
                    <label for="reservation_arrival_tolerance_minutes">{{ 'SETTINGS.RESERVATION_ARRIVAL_TOLERANCE' | translate }}</label>
                    <input type="number" id="reservation_arrival_tolerance_minutes" min="0" max="120" [(ngModel)]="formData.reservation_arrival_tolerance_minutes" name="reservation_arrival_tolerance_minutes" placeholder="15" />
                    <small class="field-hint">{{ 'SETTINGS.RESERVATION_ARRIVAL_TOLERANCE_HINT' | translate }}</small>
                  </div>
                  <div class="form-group">
                    <label for="reservation_average_table_turn_minutes">{{ 'SETTINGS.RESERVATION_AVG_TABLE_TURN' | translate }}</label>
                    <input type="number" id="reservation_average_table_turn_minutes" min="0" max="1440" [(ngModel)]="formData.reservation_average_table_turn_minutes" name="reservation_average_table_turn_minutes" placeholder="60" />
                    <small class="field-hint">{{ 'SETTINGS.RESERVATION_AVG_TABLE_TURN_HINT' | translate }}</small>
                  </div>
                  <div class="form-group">
                    <label for="reservation_slot_minutes">{{ 'SETTINGS.RESERVATION_SLOT_MINUTES' | translate }}</label>
                    <input type="number" id="reservation_slot_minutes" min="0" max="120" [(ngModel)]="formData.reservation_slot_minutes" name="reservation_slot_minutes" placeholder="15" />
                    <small class="field-hint">{{ 'SETTINGS.RESERVATION_SLOT_MINUTES_HINT' | translate }}</small>
                  </div>
                  <div class="form-group">
                    <label for="reservation_max_guests_per_slot">{{ 'SETTINGS.RESERVATION_MAX_GUESTS_PER_SLOT' | translate }}</label>
                    <input type="number" id="reservation_max_guests_per_slot" min="0" max="500" [(ngModel)]="formData.reservation_max_guests_per_slot" name="reservation_max_guests_per_slot" placeholder="" />
                    <small class="field-hint">{{ 'SETTINGS.RESERVATION_MAX_GUESTS_PER_SLOT_HINT' | translate }}</small>
                  </div>
                  <div class="form-group">
                    <label for="reservation_walk_in_tables_reserved">{{ 'SETTINGS.RESERVATION_WALK_IN_TABLES' | translate }}</label>
                    <input type="number" id="reservation_walk_in_tables_reserved" min="0" max="99" [(ngModel)]="formData.reservation_walk_in_tables_reserved" name="reservation_walk_in_tables_reserved" placeholder="0" />
                    <small class="field-hint">{{ 'SETTINGS.RESERVATION_WALK_IN_TABLES_HINT' | translate }}</small>
                  </div>
                  <div class="form-group">
                    <label for="reservation_dress_code">{{ 'SETTINGS.RESERVATION_DRESS_CODE' | translate }}</label>
                    <input type="text" id="reservation_dress_code" [(ngModel)]="formData.reservation_dress_code" name="reservation_dress_code" [placeholder]="'SETTINGS.RESERVATION_DRESS_CODE_PLACEHOLDER' | translate" />
                  </div>
                  </div>
                  <div class="st-card st-card-list">
                  <h3 class="st-card-title">{{ 'SETTINGS.REMINDER_SCHEDULE' | translate }}</h3>
                  <p class="st-card-desc">{{ 'SETTINGS.REMINDER_SCHEDULE_DESC' | translate }}</p>
                  <div class="form-group checkbox-row">
                    <label class="switch">
                      <input type="checkbox" [(ngModel)]="formData.reservation_reminder_24h_enabled" name="reservation_reminder_24h_enabled">
                      <span class="slider round"></span>
                    </label>
                    <div>
                      <label class="check-label">{{ 'SETTINGS.RESERVATION_REMINDER_24H' | translate }}</label>
                      <p class="hint">{{ 'SETTINGS.RESERVATION_REMINDER_24H_HINT' | translate }}</p>
                    </div>
                  </div>
                  <div class="form-group checkbox-row">
                    <label class="switch">
                      <input type="checkbox" [(ngModel)]="formData.reservation_reminder_2h_enabled" name="reservation_reminder_2h_enabled">
                      <span class="slider round"></span>
                    </label>
                    <div>
                      <label class="check-label">{{ 'SETTINGS.RESERVATION_REMINDER_2H' | translate }}</label>
                      <p class="hint">{{ 'SETTINGS.RESERVATION_REMINDER_2H_HINT' | translate }}</p>
                    </div>
                  </div>
                  </div>
                  <div class="st-card st-card-list">
                  <h3 class="st-card-title">{{ 'SETTINGS.GUEST_BIRTHDAY' | translate }}</h3>
                  <p class="st-card-desc">{{ 'SETTINGS.GUEST_BIRTHDAY_DESC' | translate }}</p>
                  <div class="form-group checkbox-row">
                    <label class="switch">
                      <input type="checkbox" [(ngModel)]="formData.guest_birthday_capture_enabled" name="guest_birthday_capture_enabled">
                      <span class="slider round"></span>
                    </label>
                    <div>
                      <label class="check-label">{{ 'SETTINGS.GUEST_BIRTHDAY_CAPTURE' | translate }}</label>
                      <p class="hint">{{ 'SETTINGS.GUEST_BIRTHDAY_CAPTURE_HINT' | translate }}</p>
                    </div>
                  </div>
                  <div class="form-group checkbox-row">
                    <label class="switch">
                      <input type="checkbox" [(ngModel)]="formData.guest_birthday_marketing_enabled" name="guest_birthday_marketing_enabled">
                      <span class="slider round"></span>
                    </label>
                    <div>
                      <label class="check-label">{{ 'SETTINGS.GUEST_BIRTHDAY_MARKETING' | translate }}</label>
                      <p class="hint">{{ 'SETTINGS.GUEST_BIRTHDAY_MARKETING_HINT' | translate }}</p>
                    </div>
                  </div>
                  @if (formData.guest_birthday_marketing_enabled) {
                    <div class="form-group">
                      <label for="guest_birthday_consent_text">{{ 'SETTINGS.GUEST_BIRTHDAY_CONSENT_TEXT' | translate }}</label>
                      <textarea
                        id="guest_birthday_consent_text"
                        [(ngModel)]="formData.guest_birthday_consent_text"
                        name="guest_birthday_consent_text"
                        rows="2"
                        [placeholder]="'SETTINGS.GUEST_BIRTHDAY_CONSENT_PLACEHOLDER' | translate"
                      ></textarea>
                      <small class="field-hint">{{ 'SETTINGS.GUEST_BIRTHDAY_CONSENT_HINT' | translate }}</small>
                    </div>
                  }
                  </div>
                </div>
              }

              <!-- Form Actions -->
              <div class="st-savebar" [class.dirty]="dirty()">
                <span class="st-save-state"><i></i>{{ (dirty() ? 'SETTINGS.UNSAVED' : 'SETTINGS.ALL_SAVED') | translate }}</span>
                <span class="st-save-actions">
                  <button type="button" class="btn btn-secondary" (click)="cancel()">{{ 'SETTINGS.CANCEL' | translate }}</button>
                  <button type="submit" class="btn btn-primary" [disabled]="saving()">
                    {{ saving() ? ('SETTINGS.SAVING' | translate) : ('SETTINGS.SAVE_CHANGES' | translate) }}
                  </button>
                </span>
              </div>
              
              @if (error()) {
                <div class="toast error">
                  <span>{{ error() }}</span>
                  <button type="button" class="toast-close" (click)="error.set(null)" aria-label="Dismiss">×</button>
                </div>
              }
              @if (success()) {
                <div class="toast success">
                  <span>{{ success() }}</span>
                  <button type="button" class="toast-close" (click)="dismissSuccessToast()" aria-label="Dismiss">×</button>
                </div>
              }
              
            </form>
          }
      </div>
      </div>
    </app-sidebar>
  `,
  styles: [`
    .payment-qr-preview {
      display: block;
      width: 180px;
      height: auto;
      margin-bottom: 0.5rem;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      background: #fff;
    }

    /* ==========================================
       MOBILE-FIRST RESPONSIVE SETTINGS STYLES
       ========================================== */
    
    /* Page Header */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--space-4);

      h1 {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--color-text);
        margin: 0;
      }
    }
    
    @media (min-width: 640px) {
      .page-header h1 {
        font-size: 1.5rem;
      }
    }

    /* ==========================================
       SETTINGS NAV - Vertical menu (Invoice Ninja–style)
       ========================================== */
    .settings-layout {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      align-items: stretch;
    }

    .settings-nav {
      flex-shrink: 0;
    }

    .settings-nav-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      max-height: min(40vh, 20rem);
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: var(--space-1);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
    }

    .settings-nav-item {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: var(--space-2);
      width: 100%;
      padding: var(--space-2) var(--space-3);
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      color: var(--color-text-muted);
      font-size: 0.875rem;
      font-weight: 500;
      text-align: left;
      white-space: nowrap;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      min-height: 44px;
    }

    .settings-nav-item:hover {
      color: var(--color-text);
      background: var(--color-bg, rgba(0, 0, 0, 0.04));
      border-color: var(--color-border);
    }

    .settings-nav-item.active {
      background: var(--color-primary);
      border-color: var(--color-primary);
      color: white;
    }

    .settings-nav-icon {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }

    .settings-layout > .content {
      flex: 1;
      min-width: 0;
    }

    @media (min-width: 900px) {
      .settings-layout {
        flex-direction: row;
        align-items: flex-start;
        gap: var(--space-5);
      }

      .settings-nav {
        width: 15.5rem;
        position: sticky;
        top: var(--space-4);
      }

      .settings-nav-list {
        max-height: calc(100vh - 6rem);
      }
    }

    /* ==========================================
       SECTION STYLING
       ========================================== */
    .content {
      /* Full width container */
    }

    .section {
      margin-bottom: var(--space-5);
    }
    
    @media (min-width: 640px) {
      .section {
        margin-bottom: var(--space-6);
      }
    }

    .section-header {
      margin-bottom: var(--space-4);
      padding-bottom: var(--space-3);
      border-bottom: 1px solid var(--color-border);

      h2 {
        font-size: 1.125rem;
        font-weight: 600;
        margin: 0 0 var(--space-1) 0;
        color: var(--color-text);
      }

      p {
        color: var(--color-text-muted);
        font-size: 0.8125rem;
        margin: 0;
      }
    }
    
    @media (min-width: 640px) {
      .section-header {
        margin-bottom: var(--space-5);
        padding-bottom: var(--space-4);
      }
      
      .section-header h2 {
        font-size: 1.25rem;
      }
      
      .section-header p {
        font-size: 0.875rem;
      }
    }

    /* ==========================================
       FORM ELEMENTS - Mobile First
       ========================================== */
    .form-row {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    @media (min-width: 640px) {
      .form-row {
        flex-direction: row;
        gap: var(--space-4);
      }
      
      .form-row .form-group {
        flex: 1;
      }
    }

    .prepayment-amount-row .form-group {
      margin-bottom: 0;
    }

    .prepayment-currency-hint {
      font-size: 0.8125rem;
      color: var(--color-text-muted);
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin-bottom: var(--space-3);

      label {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--color-text);
      }

      input, select, textarea {
        width: 100%;
        padding: var(--space-3);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        font-size: 1rem; /* 16px prevents zoom on iOS */
        background: var(--color-surface);
        color: var(--color-text);
        min-height: 44px; /* Touch-friendly */

        &:focus {
          outline: none;
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px var(--color-primary-light);
        }
      }

      textarea {
        resize: vertical;
        min-height: 100px;
      }

      .input-short {
        max-width: 100%;
      }

      .code-input {
        font-family: monospace;
        font-size: 0.875rem;
      }
    }

    .background-color-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .background-color-row .color-input {
      width: 44px;
      height: 44px;
      padding: 2px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      cursor: pointer;
    }
    .background-color-row .hex-input {
      flex: 1;
      min-width: 100px;
      font-family: monospace;
    }

    .header-bg-preview {
      max-width: 320px;
    }
    .header-bg-preview img {
      width: 100%;
      height: auto;
      max-height: 120px;
      object-fit: cover;
    }

    @media (min-width: 640px) {
      .form-group {
        margin-bottom: var(--space-4);
      }
      
      .form-group input,
      .form-group select,
      .form-group textarea {
        font-size: 0.9375rem;
      }
      
      .form-group .input-short {
        max-width: 120px;
      }
    }

    .hint {
      font-size: 0.75rem;
      color: var(--color-text-muted);
      line-height: 1.4;
    }
    
    @media (min-width: 640px) {
      .hint {
        font-size: 0.8125rem;
      }
    }

    /* ==========================================
       LOGO UPLOAD - Mobile First
       ========================================== */
    .logo-upload-wrapper {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      align-items: center;
    }
    
    @media (min-width: 480px) {
      .logo-upload-wrapper {
        flex-direction: row;
        align-items: flex-start;
      }
    }

    .current-logo {
      position: relative;
      width: 120px;
      height: 120px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--space-2);
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-surface);
      flex-shrink: 0;

      img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }

      .btn-icon-danger {
        position: absolute;
        top: -10px;
        right: -10px;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--color-error);
        color: white;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        touch-action: manipulation;
      }
    }
    
    @media (min-width: 640px) {
      .current-logo {
        width: 100px;
        height: 100px;
      }
      
      .current-logo .btn-icon-danger {
        width: 24px;
        height: 24px;
        top: -8px;
        right: -8px;
        font-size: 12px;
      }
    }

    .upload-controls {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      align-items: center;
      text-align: center;
    }
    
    @media (min-width: 480px) {
      .upload-controls {
        align-items: flex-start;
        text-align: left;
      }
    }

    /* ==========================================
       OPENING HOURS - Mobile First
       ========================================== */
    .opening-hours-summary {
      background: var(--color-bg);
      border-radius: var(--radius-md);
      padding: var(--space-3) var(--space-4);
      margin-bottom: var(--space-4);
      border: 1px solid var(--color-border);
      .summary-label { font-weight: 600; color: var(--color-text-muted); font-size: 0.875rem; margin-right: var(--space-2); }
      .summary-text { font-size: 0.9375rem; color: var(--color-text); }
    }
    .copy-to-other-days {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
      label { font-weight: 500; font-size: 0.875rem; }
      select { padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--color-border); min-width: 120px; }
      .btn-sm { padding: var(--space-2) var(--space-3); font-size: 0.875rem; }
    }
    .hours-grid {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    .day-row {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--space-3);

      &.closed {
        opacity: 0.7;
      }
    }
    
    @media (min-width: 640px) {
      .day-row {
        padding: var(--space-4);
      }
    }

    .day-header {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      margin-bottom: var(--space-2);
    }

    .day-name {
      font-weight: 500;
      font-size: 0.9375rem;
    }

    /* Mobile: Stack hours below header */
    .hours-inputs {
      padding-left: 0;
      margin-top: var(--space-3);
    }
    
    @media (min-width: 480px) {
      .hours-inputs {
        padding-left: 52px; /* Switch width + gap */
        margin-top: 0;
      }
    }

    /* Mobile: Full-width time inputs / selects (0, 15, 30, 45 min options) */
    .time-range {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;

      input, select {
        flex: 1;
        min-width: 90px;
        max-width: 120px;
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        font-size: 1rem;
        min-height: 40px;
        text-align: center;
        background: var(--color-bg);
        color: var(--color-text);
      }
      
      span {
        color: var(--color-text-muted);
        font-weight: 500;
      }
    }
    
    @media (min-width: 480px) {
      .time-range input, .time-range select {
        flex: 0 0 auto;
        width: 110px;
        min-width: unset;
      }
    }

    .service-label-field {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      margin-top: var(--space-2);
      max-width: 280px;

      label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-text-muted);
      }

      input {
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        font-size: 0.95rem;
        min-height: 40px;
        background: var(--color-bg);
        color: var(--color-text);
        text-align: left;
      }
    }

    .shift-service-label {
      max-width: 180px !important;
      text-align: left !important;
    }

    /* Split Shifts - Mobile First (Stacked) */
    .split-shifts {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);

      .shift {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        padding: var(--space-3);
        background: var(--color-bg);
        border-radius: var(--radius-sm);

        .shift-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--color-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .shift-times {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex-wrap: wrap;
        }

        input, select {
          flex: 1;
          min-width: 80px;
          max-width: 110px;
          padding: var(--space-2) var(--space-3);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-sm);
          font-size: 1rem;
          min-height: 40px;
          text-align: center;
          background: var(--color-bg);
          color: var(--color-text);
        }
      }
    }
    
    @media (min-width: 480px) {
      .split-shifts .shift {
        flex-direction: row;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-2);
        background: transparent;
        
        .shift-label {
          width: 60px;
          text-transform: none;
          font-weight: 500;
        }
        
        .shift-times {
          flex-wrap: nowrap;
        }
        
        input {
          flex: 0 0 auto;
          width: 100px;
          min-width: unset;
        }
      }
    }

    .break-option {
      margin-top: var(--space-3);
      padding-top: var(--space-3);
      border-top: 1px dashed var(--color-border);
    }
    
    .checkbox-small {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: 0.875rem;
      cursor: pointer;
      min-height: 44px; /* Touch target */
      
      input[type="checkbox"] {
        width: 18px;
        height: 18px;
        cursor: pointer;
      }
    }

    .personnel-per-shift {
      margin-top: var(--space-3);
      padding-top: var(--space-3);
      border-top: 1px dashed var(--color-border);
    }
    .personnel-label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--color-text-muted);
      margin-bottom: var(--space-2);
    }
    .personnel-inputs {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-4);
    }
    .personnel-field {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      label { font-size: 0.8125rem; color: var(--color-text-muted); white-space: nowrap; }
    }
    .personnel-field .input-number {
      width: 3rem;
      padding: var(--space-1) var(--space-2);
      font-size: 0.875rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      text-align: center;
    }

    .closed-badge {
      display: inline-block;
      padding: var(--space-2) var(--space-3);
      background: var(--color-bg);
      border-radius: var(--radius-sm);
      font-size: 0.8125rem;
      color: var(--color-text-muted);
      margin-left: auto;
    }

    /* ==========================================
       SWITCHES - Touch-Friendly
       ========================================== */
    .switch {
      position: relative;
      display: inline-block;
      width: 48px;
      height: 28px;
      flex-shrink: 0;
      touch-action: manipulation;

      input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: #cbd5e1;
        transition: .3s;

        &:before {
          position: absolute;
          content: "";
          height: 22px;
          width: 22px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: .3s;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
      }

      input:checked + .slider {
        background-color: var(--color-primary);
      }

      input:checked + .slider:before {
        transform: translateX(20px);
      }

      .slider.round {
        border-radius: 34px;
      }

      .slider.round:before {
        border-radius: 50%;
      }
    }
    
    @media (min-width: 640px) {
      .switch {
        width: 40px;
        height: 24px;
      }
      
      .switch .slider:before {
        height: 18px;
        width: 18px;
      }
      
      .switch input:checked + .slider:before {
        transform: translateX(16px);
      }
    }

    .checkbox-row {
      flex-direction: column;
      gap: var(--space-3);
    }
    
    @media (min-width: 480px) {
      .checkbox-row {
        flex-direction: row;
        align-items: flex-start;
      }
    }

    .check-label {
      font-weight: 500;
    }

    /* ==========================================
       DIVIDERS & HEADINGS
       ========================================== */
    .divider {
      height: 1px;
      background: var(--color-border);
      margin: var(--space-4) 0;
    }
    
    @media (min-width: 640px) {
      .divider {
        margin: var(--space-5) 0;
      }
    }
    
    .section-desc {
      color: var(--color-text-muted);
      font-size: 0.875rem;
      margin-bottom: var(--space-4);
    }
    
    .location-settings {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: var(--space-4);
      background: var(--color-bg);
      border-radius: var(--radius-md);
      margin-top: var(--space-3);
    }

    h3 {
      font-size: 0.9375rem;
      font-weight: 600;
      margin: 0 0 var(--space-3) 0;
    }
    .subsection-title {
      margin-top: var(--space-4);
      padding-top: var(--space-4);
      border-top: 1px solid var(--color-border);
    }
    .subsection-desc {
      color: var(--color-text-muted);
      font-size: 0.8125rem;
      margin: 0 0 var(--space-3) 0;
    }
    @media (min-width: 640px) {
      h3 {
        font-size: 1rem;
        margin: 0 0 var(--space-4) 0;
      }
    }

    /* ==========================================
       BUTTONS - Touch-Friendly
       ========================================== */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-5);
      border: none;
      border-radius: var(--radius-md);
      font-size: 0.9375rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      min-height: 48px; /* Touch-friendly */
      touch-action: manipulation;
      width: 100%;

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }
    
    @media (min-width: 640px) {
      .btn {
        min-height: 44px;
        padding: var(--space-3) var(--space-4);
        font-size: 0.875rem;
        width: auto;
      }
    }

    .btn-primary {
      background: var(--color-primary);
      color: white;

      &:hover:not(:disabled) {
        background: var(--color-primary-hover);
      }
      
      &:active:not(:disabled) {
        transform: scale(0.98);
      }
    }

    .btn-secondary {
      background: var(--color-surface);
      color: var(--color-text);
      border: 1px solid var(--color-border);

      &:hover:not(:disabled) {
        background: var(--color-bg);
      }
      
      &:active:not(:disabled) {
        transform: scale(0.98);
      }
    }

    .data-export-card {
      margin-bottom: var(--space-8);
    }

    .danger-zone {
      margin-top: var(--space-8);
      padding: var(--space-5);
      border: 2px solid #dc2626;
      border-radius: var(--radius-md);
      background: #fef2f2;
    }

    .danger-zone h2 {
      color: #991b1b;
      font-size: 1.125rem;
      margin: 0 0 var(--space-2);
    }

    .danger-lede {
      color: #7f1d1d;
      margin: 0 0 var(--space-4);
      line-height: 1.5;
    }

    .btn-danger-outline {
      margin-top: var(--space-3);
      background: #dc2626;
      color: #fff;
      border: 1px solid #b91c1c;

      &:hover:not(:disabled) {
        background: #b91c1c;
      }
    }

    /* ==========================================
       FORM ACTIONS - Mobile First
       ========================================== */
    .form-actions {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding-top: var(--space-4);
      border-top: 1px solid var(--color-border);
      margin-top: var(--space-4);
    }

    @media (min-width: 640px) {
      .form-actions {
        flex-direction: row;
        justify-content: flex-end;
        padding-top: var(--space-5);
        margin-top: var(--space-5);
      }
    }

    /* ==========================================
       LOADING STATE
       ========================================== */
    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--space-6);
      color: var(--color-text-muted);
    }
    
    @media (min-width: 640px) {
      .loading-state {
        padding: var(--space-8);
      }
    }

    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--color-border);
      border-top-color: var(--color-primary);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: var(--space-4);
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* ==========================================
       TOASTS - Mobile First
       ========================================== */
    .toast {
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + var(--space-4));
      left: 50%;
      right: auto;
      bottom: auto;
      width: min(400px, calc(100% - 2 * var(--space-4)));
      max-width: 400px;
      padding: var(--space-4);
      border-radius: var(--radius-md);
      color: white;
      font-weight: 500;
      transform: translateX(-50%);
      animation: settingsToastEnter 0.3s ease;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);

      &.success {
        background: var(--color-success);
      }

      &.error {
        background: var(--color-error);
      }
    }

    .toast-close {
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.9);
      cursor: pointer;
      padding: var(--space-1);
      font-size: 1.25rem;
      line-height: 1;
    }

    .toast-close:hover {
      color: white;
    }

    .timezone-select-wrapper {
      position: relative;
    }

    .timezone-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      max-height: 200px;
      overflow-y: auto;
      background: var(--color-bg, #fff);
      border: 1px solid var(--color-border, #ddd);
      border-radius: 0 0 8px 8px;
      z-index: 10;
    }

    .timezone-option {
      padding: 8px 12px;
      cursor: pointer;
      font-size: 0.9rem;
    }

    .timezone-option:hover,
    .timezone-option.selected {
      background: var(--color-primary-light, #f0e6e0);
    }

    .field-hint {
      display: block;
      margin-top: 4px;
      font-size: 0.8rem;
      color: var(--color-text-secondary, #666);
    }

    .field-warning {
      color: var(--color-warning, #e67e22);
    }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .modal-content {
      background: var(--color-surface, #fff);
      border-radius: var(--radius-lg, 12px);
      max-width: 420px;
      width: 90%;
      max-height: 90vh;
      overflow: auto;
      box-shadow: var(--shadow-xl, 0 20px 25px -5px rgba(0,0,0,0.1));
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--space-4);
      border-bottom: 1px solid var(--color-border);
    }
    .modal-header h3 { margin: 0; font-size: 1.125rem; }
    .modal-body { padding: var(--space-4); }
    .modal-actions {
      display: flex;
      gap: var(--space-3);
      justify-content: flex-end;
      padding: var(--space-4);
      border-top: 1px solid var(--color-border);
    }
    .btn-icon {
      background: none;
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      color: var(--color-text-muted);
      padding: 0 var(--space-2);
      line-height: 1;
    }
    .provider-products-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .provider-products-list li {
      padding: var(--space-1) 0;
      font-size: 0.875rem;
    }

    .otp-secret-row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      flex-wrap: wrap;
    }
    .otp-secret {
      font-family: monospace;
      font-size: 0.875rem;
      padding: var(--space-2) var(--space-3);
      background: var(--color-bg);
      border-radius: var(--radius-sm);
      word-break: break-all;
    }
    .otp-enabled-msg {
      margin-bottom: var(--space-4);
      color: var(--color-text);
    }
    .otp-recovery-list {
      list-style: none;
      padding: 0;
      margin: 0.75rem 0 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
      gap: 0.5rem;
    }
    .otp-recovery-list code {
      display: block;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.9375rem;
      letter-spacing: 0.04em;
    }

    /* Security / OTP: separate explanatory copy from actions (GitHub #83) */
    [data-testid='settings-security-section'] .form-card > p.hint {
      margin-bottom: var(--space-4);
    }

    .oh-schedule-card {
      margin-top: var(--space-4);
      padding: var(--space-4);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
    }
    .oh-schedule-card h4 {
      margin-top: var(--space-3);
      margin-bottom: var(--space-2);
      font-size: 1rem;
      font-weight: 600;
    }
    .oh-schedule-form {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--space-3);
      margin-bottom: var(--space-4);
    }
    .flex-grow {
      flex: 1;
      min-width: 140px;
    }
    .oh-schedule-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }
    .oh-schedule-table th,
    .oh-schedule-table td {
      text-align: left;
      padding: var(--space-2) var(--space-3);
      border-bottom: 1px solid var(--color-border);
    }
    .btn-link.danger {
      color: var(--color-danger, #c62828);
      padding: 0;
      font-size: 0.875rem;
    }

    @keyframes settingsToastEnter {
      from {
        transform: translate(-50%, calc(-100% - 12px));
        opacity: 0;
      }
      to {
        transform: translate(-50%, 0);
        opacity: 1;
      }
    }

    /* ==========================================
       REDISEÑO: portada, menú, tarjetas, barra de guardado
       ========================================== */
    .st-hero { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; padding: 20px 24px; border-radius: 28px; border: 1px solid var(--color-border); background: radial-gradient(70% 140% at 0% 0%, color-mix(in srgb, var(--color-primary) 15%, #fff), transparent 70%), #fffdfa; box-shadow: 0 30px 50px -42px rgba(60, 30, 10, .55); }
    .st-hero-id { display: flex; align-items: center; gap: 16px; min-width: 0; }
    .st-plaque { flex: none; display: grid; place-items: center; width: 64px; height: 64px; padding: 8px; border-radius: 20px; background: #fff; box-shadow: 0 14px 24px -16px rgba(0,0,0,.45), inset 0 0 0 1px rgba(0,0,0,.05); overflow: hidden; }
    .st-plaque img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .st-plaque b { font-family: Georgia, 'Times New Roman', serif; font-size: 1.9rem; font-style: italic; font-weight: 500; color: var(--color-primary); }
    .st-eyebrow { display: flex; align-items: center; gap: 10px; margin: 0 0 4px; font-size: .68rem; font-weight: 800; letter-spacing: .22em; text-transform: uppercase; color: var(--color-primary); }
    .st-eyebrow i { width: 26px; height: 2px; background: var(--color-primary); }
    .st-hero h1 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: clamp(1.5rem, 3.4vw, 2.2rem); font-weight: 500; letter-spacing: -.02em; line-height: 1.1; overflow-wrap: anywhere; }
    .st-link { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; max-width: 100%; padding: 8px 8px 8px 16px; border-radius: 999px; background: #fff; border: 1px dashed color-mix(in srgb, var(--color-primary) 40%, var(--color-border)); }
    .st-link small { font-size: .62rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--color-text-muted); }
    .st-link a { min-width: 0; font-size: .85rem; font-weight: 700; color: var(--color-text); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px; }
    .st-link a:hover { color: var(--color-primary); }
    .st-link button { flex: none; min-height: 34px; padding: 0 14px; border: 0; border-radius: 999px; font: inherit; font-size: .78rem; font-weight: 800; color: #fff; cursor: pointer; background: linear-gradient(145deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 62%, #000)); }

    .settings-nav-list { gap: 4px; padding: 10px; border-radius: 26px; border: 1px solid var(--color-border); background: #fffdfa; box-shadow: 0 24px 40px -34px rgba(60, 30, 10, .5); }
    .st-nav-group { margin: 8px 8px 2px; font-size: .62rem; font-weight: 800; letter-spacing: .2em; text-transform: uppercase; color: var(--color-text-muted); }
    .st-nav-group:first-child { margin-top: 2px; }
    .settings-nav-item { gap: 12px; padding: 8px 10px; border-radius: 18px; align-items: center; min-height: 52px; white-space: normal; }
    .settings-nav-item:hover { background: color-mix(in srgb, var(--color-primary) 7%, #fff); border-color: transparent; }
    .settings-nav-item.active { color: var(--color-text); border-color: transparent; background: color-mix(in srgb, var(--color-primary) 12%, #fff); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-primary) 55%, transparent); }
    .st-nav-ico { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 10%, #fff); }
    .st-nav-ico svg { width: 18px; height: 18px; }
    .settings-nav-item.active .st-nav-ico { color: #fff; background: linear-gradient(145deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 62%, #000)); box-shadow: 0 10px 14px -8px var(--color-primary); }
    .st-nav-txt { display: flex; flex-direction: column; min-width: 0; text-align: left; }
    .st-nav-txt b { font-size: .9rem; font-weight: 800; color: var(--color-text); }
    .st-nav-txt small { font-size: .72rem; font-weight: 600; line-height: 1.25; color: var(--color-text-muted); }
    @media (max-width: 899px) {
      .settings-nav-list { flex-direction: row; max-height: none; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; border-radius: 999px; padding: 6px; }
      .settings-nav-list::-webkit-scrollbar { display: none; }
      .st-nav-group, .st-nav-txt small { display: none; }
      .settings-nav-item { flex: none; width: auto; min-height: 44px; padding: 4px 14px 4px 6px; border-radius: 999px; }
    }
    @media (min-width: 900px) { .settings-nav { width: 18rem; } }

    .section-header { padding-bottom: var(--space-3); border-bottom: 2px dashed var(--color-border); }
    .section-header h2 { font-family: Georgia, 'Times New Roman', serif; font-size: clamp(1.6rem, 3.2vw, 2.1rem); font-weight: 500; font-style: italic; letter-spacing: -.02em; }
    .section-header p { margin-top: 4px; font-size: .92rem; }

    .st-card { margin-bottom: 16px; padding: 22px 24px 8px; border-radius: 26px; border: 1px solid var(--color-border); background: #fff; box-shadow: 0 22px 34px -30px rgba(60, 30, 10, .55); }
    .st-card-title { margin: 0 0 4px; font-family: Georgia, 'Times New Roman', serif; font-size: 1.2rem; font-weight: 500; font-style: italic; letter-spacing: -.01em; }
    .st-card-desc { margin: 0 0 16px; font-size: .86rem; line-height: 1.45; color: var(--color-text-muted); }
    .st-card-title + .form-group, .st-card-title + .form-row { margin-top: 14px; }
    .st-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 20px; }
    .st-grid > .st-card-title, .st-grid > .st-card-desc { grid-column: 1 / -1; }
    @media (max-width: 640px) { .st-grid { grid-template-columns: minmax(0, 1fr); } .st-card { padding: 18px 16px 6px; } }
    .st-card-list { padding-bottom: 14px; }

    .form-group label:not(.switch):not(.check-label):not(.btn):not(.checkbox-small) { font-size: .66rem; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; color: var(--color-text-muted); }
    .form-group input:not([type='checkbox']):not([type='radio']), .form-group select, .form-group textarea { border-radius: 16px; background: #fffdfa; }
    .field-hint, .form-group .hint { font-size: .78rem; line-height: 1.4; }
    .st-url { font-weight: 700; color: var(--color-primary); overflow-wrap: anywhere; }

    .checkbox-row { padding: 14px 16px; margin-bottom: 10px; align-items: center; border-radius: 20px; background: #fffdfa; border: 1px solid var(--color-border); transition: border-color .15s, background .15s; }
    .checkbox-row:has(input:checked) { border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border)); background: color-mix(in srgb, var(--color-primary) 6%, #fff); }
    .check-label { font-size: .95rem; font-weight: 800; }
    .switch, .switch .slider { transition: none; }
    .switch { width: 48px; height: 28px; }
    .switch .slider:before { height: 22px; width: 22px; }
    .switch input:checked + .slider:before { transform: translateX(20px); }
    .switch input:checked + .slider { background: linear-gradient(145deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 66%, #000)); }
    .switch input:focus-visible + .slider { outline: 2px solid var(--color-primary); outline-offset: 2px; }

    .current-logo { border-radius: 22px; background: #fffdfa; }
    .upload-controls .btn { border-radius: 999px; }
    .st-upload { display: inline-flex; width: fit-content; cursor: pointer; margin-top: 4px; }
    .st-bank-row { padding: 14px; margin-bottom: 10px; border-radius: 20px; border: 1px dashed var(--color-border); background: #fffdfa; align-items: center; }
    .payment-qr-preview { border-radius: 20px; box-shadow: 0 18px 28px -20px rgba(60, 30, 10, .5); }

    .day-row { border-radius: 22px; border: 1px solid var(--color-border); background: #fff; box-shadow: 0 16px 26px -24px rgba(60, 30, 10, .5); }
    .day-row.closed { background: repeating-linear-gradient(135deg, #f6f1e9 0 6px, #fbf8f3 6px 12px); box-shadow: none; }
    .day-name { font-family: Georgia, 'Times New Roman', serif; font-size: 1.15rem; font-style: italic; font-weight: 500; }
    .closed-badge { padding: 3px 12px; border-radius: 999px; font-size: .72rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--color-text-muted); background: #ece5da; }
    .opening-hours-summary { border-radius: 20px; background: color-mix(in srgb, var(--color-primary) 7%, #fff); border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-border)); }
    .oh-schedule-card { padding: 20px 22px; border-radius: 26px; background: #fff; box-shadow: 0 22px 34px -30px rgba(60, 30, 10, .55); }
    .oh-schedule-card h4 { font-family: Georgia, 'Times New Roman', serif; font-size: 1.1rem; font-style: italic; font-weight: 500; }

    /* Sticky save bar */
    .st-savebar { position: sticky; bottom: 14px; z-index: 20; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 8px; padding: 10px 10px 10px 20px; border-radius: 999px; background: rgba(255, 253, 250, .92); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); border: 1px solid var(--color-border); box-shadow: 0 24px 40px -22px rgba(60, 30, 10, .55); transition: border-color .2s, box-shadow .2s; }
    .st-savebar.dirty { border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-border)); box-shadow: 0 24px 40px -22px var(--color-primary); }
    .st-save-state { display: inline-flex; align-items: center; gap: 10px; font-size: .88rem; font-weight: 700; color: var(--color-text-muted); }
    .st-save-state i { width: 10px; height: 10px; border-radius: 50%; background: #22a05a; }
    .st-savebar.dirty .st-save-state { color: var(--color-text); }
    .st-savebar.dirty .st-save-state i { background: var(--color-primary); animation: st-pulse 1.8s ease-in-out infinite; }
    .st-save-actions { display: inline-flex; gap: 8px; }
    .st-save-actions .btn { min-height: 44px; border-radius: 999px; padding: 0 22px; font-weight: 800; }
    .st-save-actions .btn-primary { background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 66%, #000)); border: 0; box-shadow: 0 14px 22px -14px var(--color-primary); }
    @keyframes st-pulse { 50% { opacity: .35; } }
    @media (prefers-reduced-motion: reduce) { .st-savebar.dirty .st-save-state i { animation: none; } }
    @media (max-width: 560px) { .st-savebar { border-radius: 26px; padding: 12px; } .st-save-actions { width: 100%; } .st-save-actions .btn { flex: 1; } }

    .toast { top: auto; bottom: 90px; border-radius: 999px; padding: 12px 18px 12px 22px; background: #1c1917; font-weight: 700; box-shadow: 0 24px 40px -18px rgba(0,0,0,.6); }
    .toast.success { background: #166534; }
    .toast.error { background: #991b1b; }
  `]
})
export class SettingsComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private translate = inject(TranslateService);
  private sanitizer = inject(DomSanitizer);
  private permissions = inject(PermissionService);

  /** Split UI for `reservation_prepayment_cents` (major + minor units per ISO 4217 / Intl). */
  prepaymentMajorUnits = 0;
  prepaymentMinorUnits = 0;

  getPrepaymentMinorDigits(): number {
    try {
      const opts = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'COP',
      }).resolvedOptions();
      const n = opts.maximumFractionDigits ?? 2;
      return Math.min(6, Math.max(0, n));
    } catch {
      return 2;
    }
  }

  prepaymentMinorMax(): number {
    const d = this.getPrepaymentMinorDigits();
    if (d <= 0) {
      return 0;
    }
    return 10 ** d - 1;
  }

  getPrepaymentCurrencySymbol(): string {
    try {
      const parts = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'COP',
      }).formatToParts(0);
      return parts.find((p) => p.type === 'currency')?.value || 'COP';
    } catch {
      return 'COP';
    }
  }

  getPrepaymentCurrencyLabel(): string {
    const sym = this.getPrepaymentCurrencySymbol();
    return sym && sym !== 'COP' ? `COP (${sym})` : 'COP';
  }

  /** Colombia DIAN electronic invoicing prep: always shown (this deployment is Colombia-only). */
  showDianInvoicingPrep(): boolean {
    return true;
  }

  syncPrepaymentFieldsFromCents(): void {
    const rawTotal = this.formData.reservation_prepayment_cents;
    const total =
      rawTotal == null || rawTotal === 0 || Number.isNaN(Number(rawTotal))
        ? 0
        : Math.max(0, Math.floor(Number(rawTotal)));
    const d = this.getPrepaymentMinorDigits();
    const mod = 10 ** d;
    this.prepaymentMajorUnits = Math.floor(total / mod);
    this.prepaymentMinorUnits = d > 0 ? total % mod : 0;
  }

  applyPrepaymentPartsToCents(): void {
    const d = this.getPrepaymentMinorDigits();
    const mod = 10 ** d;
    let maj = Math.max(0, Math.floor(Number(this.prepaymentMajorUnits) || 0));
    let min = d === 0 ? 0 : Math.max(0, Math.floor(Number(this.prepaymentMinorUnits) || 0));
    if (d > 0 && min >= mod) {
      maj += Math.floor(min / mod);
      min = min % mod;
    }
    this.prepaymentMajorUnits = maj;
    this.prepaymentMinorUnits = min;
    this.formData.reservation_prepayment_cents = maj * mod + min;
  }

  settings = signal<TenantSettings | null>(null);
  taxes = signal<Tax[]>([]);
  taxError = signal('');
  newTaxName = '';
  newTaxRate = 10;
  newTaxValidFrom = new Date().toISOString().slice(0, 10);
  newTaxValidTo = '';
  activeSection = signal<SettingsSectionId>('general');

  /** Unsaved-changes flag for the sticky save bar. */
  dirty = signal(false);
  markDirty(): void {
    if (!this.dirty()) this.dirty.set(true);
  }

  readonly navGroups: {
    labelKey: string;
    items: { id: SettingsSectionId; labelKey: string; descKey: string; icon: string; testid: string | null }[];
  }[] = [
    {
      labelKey: 'SETTINGS.NAV_GROUP_BUSINESS',
      items: [
        { id: 'general', labelKey: 'SETTINGS.BUSINESS_PROFILE', descKey: 'SETTINGS.NAV_DESC_GENERAL', testid: null,
          icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10' },
        { id: 'contact', labelKey: 'SETTINGS.CONTACT_INFO', descKey: 'SETTINGS.NAV_DESC_CONTACT', testid: 'settings-contact-tab',
          icon: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z' },
        { id: 'hours', labelKey: 'SETTINGS.OPENING_HOURS', descKey: 'SETTINGS.NAV_DESC_HOURS', testid: 'settings-hours-tab',
          icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M12 6v6l4 2' },
      ],
    },
    {
      labelKey: 'SETTINGS.NAV_GROUP_OPERATION',
      items: [
        { id: 'reservations', labelKey: 'SETTINGS.RESERVATIONS', descKey: 'SETTINGS.NAV_DESC_RESERVATIONS', testid: null,
          icon: 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M16 2v4 M8 2v4 M3 10h18' },
        { id: 'payments', labelKey: 'SETTINGS.PAYMENT_SETTINGS', descKey: 'SETTINGS.NAV_DESC_PAYMENTS', testid: 'settings-payments-tab',
          icon: 'M3 6h18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z M1 10h22' },
        { id: 'navigation', labelKey: 'SETTINGS.NAVIGATION_UI_TAB', descKey: 'SETTINGS.NAV_DESC_NAVIGATION', testid: 'settings-navigation-tab',
          icon: 'M4 6h16M4 12h16M4 18h10' },
      ],
    },
  ];

  linkCopied = signal(false);

  /** Public booking link of this restaurant (shown in the header, copyable). */
  publicUrl(): string {
    const slug = (this.settings()?.public_slug || '').trim();
    return slug && typeof location !== 'undefined' ? `${location.origin}/${slug}/book` : '';
  }

  /** Live preview while editing the slug field. */
  publicBookPreview(): string {
    const slug = (this.formData.public_slug || '').trim();
    return slug && typeof location !== 'undefined' ? `${location.origin}/${slug}/book` : '';
  }

  copyPublicLink(): void {
    const url = this.publicUrl();
    if (!url) return;
    navigator.clipboard?.writeText(url).then(() => {
      this.linkCopied.set(true);
      setTimeout(() => this.linkCopied.set(false), 2000);
    }).catch(() => {});
  }

  private static readonly SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = [
    'general',
    'navigation',
    'contact',
    'hours',
    'payments',
    'reservations',
  ];

  readonly uiModuleRows: { key: TenantUiModuleKey; labelKey: string; descKey: string }[] = [
    { key: 'tables', labelKey: 'SETTINGS.UI_MODULE_TABLES', descKey: 'SETTINGS.UI_MODULE_TABLES_DESC' },
    {
      key: 'working_plan',
      labelKey: 'SETTINGS.UI_MODULE_WORKING_PLAN',
      descKey: 'SETTINGS.UI_MODULE_WORKING_PLAN_DESC',
    },
    {
      key: 'reservations',
      labelKey: 'SETTINGS.UI_MODULE_RESERVATIONS',
      descKey: 'SETTINGS.UI_MODULE_RESERVATIONS_DESC',
    },
    {
      key: 'kitchen_bar',
      labelKey: 'SETTINGS.UI_MODULE_KITCHEN_BAR',
      descKey: 'SETTINGS.UI_MODULE_KITCHEN_BAR_DESC',
    },
    { key: 'inventory', labelKey: 'SETTINGS.UI_MODULE_INVENTORY', descKey: 'SETTINGS.UI_MODULE_INVENTORY_DESC' },
    { key: 'users', labelKey: 'SETTINGS.UI_MODULE_USERS', descKey: 'SETTINGS.UI_MODULE_USERS_DESC' },
  ];
  loading = signal<boolean>(false);
  saving = signal<boolean>(false);
  error = signal<string | null>(null);
  success = signal<string | null>(null);
  /** Auto-hide save success toast (GitHub #80); manual dismiss still works. */
  private static readonly SETTINGS_SUCCESS_TOAST_MS = 60_000;
  private successDismissTimer?: ReturnType<typeof setTimeout>;
  logoPreview = signal<string | null>(null);
  logoFile: File | null = null;
  headerBackgroundPreview = signal<string | null>(null);
  headerBackgroundFile: File | null = null;

  providers = signal<Provider[]>([]);
  providersLoading = signal(false);
  providersError = signal('');
  providerProductsMap = signal<Record<number, ProviderProduct[]>>({});
  providerProductsExpanded = signal<Set<number>>(new Set());
  showAddProviderModal = signal(false);
  showEditProviderModal = signal(false);
  editingProvider = signal<Provider | null>(null);
  editProviderName = '';
  editProviderUrl = '';
  editProviderPhone = '';
  editProviderEmail = '';
  editProviderActive = true;
  editProviderError = signal('');
  showAddProductModal = signal(false);
  selectedProviderForProduct = signal<Provider | null>(null);
  newProviderName = '';
  newProviderPhone = '';
  newProviderEmail = '';
  providerError = signal('');
  newProductName = '';
  newProductPrice: number | null = null;
  newProductCategory = '';
  newProductOnSale = true;
  providerProductError = signal('');

  otpStatus = signal<{ otp_enabled: boolean; recovery_codes_remaining: number } | null>(null);
  otpStatusLoading = signal(false);
  otpSetupResult = signal<{ secret: string; provisioning_uri: string } | null>(null);
  otpConfirmCode = '';
  otpError = signal<string | null>(null);
  otpConfirming = signal(false);
  /** Account password for disable (replaces OTP code re-entry while logged in; #401). */
  otpDisablePassword = '';
  otpDisabling = signal(false);
  otpSettingUp = signal(false);
  /** One-time plaintext recovery codes after enable/regenerate (#400). */
  otpRecoveryCodes = signal<string[] | null>(null);
  otpRecoverySavedConfirm = false;
  otpRecoveryCopied = signal(false);
  private otpRecoveryCopiedClearTimer: ReturnType<typeof setTimeout> | null = null;
  otpRegenPassword = '';
  otpRegenerating = signal(false);
  /** Brief “Copied” feedback after a successful TOTP secret copy (#377). */
  otpSecretCopied = signal(false);
  private otpSecretCopiedClearTimer: ReturnType<typeof setTimeout> | null = null;

  clockQrBusy = signal(false);
  clockQrDownloadBusy = signal(false);
  clockQrTokenLoading = signal(false);
  /** Plain token: from regenerate response or loaded via GET /tenant/settings/clock-qr/token when encrypted backup exists. */
  clockQrLastToken = signal<string | null>(null);

  purgeConfirmTenantName = '';
  dataExporting = signal(false);
  purging = signal(false);
  purgeError = signal<string | null>(null);

  openingHoursScheduleBaselines = signal<OpeningHoursBaselineRow[]>([]);
  openingHoursScheduleOverrides = signal<OpeningHoursOverrideRow[]>([]);
  loadingOpeningHoursSchedule = signal(false);

  baselineScheduleEffectiveDate = '';
  baselineScheduleNote = '';

  overrideDateFrom = '';
  overrideDateTo = '';
  overrideClosedOnly = false;
  overrideScheduleNote = '';

  daysOfWeek = [
    { key: 'monday', label: 'SETTINGS.DAY_MONDAY' },
    { key: 'tuesday', label: 'SETTINGS.DAY_TUESDAY' },
    { key: 'wednesday', label: 'SETTINGS.DAY_WEDNESDAY' },
    { key: 'thursday', label: 'SETTINGS.DAY_THURSDAY' },
    { key: 'friday', label: 'SETTINGS.DAY_FRIDAY' },
    { key: 'saturday', label: 'SETTINGS.DAY_SATURDAY' },
    { key: 'sunday', label: 'SETTINGS.DAY_SUNDAY' }
  ];

  /** Time options for opening hours: 00:00, 00:15, 00:30, 00:45, ... 23:45 (European 24h). */
  timeOptions: string[] = (() => {
    const opts: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 15, 30, 45]) {
        opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return opts;
  })();

  copyFromDayKey = 'monday';

  /** Role keys for personnel-per-shift (stored in opening_hours JSON per day). */
  readonly staffRoleKeys: { key: string; labelKey: string }[] = [
    { key: 'waiter', labelKey: 'SETTINGS.STAFF_WAITER' },
    { key: 'kitchen', labelKey: 'SETTINGS.STAFF_KITCHEN' },
  ];

  /** Four inputs → saved as unique non-zero percentages (max 4); all zero = tips disabled in POS */
  tipPresetEdit: number[] = [5, 10, 15, 20];

  openingHours: Record<string, {
    open: string;
    close: string;
    closed: boolean;
    hasBreak?: boolean;
    morningOpen?: string;
    morningClose?: string;
    eveningOpen?: string;
    eveningClose?: string;
    /** Custom booking label when the day has no break (or combined “all”). */
    serviceLabel?: string;
    /** Custom booking label for the first window (API: lunch). */
    morningLabel?: string;
    /** Custom booking label for the second window (API: dinner). */
    eveningLabel?: string;
    waiter?: number;
    kitchen?: number;
  }> = {};

  formData: Partial<TenantSettings> = {
    name: '',
    business_type: null,
    description: null,
    phone: null,
    whatsapp: null,
    email: null,
    address: null,
    city: null,
    public_slug: null,
    website: null,
    tax_id: null,
    cif: null,
    ccc: null,
    default_tax_id: null,
    opening_hours: null,
    currency_code: 'COP',
    payment_nequi_number: null,
    payment_llave: null,
    payment_account_holder: null,
    payment_bank_accounts: [],
    immediate_payment_required: false,
    timezone: null,
    country_code: null,
    smtp_host: null,
    smtp_port: null,
    smtp_use_tls: null,
    smtp_user: null,
    smtp_password: null,
    email_from: null,
    email_from_name: null,
    reservation_confirmation_email_subject: null,
    reservation_confirmation_email_body: null,
    public_background_color: null,
    public_primary_color: null,
    reservation_prepayment_cents: null,
    reservation_prepayment_text: null,
    reservation_cancellation_policy: null,
    reservation_arrival_tolerance_minutes: null,
    reservation_average_table_turn_minutes: null,
    reservation_slot_minutes: null,
    reservation_max_guests_per_slot: null,
    reservation_walk_in_tables_reserved: 0,
    reservation_dress_code: null,
    reservation_reminder_24h_enabled: false,
    reservation_reminder_2h_enabled: false,
    guest_birthday_capture_enabled: true,
    guest_birthday_marketing_enabled: false,
    guest_birthday_consent_text: null,
    delivery_fee_cents: 0,
    delivery_radius_meters: null,
    delivery_postal_codes: null,
    latitude: null,
    longitude: null,
    location_radius_meters: 100,
    location_check_enabled: false,
    public_google_review_url: null,
    public_google_maps_url: null,
    public_openstreetmap_url: null,
    public_terms_of_service_url: null,
    public_privacy_policy_url: null,
    public_facebook_url: null,
    public_instagram_url: null,
    tip_tax_rate_percent: 0,
    tip_entry_mode: 'preset' as 'preset' | 'overpayment',
    ui_modules: { ...DEFAULT_TENANT_UI_MODULES },
    clock_qr_location_verify: false,
    dian_mode: 'off' as 'off' | 'test' | 'live',
    dian_tax_regime: null as string | null,
    dian_client_id: null as string | null,
  };

  allTimezones: string[] = [];
  filteredTimezones: string[] = [];
  timezoneSearch = '';
  timezoneDropdownOpen = false;

  ngOnInit() {
    try {
      this.allTimezones = (Intl as any).supportedValuesOf('timeZone');
    } catch {
      this.allTimezones = [];
    }
    this.filteredTimezones = this.allTimezones;
    // Prefer `#hash` (#365); fall back to legacy `?section=` (#395).
    const initial =
      this.resolveSectionId(this.route.snapshot.fragment) ??
      this.resolveSectionId(this.route.snapshot.queryParams['section']);
    if (initial) {
      this.selectSection(initial, true);
      this.scrollActiveSectionIntoView();
    }
    this.route.fragment.subscribe((fragment) => {
      const resolved = this.resolveSectionId(fragment);
      if (resolved) {
        this.applySectionFromUrl(fragment, true);
        return;
      }
      // Unknown non-empty hash: ignore safely → default section (#365).
      if (fragment && fragment.trim() && this.activeSection() !== 'general') {
        this.selectSection('general', false);
      }
    });
    this.route.queryParams.subscribe((params) => {
      // Only apply query when there is no known hash (hash wins).
      if (this.resolveSectionId(this.route.snapshot.fragment)) {
        return;
      }
      this.applySectionFromUrl(params['section'], false);
    });
    this.loadSettings();
  }

  /** Open a settings section; sync `?section=` and `#hash` for deep links / refresh. */
  selectSection(section: SettingsSectionId, updateUrl = true): void {
    this.activeSection.set(section);
    if (updateUrl) {
      const hash = SETTINGS_SECTION_HASH[section];
      const currentQ = this.route.snapshot.queryParams['section'];
      const currentF = this.route.snapshot.fragment;
      if (currentQ !== section || currentF !== hash) {
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { section },
          queryParamsHandling: 'merge',
          fragment: hash,
          replaceUrl: true,
        });
      }
    }
  }

  private resolveSectionId(raw: string | null | undefined): SettingsSectionId | null {
    if (!raw || typeof raw !== 'string') {
      return null;
    }
    const key = raw.trim().toLowerCase().replace(/^#/, '');
    if (!key) {
      return null;
    }
    return (
      SETTINGS_SECTION_ALIASES[key] ??
      ((SettingsComponent.SETTINGS_SECTION_IDS as readonly string[]).includes(key)
        ? (key as SettingsSectionId)
        : null)
    );
  }

  private applySectionFromUrl(raw: string | null | undefined, scroll: boolean): void {
    const resolved = this.resolveSectionId(raw);
    if (!resolved) {
      return;
    }
    const changed = this.activeSection() !== resolved;
    if (changed) {
      this.selectSection(resolved, false);
    }
    if (scroll && changed) {
      this.scrollActiveSectionIntoView();
    }
  }

  private scrollActiveSectionIntoView(): void {
    queueMicrotask(() => {
      const el =
        document.querySelector<HTMLElement>('.content .section') ??
        document.querySelector<HTMLElement>('.content');
      el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }

  settingsModuleTabVisible(key: TenantUiModuleKey): boolean {
    const s = this.settings();
    if (!s?.ui_modules) return true;
    return s.ui_modules[key] !== false;
  }

  /**
   * Placeholder for From name: show Business Name when set.
   * Empty saved value stays empty; send path falls back to Business Name.
   */
  emailFromNamePlaceholder(): string {
    const business = (this.formData.name || '').trim();
    if (business) {
      return business;
    }
    return this.translate.instant('SETTINGS.EMAIL_FROM_PLACEHOLDER');
  }

  /** Optional one-click fill for public page background (RAL5002 Azul). */
  readonly publicBackgroundRal5002 = '#1E22AA';

  /** Colour input only accepts #RRGGBB; keep last valid value while the hex field is mid-edit. */
  private publicBackgroundColorPickerFallback = '#f5f5f5';

  private normalizeHex6(value: string | null | undefined): string | null {
    const raw = (value || '').trim();
    if (!raw) return null;
    const body = raw.startsWith('#') ? raw.slice(1) : raw;
    if (!/^[0-9A-Fa-f]{6}$/.test(body)) return null;
    return `#${body.toUpperCase()}`;
  }

  publicBackgroundColorPickerValue(): string {
    return this.normalizeHex6(this.formData.public_background_color) ?? this.publicBackgroundColorPickerFallback;
  }

  onPublicBackgroundColorPicked(value: string): void {
    this.formData.public_background_color = value;
    this.publicBackgroundColorPickerFallback = value;
  }

  onPublicBackgroundHexModelChange(value: string | null): void {
    const normalized = this.normalizeHex6(value);
    if (normalized) {
      this.publicBackgroundColorPickerFallback = normalized;
    }
  }

  normalizePublicBackgroundHex(): void {
    const normalized = this.normalizeHex6(this.formData.public_background_color);
    if (normalized) {
      this.formData.public_background_color = normalized;
      this.publicBackgroundColorPickerFallback = normalized;
    }
  }

  applyPublicBackgroundRal5002Preset(): void {
    this.formData.public_background_color = this.publicBackgroundRal5002;
    this.publicBackgroundColorPickerFallback = this.publicBackgroundRal5002;
  }

  loadSettings() {
    this.loading.set(true);
    this.dirty.set(false);
    this.api.getTenantSettings().subscribe({
      next: (settings) => {
        this.settings.set(settings);
        this.formData = {
          name: settings.name || '',
          business_type: settings.business_type || null,
          description: settings.description || null,
          phone: settings.phone || null,
          whatsapp: settings.whatsapp || null,
          email: settings.email || null,
          address: settings.address || null,
          city: settings.city || null,
          public_slug: settings.public_slug || null,
          website: settings.website || null,
          tax_id: settings.tax_id || null,
          cif: settings.cif || null,
          ccc: settings.ccc || null,
          default_tax_id: settings.default_tax_id ?? null,
          opening_hours: settings.opening_hours || null,
          currency_code: settings.currency_code || 'COP',
          payment_nequi_number: settings.payment_nequi_number ?? null,
          payment_llave: settings.payment_llave ?? null,
          payment_account_holder: settings.payment_account_holder ?? null,
          payment_bank_accounts: settings.payment_bank_accounts ?? [],
          immediate_payment_required: settings.immediate_payment_required || false,
          timezone: settings.timezone || null,
          country_code: settings.country_code ?? null,
          smtp_host: settings.smtp_host ?? null,
          smtp_port: settings.smtp_port ?? null,
          smtp_use_tls: settings.smtp_use_tls ?? null,
          smtp_user: settings.smtp_user ?? null,
          smtp_password: null,
          email_from: settings.email_from ?? null,
          email_from_name: settings.email_from_name ?? null,
          reservation_confirmation_email_subject: settings.reservation_confirmation_email_subject ?? null,
          reservation_confirmation_email_body: settings.reservation_confirmation_email_body ?? null,
          public_background_color: settings.public_background_color ?? null,
          public_primary_color: settings.public_primary_color ?? null,
          reservation_prepayment_cents: settings.reservation_prepayment_cents ?? null,
          reservation_prepayment_text: settings.reservation_prepayment_text ?? null,
          reservation_cancellation_policy: settings.reservation_cancellation_policy ?? null,
          reservation_arrival_tolerance_minutes: settings.reservation_arrival_tolerance_minutes ?? null,
          reservation_average_table_turn_minutes: settings.reservation_average_table_turn_minutes ?? null,
          reservation_slot_minutes: settings.reservation_slot_minutes ?? null,
          reservation_max_guests_per_slot: settings.reservation_max_guests_per_slot ?? null,
          reservation_walk_in_tables_reserved: settings.reservation_walk_in_tables_reserved ?? 0,
          reservation_dress_code: settings.reservation_dress_code ?? null,
          reservation_reminder_24h_enabled: settings.reservation_reminder_24h_enabled ?? false,
          reservation_reminder_2h_enabled: settings.reservation_reminder_2h_enabled ?? false,
          guest_birthday_capture_enabled: settings.guest_birthday_capture_enabled ?? true,
          guest_birthday_marketing_enabled: settings.guest_birthday_marketing_enabled ?? false,
          guest_birthday_consent_text: settings.guest_birthday_consent_text ?? null,
          delivery_fee_cents: settings.delivery_fee_cents ?? 0,
          delivery_radius_meters: settings.delivery_radius_meters ?? null,
          delivery_postal_codes: this.formatDeliveryPostalCodesForForm(settings.delivery_postal_codes),
          latitude: settings.latitude ?? null,
          longitude: settings.longitude ?? null,
          location_radius_meters: settings.location_radius_meters ?? 100,
          location_check_enabled: settings.location_check_enabled ?? false,
          public_google_review_url: settings.public_google_review_url ?? null,
          public_google_maps_url: settings.public_google_maps_url ?? null,
          public_openstreetmap_url: settings.public_openstreetmap_url ?? null,
          public_terms_of_service_url: settings.public_terms_of_service_url ?? null,
          public_privacy_policy_url: settings.public_privacy_policy_url ?? null,
          public_facebook_url: settings.public_facebook_url ?? null,
          public_instagram_url: settings.public_instagram_url ?? null,
          tip_tax_rate_percent: settings.tip_tax_rate_percent ?? 0,
          tip_entry_mode:
            settings.tip_entry_mode === 'overpayment' ? 'overpayment' : 'preset',
          ui_modules: {
            ...DEFAULT_TENANT_UI_MODULES,
            ...(settings.ui_modules || {}),
          },
          clock_qr_active: settings.clock_qr_active ?? false,
          clock_qr_location_verify: settings.clock_qr_location_verify ?? false,
          dian_mode:
            settings.dian_mode === 'test' || settings.dian_mode === 'live'
              ? settings.dian_mode
              : 'off',
          dian_tax_regime: settings.dian_tax_regime?.trim() || null,
          dian_client_id: settings.dian_client_id?.trim() || null,
        };
        this.publicBackgroundColorPickerFallback =
          this.normalizeHex6(settings.public_background_color) ?? '#f5f5f5';
        this.clockQrLastToken.set(null);
        this.clockQrTokenLoading.set(false);
        if (settings.clock_qr_active && settings.clock_qr_downloadable) {
          this.loadPersistedClockQrToken();
        }
        const tip = settings.tip_preset_percents;
        if (Array.isArray(tip) && tip.length > 0) {
          this.tipPresetEdit = [...tip.map((x) => Math.min(100, Math.max(0, Math.floor(Number(x) || 0))))];
          while (this.tipPresetEdit.length < 4) {
            this.tipPresetEdit.push(0);
          }
          this.tipPresetEdit = this.tipPresetEdit.slice(0, 4);
        } else if (Array.isArray(tip) && tip.length === 0) {
          this.tipPresetEdit = [0, 0, 0, 0];
        } else {
          this.tipPresetEdit = [5, 10, 15, 20];
        }
        this.timezoneSearch = settings.timezone || '';
        this.parseOpeningHours(settings.opening_hours);
        this.loadOpeningHoursSchedule();
        this.syncPrepaymentFieldsFromCents();
        this.loadTaxes();
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set('Failed to load settings. Please try again.');
        this.loading.set(false);
        console.error('Error loading settings:', err);
      }
    });
  }

  loadTaxes() {
    // Load all taxes (not only "valid today") so the dropdown never ends up empty
    // because of validity-period edge cases (timezones, future valid_from).
    this.api.getTaxes(false).subscribe({
      next: (list) => this.taxes.set(list),
      error: () => this.taxes.set([]),
    });
  }

  /** Show postal codes as one-per-line in settings textarea. */
  private formatDeliveryPostalCodesForForm(raw: string | null | undefined): string | null {
    if (!raw || !String(raw).trim()) return null;
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x).trim()).filter(Boolean).join('\n');
      }
    } catch {
      /* plain text */
    }
    return String(raw);
  }

  loadOpeningHoursSchedule(): void {
    this.loadingOpeningHoursSchedule.set(true);
    this.api.getOpeningHoursSchedule().subscribe({
      next: (res) => {
        this.openingHoursScheduleBaselines.set(res.baselines || []);
        this.openingHoursScheduleOverrides.set(res.overrides || []);
        this.loadingOpeningHoursSchedule.set(false);
      },
      error: () => {
        this.openingHoursScheduleBaselines.set([]);
        this.openingHoursScheduleOverrides.set([]);
        this.loadingOpeningHoursSchedule.set(false);
      },
    });
  }

  /** Snapshot of the weekly grid as stored JSON (same shape as tenant.opening_hours). */
  private weeklyOpeningHoursJsonFromGrid(): string {
    this.serializeOpeningHours();
    const s = this.formData.opening_hours;
    return (s && String(s).trim()) ? String(s).trim() : '{}';
  }

  addBaselineSchedule(): void {
    const eff = (this.baselineScheduleEffectiveDate || '').trim();
    if (!eff) {
      this.error.set(this.translate.instant('SETTINGS.OPENING_HOURS_EFFECTIVE_FROM_REQUIRED'));
      return;
    }
    const oh = this.weeklyOpeningHoursJsonFromGrid();
    this.saving.set(true);
    this.error.set(null);
    this.api
      .createOpeningHoursBaseline({
        effective_from: eff,
        opening_hours: oh,
        note: this.baselineScheduleNote.trim() || null,
      })
      .subscribe({
        next: () => {
          this.baselineScheduleEffectiveDate = '';
          this.baselineScheduleNote = '';
          this.loadOpeningHoursSchedule();
          this.saving.set(false);
        },
        error: (err) => {
          this.saving.set(false);
          const d = err?.error?.detail;
          this.error.set(typeof d === 'string' ? d : this.translate.instant('COMMON.ERROR'));
        },
      });
  }

  deleteBaselineSchedule(id: number): void {
    if (!confirm(this.translate.instant('SETTINGS.OPENING_HOURS_CONFIRM_DELETE'))) return;
    this.api.deleteOpeningHoursBaseline(id).subscribe({
      next: () => this.loadOpeningHoursSchedule(),
      error: () => {},
    });
  }

  addOverrideSchedule(): void {
    const df = (this.overrideDateFrom || '').trim();
    const dt = (this.overrideDateTo || '').trim();
    if (!df || !dt) {
      this.error.set(this.translate.instant('SETTINGS.OPENING_HOURS_DATES_REQUIRED'));
      return;
    }
    const closed = this.overrideClosedOnly;
    const oh = closed ? null : this.weeklyOpeningHoursJsonFromGrid();
    this.saving.set(true);
    this.error.set(null);
    this.api
      .createOpeningHoursOverride({
        date_from: df,
        date_to: dt,
        closed,
        opening_hours: oh,
        note: this.overrideScheduleNote.trim() || null,
      })
      .subscribe({
        next: () => {
          this.overrideDateFrom = '';
          this.overrideDateTo = '';
          this.overrideScheduleNote = '';
          this.overrideClosedOnly = false;
          this.loadOpeningHoursSchedule();
          this.saving.set(false);
        },
        error: (err) => {
          this.saving.set(false);
          const d = err?.error?.detail;
          this.error.set(typeof d === 'string' ? d : this.translate.instant('COMMON.ERROR'));
        },
      });
  }

  deleteOverrideSchedule(id: number): void {
    if (!confirm(this.translate.instant('SETTINGS.OPENING_HOURS_CONFIRM_DELETE'))) return;
    this.api.deleteOpeningHoursOverride(id).subscribe({
      next: () => this.loadOpeningHoursSchedule(),
      error: () => {},
    });
  }

  loadTaxesAll() {
    this.api.getTaxes(false).subscribe({
      next: (list) => this.taxes.set(list),
      error: () => this.taxes.set([]),
    });
  }

  addTax() {
    this.taxError.set('');
    const validFrom = this.newTaxValidFrom || new Date().toISOString().slice(0, 10);
    const validTo = this.newTaxValidTo?.trim() || null;
    this.api.createTax({
      name: this.newTaxName.trim(),
      rate_percent: this.newTaxRate,
      valid_from: validFrom,
      valid_to: validTo ?? undefined,
    }).subscribe({
      next: () => {
        this.newTaxName = '';
        this.newTaxRate = 10;
        this.newTaxValidFrom = new Date().toISOString().slice(0, 10);
        this.newTaxValidTo = '';
        this.loadTaxesAll();
        this.loadTaxes();
      },
      error: (err) => this.taxError.set(err?.error?.detail || 'Failed to add tax'),
    });
  }

  deleteTax(id: number) {
    if (!confirm(this.translate.instant('SETTINGS.CONFIRM_DELETE_TAX'))) return;
    this.taxError.set('');
    this.api.deleteTax(id).subscribe({
      next: () => {
        this.loadTaxesAll();
        this.loadTaxes();
      },
      error: (err) => this.taxError.set(err?.error?.detail || 'Failed to delete tax'),
    });
  }

  loadProviders() {
    this.providersLoading.set(true);
    this.providersError.set('');
    this.api.getProviders(true).subscribe({
      next: (list) => {
        this.providers.set(list);
        this.providersLoading.set(false);
      },
      error: (err) => {
        this.providersError.set(err?.error?.detail || 'Failed to load providers');
        this.providersLoading.set(false);
      },
    });
  }

  isOwnProvider(p: Provider): boolean {
    const tenantId = this.api.getCurrentUser()?.tenant_id;
    return p.tenant_id != null && tenantId != null && p.tenant_id === tenantId;
  }

  toggleProviderProducts(p: Provider) {
    const id = p.id!;
    const expanded = new Set(this.providerProductsExpanded());
    if (expanded.has(id)) {
      expanded.delete(id);
    } else {
      expanded.add(id);
      this.api.listProviderProducts(id).subscribe({
        next: (products) => {
          this.providerProductsMap.update((m) => ({ ...m, [id]: products }));
        },
      });
    }
    this.providerProductsExpanded.set(expanded);
  }

  formatProviderPrice(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return formatMoneyCents(cents);
  }

  openAddProviderModal() {
    this.newProviderName = '';
    this.newProviderPhone = '';
    this.newProviderEmail = '';
    this.providerError.set('');
    this.showAddProviderModal.set(true);
  }

  closeAddProviderModal() {
    this.showAddProviderModal.set(false);
  }

  saveProvider() {
    this.providerError.set('');
    const name = this.newProviderName?.trim();
    if (!name) {
      this.providerError.set(this.translate.instant('SETTINGS.PROVIDER_NAME_REQUIRED'));
      return;
    }
    const body: ProviderCreate = {
      name,
      phone: this.newProviderPhone?.trim() || undefined,
      email: this.newProviderEmail?.trim() || undefined,
    };
    this.api.createProvider(body).subscribe({
      next: () => {
        this.closeAddProviderModal();
        this.loadProviders();
      },
      error: (err) => this.providerError.set(err?.error?.detail || 'Failed to add provider'),
    });
  }

  openEditProviderModal(p: Provider) {
    this.editingProvider.set(p);
    this.editProviderName = p.name || '';
    this.editProviderUrl = p.url || '';
    this.editProviderPhone = p.phone || '';
    this.editProviderEmail = p.email || '';
    this.editProviderActive = p.is_active !== false;
    this.editProviderError.set('');
    this.showEditProviderModal.set(true);
  }

  closeEditProviderModal() {
    this.showEditProviderModal.set(false);
    this.editingProvider.set(null);
  }

  saveEditedProvider() {
    const p = this.editingProvider();
    const id = p?.id;
    if (id == null) return;
    this.editProviderError.set('');
    const name = this.editProviderName?.trim();
    if (!name) {
      this.editProviderError.set(this.translate.instant('SETTINGS.PROVIDER_NAME_REQUIRED'));
      return;
    }
    const body: PersonalProviderPatch = {
      name,
      url: this.editProviderUrl?.trim() || null,
      phone: this.editProviderPhone?.trim() || null,
      email: this.editProviderEmail?.trim() || null,
      is_active: this.editProviderActive,
    };
    this.api.patchPersonalProvider(id, body).subscribe({
      next: () => {
        this.closeEditProviderModal();
        this.loadProviders();
      },
      error: (err) =>
        this.editProviderError.set(
          typeof err?.error?.detail === 'string'
            ? err.error.detail
            : 'Failed to update provider',
        ),
    });
  }

  openAddProductModal(p: Provider) {
    this.selectedProviderForProduct.set(p);
    this.newProductName = '';
    this.newProductPrice = null;
    this.newProductCategory = '';
    this.newProductOnSale = true;
    this.providerProductError.set('');
    this.showAddProductModal.set(true);
  }

  closeAddProductModal() {
    this.showAddProductModal.set(false);
    this.selectedProviderForProduct.set(null);
  }

  saveProviderProduct() {
    const provider = this.selectedProviderForProduct();
    const providerId = provider?.id;
    if (providerId == null) return;
    this.providerProductError.set('');
    const name = this.newProductName?.trim();
    if (!name) {
      this.providerProductError.set(this.translate.instant('SETTINGS.PRODUCT_NAME_REQUIRED'));
      return;
    }
    const body: ProviderProductCreate = {
      name,
      price_cents: this.newProductPrice ?? undefined,
      category: this.newProductCategory?.trim() || undefined,
      availability: this.newProductOnSale,
    };
    this.api.createProductForProvider(providerId, body).subscribe({
      next: () => {
        this.closeAddProductModal();
        this.api.listProviderProducts(providerId).subscribe({
          next: (products) => {
            this.providerProductsMap.update((m) => ({ ...m, [providerId]: products }));
          },
        });
      },
      error: (err) => this.providerProductError.set(err?.error?.detail || 'Failed to add product'),
    });
  }

  loadOtpStatus() {
    this.otpStatusLoading.set(true);
    this.otpError.set(null);
    this.api.getOtpStatus().subscribe({
      next: (status) => {
        this.otpStatus.set(status);
        this.otpStatusLoading.set(false);
      },
      error: () => {
        this.otpStatus.set(null);
        this.otpStatusLoading.set(false);
      },
    });
  }

  startOtpSetup() {
    this.otpError.set(null);
    this.otpSettingUp.set(true);
    this.api.setupOtp().subscribe({
      next: (result) => {
        this.otpSetupResult.set(result);
        this.otpSettingUp.set(false);
      },
      error: (err) => {
        this.otpError.set(err?.error?.detail || 'Failed to setup OTP');
        this.otpSettingUp.set(false);
      },
    });
  }

  copyOtpSecret() {
    const secret = this.otpSetupResult()?.secret;
    if (!secret) return;
    this.otpError.set(null);

    const onOk = () => this.flashOtpSecretCopied();
    const onFail = () =>
      this.otpError.set(this.translate.instant('SETTINGS.OTP_SECRET_COPY_FAILED'));

    // Clipboard API often fails in strict browsers (e.g. LibreWolf). Fall back to execCommand.
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(secret).then(onOk).catch(() => {
        if (!this.copyTextViaExecCommand(secret)) onFail();
        else onOk();
      });
      return;
    }
    if (!this.copyTextViaExecCommand(secret)) onFail();
    else onOk();
  }

  private flashOtpSecretCopied(): void {
    if (this.otpSecretCopiedClearTimer) {
      clearTimeout(this.otpSecretCopiedClearTimer);
      this.otpSecretCopiedClearTimer = null;
    }
    this.otpSecretCopied.set(true);
    this.otpSecretCopiedClearTimer = setTimeout(() => {
      this.otpSecretCopied.set(false);
      this.otpSecretCopiedClearTimer = null;
    }, 2000);
  }

  /** Sync copy fallback for browsers that block Clipboard API (Firefox/LibreWolf). */
  private copyTextViaExecCommand(text: string): boolean {
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    } finally {
      document.body.removeChild(textarea);
    }
    return ok;
  }

  confirmOtpEnable() {
    if (!this.otpConfirmCode || this.otpConfirmCode.length !== 6) return;
    this.otpError.set(null);
    this.otpConfirming.set(true);
    this.api.confirmOtp(this.otpConfirmCode).subscribe({
      next: (res) => {
        const codes = Array.isArray(res?.recovery_codes) ? res.recovery_codes : [];
        this.otpStatus.set({
          otp_enabled: true,
          recovery_codes_remaining: codes.length,
        });
        this.otpSetupResult.set(null);
        this.otpConfirmCode = '';
        this.otpConfirming.set(false);
        this.otpRecoverySavedConfirm = false;
        this.otpRecoveryCodes.set(codes);
      },
      error: (err) => {
        this.otpError.set(err?.error?.detail || 'Invalid code');
        this.otpConfirming.set(false);
      },
    });
  }

  cancelOtpSetup() {
    this.otpSetupResult.set(null);
    this.otpConfirmCode = '';
    this.otpError.set(null);
    this.otpSecretCopied.set(false);
    if (this.otpSecretCopiedClearTimer) {
      clearTimeout(this.otpSecretCopiedClearTimer);
      this.otpSecretCopiedClearTimer = null;
    }
    this.loadOtpStatus();
  }

  dismissOtpRecoveryCodes() {
    if (!this.otpRecoverySavedConfirm) return;
    this.otpRecoveryCodes.set(null);
    this.otpRecoverySavedConfirm = false;
    this.otpRecoveryCopied.set(false);
    if (this.otpRecoveryCopiedClearTimer) {
      clearTimeout(this.otpRecoveryCopiedClearTimer);
      this.otpRecoveryCopiedClearTimer = null;
    }
    this.otpRegenPassword = '';
    this.loadOtpStatus();
  }

  copyOtpRecoveryCodes() {
    const codes = this.otpRecoveryCodes();
    if (!codes?.length) return;
    this.otpError.set(null);
    const text = codes.join('\n');
    const onOk = () => {
      if (this.otpRecoveryCopiedClearTimer) {
        clearTimeout(this.otpRecoveryCopiedClearTimer);
        this.otpRecoveryCopiedClearTimer = null;
      }
      this.otpRecoveryCopied.set(true);
      this.otpRecoveryCopiedClearTimer = setTimeout(() => {
        this.otpRecoveryCopied.set(false);
        this.otpRecoveryCopiedClearTimer = null;
      }, 2000);
    };
    const onFail = () =>
      this.otpError.set(this.translate.instant('SETTINGS.OTP_SECRET_COPY_FAILED'));
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(onOk).catch(() => {
        if (!this.copyTextViaExecCommand(text)) onFail();
        else onOk();
      });
      return;
    }
    if (!this.copyTextViaExecCommand(text)) onFail();
    else onOk();
  }

  downloadOtpRecoveryCodes() {
    const codes = this.otpRecoveryCodes();
    if (!codes?.length) return;
    const blob = new Blob([codes.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pos-otp-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  regenerateOtpRecoveryCodes() {
    const password = (this.otpRegenPassword || '').trim();
    if (!password) return;
    this.otpError.set(null);
    this.otpRegenerating.set(true);
    this.api.regenerateOtpRecoveryCodes(password).subscribe({
      next: (res) => {
        const codes = Array.isArray(res?.recovery_codes) ? res.recovery_codes : [];
        this.otpRegenPassword = '';
        this.otpRegenerating.set(false);
        this.otpRecoverySavedConfirm = false;
        this.otpRecoveryCodes.set(codes);
        this.otpStatus.set({
          otp_enabled: true,
          recovery_codes_remaining: codes.length,
        });
      },
      error: (err) => {
        const detail = err?.error?.detail;
        this.otpError.set(
          typeof detail === 'string'
            ? detail
            : detail?.message || this.translate.instant('SETTINGS.OTP_RECOVERY_REGENERATE_FAILED'),
        );
        this.otpRegenerating.set(false);
      },
    });
  }

  disableOtp() {
    const password = (this.otpDisablePassword || '').trim();
    if (!password) return;
    this.otpError.set(null);
    this.otpDisabling.set(true);
    this.api.disableOtp(password).subscribe({
      next: () => {
        this.otpStatus.set({ otp_enabled: false, recovery_codes_remaining: 0 });
        this.otpDisablePassword = '';
        this.otpDisabling.set(false);
        this.otpRecoveryCodes.set(null);
        this.otpRegenPassword = '';
      },
      error: (err) => {
        const detail = err?.error?.detail;
        this.otpError.set(
          typeof detail === 'string'
            ? detail
            : detail?.message || this.translate.instant('SETTINGS.OTP_DISABLE_FAILED'),
        );
        this.otpDisabling.set(false);
      },
    });
  }

  isTenantOwner(): boolean {
    return this.api.getCurrentUser()?.role === 'owner';
  }

  isTenantOwnerOrAdmin(): boolean {
    return this.api.getCurrentUser()?.role === 'owner';
  }

  downloadTenantDataExport(): void {
    this.purgeError.set(null);
    this.dataExporting.set(true);
    this.api.downloadTenantDataExport().subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tenant-data-export.zip';
        a.click();
        URL.revokeObjectURL(url);
        this.dataExporting.set(false);
      },
      error: () => {
        this.purgeError.set(this.translate.instant('SETTINGS.DATA_EXPORT_FAILED'));
        this.dataExporting.set(false);
      },
    });
  }

  purgeTenantForever(): void {
    this.purgeError.set(null);
    const name = this.purgeConfirmTenantName.trim();
    this.purging.set(true);
    this.api.purgeTenant(name).subscribe({
      next: () => {
        this.api.logout().subscribe(() => this.router.navigateByUrl('/login'));
      },
      error: (err) => {
        const detail = err?.error?.detail;
        this.purgeError.set(
          typeof detail === 'string' ? detail : this.translate.instant('SETTINGS.PURGE_FAILED'),
        );
        this.purging.set(false);
      },
    });
  }

  filterTimezones() {
    const q = this.timezoneSearch.toLowerCase();
    this.filteredTimezones = q
      ? this.allTimezones.filter(tz => tz.toLowerCase().includes(q))
      : this.allTimezones;
  }

  selectTimezone(tz: string) {
    this.formData.timezone = tz;
    this.timezoneSearch = tz;
    this.timezoneDropdownOpen = false;
  }

  parseOpeningHours(jsonString: string | null | undefined) {
    // Initialize all days with default values
    this.daysOfWeek.forEach(day => {
      this.openingHours[day.key] = {
        open: '09:00',
        close: '22:00',
        closed: false,
        hasBreak: false,
        morningOpen: '09:00',
        morningClose: '14:00',
        eveningOpen: '17:00',
        eveningClose: '22:00',
        serviceLabel: '',
        morningLabel: '',
        eveningLabel: '',
        waiter: 0,
        kitchen: 0,
      };
    });

    // Parse JSON if provided; round all times to :00, :15, :30, :45
    if (jsonString) {
      try {
        const parsed = JSON.parse(jsonString);
        this.daysOfWeek.forEach(day => {
          if (parsed[day.key]) {
            const dayData = parsed[day.key];
            const num = (v: unknown) => (typeof v === 'number' && v >= 0 && Number.isInteger(v) ? v : 0);
            const label = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 64) : '');
            this.openingHours[day.key] = {
              open: this.roundTimeToQuarter(dayData.open || '09:00'),
              close: this.roundTimeToQuarter(dayData.close || '22:00'),
              closed: dayData.closed === true,
              hasBreak: dayData.hasBreak === true,
              morningOpen: this.roundTimeToQuarter(dayData.morningOpen || dayData.open || '09:00'),
              morningClose: this.roundTimeToQuarter(dayData.morningClose || '14:00'),
              eveningOpen: this.roundTimeToQuarter(dayData.eveningOpen || '17:00'),
              eveningClose: this.roundTimeToQuarter(dayData.eveningClose || dayData.close || '22:00'),
              serviceLabel: label(dayData.serviceLabel),
              morningLabel: label(dayData.morningLabel),
              eveningLabel: label(dayData.eveningLabel),
              waiter: num(dayData.waiter),
              kitchen: num(dayData.kitchen),
            };
          }
        });
      } catch (e) {
        console.error('Error parsing opening hours JSON:', e);
      }
    }
  }

  toggleDayClosed(dayKey: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.openingHours[dayKey].closed = !checked;
    this.serializeOpeningHours();
  }

  toggleBreak(dayKey: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.openingHours[dayKey].hasBreak = checked;
    // If enabling break, initialize with default values if not set
    if (checked) {
      if (!this.openingHours[dayKey].morningOpen) {
        this.openingHours[dayKey].morningOpen = this.openingHours[dayKey].open || '09:00';
      }
      if (!this.openingHours[dayKey].morningClose) {
        this.openingHours[dayKey].morningClose = '14:00';
      }
      if (!this.openingHours[dayKey].eveningOpen) {
        this.openingHours[dayKey].eveningOpen = '17:00';
      }
      if (!this.openingHours[dayKey].eveningClose) {
        this.openingHours[dayKey].eveningClose = this.openingHours[dayKey].close || '22:00';
      }
    }
    this.serializeOpeningHours();
  }

  /** Round time string to nearest 15 minutes (00, 15, 30, 45). European 24h. */
  roundTimeToQuarter(t: string | undefined): string {
    if (!t) return '09:00';
    const [h, m] = t.split(':').map(Number);
    const quarter = Math.round((h * 60 + (m || 0)) / 15) * 15;
    const nh = Math.floor(quarter / 60) % 24;
    const nm = quarter % 60;
    return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
  }

  updateOpeningHours(dayKey: string, field: 'open' | 'close' | 'morningOpen' | 'morningClose' | 'eveningOpen' | 'eveningClose', event: Event) {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.setOpeningHourValue(dayKey, field, value);
  }

  setOpeningHourValue(dayKey: string, field: 'open' | 'close' | 'morningOpen' | 'morningClose' | 'eveningOpen' | 'eveningClose', value: string) {
    (this.openingHours[dayKey] as any)[field] = this.roundTimeToQuarter(value);
    this.serializeOpeningHours();
  }

  setServiceLabelValue(
    dayKey: string,
    field: 'serviceLabel' | 'morningLabel' | 'eveningLabel',
    value: string,
  ): void {
    (this.openingHours[dayKey] as any)[field] = (value || '').trim().slice(0, 64);
    this.serializeOpeningHours();
  }

  copyDayToOtherDays(sourceKey: string) {
    const source = this.openingHours[sourceKey];
    if (!source) return;
    this.daysOfWeek.forEach(day => {
      if (day.key === sourceKey) return;
      this.openingHours[day.key] = {
        ...source,
        open: source.open,
        close: source.close,
        closed: source.closed,
        hasBreak: source.hasBreak,
        morningOpen: source.morningOpen,
        morningClose: source.morningClose,
        eveningOpen: source.eveningOpen,
        eveningClose: source.eveningClose,
        serviceLabel: source.serviceLabel || '',
        morningLabel: source.morningLabel || '',
        eveningLabel: source.eveningLabel || '',
        waiter: source.waiter ?? 0,
        kitchen: source.kitchen ?? 0,
      };
    });
    this.serializeOpeningHours();
  }

  /** Formatted opening hours summary in current locale, e.g. "Mon–Fri 09:00–22:00, Sat 10:00–20:00, Sun closed". */
  getOpeningHoursSummary(): string {
    const locale = this.translate.currentLang || this.translate.defaultLang || 'en';
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    const dayShort = (key: string) => {
      const i = this.daysOfWeek.findIndex(d => d.key === key);
      if (i < 0) return key;
      return formatter.format(new Date(2024, 0, 1 + i));
    };
    const closedLabel = this.translate.instant('SETTINGS.CLOSED');
    const parts: string[] = [];
    let i = 0;
    while (i < this.daysOfWeek.length) {
      const day = this.daysOfWeek[i];
      const d = this.openingHours[day.key];
      if (!d) {
        i++;
        continue;
      }
      if (d.closed) {
        parts.push(`${dayShort(day.key)} ${closedLabel}`);
        i++;
        continue;
      }
      const range = d.hasBreak
        ? `${d.morningOpen}–${d.morningClose}, ${d.eveningOpen}–${d.eveningClose}`
        : `${d.open}–${d.close}`;
      let j = i + 1;
      while (j < this.daysOfWeek.length) {
        const next = this.openingHours[this.daysOfWeek[j].key];
        if (!next || next.closed !== d.closed || next.hasBreak !== d.hasBreak) break;
        if (d.hasBreak) {
          if (next.morningOpen !== d.morningOpen || next.morningClose !== d.morningClose ||
              next.eveningOpen !== d.eveningOpen || next.eveningClose !== d.eveningClose) break;
        } else {
          if (next.open !== d.open || next.close !== d.close) break;
        }
        j++;
      }
      if (j > i + 1) {
        parts.push(`${dayShort(day.key)}–${dayShort(this.daysOfWeek[j - 1].key)} ${range}`);
      } else {
        parts.push(`${dayShort(day.key)} ${range}`);
      }
      i = j;
    }
    return parts.join(', ');
  }

  serializeOpeningHours() {
    const serialized: Record<string, any> = {};
    this.daysOfWeek.forEach(day => {
      const dayData = this.openingHours[day.key];
      const staff = {
        waiter: dayData.waiter ?? 0,
        kitchen: dayData.kitchen ?? 0,
      };
      const morningLabel = (dayData.morningLabel || '').trim().slice(0, 64);
      const eveningLabel = (dayData.eveningLabel || '').trim().slice(0, 64);
      const serviceLabel = (dayData.serviceLabel || '').trim().slice(0, 64);
      if (dayData.hasBreak) {
        serialized[day.key] = {
          closed: dayData.closed,
          hasBreak: true,
          morningOpen: dayData.morningOpen,
          morningClose: dayData.morningClose,
          eveningOpen: dayData.eveningOpen,
          eveningClose: dayData.eveningClose,
          open: dayData.morningOpen,
          close: dayData.eveningClose,
          ...(morningLabel ? { morningLabel } : {}),
          ...(eveningLabel ? { eveningLabel } : {}),
          ...(serviceLabel ? { serviceLabel } : {}),
          ...staff,
        };
      } else {
        serialized[day.key] = {
          closed: dayData.closed,
          open: dayData.open,
          close: dayData.close,
          ...(serviceLabel ? { serviceLabel } : {}),
          ...staff,
        };
      }
    });
    this.formData.opening_hours = JSON.stringify(serialized);
  }

  getStaffRequired(dayKey: string, roleKey: string): number {
    const day = this.openingHours[dayKey];
    return day && typeof (day as any)[roleKey] === 'number' ? (day as any)[roleKey] : 0;
  }

  setStaffRequired(dayKey: string, roleKey: string, value: number): void {
    const role = roleKey as 'waiter' | 'kitchen';
    const n = Math.max(0, Math.min(99, Math.floor(Number(value)) || 0));
    (this.openingHours[dayKey] as any)[role] = n;
    this.serializeOpeningHours();
  }

  onLogoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
        this.error.set(
          this.translate.instant('COMMON.IMAGE_FILE_TOO_LARGE', { maxMb: MAX_IMAGE_UPLOAD_MB }),
        );
        return;
      }
      this.logoFile = file;
      const reader = new FileReader();
      reader.onload = (e) => {
        this.logoPreview.set(e.target?.result as string);
      };
      reader.readAsDataURL(file);
      this.error.set(null);
    }
  }

  removeLogo() {
    this.logoFile = null;
    this.logoPreview.set(null);
    this.api.deleteTenantLogo().subscribe({
      next: (updated) => {
        this.settings.set(updated);
      },
      error: () => {},
    });
  }

  paymentQrUrl(): string | null {
    const s = this.settings();
    return this.api.getTenantPaymentQrUrl(s?.payment_qr_filename, s?.id);
  }

  /** Uploads right away (keeps QR pixels intact server-side). */
  onPaymentQrSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      this.error.set(this.translate.instant('COMMON.IMAGE_FILE_TOO_LARGE', { maxMb: MAX_IMAGE_UPLOAD_MB }));
      return;
    }
    this.api.uploadTenantPaymentQr(file).subscribe({
      next: (res) => this.settings.update((cur) => (cur ? { ...cur, payment_qr_filename: res.payment_qr_filename } : cur)),
      error: (err) => this.error.set(err?.error?.detail || this.translate.instant('COMMON.API_REQUEST_FAILED')),
    });
  }

  addBankAccount() {
    const list = this.formData.payment_bank_accounts ?? [];
    this.formData.payment_bank_accounts = [
      ...list,
      { bank: '', account_type: '', account_number: '', holder: '' },
    ];
  }

  removeBankAccount(index: number) {
    this.formData.payment_bank_accounts = (this.formData.payment_bank_accounts ?? []).filter(
      (_, i) => i !== index,
    );
  }

  removePaymentQr() {
    this.api.deleteTenantPaymentQr().subscribe({
      next: () => this.settings.update((cur) => (cur ? { ...cur, payment_qr_filename: null } : cur)),
      error: (err) => this.error.set(err?.error?.detail || this.translate.instant('COMMON.API_REQUEST_FAILED')),
    });
  }

  onHeaderBackgroundSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) {
      this.error.set('Please select a JPG, PNG, WebP or AVIF image.');
      return;
    }
    this.headerBackgroundFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      this.headerBackgroundPreview.set(e.target?.result as string);
    };
    reader.readAsDataURL(file);
    this.error.set(null);
  }

  removeHeaderBackground() {
    this.headerBackgroundFile = null;
    this.headerBackgroundPreview.set(null);
    this.api.deleteTenantHeaderBackground().subscribe({
      next: (updated) => {
        this.settings.set(updated);
      },
      error: () => {},
    });
  }

  getHeaderBackgroundUrl(): string | null {
    const s = this.settings();
    if (!s?.header_background_filename || !s.id) return null;
    return this.api.getTenantHeaderBackgroundUrl(s.header_background_filename, s.id);
  }

  getHeaderBackgroundDisplaySrc(): SafeResourceUrl | null {
    const preview = this.headerBackgroundPreview();
    if (preview) return preview;
    const url = this.getHeaderBackgroundUrl();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  }

  getLogoUrl(): string | null {
    const settings = this.settings();
    if (!settings?.logo_filename || !settings.id) return null;
    return this.api.getTenantLogoUrl(settings.logo_filename, settings.id);
  }

  /** Safe URL for logo img (avoids Angular stripping API URL). Use for server logo; data URL from preview is used as-is. */
  getDisplayLogoSrc(): string | SafeResourceUrl | null {
    const preview = this.logoPreview();
    if (preview) return preview;
    const url = this.getLogoUrl();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    } else {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
  }

  ngOnDestroy(): void {
    this.clearSuccessDismissTimer();
  }

  private clearSuccessDismissTimer(): void {
    if (this.successDismissTimer !== undefined) {
      clearTimeout(this.successDismissTimer);
      this.successDismissTimer = undefined;
    }
  }

  private scheduleSuccessDismiss(): void {
    this.clearSuccessDismissTimer();
    this.successDismissTimer = setTimeout(() => {
      this.successDismissTimer = undefined;
      this.success.set(null);
    }, SettingsComponent.SETTINGS_SUCCESS_TOAST_MS);
  }

  dismissSuccessToast(): void {
    this.clearSuccessDismissTimer();
    this.success.set(null);
  }

  saveSettings() {
    this.saving.set(true);
    this.error.set(null);
    this.clearSuccessDismissTimer();
    this.success.set(null);

    const doLogoUpload = () => {
      if (this.logoFile) {
        this.api.uploadTenantLogo(this.logoFile).subscribe({
          next: (updatedSettings) => {
            this.settings.set(updatedSettings);
            this.logoFile = null;
            this.logoPreview.set(null);
            this.updateSettings();
          },
          error: (err) => {
            this.error.set(this.translate.instant('SETTINGS.UPLOAD_FAILED'));
            this.saving.set(false);
            console.error('Error uploading logo:', err);
          }
        });
      } else {
        this.updateSettings();
      }
    };

    if (this.headerBackgroundFile) {
      this.api.uploadTenantHeaderBackground(this.headerBackgroundFile).subscribe({
        next: (updatedSettings) => {
          this.settings.set(updatedSettings);
          this.headerBackgroundFile = null;
          this.headerBackgroundPreview.set(null);
          doLogoUpload();
        },
        error: (err) => {
          this.error.set(this.translate.instant('SETTINGS.UPLOAD_FAILED'));
          this.saving.set(false);
          console.error('Error uploading header background:', err);
        }
      });
    } else {
      doLogoUpload();
    }
  }

  private updateSettings() {
    // Ensure opening hours are serialized before saving
    this.serializeOpeningHours();

    // Prepare update data - only include secrets that were actually changed
    const updateData = { ...this.formData };
    delete (updateData as Record<string, unknown>)['clock_qr_active'];

    // Single "Enlace de Google Maps" field is used for both directions and reviews.
    updateData.public_google_review_url = updateData.public_google_maps_url;

    // Always send reminder options so they are persisted (default false if unset)
    updateData.reservation_reminder_24h_enabled = this.formData.reservation_reminder_24h_enabled ?? false;
    updateData.reservation_reminder_2h_enabled = this.formData.reservation_reminder_2h_enabled ?? false;
    updateData.guest_birthday_capture_enabled = this.formData.guest_birthday_capture_enabled ?? true;
    updateData.guest_birthday_marketing_enabled = this.formData.guest_birthday_marketing_enabled ?? false;
    updateData.guest_birthday_consent_text = (this.formData.guest_birthday_consent_text || '').trim() || null;

    const seen = new Set<number>();
    const tipPresets: number[] = [];
    for (const x of this.tipPresetEdit) {
      const v = Math.min(100, Math.max(0, Math.floor(Number(x) || 0)));
      if (v > 0 && !seen.has(v)) {
        seen.add(v);
        tipPresets.push(v);
      }
      if (tipPresets.length >= 4) {
        break;
      }
    }
    updateData.tip_preset_percents = tipPresets;
    updateData.tip_tax_rate_percent = Math.min(
      100,
      Math.max(0, Math.floor(Number(this.formData.tip_tax_rate_percent) || 0))
    );
    updateData.tip_entry_mode =
      this.formData.tip_entry_mode === 'overpayment' ? 'overpayment' : 'preset';

    updateData.ui_modules = {
      ...DEFAULT_TENANT_UI_MODULES,
      ...(this.formData.ui_modules || {}),
    };

    if (updateData.smtp_password === '') {
      delete updateData.smtp_password;
    }

    this.api.updateTenantSettings(updateData).subscribe({
      next: (updatedSettings) => {
        this.settings.set(updatedSettings);
        this.formData.default_tax_id = updatedSettings.default_tax_id ?? null;
        this.formData.latitude = updatedSettings.latitude ?? null;
        this.formData.longitude = updatedSettings.longitude ?? null;
        this.formData.location_radius_meters = updatedSettings.location_radius_meters ?? 100;
        this.formData.location_check_enabled = updatedSettings.location_check_enabled ?? false;
        this.api.applyTenantUiModulesFromSettings(updatedSettings);
        this.success.set(this.translate.instant('SETTINGS.SAVED_OK'));
        this.dirty.set(false);
        this.scheduleSuccessDismiss();
        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(this.translate.instant('SETTINGS.SAVE_FAILED'));
        this.saving.set(false);
        console.error('Error updating settings:', err);
      }
    });
  }

  /** Persist default tax (IVA) from the Taxes section without a full settings save. */
  saveDefaultTax(): void {
    this.saving.set(true);
    this.error.set(null);
    this.clearSuccessDismissTimer();
    this.success.set(null);
    this.api.updateTenantSettings({ default_tax_id: this.formData.default_tax_id ?? null }).subscribe({
      next: (updatedSettings) => {
        this.settings.set(updatedSettings);
        this.formData.default_tax_id = updatedSettings.default_tax_id ?? null;
        this.success.set(this.translate.instant('SETTINGS.SAVE_CHANGES'));
        this.scheduleSuccessDismiss();
        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(this.translate.instant('SETTINGS.SAVE_FAILED'));
        this.saving.set(false);
        console.error('Error updating default tax:', err);
      },
    });
  }

  cancel() {
    this.router.navigate(['/dashboard']);
  }

  useCurrentLocation() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.formData.latitude = position.coords.latitude;
          this.formData.longitude = position.coords.longitude;
        },
        (error) => {
          console.error('Error getting location:', error);
          this.error.set('Could not get your location. Please enter coordinates manually.');
        },
        { timeout: 10000, maximumAge: 60000 }
      );
    } else {
      this.error.set('Geolocation is not supported by your browser.');
    }
  }

  /** Load plain token after page load when server has an encrypted backup (persistent download). */
  private loadPersistedClockQrToken(): void {
    this.clockQrTokenLoading.set(true);
    this.api.getTenantClockQrToken().subscribe({
      next: (r) => {
        this.clockQrLastToken.set(r.token);
        this.settings.update((s) =>
          s
            ? {
                ...s,
                clock_qr_active: r.clock_qr_active,
                clock_qr_downloadable: r.clock_qr_downloadable ?? true,
              }
            : s,
        );
        this.clockQrTokenLoading.set(false);
      },
      error: () => {
        this.clockQrLastToken.set(null);
        this.clockQrTokenLoading.set(false);
      },
    });
  }

  regenerateClockQr(): void {
    this.clockQrBusy.set(true);
    this.error.set(null);
    this.api.regenerateTenantClockQr().subscribe({
      next: (r) => {
        this.formData.clock_qr_active = r.clock_qr_active;
        this.clockQrLastToken.set(r.token);
        this.settings.update((s) =>
          s
            ? {
                ...s,
                clock_qr_active: r.clock_qr_active,
                clock_qr_downloadable: r.clock_qr_downloadable ?? true,
              }
            : s,
        );
        this.success.set(this.translate.instant('SETTINGS.CLOCK_QR_SAVED'));
        this.scheduleSuccessDismiss();
        this.clockQrBusy.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.detail || 'Could not generate clock QR token.');
        this.clockQrBusy.set(false);
      },
    });
  }

  disableClockQr(): void {
    this.clockQrBusy.set(true);
    this.error.set(null);
    this.api.disableTenantClockQr().subscribe({
      next: (r) => {
        this.formData.clock_qr_active = r.clock_qr_active;
        this.clockQrLastToken.set(null);
        this.settings.update((s) =>
          s
            ? {
                ...s,
                clock_qr_active: r.clock_qr_active,
                clock_qr_downloadable: r.clock_qr_downloadable ?? false,
              }
            : s,
        );
        this.success.set(this.translate.instant('SETTINGS.CLOCK_QR_DISABLED'));
        this.scheduleSuccessDismiss();
        this.clockQrBusy.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.detail || 'Could not disable clock QR.');
        this.clockQrBusy.set(false);
      },
    });
  }

  saveClockQrLocationVerify(): void {
    this.api
      .updateTenantSettings({ clock_qr_location_verify: !!this.formData.clock_qr_location_verify })
      .subscribe({
        next: (updated) => {
          this.settings.set(updated);
          this.success.set(this.translate.instant('SETTINGS.SAVE_CHANGES'));
          this.scheduleSuccessDismiss();
        },
        error: () => this.error.set('Could not save clock location option.'),
      });
  }

  copyClockQrToken(): void {
    const t = this.clockQrLastToken();
    if (!t || !navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(t).catch(() => {});
  }

  /** Full app URL encoded in the printable QR (same pattern as SETTINGS.CLOCK_QR_URL_HINT). */
  private clockInQrPrintPayloadUrl(): string | null {
    const token = this.clockQrLastToken();
    if (!token || typeof window === 'undefined') return null;
    const origin = window.location.origin.replace(/\/$/, '');
    return `${origin}/my-shift?clock_qr=${encodeURIComponent(token)}`;
  }

  async downloadClockQrForPrinting(): Promise<void> {
    const payload = this.clockInQrPrintPayloadUrl();
    if (!payload || !this.settings()?.clock_qr_active) return;
    this.clockQrDownloadBusy.set(true);
    this.error.set(null);
    try {
      const QR = await import('qrcode');
      const dataUrl = await QR.toDataURL(payload, {
        width: 1200,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      });
      const blob = await (await fetch(dataUrl)).blob();
      const tid = this.settings()?.id;
      const suffix = tid != null && tid > 0 ? String(tid) : 'tenant';
      const a = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = `staff-clock-in-qr-${suffix}.png`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      this.error.set(this.translate.instant('SETTINGS.CLOCK_QR_DOWNLOAD_FAILED'));
    } finally {
      this.clockQrDownloadBusy.set(false);
    }
  }
}
