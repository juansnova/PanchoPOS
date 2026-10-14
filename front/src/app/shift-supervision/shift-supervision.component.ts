import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import { ApiService, StaffActivity, WorkSession } from '../services/api.service';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Component({
  selector: 'app-shift-supervision',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    <div class="shift-supervision-page" data-testid="shift-supervision-page">
      <div class="page-header">
        <h1>{{ 'SHIFT_SUPERVISION.TITLE' | translate }}</h1>
        <p class="subtitle">{{ 'SHIFT_SUPERVISION.SUBTITLE' | translate }}</p>
      </div>

      @if (error()) {
        <div class="error-banner">{{ error() }}</div>
      }

      <section class="card">
        <h2>{{ 'SHIFT_SUPERVISION.LIVE_TITLE' | translate }}</h2>
        @if (loadingLive()) {
          <p class="muted">{{ 'SHIFT_SUPERVISION.LOADING' | translate }}</p>
        } @else if (live().length === 0) {
          <p class="muted">{{ 'SHIFT_SUPERVISION.LIVE_EMPTY' | translate }}</p>
        } @else {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{{ 'SHIFT_SUPERVISION.COL_EMPLOYEE' | translate }}</th>
                  <th>{{ 'SHIFT_SUPERVISION.COL_ROLE' | translate }}</th>
                  <th>{{ 'SHIFT_SUPERVISION.COL_START' | translate }}</th>
                  <th>{{ 'SHIFT_SUPERVISION.COL_STATUS' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                @for (row of live(); track row.id) {
                  <tr>
                    <td>{{ row.user_name }}</td>
                    <td>{{ roleLabel(row.user_role) }}</td>
                    <td>{{ formatDt(row.started_at) }}</td>
                    <td>
                      @if (row.on_break) {
                        <span class="status-badge status-break">{{ 'SHIFT_SUPERVISION.ON_BREAK' | translate }}</span>
                      } @else {
                        <span class="status-badge status-working">{{ 'SHIFT_SUPERVISION.WORKING' | translate }}</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <section class="card">
        <div class="range-row">
          <h2>{{ 'SHIFT_SUPERVISION.RANGE_TITLE' | translate }}</h2>
          <div class="range-controls">
            <label>
              {{ 'SHIFT_SUPERVISION.FROM' | translate }}
              <input type="date" [(ngModel)]="fromDate" [max]="toDate">
            </label>
            <label>
              {{ 'SHIFT_SUPERVISION.TO' | translate }}
              <input type="date" [(ngModel)]="toDate" [min]="fromDate">
            </label>
            <button type="button" class="btn btn-secondary" (click)="loadRange()" [disabled]="loadingRange()">
              {{ loadingRange() ? ('SHIFT_SUPERVISION.LOADING' | translate) : ('SHIFT_SUPERVISION.APPLY' | translate) }}
            </button>
          </div>
        </div>

        <h3>{{ 'SHIFT_SUPERVISION.ACTIVITY_TITLE' | translate }}</h3>
        <p class="hint">{{ 'SHIFT_SUPERVISION.ACTIVITY_HINT' | translate }}</p>
        @if (loadingRange()) {
          <p class="muted">{{ 'SHIFT_SUPERVISION.LOADING' | translate }}</p>
        } @else if (activity().length === 0) {
          <p class="muted">{{ 'SHIFT_SUPERVISION.ACTIVITY_EMPTY' | translate }}</p>
        } @else {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{{ 'SHIFT_SUPERVISION.COL_EMPLOYEE' | translate }}</th>
                  <th>{{ 'SHIFT_SUPERVISION.COL_ROLE' | translate }}</th>
                  <th>{{ 'SHIFT_SUPERVISION.COL_SHIFTS' | translate }}</th>
                  <th>{{ 'SHIFT_SUPERVISION.COL_HOURS' | translate }}</th>
                  <th>{{ 'SHIFT_SUPERVISION.COL_PREPARED' | translate }}</th>
                  <th>{{ 'SHIFT_SUPERVISION.COL_DELIVERED' | translate }}</th>
                  <th>{{ 'SHIFT_SUPERVISION.COL_REMOVED' | translate }}</th>
                  <th>{{ 'SHIFT_SUPERVISION.COL_ORDERS_PAID' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                @for (row of activity(); track row.user_id) {
                  <tr>
                    <td>{{ row.user_name }}</td>
                    <td>{{ roleLabel(row.user_role) }}</td>
                    <td>{{ row.shifts_count }}</td>
                    <td>{{ formatHours(row.worked_minutes) }}</td>
                    <td>{{ row.items_prepared }}</td>
                    <td>{{ row.items_delivered }}</td>
                    <td>{{ row.items_removed }}</td>
                    <td>{{ row.orders_paid }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <h3>{{ 'SHIFT_SUPERVISION.HISTORY_TITLE' | translate }}</h3>
        @if (loadingRange()) {
          <p class="muted">{{ 'SHIFT_SUPERVISION.LOADING' | translate }}</p>
        } @else if (history().length === 0) {
          <p class="muted">{{ 'SHIFT_SUPERVISION.HISTORY_EMPTY' | translate }}</p>
        } @else {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{{ 'SHIFT_SUPERVISION.COL_EMPLOYEE' | translate }}</th>
                  <th>{{ 'SHIFT_SUPERVISION.COL_START' | translate }}</th>
                  <th>{{ 'SHIFT_SUPERVISION.COL_END' | translate }}</th>
                  <th>{{ 'SHIFT_SUPERVISION.COL_DURATION' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                @for (row of history(); track row.id) {
                  <tr [class.open-row]="!row.ended_at">
                    <td>{{ row.user_name }}</td>
                    <td>{{ formatDt(row.started_at) }}</td>
                    <td>{{ row.ended_at ? formatDt(row.ended_at) : '—' }}</td>
                    <td>{{ formatDuration(row) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </div>
  `,
  styles: `
    .shift-supervision-page {
      max-width: 960px;
    }
    .page-header { margin-bottom: var(--space-4, 1rem); }
    .page-header h1 { margin: 0 0 4px; }
    .subtitle { color: var(--color-text-muted, #6b7280); margin: 0; }
    .card {
      background: var(--color-surface, #fff);
      border: 1px solid var(--color-border, #e5e7eb);
      border-radius: var(--radius-md, 8px);
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .card h2 { margin: 0 0 0.75rem; font-size: 1.05rem; }
    .card h3 { margin: 1.25rem 0 0.25rem; font-size: 0.95rem; }
    .hint { color: var(--color-text-muted, #6b7280); font-size: 0.85rem; margin: 0 0 0.75rem; }
    .muted { color: var(--color-text-muted, #6b7280); }
    .error-banner {
      background: #fee2e2;
      color: #991b1b;
      padding: 0.75rem 1rem;
      border-radius: var(--radius-md, 8px);
      margin-bottom: 1rem;
    }
    .range-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; }
    .range-row h2 { margin: 0; }
    .range-controls { display: flex; flex-wrap: wrap; align-items: end; gap: 0.75rem; }
    .range-controls label {
      display: flex;
      flex-direction: column;
      font-size: 0.8rem;
      color: var(--color-text-muted, #6b7280);
      gap: 2px;
    }
    .range-controls input[type="date"] {
      padding: 0.4rem 0.5rem;
      border: 1px solid var(--color-border, #e5e7eb);
      border-radius: var(--radius-sm, 6px);
    }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--color-border, #e5e7eb); white-space: nowrap; }
    tr.open-row td { font-weight: 600; }
    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .status-working { background: #dcfce7; color: #166534; }
    .status-break { background: #fef3c7; color: #92400e; }
  `,
})
export class ShiftSupervisionComponent implements OnInit {
  private api = inject(ApiService);
  private translate = inject(TranslateService);

  error = signal<string | null>(null);

  loadingLive = signal(true);
  live = signal<WorkSession[]>([]);

  loadingRange = signal(true);
  history = signal<WorkSession[]>([]);
  activity = signal<StaffActivity[]>([]);

  fromDate: string;
  toDate: string;

  constructor() {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    this.toDate = isoDate(today);
    this.fromDate = isoDate(weekAgo);
  }

  ngOnInit(): void {
    this.loadLive();
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
        this.activity.set(activity);
        this.loadingRange.set(false);
      },
      error: () => {
        this.error.set(this.translate.instant('SHIFT_SUPERVISION.ERR_LOAD'));
        this.loadingRange.set(false);
      },
    });
  }

  roleLabel(role: string | null | undefined): string {
    if (!role) return '';
    return this.translate.instant(`USERS.ROLES.${role.toUpperCase()}`);
  }

  formatDt(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  formatDuration(row: WorkSession): string {
    if (row.duration_minutes != null && row.duration_minutes >= 0) {
      return this.formatHours(row.duration_minutes);
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
