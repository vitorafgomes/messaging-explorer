import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { EnvironmentLineComponent, EnvironmentMark } from './environment-line.component';
import { connectionContext } from '../features/entities/connection-context';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmColor?: 'primary' | 'warn' | 'accent';
  icon?: string;
  /** Label and value pairs that say exactly what the action applies to. */
  facts?: { label: string; value: string }[];
  /** A sentence set apart in the warning container, such as what else happens first. */
  notice?: string;
  /** The exact text to type, case included, before the confirm button is enabled; surrounding spaces are ignored. */
  typedName?: string;
  /** The label of the typed field, such as "Type the queue name to confirm". */
  typedLabel?: string;
  /**
   * The line under the title, as the artboards draw it: the environment chip, the subject in bold,
   * then where it is. Without `mark` it reads the active connection: its environment, and
   * "on <connection>" unless `where` is given.
   */
  context?: { subject: string; where?: string; mark?: EnvironmentMark };
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, EnvironmentLineComponent],
  template: `
    <h2 mat-dialog-title class="dialog-title">
      @if (data.icon) {
        <mat-icon [color]="data.confirmColor || 'warn'">{{ data.icon }}</mat-icon>
      }
      {{ data.title }}
    </h2>

    <mat-dialog-content>
      @if (line(); as l) {
        <app-environment-line [mark]="l.mark"><b>{{ l.subject }}</b> {{ l.where }}</app-environment-line>
      }
      <p>{{ data.message }}</p>

      @if (data.notice) {
        <p class="notice" role="note"><mat-icon aria-hidden="true">warning</mat-icon><span>{{ data.notice }}</span></p>
      }

      @if (data.facts?.length) {
        <dl class="facts">
          @for (fact of data.facts; track fact.label) {
            <div><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></div>
          }
        </dl>
      }

      @if (data.typedName !== undefined) {
        <mat-form-field appearance="outline" class="typed-name">
          <mat-label>{{ data.typedLabel || 'Type the name to confirm' }}</mat-label>
          <input matInput [placeholder]="data.typedName" autocomplete="off" spellcheck="false" (input)="typed.set($any($event.target).value)">
          <mat-hint>The button stays disabled until the name matches exactly.</mat-hint>
        </mat-form-field>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>
        {{ data.cancelText || 'Cancel' }}
      </button>
      <button
        mat-flat-button
        [class.destructive]="destructive"
        [disabled]="!confirmable()"
        [mat-dialog-close]="true">
        @if (destructive) {
          <mat-icon fontIcon="delete" aria-hidden="true"></mat-icon>
        }
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

    .notice {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-top: 12px;
      padding: 10px 14px;
      border-radius: 8px;
      background: var(--app-warning-container);
      color: var(--app-on-warning-container);
    }

    .facts {
      margin: 12px 0 0;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }

    .facts div {
      display: flex;
      gap: 16px;
      padding: 8px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    .facts dt {
      flex: 0 0 40%;
      color: var(--mat-sys-on-surface-variant);
    }

    .facts dd {
      flex: 1;
      min-width: 0;
      margin: 0;
      overflow-wrap: anywhere;
    }


    .destructive {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }

    .typed-name {
      display: block;
      margin-top: 16px;
    }

    .typed-name input {
      font-family: ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace;
    }
  `]
})
export class ConfirmDialogComponent {
  data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
  typed = signal('');
  /** A destructive confirm, the default: filled error with the delete icon, as Components.dc.html draws it. */
  readonly destructive = (this.data.confirmColor || 'warn') === 'warn';
  /** The active connection, read only when the line needs it. */
  private readonly active = this.data.context && !this.data.context.mark ? connectionContext() : null;
  /** The environment line, or null when the dialog was opened without a context. */
  readonly line = computed(() => {
    const context = this.data.context;
    if (!context) return null;
    const active = this.active?.();
    return { subject: context.subject, where: context.where ?? `on ${active?.where}`, mark: context.mark ?? active?.mark };
  });
  /** True once every requirement the dialog was opened with is met. */
  readonly confirmable = computed(() =>
    (this.data.typedName === undefined || this.typed().trim() === this.data.typedName));
}
