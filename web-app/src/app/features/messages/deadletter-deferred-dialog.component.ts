import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { connectionContext } from '../entities/connection-context';
import { EnvironmentLineComponent } from '../../shared/environment-line.component';

export interface DeadLetterDeferredDialogData {
  /** The queue or subscription the deferred messages are in. */
  entityName: string;
  entityType: 'queue' | 'subscription';
  /** Exactly the sequence numbers the dead-letter will send. */
  sequenceNumbers: number[];
  /** The messages are active: the API scans for them, which raises the delivery count of the others it receives. */
  active?: boolean;
}

/** What the user confirmed: the reason and description to write, each absent when left empty. */
export interface DeadLetterDeferredDialogResult {
  reason?: string;
  description?: string;
}

/**
 * Confirms sending deferred messages to the dead-letter queue, with an optional reason and
 * description. Names the entity, the connection, the environment and the count. Closes with the
 * reason and description when confirmed, and with nothing when cancelled.
 */
@Component({
  selector: 'app-deadletter-deferred-dialog',
  standalone: true,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, EnvironmentLineComponent],
  template: `
    <h2 mat-dialog-title class="title">
      <mat-icon class="warn" aria-hidden="true">warning</mat-icon>
      <span class="title-text">Dead-letter {{ count }} {{ kind }} {{ noun }}?</span>
    </h2>
    <mat-dialog-content>
      <app-environment-line [mark]="context().mark"><b>{{ data.entityName }}</b> on {{ context().where }}</app-environment-line>
      <p class="consequence">
        The {{ noun }} {{ count === 1 ? 'leaves' : 'leave' }} the {{ kind }} messages of the {{ data.entityType }} and {{ count === 1 ? 'goes' : 'go' }} to its dead-letter queue, where {{ count === 1 ? 'it' : 'they' }} can be resubmitted later.
      </p>
      @if (data.active) {
        <p class="consequence" data-testid="scan-notice">The broker cannot lock one message by its number, so the app receives messages in order until it finds {{ count === 1 ? 'this one' : 'these' }}. Every other message it receives is released at once with its delivery count raised by one; one at its max delivery count goes to the dead-letter queue and is reported. Operations are at-least-once.</p>
      }
      <dl class="facts">
        <div class="fact"><dt>{{ data.entityType === 'queue' ? 'Queue' : 'Subscription' }}</dt><dd>{{ data.entityName }}</dd></div>
        <div class="fact"><dt>Connection</dt><dd>{{ context().connection }}</dd></div>
        <div class="fact"><dt>Environment</dt><dd>{{ context().environment }}</dd></div>
        <div class="fact"><dt>Messages</dt><dd>{{ count }} {{ kind }}{{ count === 1 ? ': ' + data.sequenceNumbers[0] : '' }}</dd></div>
      </dl>
      <mat-form-field class="field">
        <mat-label>Reason</mat-label>
        <input matInput autocomplete="off" [value]="reason()" (input)="reason.set($any($event.target).value)">
        <mat-hint>Optional. Empty writes "Manual dead letter".</mat-hint>
      </mat-form-field>
      <mat-form-field class="field">
        <mat-label>Description</mat-label>
        <input matInput autocomplete="off" [value]="description()" (input)="description.set($any($event.target).value)">
        <mat-hint>Optional. Empty writes "Moved to dead letter by user".</mat-hint>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Keep {{ count === 1 ? 'it' : 'them' }}</button>
      <button mat-flat-button class="danger" (click)="confirm()">Dead-letter {{ count }} {{ kind }} {{ noun }}</button>
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
    .field { width: 100%; }
    .danger {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `]
})
export class DeadLetterDeferredDialogComponent {
  readonly data = inject<DeadLetterDeferredDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<DeadLetterDeferredDialogComponent, DeadLetterDeferredDialogResult>);

  readonly context = connectionContext();
  readonly count = this.data.sequenceNumbers.length;
  readonly noun = this.count === 1 ? 'message' : 'messages';
  readonly kind = this.data.active ? 'active' : 'deferred';
  readonly reason = signal('');
  readonly description = signal('');

  confirm(): void {
    const reason = this.reason().trim();
    const description = this.description().trim();
    this.dialogRef.close({ reason: reason || undefined, description: description || undefined });
  }
}
