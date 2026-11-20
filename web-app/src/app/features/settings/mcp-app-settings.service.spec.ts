import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { OverlayContainer } from '@angular/cdk/overlay';
import { DevSettingsService, ThemeService } from '../../core/services';
import { environment } from '../../../environments/environment';
import { AppUpdateService, UpdateChannel, UpdateStatus } from './app-update.service';
import { McpAppSettingsService } from './mcp-app-settings.service';
import { McpAppAnswer, McpAppRequest } from './mcp-settings.service';
import type { ThemeMode } from '../../core/services/theme.service';

const BASE = environment.apiUrl;

const request = (id: string, setting: string | null, value: string | null, assistant = 'Claude Code'): McpAppRequest =>
  ({ id, time: '2026-11-20T10:00:00Z', assistant, setting: setting as McpAppRequest['setting'], value });

describe('McpAppSettingsService: the app applies a change of its settings an assistant asked for, from a fixed list, and answers it', () => {
  let service: McpAppSettingsService;
  let http: HttpTestingController;
  let theme: { mode: ReturnType<typeof signal<ThemeMode>>; setMode: ReturnType<typeof vi.fn> };
  let dev: { devMode: ReturnType<typeof signal<boolean>>; toggle: ReturnType<typeof vi.fn> };
  let updates: {
    status: ReturnType<typeof signal<UpdateStatus>>; channel: ReturnType<typeof signal<UpdateChannel>>;
    channelError: ReturnType<typeof signal<string>>; setChannel: ReturnType<typeof vi.fn>;
  };
  let snackBar: { open: ReturnType<typeof vi.fn> };

  function setUp(options: { realSnackBar?: boolean } = {}) {
    theme = { mode: signal<ThemeMode>('system'), setMode: vi.fn((mode: ThemeMode) => theme.mode.set(mode)) };
    dev = { devMode: signal(false), toggle: vi.fn(() => dev.devMode.set(!dev.devMode())) };
    updates = {
      status: signal<UpdateStatus>('idle'),
      channel: signal<UpdateChannel>('latest'),
      channelError: signal(''),
      setChannel: vi.fn(async (channel: UpdateChannel) => { updates.channel.set(channel); }),
    };
    snackBar = { open: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ThemeService, useValue: theme },
        { provide: DevSettingsService, useValue: dev },
        { provide: AppUpdateService, useValue: updates },
        ...(options.realSnackBar ? [] : [{ provide: MatSnackBar, useValue: snackBar }]),
      ],
    });
    service = TestBed.inject(McpAppSettingsService);
    http = TestBed.inject(HttpTestingController);
  }

  /** Applies the list, answering each POST with 204, and returns the bodies the app answered, by request id. */
  async function apply(list: McpAppRequest[]): Promise<Record<string, McpAppAnswer>> {
    const answers: Record<string, McpAppAnswer> = {};
    const done = service.apply(list);
    for (const r of list) {
      const call = await vi.waitFor(() => http.expectOne(`${BASE}/mcp/app-requests/${encodeURIComponent(r.id)}/answer`));
      expect(call.request.method, 'an answer is a POST').toBe('POST');
      answers[r.id] = call.request.body;
      call.flush(null, { status: 204, statusText: 'No Content' });
    }
    await done;
    http.verify();
    return answers;
  }

  afterEach(() => {
    TestBed.inject(OverlayContainer).ngOnDestroy();
    vi.clearAllMocks();
  });

  it('a request with no setting changes nothing and answers applied with the settings as they are, through ApiService', async () => {
    setUp();
    updates.channel.set('beta');
    const answers = await apply([request('a/1 ?', null, null)]);

    expect(answers['a/1 ?'], 'a read answers applied, with the theme, Developer mode and the update channel').toStrictEqual(
      { applied: true, code: null, settings: { theme: 'system', developerMode: false, updateChannel: 'beta' } });
    expect(theme.setMode, 'a read changes no theme').not.toHaveBeenCalled();
    expect(dev.toggle, 'a read changes no Developer mode').not.toHaveBeenCalled();
    expect(updates.setChannel, 'a read changes no channel').not.toHaveBeenCalled();
    expect(snackBar.open, 'a read shows nothing').not.toHaveBeenCalled();
  });

  it('theme, Developer mode and the update channel are applied, each answered with the settings after it and shown in a snack bar for 4 seconds', async () => {
    setUp();
    const answers = await apply([request('t', 'theme', 'dark'), request('d', 'developerMode', 'on'), request('u', 'updateChannel', 'beta')]);

    expect(theme.setMode.mock.calls, 'the theme goes through ThemeService.setMode').toStrictEqual([['dark']]);
    expect(dev.toggle, 'Developer mode goes through the path Ctrl+Shift+D uses').toHaveBeenCalledTimes(1);
    expect(updates.setChannel.mock.calls, 'the channel goes through AppUpdateService.setChannel').toStrictEqual([['beta']]);
    expect(answers, 'each answer carries the settings after its own change').toStrictEqual({
      t: { applied: true, code: null, settings: { theme: 'dark', developerMode: false, updateChannel: 'latest' } },
      d: { applied: true, code: null, settings: { theme: 'dark', developerMode: true, updateChannel: 'latest' } },
      u: { applied: true, code: null, settings: { theme: 'dark', developerMode: true, updateChannel: 'beta' } },
    });
    expect(snackBar.open.mock.calls, 'each applied change names the assistant, the setting and the value, with Close, for 4 seconds').toStrictEqual([
      ['Claude Code set Theme to dark', 'Close', { duration: 4000 }],
      ['Claude Code set Developer mode to on', 'Close', { duration: 4000 }],
      ['Claude Code set Update channel to beta', 'Close', { duration: 4000 }],
    ]);
  });

  it('a value already set changes nothing, answers applied and shows no snack bar', async () => {
    setUp();
    theme.mode.set('light');
    dev.devMode.set(true);
    const answers = await apply([request('t', 'theme', 'light'), request('d', 'developerMode', 'on'), request('u', 'updateChannel', 'latest')]);

    expect(theme.setMode, 'the theme already asked is not set again').not.toHaveBeenCalled();
    expect(dev.toggle, 'Developer mode already on is not toggled off').not.toHaveBeenCalled();
    expect(updates.setChannel, 'the channel already chosen is not set again').not.toHaveBeenCalled();
    expect(Object.values(answers).map(a => [a.applied, a.code]), 'each is answered applied').toStrictEqual([[true, null], [true, null], [true, null]]);
    expect(snackBar.open, 'nothing changed, so nothing is shown').not.toHaveBeenCalled();
  });

  it('the update channel without the desktop shell is answered desktopOnly, with no channel in the settings, and nothing is changed', async () => {
    setUp();
    updates.status.set('unavailable');
    const answers = await apply([request('u', 'updateChannel', 'beta'), request('r', null, null)]);

    expect(updates.setChannel, 'no channel is set where the desktop shell is not there').not.toHaveBeenCalled();
    expect(answers['u'], 'the update channel can be changed only in the desktop app').toStrictEqual(
      { applied: false, code: 'desktopOnly', settings: { theme: 'system', developerMode: false, updateChannel: null } });
    expect(answers['r'].settings.updateChannel, 'without the desktop shell the settings name no channel').toBeNull();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('a channel the desktop shell refused is answered failed, with the channel as it stayed, and shows no snack bar', async () => {
    setUp();
    updates.setChannel.mockImplementation(async () => { updates.channelError.set('The updater refused.'); });
    const answers = await apply([request('u', 'updateChannel', 'beta')]);

    expect(answers['u'], 'a channel left with an error is not applied').toStrictEqual(
      { applied: false, code: 'failed', settings: { theme: 'system', developerMode: false, updateChannel: 'latest' } });
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('nothing in this path reaches the MCP group, clearing the data or an update: any other setting, or a value off the list, is answered failed and changes nothing', async () => {
    setUp();
    const others = ['mcpEnabled', 'token', 'clearData', 'installUpdate', 'appSettingsAllowed', 'constructor', '__proto__', 'toString']
      .map((name, i) => request(`o${i}`, name, 'on'));
    const offList = [request('v1', 'theme', 'purple'), request('v2', 'developerMode', 'true'), request('v3', 'updateChannel', 'alpha'), request('v4', 'theme', null)];
    const answers = await apply([...others, ...offList]);

    for (const r of [...others, ...offList]) {
      expect(answers[r.id], `"${r.setting}" set to "${r.value}" is not on the fixed list, so it is answered applied false, code failed`).toStrictEqual(
        { applied: false, code: 'failed', settings: { theme: 'system', developerMode: false, updateChannel: 'latest' } });
    }
    expect(theme.setMode, 'no theme was changed').not.toHaveBeenCalled();
    expect(dev.toggle, 'no Developer mode was changed').not.toHaveBeenCalled();
    expect(updates.setChannel, 'no channel was changed').not.toHaveBeenCalled();
    expect(snackBar.open, 'nothing was shown as changed').not.toHaveBeenCalled();
  });

  it('a request is applied once: a later list that still holds it applies and answers nothing', async () => {
    setUp();
    await apply([request('t', 'theme', 'dark')]);
    await service.apply([request('t', 'theme', 'light')]);

    http.verify();
    expect(theme.setMode.mock.calls, 'the request with the same id is not applied again').toStrictEqual([['dark']]);
  });

  it('an answer the API refuses (404, it no longer waits) is ignored, and the next request is still applied', async () => {
    setUp();
    const done = service.apply([request('gone', 'theme', 'dark'), request('next', 'developerMode', 'on')]);
    await vi.waitFor(() => http.expectOne(`${BASE}/mcp/app-requests/gone/answer`).flush({ message: 'gone' }, { status: 404, statusText: 'Not Found' }));
    await vi.waitFor(() => http.expectOne(`${BASE}/mcp/app-requests/next/answer`).flush(null, { status: 204, statusText: 'No Content' }));
    await expect(done, 'a 404 on an answer does not fail the run').resolves.toBeUndefined();
    expect(dev.toggle, 'the request after it is still applied').toHaveBeenCalledTimes(1);
  });

  it('the assistant name is shown in the snack bar as text, never as markup', async () => {
    setUp({ realSnackBar: true });
    await apply([request('t', 'theme', 'dark', '<img src=x onerror=alert(1)>')]);

    const label = document.querySelector('[matsnackbarlabel]');
    expect(label?.textContent?.trim(), 'the name reads exactly as the API sent it').toBe('<img src=x onerror=alert(1)> set Theme to dark');
    expect(label?.querySelector('img'), 'no element is made from the name').toBeNull();
  });
});
