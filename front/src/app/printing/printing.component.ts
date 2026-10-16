import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SidebarComponent } from '../shared/sidebar.component';
import { ApiService, PrintAgent, PrintJob } from '../services/api.service';

const POLL_MS = 3000;
/** A job claimed this long ago without a result means the agent died mid-print. */
const STUCK_AFTER_MS = 60_000;

@Component({
  selector: 'app-printing',
  standalone: true,
  imports: [CommonModule, FormsModule, SidebarComponent, TranslateModule],
  template: `
    <app-sidebar>
      <div class="printing-page">
        <div class="page-header">
          <div>
            <h1>{{ 'PRINTING.TITLE' | translate }}</h1>
            <p class="muted">{{ 'PRINTING.SUBTITLE' | translate }}</p>
          </div>
          <button type="button" class="btn-primary" data-testid="test-print" (click)="testPrint()">
            {{ 'PRINTING.TEST_PRINT' | translate }}
          </button>
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
          <div class="counters">
            <div><b>{{ count('pending') + count('claimed') }}</b><span>{{ 'PRINTING.COUNT_PENDING' | translate }}</span></div>
            <div [class.bad]="count('failed') > 0"><b>{{ count('failed') }}</b><span>{{ 'PRINTING.COUNT_FAILED' | translate }}</span></div>
            <div><b>{{ count('done') }}</b><span>{{ 'PRINTING.COUNT_DONE' | translate }}</span></div>
          </div>
        </section>

        <section class="card">
          <h2>{{ 'PRINTING.QUEUE' | translate }}</h2>
          @if (jobs().length === 0 && loaded()) {
            <p class="muted">{{ 'PRINTING.EMPTY' | translate }}</p>
          } @else {
            <div class="table-wrap">
              <table class="jobs">
                <thead>
                  <tr>
                    <th>{{ 'PRINTING.COL_TIME' | translate }}</th>
                    <th>{{ 'PRINTING.COL_TYPE' | translate }}</th>
                    <th>{{ 'PRINTING.COL_ORDER' | translate }}</th>
                    <th>{{ 'PRINTING.COL_STATUS' | translate }}</th>
                    <th>{{ 'PRINTING.COL_DETAIL' | translate }}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (job of jobs(); track job.id) {
                    <tr [class.row-failed]="job.status === 'failed'" data-testid="job-row">
                      <td>{{ job.created_at | date: 'dd/MM HH:mm:ss' }}</td>
                      <td>{{ typeLabel(job) }}</td>
                      <td>{{ job.order_id ? '#' + job.order_id : '—' }}</td>
                      <td>
                        <span class="badge" [class]="'badge-' + displayStatus(job)">{{ statusLabel(job) }}</span>
                      </td>
                      <td class="detail">
                        @if (job.error_message) {
                          <span class="error-text">{{ job.error_message }}</span>
                        }
                      </td>
                      <td class="row-actions">
                        @if (job.status === 'failed' || isStuck(job)) {
                          <button type="button" class="btn-small" data-testid="retry-job" (click)="retry(job)">
                            {{ 'PRINTING.RETRY' | translate }}
                          </button>
                        }
                        <button type="button" class="btn-small btn-ghost" (click)="toggleTicket(job.id)">
                          {{ (openTicket() === job.id ? 'PRINTING.HIDE_TICKET' : 'PRINTING.SHOW_TICKET') | translate }}
                        </button>
                      </td>
                    </tr>
                    @if (openTicket() === job.id) {
                      <tr class="ticket-row">
                        <td colspan="6"><pre class="ticket">{{ ticketText(job) }}</pre></td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        <section class="card">
          <h2>{{ 'PRINTING.AGENTS' | translate }}</h2>
          @for (agent of agents(); track agent.id) {
            <div class="agent-row">
              <span class="dot small" [class.on]="agent.online" [class.off]="!agent.online"></span>
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

          <form class="new-agent" (ngSubmit)="createAgent()">
            <input type="text" name="agentName" [(ngModel)]="newAgentName" [placeholder]="'PRINTING.AGENT_NAME' | translate" required />
            <button type="submit" class="btn-primary" [disabled]="!newAgentName.trim()">{{ 'PRINTING.NEW_AGENT' | translate }}</button>
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

        <section class="card">
          <h2>{{ 'PRINTING.USB_HELP_TITLE' | translate }}</h2>
          <p class="muted">{{ 'PRINTING.USB_HELP' | translate }}</p>
          <pre class="ticket">python scripts/print-agent/print_agent.py --list-printers</pre>
        </section>
      </div>
    </app-sidebar>
  `,
  styles: [`
    .printing-page { max-width: 1100px; display: flex; flex-direction: column; gap: var(--space-4); }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3); flex-wrap: wrap; }
    .page-header h1 { font-size: 1.5rem; font-weight: 600; color: var(--color-text); margin: 0; }
    .muted { color: var(--color-text-muted); font-size: 0.875rem; margin: 0; }
    h2 { font-size: 1rem; font-weight: 600; margin: 0 0 var(--space-3); color: var(--color-text); }
    .btn-primary { padding: var(--space-3) var(--space-4); background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-md); font-size: 0.875rem; font-weight: 500; cursor: pointer; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-small { padding: var(--space-1) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface, #fff); color: var(--color-text); font-size: 0.8rem; cursor: pointer; }
    .btn-ghost { background: transparent; }
    .flash { padding: var(--space-3); border-radius: var(--radius-md); background: #d1fae5; color: #065f46; }
    .flash-error { background: #fee2e2; color: #991b1b; }
    .card, .status-card { background: var(--color-surface, #fff); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-4); }
    .status-card { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
    .status-card.online { border-color: #34d399; }
    .status-card.offline { border-color: #f87171; }
    .status-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 220px; }
    .dot { width: 14px; height: 14px; border-radius: 50%; background: #9ca3af; flex: none; }
    .online .dot, .dot.on { background: #10b981; box-shadow: 0 0 0 4px #d1fae5; }
    .offline .dot, .dot.off { background: #ef4444; box-shadow: 0 0 0 4px #fee2e2; }
    .dot.small { width: 10px; height: 10px; box-shadow: none !important; }
    .counters { display: flex; gap: var(--space-4); }
    .counters div { display: flex; flex-direction: column; align-items: center; min-width: 64px; }
    .counters b { font-size: 1.4rem; }
    .counters span { font-size: 0.75rem; color: var(--color-text-muted); }
    .counters .bad b { color: #dc2626; }
    .table-wrap { overflow-x: auto; }
    table.jobs { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    table.jobs th { text-align: left; font-weight: 500; color: var(--color-text-muted); padding: var(--space-2); border-bottom: 1px solid var(--color-border); }
    table.jobs td { padding: var(--space-2); border-bottom: 1px solid var(--color-border); vertical-align: top; }
    .row-failed { background: #fef2f2; }
    .detail { max-width: 340px; }
    .error-text { color: #b91c1c; font-size: 0.8rem; word-break: break-word; }
    .row-actions { display: flex; gap: var(--space-2); justify-content: flex-end; white-space: nowrap; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 500; }
    .badge-pending { background: #fef3c7; color: #92400e; }
    .badge-claimed { background: #dbeafe; color: #1e40af; }
    .badge-done { background: #d1fae5; color: #065f46; }
    .badge-failed, .badge-stuck { background: #fee2e2; color: #991b1b; }
    .badge-cancelled { background: #e5e7eb; color: #374151; }
    .ticket { background: #111827; color: #e5e7eb; padding: var(--space-3); border-radius: var(--radius-md); font-size: 0.8rem; overflow-x: auto; margin: var(--space-2) 0; white-space: pre-wrap; }
    .agent-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) 0; border-bottom: 1px solid var(--color-border); }
    .agent-info { display: flex; flex-direction: column; flex: 1; }
    .new-agent { display: flex; gap: var(--space-3); margin-top: var(--space-3); flex-wrap: wrap; }
    .new-agent input { flex: 1; min-width: 200px; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    .token-box { margin-top: var(--space-3); padding: var(--space-3); border: 1px dashed #f59e0b; border-radius: var(--radius-md); background: #fffbeb; }
  `],
})
export class PrintingComponent implements OnInit {
  private api = inject(ApiService);
  private translate = inject(TranslateService);
  private destroyRef = inject(DestroyRef);

  jobs = signal<PrintJob[]>([]);
  agents = signal<PrintAgent[]>([]);
  loaded = signal(false);
  message = signal('');
  messageIsError = signal(false);
  openTicket = signal<number | null>(null);
  createdToken = signal('');
  copied = signal(false);
  newAgentName = '';

  online = computed(() => this.agents().some((a) => a.online && !a.revoked_at));
  private now = signal(Date.now());

  ngOnInit(): void {
    this.refresh();
    const timer = setInterval(() => {
      this.now.set(Date.now());
      this.refresh();
    }, POLL_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
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
