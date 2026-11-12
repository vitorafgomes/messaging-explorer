import { Component, Signal, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { EntityKind } from '../../core/models';
import { ConnectionContext } from './connection-context';

export interface EntityChange {
  label: string;
  from: string;
  to: string;
}

export interface EntityReviewDialogData {
  kind: EntityKind;
  entityName: string;
  topicName?: string;
  /** Read live: the environment may still be loading when the review opens. */
  context: Signal<ConnectionContext>;
  changes: EntityChange[];
}

/** The review step of an edit: the changed fields with their current and new value, and where they apply. Closes with true to apply. */
@Component({
  selector: 'app-entity-review-dialog',
  standalone: true,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButtonModule, MatIconModule, MatTableModule],
  template: `
    <h2 mat-dialog-title class="title">
      <mat-icon class="warn" aria-hidden="true">warning</mat-icon>
      Change the {{ data.kind }} {{ data.entityName }}?
    </h2>
    <mat-dialog-content>
      <p>The new values apply at once to every sender and receiver of this {{ data.kind }}.</p>
      <dl class="facts">
        <div class="fact"><dt>{{ kindLabel }}</dt><dd>{{ data.entityName }}</dd></div>
        @if (data.topicName) {
          <div class="fact"><dt>Topic</dt><dd>{{ data.topicName }}</dd></div>
        }
        <div class="fact"><dt>Connection</dt><dd>{{ data.context().connection }}</dd></div>
        <div class="fact"><dt>Environment</dt><dd>{{ data.context().environment }}</dd></div>
      </dl>
      <table mat-table [dataSource]="data.changes" class="changes">
        <ng-container matColumnDef="field">
          <th mat-header-cell *matHeaderCellDef>Field</th>
          <td mat-cell *matCellDef="let change">{{ change.label }}</td>
        </ng-container>
        <ng-container matColumnDef="from">
          <th mat-header-cell *matHeaderCellDef>Current value</th>
          <td mat-cell *matCellDef="let change">{{ change.from }}</td>
        </ng-container>
        <ng-container matColumnDef="to">
          <th mat-header-cell *matHeaderCellDef>New value</th>
          <td mat-cell *matCellDef="let change">{{ change.to }}</td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="false">Back</button>
      <button mat-flat-button [mat-dialog-close]="true">Apply {{ data.changes.length }} {{ data.changes.length === 1 ? 'change' : 'changes' }}</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .title { display: flex; align-items: center; gap: 8px; }
    .warn { color: var(--mat-sys-error); }
    p { margin: 0 0 12px; }
    .facts {
      margin: 0 0 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
    }
    .fact {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 8px 16px;
      min-width: 0;
    }
    .fact + .fact { border-top: 1px solid var(--mat-sys-outline-variant); }
    dt { font-weight: normal; }
    dd { margin: 0; text-align: end; overflow-wrap: anywhere; }
    .changes { width: 100%; }
  `]
})
export class EntityReviewDialogComponent {
  readonly data = inject<EntityReviewDialogData>(MAT_DIALOG_DATA);
  readonly columns = ['field', 'from', 'to'];
  readonly kindLabel = this.data.kind[0].toUpperCase() + this.data.kind.slice(1);
}
