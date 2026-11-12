import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { connectionContext } from '../entities/connection-context';

export interface CancelScheduledDialogData {
  queueName: string;
  /** Exactly the sequence numbers the cancel will send. */
  sequenceNumbers: number[];
}

/**
 * Confirms cancelling scheduled messages: they are deleted before they are ever delivered. Names the
 * queue, the connection, the environment and the count; more than one message needs the queue name typed.
 * Closes with true when confirmed.
 */
@Component({
  selector: 'app-cancel-scheduled-dialog',
  standalone: true,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title class="title">
      <mat-icon class="warn" aria-hidden="true">warning</mat-icon>
      <span class="title-text">Cancel {{ count }} scheduled {{ noun }}?</span>
    </h2>
    <mat-dialog-content>
      <p class="consequence">
        The {{ noun }} {{ count === 1 ? 'is' : 'are' }} deleted before {{ count === 1 ? 'it is' : 'they are' }} ever delivered.
        This cannot be undone; export {{ count === 1 ? 'it' : 'them' }} first to keep a copy.
      </p>
      <dl class="facts">
        <div class="fact"><dt>Queue</dt><dd>{{ data.queueName }}</dd></div>
        <div class="fact"><dt>Connection</dt><dd>{{ context().connection }}</dd></div>
        <div class="fact"><dt>Environment</dt><dd>{{ context().environment }}</dd></div>
        <div class="fact"><dt>Messages</dt><dd>{{ count }} scheduled{{ count === 1 ? ': ' + data.sequenceNumbers[0] : '' }}</dd></div>
      </dl>
      @if (needsTypedName) {
        <mat-form-field class="typed">
          <mat-label>Type the queue name to confirm</mat-label>
          <input matInput autocomplete="off" [placeholder]="data.queueName" [value]="typed()" (input)="typed.set($any($event.target).value)">
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Keep {{ count === 1 ? 'it' : 'them' }}</button>
      <button mat-flat-button class="danger" [disabled]="!canConfirm()" (click)="confirm()">Cancel {{ count }} scheduled {{ noun }}</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .title { display: flex; align-items: center; gap: 8px; }
    .warn { color: var(--mat-sys-error); }
    .consequence { margin: 0 0 12px; }
    .facts { margin: 0 0 16px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 12px; }
    .fact { display: flex; justify-content: space-between; gap: 16px; padding: 8px 16px; min-width: 0; }
    .fact + .fact { border-top: 1px solid var(--mat-sys-outline-variant); }
    dt { font-weight: normal; }
    dd { margin: 0; text-align: end; overflow-wrap: anywhere; }
    .typed { width: 100%; }
    .danger {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `]
})
export class CancelScheduledDialogComponent {
  readonly data = inject<CancelScheduledDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<CancelScheduledDialogComponent>);

  readonly context = connectionContext();
  readonly count = this.data.sequenceNumbers.length;
  readonly noun = this.count === 1 ? 'message' : 'messages';
  readonly needsTypedName = this.count > 1;
  readonly typed = signal('');
  readonly canConfirm = computed(() => !this.needsTypedName || this.typed() === this.data.queueName);

  confirm(): void {
    if (this.canConfirm()) {
      this.dialogRef.close(true);
    }
  }
}
