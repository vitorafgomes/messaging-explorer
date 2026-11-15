import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * The environment of a connection as a chip: the environment's name in capitals, in the error container
 * with a warning icon when it is marked production, in the secondary container otherwise, and NO ENVIRONMENT
 * in the warning container when the connection is in none, as the Connections artboard draws it.
 */
@Component({
  selector: 'app-environment-chip',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <span class="environment-chip" [class.production]="isProduction() && !!name()" [class.none]="!name()">
      @if (isProduction() && name()) {
        <mat-icon aria-hidden="true">warning</mat-icon>
      }
      {{ name() ? name()!.toUpperCase() : 'NO ENVIRONMENT' }}
    </span>
  `,
  styles: [`
    .environment-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 24px;
      padding: 0 10px;
      box-sizing: border-box;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      font-weight: 700;
      letter-spacing: .06em;
      white-space: nowrap;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);

      &.production {
        background: var(--mat-sys-error-container);
        color: var(--mat-sys-on-error-container);
      }

      &.none {
        background: var(--app-warning-container);
        color: var(--app-on-warning-container);
      }

      mat-icon {
        width: 14px;
        height: 14px;
        font-size: 14px;
      }
    }
  `]
})
export class EnvironmentChipComponent {
  /** The environment's name; empty when the connection is in no environment. */
  readonly name = input<string | null | undefined>();
  /** Whether the environment is marked production in Manage Groups. */
  readonly isProduction = input(false);
}
