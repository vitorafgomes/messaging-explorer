import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { finalize } from 'rxjs';
import { TopicService } from '../../core/services';
import { connectionContext } from './connection-context';

export interface RuleDeleteDialogData {
  topicName: string;
  subscriptionName: string;
  ruleName: string;
  /** The rule is the only one in the list shown; deleting it stops delivery to the subscription. */
  isLast: boolean;
}

/**
 * Deletes a rule after a confirmation that names the rule, the subscription, its topic, the connection
 * and the environment. The last rule says delivery stops and needs the rule name typed exactly.
 */
@Component({
  selector: 'app-rule-delete-dialog',
  standalone: true,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title class="title">
      @if (data.isLast) {
        <mat-icon class="warn" aria-hidden="true">warning</mat-icon>
        Delete the last rule?
      } @else {
        Delete rule {{ data.ruleName }}?
      }
    </h2>
    <mat-dialog-content>
      <p class="consequence">
        @if (data.isLast) {
          With no rule, the subscription <b>{{ data.subscriptionName }}</b> receives no message at all until a rule is added. Messages published meanwhile are not kept for it.
        } @else {
          Messages that only this rule matches stop reaching the subscription <b>{{ data.subscriptionName }}</b>. Its other rules keep working.
        }
      </p>
      <dl class="facts">
        <div class="fact"><dt>Rule</dt><dd>{{ data.ruleName }}</dd></div>
        <div class="fact"><dt>Subscription</dt><dd>{{ data.subscriptionName }}</dd></div>
        <div class="fact"><dt>Topic</dt><dd>{{ data.topicName }}</dd></div>
        <div class="fact"><dt>Connection</dt><dd>{{ context().connection }}</dd></div>
        <div class="fact"><dt>Environment</dt><dd>{{ context().environment }}</dd></div>
      </dl>
      @if (data.isLast) {
        <mat-form-field class="typed">
          <mat-label>Type the rule name to confirm</mat-label>
          <input matInput autocomplete="off" [placeholder]="data.ruleName" [value]="typed()" (input)="typed.set($any($event.target).value)">
        </mat-form-field>
      }
      @if (errorMessage()) {
        <div class="error" role="alert">
          <mat-icon aria-hidden="true">error</mat-icon>
          <span class="grow">{{ errorMessage() }}</span>
          @if (notFound()) {
            <button mat-button type="button" (click)="refresh()">Refresh</button>
          }
        </div>
      }
      @if (deleting()) {
        <mat-progress-bar mode="indeterminate" aria-label="Deleting"></mat-progress-bar>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancel</button>
      <button mat-flat-button class="danger" type="button" [disabled]="!canDelete()" (click)="delete()">Delete rule</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .title { display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; }
    .warn { color: var(--mat-sys-error); }
    .consequence { margin: 0 0 12px; overflow-wrap: anywhere; }
    .facts { margin: 0 0 16px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 12px; }
    .fact { display: flex; justify-content: space-between; gap: 16px; padding: 8px 16px; min-width: 0; }
    .fact + .fact { border-top: 1px solid var(--mat-sys-outline-variant); }
    dt { font-weight: normal; }
    dd { margin: 0; text-align: end; overflow-wrap: anywhere; }
    .typed { width: 100%; }
    .error {
      display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px;
      background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container);
    }
    .grow { flex: 1; min-width: 0; }
    .danger {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
    mat-progress-bar { margin-top: 12px; }
  `]
})
export class RuleDeleteDialogComponent {
  readonly data = inject<RuleDeleteDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<RuleDeleteDialogComponent>);
  private readonly topics = inject(TopicService);

  readonly context = connectionContext();
  readonly typed = signal('');
  readonly deleting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly notFound = signal(false);

  canDelete(): boolean {
    return !this.deleting() && (!this.data.isLast || this.typed() === this.data.ruleName);
  }

  delete(): void {
    if (!this.canDelete()) return;
    this.errorMessage.set(null);
    this.notFound.set(false);
    this.deleting.set(true);
    this.topics.deleteRule(this.data.topicName, this.data.subscriptionName, this.data.ruleName)
      .pipe(finalize(() => this.deleting.set(false)))
      .subscribe({
        next: () => this.dialogRef.close(true),
        error: (error: HttpErrorResponse) => {
          if (error.status === 404) {
            this.notFound.set(true);
            this.errorMessage.set(`${error.error?.message ?? 'The rule no longer exists.'} Refresh to see the rules as they are now.`);
          } else if (error.status === 400) {
            this.errorMessage.set(error.error?.message ?? 'The API refused to delete this rule.');
          } else {
            this.errorMessage.set('Could not delete the rule: the API did not confirm it. Try again.');
          }
        }
      });
  }

  refresh(): void {
    this.dialogRef.close('refresh');
  }
}
