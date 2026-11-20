import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, computed, signal } from '@angular/core';
import { App } from './app';
import { routes } from './app.routes';
import { ConnectionService, ConnectionGroupService, ThemeService, EntitySelectionService, DevSettingsService, ResubmitRun, ResubmitRunService } from './core/services';
import { DeadLetterNotificationService } from './core/services/dead-letter-notification.service';
import { McpAppRequest, McpRequest, McpSettingsService, McpState } from './features/settings/mcp-settings.service';
import { McpAppSettingsService } from './features/settings/mcp-app-settings.service';

@Component({ template: '' })
class StubScreen {}

const routePaths = routes.map(r => r.path).filter((p): p is string => !!p);

describe('App', () => {
  const status = new BehaviorSubject<{ connected: boolean; namespace?: string }>({ connected: false });
  const groupsChanged = new Subject<void>();
  const connectionSaved = new Subject<void>();
  let prodMarked = true;
  const mockConnectionService = {
    connectionStatus$: status,
    saved$: connectionSaved,
    get isConnected() { return status.value.connected; },
    connect: () => of(null),
    readStatus: vi.fn((): Observable<{ connected: boolean; connectionId?: string }> => of({ connected: false })),
    peekStatus: vi.fn((): Observable<{ connected: boolean; connectionId?: string }> => of({ connected: false })),
    refreshStatus: vi.fn(),
    currentConnectionId: null as string | null,
    get currentTarget() { return status.value.namespace; },
    getConnections: () => of([
      { id: 'c-prod', name: 'contoso-prod', clientId: 'g-client', environmentId: 'g-prod' },
      { id: 'c-dev', name: 'contoso-dev', clientId: 'g-client', environmentId: 'g-dev' },
      { id: 'c-none', name: 'local' },
    ]),
  };
  const mockGroupService = {
    changed$: groupsChanged,
    getGroups: () => of([
      { id: 'g-client', name: 'Contoso', type: 'client' },
      { id: 'g-prod', name: 'Production', type: 'environment', parentId: 'g-client', isProduction: prodMarked },
      { id: 'g-dev', name: 'Development', type: 'environment', parentId: 'g-client' },
    ]),
  };

  const mockThemeService = {
    isDark: signal(false),
    themeLabel: signal('Light'),
    themeIcon: signal('light_mode'),
    initialize: vi.fn(),
    toggle: vi.fn(),
  };

  const mockEntitySelectionService = {
    navigateToSubscription: vi.fn(),
  };

  const alerts = signal<{ topicName: string; subscriptionName: string; deadLetterMessageCount: number }[]>([]);
  const mockDlqService = {
    alerts,
    alertCount: computed(() => alerts().length),
    hasAlerts: computed(() => alerts().length > 0),
  };

  const activeRuns = signal<ResubmitRun[]>([]);

  /** The MCP server as the API answers it; off unless a spec turns it on. */
  const mcpState = signal<McpState | null>(null);
  const mockMcp = {
    state: mcpState,
    load: vi.fn(() => of(mcpState())),
    requests: vi.fn((): Observable<McpRequest[]> => of([])),
    answer: vi.fn((): Observable<void> => of(undefined)),
    appRequests: vi.fn((): Observable<McpAppRequest[]> => of([])),
  };
  const mockAppSettings = { apply: vi.fn(async (_list: McpAppRequest[]) => {}) };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideNoopAnimations(),
        provideRouter(routePaths.map(path => ({ path, component: StubScreen }))),
        { provide: ConnectionService, useValue: mockConnectionService },
        { provide: ConnectionGroupService, useValue: mockGroupService },
        { provide: ThemeService, useValue: mockThemeService },
        { provide: EntitySelectionService, useValue: mockEntitySelectionService },
        { provide: DeadLetterNotificationService, useValue: mockDlqService },
        { provide: ResubmitRunService, useValue: { activeRuns } },
        { provide: McpSettingsService, useValue: mockMcp },
        { provide: McpAppSettingsService, useValue: mockAppSettings },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    TestBed.inject(OverlayContainer).ngOnDestroy();
    vi.useRealTimers();
    vi.clearAllMocks();
    mockMcp.requests.mockImplementation(() => of([]));
    mockMcp.answer.mockImplementation(() => of(undefined));
    mockMcp.appRequests.mockImplementation(() => of([]));
    mockConnectionService.readStatus.mockImplementation(() => of({ connected: false }));
    status.next({ connected: false });
    activeRuns.set([]);
    mcpState.set(null);
    mockConnectionService.currentConnectionId = null;
    alerts.set([]);
    delete (window as any).electronAPI;
    localStorage.removeItem('dev-mode');
  });

  it('should initialize theme on init', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(mockThemeService.initialize).toHaveBeenCalled();
  });

  describe('the environment chip on the toolbar, between the nav separator and the broker, as Main and Connections draw it', () => {
    function connectTo(connectionId: string | null): HTMLElement {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      mockConnectionService.currentConnectionId = connectionId;
      status.next({ connected: true, namespace: 'contoso.servicebus.windows.net' });
      fixture.detectChanges();
      return fixture.nativeElement.querySelector('mat-toolbar') as HTMLElement;
    }

    it('marking or unmarking the environment Production while connected changes the toolbar chip at once', () => {
      prodMarked = false;
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      mockConnectionService.currentConnectionId = 'c-prod';
      status.next({ connected: true, namespace: 'contoso.servicebus.windows.net' });
      fixture.detectChanges();
      const chip = () => (fixture.nativeElement as HTMLElement).querySelector('mat-toolbar .environment-chip');
      expect(chip()?.classList.contains('production'), 'not marked yet').toBe(false);

      prodMarked = true;
      groupsChanged.next();
      fixture.detectChanges();
      expect(chip()?.classList.contains('production'), 'a group saved: the chip reads the mark again').toBe(true);

      prodMarked = false;
      connectionSaved.next();
      fixture.detectChanges();
      expect(chip()?.classList.contains('production'), 'a connection saved: the chip reads again').toBe(false);
      prodMarked = true;
    });

    it('a connection in a production environment: "Environment:" for a screen reader, then PRODUCTION in the error container with a warning icon, after the separator and before the broker', () => {
      const toolbar = connectTo('c-prod');
      const environment = toolbar.querySelector('.environment') as HTMLElement;
      const chip = environment.querySelector('.environment-chip') as HTMLElement;

      expect(environment.querySelector('.visually-hidden')?.textContent, 'a hidden "Environment:" names the chip').toBe('Environment: ');
      expect(chip.textContent?.replace('warning', '').trim(), 'a production environment says PRODUCTION').toBe('PRODUCTION');
      expect(chip.classList.contains('production'), 'PRODUCTION takes the error container').toBe(true);
      expect(chip.querySelector('mat-icon')?.textContent?.trim()).toBe('warning');
      expect(environment.previousElementSibling?.classList.contains('nav-separator'), 'the chip follows the nav separator').toBe(true);
      expect(environment.nextElementSibling?.classList.contains('broker'), 'the broker follows the chip').toBe(true);
    });

    it('a connection in an environment not marked production shows the environment name in capitals', () => {
      expect(connectTo('c-dev').querySelector('.environment-chip')?.textContent?.trim(), 'the environment name in capitals').toBe('DEVELOPMENT');
    });

    it('a connection in no environment shows NO ENVIRONMENT', () => {
      expect(connectTo('c-none').querySelector('.environment-chip')?.textContent?.trim(), 'no environment says NO ENVIRONMENT').toBe('NO ENVIRONMENT');
    });

    it('when the app does not know which stored connection is active, the toolbar shows no chip rather than NO ENVIRONMENT', () => {
      expect(connectTo(null).querySelector('.environment'), 'an environment that is not known is never drawn as NO ENVIRONMENT').toBeNull();
    });

    it('disconnected, the toolbar shows no environment', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('mat-toolbar .environment')).toBeNull();
    });
  });

  describe('in Electron mode', () => {
    beforeEach(() => {
      (window as any).electronAPI = {
        platform: 'darwin',
        getAppVersion: () => Promise.resolve('2.4.1'),
        getUpdateChannel: () => Promise.resolve('latest'),
        onUpdateStatus: () => {},
        onNavigate: () => {},
        onChangeConnection: () => {},
      };
    });

    it('the main nav is exactly Connections, Entities and Monitoring, as the artboard draws; Queues and Topics stay routes reached by URL', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const links: HTMLAnchorElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('mat-toolbar nav[aria-label="Main"] a'));
      const settings = fixture.nativeElement.querySelector('mat-toolbar a[aria-label="Settings"]') as HTMLAnchorElement;

      expect(routePaths).toEqual(['connections', 'entities', 'queues', 'topics', 'monitoring', 'logs', 'settings']);
      expect(links.map(a => a.textContent?.trim()), 'the nav draws three links').toEqual(['Connections', 'Entities', 'Monitoring']);
      expect([...links, settings].map(a => a.getAttribute('href'))).toEqual(['/connections', '/entities', '/monitoring', '/settings']);
    });

    it('Logs is on the toolbar beside Monitoring only while Developer mode is on, as Logs.dc.html draws', () => {
      const devSettings = TestBed.inject(DevSettingsService);
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const logs = () => fixture.nativeElement.querySelector('[data-testid="nav-logs"]') as HTMLAnchorElement | null;
      const wasOn = devSettings.devMode();
      if (wasOn) devSettings.toggle();
      fixture.detectChanges();
      expect(logs(), 'off: no Logs').toBeNull();

      devSettings.toggle();
      fixture.detectChanges();
      expect(logs()?.getAttribute('href')).toBe('/logs');
      expect(logs()?.previousElementSibling?.textContent?.trim()).toBe('Monitoring');

      devSettings.toggle();
      if (wasOn) devSettings.toggle();
    });

    it('the toolbar no longer shows the version or the badge that opened the channel menu: they live in Settings', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const toolbar = fixture.nativeElement.querySelector('mat-toolbar') as HTMLElement;
      expect(toolbar.textContent).not.toContain('2.4.1');
      expect(toolbar.querySelector('.version-badge')).toBeNull();
      expect(Array.from(toolbar.querySelectorAll('[aria-haspopup="menu"]')).map(b => b.querySelector('mat-icon')?.textContent?.trim()))
        .toEqual(['notifications', 'help_outline']);
    });

    it('an available update shows in the toolbar as a link to Settings, never a direct download', async () => {
      let push: (data: unknown) => void = () => {};
      const downloadUpdate = vi.fn();
      Object.assign((window as any).electronAPI, { onUpdateStatus: (cb: (d: unknown) => void) => { push = cb; }, downloadUpdate });
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await fixture.whenStable();
      push({ status: 'available', version: '2.5.0' });
      fixture.detectChanges();

      const indicator = fixture.nativeElement.querySelector('mat-toolbar a[aria-label="Version 2.5.0 is available: open Settings"]') as HTMLAnchorElement;
      expect(indicator.getAttribute('href')).toBe('/settings');
      expect(indicator.textContent?.trim()).toContain('Update v2.5.0');
      indicator.click();
      expect(downloadUpdate).not.toHaveBeenCalled();
    });

    it('tells the shell how many resubmits run when one starts and when it ends, so quitting can ask first', () => {
      const setActiveRuns = vi.fn();
      Object.assign((window as any).electronAPI, { setActiveRuns });
      const run = {
        target: { entityType: 'queue', entityName: 'orders', subQueue: 'deadletter' },
        progress: signal({ status: 'running', read: 1, total: 10, failed: 0, possibleDuplicates: 0, remainingMs: 1000 }),
        pause: vi.fn(), resume: vi.fn(), stop: vi.fn()
      } as unknown as ResubmitRun;
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      expect(setActiveRuns.mock.calls, 'the shell hears 0 when the page starts').toEqual([[0]]);

      activeRuns.set([run]);
      fixture.detectChanges();
      expect(setActiveRuns.mock.calls.at(-1), 'the shell hears 1 when a run starts').toEqual([1]);

      activeRuns.set([]);
      fixture.detectChanges();
      expect(setActiveRuns.mock.calls, 'the shell hears 0 when the run ends, and once per change').toEqual([[0], [1], [0]]);
    });

    it('the toolbar marks the active route', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await TestBed.inject(Router).navigateByUrl('/monitoring');
      fixture.detectChanges();
      await fixture.whenStable();

      const current = Array.from(fixture.nativeElement.querySelectorAll('mat-toolbar nav a[aria-current="page"]'))
        .map(a => (a as HTMLElement).textContent?.trim());
      expect(current).toEqual(['Monitoring']);
    });
  });

  it('with no connection, Entities and Monitoring are disabled on the toolbar; once connected, they open', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const link = (label: string) => Array.from(fixture.nativeElement.querySelectorAll('mat-toolbar nav[aria-label="Main"] a') as NodeListOf<HTMLAnchorElement>)
      .find(a => a.textContent?.trim() === label)!;

    expect(['Connections', 'Entities', 'Monitoring'].map(l => link(l).getAttribute('aria-disabled') === 'true')).toStrictEqual([false, true, true]);

    status.next({ connected: true, namespace: 'sample.servicebus.windows.net' });
    fixture.detectChanges();
    expect(['Connections', 'Entities', 'Monitoring'].map(l => link(l).getAttribute('aria-disabled') === 'true')).toStrictEqual([false, false, false]);
  });

  it('in the browser, where the shell is not there, a run starting and ending sends nothing and throws nothing', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    activeRuns.set([{ progress: signal({ status: 'running' }), target: { entityName: 'orders' } } as unknown as ResubmitRun]);
    expect(() => fixture.detectChanges(), 'a run starting without the shell must not throw').not.toThrow();
    activeRuns.set([]);
    expect(() => fixture.detectChanges(), 'a run ending without the shell must not throw').not.toThrow();
    expect((window as any).electronAPI, 'nothing is created where the shell is not there').toBeUndefined();
  });

  it('in the browser the toolbar has the same links, Settings included', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const hrefs = Array.from(fixture.nativeElement.querySelectorAll('mat-toolbar nav[aria-label="Main"] a, mat-toolbar a[aria-label="Settings"]'))
      .map(a => (a as HTMLAnchorElement).getAttribute('href'));
    expect(hrefs).toEqual(['/connections', '/entities', '/monitoring', '/settings']);
  });

  describe('the toolbar, as the Main and Connections artboards draw it', () => {
    const NAMESPACE = 'contoso-prod.servicebus.windows.net';
    const render = () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      return fixture;
    };
    const toolbarOf = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement.querySelector('mat-toolbar') as HTMLElement;
    const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const spoken = (el: Element) => {
      const copy = el.cloneNode(true) as Element;
      copy.querySelectorAll('mat-icon').forEach(i => i.remove());
      return copy.textContent?.trim();
    };

    it('a 1px separator, hidden from assistive technology, follows the nav', () => {
      const toolbar = toolbarOf(render());
      const separator = toolbar.querySelector('nav[aria-label="Main"]')!.nextElementSibling as HTMLElement;
      expect(separator.classList.contains('nav-separator'), 'the element right after the nav is the separator').toBe(true);
      expect(separator.getAttribute('aria-hidden')).toBe('true');
      expect(separator.textContent).toBe('');
    });

    it('connected: a check-circle icon, a hidden "Connected to" and the namespace with its title, after the separator and before the icon buttons, never a pill', () => {
      status.next({ connected: true, namespace: NAMESPACE });
      const toolbar = toolbarOf(render());
      const broker = toolbar.querySelector('.broker') as HTMLElement;

      expect(broker.getAttribute('title'), 'the full namespace on hover').toBe(NAMESPACE);
      expect(broker.querySelector('mat-icon')?.textContent?.trim()).toBe('check_circle');
      expect(broker.querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');
      expect(broker.querySelector('.visually-hidden')?.textContent?.trim(), 'a screen reader hears "Connected to"').toBe('Connected to');
      expect(broker.querySelector('.broker-name')?.textContent?.trim(), 'the namespace, which shortens with an ellipsis').toBe(NAMESPACE);
      expect(spoken(broker), 'read aloud as one sentence').toBe(`Connected to ${NAMESPACE}`);
      expect(toolbar.querySelector('.connection-badge'), 'no coloured pill').toBeNull();
      expect(toolbar.querySelector('.spacer'), 'the broker takes the free space').toBeNull();
      expect(follows(toolbar.querySelector('.nav-separator')!, broker), 'after the separator').toBe(true);
      expect(follows(broker, toolbar.querySelector('[aria-label="Notifications"]')!), 'before the icon buttons').toBe(true);
    });

    it('disconnected: a cancel-circle icon and "Disconnected" in the same place', () => {
      const toolbar = toolbarOf(render());
      const broker = toolbar.querySelector('.broker') as HTMLElement;
      expect(broker.querySelector('mat-icon')?.textContent?.trim(), 'disconnected shows the cancel-circle icon').toBe('cancel');
      expect(spoken(broker), 'disconnected reads "Disconnected"').toBe('Disconnected');
      expect(broker.querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');
      expect(broker.hasAttribute('title')).toBe(false);
      expect(follows(toolbar.querySelector('.nav-separator')!, broker)).toBe(true);
    });

    it('Notifications is named by the count of subscriptions with dead-letter messages, and its badge shows that count', () => {
      const fixture = render();
      const toolbar = toolbarOf(fixture);
      const button = () => toolbar.querySelector('button[mattooltip="Notifications"], button.notifications') as HTMLElement;
      const alert = (name: string) => ({ topicName: 'orders', subscriptionName: name, deadLetterMessageCount: 4 });

      expect(button().getAttribute('aria-label'), 'none: the button is just "Notifications"').toBe('Notifications');
      expect(button().classList.contains('mat-badge-hidden'), 'no badge at zero').toBe(true);

      alerts.set([alert('email')]);
      fixture.detectChanges();
      expect(button().getAttribute('aria-label'), 'one subscription, singular').toBe('Notifications: 1 subscription with dead-letter messages');
      expect(button().classList.contains('mat-badge-hidden')).toBe(false);
      expect(button().querySelector('.mat-badge-content')?.textContent?.trim(), 'the badge counts subscriptions').toBe('1');

      alerts.set([alert('email'), alert('audit')]);
      fixture.detectChanges();
      expect(button().getAttribute('aria-label'), 'two subscriptions, plural').toBe('Notifications: 2 subscriptions with dead-letter messages');
      expect(button().querySelector('.mat-badge-content')?.textContent?.trim()).toBe('2');
    });

    it('while a resubmit runs, the bell carries the spinner and the percent, is named by the run, and opens the run card with Open, Pause and Stop on the environment and the connection', async () => {
      status.next({ connected: true, namespace: NAMESPACE });
      mockConnectionService.currentConnectionId = 'c-prod';
      const run = {
        target: { entityType: 'queue', entityName: 'orders', subQueue: 'deadletter' },
        connection: NAMESPACE,
        progress: signal({ status: 'running', read: 480_000, total: 700_000, failed: 9, possibleDuplicates: 3, remainingMs: 4_380_000 }),
        pause: vi.fn(), resume: vi.fn(), stop: vi.fn()
      } as unknown as ResubmitRun;
      activeRuns.set([run]);
      const fixture = render();
      await fixture.whenStable();
      fixture.detectChanges();
      const toolbar = toolbarOf(fixture);
      const bell = toolbar.querySelector('button.notifications') as HTMLButtonElement;

      expect(bell?.getAttribute('aria-label'), 'the bell is named by the run').toBe('Notifications: resubmit running on orders, 480,000 of 700,000');
      expect(bell.querySelector('mat-progress-spinner'), 'a spinner while the run goes on').not.toBeNull();
      expect(spoken(bell), 'the percent read').toBe('69%');
      expect(Array.from(toolbar.querySelectorAll('button')).filter(b => b.getAttribute('aria-label')?.includes('resubmit') || b.getAttribute('aria-label')?.startsWith('Resubmit')),
        'one control for the run: the bell').toStrictEqual([bell]);

      bell.click();
      fixture.detectChanges();
      const card = document.querySelector('.mat-mdc-menu-panel .run-card')!;
      expect(card?.querySelector('.where')?.textContent?.replace(/\s+/g, ' ').trim(), 'the environment and the connection, as drawn')
        .toBe(`Dead-letter of orders, back to the queue. Production, ${NAMESPACE}.`);
      const buttons = Array.from(card.querySelectorAll<HTMLButtonElement>('button'));
      expect(buttons.map(spoken)).toStrictEqual(['Open', 'Pause', 'Stop']);
      expect(document.querySelector('.mat-mdc-menu-panel .notif-empty'), 'no "No dead letter messages" under a run').toBeNull();

      buttons[1].click();
      expect(run.pause, 'Pause on the card pauses the run itself').toHaveBeenCalledTimes(1);
    });

    describe('the MCP mark, as Settings.dc.html draws it', () => {
      const state = (enabled: boolean): McpState => ({ enabled, url: 'http://localhost:5917/mcp', hasToken: false, tokenCreatedAt: null, levels: ['read'],
        supports: { logs: true, appSettings: false, confirmation: false }, logsAllowed: false, connections: [] });
      const mark = (toolbar: HTMLElement) => toolbar.querySelector('a[aria-label="MCP server is active. Open its settings"]');

      it('while the server is enabled, the toolbar shows the MCP mark and its dot, as a named link to Settings before Notifications', () => {
        mcpState.set(state(true));
        const toolbar = toolbarOf(render());
        const link = mark(toolbar);

        expect(mockMcp.load, 'the toolbar reads the state of the MCP server when the app starts').toHaveBeenCalledTimes(1);
        expect(link, 'the MCP mark is on the toolbar while the server is enabled').not.toBeNull();
        expect(link?.getAttribute('href'), 'it opens Settings').toBe('/settings');
        expect(link?.getAttribute('title'), 'its tooltip names it').toBe('MCP server is active. Open its settings');
        expect(link?.querySelectorAll('svg path').length, 'the three strokes of the MCP mark').toBe(3);
        expect(link?.querySelector('.mcp-dot')?.getAttribute('aria-hidden'), 'the green dot, hidden from a reader').toBe('true');
        expect(follows(link!, toolbar.querySelector('.notifications')!), 'before Notifications').toBe(true);
      });

      it('while the server is off, and against an API without it, the toolbar shows no MCP mark', () => {
        mcpState.set(state(false));
        expect(mark(toolbarOf(render())), 'no mark while the server is off').toBeNull();

        mcpState.set(null);
        expect(mark(toolbarOf(render())), 'no mark against an API without the MCP server').toBeNull();
      });

      it('turning the server on or off in Settings shows or hides the mark at once', () => {
        const fixture = render();
        mcpState.set(state(true));
        fixture.detectChanges();
        expect(mark(toolbarOf(fixture))).not.toBeNull();
        mcpState.set(state(false));
        fixture.detectChanges();
        expect(mark(toolbarOf(fixture))).toBeNull();
      });
    });

    describe('the window that asks the user, opened from the app root over any screen', () => {
      const asking = (over: Partial<McpState> = {}): McpState => ({ enabled: true, url: 'http://localhost:5917/mcp', hasToken: true, tokenCreatedAt: null,
        levels: ['read', 'readAndSend'], supports: { logs: true, appSettings: false, confirmation: true }, logsAllowed: false, connections: [], ...over });
      const request = (id: string, time: string, title: string): McpRequest => ({ id, time, assistant: 'Claude Code', kind: 'send', title,
        facts: [{ label: 'To', value: 'orders, a queue' }], note: 'A message sent cannot be taken back.', allowLabel: 'Send 3 messages', expiresAt: '2026-11-20T10:45:00Z' });
      const OLD = request('r-old', '2026-11-20T10:43:00Z', 'Claude Code asks to send 3 messages');
      const NEW = request('r-new', '2026-11-20T10:44:00Z', 'Claude Code asks to send 1 message');
      const dialogTitle = () => document.querySelector('mat-dialog-container h2')?.textContent?.trim() ?? null;
      const snack = () => document.querySelector('[matsnackbarlabel]')?.textContent?.trim() ?? null;
      const gets = () => mockMcp.requests.mock.calls.length;

      async function start(over: Partial<McpState> = {}) {
        vi.useFakeTimers();
        mcpState.set(asking(over));
        const fixture = TestBed.createComponent(App);
        fixture.detectChanges();
        await vi.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        return fixture;
      }
      const tick = async (fixture: { detectChanges(): void }, ms: number) => { await vi.advanceTimersByTimeAsync(ms); fixture.detectChanges(); await vi.advanceTimersByTimeAsync(0); };

      it('a waiting request opens the dialog on any screen, oldest first, with what the API says, and nothing is answered by opening it', async () => {
        mockMcp.requests.mockImplementation(() => of([NEW, OLD]));
        await TestBed.inject(Router).navigateByUrl('/monitoring');
        await start();

        expect(dialogTitle(), 'the oldest waiting request is shown first').toBe('Claude Code asks to send 3 messages');
        expect(document.querySelectorAll('mat-dialog-container').length, 'one dialog at a time').toBe(1);
        expect(mockMcp.answer, 'opening the dialog answers nothing').not.toHaveBeenCalled();
      });

      it('the polling starts only while the server is enabled and confirmation is supported, runs every 2 seconds, and stops on disable', async () => {
        const fixture = await start({ enabled: false });
        await tick(fixture, 6000);
        expect(gets(), 'no GET mcp/requests while the server is off').toBe(0);

        mcpState.set(asking({ supports: { logs: true, appSettings: false, confirmation: false } }));
        fixture.detectChanges();
        await tick(fixture, 6000);
        expect(gets(), 'no GET mcp/requests while the API cannot wait for an answer').toBe(0);

        mcpState.set(asking());
        fixture.detectChanges();
        await tick(fixture, 0);
        expect(gets(), 'turned on: one GET at once').toBe(1);
        await tick(fixture, 4000);
        expect(gets(), 'then one every 2 seconds').toBe(3);
        expect(mockMcp.requests.mock.calls.every(call => call.length === 0), 'through McpSettingsService, which calls ApiService').toBe(true);

        mcpState.set(asking({ enabled: false }));
        fixture.detectChanges();
        await tick(fixture, 10_000);
        expect(gets(), 'turned off: no further GET').toBe(3);
      });

      it('the polling stops when the app is destroyed', async () => {
        const fixture = await start();
        expect(gets()).toBe(1);
        fixture.destroy();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(gets(), 'after destroy no further GET').toBe(1);
      });

      it('one GET in flight at a time, and a failed poll shows nothing and is tried again on the next tick', async () => {
        const pending = new Subject<McpRequest[]>();
        mockMcp.requests.mockImplementation(() => pending);
        const fixture = await start();
        await tick(fixture, 6000);
        expect(gets(), 'a GET that has not answered is not doubled').toBe(1);

        mockMcp.requests.mockImplementation(() => throwError(() => new HttpErrorResponse({ status: 500 })));
        pending.next([]);
        pending.complete();
        await tick(fixture, 2000);
        const afterFailure = gets();
        expect(dialogTitle(), 'a failed poll opens nothing').toBeNull();
        expect(snack(), 'a failed poll says nothing').toBeNull();

        mockMcp.requests.mockImplementation(() => of([OLD]));
        await tick(fixture, 2000);
        expect(gets(), 'the next tick asks again').toBe(afterFailure + 1);
        expect(dialogTitle(), 'and shows what is waiting').toBe('Claude Code asks to send 3 messages');
      });

      it('the dialog closes by itself with "The request is no longer waiting." when the request leaves the list, without answering, and the next one opens', async () => {
        mockMcp.requests.mockImplementation(() => of([OLD, NEW]));
        const fixture = await start();
        expect(dialogTitle()).toBe('Claude Code asks to send 3 messages');

        mockMcp.requests.mockImplementation(() => of([NEW]));
        await tick(fixture, 2000);
        await tick(fixture, 500);
        expect(snack(), 'the user is told why the dialog closed').toBe('The request is no longer waiting.');
        expect(mockMcp.answer, 'a dialog that closes by itself answers nothing').not.toHaveBeenCalled();

        await tick(fixture, 2000);
        expect(dialogTitle(), 'the next waiting request opens').toBe('Claude Code asks to send 1 message');
      });

      it('a request answered is not opened again while a later poll still lists it', async () => {
        mockMcp.requests.mockImplementation(() => of([OLD]));
        const fixture = await start();
        (Array.from(document.querySelectorAll<HTMLButtonElement>('mat-dialog-container button')).find(b => b.textContent?.trim() === 'Deny'))!.click();
        await tick(fixture, 500);
        expect(mockMcp.answer.mock.calls).toStrictEqual([['r-old', false]]);
        expect(dialogTitle(), 'closed after the answer').toBeNull();

        await tick(fixture, 4000);
        expect(dialogTitle(), 'the same request is not asked twice').toBeNull();
        expect(mockMcp.answer.mock.calls, 'one answer').toHaveLength(1);
      });

      it('the ids of requests shown are kept only while the API still lists them, and one still listed is not opened twice', async () => {
        const lists: McpRequest[][] = [[OLD], [OLD], []];
        mockMcp.requests.mockImplementation(() => of(lists.length > 1 ? lists.shift()! : lists[0]));
        const fixture = await start();
        const shown = (fixture.componentInstance as unknown as { shown: Set<string> }).shown;
        (Array.from(document.querySelectorAll<HTMLButtonElement>('mat-dialog-container button')).find(b => b.textContent?.trim() === 'Deny'))!.click();
        await tick(fixture, 500);
        await tick(fixture, 2000);
        expect(dialogTitle(), 'a request still listed after its answer is not opened again').toBeNull();
        expect(mockMcp.answer.mock.calls, 'one answer').toHaveLength(1);

        await tick(fixture, 2000);
        expect([...shown], 'an id the API no longer lists is forgotten, so the set does not grow for the life of the app').toStrictEqual([]);
      });

      describe('after the user allows an assistant to connect, the app follows the switch', () => {
        const CONNECT: McpRequest = { ...OLD, id: 'r-connect', kind: 'connect', title: 'Claude Code asks to connect to contoso-prod', allowLabel: 'Connect to contoso-prod' };
        const reads = () => mockConnectionService.peekStatus.mock.calls.length;
        const published = () => mockConnectionService.refreshStatus.mock.calls.length;
        const click = (label: string) => (Array.from(document.querySelectorAll<HTMLButtonElement>('mat-dialog-container button')).find(b => b.textContent?.trim() === label))!.click();
        /** The API names c-dev as active for the first <code>sameFor</code> reads, then c-prod. */
        const switchesAfter = (sameFor: number) => {
          let n = 0;
          mockConnectionService.peekStatus.mockImplementation(() => of({ connected: true, connectionId: ++n <= sameFor ? 'c-dev' : 'c-prod' }));
        };

        async function answer(request: McpRequest, label: string) {
          mockConnectionService.currentConnectionId = 'c-dev';
          let polls = 0;
          mockMcp.requests.mockImplementation(() => of(polls++ === 0 ? [request] : []));
          const fixture = await start();
          click(label);
          await tick(fixture, 0);
          return fixture;
        }

        it('reads the status once a second until it names another connection than before the answer, then stops', async () => {
          switchesAfter(3);
          const fixture = await answer(CONNECT, 'Connect to contoso-prod');
          expect(reads(), 'the status is read at once after the allow').toBe(1);
          await tick(fixture, 2000);
          expect(reads(), 'then once a second').toBe(3);
          await tick(fixture, 1000);
          expect(reads(), 'the fourth read names c-prod').toBe(4);
          expect(published(), 'the status is published to the screens once, when it changed, never while it was the same').toBe(1);
          await tick(fixture, 10_000);
          expect(reads(), 'after an allowed connect the app reads the status until it names another connection, then stops').toBe(4);
        });

        it('stops after 15 seconds when the status never changes, and when the app is destroyed', async () => {
          switchesAfter(Infinity);
          const fixture = await answer(CONNECT, 'Connect to contoso-prod');
          await tick(fixture, 20_000);
          expect(reads(), 'after an allowed connect the app reads the status for at most 15 seconds').toBe(15);
          expect(published(), 'a status that never changed is never published again, so no screen reloads').toBe(0);
          fixture.destroy();

          vi.clearAllMocks();
          const second = await answer({ ...CONNECT, id: 'r-connect-2' }, 'Connect to contoso-prod');
          second.destroy();
          await vi.advanceTimersByTimeAsync(10_000);
          expect(reads(), 'the reading stops when the app is destroyed').toBe(1);
        });

        it('a denied connect and an allowed request of another kind read no status', async () => {
          switchesAfter(0);
          const denied = await answer(CONNECT, 'Deny');
          await tick(denied, 5000);
          expect(reads(), 'a denied connect changes nothing, so the status is not read').toBe(0);
          denied.destroy();

          const sent = await answer({ ...OLD, id: 'r-send' }, 'Send 3 messages');
          await tick(sent, 5000);
          expect(mockMcp.answer.mock.calls, 'both requests were answered').toStrictEqual([['r-connect', false], ['r-send', true]]);
          expect(reads(), 'only an allowed request of kind connect makes the app read the status').toBe(0);
        });
      });

      describe('the changes of a setting of this app an assistant asked for', () => {
        const APP: Partial<McpState> = { supports: { logs: true, appSettings: true, confirmation: true }, appSettingsAllowed: true };
        const THEME: McpAppRequest = { id: 'a-1', time: '2026-11-20T10:44:00Z', assistant: 'Claude Code', setting: 'theme', value: 'dark' };
        const appGets = () => mockMcp.appRequests.mock.calls.length;

        it('GET mcp/app-requests runs every 2 seconds while the server is on, the API supports it and the user allowed it, and each list goes to McpAppSettingsService', async () => {
          mockMcp.appRequests.mockImplementation(() => of([THEME]));
          const fixture = await start({ supports: { logs: true, appSettings: false, confirmation: true }, appSettingsAllowed: true });
          await tick(fixture, 4000);
          expect(appGets(), 'no GET mcp/app-requests while the API does not support it').toBe(0);

          mcpState.set(asking({ ...APP, appSettingsAllowed: false }));
          fixture.detectChanges();
          await tick(fixture, 4000);
          expect(appGets(), 'no GET mcp/app-requests while the user has not allowed it').toBe(0);

          mcpState.set(asking(APP));
          fixture.detectChanges();
          await tick(fixture, 0);
          expect(appGets(), 'allowed: one GET at once').toBe(1);
          await tick(fixture, 4000);
          expect(appGets(), 'then one every 2 seconds, through McpSettingsService').toBe(3);
          expect(mockAppSettings.apply.mock.calls, 'each list the API answered is applied by McpAppSettingsService').toStrictEqual([[[THEME]], [[THEME]], [[THEME]]]);

          mcpState.set(asking({ ...APP, enabled: false }));
          fixture.detectChanges();
          await tick(fixture, 10_000);
          expect(appGets(), 'turned off: no further GET').toBe(3);
        });

        it('a 404 on GET mcp/app-requests stops polling it for good, and the requests that ask the user are still polled', async () => {
          mockMcp.appRequests.mockImplementation(() => throwError(() => new HttpErrorResponse({ status: 404 })));
          const fixture = await start(APP);
          await tick(fixture, 6000);

          expect(appGets(), 'an API without the route is asked once, then never again').toBe(1);
          expect(gets(), 'GET mcp/requests keeps its own 2 second tick').toBe(4);
          expect(mockAppSettings.apply, 'nothing is applied').not.toHaveBeenCalled();
          expect(snack(), 'a 404 shows no error').toBeNull();
        });

        it('any other failure of GET mcp/app-requests shows nothing and is tried again on the next tick', async () => {
          mockMcp.appRequests.mockImplementation(() => throwError(() => new HttpErrorResponse({ status: 500 })));
          const fixture = await start(APP);
          expect(appGets()).toBe(1);

          mockMcp.appRequests.mockImplementation(() => of([THEME]));
          await tick(fixture, 2000);
          expect(appGets(), 'the next tick asks again').toBe(2);
          expect(mockAppSettings.apply.mock.calls, 'and applies what waits').toStrictEqual([[[THEME]]]);
          expect(snack(), 'a failed poll says nothing').toBeNull();
        });
      });

      it('an older API without the requests route (404) is polled once, shows no error and no dialog', async () => {
        mockMcp.requests.mockImplementation(() => throwError(() => new HttpErrorResponse({ status: 404 })));
        const fixture = await start({ supports: undefined as unknown as McpState['supports'] });
        await tick(fixture, 6000);
        expect(gets(), 'an API that does not say it supports confirmation is not polled').toBe(0);

        mcpState.set(asking());
        fixture.detectChanges();
        await tick(fixture, 6000);
        expect(gets(), 'a 404 stops the polling').toBe(1);
        expect(dialogTitle(), 'no dialog').toBeNull();
        expect(snack(), 'no error').toBeNull();
      });
    });

    it('only three icon buttons at the right: Notifications, Help and Settings; the theme toggle has left the toolbar', () => {
      const toolbar = toolbarOf(render());
      const named = Array.from(toolbar.querySelectorAll('[mat-icon-button]')).map(b => b.getAttribute('aria-label'));
      expect(named, 'exactly Notifications, Help and Settings, each named').toEqual(['Notifications', 'Help', 'Settings']);
      expect(Array.from(toolbar.querySelectorAll('mat-icon')).map(i => i.textContent?.trim()), 'no theme icon').not.toContain('light_mode');
    });
  });

  it('developer mode shortcut on a Mac: Cmd+Shift+D toggles developer mode', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const devSettings = TestBed.inject(DevSettingsService);
    expect(devSettings.devMode()).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', metaKey: true, shiftKey: true }));
    expect(devSettings.devMode()).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, shiftKey: true }));
    expect(devSettings.devMode()).toBe(false);
  });

  it('Cmd+D without Shift leaves developer mode alone', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const devSettings = TestBed.inject(DevSettingsService);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true }));
    expect(devSettings.devMode()).toBe(false);
  });
});
