import { Injectable, inject } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DevSettingsService } from '../../core/services/dev-settings.service';
import { ThemeMode, ThemeService } from '../../core/services/theme.service';
import { AppUpdateService, UpdateChannel } from './app-update.service';
import { McpAppAnswer, McpAppRequest, McpSettingsService } from './mcp-settings.service';

/**
 * The only settings an assistant may change, and the only values each may take. Anything else, the MCP server group,
 * clearing the data and an update included, is answered failed and never reached.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  theme: ['system', 'light', 'dark'],
  developerMode: ['on', 'off'],
  updateChannel: ['latest', 'beta'],
};

const NAMES: Record<string, string> = { theme: 'Theme', developerMode: 'Developer mode', updateChannel: 'Update channel' };

/**
 * Applies the changes of a setting of this app an assistant asked for, each once and in the order the API lists them,
 * and answers each with the settings after it. The user's choice in Settings decides whether the API keeps such requests.
 */
@Injectable({ providedIn: 'root' })
export class McpAppSettingsService {
  private readonly mcp = inject(McpSettingsService);
  private readonly theme = inject(ThemeService);
  private readonly dev = inject(DevSettingsService);
  private readonly updates = inject(AppUpdateService);
  private readonly snackBar = inject(MatSnackBar);
  /** The requests already applied, which a later list never applies again. */
  private readonly handled = new Set<string>();

  /** Applies and answers each request not handled yet; an answer the API refuses, a 404 included, is let go. */
  async apply(list: McpAppRequest[]): Promise<void> {
    for (const request of list) {
      if (this.handled.has(request.id)) continue;
      this.handled.add(request.id);
      const outcome = await this.change(request);
      const answer: McpAppAnswer = { ...outcome, settings: this.settings() };
      await lastValueFrom(this.mcp.answerAppRequest(request.id, answer), { defaultValue: undefined }).catch(() => undefined);
    }
  }

  private async change(request: McpAppRequest): Promise<Omit<McpAppAnswer, 'settings'>> {
    const { setting, value } = request;
    if (setting === null) return { applied: true, code: null };
    if (typeof setting !== 'string' || !Object.hasOwn(ALLOWED, setting) || !ALLOWED[setting].includes(value as string)) {
      return { applied: false, code: 'failed' };
    }
    if (setting === 'theme') {
      if (this.theme.mode() === value) return { applied: true, code: null };
      this.theme.setMode(value as ThemeMode);
    } else if (setting === 'developerMode') {
      if (this.dev.devMode() === (value === 'on')) return { applied: true, code: null };
      this.dev.toggle();
    } else {
      if (!this.hasShell()) return { applied: false, code: 'desktopOnly' };
      if (this.updates.channel() === value) return { applied: true, code: null };
      await this.updates.setChannel(value as UpdateChannel).catch(() => undefined);
      if (this.updates.channelError() || this.updates.channel() !== value) return { applied: false, code: 'failed' };
    }
    this.snackBar.open(`${request.assistant} set ${NAMES[setting]} to ${value}`, 'Close', { duration: 4000 });
    return { applied: true, code: null };
  }

  private settings(): McpAppAnswer['settings'] {
    return {
      theme: this.theme.mode(),
      developerMode: this.dev.devMode(),
      updateChannel: this.hasShell() ? this.updates.channel() : null,
    };
  }

  /** Whether the desktop shell is there, read as Settings reads it before it offers the channel. */
  private hasShell(): boolean {
    return this.updates.status() !== 'unavailable';
  }
}
