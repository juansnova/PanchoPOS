import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild, inject, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Quarter-hour time picker: a pill showing the time (24h value, a. m./p. m. hint) that opens a small panel with
 * the 24 hours and the four quarters, instead of the browser's 96-line list. Styles: styles/_hours.scss.
 */
@Component({
  selector: 'app-time-picker',
  standalone: true,
  imports: [TranslateModule],
  template: `
    <button
      #trigger
      type="button"
      class="oh-tp-btn"
      aria-haspopup="dialog"
      [attr.aria-expanded]="isOpen()"
      [attr.aria-label]="ariaLabel | translate"
      (click)="toggle()"
    >
      <b>{{ value || '--:--' }}</b>
      <small>{{ suffix() }}</small>
      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1.5l5 5 5-5"/></svg>
    </button>
    @if (isOpen()) {
      <div #panel class="oh-tp-panel" [class.flip]="flip()" role="dialog" [attr.aria-label]="ariaLabel | translate">
        <div class="oh-tp-hours" role="group">
          @for (h of hours; track h) {
            <button type="button" class="oh-tp-cell" [class.on]="h === hour()" (click)="pickHour(h)">{{ pad(h) }}</button>
          }
        </div>
        <div class="oh-tp-mins" role="group">
          @for (m of minutes; track m) {
            <button type="button" class="oh-tp-cell oh-tp-min" [class.on]="m === minute()" (click)="pickMinute(m)">:{{ pad(m) }}</button>
          }
        </div>
      </div>
    }
  `,
})
export class TimePickerComponent {
  @Input() value: string | undefined;
  @Input() ariaLabel = '';
  @Output() valueChange = new EventEmitter<string>();

  @ViewChild('trigger') private trigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('panel') private panel?: ElementRef<HTMLElement>;

  private host = inject(ElementRef<HTMLElement>);
  readonly hours = Array.from({ length: 24 }, (_, i) => i);
  readonly minutes = [0, 15, 30, 45];
  isOpen = signal(false);
  flip = signal(false);

  hour(): number {
    return Number((this.value || '').split(':')[0]);
  }

  minute(): number {
    return Number((this.value || '').split(':')[1]);
  }

  pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  suffix(): string {
    const h = this.hour();
    return Number.isNaN(h) ? '' : h < 12 ? 'a. m.' : 'p. m.';
  }

  toggle(): void {
    const next = !this.isOpen();
    this.isOpen.set(next);
    this.flip.set(false);
    if (next) {
      // Keep the panel inside the viewport: align it to the right edge when it would overflow.
      setTimeout(() => {
        const r = this.panel?.nativeElement.getBoundingClientRect();
        if (r && r.right > window.innerWidth - 8) this.flip.set(true);
      });
    }
  }

  pickHour(h: number): void {
    const m = Number.isNaN(this.minute()) ? 0 : this.minute();
    this.valueChange.emit(`${this.pad(h)}:${this.pad(m)}`);
  }

  pickMinute(m: number): void {
    const h = Number.isNaN(this.hour()) ? 0 : this.hour();
    this.valueChange.emit(`${this.pad(h)}:${this.pad(m)}`);
    this.close();
  }

  private close(): void {
    this.isOpen.set(false);
    this.trigger?.nativeElement.focus();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: Event): void {
    if (this.isOpen() && !this.host.nativeElement.contains(e.target as Node)) this.isOpen.set(false);
  }

  @HostListener('keydown.escape')
  onEscape(): void {
    if (this.isOpen()) this.close();
  }
}
