import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

/** The most sequence numbers one cancel takes, as the API checks it. */
export const MAX_CANCEL_SCHEDULED = 500;

export interface TopicCancelScheduledDialogData {
  topicName: string;
}

/**
 * The sequence numbers in the text, or the reason they cannot be sent: separated by commas, spaces or lines, 1 to
 * {@link MAX_CANCEL_SCHEDULED}, each a positive whole number, none repeated. The same rules as the API.
 */
export function parseSequenceNumbers(text: string): { numbers: number[]; error: string } {
  const parts = text.split(/[\s,;]+/).filter(p => p !== '');
  if (parts.length === 0) return { numbers: [], error: '' };
  if (parts.some(p => !/^\d+$/.test(p) || !Number.isSafeInteger(Number(p)) || Number(p) < 1)) {
    return { numbers: [], error: 'Each sequence number must be a positive whole number.' };
  }
  const numbers = parts.map(Number);
  if (new Set(numbers).size !== numbers.length) return { numbers: [], error: 'A sequence number is repeated.' };
  if (numbers.length > MAX_CANCEL_SCHEDULED) {
    return { numbers: [], error: `Cancel takes at most ${MAX_CANCEL_SCHEDULED} sequence numbers at a time; ${numbers.length} are given.` };
  }
  return { numbers, error: '' };
}

/**
 * Asks which scheduled messages of a topic to cancel, by sequence number: this app does not list a topic's scheduled
 * messages. Closes with the numbers; the confirmation that names the topic comes after.
 */
@Component({
  selector: 'app-topic-cancel-scheduled-dialog',
  standalone: true,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Cancel scheduled messages of {{ data.topicName }}</h2>
    <mat-dialog-content>
      <p class="explain">
        This app does not list a topic's scheduled messages yet. Enter the sequence numbers returned when they were
        scheduled: the send dialog shows the number of each message it schedules.
      </p>
      <mat-form-field class="numbers">
        <mat-label>Sequence numbers</mat-label>
        <textarea matInput rows="4" autocomplete="off" [value]="text()" (input)="text.set($any($event.target).value)"></textarea>
        <mat-hint>Separated by commas, spaces or lines; 1 to {{ max }}.</mat-hint>
      </mat-form-field>
      @if (parsed().error) {
        <p class="error" role="alert">{{ parsed().error }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
      <button mat-flat-button [disabled]="parsed().numbers.length === 0" (click)="next()">Next</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .explain { margin: 0 0 12px; }
    .numbers { width: 100%; }
    .error { margin: 4px 0 0; color: var(--mat-sys-error); }
  `]
})
export class TopicCancelScheduledDialogComponent {
  readonly data = inject<TopicCancelScheduledDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<TopicCancelScheduledDialogComponent>);

  readonly max = MAX_CANCEL_SCHEDULED;
  readonly text = signal('');
  readonly parsed = computed(() => parseSequenceNumbers(this.text()));

  next(): void {
    const { numbers } = this.parsed();
    if (numbers.length > 0) this.dialogRef.close(numbers);
  }
}
