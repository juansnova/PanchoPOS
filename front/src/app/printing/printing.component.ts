import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SidebarComponent } from '../shared/sidebar.component';
import { ConfirmationModalComponent } from '../shared/confirmation-modal.component';
import { ApiService, PrintAgent, PrintJob } from '../services/api.service';

const POLL_MS = 3000;
/** A job claimed this long ago without a result means the agent died mid-print. */
const STUCK_AFTER_MS = 60_000;

type JobFilter = 'all' | 'queue' | 'failed' | 'done';

const ICON: Record<string, string> = {
  printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="9" rx="2"/><path d="M6 14h12v7H6z"/><path d="M17 12h.01"/>',
  kitchen: '<path d="M7 14a4 4 0 01-.5-7.9A5 5 0 0112 3a5 5 0 015.5 3.1A4 4 0 0117 14v6H7z"/><path d="M7 17h10"/>',
  bar: '<path d="M5 4h14l-7 9z"/><path d="M12 13v7M8 20h8"/>',
  receipt: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h3"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  usb: '<circle cx="10" cy="19" r="2"/><path d="M10 17V5M10 5l-3 3M10 5l3 3M10 12h6v3M16 15v2"/><circle cx="16" cy="19" r="1.5"/>',
  pc: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8M12 16v5"/>',
};

@Component({
  selector: 'app-printing',
  standalone: true,
  imports: [CommonModule, FormsModule, SidebarComponent, TranslateModule, ConfirmationModalComponent],
  template: `
    <app-sidebar>
      <div class="printing-page">
        <div class="pr-hero" [class.is-online]="online()" [class.is-offline]="loaded() && !online()">
          <span class="pr-hero-ico" [innerHTML]="icon('printer', 34)" aria-hidden="true"></span>
          <div class="pr-hero-text">
            <h1>{{ 'PRINTING.TITLE' | translate }}</h1>
            <p>{{ 'PRINTING.SUBTITLE' | translate }}</p>
          </div>
          <div class="pr-hero-actions">
            <button type="button" class="pr-btn pr-btn-light" data-testid="test-print" (click)="testPrint()">
              <span [innerHTML]="icon('bolt', 18)" aria-hidden="true"></span>{{ 'PRINTING.TEST_PRINT' | translate }}
            </button>
            <button type="button" class="pr-btn pr-btn-clear" data-testid="clear-queue" [disabled]="jobs().length === 0" (click)="showClearConfirm.set(true)">
              <span [innerHTML]="icon('trash', 18)" aria-hidden="true"></span>{{ 'PRINTING.CLEAR_QUEUE' | translate }}
            </button>
          </div>
        </div>

        @if (message()) {
          <div class="flash" [class.flash-error]="messageIsError()">{{ message() }}</div>
        }

        <section class="status-card" [class.online]="online()" [class.offline]="!online()" data-testid="agent-status">
          <span class="dot"></span>
          <div class="status-text">
            <strong>{{ (online() ? 'PRINTING.AGENT_ONLINE' : 'PRINTING.AGENT_OFFLINE') | translate }}</strong>
            @if (agents().length === 0 && loaded()) {
              <span class="muted">{{ 'PRINTING.AGENT_NONE' | translate }}</span>
            } @else if (!online() && loaded()) {
              <span class="muted">{{ 'PRINTING.AGENT_OFFLINE_HELP' | translate }}</span>
            }
          </div>
        </section>

        <div class="pr-kpis">
          <div class="pr-kpi pr-kpi-queue">
            <b>{{ count('pending') + count('claimed') }}</b>
            <span>{{ 'PRINTING.COUNT_PENDING' | translate }}</span>
          </div>
          <div class="pr-kpi pr-kpi-failed" [class.has]="count('failed') > 0">
            <b>{{ count('failed') }}</b>
            <span>{{ 'PRINTING.COUNT_FAILED' | translate }}</span>
          </div>
          <div class="pr-kpi pr-kpi-done">
            <b>{{ count('done') }}</b>
            <span>{{ 'PRINTING.COUNT_DONE' | translate }}</span>
          </div>
        </div>

        <section class="card">
          <h2><span class="pr-dot"></span>{{ 'PRINTING.QUEUE' | translate }}</h2>
          <div class="pr-chips">
            @for (f of filters; track f.key) {
              <button type="button" class="pr-chip" [attr.data-f]="f.key" [class.on]="filter() === f.key" (click)="filter.set(f.key)">
                {{ f.label | translate }} <i>{{ countFilter(f.key) }}</i>
              </button>
            }
          </div>

          @if (jobs().length === 0 && loaded()) {
            <div class="pr-empty">
              <span [innerHTML]="icon('printer', 44)" aria-hidden="true"></span>
              <p>{{ 'PRINTING.EMPTY' | translate }}</p>
            </div>
          } @else {
            <div class="pr-jobs">
              @for (job of visibleJobs(); track job.id) {
                <article class="pr-job" [attr.data-s]="displayStatus(job)" data-testid="job-row">
                  <span class="pr-job-ico" [attr.data-t]="roleOf(job)" [innerHTML]="icon(roleOf(job), 24)" aria-hidden="true"></span>
                  <div class="pr-job-main">
                    <div class="pr-job-top">
                      <b>{{ typeLabel(job) }}</b>
                      <span class="pr-job-order">{{ job.order_id ? '#' + job.order_id : '' }}</span>
                    </div>
                    <small>{{ job.created_at | date: 'dd/MM HH:mm:ss' }}</small>
                    @if (job.error_message) {
                      <em class="error-text">{{ job.error_message }}</em>
                    }
                  </div>
                  <span class="badge" [class]="'badge-' + displayStatus(job)">{{ statusLabel(job) }}</span>
                  <div class="row-actions">
                    @if (job.status === 'failed' || isStuck(job)) {
                      <button type="button" class="btn-small btn-retry" data-testid="retry-job" (click)="retry(job)">
                        {{ 'PRINTING.RETRY' | translate }}
                      </button>
                    }
                    <button type="button" class="btn-small btn-ghost" (click)="toggleTicket(job.id)">
                      {{ (openTicket() === job.id ? 'PRINTING.HIDE_TICKET' : 'PRINTING.SHOW_TICKET') | translate }}
                    </button>
                  </div>
                  @if (openTicket() === job.id) {
                    <div class="pr-paper-wrap"><pre class="pr-paper">{{ ticketText(job) }}</pre></div>
                  }
                </article>
              }
            </div>
          }
        </section>

        <section class="card">
          <h2><span class="pr-dot pr-dot-blue"></span>{{ 'PRINTING.AGENTS' | translate }}</h2>
          <div class="pr-agents">
            @for (agent of agents(); track agent.id) {
              <div class="agent-row" [class.revoked]="agent.revoked_at">
                <span class="pr-agent-ico" [class.on]="agent.online && !agent.revoked_at" [innerHTML]="icon('pc', 22)" aria-hidden="true"></span>
                <div class="agent-info">
                  <strong>{{ agent.display_name }}</strong>
                  <span class="muted">{{ agent.device_id }} · {{ 'PRINTING.LAST_SEEN' | translate }}:
                    {{ agent.last_seen_at ? (agent.last_seen_at | date: 'dd/MM HH:mm:ss') : ('PRINTING.NEVER' | translate) }}</span>
                </div>
                @if (agent.revoked_at) {
                  <span class="badge badge-cancelled">{{ 'PRINTING.REVOKED' | translate }}</span>
                } @else {
                  <button type="button" class="btn-small btn-ghost" (click)="revoke(agent)">{{ 'PRINTING.REVOKE' | translate }}</button>
                }
              </div>
            }
          </div>

          <form class="new-agent" (ngSubmit)="createAgent()">
            <input type="text" name="agentName" [(ngModel)]="newAgentName" [placeholder]="'PRINTING.AGENT_NAME' | translate" required />
            <button type="submit" class="pr-btn pr-btn-main" [disabled]="!newAgentName.trim()">{{ 'PRINTING.NEW_AGENT' | translate }}</button>
          </form>

          @if (createdToken()) {
            <div class="token-box" data-testid="agent-token">
              <p><strong>{{ 'PRINTING.TOKEN_ONCE' | translate }}</strong></p>
              <p class="muted">{{ 'PRINTING.RUN_COMMAND' | translate }}</p>
              <pre class="ticket">{{ runCommand() }}</pre>
              <button type="button" class="btn-small" (click)="copy(runCommand())">
                {{ (copied() ? 'PRINTING.COPIED' : 'PRINTING.COPY') | translate }}
              </button>
            </div>
          }
        </section>

        <section class="card pr-help">
          <span class="pr-help-ico" [innerHTML]="icon('usb', 28)" aria-hidden="true"></span>
          <div>
            <h2>{{ 'PRINTING.USB_HELP_TITLE' | translate }}</h2>
            <p class="muted">{{ 'PRINTING.USB_HELP' | translate }}</p>
            <pre class="ticket">python scripts/print-agent/print_agent.py --list-printers</pre>
          </div>
        </section>

        @if (showClearConfirm()) {
          <app-confirmation-modal
            [title]="'PRINTING.CLEAR_CONFIRM_TITLE' | translate"
            [message]="'PRINTING.CLEAR_CONFIRM_MESSAGE' | translate"
            [confirmText]="'PRINTING.CLEAR_QUEUE' | translate"
            [cancelText]="'COMMON.CANCEL' | translate"
            [confirmBtnClass]="'btn-danger'"
            (confirm)="clearQueue()"
            (cancel)="showClearConfirm.set(false)"
          ></app-confirmation-modal>
        }
      </div>
    </app-sidebar>
  `,
  styles: [`
    .printing-page { max-width: 1100px; display: flex; flex-direction: column; gap: var(--space-4); }
    .muted { color: var(--color-text-muted); font-size: 0.875rem; margin: 0; }
    h2 { display: flex; align-items: center; gap: 10px; font-size: 1.1rem; font-weight: 800; margin: 0 0 var(--space-3); color: var(--color-text); }

    .pr-hero {
      position: relative;
      display: flex;
      align-items: center;
      gap: 18px;
      flex-wrap: wrap;
      padding: 22px 26px;
      border-radius: 24px;
      color: #fff;
      overflow: hidden;
      background:
        radial-gradient(circle at 90% 10%, rgba(253, 224, 71, 0.55) 0, transparent 30%),
        radial-gradient(circle at 70% 120%, rgba(168, 85, 247, 0.5) 0, transparent 36%),
        linear-gradient(120deg, #f97316 0%, #f43f5e 62%, #db2777 100%);
      box-shadow: 0 18px 34px -22px #f43f5e;
    }
    .pr-hero > * { position: relative; z-index: 1; }
    .pr-hero-ico {
      flex: none;
      display: grid;
      place-items: center;
      width: 64px;
      height: 64px;
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.2);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
    }
    .pr-hero-text { flex: 1; min-width: 200px; }
    .pr-hero h1 { margin: 0; font-size: 1.8rem; font-weight: 800; letter-spacing: -0.02em; }
    .pr-hero p { margin: 2px 0 0; opacity: 0.88; font-weight: 600; }
    .pr-hero-actions { display: flex; flex-wrap: wrap; gap: 10px; }

    .pr-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 46px;
      padding: 0 22px;
      border-radius: 999px;
      border: 0;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
      touch-action: manipulation;
    }
    .pr-btn span { display: inline-flex; }
    .pr-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .pr-btn-light { background: #fff; color: #e11d48; box-shadow: 0 10px 20px -12px rgba(0, 0, 0, 0.5); }
    .pr-btn-light:hover { filter: brightness(0.96); }
    .pr-btn-clear { background: rgba(255, 255, 255, 0.18); color: #fff; border: 1px solid rgba(255, 255, 255, 0.6); }
    .pr-btn-clear:hover:not(:disabled) { background: #dc2626; border-color: #dc2626; }
    .pr-btn-main { background: var(--color-primary); color: #fff; box-shadow: 0 10px 20px -12px var(--color-primary); }
    .pr-btn-main:hover:not(:disabled) { filter: brightness(1.07); }

    .btn-small { min-height: 36px; padding: 0 16px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-surface, #fff); color: var(--color-text); font: inherit; font-size: 0.8rem; font-weight: 700; cursor: pointer; }
    .btn-small:hover { border-color: var(--color-primary); color: var(--color-primary); }
    .btn-ghost { background: transparent; }
    .btn-retry { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
    .btn-retry:hover { color: #fff; filter: brightness(1.07); }

    .flash { padding: var(--space-3) var(--space-4); border-radius: 16px; background: #d1fae5; color: #065f46; font-weight: 700; }
    .flash-error { background: #fee2e2; color: #991b1b; }

    .card, .status-card { background: var(--color-surface, #fff); border: 1px solid var(--color-border); border-radius: 22px; padding: var(--space-4) var(--space-5); }
    .status-card { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
    .status-card.online { border-color: #34d399; background: linear-gradient(100deg, rgba(16, 185, 129, 0.1), var(--color-surface, #fff) 60%); }
    .status-card.offline { border-color: #f87171; background: linear-gradient(100deg, rgba(239, 68, 68, 0.08), var(--color-surface, #fff) 60%); }
    .status-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 220px; }
    .dot { width: 14px; height: 14px; border-radius: 50%; background: #9ca3af; flex: none; }
    .online .dot { background: #10b981; box-shadow: 0 0 0 4px #d1fae5; animation: pr-pulse 2s ease-out infinite; }
    .offline .dot { background: #ef4444; box-shadow: 0 0 0 4px #fee2e2; }
    @keyframes pr-pulse { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5); } 100% { box-shadow: 0 0 0 12px rgba(16, 185, 129, 0); } }
    @media (prefers-reduced-motion: reduce) { .online .dot { animation: none; } }

    .pr-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .pr-kpi { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 16px; border-radius: 20px; border: 1px solid var(--color-border); background: var(--color-surface, #fff); }
    .pr-kpi b { font-size: 2rem; font-weight: 800; font-variant-numeric: tabular-nums; }
    .pr-kpi span { font-size: 0.72rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-muted); }
    .pr-kpi-queue { background: linear-gradient(160deg, rgba(245, 158, 11, 0.14), var(--color-surface, #fff) 70%); border-color: #f3c46b; }
    .pr-kpi-queue b { color: #b45309; }
    .pr-kpi-failed.has { background: linear-gradient(160deg, rgba(220, 38, 38, 0.12), var(--color-surface, #fff) 70%); border-color: #f5a3a3; }
    .pr-kpi-failed.has b { color: #dc2626; }
    .pr-kpi-done { background: linear-gradient(160deg, rgba(63, 157, 98, 0.14), var(--color-surface, #fff) 70%); border-color: #9bd2b0; }
    .pr-kpi-done b { color: #2f7a4c; }

    .pr-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--color-primary); box-shadow: 0 0 0 4px var(--color-primary-light); }
    .pr-dot-blue { background: #3b82f6; box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.18); }

    .pr-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .pr-chip { display: inline-flex; align-items: center; gap: 8px; min-height: 38px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--color-border); background: var(--color-surface, #fff); color: var(--color-text); font: inherit; font-size: 0.82rem; font-weight: 700; cursor: pointer; }
    .pr-chip i { font-style: normal; min-width: 22px; padding: 0 6px; border-radius: 999px; background: var(--color-bg); font-size: 0.74rem; text-align: center; }
    .pr-chip:hover { border-color: var(--color-primary); }
    .pr-chip.on { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
    .pr-chip.on i { background: rgba(255, 255, 255, 0.25); }

    .pr-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 34px 20px; border-radius: 20px; border: 2px dashed var(--color-border); color: var(--color-text-muted); text-align: center; }
    .pr-empty span { color: var(--color-primary); opacity: 0.7; }
    .pr-empty p { margin: 0; font-weight: 600; }

    .pr-jobs { display: flex; flex-direction: column; gap: 10px; }
    .pr-job {
      --k: #9ca3af;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 14px;
      padding: 12px 16px;
      border-radius: 18px;
      border: 1px solid color-mix(in srgb, var(--k) 45%, var(--color-border));
      background: linear-gradient(100deg, color-mix(in srgb, var(--k) 8%, var(--color-surface, #fff)), var(--color-surface, #fff) 45%);
    }
    .pr-job[data-s='pending'] { --k: #f59e0b; }
    .pr-job[data-s='claimed'] { --k: #3b82f6; }
    .pr-job[data-s='done'] { --k: #3f9d62; }
    .pr-job[data-s='failed'], .pr-job[data-s='stuck'] { --k: #dc2626; background: linear-gradient(90deg, rgba(220, 38, 38, 0.06), var(--color-surface, #fff) 50%); }
    .pr-job-ico { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 15px; color: #fff; background: linear-gradient(145deg, #f59e0b, #d97706); box-shadow: 0 10px 16px -10px #d97706; }
    .pr-job-ico[data-t='bar'] { background: linear-gradient(145deg, #6cb2ee, #2f86d6); box-shadow: 0 10px 16px -10px #2f86d6; }
    .pr-job-ico[data-t='receipt'] { background: linear-gradient(145deg, #62c58f, #2f9e64); box-shadow: 0 10px 16px -10px #2f9e64; }
    .pr-job-main { min-width: 0; }
    .pr-job-top { display: flex; align-items: baseline; gap: 8px; }
    .pr-job-top b { font-weight: 800; }
    .pr-job-order { font-weight: 800; color: var(--color-primary); font-size: 0.85rem; }
    .pr-job small { display: block; font-size: 0.74rem; font-weight: 700; color: var(--color-text-muted); }
    .error-text { display: block; margin-top: 3px; font-style: normal; color: #b91c1c; font-size: 0.8rem; word-break: break-word; }
    .row-actions { display: flex; gap: var(--space-2); justify-content: flex-end; flex-wrap: wrap; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 0.74rem; font-weight: 800; }
    .badge-pending { background: #fef3c7; color: #92400e; }
    .badge-claimed { background: #dbeafe; color: #1e40af; }
    .badge-done { background: #d1fae5; color: #065f46; }
    .badge-failed, .badge-stuck { background: #fee2e2; color: #991b1b; }
    .badge-cancelled { background: #e5e7eb; color: #374151; }
    @media (max-width: 760px) {
      .pr-job { grid-template-columns: auto minmax(0, 1fr) auto; }
      .pr-job .row-actions { grid-column: 1 / -1; justify-content: flex-start; }
    }

    .pr-paper-wrap { grid-column: 1 / -1; display: flex; justify-content: center; padding: 6px 0 2px; }
    .pr-paper {
      width: min(340px, 100%);
      margin: 0;
      padding: 16px 18px 22px;
      background: #fffdf6;
      color: #1f2937;
      font-family: 'Courier New', monospace;
      font-size: 0.8rem;
      white-space: pre-wrap;
      border-radius: 4px 4px 0 0;
      box-shadow: 0 14px 26px -18px rgba(0, 0, 0, 0.6);
      -webkit-mask: conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) 50% / 14px 100%;
      mask: conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) 50% / 14px 100%;
    }

    .ticket { background: #111827; color: #e5e7eb; padding: var(--space-3); border-radius: 14px; font-size: 0.8rem; overflow-x: auto; margin: var(--space-2) 0; white-space: pre-wrap; }

    .pr-agents { display: flex; flex-direction: column; gap: 10px; }
    .agent-row { display: flex; align-items: center; gap: var(--space-3); padding: 10px 14px; border-radius: 16px; border: 1px solid var(--color-border); }
    .agent-row.revoked { opacity: 0.6; }
    .pr-agent-ico { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 14px; background: var(--color-bg); color: var(--color-text-muted); flex: none; }
    .pr-agent-ico.on { background: rgba(16, 185, 129, 0.15); color: #059669; }
    .agent-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .new-agent { display: flex; gap: var(--space-3); margin-top: var(--space-3); flex-wrap: wrap; }
    .new-agent input { flex: 1; min-width: 200px; min-height: 46px; padding: 0 16px; border: 1px solid var(--color-border); border-radius: 14px; font: inherit; }
    .new-agent input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
    .token-box { margin-top: var(--space-3); padding: var(--space-3) var(--space-4); border: 2px dashed #f59e0b; border-radius: 18px; background: #fffbeb; }

    .pr-help { display: flex; gap: 16px; align-items: flex-start; background: linear-gradient(120deg, rgba(59, 130, 246, 0.08), var(--color-surface, #fff) 60%); }
    .pr-help h2 { margin-bottom: 6px; }
    .pr-help-ico { flex: none; display: grid; place-items: center; width: 54px; height: 54px; border-radius: 18px; color: #fff; background: linear-gradient(145deg, #6cb2ee, #2f86d6); box-shadow: 0 12px 18px -12px #2f86d6; }
  `],
})
export class PrintingComponent implements OnInit {
  private api = inject(ApiService);
  private translate = inject(TranslateService);
  private destroyRef = inject(DestroyRef);
  private sanitizer = inject(DomSanitizer);

  jobs = signal<PrintJob[]>([]);
  agents = signal<PrintAgent[]>([]);
  loaded = signal(false);
  message = signal('');
  messageIsError = signal(false);
  openTicket = signal<number | null>(null);
  createdToken = signal('');
  copied = signal(false);
  showClearConfirm = signal(false);
  filter = signal<JobFilter>('all');
  newAgentName = '';

  readonly filters: { key: JobFilter; label: string }[] = [
    { key: 'all', label: 'PRINTING.FILTER_ALL' },
    { key: 'queue', label: 'PRINTING.COUNT_PENDING' },
    { key: 'failed', label: 'PRINTING.COUNT_FAILED' },
    { key: 'done', label: 'PRINTING.COUNT_DONE' },
  ];

  online = computed(() => this.agents().some((a) => a.online && !a.revoked_at));
  visibleJobs = computed(() => this.jobs().filter((j) => this.matches(j, this.filter())));
  private now = signal(Date.now());

  ngOnInit(): void {
    this.refresh();
    const timer = setInterval(() => {
      this.now.set(Date.now());
      this.refresh();
    }, POLL_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  icon(name: string, size: number): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name] ?? ICON['printer']}</svg>`
    );
  }

  refresh(): void {
    this.api.listPrintJobs(50).subscribe({
      next: (jobs) => {
        this.jobs.set(jobs);
        this.loaded.set(true);
      },
      error: () => this.flash(this.translate.instant('PRINTING.LOAD_ERROR'), true),
    });
    this.api.listPrintAgents().subscribe({
      next: (agents) => this.agents.set(agents),
      error: () => this.flash(this.translate.instant('PRINTING.LOAD_ERROR'), true),
    });
  }

  count(status: string): number {
    return this.jobs().filter((j) => j.status === status).length;
  }

  private matches(job: PrintJob, f: JobFilter): boolean {
    if (f === 'all') return true;
    if (f === 'queue') return job.status === 'pending' || job.status === 'claimed';
    return job.status === f;
  }

  countFilter(f: JobFilter): number {
    return this.jobs().filter((j) => this.matches(j, f)).length;
  }

  /** Icon/colour family of a job: kitchen, bar or receipt. */
  roleOf(job: PrintJob): 'kitchen' | 'bar' | 'receipt' {
    if (job.printer_role === 'bar') return 'bar';
    return job.job_type === 'kitchen' ? 'kitchen' : 'receipt';
  }

  isStuck(job: PrintJob): boolean {
    if (job.status !== 'claimed' || !job.claimed_at) return false;
    return this.now() - new Date(job.claimed_at).getTime() > STUCK_AFTER_MS;
  }

  displayStatus(job: PrintJob): string {
    return this.isStuck(job) ? 'stuck' : job.status;
  }

  statusLabel(job: PrintJob): string {
    if (this.isStuck(job)) return this.translate.instant('PRINTING.STUCK');
    return this.translate.instant('PRINTING.STATUS_' + job.status.toUpperCase());
  }

  typeLabel(job: PrintJob): string {
    if (job.printer_role === 'bar') return this.translate.instant('PRINTING.TYPE_BAR');
    return this.translate.instant(job.job_type === 'kitchen' ? 'PRINTING.TYPE_KITCHEN' : 'PRINTING.TYPE_RECEIPT');
  }

  ticketText(job: PrintJob): string {
    return String((job.payload as { plain_text?: string })?.plain_text ?? '');
  }

  toggleTicket(id: number): void {
    this.openTicket.set(this.openTicket() === id ? null : id);
  }

  testPrint(): void {
    const text = `${this.translate.instant('PRINTING.TEST_TEXT')}\n${new Date().toLocaleString()}\n\nÑ á é í ó ú 0123456789\n`;
    this.api.createPrintJob({ job_type: 'kitchen', payload: { plain_text: text } }).subscribe({
      next: () => {
        this.flash(this.translate.instant('PRINTING.TEST_SENT'), false);
        this.refresh();
      },
      error: (e) => this.flash(e?.error?.detail || this.translate.instant('PRINTING.LOAD_ERROR'), true),
    });
  }

  clearQueue(): void {
    this.showClearConfirm.set(false);
    this.api.clearPrintQueue().subscribe({
      next: (r) => {
        this.flash(this.translate.instant('PRINTING.CLEARED', { n: r.deleted }), false);
        this.openTicket.set(null);
        this.refresh();
      },
      error: (e) => this.flash(e?.error?.detail || this.translate.instant('PRINTING.LOAD_ERROR'), true),
    });
  }

  retry(job: PrintJob): void {
    this.api.retryPrintJob(job.id).subscribe({
      next: () => {
        this.flash(this.translate.instant('PRINTING.RETRIED'), false);
        this.refresh();
      },
      error: (e) => this.flash(e?.error?.detail || this.translate.instant('PRINTING.LOAD_ERROR'), true),
    });
  }

  createAgent(): void {
    const name = this.newAgentName.trim();
    if (!name) return;
    this.api
      .createPrintAgent({ device_id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) || 'agent', display_name: name })
      .subscribe({
        next: (agent) => {
          this.createdToken.set(agent.token ?? '');
          this.newAgentName = '';
          this.refresh();
        },
        error: (e) => this.flash(e?.error?.detail || this.translate.instant('PRINTING.LOAD_ERROR'), true),
      });
  }

  revoke(agent: PrintAgent): void {
    this.api.revokePrintAgent(agent.id).subscribe({ next: () => this.refresh() });
  }

  runCommand(): string {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    return (
      `$env:PRINT_AGENT_API_BASE="${base}/api"\n` +
      `$env:PRINT_AGENT_TOKEN="${this.createdToken()}"\n` +
      `$env:KITCHEN_PRINTER="win:NOMBRE_DE_LA_IMPRESORA"\n` +
      `python scripts/print-agent/print_agent.py`
    );
  }

  copy(text: string): void {
    void navigator.clipboard?.writeText(text).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  private flash(text: string, isError: boolean): void {
    this.message.set(text);
    this.messageIsError.set(isError);
    setTimeout(() => this.message.set(''), 5000);
  }
}
