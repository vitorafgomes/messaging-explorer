import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmColor?: 'primary' | 'warn' | 'accent';
  icon?: string;
  // When set, the confirm button stays disabled until the user ticks an
  // acknowledgement checkbox. Used for high-risk actions such as draining an
  // entire queue.
  requireAcknowledgement?: boolean;
  acknowledgementText?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatCheckboxModule],
  template: `
    <h2 mat-dialog-title class="dialog-title">
      @if (data.icon) {
        <mat-icon [color]="data.confirmColor || 'warn'">{{ data.icon }}</mat-icon>
      }
      {{ data.title }}
    </h2>

    <mat-dialog-content>
      <p>{{ data.message }}</p>

      @if (data.requireAcknowledgement) {
        <mat-checkbox
          class="acknowledgement"
          [color]="data.confirmColor || 'warn'"
          [checked]="acknowledged()"
          (change)="acknowledged.set($event.checked)">
          {{ data.acknowledgementText || 'I understand this action is irreversible' }}
        </mat-checkbox>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-stroked-button mat-dialog-close>
        {{ data.cancelText || 'Cancel' }}
      </button>
      <button
        mat-flat-button
        [color]="data.confirmColor || 'warn'"
        [disabled]="data.requireAcknowledgement && !acknowledged()"
        [mat-dialog-close]="true">
        {{ data.confirmText || 'Confirm' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    mat-dialog-content p {
      margin: 0;
    }

    .acknowledgement {
      display: block;
      margin-top: 16px;
    }
  `]
})
export class ConfirmDialogComponent {
  data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
  acknowledged = signal(false);
}
