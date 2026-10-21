import { HttpErrorResponse } from '@angular/common/http';
import { forkJoin, Observable } from 'rxjs';
import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import {
  ApiService,
  Shift,
  ShiftCreate,
  ShiftUpdate,
  ShiftBulkCreate,
  ShiftTemplate,
  PlannedVsActualRow,
  ScheduleComplianceWarning,
  User,
} from '../services/api.service';
import { SidebarComponent } from '../shared/sidebar.component';
import { AppSelectComponent, AppSelectOption } from '../shared/app-select.component';
import { ConfirmationModalComponent } from '../shared/confirmation-modal.component';
import { FocusFirstInputDirective } from '../shared/focus-first-input.directive';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../services/language.service';
import { PermissionService } from '../services/permission.service';
import { hueFromUserId, weekShiftCardBorderLeft } from './working-plan-shift-colors';
import { ApiErrorMessageService } from '../services/api-error-message.service';

interface TemplateDraft {
  key: number;
  id?: number;
  name: string;
  start_time: string;
  end_time: string;
  split: boolean;
  start_time2: string;
  end_time2: string;
}

/** One row in a calendar day cell: a real shift or the “+N more” overflow line. */
type CalendarShiftLineRow =
  | { text: string; userId: number; shift: Shift }
  | { text: string; userId: null; shift: null };

function getWeekRange(weekStart: Date): { from: string; to: string } {
  const d = new Date(weekStart);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    from: `${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())}`,
    to: `${sun.getFullYear()}-${pad(sun.getMonth() + 1)}-${pad(sun.getDate())}`,
  };
}

/** First and last date of the month (YYYY-MM-DD). */
function getMonthRange(month: Date): { from: string; to: string } {
  const d = new Date(month.getFullYear(), month.getMonth(), 1);
  const first = new Date(d);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    from: `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(first.getDate())}`,
    to: `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`,
  };
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/** Staff role keys used in opening hours (personnel required per day). */
const STAFF_KEYS = ['waiter', 'kitchen'] as const;
type StaffKey = (typeof STAFF_KEYS)[number];

interface DayHours {
  open: string;
  close: string;
  closed?: boolean;
  hasBreak?: boolean;
  morningOpen?: string;
  morningClose?: string;
  eveningOpen?: string;
  eveningClose?: string;
  waiter?: number;
  kitchen?: number;
}

/** Map API user role to opening-hours staff key; null for owner (no single role). */
function roleToStaffKey(role: string | undefined): StaffKey | null {
  const r = (role ?? '').toLowerCase();
  return r === 'waiter' || r === 'kitchen' ? r : null;
}

/** True if the API user_role (e.g. waiter) matches the given staff key. */
function shiftRoleMatchesStaffKey(userRole: string | undefined, staffKey: StaffKey): boolean {
  const key = roleToStaffKey(userRole ?? '');
  return key === staffKey;
}

/** Step in minutes for time options (30 or 60). */
const STEP_30 = 30;
const STEP_60 = 60;

/** Default time options when no opening hours (09:00–22:00). Step 30 or 60 min. */
function defaultTimeOptions(stepMin: number = STEP_30): string[] {
  const opts: string[] = [];
  for (let h = 9; h <= 22; h++) {
    for (let m = 0; m < 60; m += stepMin) {
      if (h === 22 && m > 0) break;
      opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return opts;
}

/** Build time options from open to close (inclusive). Step 30 or 60 min. */
function timeOptionsBetween(open: string, close: string, stepMin: number = STEP_30): string[] {
  const [openH, openM] = open.split(':').map(Number);
  const [closeH, closeM] = close.split(':').map(Number);
  const openMins = openH * 60 + openM;
  const closeMins = closeH * 60 + closeM;
  const opts: string[] = [];
  for (let m = openMins; m <= closeMins; m += stepMin) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    opts.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return opts;
}

/** Full-day time options (00:00–23:00 or 23:30) for "any hour" e.g. cleaning. Step 30 or 60 min. */
function fullDayTimeOptions(stepMin: number = STEP_30): string[] {
  const opts: string[] = [];
  const maxMins = stepMin === STEP_60 ? 23 * 60 : 23 * 60 + 30;
  for (let m = 0; m <= maxMins; m += stepMin) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    opts.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return opts;
}

const WORKING_PLAN_VIEW_KEY = 'workingPlanView';
/** Persist open state of the planned-vs-clocked disclosure (default collapsed). */
const WORKING_PLAN_PVA_OPEN_KEY = 'workingPlanPvaOpen';
const VALID_VIEWS = ['week', 'calendar'] as const;
type ViewMode = (typeof VALID_VIEWS)[number];

/** Weekday checkboxes for bulk month (Mon–Sun); values match Date.getDay() (Sun=0). */
const BULK_WEEKDAY_OPTS: { js: number; labelKey: string }[] = [
  { js: 1, labelKey: 'WORKING_PLAN.MON' },
  { js: 2, labelKey: 'WORKING_PLAN.TUE' },
  { js: 3, labelKey: 'WORKING_PLAN.WED' },
  { js: 4, labelKey: 'WORKING_PLAN.THU' },
  { js: 5, labelKey: 'WORKING_PLAN.FRI' },
  { js: 6, labelKey: 'WORKING_PLAN.SAT' },
  { js: 0, labelKey: 'WORKING_PLAN.SUN' },
];

function isValidView(v: string | null): v is ViewMode {
  return v === 'week' || v === 'calendar';
}

@Component({
  selector: 'app-working-plan',
  standalone: true,
  imports: [FormsModule, SidebarComponent, TranslateModule, ConfirmationModalComponent, FocusFirstInputDirective, AppSelectComponent],
  template: `
    <app-sidebar>
      <div class="working-plan-page" data-testid="working-plan-page">
      <div class="page-header">
        <h1>{{ 'WORKING_PLAN.TITLE' | translate }}</h1>
        <div class="page-header-actions">
        <button type="button" class="btn btn-secondary" (click)="openBulkMonth()" data-testid="working-plan-bulk-month">
          {{ 'WORKING_PLAN.BULK_MONTH' | translate }}
        </button>
        @if (viewMode() === 'week') {
          <button
            type="button"
            class="btn btn-secondary"
            (click)="copyWeekToNextWeek()"
            [disabled]="copyWeekSaving()"
            data-testid="working-plan-copy-week"
          >
            {{ copyWeekSaving() ? ('COMMON.LOADING' | translate) : ('WORKING_PLAN.COPY_WEEK' | translate) }}
          </button>
        }
        <button type="button" class="btn btn-primary" (click)="openCreate()" data-testid="working-plan-add-shift">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          {{ 'WORKING_PLAN.ADD_SHIFT' | translate }}
        </button>
        </div>
      </div>

      <div class="filters">
        <div class="view-toggle" data-testid="working-plan-view-toggle">
          <button type="button" class="btn btn-ghost btn-sm" [class.active]="viewMode() === 'week'" (click)="setViewMode('week')" data-testid="working-plan-view-week">{{ 'WORKING_PLAN.VIEW_WEEK' | translate }}</button>
          <button type="button" class="btn btn-ghost btn-sm" [class.active]="viewMode() === 'calendar'" (click)="setViewMode('calendar')" data-testid="working-plan-view-calendar">{{ 'WORKING_PLAN.VIEW_CALENDAR' | translate }}</button>
        </div>
        @if (viewMode() === 'week') {
          <div class="view-toggle wp-layout-toggle" data-testid="working-plan-layout-toggle">
            <button type="button" class="btn btn-ghost btn-sm" [class.active]="weekLayout() === 'grid'" (click)="setWeekLayout('grid')">{{ 'WORKING_PLAN.LAYOUT_GRID' | translate }}</button>
            <button type="button" class="btn btn-ghost btn-sm" [class.active]="weekLayout() === 'list'" (click)="setWeekLayout('list')">{{ 'WORKING_PLAN.LAYOUT_LIST' | translate }}</button>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" (click)="prevWeek()">‹</button>
          <span class="week-label">{{ weekLabel() }}</span>
          <button type="button" class="btn btn-ghost btn-sm" (click)="nextWeek()">›</button>
        } @else {
          <button type="button" class="btn btn-ghost btn-sm" (click)="prevMonth()">‹</button>
          <span class="week-label">{{ calendarMonthLabel() }}</span>
          <button type="button" class="btn btn-ghost btn-sm" (click)="nextMonth()">›</button>
        }
        <button type="button" class="btn btn-ghost btn-sm" (click)="goToToday()">{{ 'WORKING_PLAN.TODAY' | translate }}</button>
        <button type="button" class="btn btn-ghost btn-sm" (click)="load()">{{ 'ORDERS.REFRESH' | translate }}</button>
        <span class="export-sep" aria-hidden="true"></span>
        <label class="export-label" for="working-plan-staff-scope">{{ 'WORKING_PLAN.STAFF_FILTER_LABEL' | translate }}</label>
        <select
          id="working-plan-staff-scope"
          class="export-worker-select"
          [ngModel]="exportUserId()"
          (ngModelChange)="onExportUserIdSelected($event)"
          [disabled]="!scheduleUsers().length"
          data-testid="working-plan-export-worker"
        >
          @if (!scheduleUsers().length) {
            <option [ngValue]="null">{{ 'WORKING_PLAN.EXPORT_NO_STAFF_OPTION' | translate }}</option>
          } @else {
            <option [ngValue]="null">{{ 'WORKING_PLAN.ALL_STAFF_OPTION' | translate }}</option>
            @for (u of scheduleUsers(); track u.id) {
              <option [ngValue]="u.id">{{ u.full_name || u.username }} ({{ getRoleLabel(u.role) }})</option>
            }
          }
        </select>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          (click)="exportExcel()"
          [disabled]="exportUserId() == null || exportLoading() || !scheduleUsers().length"
          data-testid="working-plan-export-excel"
        >
          {{ exportLoading() ? ('COMMON.LOADING' | translate) : ('WORKING_PLAN.EXPORT_EXCEL' | translate) }}
        </button>
      </div>
      @if (scheduleUsers().length) {
        <p class="export-hint">{{ 'WORKING_PLAN.STAFF_FILTER_HINT' | translate: { month: exportMonthLabel() } }}</p>
      } @else {
        <p class="export-hint export-hint-muted">{{ 'WORKING_PLAN.EXPORT_NO_STAFF_HINT' | translate }}</p>
      }

      @if (complianceWarnings().length) {
        <div class="compliance-banner" role="alert" data-testid="working-plan-compliance">
          <strong>{{ 'WORKING_PLAN.COMPLIANCE_TITLE' | translate }}</strong>
          <ul class="compliance-list">
            @for (w of complianceWarnings(); track $index) {
              <li>{{ complianceWarningText(w) }}</li>
            }
          </ul>
        </div>
      }

      @if (showPvaSection()) {
        <section class="pva-section" data-testid="working-plan-pva">
          <button
            type="button"
            class="pva-disclosure-trigger"
            (click)="togglePvaSection()"
            [attr.aria-expanded]="pvaSectionOpen()"
            data-testid="working-plan-pva-toggle"
          >
            {{ pvaSectionOpen() ? ('WORKING_PLAN.PVA_HIDE' | translate) : ('WORKING_PLAN.PVA_SHOW' | translate) }}
          </button>
          @if (pvaSectionOpen()) {
            <div class="pva-disclosure-body">
              <p class="pva-hint">{{ 'WORKING_PLAN.PLANNED_VS_ACTUAL_HINT' | translate }}</p>
              <div class="pva-toolbar">
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  (click)="exportPvaExcel()"
                  [disabled]="exportPvaLoading() || !plannedVsActualDisplayed().length"
                  data-testid="working-plan-pva-export-excel"
                >
                  {{ exportPvaLoading() ? ('COMMON.LOADING' | translate) : ('WORKING_PLAN.EXPORT_PVA_EXCEL' | translate) }}
                </button>
              </div>
              @if (plannedVsActualDisplayed().length) {
                <div class="pva-table-wrap">
                  <table class="pva-table">
                    <thead>
                      <tr>
                        <th>{{ 'WORKING_PLAN.PVA_COL_DATE' | translate }}</th>
                        <th>{{ 'WORKING_PLAN.PVA_COL_STAFF' | translate }}</th>
                        <th>{{ 'WORKING_PLAN.PVA_COL_PLANNED' | translate }}</th>
                        <th>{{ 'WORKING_PLAN.PVA_COL_CLOCKED' | translate }}</th>
                        <th>{{ 'WORKING_PLAN.PVA_COL_VARIANCE' | translate }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (r of plannedVsActualDisplayed(); track r.date + '-' + r.user_id) {
                        <tr>
                          <td>{{ r.date }}</td>
                          <td>{{ r.user_name }}</td>
                          <td>{{ formatMinutes(r.planned_minutes) }}</td>
                          <td>{{ formatMinutes(r.actual_minutes) }}</td>
                          <td [class.pva-var-pos]="r.variance_minutes > 0" [class.pva-var-neg]="r.variance_minutes < 0">
                            {{ formatSignedMinutes(r.variance_minutes) }}
                          </td>
                        </tr>
                      }
                    </tbody>
                    <tfoot>
                      <tr class="pva-totals-row">
                        <td>{{ 'WORKING_PLAN.PVA_TOTALS' | translate }}</td>
                        <td></td>
                        <td>{{ formatMinutes(pvaTotals().planned_minutes) }}</td>
                        <td>{{ formatMinutes(pvaTotals().actual_minutes) }}</td>
                        <td
                          [class.pva-var-pos]="pvaTotals().variance_minutes > 0"
                          [class.pva-var-neg]="pvaTotals().variance_minutes < 0"
                        >
                          {{ formatSignedMinutes(pvaTotals().variance_minutes) }}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              } @else {
                <p class="pva-empty-filtered">{{ 'WORKING_PLAN.PVA_EMPTY_FILTERED' | translate }}</p>
              }
            </div>
          }
        </section>
      }

      @if (viewMode() === 'calendar') {
        <div class="calendar-section" data-testid="working-plan-calendar-section">
          @if (loading()) {
            <div class="empty-state"><p>{{ 'COMMON.LOADING' | translate }}</p></div>
          } @else {
          <p class="calendar-legend">{{ 'WORKING_PLAN.CALENDAR_LEGEND' | translate }}</p>
          <div class="calendar-grid" data-testid="working-plan-calendar-grid">
            <div class="calendar-row calendar-header">
              @for (wd of weekdayLabels(); track wd) {
                <div class="calendar-cell calendar-cell-header">{{ wd }}</div>
              }
            </div>
            @for (row of calendarGrid(); track row.weekIndex) {
              <div class="calendar-row">
                @for (cell of row.days; track cell.trackId) {
                  <div
                    class="calendar-cell"
                    [class.calendar-cell-empty]="!cell.day"
                    [class.calendar-cell-closed]="cell.isClosed"
                    [class.calendar-day-matches]="cell.hasIssue"
                    [class.calendar-day-ok]="cell.showOk"
                  >
                    @if (cell.day) {
                      <span class="calendar-day-num">{{ cell.day }}</span>
                      @if (cell.isClosed) {
                        <span class="calendar-closed-label">{{ 'WORKING_PLAN.CLOSED_DAY' | translate }}</span>
                      }
                      @if (cell.shiftLines?.length) {
                        <ul class="calendar-shift-lines">
                          @for (line of cell.shiftLines; track calendarShiftLineTrack(line, $index)) {
                            @if (line.shift) {
                              @if (canEditShift(line.shift)) {
                                <li
                                  class="calendar-shift-line-row"
                                  [style.--wp-shift-h]="shiftHue(line.userId)"
                                  data-testid="working-plan-calendar-shift-line"
                                >
                                  <button
                                    type="button"
                                    class="calendar-shift-line calendar-shift-line--btn"
                                    (click)="openEdit(line.shift)"
                                    [attr.aria-label]="calendarShiftEditAria(line.shift)"
                                  >
                                    {{ line.text }}
                                  </button>
                                  <button
                                    type="button"
                                    class="calendar-shift-line-delete"
                                    (click)="onCalendarShiftDeleteClick($event, line.shift)"
                                    [attr.aria-label]="calendarShiftDeleteAria(line.shift)"
                                    data-testid="working-plan-calendar-shift-delete"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                                      <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                    </svg>
                                  </button>
                                </li>
                              } @else {
                                <li
                                  class="calendar-shift-line"
                                  [style.--wp-shift-h]="shiftHue(line.userId)"
                                  data-testid="working-plan-calendar-shift-line"
                                >
                                  {{ line.text }}
                                </li>
                              }
                            } @else {
                              <li class="calendar-shift-line-overflow" data-testid="working-plan-calendar-shift-overflow">
                                {{ line.text }}
                              </li>
                            }
                          }
                        </ul>
                      }
                    }
                  </div>
                }
              </div>
            }
          </div>
          }
        </div>
      }

      @if (viewMode() === 'week') {
        @if (loading()) {
          <div class="empty-state"><p>{{ 'COMMON.LOADING' | translate }}</p></div>
        } @else if (shifts().length === 0 && weekLayout() === 'list') {
          <div class="empty-state">
            <p>{{ 'WORKING_PLAN.NO_SHIFTS' | translate }}</p>
            <button class="btn btn-primary" (click)="openCreate()">{{ 'WORKING_PLAN.ADD_SHIFT' | translate }}</button>
          </div>
        } @else if (weekLayout() === 'grid') {
          <!-- Shift templates: pick one, then click cells to apply it -->
          @if (canWriteSchedule() && templates().length) {
            <div class="wp-templates" data-testid="working-plan-templates">
              <span class="wp-templates-title">{{ 'WORKING_PLAN.TEMPLATES_TITLE' | translate }}</span>
              @for (t of templates(); track t.id; let i = $index) {
                <button type="button" class="wp-tpl" [class.on]="armedTemplateId() === t.id" [style.--wp-h]="templateHue(i)"
                  (click)="toggleTemplate(t)" [attr.aria-pressed]="armedTemplateId() === t.id">
                  <span class="wp-tpl-dot"></span>
                  <span class="wp-tpl-name">{{ t.name }}</span>
                  <small>{{ templateRangeLabel(t) }}</small>
                </button>
              }
              @if (canManageAllSchedules()) {
                <button type="button" class="wp-tpl-manage" (click)="openTemplates()">{{ 'WORKING_PLAN.TEMPLATES_MANAGE' | translate }}</button>
              }
              @if (armedTemplate(); as at) {
                <span class="wp-tpl-hint">{{ 'WORKING_PLAN.TEMPLATES_ARMED_HINT' | translate: { name: at.name } }}</span>
              } @else {
                <span class="wp-tpl-hint wp-muted">{{ 'WORKING_PLAN.TEMPLATES_PICK_HINT' | translate }}</span>
              }
            </div>
          }

          <!-- Week summary -->
          <div class="wp-kpis" data-testid="working-plan-kpis">
            <div class="wp-kpi">
              <span class="wp-kpi-label">{{ 'WORKING_PLAN.KPI_HOURS' | translate }}</span>
              <strong>{{ formatMinutes(weekStats().totalMinutes) }}</strong>
            </div>
            <div class="wp-kpi">
              <span class="wp-kpi-label">{{ 'WORKING_PLAN.KPI_PEOPLE' | translate }}</span>
              <strong>{{ weekStats().people }}</strong>
            </div>
            <div class="wp-kpi" [class.wp-kpi-ok]="weekStats().gapDays === 0 && weekStats().requirementDays > 0" [class.wp-kpi-warn]="weekStats().gapDays > 0">
              <span class="wp-kpi-label">{{ 'WORKING_PLAN.KPI_COVERAGE' | translate }}</span>
              <strong>
                @if (weekStats().requirementDays === 0) { — } @else { {{ weekStats().requirementDays - weekStats().gapDays }}/{{ weekStats().requirementDays }} }
              </strong>
              <small>{{ 'WORKING_PLAN.KPI_COVERAGE_HINT' | translate }}</small>
            </div>
            <div class="wp-kpi" [class.wp-kpi-warn]="weekStats().emptyDays > 0">
              <span class="wp-kpi-label">{{ 'WORKING_PLAN.KPI_EMPTY_DAYS' | translate }}</span>
              <strong>{{ weekStats().emptyDays }}</strong>
            </div>
          </div>

          <div class="wp-grid-scroll">
            <div class="wp-grid" data-testid="working-plan-week-grid">
              <div class="wp-row wp-head">
                <div class="wp-cell wp-name-cell"></div>
                @for (d of weekDays(); track d.date) {
                  <div class="wp-cell wp-day-head" [class.wp-today]="d.isToday" [class.wp-closed]="d.closed">
                    <span class="wp-dow">{{ d.dow }}</span>
                    <span class="wp-dom">{{ d.dom }}</span>
                    @if (d.closed) { <small>{{ 'WORKING_PLAN.CLOSED_DAY' | translate }}</small> }
                  </div>
                }
                <div class="wp-cell wp-total-head">{{ 'WORKING_PLAN.COL_TOTAL' | translate }}</div>
              </div>

              @for (row of weekGrid(); track row.id) {
                <div class="wp-row">
                  <div class="wp-cell wp-name-cell">
                    <span class="wp-avatar" [style.--wp-h]="shiftHue(row.id)">{{ (row.user.full_name || row.user.username || '?').charAt(0).toUpperCase() }}</span>
                    <span class="wp-person">
                      <b>{{ row.user.full_name || row.user.username }}</b>
                      <small>{{ getRoleLabel(row.user.role) }}</small>
                    </span>
                  </div>
                  @for (c of row.days; track c.date) {
                    <div class="wp-cell wp-day-cell" [class.wp-today]="c.isToday" [class.wp-closed]="c.closed">
                      @for (sh of c.shifts; track sh.id) {
                        @if (canEditShift(sh)) {
                          <button type="button" class="wp-chip" [style.--wp-h]="shiftHue(row.id)" (click)="openEdit(sh)" [attr.aria-label]="calendarShiftEditAria(sh)">
                            <span class="wp-chip-time">{{ sh.start_time }}–{{ sh.end_time }}</span>
                            @if (sh.label) { <span class="wp-chip-label">{{ sh.label }}</span> }
                          </button>
                        } @else {
                          <div class="wp-chip wp-chip-static" [style.--wp-h]="shiftHue(row.id)">
                            <span class="wp-chip-time">{{ sh.start_time }}–{{ sh.end_time }}</span>
                            @if (sh.label) { <span class="wp-chip-label">{{ sh.label }}</span> }
                          </div>
                        }
                      }
                      @if (canAddFor(row.id) && !c.closed) {
                        <button type="button" class="wp-add" [class.wp-add-armed]="armedTemplate()" (click)="onCellAdd(row.id, c.date)"
                          [attr.aria-label]="'WORKING_PLAN.ADD_SHIFT' | translate" [title]="(armedTemplate() ? armedTemplate()!.name : ('WORKING_PLAN.ADD_SHIFT' | translate))">{{ armedTemplate() ? '✓' : '+' }}</button>
                      }
                    </div>
                  }
                  <div class="wp-cell wp-total-cell">{{ row.totalMinutes ? formatMinutes(row.totalMinutes) : '—' }}</div>
                </div>
              }

              <!-- Coverage + hours per day -->
              <div class="wp-row wp-foot">
                <div class="wp-cell wp-name-cell"><b>{{ 'WORKING_PLAN.COVERAGE_ROW' | translate }}</b></div>
                @for (d of weekDays(); track d.date) {
                  <div class="wp-cell wp-foot-cell" [class.wp-today]="d.isToday" [class.wp-closed]="d.closed">
                    @if (d.closed) {
                      <span class="wp-muted">—</span>
                    } @else {
                      @for (cv of d.coverage; track cv.key) {
                        <span class="wp-cov" [class.wp-cov-ok]="cv.state === 'ok'" [class.wp-cov-low]="cv.state === 'low'" [class.wp-cov-high]="cv.state === 'high'">
                          {{ cv.label }} {{ cv.scheduled }}/{{ cv.required }}
                        </span>
                      }
                      <span class="wp-day-hours">{{ d.minutes ? formatMinutes(d.minutes) : '—' }}</span>
                    }
                  </div>
                }
                <div class="wp-cell wp-total-cell"><b>{{ formatMinutes(weekStats().totalMinutes) }}</b></div>
              </div>
            </div>
          </div>
        } @else {
          <div class="shift-list">
            @for (s of shiftsByDate(); track s.id) {
              <div class="shift-card" [style.border-left]="weekShiftBorder(s.user_id)">
                <div class="shift-date">{{ s.date }}</div>
                <div class="shift-details">
                  <span class="shift-time">{{ s.start_time }} – {{ s.end_time }}</span>
                  @if (s.label) {
                    <span class="shift-label">{{ s.label }}</span>
                  }
                  <span class="shift-user">{{ s.user_name }} ({{ getRoleLabel(s.user_role) }})</span>
                </div>
                <div class="shift-actions">
                  @if (canEditShift(s)) {
                    <button class="btn btn-ghost btn-sm" (click)="openEdit(s)">{{ 'COMMON.EDIT' | translate }}</button>
                    <button class="btn btn-ghost btn-sm danger" (click)="confirmDelete(s)">{{ 'COMMON.DELETE' | translate }}</button>
                  }
                </div>
              </div>
            }
          </div>
        }
      }

      @if (showBulkModal()) {
        <div class="modal-overlay">
          <div class="modal-content modal-content-wide" (click)="$event.stopPropagation()" appFocusFirstInput>
            <div class="modal-header">
              <h3>{{ 'WORKING_PLAN.BULK_MONTH_TITLE' | translate }}</h3>
              <button type="button" class="close-btn" (click)="closeBulkModal()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div class="modal-body">
              <p class="bulk-month-scope">{{ 'WORKING_PLAN.BULK_MONTH_SCOPE' | translate: { month: bulkMonthLabel() } }}</p>
              <div class="form-group">
                <label for="bulk-user">{{ 'WORKING_PLAN.USER' | translate }}</label>
                <select id="bulk-user" [(ngModel)]="bulkUserId" [disabled]="!assignableScheduleUsers().length">
                  <option [ngValue]="null">{{ 'WORKING_PLAN.SELECT_USER' | translate }}</option>
                  @for (u of assignableScheduleUsers(); track u.id) {
                    <option [ngValue]="u.id">{{ u.full_name || u.username }} ({{ getRoleLabel(u.role) }})</option>
                  }
                </select>
              </div>
              <div class="form-group">
                <span class="bulk-section-label">{{ 'WORKING_PLAN.BULK_WEEKDAYS' | translate }}</span>
                <div class="bulk-weekdays">
                  @for (w of bulkWeekdayOpts; track w.js) {
                    <label class="bulk-wd">
                      <input type="checkbox" [checked]="bulkWeekdays().has(w.js)" (change)="toggleBulkWeekday(w.js)" />
                      {{ w.labelKey | translate }}
                    </label>
                  }
                </div>
              </div>
              <div class="form-group">
                <label>{{ 'WORKING_PLAN.TIME_STEP' | translate }}</label>
                <select [(ngModel)]="bulkTimeStep" (ngModelChange)="onBulkTimeOptionsChange()">
                  <option [ngValue]="30">{{ 'WORKING_PLAN.TIME_STEP_30' | translate }}</option>
                  <option [ngValue]="60">{{ 'WORKING_PLAN.TIME_STEP_1H' | translate }}</option>
                </select>
              </div>
              <div class="form-group form-group-checkbox">
                <label>
                  <input type="checkbox" [(ngModel)]="bulkUseAnyHour" (ngModelChange)="onBulkTimeOptionsChange()" />
                  {{ 'WORKING_PLAN.USE_ANY_HOUR' | translate }}
                </label>
              </div>
              <div class="form-group">
                <label>{{ 'WORKING_PLAN.START_TIME' | translate }}</label>
                <select [(ngModel)]="bulkStartTime">
                  @for (t of timeOptsForBulk(); track t) {
                    <option [value]="t">{{ t }}</option>
                  }
                </select>
              </div>
              <div class="form-group">
                <label>{{ 'WORKING_PLAN.END_TIME' | translate }}</label>
                <select [(ngModel)]="bulkEndTime">
                  @for (t of timeOptsForBulk(); track t) {
                    <option [value]="t">{{ t }}</option>
                  }
                </select>
              </div>
              <div class="form-group">
                <label>{{ 'WORKING_PLAN.LABEL' | translate }}</label>
                <input type="text" [(ngModel)]="bulkLabel" placeholder="{{ 'WORKING_PLAN.LABEL_PLACEHOLDER' | translate }}" />
              </div>
              <div class="form-group form-group-checkbox">
                <label>
                  <input type="checkbox" [(ngModel)]="bulkSkipExisting" />
                  {{ 'WORKING_PLAN.BULK_SKIP_EXISTING' | translate }}
                </label>
                <span class="form-hint">{{ 'WORKING_PLAN.BULK_SKIP_EXISTING_HINT' | translate }}</span>
              </div>
              @if (bulkFormError()) {
                <div class="form-error">{{ bulkFormError() }}</div>
              }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-ghost" (click)="closeBulkModal()">{{ 'COMMON.CANCEL' | translate }}</button>
              <button type="button" class="btn btn-primary" (click)="saveBulkMonth()" [disabled]="bulkSaving()">{{ bulkSaving() ? ('COMMON.LOADING' | translate) : ('WORKING_PLAN.BULK_APPLY' | translate) }}</button>
            </div>
          </div>
        </div>
      }

      @if (showModal()) {
        <div class="modal-overlay">
          <div class="modal-content wpm" (click)="$event.stopPropagation()" appFocusFirstInput>
            <div class="wpm-head">
              <span class="wpm-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M12 14v3l2 1"/></svg></span>
              <div class="wpm-head-text">
                <h3>{{ editingShift() ? ('WORKING_PLAN.EDIT_SHIFT' | translate) : ('WORKING_PLAN.ADD_SHIFT' | translate) }}</h3>
                <p>{{ formDateLabel() }}</p>
              </div>
              <button type="button" class="wpm-close" (click)="closeModal()" [attr.aria-label]="'COMMON.CANCEL' | translate">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div class="wpm-body">
              @if (!editingShift() && templates().length) {
                <section class="wpm-sec">
                  <h4>{{ 'WORKING_PLAN.FORM_QUICK' | translate }}</h4>
                  <div class="wpm-quick">
                    @for (t of templates(); track t.id; let i = $index) {
                      <button type="button" class="wp-tpl" [style.--wp-h]="templateHue(i)" (click)="applyTemplateToForm(t)">
                        <span class="wp-tpl-dot"></span>
                        <span class="wp-tpl-name">{{ t.name }}</span>
                        <small>{{ templateRangeLabel(t) }}</small>
                      </button>
                    }
                  </div>
                </section>
              }

              <section class="wpm-sec">
                <h4>{{ 'WORKING_PLAN.FORM_WHO_WHEN' | translate }}</h4>
                <div class="wpm-grid">
                  <div class="wpm-field">
                    <label>{{ 'WORKING_PLAN.USER' | translate }}</label>
                    <app-select
                      name="shift-user"
                      [(ngModel)]="formUserId"
                      [options]="userOptions()"
                      [placeholder]="'WORKING_PLAN.SELECT_USER' | translate"
                      [searchable]="false"
                      [emptyValue]="null"
                      [disabled]="!assignableScheduleUsers().length || !canManageAllSchedules()" />
                  </div>
                  <div class="wpm-field">
                    <label>{{ 'WORKING_PLAN.DATE' | translate }}</label>
                    <input type="date" [(ngModel)]="formDate" (ngModelChange)="onFormDateChange($event)" />
                  </div>
                </div>
              </section>

              <section class="wpm-sec">
                <h4>
                  {{ formSplitShift && !editingShift() ? ('WORKING_PLAN.SHIFT_BLOCK_A' | translate) : ('WORKING_PLAN.FORM_HOURS' | translate) }}
                  <span class="wpm-duration">{{ blockDurationLabel(formStartTime, formEndTime) }}</span>
                </h4>
                <div class="wpm-grid">
                  <div class="wpm-field">
                    <label>{{ 'WORKING_PLAN.START_TIME' | translate }}</label>
                    <select [(ngModel)]="formStartTime" (ngModelChange)="onFormBlock1TimesChange()">
                      @for (t of timeOptsForSelectedDay(); track t) {
                        <option [value]="t">{{ t }}</option>
                      }
                    </select>
                  </div>
                  <div class="wpm-field">
                    <label>{{ 'WORKING_PLAN.END_TIME' | translate }}</label>
                    <select [(ngModel)]="formEndTime" (ngModelChange)="onFormBlock1TimesChange()">
                      @for (t of timeOptsForSelectedDay(); track t) {
                        <option [value]="t">{{ t }}</option>
                      }
                    </select>
                  </div>
                </div>

                @if (!editingShift()) {
                  <label class="wpm-switch-card" [class.on]="formSplitShift">
                    <input type="checkbox" [(ngModel)]="formSplitShift" (ngModelChange)="onSplitShiftChange($event)" />
                    <span class="wpm-switch" aria-hidden="true"></span>
                    <span class="wpm-switch-text">
                      <b>{{ 'WORKING_PLAN.SPLIT_SHIFT' | translate }}</b>
                      <small>{{ 'WORKING_PLAN.SPLIT_SHIFT_HINT' | translate }}</small>
                    </span>
                  </label>
                }

                @if (formSplitShift && !editingShift()) {
                  <h4 class="wpm-sub">
                    {{ 'WORKING_PLAN.SHIFT_BLOCK_B' | translate }}
                    <span class="wpm-duration">{{ blockDurationLabel(formStartTime2, formEndTime2) }}</span>
                  </h4>
                  @if (!timeOptsForBlock2Start().length) {
                    <p class="form-error">{{ 'WORKING_PLAN.SPLIT_ERR_NO_ROOM' | translate }}</p>
                  }
                  <div class="wpm-grid">
                    <div class="wpm-field">
                      <label>{{ 'WORKING_PLAN.START_TIME' | translate }}</label>
                      <select [(ngModel)]="formStartTime2" (ngModelChange)="onFormBlock2TimesChange()">
                        @for (t of timeOptsForBlock2Start(); track t) {
                          <option [value]="t">{{ t }}</option>
                        }
                      </select>
                    </div>
                    <div class="wpm-field">
                      <label>{{ 'WORKING_PLAN.END_TIME' | translate }}</label>
                      <select [(ngModel)]="formEndTime2" (ngModelChange)="onFormBlock2TimesChange()">
                        @for (t of timeOptsForBlock2End(); track t) {
                          <option [value]="t">{{ t }}</option>
                        }
                      </select>
                    </div>
                  </div>
                }

                <details class="wpm-more">
                  <summary>{{ 'WORKING_PLAN.FORM_TIME_OPTIONS' | translate }}</summary>
                  <div class="wpm-grid">
                    <div class="wpm-field">
                      <label>{{ 'WORKING_PLAN.TIME_STEP' | translate }}</label>
                      <select [(ngModel)]="formTimeStep" (ngModelChange)="onTimeOptionsChange()">
                        <option [ngValue]="30">{{ 'WORKING_PLAN.TIME_STEP_30' | translate }}</option>
                        <option [ngValue]="60">{{ 'WORKING_PLAN.TIME_STEP_1H' | translate }}</option>
                      </select>
                    </div>
                    <label class="wpm-check">
                      <input type="checkbox" [(ngModel)]="formUseAnyHour" (ngModelChange)="onTimeOptionsChange()" />
                      <span>
                        {{ 'WORKING_PLAN.USE_ANY_HOUR' | translate }}
                        <small>{{ 'WORKING_PLAN.USE_ANY_HOUR_HINT' | translate }}</small>
                      </span>
                    </label>
                  </div>
                </details>
              </section>

              <section class="wpm-sec">
                <h4>{{ 'WORKING_PLAN.LABEL' | translate }}</h4>
                <input type="text" class="wpm-input" [(ngModel)]="formLabel" placeholder="{{ 'WORKING_PLAN.LABEL_PLACEHOLDER' | translate }}" />
              </section>

              @if (formError()) {
                <div class="form-error wpm-error">{{ formError() }}</div>
              }
            </div>

            <div class="wpm-foot">
              <button type="button" class="wpm-btn wpm-btn-ghost" (click)="closeModal()">{{ 'COMMON.CANCEL' | translate }}</button>
              <button type="button" class="wpm-btn wpm-btn-main" (click)="saveShift()">{{ 'COMMON.SAVE' | translate }}</button>
            </div>
          </div>
        </div>
      }

      @if (showTemplates()) {
        <div class="modal-overlay">
          <div class="modal-content wp-tpl-modal" (click)="$event.stopPropagation()" appFocusFirstInput>
            <div class="modal-header">
              <h3>{{ 'WORKING_PLAN.TEMPLATES_MANAGE_TITLE' | translate }}</h3>
              <button type="button" class="close-btn" (click)="closeTemplates()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div class="modal-body">
              <p class="wp-tpl-help">{{ 'WORKING_PLAN.TEMPLATES_MANAGE_HELP' | translate }}</p>
              @for (d of templateDrafts(); track d.key; let i = $index) {
                <div class="wp-tpl-row" [style.--wp-h]="templateHue(i)">
                  <input type="text" class="wp-tpl-name-input" maxlength="40" [ngModel]="d.name" (ngModelChange)="patchDraft(d.key, { name: $event })"
                    [placeholder]="'WORKING_PLAN.TEMPLATE_NAME' | translate" />
                  <div class="wp-tpl-times">
                    <input type="time" [ngModel]="d.start_time" (ngModelChange)="patchDraft(d.key, { start_time: $event })" />
                    <span>–</span>
                    <input type="time" [ngModel]="d.end_time" (ngModelChange)="patchDraft(d.key, { end_time: $event })" />
                  </div>
                  @if (d.split) {
                    <div class="wp-tpl-times">
                      <input type="time" [ngModel]="d.start_time2" (ngModelChange)="patchDraft(d.key, { start_time2: $event })" />
                      <span>–</span>
                      <input type="time" [ngModel]="d.end_time2" (ngModelChange)="patchDraft(d.key, { end_time2: $event })" />
                    </div>
                  }
                  <label class="wp-tpl-split">
                    <input type="checkbox" [ngModel]="d.split" (ngModelChange)="patchDraft(d.key, { split: $event })" />
                    {{ 'WORKING_PLAN.TEMPLATE_SPLIT' | translate }}
                  </label>
                  <button type="button" class="wp-tpl-del" (click)="removeDraft(d.key)" [attr.aria-label]="'COMMON.DELETE' | translate">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
                </div>
              }
              <button type="button" class="wp-tpl-new" (click)="addDraft()">+ {{ 'WORKING_PLAN.TEMPLATE_NEW' | translate }}</button>
              @if (templatesError()) {
                <div class="form-error">{{ templatesError() }}</div>
              }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-ghost" (click)="closeTemplates()">{{ 'COMMON.CANCEL' | translate }}</button>
              <button type="button" class="btn btn-primary" (click)="saveTemplates()" [disabled]="templatesSaving()">
                {{ templatesSaving() ? ('COMMON.LOADING' | translate) : ('COMMON.SAVE' | translate) }}
              </button>
            </div>
          </div>
        </div>
      }

      @if (deleteTarget() !== null) {
        <app-confirmation-modal
          [title]="'WORKING_PLAN.DELETE_SHIFT' | translate"
          [message]="'WORKING_PLAN.DELETE_CONFIRM' | translate"
          [confirmText]="'COMMON.DELETE' | translate"
          [cancelText]="'COMMON.CANCEL' | translate"
          confirmBtnClass="btn-danger"
          (confirm)="doDelete()"
          (cancel)="deleteTarget.set(null)"
        />
      }

      @if (toast()) {
        <div class="toast" [class]="toast()!.type">
          <span>{{ toast()!.message }}</span>
          <button type="button" class="toast-close" (click)="dismissToast()" aria-label="Dismiss">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      }
      </div>
    </app-sidebar>
  `,
  styles: [`
    .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.75rem; }
    .page-header-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .filters { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.35rem; }
    .export-sep { width: 1px; height: 1.25rem; background: var(--border-color, #ddd); margin: 0 0.25rem; }
    .export-label { font-size: 0.875rem; color: var(--text-muted, #666); margin: 0; }
    .export-worker-select { min-width: 10rem; max-width: 14rem; padding: 0.35rem 0.5rem; border: 1px solid var(--border-color, #ccc); border-radius: 6px; font-size: 0.875rem; }
    .export-hint { font-size: 0.75rem; color: var(--text-muted, #666); margin: 0 0 1rem 0; }
    .export-hint-muted { font-style: italic; }
    .week-label { min-width: 12rem; font-weight: 500; }
    .empty-state { text-align: center; padding: 2rem; color: var(--text-muted, #666); }
    .empty-state .btn { margin-top: 0.5rem; }
    .shift-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .shift-card {
      display: flex; align-items: center; flex-wrap: wrap; gap: 0.75rem;
      padding: 0.75rem 1rem; background: var(--card-bg, #fff); border-radius: 8px;
      border: 1px solid var(--border-color, #eee);
    }
    .shift-date { font-weight: 600; min-width: 7rem; }
    .shift-details { display: flex; align-items: center; gap: 0.75rem; flex: 1; }
    .shift-time { color: var(--text-muted, #666); }
    .shift-label { font-size: 0.875rem; color: var(--text-muted, #666); }
    .shift-user { font-weight: 500; }
    .shift-actions { display: flex; gap: 0.25rem; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .modal-content { background: var(--card-bg, #fff); border-radius: 12px; max-width: 420px; width: 90%; max-height: 90vh; overflow: auto; }
    .modal-content-wide { max-width: 28rem; }
    .bulk-month-scope { font-size: 0.875rem; color: var(--text-muted, #666); margin: 0 0 1rem 0; }
    .bulk-section-label { display: block; margin-bottom: 0.35rem; font-weight: 500; font-size: 0.875rem; }
    .bulk-weekdays { display: flex; flex-wrap: wrap; gap: 0.35rem 0.75rem; }
    .bulk-wd { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.875rem; font-weight: normal; cursor: pointer; }
    .bulk-wd input { width: auto; margin: 0; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-color, #eee); }
    .modal-header h3 { margin: 0; font-size: 1.125rem; }
    .close-btn { background: none; border: none; cursor: pointer; padding: 0.25rem; }
    .modal-body { padding: 1.25rem; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; margin-bottom: 0.25rem; font-weight: 500; font-size: 0.875rem; }
    .form-group input, .form-group select { width: 100%; padding: 0.5rem; border: 1px solid var(--border-color, #ccc); border-radius: 6px; }
    .form-group-checkbox label { display: flex; align-items: center; gap: 0.5rem; font-weight: normal; }
    .form-group-checkbox input[type="checkbox"] { width: auto; }
    .form-hint { display: block; font-size: 0.75rem; color: var(--text-muted, #666); margin-top: 0.25rem; }
    .form-error { color: var(--danger, #c00); font-size: 0.875rem; margin-top: 0.5rem; }
    .modal-footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 1rem 1.25rem; border-top: 1px solid var(--border-color, #eee); }
    .toast {
      position: fixed; bottom: 1rem; right: 1rem;
      background: var(--card-bg, #fff); border-radius: 8px; padding: 0.75rem 1rem;
      box-shadow: 0 10px 25px rgba(0,0,0,0.15); display: flex; align-items: center; gap: 0.75rem; z-index: 3000; max-width: calc(100vw - 2rem);
    }
    .toast.success { border-left: 4px solid var(--color-success, #16a34a); }
    .toast.error { border-left: 4px solid var(--danger, #dc2626); }
    .toast-close { background: none; border: none; color: var(--text-muted, #666); cursor: pointer; padding: 0.25rem; }
    .toast-close:hover { color: var(--text, #111); }
    .view-toggle { display: flex; gap: 0.25rem; }
    .view-toggle .btn.active { background: var(--border-color, #eee); font-weight: 500; }
    .calendar-section { margin-bottom: 1.5rem; }
    .calendar-legend { font-size: 0.875rem; color: var(--text-muted, #666); margin: 0 0 0.5rem 0; }
    .calendar-grid { display: flex; flex-direction: column; gap: 2px; width: 100%; max-width: 100rem; }
    .calendar-row { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
    .calendar-cell {
      min-height: 7.75rem; display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start;
      border: 1px solid var(--border-color, #eee); border-radius: 6px;
      font-size: 0.875rem; min-width: 0; padding: 0.3rem 0.35rem; gap: 0.15rem;
    }
    .calendar-cell-header {
      font-weight: 600; background: var(--card-bg, #f8f8f8); aspect-ratio: auto; padding: 0.25rem 0;
      min-height: auto;
    }
    .calendar-cell-empty { background: var(--bg-muted, #f5f5f5); border-color: transparent; }
    .calendar-cell-closed:not(.calendar-day-matches) { background: var(--bg-muted, #ececec); color: var(--text-muted, #666); }
    .calendar-day-matches { background: rgba(220, 38, 38, 0.25); border-color: var(--danger, #dc2626); }
    .calendar-day-ok { background: rgba(22, 163, 74, 0.2); border-color: var(--color-success, #16a34a); }
    .calendar-day-num { font-weight: 600; flex-shrink: 0; }
    .calendar-closed-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.02em; opacity: 0.85; }
    .calendar-shift-lines { list-style: none; margin: 0; padding: 0; font-size: 0.65rem; line-height: 1.3; overflow: hidden; display: flex; flex-direction: column; gap: 0.12rem; }
    .calendar-shift-line {
      --shift-sat: 50%;
      --shift-soft: 40%;
      --shift-soft-a: 0.14;
      --shift-border-sat: 48%;
      --shift-border-light: 36%;
      --shift-text-sat: 34%;
      --shift-text-light: 17%;
      border-radius: 4px;
      padding: 0.1em 0.28em 0.1em 0.32em;
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      background: hsla(var(--wp-shift-h), var(--shift-sat), var(--shift-soft), var(--shift-soft-a));
      color: hsl(var(--wp-shift-h), var(--shift-text-sat), var(--shift-text-light));
      border-left: 3px solid hsl(var(--wp-shift-h), var(--shift-border-sat), var(--shift-border-light));
    }
    @media (prefers-color-scheme: dark) {
      .calendar-shift-line {
        --shift-soft: 52%;
        --shift-soft-a: 0.3;
        --shift-border-light: 64%;
        --shift-text-sat: 26%;
        --shift-text-light: 93%;
      }
    }
    .calendar-shift-line-row {
      display: flex;
      align-items: stretch;
      gap: 0.12rem;
      min-width: 0;
      margin: 0;
      list-style: none;
    }
    .calendar-shift-line--btn {
      border: none;
      font: inherit;
      cursor: pointer;
      text-align: left;
      flex: 1;
      min-width: 0;
    }
    .calendar-shift-line--btn:hover {
      filter: brightness(0.96);
    }
    .calendar-shift-line--btn:focus-visible {
      outline: 2px solid var(--focus-ring, #2563eb);
      outline-offset: 1px;
    }
    .calendar-shift-line-delete {
      flex-shrink: 0;
      align-self: center;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.1rem;
      border: none;
      border-radius: 3px;
      background: transparent;
      color: var(--danger, #dc2626);
      cursor: pointer;
      line-height: 0;
      opacity: 0.9;
    }
    .calendar-shift-line-delete:hover {
      opacity: 1;
      background: rgba(220, 38, 38, 0.12);
    }
    .calendar-shift-line-delete:focus-visible {
      outline: 2px solid var(--focus-ring, #2563eb);
      outline-offset: 1px;
    }
    .calendar-shift-line-overflow {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin: 0;
      padding: 0;
      color: var(--text-muted, #666);
      font-style: italic;
    }
    .compliance-banner {
      margin-bottom: 1rem;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--warning-border, #f59e0b);
      background: rgba(245, 158, 11, 0.1);
      font-size: 0.875rem;
    }
    .compliance-list { margin: 0.35rem 0 0 1rem; padding: 0; }
    .pva-section { margin-bottom: 1.5rem; }
    .pva-disclosure-trigger {
      display: flex; align-items: center; width: 100%; text-align: left;
      padding: 0.5rem 0.65rem; margin-bottom: 0.35rem;
      background: var(--card-bg, #f8f8f8); border: 1px solid var(--border-color, #eee); border-radius: 8px;
      font-weight: 600; font-size: 0.95rem; cursor: pointer; color: inherit;
    }
    .pva-disclosure-trigger:hover { filter: brightness(0.97); }
    .pva-disclosure-body { padding-top: 0.15rem; }
    .pva-toolbar { margin-bottom: 0.5rem; }
    .pva-hint { font-size: 0.75rem; color: var(--text-muted, #666); margin: 0 0 0.5rem 0; }
    .pva-table-wrap { overflow-x: auto; }
    .pva-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    .pva-table th, .pva-table td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--border-color, #eee); }
    .pva-table th { font-weight: 600; color: var(--text-muted, #666); }
    .pva-totals-row td { font-weight: 600; border-top: 2px solid var(--border-color, #ddd); border-bottom: none; }
    .pva-empty-filtered { font-size: 0.875rem; color: var(--text-muted, #666); margin: 0 0 0.5rem 0; }
    .pva-var-pos { color: var(--color-success, #16a34a); }
    .pva-var-neg { color: var(--danger, #dc2626); }

    /* ===== Plan de trabajo: rediseño ===== */
    .page-header h1 { font-size: 1.75rem; font-weight: 800; letter-spacing: -0.01em; margin: 0; }
    .page-header-actions .btn { border-radius: 999px; font-weight: 700; min-height: 42px; padding: 0 18px; }
    .page-header-actions .btn-primary { box-shadow: 0 8px 18px -8px var(--color-primary); }
    .filters {
      padding: 8px 10px; border-radius: 18px; background: var(--color-surface); border: 1px solid var(--color-border); gap: 6px;
    }
    .filters .btn-sm { border-radius: 999px; font-weight: 600; }
    .view-toggle { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--color-bg); border: 1px solid var(--color-border); }
    .view-toggle .btn.active { background: var(--color-surface); color: var(--color-primary); box-shadow: 0 1px 4px rgba(0,0,0,.12); font-weight: 700; }
    .week-label { min-width: 11rem; text-align: center; font-weight: 800; font-size: 1.05rem; }
    .export-worker-select { border-radius: 999px; padding: 0.4rem 0.9rem; }
    .compliance-banner { border-radius: 16px; }

    .wp-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin: 14px 0; }
    .wp-kpi {
      display: flex; flex-direction: column; gap: 2px; padding: 14px 18px; border-radius: 18px;
      background: var(--color-surface); border: 1px solid var(--color-border);
    }
    .wp-kpi-label { font-size: .72rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-muted); }
    .wp-kpi strong { font-size: 1.7rem; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.1; }
    .wp-kpi small { font-size: .72rem; color: var(--color-text-muted); }
    .wp-kpi-ok { border-color: rgba(34,197,94,.45); background: rgba(34,197,94,.07); }
    .wp-kpi-ok strong { color: #15803d; }
    .wp-kpi-warn { border-color: rgba(220,38,38,.4); background: rgba(220,38,38,.05); }
    .wp-kpi-warn strong { color: #b91c1c; }

    .wp-grid-scroll { overflow-x: auto; border-radius: 20px; border: 1px solid var(--color-border); background: var(--color-surface); box-shadow: 0 16px 36px -28px rgba(0,0,0,.45); }
    .wp-grid { min-width: 940px; display: flex; flex-direction: column; }
    .wp-row { display: grid; grid-template-columns: 190px repeat(7, minmax(112px, 1fr)) 84px; border-bottom: 1px solid var(--color-border); }
    .wp-row:last-child { border-bottom: 0; }
    .wp-cell { padding: 8px; border-right: 1px solid var(--color-border); min-width: 0; }
    .wp-cell:last-child { border-right: 0; }
    .wp-head { background: var(--color-bg); position: sticky; top: 0; z-index: 2; }
    .wp-day-head { display: flex; flex-direction: column; align-items: center; gap: 0; padding: 10px 4px; }
    .wp-dow { font-size: .72rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--color-text-muted); }
    .wp-dom { font-size: 1.35rem; font-weight: 800; line-height: 1.15; font-variant-numeric: tabular-nums; }
    .wp-day-head small { font-size: .65rem; color: var(--color-text-muted); }
    .wp-today { background: var(--color-primary-light); }
    .wp-head .wp-today .wp-dom { color: var(--color-primary); }
    .wp-closed { background: repeating-linear-gradient(135deg, transparent 0 8px, rgba(120,113,108,.08) 8px 16px); color: var(--color-text-muted); }
    .wp-total-head { display: grid; place-items: center; font-size: .72rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-muted); }
    .wp-name-cell { display: flex; align-items: center; gap: 10px; }
    .wp-avatar {
      flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; font-weight: 800; color: #fff;
      background: hsl(var(--wp-h) 52% 42%);
    }
    .wp-person { display: flex; flex-direction: column; min-width: 0; }
    .wp-person b { font-size: .9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wp-person small { font-size: .72rem; color: var(--color-text-muted); }
    .wp-day-cell { display: flex; flex-direction: column; gap: 4px; min-height: 64px; position: relative; }
    .wp-chip {
      display: flex; flex-direction: column; align-items: flex-start; gap: 0; width: 100%; padding: 5px 8px; border: 0; border-radius: 10px; text-align: left;
      background: hsl(var(--wp-h) 70% 93%); color: hsl(var(--wp-h) 55% 24%); border-left: 4px solid hsl(var(--wp-h) 52% 42%);
      font: inherit; cursor: pointer; touch-action: manipulation; transition: filter .15s, transform .12s;
    }
    button.wp-chip:hover { filter: brightness(.96); transform: translateY(-1px); }
    .wp-chip-static { cursor: default; }
    .wp-chip-time { font-size: .8rem; font-weight: 800; font-variant-numeric: tabular-nums; }
    .wp-chip-label { font-size: .7rem; opacity: .8; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wp-add {
      margin-top: auto; align-self: center; width: 28px; height: 28px; border: 1.5px dashed var(--color-border); border-radius: 50%; background: transparent;
      color: var(--color-text-muted); font-size: 1.1rem; line-height: 1; cursor: pointer; opacity: 0; transition: opacity .15s, border-color .15s, color .15s;
    }
    .wp-day-cell:hover .wp-add, .wp-add:focus-visible { opacity: 1; }
    .wp-add:hover { border-color: var(--color-primary); color: var(--color-primary); }
    @media (hover: none) { .wp-add { opacity: .55; } }
    .wp-total-cell { display: grid; place-items: center; font-variant-numeric: tabular-nums; font-size: .9rem; background: var(--color-bg); }
    .wp-foot { background: var(--color-bg); }
    .wp-foot-cell { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 4px; }
    .wp-cov { padding: 2px 8px; border-radius: 999px; font-size: .7rem; font-weight: 800; white-space: nowrap; }
    .wp-cov-ok { background: rgba(34,197,94,.16); color: #15803d; }
    .wp-cov-low { background: rgba(220,38,38,.14); color: #b91c1c; }
    .wp-cov-high { background: rgba(245,158,11,.18); color: #a16207; }
    .wp-day-hours { font-size: .75rem; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
    .wp-muted { color: var(--color-text-muted); }

    .shift-card { border-radius: 14px; }

    /* ===== Plantillas de turno ===== */
    .wp-templates { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 14px 0 0; padding: 10px 12px; border-radius: 18px; background: var(--color-surface); border: 1px solid var(--color-border); }
    .wp-templates-title { font-size: .72rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--color-text-muted); margin-right: 4px; }
    .wp-tpl {
      display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 16px 0 12px; border-radius: 999px; cursor: pointer;
      border: 1.5px solid hsl(var(--wp-h) 45% 80%); background: hsl(var(--wp-h) 80% 96%); color: hsl(var(--wp-h) 55% 24%); font: inherit; font-weight: 700;
      touch-action: manipulation; transition: background .15s, border-color .15s, transform .12s;
    }
    .wp-tpl small { font-size: .72rem; font-weight: 600; opacity: .75; font-variant-numeric: tabular-nums; }
    .wp-tpl-dot { width: 10px; height: 10px; border-radius: 50%; background: hsl(var(--wp-h) 60% 48%); }
    .wp-tpl:hover { border-color: hsl(var(--wp-h) 55% 55%); }
    .wp-tpl:active { transform: scale(.97); }
    .wp-tpl.on { background: hsl(var(--wp-h) 60% 44%); border-color: hsl(var(--wp-h) 60% 44%); color: #fff; box-shadow: 0 8px 16px -10px hsl(var(--wp-h) 60% 30%); }
    .wp-tpl.on .wp-tpl-dot { background: #fff; }
    .wp-tpl-manage { min-height: 38px; padding: 0 14px; border-radius: 999px; border: 1px dashed var(--color-border); background: transparent; color: var(--color-text-muted); font: inherit; font-size: .82rem; font-weight: 700; cursor: pointer; }
    .wp-tpl-manage:hover { border-color: var(--color-primary); color: var(--color-primary); }
    .wp-tpl-hint { margin-left: auto; font-size: .82rem; font-weight: 600; color: var(--color-primary); }
    .wp-add-armed { opacity: 1 !important; border-style: solid; border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-light); }
    .wp-tpl-modal { max-width: 640px; }
    .wp-tpl-help { margin: 0 0 12px; font-size: .85rem; color: var(--color-text-muted); }
    .wp-tpl-row {
      display: grid; grid-template-columns: minmax(120px, 1.2fr) auto auto auto auto; align-items: center; gap: 8px 12px; padding: 10px 12px; margin-bottom: 8px;
      border-radius: 16px; border: 1px solid var(--color-border); border-left: 5px solid hsl(var(--wp-h) 55% 50%); background: var(--color-bg);
    }
    .wp-tpl-row input[type='text'], .wp-tpl-row input[type='time'] { padding: 0.45rem 0.6rem; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); width: auto; }
    .wp-tpl-name-input { width: 100% !important; font-weight: 700; }
    .wp-tpl-times { display: inline-flex; align-items: center; gap: 6px; }
    .wp-tpl-split { display: inline-flex; align-items: center; gap: 6px; font-size: .8rem; font-weight: 600; white-space: nowrap; }
    .wp-tpl-split input { width: auto; }
    .wp-tpl-del { width: 36px; height: 36px; border: 0; border-radius: 10px; background: transparent; color: var(--color-text-muted); cursor: pointer; }
    .wp-tpl-del:hover { background: rgba(220,38,38,.1); color: #dc2626; }
    .wp-tpl-new { width: 100%; min-height: 44px; border-radius: 14px; border: 1.5px dashed var(--color-primary); background: var(--color-primary-light); color: var(--color-primary); font: inherit; font-weight: 800; cursor: pointer; }
    @media (max-width: 640px) { .wp-tpl-row { grid-template-columns: 1fr auto; } .wp-tpl-hint { margin-left: 0; width: 100%; } }

    /* ===== Añadir / editar turno ===== */
    .wpm { max-width: 560px; border-radius: 24px; padding: 0; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 30px 70px -18px rgba(0,0,0,.45); }
    .modal-overlay { backdrop-filter: blur(3px); }
    .wpm-head {
      display: flex; align-items: center; gap: 14px; padding: 18px 20px 16px;
      background: linear-gradient(135deg, var(--color-primary-light), transparent 80%);
    }
    .wpm-icon { flex: none; display: grid; place-items: center; width: 48px; height: 48px; border-radius: 16px; background: var(--color-primary); color: #fff; box-shadow: 0 10px 18px -10px var(--color-primary); }
    .wpm-head-text { flex: 1; min-width: 0; }
    .wpm-head-text h3 { margin: 0; font-size: 1.25rem; font-weight: 800; }
    .wpm-head-text p { margin: 2px 0 0; font-size: .85rem; font-weight: 600; color: var(--color-text-muted); }
    .wpm-close { flex: none; width: 38px; height: 38px; border: 0; border-radius: 50%; background: transparent; color: var(--color-text-muted); cursor: pointer; display: grid; place-items: center; }
    .wpm-close:hover { background: var(--color-bg); color: var(--color-text); }
    .wpm-body { padding: 4px 20px 8px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
    .wpm-sec { padding: 14px 16px; border-radius: 18px; background: var(--color-bg); border: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 12px; }
    .wpm-sec h4 { margin: 0; display: flex; align-items: center; gap: 10px; font-size: .78rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--color-text-muted); }
    .wpm-sec h4::before { content: ''; width: 5px; height: 16px; border-radius: 4px; background: var(--color-primary); }
    .wpm-sub { margin-top: 4px !important; }
    .wpm-duration { margin-left: auto; padding: 2px 10px; border-radius: 999px; background: var(--color-primary-light); color: var(--color-primary); font-size: .75rem; letter-spacing: 0; text-transform: none; }
    .wpm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 520px) { .wpm-grid { grid-template-columns: 1fr; } }
    .wpm-field { min-width: 0; }
    .wpm-field label, .wpm-check { margin: 0 0 4px; font-size: .78rem; font-weight: 700; color: var(--color-text-muted); }
    .wpm-field label { display: block; }
    .wpm select, .wpm input[type='date'], .wpm .wpm-input {
      width: 100%; min-height: 46px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); color: var(--color-text); font: inherit; font-weight: 600; box-sizing: border-box;
    }
    .wpm select:focus, .wpm input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
    .wpm-quick { display: flex; flex-wrap: wrap; gap: 8px; }
    .wpm-quick .wp-tpl { min-height: 40px; }
    .wpm-switch-card { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-radius: 14px; border: 1.5px solid var(--color-border); background: var(--color-surface); cursor: pointer; transition: border-color .15s, background .15s; }
    .wpm-switch-card input { position: absolute; opacity: 0; pointer-events: none; }
    .wpm-switch-card.on { border-color: var(--color-primary); background: var(--color-primary-light); }
    .wpm-switch { position: relative; flex: none; width: 44px; height: 26px; border-radius: 999px; background: var(--color-border); transition: background .15s; }
    .wpm-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .15s; }
    .wpm-switch-card.on .wpm-switch { background: var(--color-primary); }
    .wpm-switch-card.on .wpm-switch::after { transform: translateX(18px); }
    .wpm-switch-text { display: flex; flex-direction: column; gap: 1px; }
    .wpm-switch-text b { font-size: .92rem; }
    .wpm-switch-text small, .wpm-check small { color: var(--color-text-muted); font-size: .75rem; font-weight: 500; display: block; }
    .wpm-more { margin-top: 2px; }
    .wpm-more summary { cursor: pointer; font-size: .82rem; font-weight: 700; color: var(--color-text-muted); padding: 4px 0; }
    .wpm-more[open] summary { margin-bottom: 10px; color: var(--color-primary); }
    .wpm-check { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; align-self: end; }
    .wpm-check input { width: auto; min-height: 0; margin-top: 3px; }
    .wpm-error { padding: 10px 12px; border-radius: 12px; background: rgba(220,38,38,.08); }
    .wpm-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px 18px; border-top: 1px solid var(--color-border); }
    .wpm-btn { min-height: 46px; padding: 0 26px; border-radius: 999px; font: inherit; font-weight: 800; cursor: pointer; touch-action: manipulation; }
    .wpm-btn-ghost { background: transparent; border: 1px solid var(--color-border); color: var(--color-text); }
    .wpm-btn-main { border: 0; background: var(--color-primary); color: #fff; box-shadow: 0 10px 20px -10px var(--color-primary); }
    .wpm-btn-main:hover { filter: brightness(1.07); }

    /* ===== Ajustes de ancho (barra de plantillas y gestor) ===== */
    :host { display: block; min-width: 0; max-width: 100%; }
    .working-plan-page { min-width: 0; max-width: 100%; }
    .wp-grid-scroll { max-width: 100%; }
    .wp-templates { min-width: 0; }
    .wp-templates-title { flex: 1 1 100%; margin: 0 0 2px; }
    .wp-tpl { max-width: 100%; }
    .wp-tpl-hint { order: 10; flex: 1 1 100%; margin: 4px 0 0; text-align: left; }
    .wp-tpl-modal { width: min(640px, 94vw); max-width: 94vw; overflow-x: hidden; }
    .wp-tpl-modal .modal-body { overflow-x: hidden; }
    .wp-tpl-row { grid-template-columns: minmax(0, 1fr) auto; min-width: 0; }
    .wp-tpl-row .wp-tpl-name-input { grid-column: 1; min-width: 0; }
    .wp-tpl-row .wp-tpl-del { grid-column: 2; grid-row: 1; }
    .wp-tpl-times { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 8px; }
    .wp-tpl-times input[type='time'] { width: 100% !important; min-width: 0; box-sizing: border-box; }
    .wp-tpl-split { grid-column: 1 / -1; white-space: normal; }
  `],
})
export class WorkingPlanComponent implements OnInit, OnDestroy {
  /** Bound for template: stable left accent on week list cards. */
  readonly weekShiftBorder = weekShiftCardBorderLeft;

  private api = inject(ApiService);
  private translate = inject(TranslateService);
  private apiErr = inject(ApiErrorMessageService);
  private languageService = inject(LanguageService);
  private permissions = inject(PermissionService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private routeParamSub?: { unsubscribe: () => void };

  /** Opening hours per day (monday..sunday), from tenant settings. Signal so calendar grid recomputes when loaded. */
  openingHours = signal<Record<string, DayHours>>({});

  viewMode = signal<ViewMode>('week');
  weekStart = signal<Date>(new Date());
  /** First day of the month for calendar view. */
  calendarMonth = signal<Date>(new Date());
  shifts = signal<Shift[]>([]);
  /** Planned vs clocked rows for current date range (subset with activity). */
  plannedVsActualRows = signal<PlannedVsActualRow[]>([]);
  complianceWarnings = signal<ScheduleComplianceWarning[]>([]);
  copyWeekSaving = signal(false);
  scheduleUsers = signal<User[]>([]);
  /** Staff scope: null = all staff (planned vs clocked + optional PVA export); set = that worker for shift Excel + filtered PVA. Signal so computeds react to dropdown changes. */
  exportUserId = signal<number | null>(null);
  exportLoading = signal(false);
  exportPvaLoading = signal(false);
  /** Planned vs clocked block expanded (default collapsed; optional persistence). */
  pvaSectionOpen = signal(false);
  /** Bulk “apply to month” modal. */
  showBulkModal = signal(false);
  bulkTargetYear = signal(0);
  bulkTargetMonth = signal(1);
  bulkWeekdays = signal<Set<number>>(new Set([1, 2, 3, 4, 5]));
  bulkFormError = signal<string | null>(null);
  bulkSaving = signal(false);
  readonly bulkWeekdayOpts = BULK_WEEKDAY_OPTS;
  bulkUserId: number | null = null;
  bulkTimeStep: 30 | 60 = 30;
  bulkUseAnyHour = false;
  bulkStartTime = '09:00';
  bulkEndTime = '17:00';
  bulkLabel = '';
  bulkSkipExisting = true;
  loading = signal(true);
  showModal = signal(false);
  editingShift = signal<Shift | null>(null);
  deleteTarget = signal<Shift | null>(null);
  formError = signal<string | null>(null);
  toast = signal<{ message: string; type: 'success' | 'error' } | null>(null);
  private toastTimeout?: ReturnType<typeof setTimeout>;
  /** Bumps when a new planned-vs-actual HTTP request starts; stale responses are ignored. */
  private plannedVsActualFetchGen = 0;

  formUserId: number | null = null;
  formDate = '';
  formStartTime = '09:00';
  formEndTime = '14:00';
  formLabel = '';
  /** Time step for dropdown: 30 min (default) or 60 min (1h). */
  formTimeStep: 30 | 60 = 30;
  /** When true, time options are full-day (e.g. for cleaning), not limited to opening hours. */
  formUseAnyHour = false;
  /** Create flow only: add two time blocks the same day as two schedule rows (split shift). */
  formSplitShift = false;
  formStartTime2 = '16:00';
  formEndTime2 = '20:00';

  weekRange = computed(() => getWeekRange(this.weekStart()));

  /** Week view layout: staff × day grid (default) or the plain list. Remembered in this browser. */
  weekLayout = signal<'grid' | 'list'>(
    (() => {
      try {
        return localStorage.getItem('pos.workingPlan.weekLayout') === 'list' ? 'list' : 'grid';
      } catch {
        return 'grid';
      }
    })()
  );

  setWeekLayout(layout: 'grid' | 'list'): void {
    this.weekLayout.set(layout);
    try {
      localStorage.setItem('pos.workingPlan.weekLayout', layout);
    } catch {
      /* storage unavailable */
    }
  }

  private shiftMinutes(s: Shift): number {
    const toMin = (t: string) => {
      const [h, m] = (t || '0:0').split(':').map((x) => parseInt(x, 10) || 0);
      return h * 60 + m;
    };
    let d = toMin(s.end_time) - toMin(s.start_time);
    if (d < 0) d += 24 * 60; // overnight
    return d;
  }

  // ----- Shift templates -----
  templates = signal<ShiftTemplate[]>([]);
  armedTemplateId = signal<number | null>(null);
  armedTemplate = computed(() => this.templates().find((t) => t.id === this.armedTemplateId()) ?? null);
  showTemplates = signal(false);
  templatesSaving = signal(false);
  templatesError = signal<string | null>(null);
  templateDrafts = signal<TemplateDraft[]>([]);
  private draftSeq = 0;

  private loadTemplates(): void {
    this.api.getShiftTemplates().subscribe({
      next: (list) => this.templates.set(list),
      error: () => this.templates.set([]),
    });
  }

  templateHue(index: number): number {
    return [28, 205, 150, 280, 345, 60][index % 6];
  }

  templateRangeLabel(t: ShiftTemplate): string {
    const first = `${t.start_time}–${t.end_time}`;
    return t.start_time2 && t.end_time2 ? `${first} · ${t.start_time2}–${t.end_time2}` : first;
  }

  toggleTemplate(t: ShiftTemplate): void {
    this.armedTemplateId.set(this.armedTemplateId() === t.id ? null : t.id);
  }

  /** Click on a grid cell: apply the armed template, or open the normal form. */
  onCellAdd(userId: number, date: string): void {
    const t = this.armedTemplate();
    if (!t) {
      this.openCreateFor(userId, date);
      return;
    }
    const blocks: [string, string][] = [[t.start_time, t.end_time]];
    if (t.start_time2 && t.end_time2) blocks.push([t.start_time2, t.end_time2]);
    forkJoin(
      blocks.map(([start, end]) =>
        this.api.createShift({ user_id: userId, date, start_time: start, end_time: end, label: t.name })
      )
    ).subscribe({
      next: () => {
        this.showToast(this.translate.instant('WORKING_PLAN.TEMPLATE_APPLIED', { name: t.name }), 'success');
        this.load();
      },
      error: (err) => {
        this.showToast(this.getApiErrorMessage(err), 'error');
        this.load();
      },
    });
  }

  openTemplates(): void {
    this.templatesError.set(null);
    this.templateDrafts.set(
      this.templates().map((t) => ({
        key: ++this.draftSeq,
        id: t.id,
        name: t.name,
        start_time: t.start_time,
        end_time: t.end_time,
        split: !!(t.start_time2 && t.end_time2),
        start_time2: t.start_time2 || '16:00',
        end_time2: t.end_time2 || '20:00',
      }))
    );
    this.showTemplates.set(true);
  }

  closeTemplates(): void {
    this.showTemplates.set(false);
  }

  addDraft(): void {
    this.templateDrafts.update((list) => [
      ...list,
      { key: ++this.draftSeq, name: '', start_time: '09:00', end_time: '17:00', split: false, start_time2: '16:00', end_time2: '20:00' },
    ]);
  }

  patchDraft(key: number, patch: Partial<TemplateDraft>): void {
    this.templateDrafts.update((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  removeDraft(key: number): void {
    this.templateDrafts.update((list) => list.filter((d) => d.key !== key));
  }

  saveTemplates(): void {
    const drafts = this.templateDrafts();
    for (const d of drafts) {
      const bad = !d.name.trim() || !d.start_time || !d.end_time || d.start_time >= d.end_time ||
        (d.split && (!d.start_time2 || !d.end_time2 || d.start_time2 >= d.end_time2 || d.start_time2 <= d.end_time));
      if (bad) {
        this.templatesError.set(this.translate.instant('WORKING_PLAN.TEMPLATE_INVALID', { name: d.name || '…' }));
        return;
      }
    }
    this.templatesError.set(null);
    this.templatesSaving.set(true);
    const keepIds = new Set(drafts.filter((d) => d.id != null).map((d) => d.id as number));
    const calls = [
      ...this.templates().filter((t) => !keepIds.has(t.id)).map((t) => this.api.deleteShiftTemplate(t.id)),
      ...drafts.map((d) => {
        const body = {
          name: d.name.trim(),
          start_time: d.start_time,
          end_time: d.end_time,
          start_time2: d.split ? d.start_time2 : null,
          end_time2: d.split ? d.end_time2 : null,
        };
        return d.id != null ? this.api.updateShiftTemplate(d.id, body) : this.api.createShiftTemplate(body);
      }),
    ];
    const onDone = () => {
      this.templatesSaving.set(false);
      this.showTemplates.set(false);
      if (this.armedTemplateId() != null && !keepIds.has(this.armedTemplateId() as number)) this.armedTemplateId.set(null);
      this.loadTemplates();
    };
    if (!calls.length) {
      onDone();
      return;
    }
    forkJoin(calls as Observable<unknown>[]).subscribe({
      next: onDone,
      error: (err: unknown) => {
        this.templatesSaving.set(false);
        this.templatesError.set(this.getApiErrorMessage(err));
      },
    });
  }

  userOptions(): AppSelectOption[] {
    return this.assignableScheduleUsers()
      .filter((u) => u.id != null)
      .map((u) => ({ value: u.id, label: u.full_name || u.username || '', sub: this.getRoleLabel(u.role) }));
  }

  /** "martes, 21 de octubre" style label for the shift form header. */
  formDateLabel(): string {
    if (!this.formDate) return '';
    const d = new Date(this.formDate + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return '';
    const label = d.toLocaleDateString(this.languageService.getLocale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  /** "8 h" / "4 h 30 min" for a start-end pair; empty when invalid. */
  blockDurationLabel(start: string, end: string): string {
    const toMin = (t: string) => {
      const [h, m] = (t || '').split(':').map((x) => parseInt(x, 10));
      return Number.isFinite(h) ? h * 60 + (m || 0) : NaN;
    };
    const d = toMin(end) - toMin(start);
    if (!Number.isFinite(d) || d <= 0) return '';
    const h = Math.floor(d / 60);
    const m = d % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  /** Fill the shift form from a template (times, optional second block and label). */
  applyTemplateToForm(t: ShiftTemplate): void {
    const needed = [t.start_time, t.end_time, t.start_time2, t.end_time2].filter((x): x is string => !!x);
    if (!this.formUseAnyHour && !needed.every((x) => this.timeOptsForSelectedDay().includes(x))) {
      this.formUseAnyHour = true; // template hours outside the opening hours stay selectable
    }
    this.formStartTime = t.start_time;
    this.formEndTime = t.end_time;
    this.formSplitShift = !!(t.start_time2 && t.end_time2);
    if (this.formSplitShift) {
      this.formStartTime2 = t.start_time2 as string;
      this.formEndTime2 = t.end_time2 as string;
    }
    this.formLabel = t.name;
    this.formError.set(null);
  }

  /** Seven days of the visible week with today / closed flags and per-role coverage. */
  weekDays = computed(() => {
    void this.openingHours();
    const shifts = this.shifts();
    const { from } = this.weekRange();
    const start = new Date(from + 'T12:00:00');
    const todayStr = this.toIso(new Date());
    const dows = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    return Array.from({ length: 7 }, (_, i) => {
      const dt = new Date(start);
      dt.setDate(start.getDate() + i);
      const date = this.toIso(dt);
      const dayKey = DAY_KEYS[dt.getDay()];
      const closed = this.isDayClosed(dayKey);
      const dayShifts = shifts.filter((s) => s.date === date);
      const coverage = closed
        ? []
        : STAFF_KEYS.filter((sk) => this.getRequiredForRole(dayKey, sk) > 0).map((sk) => {
            const required = this.getRequiredForRole(dayKey, sk);
            const scheduled = this.getScheduledCountForRole(date, sk);
            return {
              key: sk,
              label: this.getRoleLabel(sk),
              required,
              scheduled,
              state: scheduled < required ? 'low' : scheduled > required ? 'high' : 'ok',
            } as { key: string; label: string; required: number; scheduled: number; state: 'low' | 'ok' | 'high' };
          });
      return {
        date,
        dow: this.translate.instant('WORKING_PLAN.' + dows[i]),
        dom: dt.getDate(),
        isToday: date === todayStr,
        closed,
        coverage,
        minutes: dayShifts.reduce((sum, s) => sum + this.shiftMinutes(s), 0),
        shiftCount: dayShifts.length,
      };
    });
  });

  /** One row per staff member with their shifts for each day of the week. */
  weekGrid = computed(() => {
    const days = this.weekDays();
    const shifts = this.shifts();
    const byUser = new Map<number, Shift[]>();
    for (const sh of shifts) {
      const list = byUser.get(sh.user_id) ?? [];
      list.push(sh);
      byUser.set(sh.user_id, list);
    }
    const known = new Map<number, User>();
    for (const u of this.scheduleUsers()) if (u.id != null) known.set(u.id, u);
    // Someone with a shift but not in the staff list still gets a row.
    for (const [uid, list] of byUser) {
      if (!known.has(uid)) {
        const f = list[0];
        known.set(uid, { id: uid, full_name: f.user_name, username: f.user_name, role: f.user_role } as unknown as User);
      }
    }
    const users = [...known.values()].sort((a, b) =>
      (a.full_name || a.username || '').localeCompare(b.full_name || b.username || '')
    );
    return users.map((user) => {
      const id = user.id as number;
      const mine = byUser.get(id) ?? [];
      const cells = days.map((d) => ({
        date: d.date,
        isToday: d.isToday,
        closed: d.closed,
        shifts: mine
          .filter((s) => s.date === d.date)
          .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')),
      }));
      return {
        id,
        user,
        days: cells,
        totalMinutes: mine.reduce((sum, s) => sum + this.shiftMinutes(s), 0),
      };
    });
  });

  weekStats = computed(() => {
    const days = this.weekDays();
    const totalMinutes = days.reduce((sum, d) => sum + d.minutes, 0);
    const people = new Set(this.shifts().map((s) => s.user_id)).size;
    const openDays = days.filter((d) => !d.closed);
    const reqDays = openDays.filter((d) => d.coverage.length > 0);
    return {
      totalMinutes,
      people,
      requirementDays: reqDays.length,
      gapDays: reqDays.filter((d) => d.coverage.some((c) => c.state === 'low')).length,
      emptyDays: openDays.filter((d) => d.shiftCount === 0).length,
    };
  });

  canAddFor(userId: number): boolean {
    if (!this.canWriteSchedule()) return false;
    return this.canManageAllSchedules() || userId === this.api.getCurrentUser()?.id;
  }

  /** Create a shift from a grid cell (person + day preselected). */
  openCreateFor(userId: number, date: string): void {
    this.openCreate();
    this.formUserId = userId;
    this.formDate = date;
    this.onFormDateChange(date);
  }

  private toIso(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Staff the current user may assign shifts to (self only unless owner/admin). */
  assignableScheduleUsers = computed(() => {
    const users = this.scheduleUsers();
    if (this.canManageAllSchedules()) return users;
    const id = this.api.getCurrentUser()?.id;
    if (id == null) return [];
    return users.filter((u) => u.id === id);
  });

  /** Time options for bulk apply (Monday opening hours as template, or full day). */
  timeOptsForBulk(): string[] {
    void this.openingHours();
    const step = this.bulkTimeStep;
    if (this.bulkUseAnyHour) return fullDayTimeOptions(step);
    const day = this.openingHours()['monday'];
    if (!day || day.closed || !day.open || !day.close) return defaultTimeOptions(step);
    const open = day.hasBreak && day.morningOpen ? day.morningOpen : day.open;
    const close = day.hasBreak && day.eveningClose ? day.eveningClose : day.close;
    const opts = timeOptionsBetween(open, close, step);
    return opts.length > 0 ? opts : defaultTimeOptions(step);
  }

  /** Time options for start/end. If formUseAnyHour, full-day; else aligned to opening hours. Step from formTimeStep. */
  timeOptsForSelectedDay(): string[] {
    const step = this.formTimeStep;
    if (this.formUseAnyHour) return fullDayTimeOptions(step);
    if (!this.formDate) return defaultTimeOptions(step);
    const dayKey = DAY_KEYS[new Date(this.formDate + 'T12:00:00').getDay()];
    const day = this.openingHours()[dayKey];
    if (!day || day.closed || !day.open || !day.close) return defaultTimeOptions(step);
    const open = day.hasBreak && day.morningOpen ? day.morningOpen : day.open;
    const close = day.hasBreak && day.eveningClose ? day.eveningClose : day.close;
    const opts = timeOptionsBetween(open, close, step);
    return opts.length > 0 ? opts : defaultTimeOptions(step);
  }

  /** Second block start options: strictly after first block end (split shift). */
  timeOptsForBlock2Start(): string[] {
    return this.timeOptsForSelectedDay().filter((t) => t > this.formEndTime);
  }

  /** Second block end options: strictly after second block start. */
  timeOptsForBlock2End(): string[] {
    return this.timeOptsForSelectedDay().filter((t) => t > this.formStartTime2);
  }

  weekLabel = computed(() => {
    const { from, to } = this.weekRange();
    const f = new Date(from);
    const t = new Date(to);
    return `${f.getDate()} ${this.monthShort(f.getMonth())} – ${t.getDate()} ${this.monthShort(t.getMonth())} ${t.getFullYear()}`;
  });

  shiftsByDate = computed(() => {
    const list = [...this.shifts()];
    list.sort((a, b) => {
      const d = (a.date || '').localeCompare(b.date || '');
      if (d !== 0) return d;
      return (a.start_time || '').localeCompare(b.start_time || '');
    });
    return list;
  });

  plannedVsActualDisplayed = computed(() => {
    const base = this.plannedVsActualRows().filter((r) => r.planned_minutes > 0 || r.actual_minutes > 0);
    const uid = this.exportUserId();
    if (uid == null) return base;
    return base.filter((r) => r.user_id === uid);
  });

  pvaTotals = computed(() => {
    const rows = this.plannedVsActualDisplayed();
    let planned = 0;
    let actual = 0;
    for (const r of rows) {
      planned += r.planned_minutes;
      actual += r.actual_minutes;
    }
    return { planned_minutes: planned, actual_minutes: actual, variance_minutes: actual - planned };
  });

  showPvaSection = computed(() => {
    const anyActivity = this.plannedVsActualRows().some((r) => r.planned_minutes > 0 || r.actual_minutes > 0);
    return anyActivity || this.exportUserId() != null;
  });

  calendarMonthLabel = computed(() => {
    const d = this.calendarMonth();
    return `${this.monthShort(d.getMonth())} ${d.getFullYear()}`;
  });

  /** Month label for export hint (calendar month or month of week range start). */
  exportMonthLabel = computed(() => {
    const { year, month } = this.exportYearMonth();
    return `${this.monthShort(month - 1)} ${year}`;
  });

  /** Label for bulk modal (target month). */
  bulkMonthLabel = computed(() => {
    const y = this.bulkTargetYear();
    const m = this.bulkTargetMonth();
    if (!y || m < 1 || m > 12) return '';
    return `${this.monthShort(m - 1)} ${y}`;
  });

  /** Short weekday names for calendar header (Mon–Sun). */
  weekdayLabels = computed(() => {
    const t = this.translate;
    return ['WORKING_PLAN.MON', 'WORKING_PLAN.TUE', 'WORKING_PLAN.WED', 'WORKING_PLAN.THU', 'WORKING_PLAN.FRI', 'WORKING_PLAN.SAT', 'WORKING_PLAN.SUN'].map((k) => t.instant(k) !== k ? t.instant(k) : k.replace('WORKING_PLAN.', ''));
  });

  /** Calendar grid: 6 rows of 7 cells. Cell has trackId; day/dateStr/hasIssue only for real days. */
  calendarGrid = computed(() => {
    const month = this.calendarMonth();
    void this.openingHours(); // ensure grid recomputes when opening hours load (async from getTenantSettings)
    void this.shifts(); // ensure grid recomputes when schedule loads
    const year = month.getFullYear();
    const monthIdx = month.getMonth();
    const first = new Date(year, monthIdx, 1);
    const last = new Date(year, monthIdx + 1, 0);
    const daysInMonth = last.getDate();
    const startOffset = (first.getDay() + 6) % 7;
    const pad = (n: number) => String(n).padStart(2, '0');
    type Cell = {
      trackId: string;
      day?: number;
      dateStr?: string;
      hasIssue?: boolean;
      isClosed?: boolean;
      showOk?: boolean;
      shiftLines?: CalendarShiftLineRow[];
    };
    const cells: Cell[] = [];
    let idx = 0;
    for (let i = 0; i < startOffset; i++) cells.push({ trackId: `empty-${idx++}` });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${pad(monthIdx + 1)}-${pad(d)}`;
      const dayKey = DAY_KEYS[new Date(dateStr + 'T12:00:00').getDay()];
      const closed = this.isDayClosed(dayKey);
      const hasIssue = this.dayHasRequirementIssue(dateStr);
      const hasReq = this.dayHasPersonnelRequirements(dayKey);
      const showOk = !closed && hasReq && !hasIssue && this.dayMatchesRequirements(dateStr);
      const dayShifts = this.shifts()
        .filter((s) => s.date === dateStr)
        .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
      const lines: CalendarShiftLineRow[] = dayShifts.map((s) => ({
        text: this.formatShiftLine(s),
        userId: s.user_id,
        shift: s,
      }));
      const maxLines = 5;
      const shiftLines =
        lines.length > maxLines
          ? [
              ...lines.slice(0, maxLines),
              {
                text: this.translate.instant('WORKING_PLAN.CALENDAR_MORE_SHIFTS', {
                  count: lines.length - maxLines,
                }),
                userId: null,
                shift: null,
              },
            ]
          : lines;
      cells.push({
        trackId: dateStr,
        day: d,
        dateStr,
        hasIssue,
        isClosed: closed,
        showOk,
        shiftLines,
      });
    }
    const total = cells.length;
    const remainder = total % 7;
    if (remainder !== 0) for (let i = 0; i < 7 - remainder; i++) cells.push({ trackId: `empty-${idx++}` });
    const rows: { weekIndex: number; days: Cell[] }[] = [];
    for (let r = 0; r < cells.length; r += 7) rows.push({ weekIndex: r / 7, days: cells.slice(r, r + 7) });
    return rows;
  });

  ngOnInit(): void {
    const applyView = (view: string | null): boolean => {
      if (isValidView(view)) {
        this.viewMode.set(view);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(WORKING_PLAN_VIEW_KEY, view);
        }
        return true;
      }
      if (view != null) {
        this.router.navigate(['/working-plan', 'week'], { replaceUrl: true });
      }
      return false;
    };
    const initialView = this.route.snapshot.paramMap.get('view');
    applyView(initialView);
    this.routeParamSub = this.route.paramMap.subscribe((params) => {
      if (applyView(params.get('view'))) {
        this.load();
      }
    });
    if (typeof localStorage !== 'undefined' && localStorage.getItem(WORKING_PLAN_PVA_OPEN_KEY) === '1') {
      this.pvaSectionOpen.set(true);
    }
    this.api.getUsersForSchedule().subscribe({
      next: (users) => {
        this.scheduleUsers.set(users);
        if (!users.length) {
          this.exportUserId.set(null);
          return;
        }
        const cur = this.exportUserId();
        if (cur != null && !users.some((u) => u.id === cur)) {
          this.exportUserId.set(null);
        }
      },
      error: () => {
        this.scheduleUsers.set([]);
        this.exportUserId.set(null);
      },
    });
    this.api.getTenantSettings().subscribe({
      next: (settings) => this.parseOpeningHours(settings.opening_hours),
      error: () => {},
    });
    this.loadTemplates();
  }

  ngOnDestroy(): void {
    this.routeParamSub?.unsubscribe();
  }

  private parseOpeningHours(json: string | null | undefined): void {
    const hours: Record<string, DayHours> = {};
    DAY_KEYS.forEach((key) => {
      hours[key] = { open: '09:00', close: '22:00', closed: false };
    });
    if (!json?.trim()) {
      this.openingHours.set(hours);
      return;
    }
    try {
      const parsed = JSON.parse(json) as Record<string, Partial<DayHours>>;
      DAY_KEYS.forEach((key) => {
        if (parsed[key]) {
          const d = parsed[key];
          hours[key] = {
            open: d.open ?? '09:00',
            close: d.close ?? '22:00',
            closed: d.closed ?? false,
            hasBreak: d.hasBreak,
            morningOpen: d.morningOpen,
            morningClose: d.morningClose,
            eveningOpen: d.eveningOpen,
            eveningClose: d.eveningClose,
            waiter: d.waiter ?? 0,
            kitchen: d.kitchen ?? 0,
          };
        }
      });
      this.openingHours.set(hours);
    } catch {
      this.openingHours.set(hours);
    }
  }

  /** When the user changes the shift date, clamp start/end to the new day's time options. */
  onFormDateChange(_newDate: string): void {
    this.clampFormTimes();
  }

  /** Clamp start/end to current time options (e.g. after toggling "use any hour" or changing time step). */
  onTimeOptionsChange(): void {
    this.clampFormTimes();
  }

  private clampFormTimes(): void {
    const opts = this.timeOptsForSelectedDay();
    if (opts.length === 0) return;
    if (!opts.includes(this.formStartTime)) this.formStartTime = opts[0];
    if (!opts.includes(this.formEndTime)) this.formEndTime = opts[opts.length - 1];
    if (this.formStartTime >= this.formEndTime) {
      this.formEndTime = opts[opts.indexOf(this.formStartTime) + 1] ?? opts[opts.length - 1];
    }
    if (this.formSplitShift && !this.editingShift()) {
      this.clampSplitBlockTimes();
    }
  }

  /** Keep block 2 times inside available options and after block 1. */
  private clampSplitBlockTimes(): void {
    const startOpts = this.timeOptsForBlock2Start();
    if (startOpts.length === 0) return;
    if (!startOpts.includes(this.formStartTime2)) this.formStartTime2 = startOpts[0];
    const endOpts = this.timeOptsForBlock2End();
    if (endOpts.length === 0) return;
    if (!endOpts.includes(this.formEndTime2)) this.formEndTime2 = endOpts[0];
    if (this.formStartTime2 >= this.formEndTime2) {
      const i = endOpts.indexOf(this.formStartTime2);
      this.formEndTime2 = endOpts[i + 1] ?? endOpts[endOpts.length - 1];
    }
  }

  onFormBlock1TimesChange(): void {
    this.clampFormTimes();
  }

  onFormBlock2TimesChange(): void {
    if (!this.formSplitShift) return;
    const endOpts = this.timeOptsForBlock2End();
    if (endOpts.length === 0) return;
    if (!endOpts.includes(this.formEndTime2)) this.formEndTime2 = endOpts[0];
    if (this.formStartTime2 >= this.formEndTime2) {
      const i = endOpts.indexOf(this.formStartTime2);
      this.formEndTime2 = endOpts[i + 1] ?? endOpts[endOpts.length - 1];
    }
  }

  onSplitShiftChange(enabled: boolean): void {
    if (enabled) {
      this.clampFormTimes();
      const startOpts = this.timeOptsForBlock2Start();
      if (startOpts.length) {
        this.formStartTime2 = startOpts[0];
        const endOpts = this.timeOptsForBlock2End();
        if (endOpts.length > 1) this.formEndTime2 = endOpts[1];
        else this.formEndTime2 = endOpts[0];
      }
    }
    this.clampFormTimes();
  }

  onBulkTimeOptionsChange(): void {
    const opts = this.timeOptsForBulk();
    if (opts.length === 0) return;
    if (!opts.includes(this.bulkStartTime)) this.bulkStartTime = opts[0];
    if (!opts.includes(this.bulkEndTime)) this.bulkEndTime = opts[opts.length - 1];
    if (this.bulkStartTime >= this.bulkEndTime) {
      this.bulkEndTime = opts[opts.indexOf(this.bulkStartTime) + 1] ?? opts[opts.length - 1];
    }
  }

  openBulkMonth(): void {
    const { year, month } = this.exportYearMonth();
    this.bulkTargetYear.set(year);
    this.bulkTargetMonth.set(month);
    this.bulkWeekdays.set(new Set([1, 2, 3, 4, 5]));
    const users = this.assignableScheduleUsers();
    const exp = this.exportUserId();
    this.bulkUserId =
      exp != null && users.some((u) => u.id === exp) ? exp : (users[0]?.id ?? null);
    this.bulkTimeStep = 30;
    this.bulkUseAnyHour = false;
    this.bulkStartTime = '09:00';
    this.bulkEndTime = '17:00';
    this.bulkLabel = '';
    this.bulkSkipExisting = true;
    this.bulkFormError.set(null);
    this.showBulkModal.set(true);
    this.onBulkTimeOptionsChange();
  }

  closeBulkModal(): void {
    this.showBulkModal.set(false);
    this.bulkFormError.set(null);
  }

  toggleBulkWeekday(js: number): void {
    const s = new Set(this.bulkWeekdays());
    if (s.has(js)) s.delete(js);
    else s.add(js);
    this.bulkWeekdays.set(s);
  }

  saveBulkMonth(): void {
    this.bulkFormError.set(null);
    if (this.bulkUserId == null) {
      this.bulkFormError.set(this.translate.instant('WORKING_PLAN.BULK_ERR_USER'));
      return;
    }
    const wds = Array.from(this.bulkWeekdays()).sort((a, b) => a - b);
    if (wds.length === 0) {
      this.bulkFormError.set(this.translate.instant('WORKING_PLAN.BULK_ERR_WEEKDAYS'));
      return;
    }
    if (this.bulkStartTime >= this.bulkEndTime) {
      this.bulkFormError.set(this.translate.instant('WORKING_PLAN.BULK_ERR_TIMES'));
      return;
    }
    const y = this.bulkTargetYear();
    const m = this.bulkTargetMonth();
    if (!y || m < 1 || m > 12) {
      this.bulkFormError.set(this.translate.instant('WORKING_PLAN.BULK_ERR_MONTH'));
      return;
    }
    const payload: ShiftBulkCreate = {
      user_id: this.bulkUserId,
      year: y,
      month: m,
      weekdays: wds,
      start_time: this.bulkStartTime,
      end_time: this.bulkEndTime,
      label: this.bulkLabel?.trim() ? this.bulkLabel.trim() : null,
      skip_days_with_existing_shift: this.bulkSkipExisting,
    };
    this.bulkSaving.set(true);
    this.api.bulkCreateShifts(payload).subscribe({
      next: (res) => {
        this.bulkSaving.set(false);
        this.closeBulkModal();
        this.focusScheduleOnDate(`${y}-${String(m).padStart(2, '0')}-01`);
        this.load();
        const msg = this.translate.instant('WORKING_PLAN.BULK_DONE', {
          created: res.created_count,
          skipped: res.skipped_existing_count,
        });
        this.showToast(msg, 'success');
      },
      error: (err) => {
        this.bulkSaving.set(false);
        const msg = this.getApiErrorMessage(err);
        this.bulkFormError.set(msg);
        this.showToast(msg, 'error');
      },
    });
  }

  /** Required headcount for a role on a day (from opening hours personnel settings). */
  private getRequiredForRole(dayKey: string, staffKey: StaffKey): number {
    const day = this.openingHours()[dayKey];
    if (!day) return 0;
    const n = (day as unknown as Record<string, number | undefined>)[staffKey];
    return typeof n === 'number' ? Math.max(0, n) : 0;
  }

  /** Number of shifts on the given date for the given role (user_role mapped to staff key). */
  private getScheduledCountForRole(date: string, staffKey: StaffKey): number {
    return this.shifts().filter((s) => s.date === date && shiftRoleMatchesStaffKey(s.user_role, staffKey)).length;
  }

  /** True if the given week-day key is marked closed in opening hours. */
  private isDayClosed(dayKey: string): boolean {
    const day = this.openingHours()[dayKey];
    return day?.closed === true;
  }

  /** True if the shift plan for this date meets personnel requirements (scheduled >= required for each role). */
  dayMatchesRequirements(dateStr: string): boolean {
    const dayKey = DAY_KEYS[new Date(dateStr + 'T12:00:00').getDay()];
    if (this.isDayClosed(dayKey)) return false;
    for (const sk of STAFF_KEYS) {
      const required = this.getRequiredForRole(dayKey, sk);
      if (required > 0) {
        const scheduled = this.getScheduledCountForRole(dateStr, sk);
        if (scheduled < required) return false;
      }
    }
    const hasAnyRequirement = STAFF_KEYS.some((sk) => this.getRequiredForRole(dayKey, sk) > 0);
    return hasAnyRequirement;
  }

  /** At least one role has required headcount > 0 for this weekday (opening hours). */
  private dayHasPersonnelRequirements(dayKey: string): boolean {
    return STAFF_KEYS.some((sk) => this.getRequiredForRole(dayKey, sk) > 0);
  }

  /** True if this date has a staffing issue: any role has too many or not enough people vs requirements. */
  dayHasRequirementIssue(dateStr: string): boolean {
    const dayKey = DAY_KEYS[new Date(dateStr + 'T12:00:00').getDay()];
    if (this.isDayClosed(dayKey)) return false;
    for (const sk of STAFF_KEYS) {
      const required = this.getRequiredForRole(dayKey, sk);
      if (required > 0) {
        const scheduled = this.getScheduledCountForRole(dateStr, sk);
        if (scheduled < required || scheduled > required) return true;
      }
    }
    return false;
  }

  /** Date range used for “Add shift” suggestions: visible month in calendar view, else current week. */
  private getScheduleContextRange(): { from: string; to: string } {
    return this.viewMode() === 'calendar' ? getMonthRange(this.calendarMonth()) : this.weekRange();
  }

  /** Next date in the context range that is open and has a free slot for the current user's role; else first open day. */
  getSuggestedDateForNewShift(): string {
    const { from, to } = this.getScheduleContextRange();
    const user = this.api.getCurrentUser();
    const staffKey = user ? roleToStaffKey(user.role ?? '') : null;

    const datesInRange: string[] = [];
    const fromDate = new Date(from + 'T12:00:00');
    const toDate = new Date(to + 'T12:00:00');
    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      datesInRange.push(`${y}-${m}-${day}`);
    }

    if (staffKey) {
      for (const date of datesInRange) {
        const dayKey = DAY_KEYS[new Date(date + 'T12:00:00').getDay()];
        if (this.isDayClosed(dayKey)) continue;
        const required = this.getRequiredForRole(dayKey, staffKey);
        const scheduled = this.getScheduledCountForRole(date, staffKey);
        if (required > 0 && scheduled < required) return date;
      }
    } else {
      for (const date of datesInRange) {
        const dayKey = DAY_KEYS[new Date(date + 'T12:00:00').getDay()];
        if (this.isDayClosed(dayKey)) continue;
        for (const sk of STAFF_KEYS) {
          const required = this.getRequiredForRole(dayKey, sk);
          const scheduled = this.getScheduledCountForRole(date, sk);
          if (required > 0 && scheduled < required) return date;
        }
      }
    }

    const firstOpenDate = datesInRange.find(
      (date) => !this.isDayClosed(DAY_KEYS[new Date(date + 'T12:00:00').getDay()]),
    );
    return firstOpenDate ?? from;
  }

  private monthShort(m: number): string {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[m] ?? '';
  }

  /** Calendar year/month (1–12) used for Excel export. */
  private exportYearMonth(): { year: number; month: number } {
    if (this.viewMode() === 'calendar') {
      const d = this.calendarMonth();
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    }
    const from = this.weekRange().from;
    const parts = from.split('-').map((x) => parseInt(x, 10));
    return { year: parts[0], month: parts[1] };
  }

  copyWeekToNextWeek(): void {
    const src = this.weekRange().from;
    const d = new Date(src + 'T12:00:00');
    d.setDate(d.getDate() + 7);
    const pad = (n: number) => String(n).padStart(2, '0');
    const tgt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    this.copyWeekSaving.set(true);
    this.api
      .copyScheduleWeek({
        source_week_start: src,
        target_week_start: tgt,
        skip_days_with_existing_shift: true,
      })
      .subscribe({
        next: (res) => {
          this.copyWeekSaving.set(false);
          this.nextWeek();
          this.showToast(
            this.translate.instant('WORKING_PLAN.COPY_WEEK_DONE', {
              created: res.created_count,
              skipped: res.skipped_existing_count,
            }),
            'success',
          );
        },
        error: (err) => {
          this.copyWeekSaving.set(false);
          this.showToast(this.getApiErrorMessage(err), 'error');
        },
      });
  }

  formatMinutes(m: number): string {
    if (m === 0) return '0';
    const h = Math.floor(m / 60);
    const min = m % 60;
    return min > 0 ? `${h}h ${min}m` : `${h}h`;
  }

  formatSignedMinutes(m: number): string {
    if (m === 0) return '0';
    const sign = m > 0 ? '+' : '−';
    return `${sign}${this.formatMinutes(Math.abs(m))}`;
  }

  complianceWarningText(w: ScheduleComplianceWarning): string {
    if (w.code === 'weekly_planned_over_limit') {
      return this.translate.instant('WORKING_PLAN.COMPLIANCE_WEEKLY', {
        name: w.user_name || '',
        week: w.week_start || '',
        planned: this.formatMinutes(w.planned_minutes ?? 0),
        limit: this.formatMinutes(w.limit_minutes ?? 0),
      });
    }
    if (w.code === 'rest_between_shifts') {
      return this.translate.instant('WORKING_PLAN.COMPLIANCE_REST', {
        name: w.user_name || '',
        gap: this.formatMinutes(w.gap_minutes ?? 0),
        required: this.formatMinutes(w.required_min_rest_minutes ?? 0),
      });
    }
    if (w.code === 'yearly_planned_hours_threshold') {
      return this.translate.instant('WORKING_PLAN.COMPLIANCE_YEARLY', {
        name: w.user_name || '',
        year: String(w.year ?? ''),
        planned: this.formatMinutes(w.planned_minutes ?? 0),
        warn: this.formatMinutes(w.warn_at_minutes ?? 0),
      });
    }
    return JSON.stringify(w);
  }

  togglePvaSection(): void {
    this.pvaSectionOpen.update((v) => !v);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(WORKING_PLAN_PVA_OPEN_KEY, this.pvaSectionOpen() ? '1' : '0');
    }
  }

  exportPvaExcel(): void {
    const range = this.viewMode() === 'calendar' ? getMonthRange(this.calendarMonth()) : this.weekRange();
    this.exportPvaLoading.set(true);
    this.api
      .getSchedulePlannedVsActualExport(range.from, range.to, this.languageService.getLanguage(), this.exportUserId())
      .subscribe({
        next: (blob) => {
          this.exportPvaLoading.set(false);
          if (!blob || blob.size === 0) {
            this.showToast(this.translate.instant('WORKING_PLAN.EXPORT_PVA_FAILED'), 'error');
            return;
          }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `planned-vs-clocked-${range.from}-to-${range.to}.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
        },
        error: () => {
          this.exportPvaLoading.set(false);
          this.showToast(this.translate.instant('WORKING_PLAN.EXPORT_PVA_FAILED'), 'error');
        },
      });
  }

  exportExcel(): void {
    const uid = this.exportUserId();
    if (uid == null) return;
    const { year, month } = this.exportYearMonth();
    this.exportLoading.set(true);
    this.api.getScheduleExport(uid, year, month, this.languageService.getLanguage()).subscribe({
      next: (blob) => {
        this.exportLoading.set(false);
        if (!blob || blob.size === 0) {
          this.showToast(this.translate.instant('WORKING_PLAN.EXPORT_FAILED'), 'error');
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `working-plan-${uid}-${year}-${String(month).padStart(2, '0')}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.exportLoading.set(false);
        this.showToast(this.translate.instant('WORKING_PLAN.EXPORT_FAILED'), 'error');
      },
    });
  }

  private planDateRange(): { from: string; to: string } {
    return this.viewMode() === 'calendar' ? getMonthRange(this.calendarMonth()) : this.weekRange();
  }

  /** Loads planned-vs-clocked via HTTP for the current view range and staff dropdown (no polling). */
  private fetchPlannedVsActual(): void {
    const range = this.planDateRange();
    const gen = ++this.plannedVsActualFetchGen;
    const uid = this.exportUserId();
    this.api.getSchedulePlannedVsActual(range.from, range.to, uid).subscribe({
      next: (res) => {
        if (gen !== this.plannedVsActualFetchGen) return;
        this.plannedVsActualRows.set(res.rows);
      },
      error: () => {
        if (gen !== this.plannedVsActualFetchGen) return;
        this.plannedVsActualRows.set([]);
      },
    });
  }

  onExportUserIdSelected(value: number | null): void {
    this.exportUserId.set(value);
    this.fetchPlannedVsActual();
  }

  load(): void {
    this.loading.set(true);
    const range = this.planDateRange();
    this.api.getSchedule(range.from, range.to).subscribe({
      next: (data) => {
        this.shifts.set(data);
        this.loading.set(false);
        const user = this.api.getCurrentUser();
        if (user && String(user.role).toLowerCase() === 'owner') {
          this.api.getScheduleNotification().subscribe({
            next: (n) => this.api.workingPlanHasUpdates.set(n.has_updates),
          });
        }
        this.fetchPlannedVsActual();
        this.api.getScheduleComplianceSummary(range.from, range.to).subscribe({
          next: (res) => this.complianceWarnings.set(res.warnings),
          error: () => this.complianceWarnings.set([]),
        });
      },
      error: () => {
        this.plannedVsActualFetchGen++;
        this.shifts.set([]);
        this.plannedVsActualRows.set([]);
        this.complianceWarnings.set([]);
        this.loading.set(false);
      },
    });
  }

  setViewMode(mode: ViewMode): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(WORKING_PLAN_VIEW_KEY, mode);
    }
    this.viewMode.set(mode);
    if (mode === 'calendar') {
      this.calendarMonth.set(new Date(this.weekStart().getFullYear(), this.weekStart().getMonth(), 1));
    }
    this.router.navigate(['/working-plan', mode]);
    this.load();
  }

  prevMonth(): void {
    const d = new Date(this.calendarMonth());
    d.setMonth(d.getMonth() - 1);
    this.calendarMonth.set(d);
    this.load();
  }

  nextMonth(): void {
    const d = new Date(this.calendarMonth());
    d.setMonth(d.getMonth() + 1);
    this.calendarMonth.set(d);
    this.load();
  }

  prevWeek(): void {
    const d = new Date(this.weekStart());
    d.setDate(d.getDate() - 7);
    this.weekStart.set(d);
    this.load();
  }

  nextWeek(): void {
    const d = new Date(this.weekStart());
    d.setDate(d.getDate() + 7);
    this.weekStart.set(d);
    this.load();
  }

  goToToday(): void {
    const now = new Date();
    this.weekStart.set(now);
    this.calendarMonth.set(new Date(now.getFullYear(), now.getMonth(), 1));
    this.load();
  }

  getRoleLabel(role: string): string {
    if (!role) return '';
    const key = `USERS.ROLES.${role.toUpperCase()}`;
    const t = this.translate.instant(key);
    return t !== key ? t : role;
  }

  /** Hue 0–360 for calendar chip CSS variable --wp-shift-h. */
  shiftHue(userId: number): number {
    return hueFromUserId(userId);
  }

  /** Same permission gate as week view actions (schedule write). */
  canWriteSchedule(): boolean {
    return this.permissions.hasPermission(this.api.getCurrentUser(), 'schedule:write');
  }

  /** Owner manages all shifts; other roles only their own. */
  canManageAllSchedules(): boolean {
    return String(this.api.getCurrentUser()?.role ?? '').toLowerCase() === 'owner';
  }

  canEditShift(s: Shift): boolean {
    if (!this.canWriteSchedule()) return false;
    if (this.canManageAllSchedules()) return true;
    return s.user_id === this.api.getCurrentUser()?.id;
  }

  calendarShiftLineTrack(line: CalendarShiftLineRow, idx: number): string {
    if (line.shift) return `s-${line.shift.id}`;
    return `o-${idx}`;
  }

  calendarShiftEditAria(s: Shift): string {
    return this.translate.instant('WORKING_PLAN.CALENDAR_SHIFT_EDIT_ARIA', {
      detail: this.formatShiftLine(s),
    });
  }

  calendarShiftDeleteAria(s: Shift): string {
    return this.translate.instant('WORKING_PLAN.CALENDAR_SHIFT_DELETE_ARIA', {
      detail: this.formatShiftLine(s),
    });
  }

  onCalendarShiftDeleteClick(ev: Event, s: Shift): void {
    ev.stopPropagation();
    this.confirmDelete(s);
  }

  /** One line per shift for the calendar cell (name, role, time). */
  private formatShiftLine(s: Shift): string {
    const name = (s.user_name || '').trim();
    const role = this.getRoleLabel(s.user_role || '');
    const time = `${s.start_time}–${s.end_time}`;
    if (name && role) return `${name} (${role}) ${time}`;
    if (name) return `${name} ${time}`;
    return time;
  }

  /** After save, show the shift in calendar/week: jump to the saved date’s month and week. */
  private focusScheduleOnDate(isoDate: string): void {
    const d = new Date(isoDate + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return;
    this.weekStart.set(new Date(d));
    if (this.viewMode() === 'calendar') {
      const cm = this.calendarMonth();
      if (d.getFullYear() !== cm.getFullYear() || d.getMonth() !== cm.getMonth()) {
        this.calendarMonth.set(new Date(d.getFullYear(), d.getMonth(), 1));
      }
    }
  }

  openCreate(): void {
    this.editingShift.set(null);
    const users = this.assignableScheduleUsers();
    const currentUser = this.api.getCurrentUser();
    const currentId = currentUser?.id;
    this.formUserId = currentId != null && users.some((u) => u.id === currentId) ? currentId : (users[0]?.id ?? null);
    this.formDate = this.getSuggestedDateForNewShift();
    this.formTimeStep = 30;
    this.formUseAnyHour = false;
    this.formStartTime = '09:00';
    this.formEndTime = '14:00';
    this.formSplitShift = false;
    this.formStartTime2 = '16:00';
    this.formEndTime2 = '20:00';
    this.formLabel = '';
    this.formError.set(null);
    this.showModal.set(true);
    this.onFormDateChange(this.formDate);
  }

  openEdit(s: Shift): void {
    this.editingShift.set(s);
    this.formUserId = s.user_id;
    this.formDate = s.date || '';
    this.formStartTime = s.start_time || '09:00';
    this.formEndTime = s.end_time || '14:00';
    this.formSplitShift = false;
    this.formLabel = s.label || '';
    this.formError.set(null);
    this.showModal.set(true);
    // If shift times are outside opening-hours range, enable "any hour" so they remain selectable
    this.formUseAnyHour = false;
    const optsRestricted = this.timeOptsForSelectedDay();
    if (!optsRestricted.includes(this.formStartTime) || !optsRestricted.includes(this.formEndTime)) {
      this.formUseAnyHour = true;
    }
    this.clampFormTimes();
  }

  closeModal(): void {
    this.showModal.set(false);
    this.editingShift.set(null);
    this.formError.set(null);
  }

  showToast(message: string, type: 'success' | 'error'): void {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = undefined;
    this.toast.set({ message, type });
  }

  dismissToast(): void {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = undefined;
    this.toast.set(null);
  }

  saveShift(): void {
    this.formError.set(null);
    if (this.formUserId == null) {
      this.formError.set('Please select a user');
      return;
    }
    if (!this.formDate) {
      this.formError.set('Please select a date');
      return;
    }
    const start = this.formStartTime;
    const end = this.formEndTime;
    if (start >= end) {
      this.formError.set(this.translate.instant('WORKING_PLAN.BULK_ERR_TIMES'));
      return;
    }
    const split = this.formSplitShift && !this.editingShift();
    if (split) {
      if (this.timeOptsForBlock2Start().length === 0) {
        this.formError.set(this.translate.instant('WORKING_PLAN.SPLIT_ERR_NO_ROOM'));
        return;
      }
      const s2 = this.formStartTime2;
      const e2 = this.formEndTime2;
      if (s2 <= end) {
        this.formError.set(this.translate.instant('WORKING_PLAN.SPLIT_ERR_ORDER'));
        return;
      }
      if (s2 >= e2) {
        this.formError.set(this.translate.instant('WORKING_PLAN.SPLIT_ERR_BLOCK2_TIMES'));
        return;
      }
    }
    const edit = this.editingShift();
    if (edit) {
      const payload: ShiftUpdate = {
        user_id: this.formUserId,
        date: this.formDate,
        start_time: start,
        end_time: end,
        label: this.formLabel || null,
      };
      this.api.updateShift(edit.id, payload).subscribe({
        next: () => {
          this.focusScheduleOnDate(this.formDate);
          this.closeModal();
          this.load();
          this.showToast(this.translate.instant('WORKING_PLAN.UPDATED'), 'success');
        },
        error: (err) => {
          const msg = this.getApiErrorMessage(err);
          this.formError.set(msg);
          this.showToast(msg, 'error');
        },
      });
    } else if (split) {
      const label = this.formLabel || null;
      const payload1: ShiftCreate = {
        user_id: this.formUserId,
        date: this.formDate,
        start_time: start,
        end_time: end,
        label,
      };
      const payload2: ShiftCreate = {
        user_id: this.formUserId,
        date: this.formDate,
        start_time: this.formStartTime2,
        end_time: this.formEndTime2,
        label,
      };
      this.api.createShift(payload1).subscribe({
        next: (createdFirst) => {
          this.api.createShift(payload2).subscribe({
            next: () => {
              this.focusScheduleOnDate(this.formDate);
              this.closeModal();
              this.load();
              this.showToast(this.translate.instant('WORKING_PLAN.SAVED'), 'success');
            },
            error: (err) => {
              const msg = this.getApiErrorMessage(err);
              this.api.deleteShift(createdFirst.id).subscribe({
                next: () => {
                  this.formError.set(msg);
                  this.showToast(msg, 'error');
                },
                error: () => {
                  const rb = this.translate.instant('WORKING_PLAN.SPLIT_ROLLBACK_FAILED');
                  this.formError.set(rb);
                  this.showToast(rb, 'error');
                },
              });
            },
          });
        },
        error: (err) => {
          const msg = this.getApiErrorMessage(err);
          this.formError.set(msg);
          this.showToast(msg, 'error');
        },
      });
    } else {
      const payload: ShiftCreate = {
        user_id: this.formUserId,
        date: this.formDate,
        start_time: start,
        end_time: end,
        label: this.formLabel || null,
      };
      this.api.createShift(payload).subscribe({
        next: () => {
          this.focusScheduleOnDate(this.formDate);
          this.closeModal();
          this.load();
          this.showToast(this.translate.instant('WORKING_PLAN.SAVED'), 'success');
        },
        error: (err) => {
          const msg = this.getApiErrorMessage(err);
          this.formError.set(msg);
          this.showToast(msg, 'error');
        },
      });
    }
  }

  private getApiErrorMessage(err: unknown): string {
    return this.apiErr.fromHttpError(err as HttpErrorResponse, 'WORKING_PLAN.SAVE_FAILED');
  }

  confirmDelete(s: Shift): void {
    this.deleteTarget.set(s);
  }

  doDelete(): void {
    const s = this.deleteTarget();
    if (!s) return;
    this.api.deleteShift(s.id).subscribe({
      next: () => {
        this.deleteTarget.set(null);
        this.load();
        this.showToast(this.translate.instant('WORKING_PLAN.DELETED'), 'success');
      },
      error: (_err) => {
        this.deleteTarget.set(null);
        this.showToast(this.translate.instant('WORKING_PLAN.DELETE_FAILED'), 'error');
      },
    });
  }
}
