import { Directive, ElementRef, HostListener, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

const STEP = 500;

/** Text input for whole COP amounts: shows thousands dots (12.500), ArrowUp/Down change by 500. Model is a number | null. */
@Directive({
  selector: 'input[copAmount]',
  standalone: true,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CopAmountDirective), multi: true }],
})
export class CopAmountDirective implements ControlValueAccessor {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private onChange: (v: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    this.el.type = 'text';
    this.el.inputMode = 'numeric';
    this.el.autocomplete = 'off';
  }

  writeValue(v: number | null | undefined): void {
    this.el.value = v == null || isNaN(Number(v)) ? '' : this.format(Math.round(Number(v)));
  }
  registerOnChange(fn: (v: number | null) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void { this.el.disabled = disabled; }

  @HostListener('input') onInput(): void {
    const digits = this.el.value.replace(/\D/g, '');
    const caretFromEnd = this.el.value.length - (this.el.selectionStart ?? this.el.value.length);
    const n = digits ? Number(digits) : null;
    this.el.value = n == null ? '' : this.format(n);
    const pos = Math.max(0, this.el.value.length - caretFromEnd);
    this.el.setSelectionRange(pos, pos);
    this.onChange(n);
  }

  @HostListener('keydown', ['$event']) onKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    if (this.el.readOnly || this.el.disabled) return;
    const cur = Number(this.el.value.replace(/\D/g, '')) || 0;
    const next = Math.max(0, cur + (e.key === 'ArrowUp' ? STEP : -STEP));
    this.el.value = this.format(next);
    this.onChange(next);
  }

  @HostListener('blur') onBlur(): void { this.onTouched(); }

  private format(n: number): string {
    return n.toLocaleString('es-CO', { maximumFractionDigits: 0, useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);
  }
}
