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
import { OpeningShiftComponent } from './opening-shift.component';
import { TimePickerComponent } from './time-picker.component';
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
  | 'invoicing'
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
  invoicing: 'invoicing',
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
    OpeningShiftComponent,
    TimePickerComponent,
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
                  
                  <div class="st-card br-card" data-testid="settings-brand-card">
                    <h3 class="st-card-title">{{ 'SETTINGS.CARD_BRAND_IMAGES' | translate }}</h3>
                    <p class="br-sub">{{ 'SETTINGS.BR_SUB' | translate }}</p>

                    <input type="file" id="logo-upload" accept="image/jpeg,image/png,image/webp,image/avif,image/svg+xml,.svg" (change)="onLogoSelected($event)" hidden />
                    <input type="file" id="header-bg-upload" accept="image/jpeg,image/png,image/webp,image/avif" (change)="onHeaderBackgroundSelected($event)" hidden />

                    <div class="br-frame" aria-label="{{ 'SETTINGS.BR_PREVIEW' | translate }}">
                      <div class="br-frame-bar" aria-hidden="true">
                        <span class="br-dots"><i></i><i></i><i></i></span>
                        <span class="br-url">{{ publicUrl().replace('https://', '').replace('http://', '') || ('SETTINGS.BR_PREVIEW' | translate) }}</span>
                      </div>
                      <label
                        for="header-bg-upload"
                        class="br-hero"
                        [class.drag]="brandDrag() === 'header'"
                        (dragover)="onBrandDrag($event, 'header')"
                        (dragleave)="brandDrag.set(null)"
                        (drop)="onBrandDrop($event, 'header')"
                      >
                        @if (headerBackgroundPreview() || settings()?.header_background_filename) {
                          <img class="br-hero-img" [src]="getHeaderBackgroundDisplaySrc()" alt="" />
                        } @else {
                          <span class="br-hero-fallback">
                            @if (logoPreview() || settings()?.logo_filename) {
                              <span class="br-hero-logo"><img [src]="getDisplayLogoSrc()" alt="" /></span>
                            }
                            <span class="br-hero-name">{{ formData.name }}</span>
                          </span>
                        }
                        <span class="br-over"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>{{ 'SETTINGS.BR_CHANGE_IMAGE' | translate }}</span>
                      </label>
                      <p class="br-frame-note">
                        {{ ((headerBackgroundPreview() || settings()?.header_background_filename) ? 'SETTINGS.BR_NOTE_IMAGE' : 'SETTINGS.BR_NOTE_FALLBACK') | translate }}
                      </p>
                    </div>

                    <div class="br-assets">
                      <div class="br-asset" [class.drag]="brandDrag() === 'logo'" (dragover)="onBrandDrag($event, 'logo')" (dragleave)="brandDrag.set(null)" (drop)="onBrandDrop($event, 'logo')">
                        <label for="logo-upload" class="br-thumb br-thumb-logo" [attr.aria-label]="'SETTINGS.UPLOAD_LOGO' | translate">
                          @if (logoPreview() || settings()?.logo_filename) {
                            <img [src]="getDisplayLogoSrc()" alt="Logo" />
                          } @else {
                            <b>{{ (formData.name || '?').charAt(0).toUpperCase() }}</b>
                          }
                        </label>
                        <div class="br-asset-body">
                          <div class="br-asset-top">
                            <b>{{ 'SETTINGS.LOGO' | translate }}</b>
                            <span class="br-state" [class.pending]="logoFile" [class.empty]="!logoFile && !settings()?.logo_filename">
                              {{ (logoFile ? 'SETTINGS.BR_STATE_PENDING' : (settings()?.logo_filename ? 'SETTINGS.BR_STATE_SAVED' : 'SETTINGS.BR_STATE_EMPTY')) | translate }}
                            </span>
                          </div>
                          @if (logoMeta(); as m) {
                            <small class="br-spec"><b>{{ m.name }}</b> · {{ m.w }} × {{ m.h }} px · {{ m.size }}</small>
                          } @else {
                            <small class="br-spec">{{ 'SETTINGS.BR_LOGO_REC' | translate }}</small>
                          }
                          <small class="br-formats">{{ 'SETTINGS.BR_LOGO_FORMATS' | translate }}</small>
                          <div class="br-asset-btns">
                            <label for="logo-upload" class="br-btn">{{ ((logoPreview() || settings()?.logo_filename) ? 'SETTINGS.BR_CHANGE_LOGO' : 'SETTINGS.UPLOAD_LOGO') | translate }}</label>
                            @if (logoPreview() || settings()?.logo_filename) {
                              <button type="button" class="br-btn br-btn-quiet" (click)="removeLogo()">{{ 'SETTINGS.REMOVE_LOGO' | translate }}</button>
                            }
                          </div>
                        </div>
                      </div>

                      <div class="br-asset" [class.drag]="brandDrag() === 'header'" (dragover)="onBrandDrag($event, 'header')" (dragleave)="brandDrag.set(null)" (drop)="onBrandDrop($event, 'header')">
                        <label for="header-bg-upload" class="br-thumb br-thumb-bg" [attr.aria-label]="'SETTINGS.UPLOAD_HEADER_BACKGROUND' | translate">
                          @if (headerBackgroundPreview() || settings()?.header_background_filename) {
                            <img [src]="getHeaderBackgroundDisplaySrc()" alt="" />
                          } @else {
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg>
                          }
                        </label>
                        <div class="br-asset-body">
                          <div class="br-asset-top">
                            <b>{{ 'SETTINGS.HEADER_BACKGROUND' | translate }}</b>
                            <span class="br-state" [class.pending]="headerBackgroundFile" [class.empty]="!headerBackgroundFile && !settings()?.header_background_filename">
                              {{ (headerBackgroundFile ? 'SETTINGS.BR_STATE_PENDING' : (settings()?.header_background_filename ? 'SETTINGS.BR_STATE_SAVED' : 'SETTINGS.BR_STATE_EMPTY')) | translate }}
                            </span>
                          </div>
                          @if (headerMeta(); as m) {
                            <small class="br-spec"><b>{{ m.name }}</b> · {{ m.w }} × {{ m.h }} px · {{ m.size }}</small>
                          } @else {
                            <small class="br-spec">{{ 'SETTINGS.BR_BG_REC' | translate }}</small>
                          }
                          <small class="br-formats">{{ 'SETTINGS.BR_BG_FORMATS' | translate }}</small>
                          <div class="br-asset-btns">
                            <label for="header-bg-upload" class="br-btn">{{ ((headerBackgroundPreview() || settings()?.header_background_filename) ? 'SETTINGS.BR_CHANGE_IMAGE' : 'SETTINGS.UPLOAD_HEADER_BACKGROUND') | translate }}</label>
                            @if (headerBackgroundPreview() || settings()?.header_background_filename) {
                              <button type="button" class="br-btn br-btn-quiet" (click)="removeHeaderBackground()">{{ 'SETTINGS.REMOVE_LOGO' | translate }}</button>
                            }
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="st-card">
                  <h3 class="st-card-title">{{ 'SETTINGS.CARD_BUSINESS_DATA' | translate }}</h3>
                  <!-- Basic Info -->
                  <div class="form-group">
                    <label>{{ 'SETTINGS.BUSINESS_NAME' | translate }}</label>
                    <div class="st-fixed" data-testid="settings-business-name-fixed">
                      <span class="st-fixed-ico" aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                      </span>
                      <span class="st-fixed-name">{{ formData.name }}</span>
                      <span class="st-fixed-chip">{{ 'SETTINGS.NAME_FIXED' | translate }}</span>
                    </div>
                    <small class="field-hint">{{ 'SETTINGS.NAME_FIXED_HINT' | translate }}</small>
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
                      <label>{{ 'SETTINGS.CITY' | translate }}</label>
                      <div class="st-fixed st-fixed-sm" data-testid="settings-city-fixed">
                        <span class="st-fixed-ico" aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                        </span>
                        <span class="st-fixed-name">{{ formData.city }}</span>
                        <span class="st-fixed-chip">{{ 'SETTINGS.CITY_FIXED' | translate }}</span>
                      </div>
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
                  <div class="oh-hero" data-testid="settings-hours-hero">
                    <div class="oh-hero-main">
                      <p class="oh-hero-summary">{{ getOpeningHoursSummary() }}</p>
                      <p class="oh-hero-stats">
                        <b>{{ openDaysCount() }}</b> {{ 'SETTINGS.OH_OPEN_DAYS' | translate }}
                        <span aria-hidden="true">·</span>
                        <b>{{ weeklyHours() }}</b> {{ 'SETTINGS.OH_HOURS_WEEK' | translate }}
                      </p>
                    </div>
                    <ol class="oh-week" aria-hidden="true">
                      @for (day of daysOfWeek; track day.key) {
                        <li [class.off]="openingHours[day.key]?.closed" [class.today]="day.key === todayKey">{{ dayShort(day.key) }}</li>
                      }
                    </ol>
                  </div>

                  <div class="oh-copy" data-testid="oh-copy">
                    <div class="oh-copy-row">
                      <span class="oh-copy-label" id="oh-copy-from-label">{{ 'SETTINGS.COPY_FROM_DAY' | translate }}</span>
                      <div class="oh-daychips" role="radiogroup" aria-labelledby="oh-copy-from-label">
                        @for (day of daysOfWeek; track day.key) {
                        <button type="button" role="radio" class="oh-daychip" [class.on]="copyFromDayKey === day.key" [attr.aria-checked]="copyFromDayKey === day.key" [attr.aria-label]="day.label | translate" [attr.data-testid]="'oh-copy-from-' + day.key" (click)="copyFromDayKey = day.key">{{ dayShort(day.key) }}</button>
                      }
                      </div>
                    </div>
                    <div class="oh-copy-row">
                      <span class="oh-copy-label">{{ 'SETTINGS.OH_COPY_TO' | translate }}</span>
                      <div class="oh-copy-actions" role="group" [attr.aria-label]="'SETTINGS.COPY_TO_OTHER_DAYS' | translate">
                      <button type="button" class="oh-copy-btn" data-testid="oh-copy-weekdays" (click)="copyDayToOtherDays(copyFromDayKey, 'weekdays')">{{ 'SETTINGS.OH_COPY_WEEKDAYS' | translate }}</button>
                      <button type="button" class="oh-copy-btn" data-testid="oh-copy-weekend" (click)="copyDayToOtherDays(copyFromDayKey, 'weekend')">{{ 'SETTINGS.OH_COPY_WEEKEND' | translate }}</button>
                      <button type="button" class="oh-copy-btn" data-testid="oh-copy-all" (click)="copyDayToOtherDays(copyFromDayKey, 'all')">{{ 'SETTINGS.OH_COPY_ALL' | translate }}</button>
                    </div>
                    </div>
                  </div>

                  <div class="oh-days">
                    @for (day of daysOfWeek; track day.key) {
                      <div class="oh-day" [class.closed]="openingHours[day.key]?.closed" [class.today]="day.key === todayKey" [class.invalid]="!!dayError(day.key)">
                        <div class="oh-day-head">
                          <label class="switch">
                            <input
                              type="checkbox"
                              [checked]="!openingHours[day.key]?.closed"
                              (change)="toggleDayClosed(day.key, $event)"
                              [attr.aria-label]="day.label | translate"
                            />
                            <span class="slider round"></span>
                          </label>
                          <span class="oh-day-name">{{ day.label | translate }}</span>
                          @if (day.key === todayKey) { <span class="oh-today">{{ 'SETTINGS.OH_TODAY' | translate }}</span> }
                          @if (openingHours[day.key]?.closed) { <span class="closed-badge">{{ 'SETTINGS.CLOSED' | translate }}</span> }
                        </div>

                        @if (!openingHours[day.key]?.closed) {
                          <div class="oh-day-body">
                            <div class="oh-bar" aria-hidden="true">
                              @for (seg of dayBarSegments(day.key); track $index) {
                                <i class="oh-seg" [class.second]="$index === 1" [style.left.%]="seg.left" [style.width.%]="seg.width"></i>
                              }
                            </div>

                            @if (!openingHours[day.key]?.hasBreak) {
                              <app-opening-shift
                                [open]="openingHours[day.key]?.open || '10:30'"
                                [close]="openingHours[day.key]?.close || '21:15'"
                                [label]="openingHours[day.key]?.serviceLabel || ''"
                                placeholder="SETTINGS.SERVICE_LABEL_PLACEHOLDER"
                                labelAria="SETTINGS.SERVICE_LABEL"
                                (openChange)="setOpeningHourValue(day.key, 'open', $event)"
                                (closeChange)="setOpeningHourValue(day.key, 'close', $event)"
                                (labelChange)="setServiceLabelValue(day.key, 'serviceLabel', $event)"
                              />
                            } @else {
                              <app-opening-shift
                                variant="morning"
                                [open]="openingHours[day.key]?.morningOpen"
                                [close]="openingHours[day.key]?.morningClose"
                                [label]="openingHours[day.key]?.morningLabel || ''"
                                placeholder="SETTINGS.MORNING_LABEL_PLACEHOLDER"
                                labelAria="SETTINGS.MORNING_LABEL"
                                (openChange)="setOpeningHourValue(day.key, 'morningOpen', $event)"
                                (closeChange)="setOpeningHourValue(day.key, 'morningClose', $event)"
                                (labelChange)="setServiceLabelValue(day.key, 'morningLabel', $event)"
                              />
                              <app-opening-shift
                                variant="evening"
                                [open]="openingHours[day.key]?.eveningOpen"
                                [close]="openingHours[day.key]?.eveningClose"
                                [label]="openingHours[day.key]?.eveningLabel || ''"
                                placeholder="SETTINGS.EVENING_LABEL_PLACEHOLDER"
                                labelAria="SETTINGS.EVENING_LABEL"
                                (openChange)="setOpeningHourValue(day.key, 'eveningOpen', $event)"
                                (closeChange)="setOpeningHourValue(day.key, 'eveningClose', $event)"
                                (labelChange)="setServiceLabelValue(day.key, 'eveningLabel', $event)"
                              />
                            }

                            @if (dayError(day.key); as err) {
                              <p class="oh-error" role="alert">{{ err | translate }}</p>
                            }

                            <div class="oh-extras">
                              <label class="oh-chip" [class.on]="openingHours[day.key]?.hasBreak">
                                <input type="checkbox" [checked]="openingHours[day.key]?.hasBreak" (change)="toggleBreak(day.key, $event)">
                                {{ 'SETTINGS.HAS_BREAK' | translate }}
                              </label>
                              <details class="oh-staff">
                                <summary>
                                  {{ 'SETTINGS.PERSONNEL_PER_SHIFT' | translate }}
                                  <span class="oh-staff-sum">{{ getStaffRequired(day.key, 'waiter') }} · {{ getStaffRequired(day.key, 'kitchen') }}</span>
                                </summary>
                                <div class="oh-staff-inputs">
                                  @for (role of staffRoleKeys; track role.key) {
                                    <div class="oh-staff-field">
                                      <label [for]="'staff-' + day.key + '-' + role.key">{{ role.labelKey | translate }}</label>
                                      <input type="number" [id]="'staff-' + day.key + '-' + role.key"
                                        [value]="getStaffRequired(day.key, role.key)"
                                        (input)="setStaffRequired(day.key, role.key, $any($event.target).value)"
                                        min="0" max="99" class="oh-num" />
                                    </div>
                                  }
                                </div>
                              </details>
                            </div>
                          </div>
                        }
                      </div>
                    }
                  </div>

                  <div class="divider"></div>
                  <div class="section-header">
                    <h3>{{ 'SETTINGS.OPENING_HOURS_PLANNED_TITLE' | translate }}</h3>
                    <p>{{ 'SETTINGS.OPENING_HOURS_PLANNED_HELP' | translate }}</p>
                  </div>

                  <div class="oh-schedule-card" data-testid="oh-baseline-card">
                    <h4>{{ 'SETTINGS.OPENING_HOURS_BASELINE_SECTION' | translate }}</h4>
                    <p class="oh-help">{{ 'SETTINGS.OPENING_HOURS_BASELINE_HINT' | translate }}</p>
                    <div class="oh-form oh-form-3">
                      <div class="oh-fgroup">
                        <label for="baseline_eff">{{ 'SETTINGS.OPENING_HOURS_EFFECTIVE_FROM' | translate }}</label>
                        <app-date-picker id="baseline_eff" [clearable]="false" [placeholder]="'SETTINGS.OH_PICK_DATE' | translate" [(ngModel)]="baselineScheduleEffectiveDate" name="baseline_eff" />
                      </div>
                      <div class="oh-fgroup">
                        <label for="baseline_note">{{ 'SETTINGS.OPENING_HOURS_BASELINE_NOTE' | translate }}</label>
                        <input id="baseline_note" class="oh-field" type="text" [(ngModel)]="baselineScheduleNote" name="baseline_note" [placeholder]="'SETTINGS.OH_NOTE_BASELINE_PH' | translate" />
                      </div>
                      <button type="button" class="btn btn-primary oh-add" (click)="addBaselineSchedule()" [disabled]="saving()">
                        {{ 'SETTINGS.OPENING_HOURS_ADD_BASELINE' | translate }}
                      </button>
                    </div>
                    @if (loadingOpeningHoursSchedule()) {
                      <p class="oh-help">{{ 'COMMON.LOADING' | translate }}</p>
                    } @else if (openingHoursScheduleBaselines().length === 0) {
                      <p class="oh-empty">{{ 'SETTINGS.OPENING_HOURS_NO_BASELINES' | translate }}</p>
                    } @else {
                      <p class="oh-warn" role="note">{{ 'SETTINGS.OH_BASELINE_WARN' | translate }}</p>
                      <ul class="oh-plan">
                        @for (b of openingHoursScheduleBaselines(); track b.id) {
                          <li class="oh-plan-item" [class.active]="b.id === activeBaselineId()">
                            <div class="oh-tile" aria-hidden="true"><b>{{ dayNum(b.effective_from) }}</b><small>{{ monthShort(b.effective_from) }}</small></div>
                            <div class="oh-plan-main">
                              <span class="oh-plan-date">{{ 'SETTINGS.OH_FROM_DATE' | translate }} {{ fmtDate(b.effective_from) }}</span>
                              @if (b.id === activeBaselineId()) { <span class="oh-plan-tag">{{ 'SETTINGS.OH_IN_FORCE' | translate }}</span> }
                              <span class="oh-plan-note">{{ b.note || '' }}</span>
                            </div>
                            <div class="oh-plan-actions">
                              @if (pendingDelete() === 'b:' + b.id) {
                              <span class="oh-ask">{{ 'SETTINGS.OPENING_HOURS_CONFIRM_DELETE' | translate }}</span>
                              <button type="button" class="oh-btn oh-btn-danger" (click)="deleteBaselineSchedule(b.id)">{{ 'COMMON.DELETE' | translate }}</button>
                              <button type="button" class="oh-btn" (click)="pendingDelete.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
                            } @else {
                              <button type="button" class="oh-btn" (click)="pendingDelete.set('b:' + b.id)">{{ 'COMMON.DELETE' | translate }}</button>
                            }
                            </div>
                          </li>
                        }
                      </ul>
                    }
                  </div>

                  <div class="oh-schedule-card oh-special" data-testid="oh-override-card">
                    <div class="oh-special-head">
                      <div>
                        <h4>{{ 'SETTINGS.OPENING_HOURS_OVERRIDE_SECTION' | translate }}</h4>
                        <p class="oh-help">{{ 'SETTINGS.OPENING_HOURS_OVERRIDE_HINT' | translate }}</p>
                      </div>
                      <div class="oh-toggle" role="radiogroup" [attr.aria-label]="'SETTINGS.OPENING_HOURS_OVERRIDE_TYPE' | translate">
                        <button type="button" role="radio" [attr.aria-checked]="overrideClosedOnly" [class.on]="overrideClosedOnly" (click)="overrideClosedOnly = true">
                          {{ 'SETTINGS.OH_TYPE_CLOSED_TITLE' | translate }}
                        </button>
                        <button type="button" role="radio" [attr.aria-checked]="!overrideClosedOnly" [class.on]="!overrideClosedOnly" (click)="overrideClosedOnly = false">
                          {{ 'SETTINGS.OH_TYPE_HOURS_TITLE' | translate }}
                        </button>
                      </div>
                    </div>

                    <div class="oh-composer">
                      <div class="oh-capsule oh-cap-dates">
                        <div class="oh-cap-field">
                          <label for="ov_from">{{ 'SETTINGS.OPENING_HOURS_DATE_FROM' | translate }}</label>
                          <app-date-picker id="ov_from" [compact]="true" [clearable]="false" [placeholder]="'SETTINGS.OH_PICK_DATE' | translate" [(ngModel)]="overrideDateFrom" name="ov_from" />
                        </div>
                        <span class="oh-cap-arrow" aria-hidden="true">→</span>
                        <div class="oh-cap-field">
                          <label for="ov_to">{{ 'SETTINGS.OPENING_HOURS_DATE_TO' | translate }}</label>
                          <app-date-picker id="ov_to" [compact]="true" [clearable]="false" [placeholder]="'SETTINGS.OH_PICK_DATE' | translate" [(ngModel)]="overrideDateTo" name="ov_to" />
                        </div>
                      </div>
                      @if (!overrideClosedOnly) {
                        <div class="oh-capsule oh-cap-hours" data-testid="oh-special-hours">
                          <label>{{ 'SETTINGS.OH_SPECIAL_HOURS' | translate }}</label>
                          <div class="oh-range">
                            <app-time-picker [value]="overrideOpen" ariaLabel="SETTINGS.OH_OPENS" (valueChange)="overrideOpen = $event" />
                            <span class="oh-dash" aria-hidden="true">→</span>
                            <app-time-picker [value]="overrideClose" ariaLabel="SETTINGS.OH_CLOSES" (valueChange)="overrideClose = $event" />
                          </div>
                        </div>
                      }
                      <div class="oh-capsule oh-cap-note">
                        <label for="ov_note">{{ 'SETTINGS.OPENING_HOURS_BASELINE_NOTE' | translate }}</label>
                        <input id="ov_note" class="oh-cap-input" type="text" [(ngModel)]="overrideScheduleNote" name="ov_note" [placeholder]="'SETTINGS.OH_NOTE_OVERRIDE_PH' | translate" />
                      </div>
                      <button type="button" class="btn btn-primary oh-add" (click)="addOverrideSchedule()" [disabled]="saving()">
                        {{ 'SETTINGS.OPENING_HOURS_ADD_OVERRIDE' | translate }}
                      </button>
                    </div>

                    @if (specialPreview(); as pv) {
                      <p class="oh-preview" [class.bad]="pv.bad" role="status">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                        <span>{{ pv.text }}</span>
                      </p>
                    } @else {
                      <p class="oh-preview empty">{{ 'SETTINGS.OH_PREVIEW_EMPTY' | translate }}</p>
                    }

                    @if (loadingOpeningHoursSchedule()) {
                      <p class="oh-help">{{ 'COMMON.LOADING' | translate }}</p>
                    } @else if (openingHoursScheduleOverrides().length === 0) {
                      <p class="oh-empty">{{ 'SETTINGS.OPENING_HOURS_NO_OVERRIDES' | translate }}</p>
                    } @else {
                      <ul class="oh-plan">
                        @for (o of openingHoursScheduleOverrides(); track o.id) {
                          <li class="oh-plan-item">
                            <div class="oh-tile" aria-hidden="true"><b>{{ dayNum(o.date_from) }}</b><small>{{ monthShort(o.date_from) }}</small></div>
                            <div class="oh-plan-main">
                              <span class="oh-plan-date">{{ fmtDate(o.date_from) }}{{ o.date_to !== o.date_from ? ' → ' + fmtDate(o.date_to) : '' }}</span>
                              <span class="oh-plan-tag" [class.closed]="o.closed">{{ o.closed ? ('SETTINGS.OPENING_HOURS_TYPE_CLOSED' | translate) : overrideHoursLabel(o.opening_hours) }}</span>
                              <span class="oh-plan-note">{{ o.note || '' }}</span>
                            </div>
                            <div class="oh-plan-actions">
                              @if (pendingDelete() === 'o:' + o.id) {
                                <span class="oh-ask">{{ 'SETTINGS.OPENING_HOURS_CONFIRM_DELETE' | translate }}</span>
                                <button type="button" class="oh-btn oh-btn-danger" (click)="deleteOverrideSchedule(o.id)">{{ 'COMMON.DELETE' | translate }}</button>
                                <button type="button" class="oh-btn" (click)="pendingDelete.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
                              } @else {
                                <button type="button" class="oh-btn" (click)="pendingDelete.set('o:' + o.id)">{{ 'COMMON.DELETE' | translate }}</button>
                              }
                            </div>
                          </li>
                        }
                      </ul>
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
                  <div class="tr-grid">
                    <div class="tr-tile tr-nequi" [class.on]="!!(formData.payment_nequi_number || '').trim()">
                      <div class="tr-head">
                        <span class="tr-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5"/><line x1="11" y1="18" x2="13" y2="18"/></svg></span>
                        <label for="payment_nequi_number">{{ 'SETTINGS.PAYMENT_NEQUI_NUMBER' | translate }}</label>
                        <span class="tr-state">{{ ((formData.payment_nequi_number || '').trim() ? 'SETTINGS.TR_ACTIVE' : 'SETTINGS.TR_INACTIVE') | translate }}</span>
                      </div>
                      <input type="tel" id="payment_nequi_number" class="tr-input" [(ngModel)]="formData.payment_nequi_number" name="payment_nequi_number" maxlength="40" placeholder="300 000 0000" data-testid="settings-payment-nequi" />
                    </div>
                    <div class="tr-tile tr-llave" [class.on]="!!(formData.payment_llave || '').trim()">
                      <div class="tr-head">
                        <span class="tr-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg></span>
                        <label for="payment_llave">{{ 'SETTINGS.PAYMENT_LLAVE' | translate }}</label>
                        <span class="tr-state">{{ ((formData.payment_llave || '').trim() ? 'SETTINGS.TR_ACTIVE' : 'SETTINGS.TR_INACTIVE') | translate }}</span>
                      </div>
                      <input type="text" id="payment_llave" class="tr-input" [(ngModel)]="formData.payment_llave" name="payment_llave" maxlength="120" placeholder="@llave" data-testid="settings-payment-llave" />
                      <p class="tr-hint">{{ 'SETTINGS.PAYMENT_LLAVE_HINT' | translate }}</p>
                    </div>
                    <div class="tr-tile tr-holder tr-wide" [class.on]="!!(formData.payment_account_holder || '').trim()">
                      <div class="tr-head">
                        <span class="tr-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
                        <label for="payment_account_holder">{{ 'SETTINGS.PAYMENT_ACCOUNT_HOLDER' | translate }}</label>
                      </div>
                      <input type="text" id="payment_account_holder" class="tr-input tr-input-text" [(ngModel)]="formData.payment_account_holder" name="payment_account_holder" maxlength="120" />
                      <p class="tr-hint">{{ 'SETTINGS.TR_HOLDER_HINT' | translate }}</p>
                    </div>
                  </div>

                  <div class="tr-preview" aria-live="polite">
                    <span class="tr-preview-label">{{ 'SETTINGS.TR_PREVIEW' | translate }}</span>
                    <div class="tr-preview-chips">
                      @if ((formData.payment_nequi_number || '').trim()) {
                        <span class="tr-chip tr-chip-nequi"><b>Nequi</b>{{ formData.payment_nequi_number }}</span>
                      }
                      @if ((formData.payment_llave || '').trim()) {
                        <span class="tr-chip tr-chip-llave"><b>Llave</b>{{ formData.payment_llave }}</span>
                      }
                      @if (!(formData.payment_nequi_number || '').trim() && !(formData.payment_llave || '').trim()) {
                        <span class="tr-preview-empty">{{ 'SETTINGS.TR_PREVIEW_EMPTY' | translate }}</span>
                      }
                    </div>
                    @if ((formData.payment_account_holder || '').trim()) {
                      <span class="tr-preview-holder">{{ 'SETTINGS.PAYMENT_ACCOUNT_HOLDER' | translate }}: <b>{{ formData.payment_account_holder }}</b></span>
                    }
                  </div>
                  </div>
                  <div class="st-card bk-wrap">
                  <h3 class="st-card-title">{{ 'SETTINGS.CARD_BANKS' | translate }}</h3>
                  <p class="st-card-desc">{{ 'SETTINGS.BANK_ACCOUNTS_HINT' | translate }}</p>

                  <div class="bk-list">
                    @for (acc of formData.payment_bank_accounts; track $index) {
                      <div class="bk-card" data-testid="settings-bank-account" [style.--h]="bankHue(acc.bank)">
                        <div class="bk-top">
                          <span class="bk-logo" aria-hidden="true">{{ (acc.bank || '?').trim().charAt(0).toUpperCase() || '?' }}</span>
                          <input class="bk-name" type="text" [(ngModel)]="acc.bank" [name]="'bank_' + $index" maxlength="120" list="bank-suggestions" [placeholder]="'SETTINGS.BANK_NAME' | translate" />
                          <button type="button" class="bk-del" (click)="bankToDelete.set($index)" [attr.aria-label]="'COMMON.DELETE' | translate" [title]="'COMMON.DELETE' | translate"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg></button>
                        </div>
                        <div class="bk-type" role="group" [attr.aria-label]="'SETTINGS.BANK_ACCOUNT_TYPE' | translate">
                          <button type="button" [class.on]="acc.account_type === 'Ahorros'" (click)="setBankType(acc, 'Ahorros')">{{ 'SETTINGS.BANK_TYPE_SAVINGS' | translate }}</button>
                          <button type="button" [class.on]="acc.account_type === 'Corriente'" (click)="setBankType(acc, 'Corriente')">{{ 'SETTINGS.BANK_TYPE_CHECKING' | translate }}</button>
                        </div>
                        <label class="bk-field">
                          <small>{{ 'SETTINGS.BANK_ACCOUNT_NUMBER' | translate }}</small>
                          <input class="bk-num" type="text" [(ngModel)]="acc.account_number" [name]="'bank_num_' + $index" maxlength="120" inputmode="numeric" placeholder="0000 0000 0000" />
                        </label>
                        <label class="bk-field">
                          <small>{{ 'SETTINGS.PAYMENT_ACCOUNT_HOLDER' | translate }}</small>
                          <input type="text" [(ngModel)]="acc.holder" [name]="'bank_holder_' + $index" maxlength="120" />
                        </label>
                        @if (bankToDelete() === $index) {
                          <div class="bk-confirm" role="alertdialog">
                            <span>{{ 'SETTINGS.BANK_DELETE_ASK' | translate }}</span>
                            <span class="bk-confirm-actions">
                              <button type="button" class="bk-no" (click)="bankToDelete.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
                              <button type="button" class="bk-yes" (click)="confirmRemoveBank($index)">{{ 'COMMON.DELETE' | translate }}</button>
                            </span>
                          </div>
                        }
                      </div>
                    }
                    <button type="button" class="bk-add" (click)="addBankAccount()" data-testid="settings-bank-add">
                      <span class="bk-add-ico" aria-hidden="true">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      </span>
                      <b>{{ 'SETTINGS.BANK_ADD' | translate }}</b>
                      <small>{{ 'SETTINGS.BANK_ADD_HINT' | translate }}</small>
                    </button>
                  </div>
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

                  <div class="qr-tile">
                    <div class="qr-frame" [class.empty]="!paymentQrUrl()">
                      @if (paymentQrUrl(); as qrUrl) {
                        <img [src]="qrUrl" alt="QR" class="payment-qr-preview" data-testid="settings-payment-qr-preview" />
                      } @else {
                        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1"/></svg>
                      }
                    </div>
                    <div class="qr-body">
                      <h4>{{ 'SETTINGS.PAYMENT_QR' | translate }}</h4>
                      <p>{{ 'SETTINGS.PAYMENT_QR_HINT' | translate }}</p>
                      <div class="qr-actions">
                        <input id="payment-qr-upload" type="file" hidden accept="image/png,image/jpeg,image/webp,image/avif" (change)="onPaymentQrSelected($event)" data-testid="settings-payment-qr-input" />
                        <label for="payment-qr-upload" class="qr-upload">{{ (paymentQrUrl() ? 'SETTINGS.PAYMENT_QR_CHANGE' : 'SETTINGS.PAYMENT_QR_UPLOAD') | translate }}</label>
                        @if (paymentQrUrl()) {
                          <button type="button" class="qr-remove" (click)="removePaymentQr()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>{{ 'SETTINGS.PAYMENT_QR_REMOVE' | translate }}</button>
                        }
                      </div>
                    </div>
                  </div>
                  </div>
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

              <!-- Invoicing (DIAN / Factus) Section -->
              @if (activeSection() === 'invoicing') {
                <div class="section" data-testid="settings-invoicing-section">
                  <div class="section-header">
                    <h2>{{ 'SETTINGS.INV_TITLE' | translate }}</h2>
                    <p>{{ 'SETTINGS.INV_SUBTITLE' | translate }}</p>
                  </div>

                  <div class="iv-hero" [attr.data-mode]="formData.dian_mode">
                    <div class="iv-hero-main">
                      <span class="iv-eyebrow">{{ 'SETTINGS.INV_STATE' | translate }}</span>
                      <b class="iv-state">{{ ('SETTINGS.INV_MODE_' + (formData.dian_mode || 'off').toUpperCase() + '_SHORT') | translate }}</b>
                      <span class="iv-progress">{{ 'SETTINGS.INV_READY_COUNT' | translate: { done: dianChecklist().done, total: dianChecklist().items.length } }}</span>
                    </div>
                    <ul class="iv-check">
                      @for (it of dianChecklist().items; track it.key) {
                        <li [class.ok]="it.ok">
                          <i aria-hidden="true">{{ it.ok ? '✓' : '·' }}</i>
                          <span>{{ it.labelKey | translate }}</span>
                        </li>
                      }
                    </ul>
                  </div>

                  <div class="st-card">
                    <h3 class="st-card-title">{{ 'SETTINGS.INV_ENV_TITLE' | translate }}</h3>
                    <p class="st-card-desc">{{ 'SETTINGS.INV_ENV_DESC' | translate }}</p>
                    <div class="iv-modes" role="radiogroup" [attr.aria-label]="'SETTINGS.INV_ENV_TITLE' | translate">
                      <button type="button" role="radio" class="iv-mode" [class.on]="formData.dian_mode === 'off'" [attr.aria-checked]="formData.dian_mode === 'off'" (click)="setDianMode('off')">
                        <b>{{ 'SETTINGS.INV_MODE_OFF' | translate }}</b>
                        <small>{{ 'SETTINGS.INV_MODE_OFF_DESC' | translate }}</small>
                      </button>
                      <button type="button" role="radio" class="iv-mode iv-mode-test" [class.on]="formData.dian_mode === 'test'" [attr.aria-checked]="formData.dian_mode === 'test'" (click)="setDianMode('test')">
                        <b>{{ 'SETTINGS.INV_MODE_TEST' | translate }}</b>
                        <small>{{ 'SETTINGS.INV_MODE_TEST_DESC' | translate }}</small>
                      </button>
                      <button type="button" role="radio" class="iv-mode iv-mode-live" [class.on]="formData.dian_mode === 'live'" [class.locked]="!dianLiveAllowed()" [attr.aria-checked]="formData.dian_mode === 'live'" [attr.aria-disabled]="!dianLiveAllowed()" (click)="setDianMode('live')">
                        <b>{{ 'SETTINGS.INV_MODE_LIVE' | translate }}@if (!dianLiveAllowed()) { <em>{{ 'SETTINGS.INV_LOCKED' | translate }}</em> }</b>
                        <small>{{ (dianLiveAllowed() ? 'SETTINGS.INV_MODE_LIVE_DESC' : 'SETTINGS.INV_MODE_LIVE_LOCKED') | translate }}</small>
                      </button>
                    </div>
                  </div>

                  @if (settings()?.dian_package; as pkg) {
                    <div class="st-card" data-testid="settings-dian-package">
                      <h3 class="st-card-title">{{ 'SETTINGS.INV_PACKAGE_TITLE' | translate }}</h3>
                      <p class="iv-pkg-count" [class.low]="pkg.low"><b>{{ pkg.remaining }}</b> {{ 'SETTINGS.INV_PACKAGE_OF' | translate }} {{ pkg.total }}</p>
                      <small class="field-hint">{{ 'SETTINGS.INV_PACKAGE_HINT' | translate }}</small>
                      @if (pkg.low && !pkg.alert_acked) {
                        <div class="iv-note iv-pkg-alert" role="alert">
                          <p>{{ 'SETTINGS.INV_PACKAGE_LOW' | translate: { n: pkg.alert_below } }}</p>
                          <button type="button" class="btn btn-secondary" (click)="ackDianPackageAlert()" data-testid="dian-package-ack">{{ 'SETTINGS.INV_PACKAGE_ACK' | translate }}</button>
                        </div>
                      }
                    </div>
                  }

                  <div class="st-card">
                    <h3 class="st-card-title">{{ 'SETTINGS.INV_ISSUER_TITLE' | translate }}</h3>
                    <p class="st-card-desc">{{ 'SETTINGS.INV_ISSUER_DESC' | translate }}</p>
                    <div class="form-group">
                      <label for="dian_nit">{{ 'SETTINGS.INV_NIT' | translate }}</label>
                      <div class="st-fixed st-fixed-sm" data-testid="settings-dian-nit">
                        <span class="st-fixed-ico" aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                        </span>
                        <span class="st-fixed-name">{{ nitDigits() }}{{ nitDv() === null ? '' : '-' + nitDv() }}</span>
                        <span class="st-fixed-chip">{{ 'SETTINGS.CITY_FIXED' | translate }}</span>
                      </div>
                    </div>

                    <div class="form-group">
                      <label>{{ 'SETTINGS.INV_REGIME' | translate }}</label>
                      <div class="st-fixed st-fixed-sm" data-testid="settings-dian-regime-fixed">
                        <span class="st-fixed-ico" aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                        </span>
                        <span class="st-fixed-name">{{ 'SETTINGS.INV_REGIME_NO_IVA' | translate }}</span>
                        <span class="st-fixed-chip">{{ 'SETTINGS.CITY_FIXED' | translate }}</span>
                      </div>
                    </div>
                  </div>

                  <div class="st-card st-card-list">
                    <h3 class="st-card-title">{{ 'SETTINGS.INV_DELIVERY_TITLE' | translate }}</h3>
                    <div class="form-group">
                      <label for="dian_numbering_range">{{ 'SETTINGS.INV_RANGE' | translate }}</label>
                      <div class="st-fixed st-fixed-sm" data-testid="settings-dian-range-fixed">
                        <span class="st-fixed-ico" aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                        </span>
                        <span class="st-fixed-name">{{ 'SETTINGS.INV_RANGE_FIXED' | translate }}</span>
                        <span class="st-fixed-chip">{{ 'SETTINGS.CITY_FIXED' | translate }}</span>
                      </div>
                    </div>
                    <div class="form-group checkbox-row">
                      <label class="switch">
                        <input type="checkbox" [(ngModel)]="formData.dian_send_email" name="dian_send_email">
                        <span class="slider round"></span>
                      </label>
                      <div>
                        <label class="check-label">{{ 'SETTINGS.INV_SEND_EMAIL' | translate }}</label>
                        <p class="hint">{{ 'SETTINGS.INV_SEND_EMAIL_HINT' | translate }}</p>
                      </div>
                    </div>
                    <p class="iv-note">{{ 'SETTINGS.INV_DEFAULT_CUSTOMER' | translate }}</p>
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
       OPENING HOURS
       ========================================== */
    .oh-hero { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 20px 32px; margin-bottom: 18px; padding: 22px 26px; border-radius: 28px; color: #fff7ec; background: radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--color-primary) 88%, #fff) 0%, color-mix(in srgb, var(--color-primary) 62%, #2b1306) 100%); box-shadow: 0 28px 40px -28px color-mix(in srgb, var(--color-primary) 70%, #000); }
    .oh-hero-main { flex: 1 1 260px; min-width: 0; }
    .oh-hero-summary { margin: 0 0 10px; font-family: Georgia, 'Times New Roman', serif; font-size: clamp(1.15rem, 2.2vw, 1.6rem); font-style: italic; font-weight: 500; line-height: 1.3; letter-spacing: -.01em; text-wrap: balance; }
    .oh-hero-stats { margin: 0; font-size: .88rem; color: rgba(255, 247, 236, .85); display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; }
    .oh-hero-stats b { font-size: 1.15rem; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; }
    .oh-week { display: flex; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .oh-week li { display: grid; place-items: center; width: 44px; height: 56px; border-radius: 16px; font-size: .72rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--color-primary); background: #fff7ec; box-shadow: 0 10px 16px -12px rgba(0, 0, 0, .55); }
    .oh-week li.off { color: rgba(255, 247, 236, .75); background: repeating-linear-gradient(135deg, rgba(255,255,255,.1) 0 5px, rgba(255,255,255,.04) 5px 10px); box-shadow: none; }
    .oh-week li.today { outline: 2px solid #fff; outline-offset: 3px; }

    .oh-copy { display: grid; gap: 12px; margin-bottom: 18px; padding: 14px 18px; border: 1px solid color-mix(in srgb, var(--color-border) 70%, #fff); border-radius: 22px; background: #fff; }
    .oh-copy-row { display: grid; grid-template-columns: 150px minmax(0, 1fr); align-items: center; gap: 8px 16px; }
    .oh-copy-label { font-size: .68rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--color-text-muted); }
    .oh-daychips { display: inline-flex; width: fit-content; max-width: 100%; flex-wrap: wrap; gap: 4px; padding: 3px; border-radius: 999px; background: #f4eee6; }
    .oh-daychip { min-width: 46px; min-height: 34px; padding: 0 10px; border: 0; border-radius: 999px; font: inherit; font-size: .76rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--color-text-muted); background: transparent; cursor: pointer; transition: background .18s, color .18s, box-shadow .18s; }
    .oh-daychip:hover { color: var(--color-text); }
    .oh-daychip.on { color: var(--color-primary); background: #fff; box-shadow: 0 3px 8px -4px rgba(60, 30, 10, .45); }
    @media (max-width: 560px) { .oh-copy { padding: 14px; } .oh-copy-row { grid-template-columns: 1fr; } .oh-daychips { display: flex; flex-wrap: nowrap; gap: 2px; width: 100%; } .oh-daychip { flex: 1; min-width: 0; padding: 0 2px; font-size: .68rem; letter-spacing: 0; } }
    .oh-daychip:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .oh-copy-actions { display: inline-flex; flex-wrap: wrap; gap: 8px; }
    .oh-copy-btn { min-height: 36px; padding: 0 16px; border: 1px solid color-mix(in srgb, var(--color-border) 70%, #fff); border-radius: 999px; font: inherit; font-size: .82rem; font-weight: 600; color: var(--color-text); background: #fffdfa; cursor: pointer; transition: border-color .15s, background .15s, color .15s; }
    .oh-copy-btn:hover { color: var(--color-primary); border-color: color-mix(in srgb, var(--color-primary) 50%, var(--color-border)); background: color-mix(in srgb, var(--color-primary) 8%, #fff); }
    .oh-copy-btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }


    .oh-days { display: grid; gap: 12px; }
    .oh-day { padding: 16px 18px 18px; border-radius: 24px; border: 1px solid var(--color-border); background: #fff; box-shadow: 0 18px 28px -26px rgba(60, 30, 10, .55); transition: border-color .2s, box-shadow .2s; }
    .oh-day.today { border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-border)); box-shadow: 0 18px 30px -22px color-mix(in srgb, var(--color-primary) 60%, transparent); }
    .oh-day.invalid { border-color: #b91c1c; }
    .oh-error { margin: 0; padding: 8px 14px; border-radius: 14px; font-size: .85rem; font-weight: 600; color: #7f1d1d; background: #fee2e2; }
    .oh-day.closed { padding-block: 12px; border-style: dashed; background: repeating-linear-gradient(135deg, #f6f1e9 0 6px, #fbf8f3 6px 12px); box-shadow: none; }
    .oh-day-head { display: flex; align-items: center; gap: 12px; }
    .oh-day-name { font-family: Georgia, 'Times New Roman', serif; font-size: 1.25rem; font-style: italic; font-weight: 500; letter-spacing: -.01em; }
    .oh-day.closed .oh-day-name { color: var(--color-text-muted); }
    .oh-today { padding: 3px 10px; border-radius: 999px; font-size: .68rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, #fff); }
    .closed-badge { margin-left: auto; padding: 3px 12px; border-radius: 999px; font-size: .72rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--color-text-muted); background: #ece5da; }

    .oh-day-body { display: grid; gap: 12px; margin-top: 14px; }
    .oh-bar { position: relative; height: 10px; border-radius: 999px; background: #f1ebe2 linear-gradient(90deg, transparent calc(25% - 1px), rgba(120, 90, 60, .18) calc(25% - 1px) 25%, transparent 25% calc(50% - 1px), rgba(120, 90, 60, .18) calc(50% - 1px) 50%, transparent 50% calc(75% - 1px), rgba(120, 90, 60, .18) calc(75% - 1px) 75%, transparent 75%); overflow: hidden; }
    .oh-seg { position: absolute; top: 0; bottom: 0; border-radius: 999px; background: var(--color-primary); transition: left .3s cubic-bezier(.16, 1, .3, 1), width .3s cubic-bezier(.16, 1, .3, 1); }
    .oh-seg.second { background: color-mix(in srgb, var(--color-primary) 55%, #2b1306); }


    .oh-extras { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px 18px; padding-top: 12px; border-top: 1px dashed var(--color-border); }
    .oh-chip { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 16px 0 12px; border-radius: 999px; border: 1px solid var(--color-border); font-size: .85rem; font-weight: 700; color: var(--color-text-muted); background: #fffdfa; cursor: pointer; transition: border-color .15s, background .15s, color .15s; }
    .oh-chip input { width: 16px; height: 16px; accent-color: var(--color-primary); cursor: pointer; }
    .oh-chip.on { color: var(--color-primary); border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border)); background: color-mix(in srgb, var(--color-primary) 8%, #fff); }
    .oh-chip:has(input:focus-visible) { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .oh-staff { flex: 1 1 260px; }
    .oh-staff summary { display: inline-flex; align-items: center; gap: 10px; min-height: 40px; font-size: .85rem; font-weight: 700; color: var(--color-text-muted); cursor: pointer; list-style: none; }
    .oh-staff summary::-webkit-details-marker { display: none; }
    .oh-staff summary::after { content: '+'; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; font-size: 1rem; line-height: 1; background: #f1ebe2; }
    .oh-staff[open] summary::after { content: '–'; }
    .oh-staff summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; border-radius: 8px; }
    .oh-staff-sum { padding: 2px 10px; border-radius: 999px; font-variant-numeric: tabular-nums; color: var(--color-text); background: #f1ebe2; }
    .oh-staff-inputs { display: flex; flex-wrap: wrap; gap: 12px 22px; padding: 6px 0 4px; }
    .oh-staff-field { display: inline-flex; align-items: center; gap: 10px; }
    .oh-staff-field label { font-size: .85rem; color: var(--color-text-muted); }
    .oh-num { width: 64px; min-height: 40px; padding: 0 8px; border: 1px solid var(--color-border); border-radius: 14px; font: inherit; font-weight: 700; text-align: center; color: var(--color-text); background: #fffdfa; font-variant-numeric: tabular-nums; }
    .oh-num:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }

    @media (max-width: 560px) {
      .oh-hero { padding: 18px; border-radius: 24px; }
      .oh-week { width: 100%; justify-content: space-between; }
      .oh-week li { flex: 1; width: auto; height: 48px; }
      .oh-day { padding: 14px; }
    }
    @media (prefers-reduced-motion: reduce) { .oh-seg { transition: none; } }

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

    .flex-grow {
      flex: 1;
      min-width: 140px;
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

    .st-bank-row { padding: 14px; margin-bottom: 10px; border-radius: 20px; border: 1px dashed var(--color-border); background: #fffdfa; align-items: center; }
    .payment-qr-preview { border-radius: 20px; box-shadow: 0 18px 28px -20px rgba(60, 30, 10, .5); }


    .oh-schedule-card { margin-top: 16px; padding: 22px 24px; border-radius: 26px; border: 1px solid var(--color-border); background: #fff; box-shadow: 0 22px 34px -30px rgba(60, 30, 10, .55); }
    .oh-schedule-card h4 { margin: 18px 0 10px; font-family: Georgia, 'Times New Roman', serif; font-size: 1.15rem; font-style: italic; font-weight: 500; }
    .oh-schedule-card > h4:first-child { margin-top: 0; }
    .oh-field:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .oh-help { margin: 0 0 16px; max-width: 70ch; font-size: .92rem; line-height: 1.5; color: var(--color-text-muted); }
    .oh-empty { margin: 4px 0 0; padding: 14px 16px; border-radius: 16px; border: 1px dashed var(--color-border); font-size: .9rem; color: var(--color-text-muted); text-align: center; }
    .oh-warn { margin: 0 0 12px; padding: 10px 14px; border-radius: 14px; font-size: .85rem; line-height: 1.45; color: #7c2d12; background: #ffedd5; }
    .oh-form { display: grid; gap: 14px 12px; align-items: end; margin-bottom: 18px; }
    .oh-form-3 { grid-template-columns: minmax(180px, 1fr) minmax(200px, 1.4fr) auto; }
    .oh-fgroup ::ng-deep .dp-trigger { min-height: 48px; border-radius: 999px; background: #fffdfa; }
    .oh-fgroup { display: grid; gap: 6px; min-width: 0; }
    .oh-fgroup label { font-size: .75rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-muted); }
    .oh-field { width: 100%; min-height: 48px; padding: 0 18px; border: 1px solid var(--color-border); border-radius: 999px; font: inherit; color: var(--color-text); background: #fffdfa; }
    .oh-field::placeholder { color: color-mix(in srgb, var(--color-text-muted) 75%, #fff); }
    @media (max-width: 760px) { .oh-form-3 { grid-template-columns: 1fr; } }
    .oh-special-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 14px 24px; margin-bottom: 18px; }
    .oh-special-head h4 { margin-top: 0; }
    .oh-special-head .oh-help { margin-bottom: 0; }
    .oh-toggle { display: inline-flex; padding: 3px; border-radius: 999px; background: #f4eee6; }
    .oh-toggle button { min-height: 34px; padding: 0 16px; border: 0; border-radius: 999px; font: inherit; font-size: .82rem; font-weight: 600; color: var(--color-text-muted); background: transparent; cursor: pointer; transition: background .18s, color .18s, box-shadow .18s; }
    .oh-toggle button.on { color: var(--color-text); background: #fff; box-shadow: 0 3px 8px -4px rgba(60, 30, 10, .45); }
    .oh-toggle button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .oh-composer { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .oh-capsule { display: flex; flex-direction: column; justify-content: center; gap: 0; min-width: 0; padding: 6px 16px; border: 1px solid color-mix(in srgb, var(--color-border) 70%, #fff); border-radius: 16px; background: #fff; transition: border-color .15s, box-shadow .15s; }
    .oh-capsule:focus-within { border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 10%, transparent); }
    .oh-capsule label { font-size: .62rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--color-text-muted); }
    .oh-cap-dates { flex: 2 1 340px; flex-direction: row; align-items: center; gap: 10px; }
    .oh-cap-field { flex: 1; display: grid; gap: 0; min-width: 0; }
    .oh-cap-field ::ng-deep .dp-trigger { min-height: 34px; gap: 8px; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
    .oh-cap-field ::ng-deep .dp-ico { width: 24px; height: 24px; box-shadow: none; }
    .oh-cap-field ::ng-deep .dp-ico svg { width: 13px; height: 13px; }
    .oh-cap-field ::ng-deep .dp-label { font-size: .9rem; font-weight: 600; }
    .oh-cap-arrow { color: var(--color-text-muted); font-size: .95rem; opacity: .6; }
    .oh-cap-hours { flex: 0 1 auto; }
    .oh-cap-note { flex: 1 1 150px; }
    .oh-cap-input { width: 100%; min-height: 34px; padding: 0; border: 0; font: inherit; font-size: .9rem; font-weight: 500; color: var(--color-text); background: transparent; outline: none; }
    .oh-cap-input::placeholder { color: color-mix(in srgb, var(--color-text-muted) 75%, #fff); }
    .oh-composer .oh-add { min-height: 40px; padding: 0 20px; }
    .oh-preview { display: flex; align-items: center; gap: 10px; margin: 12px 0 18px; padding: 9px 14px; border-radius: 12px; font-size: .86rem; font-weight: 500; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 6%, #fff); }
    .oh-preview svg { flex: none; }
    .oh-preview.empty { font-weight: 500; color: var(--color-text-muted); background: transparent; border: 1px dashed var(--color-border); }
    .oh-preview.bad { color: #7f1d1d; background: #fee2e2; }
    .oh-tile { display: grid; place-items: center; align-content: center; width: 46px; height: 50px; border-radius: 14px; line-height: 1; color: var(--color-primary); background: #fff; border: 1px solid color-mix(in srgb, var(--color-primary) 20%, var(--color-border)); }
    .oh-tile b { font-family: Georgia, 'Times New Roman', serif; font-size: 1.3rem; font-style: italic; font-weight: 400; }
    .oh-tile small { margin-top: 2px; font-size: .58rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--color-text-muted); }
    @media (max-width: 560px) {
      .oh-toggle { width: 100%; } .oh-toggle button { flex: 1; padding: 0 8px; }
      .oh-composer .oh-add { min-height: 44px; width: 100%; }
      .oh-cap-dates { flex-direction: column; align-items: stretch; gap: 4px; } .oh-cap-arrow { display: none; }
      .oh-plan-item { grid-template-columns: auto minmax(0, 1fr); } .oh-plan-actions { grid-column: 1 / -1; justify-content: flex-end; }
    }
    .oh-add { min-height: 40px; border-radius: 999px; padding: 0 20px; font-size: .85rem; font-weight: 700; box-shadow: none; }
    .oh-plan { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .oh-plan-item.active { border-color: color-mix(in srgb, var(--color-primary) 50%, var(--color-border)); background: color-mix(in srgb, var(--color-primary) 6%, #fff); }
    .oh-plan-item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px 14px; padding: 10px 14px 10px 10px; border-radius: 18px; background: #fbf8f3; border: 1px solid var(--color-border); }
    .oh-plan-main { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; min-width: 0; }
    .oh-plan-date { font-weight: 800; font-variant-numeric: tabular-nums; }
    .oh-plan-tag { padding: 2px 10px; border-radius: 999px; font-size: .68rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, #fff); }
    .oh-plan-tag.closed { color: #7f1d1d; background: #fee2e2; }
    .oh-plan-note { color: var(--color-text-muted); font-size: .9rem; overflow-wrap: anywhere; }
    .oh-plan-actions { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .oh-ask { font-size: .85rem; font-weight: 600; }
    .oh-btn { min-height: 36px; padding: 0 14px; border: 1px solid var(--color-border); border-radius: 999px; font: inherit; font-size: .8rem; font-weight: 700; color: var(--color-text); background: #fff; cursor: pointer; }
    .oh-btn:hover { border-color: color-mix(in srgb, var(--color-primary) 50%, var(--color-border)); }
    .oh-btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .oh-btn-danger { color: #fff; border-color: #b91c1c; background: #b91c1c; }

    .br-sub { margin: -4px 0 18px; font-size: .9rem; color: var(--color-text-muted); }
    .br-frame { border-radius: 22px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--color-border) 70%, #fff); background: #fffdfa; }
    .br-frame-bar { display: flex; align-items: center; gap: 14px; padding: 9px 14px; background: #f4eee6; }
    .br-dots { display: inline-flex; gap: 5px; }
    .br-dots i { width: 9px; height: 9px; border-radius: 50%; background: color-mix(in srgb, var(--color-text-muted) 35%, #fff); }
    .br-url { min-width: 0; flex: 1; max-width: 420px; padding: 3px 12px; border-radius: 999px; font-size: .72rem; color: var(--color-text-muted); background: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .br-hero { position: relative; display: grid; place-items: center; min-height: 190px; padding: 26px 24px 30px; cursor: pointer; border-radius: 0 0 28px 28px; color: #fff; background: radial-gradient(120% 90% at 8% 0%, rgba(240, 138, 60, .4), transparent 55%), radial-gradient(90% 80% at 100% 100%, rgba(179, 90, 32, .32), transparent 60%), linear-gradient(170deg, #2b1d15, #171210); transition: box-shadow .2s; }
    .br-hero.drag, .br-asset.drag { box-shadow: inset 0 0 0 3px var(--color-primary); }
    .br-hero-img { max-width: 100%; max-height: 12.5rem; width: auto; object-fit: contain; filter: drop-shadow(0 10px 24px rgba(0, 0, 0, .35)); }
    .br-hero-fallback { display: grid; justify-items: center; gap: 12px; text-align: center; }
    .br-hero-logo { display: grid; place-items: center; width: 84px; height: 84px; border-radius: 24px; background: #fff; box-shadow: 0 14px 28px -14px rgba(0, 0, 0, .7); }
    .br-hero-logo img { width: 100%; height: 100%; padding: 6px; object-fit: contain; }
    .br-hero-name { font-family: var(--font-brand, Georgia, serif); font-size: 1.6rem; font-weight: 600; letter-spacing: -.01em; }
    .br-over { position: absolute; right: 14px; top: 14px; display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; font-size: .8rem; font-weight: 600; color: #fff; background: rgba(255, 255, 255, .16); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); border: 1px solid rgba(255, 255, 255, .22); opacity: 0; transform: translateY(-4px); transition: opacity .2s, transform .2s; pointer-events: none; }
    .br-hero:hover .br-over, .br-hero:focus-within .br-over { opacity: 1; transform: none; }
    .br-frame-note { margin: 0; padding: 10px 16px; font-size: .78rem; line-height: 1.45; color: var(--color-text-muted); }
    .br-assets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
    .br-asset { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px; padding: 14px; border-radius: 20px; border: 1px solid color-mix(in srgb, var(--color-border) 70%, #fff); background: #fffdfa; transition: box-shadow .2s; }
    .br-thumb { display: grid; place-items: center; flex: none; width: 76px; height: 76px; border-radius: 18px; overflow: hidden; cursor: pointer; background: #fff; border: 1px solid var(--color-border); color: var(--color-primary); transition: border-color .15s; }
    .br-thumb:hover { border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-border)); }
    .br-thumb img { width: 100%; height: 100%; object-fit: contain; padding: 6px; }
    .br-thumb b { font-family: Georgia, 'Times New Roman', serif; font-size: 2rem; font-style: italic; font-weight: 400; }
    .br-thumb-bg { background: linear-gradient(170deg, #2b1d15, #171210); border-color: transparent; color: rgba(255, 255, 255, .55); }
    .br-thumb-bg img { padding: 8px; }
    .br-asset-body { display: grid; gap: 4px; min-width: 0; align-content: start; }
    .br-asset-top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .br-asset-top b { font-size: .92rem; }
    .br-state { padding: 2px 9px; border-radius: 999px; font-size: .64rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #166534; background: #dcfce7; }
    .br-state.pending { color: #92400e; background: #fef3c7; }
    .br-state.empty { color: var(--color-text-muted); background: #ece5da; }
    .br-spec { font-size: .8rem; line-height: 1.4; color: var(--color-text); overflow-wrap: anywhere; }
    .br-formats { font-size: .74rem; color: var(--color-text-muted); }
    .br-asset-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .br-btn { display: inline-flex; align-items: center; min-height: 34px; padding: 0 16px; border: 1px solid color-mix(in srgb, var(--color-border) 70%, #fff); border-radius: 999px; font: inherit; font-size: .8rem; font-weight: 600; color: var(--color-text); background: #fff; cursor: pointer; transition: border-color .15s, color .15s, background .15s; }
    .br-btn:hover { color: var(--color-primary); border-color: color-mix(in srgb, var(--color-primary) 50%, var(--color-border)); }
    .br-btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .br-btn-quiet { color: var(--color-text-muted); background: transparent; border-color: transparent; }
    .br-btn-quiet:hover { color: #b91c1c; background: #fee2e2; border-color: transparent; }
    @media (max-width: 760px) { .br-assets { grid-template-columns: 1fr; } }
    @media (max-width: 560px) { .br-hero { min-height: 150px; padding: 20px 14px 24px; } .br-over { opacity: 1; transform: none; } .br-thumb { width: 64px; height: 64px; } }
    @media (prefers-reduced-motion: reduce) { .br-over { transition: none; } }

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

    .st-fixed { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 20px; border: 1px dashed color-mix(in srgb, var(--color-primary) 40%, var(--color-border)); background: color-mix(in srgb, var(--color-primary) 6%, #fff); }
    .st-fixed-ico { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 14%, #fff); }
    .st-fixed-name { flex: 1; min-width: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 1.35rem; font-style: italic; font-weight: 500; letter-spacing: -.01em; overflow-wrap: anywhere; }
    .st-fixed-sm { gap: 10px; padding: 0 14px; min-height: 44px; border-style: solid; border-color: var(--color-border); background: #f6f2ec; }
    .st-fixed-sm .st-fixed-ico { width: 22px; height: 22px; background: transparent; color: var(--color-text-muted); }
    .st-fixed-sm .st-fixed-ico svg { width: 14px; height: 14px; }
    .st-fixed-sm .st-fixed-name { font-family: inherit; font-size: .95rem; font-style: normal; font-weight: 600; color: var(--color-text-muted); }
    .st-fixed-sm .st-fixed-chip { padding: 2px 8px; font-size: .6rem; color: var(--color-text-muted); background: #e9e2d8; }
    .st-fixed-chip { flex: none; padding: 4px 12px; border-radius: 999px; font-size: .66rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, #fff); }
    /* Facturación electrónica (DIAN / Factus) */
    .iv-hero { display: flex; align-items: stretch; justify-content: space-between; gap: 18px 28px; flex-wrap: wrap; margin-bottom: 16px; padding: 22px 26px; border-radius: 28px; border: 1px solid var(--color-border); background: radial-gradient(80% 160% at 0% 0%, color-mix(in srgb, var(--color-primary) 14%, #fff), transparent 70%), #fffdfa; box-shadow: 0 26px 40px -34px rgba(60, 30, 10, .55); }
    .iv-hero[data-mode='live'] { background: radial-gradient(80% 160% at 0% 0%, #dcfce7, transparent 70%), #fffdfa; border-color: #86efac; }
    .iv-hero[data-mode='test'] { background: radial-gradient(80% 160% at 0% 0%, #fef3c7, transparent 70%), #fffdfa; }
    .iv-hero-main { display: flex; flex-direction: column; gap: 4px; justify-content: center; }
    .iv-eyebrow { font-size: .64rem; font-weight: 800; letter-spacing: .2em; text-transform: uppercase; color: var(--color-text-muted); }
    .iv-state { font-family: Georgia, 'Times New Roman', serif; font-size: clamp(1.8rem, 4vw, 2.6rem); font-style: italic; font-weight: 500; letter-spacing: -.02em; line-height: 1.05; }
    .iv-progress { font-size: .84rem; font-weight: 700; color: var(--color-text-muted); }
    .iv-check { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; align-content: center; }
    .iv-check li { display: flex; align-items: center; gap: 10px; font-size: .88rem; font-weight: 600; color: var(--color-text-muted); }
    .iv-check i { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; font-style: normal; font-weight: 800; color: #a39a90; background: #ece5da; }
    .iv-check li.ok { color: var(--color-text); }
    .iv-check li.ok i { color: #fff; background: #22a05a; }

    .iv-modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
    .iv-mode, .iv-regime { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 16px; border-radius: 22px; border: 1.5px solid var(--color-border); background: #fffdfa; color: var(--color-text); font: inherit; text-align: left; cursor: pointer; transition: border-color .15s, background .15s, box-shadow .15s; }
    .iv-mode b, .iv-regime b { font-family: Georgia, 'Times New Roman', serif; font-size: 1.15rem; font-style: italic; font-weight: 500; }
    .iv-mode b em { margin-left: 8px; padding: 2px 8px; border-radius: 999px; font-family: inherit; font-size: .6rem; font-style: normal; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #92400e; background: #fef3c7; }
    .iv-mode small, .iv-regime small { font-size: .78rem; line-height: 1.4; color: var(--color-text-muted); }
    .iv-mode:hover:not(.locked), .iv-regime:hover { border-color: var(--color-primary); }
    .iv-mode.on, .iv-regime.on { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 8%, #fff); box-shadow: 0 0 0 1px var(--color-primary), 0 18px 28px -22px var(--color-primary); }
    .iv-mode.locked { cursor: not-allowed; background: repeating-linear-gradient(135deg, #f6f1e9 0 6px, #fbf8f3 6px 12px); }
    .iv-mode.locked b { color: var(--color-text-muted); }
    .iv-regimes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .iv-code { align-self: flex-start; padding: 2px 10px; margin-bottom: 2px; border-radius: 999px; font-size: .68rem; font-weight: 800; letter-spacing: .06em; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, #fff); }
    @media (max-width: 760px) { .iv-modes, .iv-regimes { grid-template-columns: minmax(0, 1fr); } }

    .iv-nit { display: flex; align-items: stretch; gap: 10px; max-width: 360px; }
    .settings-form .iv-nit input { flex: 1; min-width: 0; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 1.15rem; font-weight: 700; letter-spacing: .08em; }
    .iv-dv { flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 64px; padding: 4px 12px; border-radius: 16px; background: color-mix(in srgb, var(--color-primary) 10%, #fff); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 35%, transparent); }
    .iv-dv.empty { background: #f3eee6; box-shadow: inset 0 0 0 1px var(--color-border); }
    .iv-dv small { font-size: .56rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: var(--color-text-muted); }
    .iv-dv b { font-family: Georgia, 'Times New Roman', serif; font-size: 1.4rem; font-weight: 500; line-height: 1; color: var(--color-primary); }
    .iv-note { margin: 0 0 14px; padding: 10px 14px; border-radius: 16px; font-size: .84rem; line-height: 1.45; color: var(--color-text-muted); background: #f6f1e9; }
    .iv-pkg-count { margin: 4px 0 6px; font-size: 1rem; color: var(--color-text-muted); }
    .iv-pkg-count b { font-size: 2.2rem; font-weight: 700; color: var(--color-text); }
    .iv-pkg-count.low b { color: #b91c1c; }
    .iv-pkg-alert { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 12px 0 0; background: #fee2e2; color: #7f1d1d; }
    .iv-pkg-alert p { margin: 0; flex: 1 1 220px; }

    /* Transferencias */
    .tr-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }
    .tr-wide { grid-column: 1 / -1; }
    @media (max-width: 640px) { .tr-grid { grid-template-columns: minmax(0, 1fr); } }
    .tr-tile { --ac: 25; display: flex; flex-direction: column; gap: 10px; padding: 16px 16px 14px; border-radius: 24px; border: 1px solid var(--color-border); background: #fffdfa; transition: border-color .2s, background .2s, box-shadow .2s; }
    .tr-nequi { --ac: 285; }
    .tr-llave { --ac: 165; }
    .tr-holder { --ac: 25; }
    .tr-tile.on { border-color: hsl(var(--ac) 55% 70%); background: linear-gradient(160deg, hsl(var(--ac) 80% 96%), #fffdfa 65%); box-shadow: 0 22px 34px -30px hsl(var(--ac) 50% 30% / .65); }
    .tr-head { display: flex; align-items: center; gap: 12px; }
    .tr-ico { flex: none; display: grid; place-items: center; width: 42px; height: 42px; border-radius: 14px; color: #a39a90; background: #efe9df; transition: background .2s, color .2s; }
    .tr-tile.on .tr-ico { color: hsl(var(--ac) 55% 28%); background: hsl(var(--ac) 70% 86%); box-shadow: inset 0 0 0 2px hsl(var(--ac) 65% 76%); }
    .settings-form .tr-head label { flex: 1; min-width: 0; margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 1.12rem; font-style: italic; font-weight: 500; letter-spacing: -.01em; text-transform: none; color: var(--color-text); }
    .tr-state { flex: none; padding: 3px 10px; border-radius: 999px; font-size: .62rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #8a817a; background: #ece5da; }
    .tr-tile.on .tr-state { color: #166534; background: #dcfce7; }
    .settings-form .tr-input { width: 100%; min-height: 0; padding: 8px 0; border: 0; border-bottom: 2px dashed var(--color-border); border-radius: 0; background: transparent; box-shadow: none; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 1.25rem; font-weight: 700; letter-spacing: .06em; color: var(--color-text); }
    .settings-form .tr-input-text { font-family: inherit; font-size: 1.05rem; letter-spacing: 0; }
    .settings-form .tr-input::placeholder { color: #c4baae; font-weight: 600; }
    .settings-form .tr-input:hover { border-bottom-color: #d9cfc2; }
    .settings-form .tr-input:focus { outline: none; box-shadow: none; border-bottom: 2px solid hsl(var(--ac) 60% 45%); }
    .tr-hint { margin: 0; font-size: .76rem; line-height: 1.4; color: var(--color-text-muted); }
    .tr-preview { display: flex; align-items: center; gap: 10px 14px; flex-wrap: wrap; padding: 12px 16px; margin-bottom: 14px; border-radius: 20px; border: 1px dashed color-mix(in srgb, var(--color-primary) 40%, var(--color-border)); background: color-mix(in srgb, var(--color-primary) 4%, #fffdfa); }
    .tr-preview-label { font-size: .62rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: var(--color-primary); }
    .tr-preview-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .tr-chip { display: inline-flex; align-items: center; gap: 8px; padding: 5px 14px 5px 6px; border-radius: 999px; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: .86rem; font-weight: 700; background: #fff; box-shadow: inset 0 0 0 1px var(--color-border); overflow-wrap: anywhere; }
    .tr-chip b { padding: 3px 10px; border-radius: 999px; font-family: inherit; font-size: .64rem; letter-spacing: .1em; text-transform: uppercase; }
    .tr-chip-nequi b { color: hsl(285 55% 28%); background: hsl(285 70% 88%); }
    .tr-chip-llave b { color: hsl(165 60% 22%); background: hsl(165 60% 84%); }
    .tr-preview-empty { font-size: .84rem; font-weight: 600; color: var(--color-text-muted); }
    .tr-preview-holder { margin-left: auto; font-size: .82rem; color: var(--color-text-muted); }
    .tr-preview-holder b { color: var(--color-text); }

    /* Cuentas bancarias y QR */
    .bk-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .bk-card { --h: 20; position: relative; display: flex; flex-direction: column; gap: 12px; padding: 16px 16px 18px; border-radius: 24px; border: 1px solid var(--color-border); background: linear-gradient(160deg, hsl(var(--h) 75% 96%), #fffdfa 60%); box-shadow: 0 22px 34px -28px hsl(var(--h) 45% 30% / .6); overflow: hidden; }
    .bk-card::after { content: ''; position: absolute; right: -40px; top: -40px; width: 130px; height: 130px; border-radius: 50%; background: hsl(var(--h) 70% 85% / .45); pointer-events: none; }
    .bk-top { position: relative; z-index: 1; display: flex; align-items: center; gap: 10px; }
    .bk-logo { flex: none; display: grid; place-items: center; width: 42px; height: 42px; border-radius: 14px; font-family: Georgia, 'Times New Roman', serif; font-size: 1.3rem; font-style: italic; font-weight: 600; color: hsl(var(--h) 55% 26%); background: hsl(var(--h) 70% 86%); box-shadow: inset 0 0 0 2px hsl(var(--h) 65% 75%); }
    .settings-form .bk-card input { width: 100%; min-height: 0; padding: 0; border: 0; border-bottom: 1.5px dashed transparent; border-radius: 0; background: transparent; box-shadow: none; color: var(--color-text); font: inherit; font-weight: 700; }
    .settings-form .bk-card input:hover { border-bottom-color: var(--color-border); }
    .settings-form .bk-card input:focus { outline: none; box-shadow: none; border-bottom-color: var(--color-primary); }
    .settings-form .bk-card input::placeholder { color: #b3a99f; font-weight: 600; }
    .settings-form .bk-card .bk-name { flex: 1; min-width: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 1.3rem; font-weight: 500; letter-spacing: -.01em; padding: 4px 0; }
    .settings-form .bk-card .bk-num { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 1.1rem; letter-spacing: .08em; padding: 6px 0; }
    .bk-del { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 50%; color: var(--color-text-muted); background: rgba(255,255,255,.7); cursor: pointer; transition: background .15s, color .15s; }
    .bk-del:hover { color: #fff; background: #dc2626; }
    .bk-type { position: relative; z-index: 1; display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(255,255,255,.75); align-self: flex-start; box-shadow: inset 0 0 0 1px var(--color-border); }
    .bk-type button { min-height: 32px; padding: 0 14px; border: 0; border-radius: 999px; font: inherit; font-size: .78rem; font-weight: 800; color: var(--color-text-muted); background: transparent; cursor: pointer; }
    .bk-type button.on { color: #fff; background: linear-gradient(145deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 62%, #000)); box-shadow: 0 8px 12px -8px var(--color-primary); }
    .bk-field { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 2px; margin: 0; }
    .bk-field small { font-size: .6rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: var(--color-text-muted); }
    .bk-confirm { position: absolute; inset: auto 0 0 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 12px 14px; font-size: .84rem; font-weight: 700; color: #7f1d1d; background: #fee2e2; border-top: 1px solid #fecaca; }
    .bk-confirm-actions { display: inline-flex; gap: 6px; }
    .bk-confirm button { min-height: 32px; padding: 0 14px; border: 0; border-radius: 999px; font: inherit; font-size: .78rem; font-weight: 800; cursor: pointer; }
    .bk-no { color: var(--color-text); background: #fff; }
    .bk-yes { color: #fff; background: #dc2626; }
    .bk-add { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 190px; padding: 18px; border-radius: 24px; border: 2px dashed color-mix(in srgb, var(--color-primary) 45%, var(--color-border)); background: color-mix(in srgb, var(--color-primary) 4%, #fffdfa); color: var(--color-text); font: inherit; text-align: center; cursor: pointer; transition: background .15s, border-color .15s, transform .15s; }
    .bk-add:hover { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 9%, #fff); transform: translateY(-2px); }
    .bk-add-ico { display: grid; place-items: center; width: 50px; height: 50px; border-radius: 50%; color: #fff; background: linear-gradient(145deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 62%, #000)); box-shadow: 0 14px 20px -12px var(--color-primary); }
    .bk-add b { font-size: .95rem; font-weight: 800; }
    .bk-add small { max-width: 22ch; font-size: .76rem; font-weight: 600; line-height: 1.35; color: var(--color-text-muted); }

    .qr-tile { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; padding: 18px; margin-bottom: 14px; border-radius: 24px; border: 1px solid var(--color-border); background: #fffdfa; }
    .qr-frame { position: relative; flex: none; display: grid; place-items: center; width: 168px; height: 168px; padding: 12px; border-radius: 22px; background: #fff; box-shadow: 0 18px 28px -20px rgba(60, 30, 10, .55), inset 0 0 0 1px var(--color-border); color: #c9bfb3; }
    .qr-frame.empty { background: repeating-linear-gradient(135deg, #faf6ef 0 8px, #f5efe5 8px 16px); }
    .qr-frame .payment-qr-preview { width: 100%; height: 100%; margin: 0; border: 0; border-radius: 10px; box-shadow: none; object-fit: contain; }
    .qr-body { flex: 1 1 220px; min-width: 0; }
    .qr-body h4 { margin: 0 0 4px; font-family: Georgia, 'Times New Roman', serif; font-size: 1.2rem; font-style: italic; font-weight: 500; }
    .qr-body p { margin: 0 0 14px; font-size: .84rem; line-height: 1.45; color: var(--color-text-muted); }
    .qr-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .qr-upload, .qr-remove { display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 20px; border-radius: 999px; font: inherit; font-size: .86rem; font-weight: 800; cursor: pointer; }
    .qr-upload { color: #fff; border: 0; background: linear-gradient(145deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 62%, #000)); box-shadow: 0 14px 20px -14px var(--color-primary); }
    .qr-remove { color: #b91c1c; background: #fff; border: 1.5px solid #fecaca; }
    .qr-remove:hover { color: #fff; background: #dc2626; border-color: #dc2626; }
    @media (prefers-reduced-motion: reduce) { .bk-add, .bk-add:hover { transition: none; transform: none; } }

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
        { id: 'invoicing', labelKey: 'SETTINGS.NAV_INVOICING', descKey: 'SETTINGS.NAV_DESC_INVOICING', testid: 'settings-invoicing-tab',
          icon: 'M6 2h12v20l-3-2-3 2-3-2-3 2z M9 7h6 M9 11h6 M9 15h4' },
        { id: 'navigation', labelKey: 'SETTINGS.NAVIGATION_UI_TAB', descKey: 'SETTINGS.NAV_DESC_NAVIGATION', testid: 'settings-navigation-tab',
          icon: 'M4 6h16M4 12h16M4 18h10' },
      ],
    },
  ];

  // ---- Factura electrónica DIAN (Factus)
  dianStatus(): { provider: string; credentials_ready: boolean; live_unlocked: boolean } {
    return this.settings()?.dian_status ?? { provider: 'mock', credentials_ready: false, live_unlocked: false };
  }

  ackDianPackageAlert(): void {
    this.api.ackDianPackageAlert().subscribe((pkg) => {
      this.settings.update((s) => (s ? { ...s, dian_package: pkg } : s));
    });
  }

  dianLiveAllowed(): boolean {
    return this.dianStatus().live_unlocked || this.formData.dian_mode === 'live';
  }

  setDianMode(mode: 'off' | 'test' | 'live'): void {
    if (mode === 'live' && !this.dianLiveAllowed()) return;
    this.formData.dian_mode = mode;
    this.markDirty();
  }

  /** NIT without check digit (the stored value may come as "123456789-1"). */
  nitDigits(): string {
    return String(this.formData.tax_id || '').split('-')[0].replace(/\D/g, '');
  }

  /** DIAN check digit (módulo 11 with the official prime weights). */
  nitDv(): number | null {
    const d = this.nitDigits();
    if (d.length < 5) return null;
    const w = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += Number(d[d.length - 1 - i]) * w[i];
    const r = sum % 11;
    return r > 1 ? 11 - r : r;
  }

  /** What is still missing before invoices can go out. */
  dianChecklist(): { done: number; items: { key: string; ok: boolean; labelKey: string }[] } {
    const st = this.dianStatus();
    const items = [
      { key: 'creds', ok: st.credentials_ready && st.provider === 'factus', labelKey: 'SETTINGS.INV_CHECK_CREDS' },
      { key: 'nit', ok: this.nitDigits().length >= 5, labelKey: 'SETTINGS.INV_CHECK_NIT' },
      { key: 'regime', ok: !!this.formData.dian_tax_regime, labelKey: 'SETTINGS.INV_CHECK_REGIME' },
      { key: 'live', ok: st.live_unlocked, labelKey: 'SETTINGS.INV_CHECK_LIVE' },
    ];
    return { done: items.filter((i) => i.ok).length, items };
  }

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
    'invoicing',
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
  overrideOpen = '10:30';
  overrideClose = '21:15';

  daysOfWeek = [
    { key: 'monday', label: 'SETTINGS.DAY_MONDAY' },
    { key: 'tuesday', label: 'SETTINGS.DAY_TUESDAY' },
    { key: 'wednesday', label: 'SETTINGS.DAY_WEDNESDAY' },
    { key: 'thursday', label: 'SETTINGS.DAY_THURSDAY' },
    { key: 'friday', label: 'SETTINGS.DAY_FRIDAY' },
    { key: 'saturday', label: 'SETTINGS.DAY_SATURDAY' },
    { key: 'sunday', label: 'SETTINGS.DAY_SUNDAY' }
  ];

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
    reservation_arrival_tolerance_minutes: null,
    reservation_average_table_turn_minutes: null,
    reservation_slot_minutes: null,
    reservation_max_guests_per_slot: null,
    reservation_walk_in_tables_reserved: 0,
    reservation_dress_code: null,
    reservation_reminder_24h_enabled: false,
    reservation_reminder_2h_enabled: false,
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
    dian_numbering_range_id: null as number | null,
    dian_send_email: true,
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
          name: 'Pancho Panza', // fixed brand name: shown read-only in Settings
          business_type: settings.business_type || null,
          description: settings.description || null,
          phone: settings.phone || null,
          whatsapp: settings.whatsapp || null,
          email: settings.email || null,
          address: settings.address || null,
          city: 'San Vicente de Chucurí', // fixed: shown read-only in Settings
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
          reservation_arrival_tolerance_minutes: settings.reservation_arrival_tolerance_minutes ?? null,
          reservation_average_table_turn_minutes: settings.reservation_average_table_turn_minutes ?? null,
          reservation_slot_minutes: settings.reservation_slot_minutes ?? null,
          reservation_max_guests_per_slot: settings.reservation_max_guests_per_slot ?? null,
          reservation_walk_in_tables_reserved: settings.reservation_walk_in_tables_reserved ?? 0,
          reservation_dress_code: settings.reservation_dress_code ?? null,
          reservation_reminder_24h_enabled: settings.reservation_reminder_24h_enabled ?? false,
          reservation_reminder_2h_enabled: settings.reservation_reminder_2h_enabled ?? false,
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
          public_terms_of_service_url:
            settings.public_terms_of_service_url ?? `${window.location.origin}/terms`,
          public_privacy_policy_url:
            settings.public_privacy_policy_url ?? `${window.location.origin}/privacy`,
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
          dian_numbering_range_id: settings.dian_numbering_range_id ?? null,
          dian_send_email: settings.dian_send_email ?? true,
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

  /** Scheduled weekly pattern in force today: the latest one starting on or before today. */
  activeBaselineId(): number | null {
    const today = new Date().toISOString().slice(0, 10);
    const rows = this.openingHoursScheduleBaselines()
      .filter((b) => b.effective_from <= today)
      .sort((x, y) => (x.effective_from < y.effective_from ? 1 : -1));
    return rows[0]?.id ?? null;
  }

  fmtDate(iso: string): string {
    const locale = this.translate.currentLang || this.translate.defaultLang || 'es';
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(
      new Date(`${iso}T12:00:00`),
    );
  }

  /** Row waiting for its inline delete confirmation: 'b:<id>' (baseline) or 'o:<id>' (override). */
  pendingDelete = signal<string | null>(null);

  deleteBaselineSchedule(id: number): void {
    this.pendingDelete.set(null);
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
    if (dt < df) {
      this.error.set(this.translate.instant('SETTINGS.OH_ERR_RANGE'));
      return;
    }
    const closed = this.overrideClosedOnly;
    if (!closed && this.overrideHoursInvalid()) {
      this.error.set(this.translate.instant('SETTINGS.OH_ERR_ORDER'));
      return;
    }
    const oh = closed ? null : this.specialDayHoursJson();
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
          this.overrideOpen = '10:30';
          this.overrideClose = '21:15';
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

  dayNum(iso: string): number {
    return Number(iso.slice(8, 10));
  }

  monthShort(iso: string): string {
    const locale = this.translate.currentLang || this.translate.defaultLang || 'es';
    return new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(`${iso}T12:00:00`)).replace('.', '');
  }

  /** Live summary of the special day being composed; null until a start date is chosen. */
  specialPreview(): { text: string; bad: boolean } | null {
    const from = (this.overrideDateFrom || '').trim();
    const to = (this.overrideDateTo || '').trim() || from;
    if (!from) return null;
    if (to < from) return { text: this.translate.instant('SETTINGS.OH_ERR_RANGE'), bad: true };
    const days = Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86400000) + 1;
    const range = from === to ? this.fmtDate(from) : `${this.fmtDate(from)} → ${this.fmtDate(to)}`;
    const count = `${days} ${this.translate.instant(days === 1 ? 'SETTINGS.OH_DAY_ONE' : 'SETTINGS.OH_DAY_MANY')}`;
    if (this.overrideClosedOnly) {
      return { text: `${range} · ${count} · ${this.translate.instant('SETTINGS.OH_PREVIEW_CLOSED')}`, bad: false };
    }
    if (this.overrideHoursInvalid()) return { text: this.translate.instant('SETTINGS.OH_ERR_ORDER'), bad: true };
    return { text: `${range} · ${count} · ${this.overrideOpen}–${this.overrideClose}`, bad: false };
  }

  overrideHoursInvalid(): boolean {
    const [o, c] = [SettingsComponent.toMinutes(this.overrideOpen), SettingsComponent.toMinutes(this.overrideClose)];
    return o === null || c === null || c <= o;
  }

  /** Weekly JSON with the same open/close every day: the special-day hours apply to each date of the range. */
  private specialDayHoursJson(): string {
    const day = { closed: false, open: this.overrideOpen, close: this.overrideClose, waiter: 0, kitchen: 0 };
    return JSON.stringify(Object.fromEntries(this.daysOfWeek.map((d) => [d.key, day])));
  }

  /** "10:30–15:00" from a stored weekly JSON (special days use the same hours every day); falls back to the generic label. */
  overrideHoursLabel(weeklyJson: string | null | undefined): string {
    try {
      const d = JSON.parse(weeklyJson || '')?.monday;
      if (d?.open && d?.close) return `${d.open}–${d.close}`;
    } catch {
      /* fall through */
    }
    return this.translate.instant('SETTINGS.OPENING_HOURS_TYPE_HOURS');
  }

  deleteOverrideSchedule(id: number): void {
    this.pendingDelete.set(null);
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
        open: '10:30',
        close: '21:15',
        closed: false,
        hasBreak: false,
        morningOpen: '10:30',
        morningClose: '14:00',
        eveningOpen: '17:00',
        eveningClose: '21:15',
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
    this.serializeOpeningHours();    this.markDirty();
  }

  setServiceLabelValue(
    dayKey: string,
    field: 'serviceLabel' | 'morningLabel' | 'eveningLabel',
    value: string,
  ): void {
    (this.openingHours[dayKey] as any)[field] = (value || '').trim().slice(0, 64);
    this.serializeOpeningHours();
  }

  copyDayToOtherDays(sourceKey: string, scope: 'all' | 'weekdays' | 'weekend' = 'all') {
    const source = this.openingHours[sourceKey];
    if (!source) return;
    const targets = { all: [0, 1, 2, 3, 4, 5, 6], weekdays: [0, 1, 2, 3, 4], weekend: [5, 6] }[scope];
    this.daysOfWeek.forEach((day, i) => {
      if (day.key === sourceKey || !targets.includes(i)) return;
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
    this.markDirty();
  }

  /** Weekday key ("monday"…) in the restaurant's time zone, falling back to the browser's. */
  get todayKey(): string {
    const tz = this.formData.timezone || undefined;
    try {
      return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(new Date()).toLowerCase();
    } catch {
      return this.daysOfWeek[(new Date().getDay() + 6) % 7].key;
    }
  }

  dayShort(key: string): string {
    const i = this.daysOfWeek.findIndex((d) => d.key === key);
    const locale = this.translate.currentLang || this.translate.defaultLang || 'es';
    return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2024, 0, 1 + i)).replace('.', '');
  }

  private static toMinutes(t: string | undefined): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  /** Valid open windows of a day as [startMin, endMin]; hours cannot run past midnight, so inverted ones are skipped. */
  private dayWindows(key: string): [number, number][] {
    const d = this.openingHours[key];
    if (!d || d.closed) return [];
    const pairs = d.hasBreak
      ? [[d.morningOpen, d.morningClose], [d.eveningOpen, d.eveningClose]]
      : [[d.open, d.close]];
    const out: [number, number][] = [];
    for (const [o, c] of pairs) {
      const s = SettingsComponent.toMinutes(o);
      const e = SettingsComponent.toMinutes(c);
      if (s === null || e === null) continue;
      if (e <= s) continue;
      out.push([s, e]);
    }
    return out;
  }

  /** Percent positions of a day's open windows over a 24h bar. */
  dayBarSegments(key: string): { left: number; width: number }[] {
    return this.dayWindows(key).map(([s, e]) => ({ left: (s / 1440) * 100, width: ((e - s) / 1440) * 100 }));
  }

  /** i18n key of what is wrong with a day's hours, or null when they are valid. */
  dayError(key: string): string | null {
    const d = this.openingHours[key];
    if (!d || d.closed) return null;
    const m = SettingsComponent.toMinutes;
    if (!d.hasBreak) {
      const [o, c] = [m(d.open), m(d.close)];
      return o === null || c === null || c <= o ? 'SETTINGS.OH_ERR_ORDER' : null;
    }
    const [mo, mc, eo, ec] = [m(d.morningOpen), m(d.morningClose), m(d.eveningOpen), m(d.eveningClose)];
    if (mo === null || mc === null || eo === null || ec === null || mc <= mo || ec <= eo) return 'SETTINGS.OH_ERR_ORDER';
    return eo < mc ? 'SETTINGS.OH_ERR_OVERLAP' : null;
  }

  hoursInvalid(): boolean {
    return this.daysOfWeek.some((d) => !!this.dayError(d.key));
  }

  openDaysCount(): number {
    return this.daysOfWeek.filter((d) => this.openingHours[d.key] && !this.openingHours[d.key].closed).length;
  }

  weeklyHours(): number {
    const minutes = this.daysOfWeek.reduce(
      (sum, d) => sum + this.dayWindows(d.key).reduce((a, [s, e]) => a + (e - s), 0),
      0,
    );
    return Math.round(minutes / 6) / 10;
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

  /** Which brand image is being dragged over ("logo" | "header"), for the drop highlight. */
  brandDrag = signal<'logo' | 'header' | null>(null);
  logoMeta = signal<{ name: string; w: number; h: number; size: string } | null>(null);
  headerMeta = signal<{ name: string; w: number; h: number; size: string } | null>(null);

  /** File name, pixel size and weight of a freshly chosen image, shown on its card until it is saved. */
  private setImageMeta(file: File, dataUrl: string, target: { set: (v: { name: string; w: number; h: number; size: string } | null) => void }): void {
    const size = file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;
    const img = new Image();
    img.onload = () => target.set({ name: file.name, w: img.naturalWidth, h: img.naturalHeight, size });
    img.onerror = () => target.set({ name: file.name, w: 0, h: 0, size });
    img.src = dataUrl;
  }

  onBrandDrag(e: DragEvent, kind: 'logo' | 'header'): void {
    e.preventDefault();
    this.brandDrag.set(kind);
  }

  onBrandDrop(e: DragEvent, kind: 'logo' | 'header'): void {
    e.preventDefault();
    this.brandDrag.set(null);
    const fake = { target: { files: e.dataTransfer?.files, value: '' } } as unknown as Event;
    if (kind === 'logo') this.onLogoSelected(fake);
    else this.onHeaderBackgroundSelected(fake);
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
        this.setImageMeta(file, e.target?.result as string, this.logoMeta);
      };
      reader.readAsDataURL(file);
      this.error.set(null);
    }
  }

  removeLogo() {
    this.logoFile = null;
    this.logoPreview.set(null);
    this.logoMeta.set(null);
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
    this.markDirty();
  }

  /** Index of the bank account awaiting delete confirmation. */
  bankToDelete = signal<number | null>(null);

  bankHue(name: string | null | undefined): number {
    let h = 0;
    for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }

  setBankType(acc: { account_type?: string | null }, type: string): void {
    acc.account_type = acc.account_type === type ? '' : type;
    this.markDirty();
  }

  confirmRemoveBank(index: number): void {
    this.removeBankAccount(index);
    this.bankToDelete.set(null);
    this.markDirty();
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
      this.setImageMeta(file, e.target?.result as string, this.headerMeta);
    };
    reader.readAsDataURL(file);
    this.error.set(null);
  }

  removeHeaderBackground() {
    this.headerBackgroundFile = null;
    this.headerBackgroundPreview.set(null);
    this.headerMeta.set(null);
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
    if (this.hoursInvalid()) {
      this.activeSection.set('hours');
      this.error.set(this.translate.instant('SETTINGS.OH_ERR_SAVE'));
      return;
    }
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
            this.logoMeta.set(null);
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
          this.headerMeta.set(null);
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
