import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, of, throwError } from 'rxjs';
import { ApiService, ConnectionGroupService, ConnectionService } from '../../core/services';
import { ProviderType } from '../../core/models/provider.model';
import { SettingsMcpComponent } from './settings-mcp.component';
import { McpActivity, McpSettingsService, McpState } from './mcp-settings.service';

/** The text of an element as a reader hears it: every text node outside aria-hidden, separated by one space. */
function words(node: Element | null | undefined): string {
  if (!node) return '';
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.parentElement?.closest('[aria-hidden="true"]')) parts.push(walker.currentNode.textContent ?? '');
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const TOKEN = 'mcp-token-sentinel-4b1e9d';
const URL = 'http://localhost:5917/mcp';

const STATE: McpState = {
  enabled: true,
  url: URL,
  hasToken: false,
  tokenCreatedAt: null,
  levels: ['read'],
  supports: { logs: true, appSettings: false, confirmation: false },
  logsAllowed: false,
  connections: [],
};

const CONNECTIONS = [
  { id: 'c-dev', name: 'contoso-dev', providerType: ProviderType.AzureServiceBus, namespace: 'contoso-dev.servicebus.windows.net', clientId: 'g-contoso', environmentId: 'g-dev' },
  { id: 'c-prod', name: 'contoso-prod', providerType: ProviderType.AzureServiceBus, namespace: 'contoso-prod.servicebus.windows.net', clientId: 'g-contoso', environmentId: 'g-prod' },
  { id: 'c-rabbit', name: 'Local RabbitMQ', providerType: ProviderType.RabbitMQ, hostName: 'localhost', port: 5672 },
];
const GROUPS = [
  { id: 'g-contoso', name: 'Contoso', type: 'client' },
  { id: 'g-dev', name: 'Development', type: 'environment', parentId: 'g-contoso' },
  { id: 'g-prod', name: 'Production', type: 'environment', parentId: 'g-contoso', isProduction: true },
];
const ACTIVITY: McpActivity[] = [
  { time: '10:42:31', assistant: 'Claude Code', asked: 'Peek 20 messages', where: 'orders, dead-letter. contoso-dev', outcome: '20 read', kind: 'plain' },
  { time: '10:41:55', assistant: 'Claude Code', asked: 'List the connections', where: 'This app', outcome: '3 offered', kind: 'ok' },
];

const fail = (status: number, message?: string) => throwError(() => new HttpErrorResponse({ status, error: message ? { message } : null }));

/** An API that keeps the state in memory and answers each route of the contract. */
function fakeApi(start: Partial<McpState> = {}, activity: McpActivity[] = ACTIVITY) {
  let state: McpState = { ...STATE, ...start };
  let list = [...activity];
  const keep = (next: McpState) => of(state = next);
  return {
    get: vi.fn((path: string): Observable<unknown> => path === 'mcp' ? of(state) : of(list)),
    post: vi.fn((): Observable<unknown> => { state = { ...state, hasToken: true, tokenCreatedAt: '2026-11-19T10:00:00Z' }; return of({ token: TOKEN, state }); }),
    put: vi.fn((path: string, body: any): Observable<unknown> => {
      if (path === 'mcp/enabled') return keep({ ...state, enabled: body.enabled });
      if (path === 'mcp/logs') return keep({ ...state, logsAllowed: body.allowed });
      const id = decodeURIComponent(path.split('/')[2]);
      return keep({ ...state, connections: [...state.connections.filter(c => c.connectionId !== id), { connectionId: id, level: body.level }] });
    }),
    delete: vi.fn((path: string): Observable<unknown> => {
      if (path === 'mcp/activity') { list = []; return of(undefined); }
      const id = decodeURIComponent(path.split('/')[2]);
      return keep({ ...state, connections: state.connections.filter(c => c.connectionId !== id) });
    }),
  };
}

describe('SettingsMcpComponent: the MCP server group of Settings, as Settings.dc.html draws it for phase one', () => {
  let api: ReturnType<typeof fakeApi>;
  const connectionService = { getConnections: vi.fn((): Observable<unknown> => of(CONNECTIONS)) };
  const groupService = { getGroups: vi.fn((): Observable<unknown> => of(GROUPS)) };
  const writeText = vi.fn(async (_text: string) => {});

  async function render(start: Partial<McpState> = {}, activity: McpActivity[] = ACTIVITY) {
    api = fakeApi(start, activity);
    await TestBed.configureTestingModule({
      imports: [SettingsMcpComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ApiService, useValue: api },
        { provide: ConnectionService, useValue: connectionService },
        { provide: ConnectionGroupService, useValue: groupService },
      ],
    }).compileComponents();
    return create();
  }

  async function create() {
    const fixture = TestBed.createComponent(SettingsMcpComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const refresh = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    const button = (label: string) => Array.from(el.querySelectorAll<HTMLElement>('button, a')).find(b => words(b) === label || b.getAttribute('aria-label') === label);
    const row = (label: string) => Array.from(el.querySelectorAll('.setting-row')).find(r => words(r.querySelector('.row-label')) === label);
    const click = async (label: string) => { const b = button(label); expect(b, `a button named "${label}"`).toBeTruthy(); b!.click(); await refresh(); };
    return { fixture, el, refresh, button, row, click, group: () => el.querySelector('section[aria-label="MCP server"]') };
  }

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
    connectionService.getConnections.mockImplementation(() => of(CONNECTIONS));
    groupService.getGroups.mockImplementation(() => of(GROUPS));
  });

  describe('an API without the feature, and one that fails', () => {
    it('an API without the MCP server (404 on GET mcp) shows no group at all, and no error panel', async () => {
      api = fakeApi();
      api.get.mockReturnValueOnce(fail(404));
      await TestBed.configureTestingModule({
        imports: [SettingsMcpComponent],
        providers: [provideNoopAnimations(), { provide: ApiService, useValue: api },
          { provide: ConnectionService, useValue: connectionService }, { provide: ConnectionGroupService, useValue: groupService }],
      }).compileComponents();
      const { el, group } = await create();

      expect(group(), 'no "MCP server" group against an API that lacks the feature').toBeNull();
      expect(el.querySelector('[role="alert"]'), 'a missing feature is not an error').toBeNull();
      expect(api.get.mock.calls.map(c => c[0]), 'nothing else of the feature is asked for').toStrictEqual(['mcp']);
    });

    it('a GET mcp that fails otherwise is an error in the group, with Retry, never a group that silently disappears', async () => {
      api = fakeApi();
      api.get.mockReturnValueOnce(fail(500, 'The settings file could not be read.'));
      await TestBed.configureTestingModule({
        imports: [SettingsMcpComponent],
        providers: [provideNoopAnimations(), { provide: ApiService, useValue: api },
          { provide: ConnectionService, useValue: connectionService }, { provide: ConnectionGroupService, useValue: groupService }],
      }).compileComponents();
      const { group, click } = await create();

      expect(words(group()?.querySelector('[role="alert"]')), 'the failure says what failed and why')
        .toBe('The MCP server settings could not be read: The settings file could not be read. Retry');
      await click('Retry');
      expect(words(group()?.querySelector('[role="status"]')), 'Retry reads the state again and draws it').toBe('Active. Answering on this computer only.');
    });
  });

  describe('inactive', () => {
    it('the switch reads Inactive and is not checked, the status says no assistant can reach the app, and no "Connect an assistant" row is drawn', async () => {
      const { group, row, el } = await render({ enabled: false });
      const toggle = group()?.querySelector('[role="switch"]');

      expect(words(group()?.querySelector('h2')), 'the heading of the group').toBe('MCP server');
      expect(words(row('Server')?.querySelector('[role="switch"]')), 'the switch is labelled by its state').toBe('Inactive');
      expect(toggle?.getAttribute('aria-checked'), 'unchecked while inactive').toBe('false');
      expect(words(group()?.querySelector('[role="status"]')))
        .toBe('Inactive. No assistant can reach this app, and the choices below are kept for when it is turned on.');
      expect(row('Connect an assistant'), 'nothing to connect to while the server is off').toBeUndefined();
      expect(el.querySelector('ul[aria-label="Connections an assistant may use"]')?.classList.contains('dimmed'), 'the choices are kept, dimmed').toBe(true);
    });

    it('the warning that what an assistant reads leaves the computer is shown in either state, in the artboard\'s words', async () => {
      const { row } = await render({ enabled: false });
      expect(words(row('Server')?.querySelector('.warning'))).toBe('What an assistant reads leaves this computer. The names of entities, the counts and the bodies of the messages it reads are sent to the assistant and to the company that runs it. A connection string, a password or a key is never given to it.');
    });

    it('turning the switch on asks the API, and the switch follows its answer', async () => {
      const { group, click } = await render({ enabled: false });
      await click('Inactive');

      expect(api.put.mock.calls[0], 'the switch is PUT mcp/enabled').toStrictEqual(['mcp/enabled', { enabled: true }]);
      expect(group()?.querySelector('[role="switch"]')?.getAttribute('aria-checked'), 'checked once the API answered').toBe('true');
      expect(words(group()?.querySelector('[role="status"]'))).toBe('Active. Answering on this computer only.');
    });
  });

  describe('active, with no connection offered', () => {
    it('says it is active, offers the connect row, and says no connection is offered', async () => {
      const { group, row, el } = await render();

      expect(group()?.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
      expect(words(row('Server')?.querySelector('[role="switch"]'))).toBe('Active');
      expect(words(row('Connect an assistant')?.querySelector('.note'))).toBe('Add this to the configuration of the assistant. The server answers only on this computer and only while the app is open.');
      expect(words(row('Connections')?.querySelector('.note')), 'no "asks you first" while the app cannot ask')
        .toBe('Only the connections listed here exist for an assistant.');
      expect(words(el.querySelector('[data-testid="mcp-none-offered"]'))).toBe('No connection is offered. An assistant sees none.');
      expect(el.querySelectorAll('ul[aria-label="Connections an assistant may use"] li').length).toBe(0);
    });

    it('the group says what an assistant does for the levels the API lists: reading only in phase one', async () => {
      const { group } = await render();
      expect(words(group()?.querySelector('.group-head .note'))).toBe('An assistant such as Claude Code reads the brokers through this app.');
    });

    it('"Logs of the app" is shown when the API supports it, and "Settings of the app" is not while the API does not', async () => {
      const { row } = await render();
      expect(words(row('Logs of the app')?.querySelector('mat-checkbox'))).toBe('Let an assistant read the logs');
      expect(words(row('Logs of the app')?.querySelector('.note'))).toBe('The lines the Logs screen shows, by level and by a word. They carry no secret, no message body and no error text of a broker, but a line can name a connection you did not offer above. Never asks you.');
      expect(row('Settings of the app'), 'the settings of the app are a later phase').toBeUndefined();

      (row('Logs of the app')?.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
      await new Promise(r => setTimeout(r));
      expect(api.put.mock.calls[0], 'ticking it is PUT mcp/logs').toStrictEqual(['mcp/logs', { allowed: true }]);
    });

    it('"Logs of the app" is absent when the API does not support it', async () => {
      const { row } = await render({ supports: { logs: false, appSettings: false, confirmation: false } });
      expect(row('Logs of the app'), 'no logs row while the API does not support it').toBeUndefined();
    });

    it('"What each choice allows" lists only the Read block while the API lists "read" alone, and no bulk sentence', async () => {
      const { row } = await render();
      const blocks = Array.from(row('What each choice allows')?.querySelectorAll('.choice') ?? []).map(words);
      expect(blocks).toStrictEqual(['Read Every connection listed List the connections offered, queues, topics, subscriptions and rules; read the counts; peek the active, dead-letter, scheduled and deferred messages. Never asks you.']);
      expect(words(row('What each choice allows'))).not.toContain('possible duplicate');
    });
  });

  describe('active, with connections offered', () => {
    const offered = { connections: [{ connectionId: 'c-dev', level: 'read' }, { connectionId: 'c-gone', level: 'read' }] };

    it('each offered connection shows its name, where it is, what it asks and the levels the API lists, with Remove apart from the levels', async () => {
      const { el } = await render(offered);
      const items = Array.from(el.querySelectorAll('ul[aria-label="Connections an assistant may use"] li'));
      const dev = items[0];

      expect(words(dev.querySelector('.name'))).toBe('contoso-dev');
      expect(words(dev.querySelector('.where'))).toBe('Contoso, Development. contoso-dev.servicebus.windows.net');
      expect(words(dev.querySelector('.asks')), 'what a read asks, and nothing a later phase asks').toBe('Reads without asking you.');
      const levels = dev.querySelector('[role="group"]');
      expect(levels?.getAttribute('aria-label')).toBe('What an assistant may do on contoso-dev');
      expect(Array.from(levels?.querySelectorAll('button') ?? []).map(b => [words(b), b.getAttribute('aria-pressed')]), 'only "Read", pressed')
        .toStrictEqual([['Read', 'true']]);
      const remove = dev.querySelector('button.remove');
      expect(words(remove)).toBe('Remove');
      expect(remove?.closest('[role="group"]'), 'Remove is not part of the level group').toBeNull();
    });

    it('a connection id the list does not know is "A connection that no longer exists", with only Remove', async () => {
      const { el } = await render(offered);
      const gone = el.querySelectorAll('ul[aria-label="Connections an assistant may use"] li')[1];
      expect(words(gone.querySelector('.name'))).toBe('A connection that no longer exists');
      expect(gone.querySelector('[role="group"]'), 'no level to pick').toBeNull();
      expect(Array.from(gone.querySelectorAll('button')).map(words)).toStrictEqual(['Remove']);
    });

    it('Remove takes the connection off the list through the API', async () => {
      const { el, refresh } = await render(offered);
      (el.querySelector('ul[aria-label="Connections an assistant may use"] li button.remove') as HTMLElement).click();
      await refresh();
      expect(api.delete.mock.calls[0]).toStrictEqual(['mcp/connections/c-dev']);
      expect(Array.from(el.querySelectorAll('ul[aria-label="Connections an assistant may use"] li .name')).map(words)).toStrictEqual(['A connection that no longer exists']);
    });

    it('only the levels the API lists are drawn, with the labels of the artboard, and picking one is PUT with that level', async () => {
      const { el, refresh } = await render({ ...offered, levels: ['read', 'readAndSend', 'all'] });
      const levels = el.querySelector('[role="group"][aria-label="What an assistant may do on contoso-dev"]');
      expect(Array.from(levels?.querySelectorAll('button') ?? []).map(words)).toStrictEqual(['Read', 'Read and send', 'Read, send and remove']);

      (levels?.querySelectorAll('button')[1] as HTMLElement).click();
      await refresh();
      expect(api.put.mock.calls[0]).toStrictEqual(['mcp/connections/c-dev', { level: 'readAndSend' }]);
    });

    it('with two levels listed, "What each choice allows" adds the Send block and the sentence about bulk operations', async () => {
      const { row } = await render({ levels: ['read', 'readAndSend'] });
      const titles = Array.from(row('What each choice allows')?.querySelectorAll('.choice h3') ?? []).map(words);
      expect(titles).toStrictEqual(['Read', 'Send']);
      expect(words(row('What each choice allows'))).toContain('A bulk operation an assistant starts answers what happened to each message, and a message sent and not removed is reported as a possible duplicate, exactly as on the screen.');
    });
  });

  describe('the offer panel', () => {
    async function openPanel(start: Partial<McpState> = {}) {
      const view = await render(start);
      await view.click('Offer a connection');
      const panel = () => view.el.querySelector('[data-testid="mcp-offer"]');
      return { ...view, panel };
    }

    it('"Offer a connection" opens the panel with the search and the connections not offered, and says a connection comes in at "Read"', async () => {
      const { panel, button } = await openPanel({ connections: [{ connectionId: 'c-dev', level: 'read' }] });

      expect(button('Offer a connection')?.getAttribute('aria-expanded')).toBe('true');
      expect(words(panel()?.querySelector('mat-label'))).toBe('Find a connection');
      expect(panel()?.querySelector('input[type="search"]')?.getAttribute('placeholder')).toBe('A name, a client, an environment');
      const names = Array.from(panel()?.querySelectorAll('ul[aria-label="Connections not offered"] li .name') ?? []).map(words);
      expect(names, 'the connections not offered, never one already listed').toStrictEqual(['contoso-prod Production', 'Local RabbitMQ']);
      expect(words(panel()?.querySelector('.footnote'))).toBe('A connection comes in at "Read".');
    });

    it('a production connection is listed with the Production chip and a disabled Offer, and says why', async () => {
      const { panel } = await openPanel();
      const prod = Array.from(panel()?.querySelectorAll('li') ?? []).find(li => li.textContent?.includes('contoso-prod'))!;

      expect(words(prod.querySelector('.prod-chip'))).toBe('Production');
      expect((prod.querySelector('button') as HTMLButtonElement).disabled, 'a production connection cannot be offered in phase one').toBe(true);
      expect(words(prod.querySelector('.why'))).toBe('A production connection can be offered once the app can ask you before each operation.');
    });

    it('Offer puts the connection on the list at "Read"', async () => {
      const { panel, el, refresh } = await openPanel();
      const dev = Array.from(panel()?.querySelectorAll('li') ?? []).find(li => li.textContent?.includes('contoso-dev'))!;
      (dev.querySelector('button') as HTMLElement).click();
      await refresh();

      expect(api.put.mock.calls[0]).toStrictEqual(['mcp/connections/c-dev', { level: 'read' }]);
      expect(Array.from(el.querySelectorAll('ul[aria-label="Connections an assistant may use"] li .name')).map(words)).toStrictEqual(['contoso-dev']);
    });

    it('the search keeps the connections whose name, client or environment holds the words, and says when none does', async () => {
      const { panel, refresh } = await openPanel();
      const search = panel()?.querySelector('input[type="search"]') as HTMLInputElement;
      search.value = 'development';
      search.dispatchEvent(new Event('input'));
      await refresh();
      expect(Array.from(panel()?.querySelectorAll('li .name') ?? []).map(words)).toStrictEqual(['contoso-dev']);

      search.value = 'nothing like it';
      search.dispatchEvent(new Event('input'));
      await refresh();
      expect(panel()?.querySelectorAll('li').length).toBe(0);
      expect(words(panel()?.querySelector('[data-testid="mcp-no-match"]'))).toBe('No other connection matches.');
    });
  });

  describe('the token, shown once and kept nowhere', () => {
    const config = (el: HTMLElement) => JSON.parse(el.querySelector('pre.config')?.textContent ?? '{}');

    it('before a token is created in this visit, the configuration shows the url and <your token>, and the button is "Create a token"', async () => {
      const { el, button } = await render();
      expect(config(el)).toStrictEqual({ mcpServers: { 'messaging-explorer': { type: 'http', url: URL, headers: { Authorization: 'Bearer <your token>' } } } });
      expect(button('Create a token')).toBeTruthy();
      expect(el.querySelector('[data-testid="mcp-token"]'), 'no token box before one is created').toBeNull();
    });

    it('with a token already created, the button is "Replace the token"', async () => {
      const { button } = await render({ hasToken: true, tokenCreatedAt: '2026-11-18T09:00:00Z' });
      expect(button('Replace the token')).toBeTruthy();
      expect(button('Create a token')).toBeUndefined();
    });

    it('creating a token shows it once with Copy and the sentence, puts it in the configuration, and writes it to no storage and no console', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map(name => vi.spyOn(console, name));
      const { el, click, button } = await render();
      await click('Create a token');

      expect(api.post.mock.calls[0]).toStrictEqual(['mcp/token', {}]);
      const box = el.querySelector('[data-testid="mcp-token"]');
      expect(words(box?.querySelector('code')), 'the token is shown').toBe(TOKEN);
      expect(words(box?.querySelector('.note'))).toBe('Copy it now. It is not shown again.');
      expect(config(el).mcpServers['messaging-explorer'].headers.Authorization, 'the configuration carries the token just created').toBe(`Bearer ${TOKEN}`);
      expect(button('Replace the token'), 'the API now has a token').toBeTruthy();

      await click('Copy the token');
      expect(writeText).toHaveBeenCalledWith(TOKEN);
      await click('Copy the configuration');
      expect(writeText.mock.calls[1][0]).toContain(`Bearer ${TOKEN}`);

      const stored = [localStorage, sessionStorage].flatMap(store => Array.from({ length: store.length }, (_, i) => `${store.key(i)}=${store.getItem(store.key(i)!)}`));
      expect(stored.filter(entry => entry.includes(TOKEN)), 'the token is in no localStorage or sessionStorage entry').toStrictEqual([]);
      const logged = spies.flatMap(spy => spy.mock.calls.flat().map(arg => String(arg instanceof Object ? JSON.stringify(arg) : arg)));
      expect(logged.filter(line => line.includes(TOKEN)), 'the token reaches no console call').toStrictEqual([]);
      spies.forEach(spy => spy.mockRestore());
    });

    it('after the component is destroyed and created again, the token is gone and the configuration says <your token>', async () => {
      const first = await render();
      await first.click('Create a token');
      expect(first.el.textContent).toContain(TOKEN);
      first.fixture.destroy();

      const again = await create();
      expect(again.el.textContent, 'the token lived only in the component').not.toContain(TOKEN);
      expect(again.el.querySelector('pre.config')?.textContent).toContain('Bearer <your token>');
      expect(again.button('Replace the token'), 'the API still says a token exists').toBeTruthy();
    });
  });

  describe('what assistants did', () => {
    it('lists what the API kept, newest first, with the columns the artboard draws, and Clear the list empties it', async () => {
      const { row, click } = await render();
      const history = row('What assistants did');
      expect(words(history?.querySelector('.note'))).toBe('Kept in memory since the app opened. No message body and no secret is written here.');
      expect(Array.from(history?.querySelectorAll('th') ?? []).map(words)).toStrictEqual(['Time', 'Assistant', 'Asked for', 'Where', 'What happened']);
      expect(Array.from(history?.querySelectorAll('tbody tr') ?? []).map(words)).toStrictEqual([
        '10:42:31 Claude Code Peek 20 messages orders, dead-letter. contoso-dev 20 read',
        '10:41:55 Claude Code List the connections This app 3 offered',
      ]);
      expect(history?.querySelector('tbody tr .outcome')?.classList.contains('plain')).toBe(true);

      await click('Clear the list');
      expect(api.delete.mock.calls[0]).toStrictEqual(['mcp/activity']);
      expect(history?.querySelectorAll('tbody tr').length).toBe(0);
      expect(words(row('What assistants did')?.querySelector('[data-testid="mcp-no-activity"]'))).toBe('No assistant has asked for anything since the app opened.');
    });
  });

  describe('each failed call says so where it happened', () => {
    const cases: { call: string; arrange: (a: ReturnType<typeof fakeApi>) => void; act: (v: Awaited<ReturnType<typeof render>>) => Promise<void>; where: string; text: string; start?: Partial<McpState> }[] = [
      { call: 'PUT mcp/enabled', arrange: a => a.put.mockReturnValueOnce(fail(500, 'The settings could not be saved.')),
        act: v => v.click('Active'), where: 'Server', text: 'The server was not turned off: The settings could not be saved.' },
      { call: 'POST mcp/token', arrange: a => a.post.mockReturnValueOnce(fail(0)),
        act: v => v.click('Create a token'), where: 'Connect an assistant', text: 'No token was created: the API of this app did not answer.' },
      { call: 'PUT mcp/connections/{id} for a level', start: { levels: ['read', 'readAndSend'], connections: [{ connectionId: 'c-dev', level: 'read' }] },
        arrange: a => a.put.mockReturnValueOnce(fail(400, 'That level does not exist.')),
        act: v => v.click('Read and send'), where: 'Connections', text: 'The level of contoso-dev was not changed: That level does not exist.' },
      { call: 'DELETE mcp/connections/{id}', start: { connections: [{ connectionId: 'c-dev', level: 'read' }] },
        arrange: a => a.delete.mockReturnValueOnce(fail(404)),
        act: v => v.click('Remove'), where: 'Connections', text: 'contoso-dev was not removed: the API answered 404.' },
      { call: 'PUT mcp/connections/{id} to offer, answered 409', arrange: a => a.put.mockReturnValueOnce(fail(409, 'A production connection cannot be offered yet.')),
        act: async v => { await v.click('Offer a connection'); (v.el.querySelector('[data-testid="mcp-offer"] li button') as HTMLElement).click(); await v.refresh(); },
        where: 'Connections', text: 'contoso-dev was not offered: A production connection cannot be offered yet.' },
      { call: 'PUT mcp/logs', arrange: a => a.put.mockReturnValueOnce(fail(500)),
        act: async v => { (v.row('Logs of the app')?.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); await v.refresh(); },
        where: 'Logs of the app', text: 'The choice for the logs was not saved: the API answered 500.' },
      { call: 'DELETE mcp/activity', arrange: a => a.delete.mockReturnValueOnce(fail(500)),
        act: v => v.click('Clear the list'), where: 'What assistants did', text: 'The list was not cleared: the API answered 500.' },
    ];

    for (const c of cases) {
      it(`${c.call} that fails is an error in the row "${c.where}", and the screen keeps what the API last said`, async () => {
        const view = await render(c.start);
        const before = TestBed.inject(McpSettingsService).state();
        c.arrange(api);
        await c.act(view);

        expect(words(view.row(c.where)?.querySelector('[role="alert"]')), `the failure of ${c.call} is said where it happened`).toBe(c.text);
        expect(TestBed.inject(McpSettingsService).state(), 'a refused change is not drawn as made').toStrictEqual(before);
      });
    }

    it('GET mcp/activity that fails is an error with Retry, never an empty list', async () => {
      api = fakeApi();
      api.get.mockImplementation((path: string) => path === 'mcp' ? of(STATE) : fail(500));
      await TestBed.configureTestingModule({
        imports: [SettingsMcpComponent],
        providers: [provideNoopAnimations(), { provide: ApiService, useValue: api },
          { provide: ConnectionService, useValue: connectionService }, { provide: ConnectionGroupService, useValue: groupService }],
      }).compileComponents();
      const { row, click } = await create();
      const history = () => row('What assistants did');

      expect(words(history()?.querySelector('[role="alert"]'))).toBe('What assistants did could not be read: the API answered 500. Retry');
      expect(history()?.querySelector('[data-testid="mcp-no-activity"]'), 'not the empty sentence').toBeNull();
      api.get.mockImplementation((path: string) => path === 'mcp' ? of(STATE) : of(ACTIVITY));
      await click('Retry');
      expect(history()?.querySelectorAll('tbody tr').length).toBe(2);
    });

    it('a list of connections that cannot be read is an error with Retry, and an offered connection is not called gone', async () => {
      connectionService.getConnections.mockImplementation(() => fail(0));
      const { row, el, click } = await render({ connections: [{ connectionId: 'c-dev', level: 'read' }] });

      expect(words(row('Connections')?.querySelector('[role="alert"]'))).toBe('The names of the connections could not be read: the API of this app did not answer. Retry');
      expect(words(el.querySelector('ul[aria-label="Connections an assistant may use"] li .name')), 'the id, not "no longer exists"').toBe('c-dev');
      await click('Offer a connection');
      expect(el.querySelector('[data-testid="mcp-no-match"]'), 'names not read are not "No other connection matches."').toBeNull();
      connectionService.getConnections.mockImplementation(() => of(CONNECTIONS));
      await click('Retry');
      expect(words(el.querySelector('ul[aria-label="Connections an assistant may use"] li .name'))).toBe('contoso-dev');
    });

    it('a list of connections that cannot be read stays an error with Retry after another change of the list succeeds', async () => {
      connectionService.getConnections.mockImplementation(() => fail(0));
      const { row, click } = await render({ connections: [{ connectionId: 'c-dev', level: 'read' }, { connectionId: 'c-other', level: 'read' }] });
      await click('Remove');

      expect(api.delete.mock.calls[0], 'the remove went through').toStrictEqual(['mcp/connections/c-dev']);
      expect(words(row('Connections')?.querySelector('[role="alert"]')), 'the names are still unread, and the screen still says so')
        .toBe('The names of the connections could not be read: the API of this app did not answer. Retry');
    });
  });

  it('meets the ui.md criteria in every state: no Bootstrap or Font Awesome class, and every button has a name', async () => {
    const { el, click } = await render({ connections: [{ connectionId: 'c-dev', level: 'read' }] });
    await click('Offer a connection');
    await click('Create a token');
    const classes = Array.from(el.querySelectorAll('*')).flatMap(n => Array.from(n.classList));
    expect(classes.filter(c => /^(btn|btn-.*|fa|fas|fa-.*|form-control|card|badge|alert|row|col-.*|nav-tabs|progress)$/.test(c))).toEqual([]);
    const unnamed = Array.from(el.querySelectorAll('button, a')).filter(b => !(words(b) || b.getAttribute('aria-label')));
    expect(unnamed).toEqual([]);
  });
});
