import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { TimePickerComponent } from './time-picker.component';

/** One service window of a weekday: opens → closes plus an optional booking label. Styles: styles/_hours.scss. */
@Component({
  selector: 'app-opening-shift',
  standalone: true,
  imports: [TranslateModule, TimePickerComponent],
  template: `
    <div class="oh-shift" [class.oh-morning]="variant === 'morning'" [class.oh-evening]="variant === 'evening'">
      @if (variant !== 'single') {
        <span class="oh-shift-name"><i></i>{{ (variant === 'morning' ? 'SETTINGS.MORNING_SHIFT' : 'SETTINGS.EVENING_SHIFT') | translate }}</span>
      }
      <div class="oh-range">
        <app-time-picker [value]="open" ariaLabel="SETTINGS.OH_OPENS" (valueChange)="openChange.emit($event)" />
        <span class="oh-dash" aria-hidden="true">→</span>
        <app-time-picker [value]="close" ariaLabel="SETTINGS.OH_CLOSES" (valueChange)="closeChange.emit($event)" />
      </div>
      <input
        type="text"
        class="oh-label"
        maxlength="64"
        [value]="label"
        [placeholder]="placeholder | translate"
        [attr.aria-label]="labelAria | translate"
        (input)="labelChange.emit($any($event.target).value)"
      />
    </div>
  `,
})
export class OpeningShiftComponent {
  @Input() variant: 'single' | 'morning' | 'evening' = 'single';
  @Input() open: string | undefined;
  @Input() close: string | undefined;
  @Input() label = '';
  @Input() placeholder = '';
  @Input() labelAria = '';
  @Output() openChange = new EventEmitter<string>();
  @Output() closeChange = new EventEmitter<string>();
  @Output() labelChange = new EventEmitter<string>();
}
