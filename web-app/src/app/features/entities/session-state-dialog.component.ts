import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ErrorStateMatcher } from '@angular/material/core';
import { finalize } from 'rxjs';
import { SessionEntity } from '../../core/models';
import { SessionService } from '../../core/services';
import { connectionContext } from './connection-context';

export interface SessionStateDialogData {
  entity: SessionEntity;
  sessionId: string;
  /** The state as read and shown; sent back as `expectedState`. */
  state: string | null;
}

const MAX_STATE_BYTES = 262144;

/**
 * Edits or clears the state of one session, then confirms with the old state beside the new before
 * writing. The write carries the state as read, so a state changed by someone else is never
 * overwritten: the server refuses and the dialog offers Reload. Closes with the stored session, or
 * 'reload'.
 */
@Component({
  selector: 'app-session-state-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, MatProgressBarModule],
  template: `
    @if (step() === 'edit') {
      <h2 mat-dialog-title class="title">Edit the state of session {{ data.sessionId }}</h2>
      <mat-dialog-content>
        <mat-form-field class="field">
          <mat-label>State</mat-label>
          <textarea matInput name="sessionState" rows="10" class="mono" [formControl]="control" [errorStateMatcher]="sizeMatcher"></textarea>
          <mat-hint>An empty state clears it.</mat-hint>
          @if (tooLarge()) {
            <mat-error>The state is {{ bytes() }} bytes as UTF-8; the limit is {{ maxBytes }}.</mat-error>
          }
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" class="start" [disabled]="text() === ''" (click)="control.setValue('')">Clear</button>
        <button mat-button mat-dialog-close type="button">Cancel</button>
        <button mat-flat-button type="button" [disabled]="!canSave()" (click)="step.set('confirm')">Save</button>
      </mat-dialog-actions>
    } @else {
      <h2 mat-dialog-title class="title">
        <mat-icon class="warn" aria-hidden="true">warning</mat-icon>
        Write the state of session {{ data.sessionId }}?
      </h2>
      <mat-dialog-content>
        <p class="consequence">The application that consumes this session reads this state next.</p>
        <dl class="facts">
          <div class="fact"><dt>Session</dt><dd>{{ data.sessionId }}</dd></div>
          @for (place of where; track place.label) {
            <div class="fact"><dt>{{ place.label }}</dt><dd>{{ place.value }}</dd></div>
          }
          <div class="fact"><dt>Connection</dt><dd>{{ context().connection }}</dd></div>
          <div class="fact"><dt>Environment</dt><dd>{{ context().environment }}</dd></div>
        </dl>
        <div class="compare">
          <section class="old">
            <h3>Current state</h3>
            @if (data.state === null) { <p class="muted">No state</p> } @else { <pre class="mono">{{ data.state }}</pre> }
          </section>
          <section class="new">
            <h3>New state</h3>
            @if (newState() === null) { <p class="muted">No state (cleared)</p> } @else { <pre class="mono">{{ newState() }}</pre> }
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
    }
  `,
  styles: [`
    .title { display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; }
    .warn { color: var(--mat-sys-error); }
    .field { width: 100%; }
    .mono { font-family: ui-monospace, monospace; }
    .start { margin-inline-end: auto; }
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
    .muted { margin: 0; color: var(--mat-sys-on-surface-variant); }
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
  private readonly dialogRef = inject(MatDialogRef<SessionStateDialogComponent>);
  private readonly sessions = inject(SessionService);

  readonly context = connectionContext();
  readonly maxBytes = MAX_STATE_BYTES;
  readonly where = 'queueName' in this.data.entity
    ? [{ label: 'Queue', value: this.data.entity.queueName }]
    : [{ label: 'Subscription', value: this.data.entity.subscriptionName }, { label: 'Topic', value: this.data.entity.topicName }];

  readonly step = signal<'edit' | 'confirm'>('edit');
  readonly control = new FormControl(this.data.state ?? '', { nonNullable: true });
  readonly text = toSignal(this.control.valueChanges, { initialValue: this.control.value });
  readonly newState = computed(() => this.text() === '' ? null : this.text());
  readonly bytes = computed(() => new TextEncoder().encode(this.text()).length);
  readonly tooLarge = computed(() => this.bytes() > MAX_STATE_BYTES);
  readonly canSave = computed(() => !this.tooLarge() && this.text() !== (this.data.state ?? ''));
  readonly sizeMatcher: ErrorStateMatcher = { isErrorState: () => this.tooLarge() };

  readonly writing = signal(false);
  readonly changed = signal(false);
  readonly errorMessage = signal<string | null>(null);

  back(): void {
    if (!this.changed()) this.errorMessage.set(null);
    this.step.set('edit');
  }

  write(): void {
    if (this.writing() || this.changed()) return;
    this.errorMessage.set(null);
    this.writing.set(true);
    this.sessions.setState(this.data.entity, this.data.sessionId, { state: this.newState(), expectedState: this.data.state })
      .pipe(finalize(() => this.writing.set(false)))
      .subscribe({
        next: stored => this.dialogRef.close(stored),
        error: (error: HttpErrorResponse) => {
          const message: string | undefined = error.error?.message;
          if (error.status === 409 && error.error?.code === 'SessionStateChanged') this.changed.set(true);
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
