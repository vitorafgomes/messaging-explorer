import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { finalize } from 'rxjs';
import { SessionDetail, SessionEntity } from '../../core/models';
import { SessionService } from '../../core/services';
import { connectionContext } from './connection-context';
import { EnvironmentLineComponent } from '../../shared/environment-line.component';

export interface SessionStateDialogData {
  entity: SessionEntity;
  sessionId: string;
  /** The state as read and shown; sent back as `expectedState`. */
  state: string | null;
  /** The state to write; null clears it. */
  newState: string | null;
}

/**
 * What the confirmation closes with: the stored session; 'reload' to read the session again;
 * 'stale' when Back follows a refusal because the state changed since it was read; undefined on
 * Back otherwise.
 */
export type SessionStateDialogResult = SessionDetail | 'reload' | 'stale' | undefined;

/**
 * Confirms a session state write with the current state beside the new. The write carries the
 * state as read, so a state changed by someone else is never overwritten: the server refuses, the
 * dialog disables the write and offers Reload, and it never sends again.
 */
@Component({
  selector: 'app-session-state-dialog',
  standalone: true,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatButtonModule, MatIconModule, MatProgressBarModule, EnvironmentLineComponent],
  template: `
    <h2 mat-dialog-title class="title">
      <mat-icon class="warn" aria-hidden="true">warning</mat-icon>
      Write the state of session {{ data.sessionId }}?
    </h2>
    <mat-dialog-content>
      <app-environment-line [mark]="context().mark"><b>{{ entityName }}</b> on {{ context().where }}</app-environment-line>
      <p class="consequence">Writing session state changes what the consuming application reads next for this session. The write locks the session for a moment.</p>
      <dl class="facts">
        <div class="fact"><dt>Session ID</dt><dd>{{ data.sessionId }}</dd></div>
        @for (place of where; track place.label) {
          <div class="fact"><dt>{{ place.label }}</dt><dd>{{ place.value }}</dd></div>
        }
        <div class="fact"><dt>Connection</dt><dd>{{ context().connection }}</dd></div>
        <div class="fact"><dt>Environment</dt><dd>{{ context().environment }}</dd></div>
      </dl>
      <div class="compare">
        <section class="old">
          <h3>Current state</h3>
          <pre class="mono">{{ data.state || 'No state data' }}</pre>
        </section>
        <section class="new">
          <h3>New state</h3>
          <pre class="mono">{{ data.newState || 'No state data' }}</pre>
        </section>
      </div>
      @if (errorMessage()) {
        <div class="error" role="alert">
          <mat-icon aria-hidden="true">error</mat-icon>
          <span class="grow">{{ errorMessage() }}</span>
          @if (changed()) {
            <button mat-button type="button" (click)="reload()">Reload</button>
          }
        </div>
      }
      @if (writing()) {
        <mat-progress-bar mode="indeterminate" aria-label="Writing the state"></mat-progress-bar>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [disabled]="writing()" (click)="back()">Back</button>
      <button mat-flat-button type="button" [disabled]="writing() || changed()" (click)="write()">Write state</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .title { display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; }
    .warn { color: var(--mat-sys-error); }
    .mono { font-family: ui-monospace, monospace; }
    .consequence { margin: 0 0 12px; }
    .facts { margin: 0 0 16px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 12px; }
    .fact { display: flex; justify-content: space-between; gap: 16px; padding: 8px 16px; min-width: 0; }
    .fact + .fact { border-top: 1px solid var(--mat-sys-outline-variant); }
    dt { font-weight: normal; }
    dd { margin: 0; text-align: end; overflow-wrap: anywhere; }
    .compare { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .compare section { min-width: 0; }
    h3 { font: var(--mat-sys-title-small); margin: 0 0 4px; }
    pre { margin: 0; padding: 8px; max-height: 240px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border-radius: 8px; background: var(--mat-sys-surface-container); }
    .error {
      display: flex; align-items: center; gap: 12px; margin-top: 16px; padding: 12px 16px; border-radius: 12px;
      background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container);
    }
    .grow { flex: 1; min-width: 0; }
    mat-progress-bar { margin-top: 12px; }
  `]
})
export class SessionStateDialogComponent {
  readonly data = inject<SessionStateDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<SessionStateDialogComponent, SessionStateDialogResult>);
  private readonly sessions = inject(SessionService);

  readonly context = connectionContext();
  /** The queue or subscription that holds the session, as the environment line names it. */
  readonly entityName = 'queueName' in this.data.entity ? this.data.entity.queueName : this.data.entity.subscriptionName;
  readonly where = 'queueName' in this.data.entity
    ? [{ label: 'Queue', value: this.data.entity.queueName }]
    : [{ label: 'Subscription', value: this.data.entity.subscriptionName }, { label: 'Topic', value: this.data.entity.topicName }];

  readonly writing = signal(false);
  readonly changed = signal(false);
  readonly errorMessage = signal<string | null>(null);

  back(): void {
    this.dialogRef.close(this.changed() ? 'stale' : undefined);
  }

  write(): void {
    if (this.writing() || this.changed()) return;
    this.errorMessage.set(null);
    this.writing.set(true);
    this.sessions.setState(this.data.entity, this.data.sessionId, { state: this.data.newState, expectedState: this.data.state })
      .pipe(finalize(() => this.writing.set(false)))
      .subscribe({
        next: stored => this.dialogRef.close(stored),
        error: (error: HttpErrorResponse) => {
          const message: string | undefined = error.error?.message;
          if (error.status === 409 && error.error?.code === 'SessionStateChanged') {
            this.changed.set(true);
            this.dialogRef.disableClose = true;
          }
          this.errorMessage.set([400, 404, 409].includes(error.status) && message
            ? message
            : 'Could not write the state: the API did not confirm it. Try again.');
        }
      });
  }

  reload(): void {
    this.dialogRef.close('reload');
  }
}
