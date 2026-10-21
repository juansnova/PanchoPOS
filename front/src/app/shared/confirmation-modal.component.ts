import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-confirmation-modal',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <div class="modal-overlay" (click)="onCancel()">
      <div class="modal" [attr.data-tone]="tone" role="alertdialog" aria-modal="true" (click)="$event.stopPropagation()">
        <button type="button" class="close-btn" (click)="onCancel()" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
        <div class="modal-seal" aria-hidden="true">
          <span class="seal-ring"></span>
          @if (tone === 'danger') {
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/></svg>
          } @else if (tone === 'warning') {
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="3"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><path d="M12 15v2"/></svg>
          } @else {
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
          }
        </div>
        <div class="modal-body">
          <h3>{{ title | translate }}</h3>
          <p>{{ message | translate:messageParams }}</p>
        </div>
        <div class="modal-footer" [class.modal-footer--single-action]="!showSecondaryButton">
          @if (showSecondaryButton) {
            <button type="button" class="btn btn-secondary" (click)="onCancel()">
              {{ cancelText | translate }}
            </button>
          }
          <button type="button" class="btn btn-confirm" (click)="onConfirm()">
            {{ confirmText | translate }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(23, 18, 16, 0.55);
      -webkit-backdrop-filter: blur(4px);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
      padding: var(--space-4);
      animation: fadeIn 0.2s ease-out;
    }

    .modal {
      --tone: var(--color-primary);
      position: relative;
      width: 100%;
      max-width: 400px;
      padding: 34px 28px 24px;
      text-align: center;
      border-radius: 30px;
      background: #fffdfa;
      box-shadow: 0 40px 80px -24px rgba(23, 18, 16, 0.6), 0 0 0 1px rgba(60, 30, 10, 0.08);
      animation: slideUp 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .modal[data-tone='danger'] { --tone: #c2410c; }
    .modal[data-tone='info'] { --tone: var(--color-primary); }

    .close-btn {
      position: absolute;
      top: 14px;
      right: 14px;
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--color-text-muted);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .close-btn:hover { background: color-mix(in srgb, var(--color-primary) 10%, #fff); color: var(--color-text); }

    .modal-seal {
      position: relative;
      display: grid;
      place-items: center;
      width: 68px;
      height: 68px;
      margin: 0 auto 18px;
      border-radius: 24px;
      color: #fff;
      background: linear-gradient(145deg, color-mix(in srgb, var(--tone) 82%, #fff), color-mix(in srgb, var(--tone) 70%, #000));
      box-shadow: 0 18px 26px -14px var(--tone), inset 0 1px 0 rgba(255, 255, 255, 0.35);
      transform: rotate(-4deg);
    }
    .seal-ring {
      position: absolute;
      inset: -8px;
      border-radius: 30px;
      border: 1.5px dashed color-mix(in srgb, var(--tone) 45%, transparent);
    }
    .modal-seal svg { position: relative; }

    .modal-body h3 {
      margin: 0;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 1.7rem;
      font-style: italic;
      font-weight: 500;
      letter-spacing: -0.02em;
      color: var(--color-text);
    }

    .modal-body p {
      margin: 10px auto 0;
      max-width: 30ch;
      color: var(--color-text-muted);
      font-size: 0.95rem;
      line-height: 1.5;
    }

    .modal-footer {
      display: flex;
      gap: 10px;
      margin-top: 26px;
      padding: 0;
      background: none;
      border: 0;
    }
    .modal-footer > .btn { flex: 1; }
    .modal-footer--single-action > .btn { width: 100%; }

    .btn {
      min-height: 48px;
      padding: 0 20px;
      border: 0;
      border-radius: 999px;
      font: inherit;
      font-size: 0.92rem;
      font-weight: 800;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.2s, background 0.2s;
    }
    .btn:active { transform: scale(0.97); }

    .btn-secondary {
      color: var(--color-text);
      background: #fff;
      box-shadow: inset 0 0 0 1.5px var(--color-border);
    }
    .btn-secondary:hover { box-shadow: inset 0 0 0 1.5px var(--color-text-muted); }

    .btn-confirm {
      color: #fff;
      background: linear-gradient(135deg, color-mix(in srgb, var(--tone) 88%, #fff), color-mix(in srgb, var(--tone) 68%, #000));
      box-shadow: 0 16px 24px -14px var(--tone);
    }
    .btn-confirm:hover { box-shadow: 0 18px 28px -12px var(--tone); }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes slideUp {
      from { transform: translateY(14px) scale(0.96); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }

    @media (prefers-reduced-motion: reduce) {
      .modal, .modal-overlay { animation: none; }
    }
  `]
})
export class ConfirmationModalComponent {
  @Input() title = 'COMMON.CONFIRM';
  @Input() message = 'COMMON.CONFIRM_MESSAGE';
  @Input() messageParams: any = {};
  @Input() confirmText = 'COMMON.YES';
  @Input() cancelText = 'COMMON.NO';
  @Input() confirmBtnClass = 'btn-primary';
  /** Left/footer dismiss button (e.g. “Close”). Header X and overlay click still dismiss when false. */
  @Input() showSecondaryButton = true;

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  get tone(): 'danger' | 'warning' | 'info' {
    const c = this.confirmBtnClass || '';
    if (c.includes('danger')) return 'danger';
    if (c.includes('warning')) return 'warning';
    return 'info';
  }

  onConfirm() {
    this.confirm.emit();
  }

  onCancel() {
    this.cancel.emit();
  }
}
