import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogConfig, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { McpRequest, McpSettingsService } from './mcp-settings.service';

/** How a request dialog ended: allowed or denied by the user, or no longer waiting. */
export type McpRequestOutcome = 'allowed' | 'denied' | 'gone';

/** The kinds of request this version of the app can allow. */
const KNOWN_KINDS = ['read', 'send', 'connect'];

/**
 * The window that asks the user about one request of an assistant, as Settings.dc.html draws `mcp.ask`.
 * Only Deny and the allow button answer it; Escape and a click outside do nothing, and every text from the API
 * is shown as text.
 */
@Component({
  selector: 'app-mcp-request-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './mcp-request-dialog.component.html',
  styleUrl: './mcp-request-dialog.component.scss',
})
export class McpRequestDialogComponent {
  /** How the dialog is opened: it closes only by an answer or by the request going away, with focus on Deny. */
  static readonly config: MatDialogConfig = { disableClose: true, autoFocus: 'button.deny', width: '560px' };

  readonly request = inject<McpRequest>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<McpRequestDialogComponent, McpRequestOutcome>>(MatDialogRef);
  private readonly mcp = inject(McpSettingsService);

  readonly canAllow = KNOWN_KINDS.includes(this.request.kind);
  readonly error = signal('');
  readonly sending = signal(false);

  answer(allow: boolean): void {
    if (this.sending()) return;
    this.sending.set(true);
    this.error.set('');
    this.mcp.answer(this.request.id, allow).subscribe({
      next: () => this.ref.close(allow ? 'allowed' : 'denied'),
      error: (error: { status?: number; error?: { message?: unknown } }) => {
        if (error?.status === 404) { this.ref.close('gone'); return; }
        this.sending.set(false);
        const message = error?.error?.message;
        this.error.set(`Your answer was not sent: ${typeof message === 'string' && message ? message
          : error?.status ? `the API answered ${error.status}.` : 'the API of this app did not answer.'}`);
      },
    });
  }
}
