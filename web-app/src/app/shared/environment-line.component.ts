import { Component, input } from '@angular/core';
import { EnvironmentChipComponent } from './environment-chip.component';

/** The environment a chip draws: the environment group's name, null when the connection is in none. */
export interface EnvironmentMark {
  name: string | null;
  isProduction: boolean;
}

/**
 * The line under a dialog title that says where the change lands: the environment chip, then the
 * projected text, such as "<b>orders</b> on contoso-prod (host)". While the environment is not
 * known it says so in words, never NO ENVIRONMENT.
 */
@Component({
  selector: 'app-environment-line',
  standalone: true,
  imports: [EnvironmentChipComponent],
  template: `
    <p class="environment-line">
      @if (mark(); as m) {
        <span class="visually-hidden">Environment: </span><app-environment-chip [name]="m.name" [isProduction]="m.isProduction" />
      } @else {
        <span class="not-known">Environment not known</span>
      }
      <span class="where"><ng-content /></span>
    </p>
  `,
  styles: [`
    .environment-line {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 0 0 12px;
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-on-surface-variant);
    }

    .where {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .not-known {
      display: inline-flex;
      align-items: center;
      height: 24px;
      padding: 0 10px;
      box-sizing: border-box;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 999px;
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
  `]
})
export class EnvironmentLineComponent {
  /** The environment to draw; absent while it is not known. */
  readonly mark = input<EnvironmentMark | undefined>();
}
