import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject, Observable, delay, of, throwError, timer, switchMap } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { ConnectionsComponent } from './connections.component';
import { ApiService, ConnectionGroupService, ConnectionService, DevSettingsService } from '../../core/services';
import { ConnectionGroup, ProviderType, ServiceBusConnection } from '../../core/models';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';

const connection = (overrides: Partial<ServiceBusConnection>): ServiceBusConnection => ({
  id: 'c1',
  name: 'orders-rabbitmq',
  providerType: ProviderType.RabbitMQ,
  connectionString: '',
  hostName: 'localhost',
  port: 5672,
  createdAt: new Date('2026-11-01T10:00:00Z'),
  isConnected: false,
  ...overrides
});

/** Answers after the first render, as HTTP does; a synchronous answer would tick the app inside its own tick. */
const later = <T>(value: T): Observable<T> => of(value).pipe(delay(0));
const failLater = (): Observable<never> => timer(0).pipe(switchMap(() => throwError(() => new Error('API down'))));
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

const client: ConnectionGroup = { id: 'g1', name: 'Contoso', type: 'client', createdAt: new Date() };
const production: ConnectionGroup = { id: 'g2', name: 'Production', type: 'environment', parentId: 'g1', createdAt: new Date() };

describe('ConnectionsComponent', () => {
  let connectionServiceMock: { getConnections: ReturnType<typeof vi.fn> };
  let groupService: ConnectionGroupService;
  const dialogMock = { open: vi.fn() };
  const snackBarMock = { open: vi.fn() };

  beforeEach(() => {
    connectionServiceMock = { getConnections: vi.fn().mockReturnValue(later([])) };

    TestBed.configureTestingModule({
      imports: [ConnectionsComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: {} },
        { provide: ConnectionService, useValue: connectionServiceMock },
        { provide: DevSettingsService, useValue: { devMode: signal(false) } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    dialogMock.open.mockReset();
    snackBarMock.open.mockReset();
    TestBed.overrideProvider(MatDialog, { useValue: dialogMock });
    TestBed.overrideProvider(MatSnackBar, { useValue: snackBarMock });
    groupService = TestBed.inject(ConnectionGroupService);
    vi.spyOn(groupService, 'getGroups').mockReturnValue(later([]));
  });

  async function render() {
    const fixture = TestBed.createComponent(ConnectionsComponent);
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const buttons = (name: string) =>
      Array.from(element.querySelectorAll('button')).filter(b => b.textContent?.trim().includes(name));
    return { fixture, element, buttons };
  }

  it('Add Connection, Edit and Manage Groups open at the width Connections.dc.html draws them, not cut to the 560 px Material gives a dialog by default', async () => {
    dialogMock.open.mockReturnValue({ afterClosed: () => of(undefined) });
    const { fixture } = await render();
    const component = fixture.componentInstance;

    component.openAddDialog();
    component.openManageGroupDialog();
    component.editConnection({ id: 'c', name: 'orders' } as never);

    expect(dialogMock.open.mock.calls.map(c => [c[1].width, c[1].maxWidth])).toStrictEqual([['780px', '95vw'], ['680px', '95vw'], ['620px', '95vw']]);
  });

  it('says the connections could not be loaded, with Retry, instead of the empty state when the load fails', async () => {
    connectionServiceMock.getConnections.mockReturnValue(failLater());
    const { element, buttons } = await render();

    expect(element.textContent).toContain('Could not load the connections');
    expect(element.textContent).not.toContain('No connections configured');
    expect(buttons('Retry')).toHaveLength(1);
  });

  it('shows the list after Retry when the second load succeeds', async () => {
    connectionServiceMock.getConnections.mockReturnValueOnce(failLater());
    connectionServiceMock.getConnections.mockReturnValue(later([connection({})]));
    const { fixture, element, buttons } = await render();

    buttons('Retry')[0].click();
    await settle();
    fixture.detectChanges();

    expect(element.textContent).not.toContain('Could not load the connections');
    const row = element.querySelector('li.connection-card');
    expect(row?.querySelector('h3')?.textContent?.trim()).toBe('orders-rabbitmq');
  });

  it('shows one Add Connection button and the empty state when nothing is saved', async () => {
    const { element, buttons } = await render();

    expect(element.textContent).toContain('No connections configured');
    expect(buttons('Add Connection')).toHaveLength(1);
    expect(buttons('Export')).toHaveLength(0);
  });

  it('the empty state is a second-level heading under Connections, and its third step says the toolbar shows the environment', async () => {
    const { element } = await render();

    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Connections');
    expect(element.querySelector('.empty-state h2')?.textContent?.trim(), 'the empty state heading sits one level under the page title')
      .toBe('No connections configured');
    expect(Array.from(element.querySelectorAll('.empty-state li')).map(li => li.textContent?.trim())[2], 'step 3 as drawn')
      .toBe('Connect. The entities of the broker open, and the toolbar shows which environment you are on.');
  });

  it('Export opens its dialog with the saved connections and groups, from which it counts what goes into the file', async () => {
    connectionServiceMock.getConnections.mockReturnValue(later([connection({ id: 'c1', name: 'prod-bus', clientId: 'g1', environmentId: 'g2' })]));
    vi.spyOn(groupService, 'getGroups').mockReturnValue(later([client, production]));
    dialogMock.open.mockReturnValue({ afterClosed: () => of(undefined) });
    const { buttons } = await render();

    buttons('Export')[0].click();

    const config = dialogMock.open.mock.calls[0][1];
    expect(config.data.connections.map((c: ServiceBusConnection) => c.name), 'the dialog receives the saved connections').toEqual(['prod-bus']);
    expect(config.data.groups.map((g: ConnectionGroup) => g.name), 'the dialog receives the clients and environments').toEqual(['Contoso', 'Production']);
  });

  it('groups a connection under its client and environment', async () => {
    connectionServiceMock.getConnections.mockReturnValue(later([
      connection({ id: 'c1', name: 'prod-bus', clientId: 'g1', environmentId: 'g2' }),
      connection({ id: 'c2', name: 'loose-bus' })
    ]));
    vi.mocked(groupService.getGroups).mockReturnValue(later([client, production]));
    const { element } = await render();

    const words = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const blocks = Array.from(element.querySelectorAll('section.client-block')).map(block => ({
      client: words(block.querySelector('h2.client-name')),
      environments: Array.from(block.querySelectorAll('.environment')).map(env => ({
        row: words(env.querySelector('button.environment-row')).replace(/^(expand_more|chevron_right) /, ''),
        open: env.querySelector('button.environment-row')?.getAttribute('aria-expanded'),
        names: Array.from(env.querySelectorAll('li.connection-card h3')).map(words)
      }))
    }));
    expect(blocks, 'a block for each client, its environments inside, the ones with no client last').toEqual([
      { client: 'Contoso 1 connection', environments: [{ row: 'PRODUCTION 1 connection', open: 'true', names: ['prod-bus'] }] },
      { client: 'No client 1 connection', environments: [{ row: 'NO ENVIRONMENT 1 connection', open: 'true', names: ['loose-bus'] }] }
    ]);
    expect(element.querySelector('table'), 'no table any more').toBeNull();
    expect(element.textContent).toContain('2 connections, 1 client, 1 environment.');
  });

  it('an environment is hidden and shown by its row, a hidden one that holds the active connection says Connected, and what was left hidden is kept for the next visit', async () => {
    localStorage.removeItem('connections-collapsed');
    connectionServiceMock.getConnections.mockReturnValue(later([connection({ id: 'c1', name: 'prod-bus', clientId: 'g1', environmentId: 'g2', isConnected: true })]));
    vi.mocked(groupService.getGroups).mockReturnValue(later([client, production]));
    const { fixture, element } = await render();
    const row = element.querySelector('button.environment-row') as HTMLButtonElement;

    row.click();
    fixture.detectChanges();

    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(element.querySelectorAll('li.connection-card').length, 'its connections are hidden').toBe(0);
    expect(row.textContent, 'the active connection is not lost from view').toContain('Connected');
    expect(JSON.parse(localStorage.getItem('connections-collapsed')!)).toEqual(['g2']);

    fixture.destroy();
    const again = await render();
    expect(again.element.querySelector('button.environment-row')?.getAttribute('aria-expanded'), 'left hidden, it opens hidden').toBe('false');
    localStorage.removeItem('connections-collapsed');
  });

  it.each(['{"a":1}', 'not json', '[1,{"x":2}]'])('what was kept on this computer and is not a list of names (%s) is ignored: the list opens with every environment shown', async kept => {
    localStorage.setItem('connections-collapsed', kept);
    connectionServiceMock.getConnections.mockReturnValue(later([connection({ id: 'c1', name: 'prod-bus', clientId: 'g1', environmentId: 'g2' })]));
    vi.mocked(groupService.getGroups).mockReturnValue(later([client, production]));
    const { element } = await render();

    expect(element.querySelector('button.environment-row')?.getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelectorAll('li.connection-card').length).toBe(1);
    localStorage.removeItem('connections-collapsed');
  });

  it('an environment still hides and shows when this computer refuses to keep what was hidden', async () => {
    localStorage.removeItem('connections-collapsed');
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    connectionServiceMock.getConnections.mockReturnValue(later([connection({ id: 'c1', name: 'prod-bus', clientId: 'g1', environmentId: 'g2' })]));
    vi.mocked(groupService.getGroups).mockReturnValue(later([client, production]));
    const { fixture, element } = await render();

    (element.querySelector('button.environment-row') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(element.querySelector('button.environment-row')?.getAttribute('aria-expanded')).toBe('false');
    refuse.mockRestore();
  });

  it('Collapse all hides every environment and Expand all shows them again', async () => {
    localStorage.removeItem('connections-collapsed');
    connectionServiceMock.getConnections.mockReturnValue(later([
      connection({ id: 'c1', name: 'prod-bus', clientId: 'g1', environmentId: 'g2' }), connection({ id: 'c2', name: 'loose-bus' })
    ]));
    vi.mocked(groupService.getGroups).mockReturnValue(later([client, production]));
    const { fixture, element, buttons } = await render();
    const states = () => Array.from(element.querySelectorAll('button.environment-row')).map(b => b.getAttribute('aria-expanded'));

    buttons('Collapse all')[0].click();
    fixture.detectChanges();
    expect(states()).toEqual(['false', 'false']);
    expect(element.querySelectorAll('li.connection-card').length).toBe(0);

    buttons('Expand all')[0].click();
    fixture.detectChanges();
    expect(states()).toEqual(['true', 'true']);
    expect(element.querySelectorAll('li.connection-card').length).toBe(2);
    localStorage.removeItem('connections-collapsed');
  });

  describe('export in the desktop app', () => {
    afterEach(() => { delete (window as any).electronAPI; });

    const exportWith = async (answer: unknown) => {
      const saveExportFile = vi.fn(async () => answer);
      (window as any).electronAPI = { saveExportFile };
      (connectionServiceMock as any).exportFullConfiguration = vi.fn(() => of({ connections: [], groups: [] }));
      const { fixture } = await render();
      (fixture.componentInstance as any).runFullExport(true);
      await settle();
      return { saveExportFile, said: snackBarMock.open.mock.calls.map(c => c[0]) };
    };

    it('is saved where the user chooses: the desktop app is given a file name and the text, and the screen says the file it wrote', async () => {
      const { saveExportFile, said } = await exportWith({ status: 'saved', file: 'my-export.json' });

      expect(saveExportFile.mock.calls[0]).toEqual([expect.stringMatching(/^servicebus-full-config-\d{4}-\d{2}-\d{2}\.json$/), JSON.stringify({ connections: [], groups: [] }, null, 2)]);
      expect(said).toEqual(['Export saved as my-export.json. File contains plaintext credentials — store securely.']);
    });

    it('a save dialog that was cancelled says nothing', async () => {
      expect((await exportWith({ status: 'cancelled' })).said).toEqual([]);
    });

    it('a file that could not be written says why, as the desktop app worded it', async () => {
      expect((await exportWith({ status: 'error', message: 'The file could not be written (EACCES).' })).said)
        .toEqual(['The export was not saved. The file could not be written (EACCES).']);
    });
  });

  it('offers Open entities instead of Connect on the active connection', async () => {
    connectionServiceMock.getConnections.mockReturnValue(later([connection({ isConnected: true })]));
    const { element, buttons } = await render();

    const row = element.querySelector('li.connection-card');
    expect(row).not.toBeNull();
    const open = row?.querySelector('a');
    expect(open?.textContent?.trim()).toBe('Open entities');
    expect(open?.getAttribute('href')).toBe('/entities');
    expect(row?.querySelector('.connected-chip')?.textContent?.replace('check_circle', '').trim()).toBe('Connected');
    expect(buttons('Connect').filter(b => row?.contains(b))).toHaveLength(0);
  });

  it('a connection row shows its name with the broker and how it signs in, its target, when it was last used and its actions; the environment is its group, not a column', async () => {
    connectionServiceMock.getConnections.mockReturnValue(later([connection({})]));
    const { element } = await render();

    const row = element.querySelector('li.connection-card')!;
    expect(Array.from(row.children).map(c => c.className.split(' ')[0])).toEqual(['identity', 'target', 'last-used', 'row-actions']);
    expect(row.querySelector('.environment-chip'), 'no environment chip on the row').toBeNull();
    expect(element.querySelector('thead')).toBeNull();
  });

  it('shows the environment chip of each connection, PRODUCTION for an environment marked production and NO ENVIRONMENT for none', async () => {
    const development: ConnectionGroup = { id: 'g3', name: 'Development', type: 'environment', parentId: 'g1', createdAt: new Date() };
    connectionServiceMock.getConnections.mockReturnValue(later([
      connection({ id: 'c1', name: 'prod-bus', clientId: 'g1', environmentId: 'g2' }),
      connection({ id: 'c2', name: 'dev-bus', clientId: 'g1', environmentId: 'g3' }),
      connection({ id: 'c3', name: 'loose-bus' })
    ]));
    vi.mocked(groupService.getGroups).mockReturnValue(later([client, { ...production, isProduction: true }, development]));
    const { element } = await render();

    const chips = Object.fromEntries(Array.from(element.querySelectorAll('.environment')).map(env => [
      env.querySelector('li.connection-card h3')?.textContent?.trim(),
      env.querySelector('button.environment-row .environment-chip')
    ]));
    expect(chips['prod-bus']?.textContent?.replace('warning', '').trim()).toBe('PRODUCTION');
    expect(chips['prod-bus']?.classList.contains('production')).toBe(true);
    expect(chips['dev-bus']?.textContent?.trim()).toBe('DEVELOPMENT');
    expect(chips['dev-bus']?.classList.contains('production')).toBe(false);
    expect(chips['loose-bus']?.textContent?.trim()).toBe('NO ENVIRONMENT');
  });

  it('shows when each connection was last used as the artboard formats it, and Never when it was not', async () => {
    connectionServiceMock.getConnections.mockReturnValue(later([
      connection({ id: 'c1', name: 'used-bus', lastUsedAt: new Date(2026, 10, 12, 13, 58, 31) }),
      connection({ id: 'c2', name: 'new-bus' })
    ]));
    const { element } = await render();

    const lastUsed = Object.fromEntries(Array.from(element.querySelectorAll('li.connection-card')).map(row => [
      row.querySelector('h3')?.textContent?.trim(),
      // DatePipe puts a narrow no-break space before PM.
      row.querySelector('.last-used')?.textContent?.replace(/\s+/g, ' ').trim()
    ]));
    expect(lastUsed).toEqual({ 'used-bus': 'Nov 12, 2026, 1:58:31 PM', 'new-bus': 'Never' });
  });

  it('names each icon and delete control after its connection', async () => {
    connectionServiceMock.getConnections.mockReturnValue(later([connection({})]));
    const { element } = await render();

    const labels = Array.from(element.querySelectorAll('li.connection-card button')).map(b => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Connect to orders-rabbitmq', 'Edit orders-rabbitmq', 'Delete orders-rabbitmq']);
  });
  describe('as the artboard draws it', () => {
    let service: any;
    let dialog: { open: ReturnType<typeof vi.fn> };
    let snackBar: { open: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      service = connectionServiceMock as any;
      service.connect = vi.fn(() => failLater());
      service.disconnect = vi.fn(() => later({ connected: false }));
      service.deleteConnection = vi.fn(() => later(undefined));
      service.isConnected = false;
      service.currentNamespace = undefined;
      service.currentConnectionId = null;
      service.connectionStatus$ = new BehaviorSubject<any>({ connected: false });
      dialog = dialogMock;
      snackBar = snackBarMock;
    });

    const confirmWith = (answer: boolean | undefined) =>
      dialog.open.mockReturnValue({ afterClosed: () => of(answer) });

    it('titles the screen with one h1 "Connections"', async () => {
      connectionServiceMock.getConnections.mockReturnValue(later([connection({})]));
      const { element } = await render();
      expect(Array.from(element.querySelectorAll('h1')).map(h => h.textContent?.trim())).toEqual(['Connections']);
    });

    it('says under each name the broker and how the connection signs in', async () => {
      connectionServiceMock.getConnections.mockReturnValue(later([
        connection({ id: 'r', name: 'rabbit', virtualHost: '/' }),
        connection({ id: 'a', name: 'bus', providerType: ProviderType.AzureServiceBus, namespace: 'ns.servicebus.windows.net', authType: 'InteractiveBrowser' }),
      ]));
      const { element } = await render();
      expect(Array.from(element.querySelectorAll('li.connection-card .auth-line')).map(l => l.textContent?.trim()))
        .toEqual(['RabbitMQ · Username and password, virtual host /', 'Azure Service Bus · Sign in with Microsoft']);
    });

    it('deleting a connection of an environment marked production asks for its name typed, and one of another environment does not', async () => {
      dialogMock.open.mockReturnValue({ afterClosed: () => of(false) });
      connectionServiceMock.getConnections.mockReturnValue(later([
        connection({ id: 'p', name: 'prod-bus', clientId: 'g1', environmentId: 'g2' }), connection({ id: 'l', name: 'loose-bus' })
      ]));
      vi.mocked(groupService.getGroups).mockReturnValue(later([client, { ...production, isProduction: true }]));
      const { element } = await render();

      Array.from(element.querySelectorAll<HTMLButtonElement>('button.delete')).forEach(b => b.click());

      expect(dialogMock.open.mock.calls.map(c => [c[1].data.typedName, c[1].data.typedLabel])).toEqual([
        ['prod-bus', 'Type the name of the connection to confirm'], [undefined, 'Type the name of the connection to confirm']
      ]);
    });

    it('a failed connect is an error on the screen that names the connection and what stays active, with Retry and Edit', async () => {
      connectionServiceMock.getConnections.mockReturnValue(later([connection({})]));
      service.isConnected = true;
      service.currentNamespace = 'other-ns.servicebus.windows.net';
      const { fixture, element } = await render();

      (element.querySelector('[aria-label="Connect to orders-rabbitmq"]') as HTMLElement).click();
      await settle();
      fixture.detectChanges();

      const panel = element.querySelector('[data-testid="connect-error"]') as HTMLElement;
      expect(panel.getAttribute('aria-label')).toBe('Error');
      expect(panel.textContent).toContain('Could not connect to orders-rabbitmq');
      service.connectionStatus$.next({ connected: true, namespace: 'other-ns.servicebus.windows.net' });
      fixture.detectChanges();
      expect(panel.textContent).toContain('The connection that was active stays active: other-ns.servicebus.windows.net. Nothing was changed on either broker.');
      expect(snackBar.open).not.toHaveBeenCalledWith('Failed to connect', expect.anything(), expect.anything());

      dialog.open.mockReturnValue({ afterClosed: () => of(undefined) });
      const named = (label: string) => Array.from(panel.querySelectorAll('button')).find(b => b.textContent?.trim().endsWith(label)) as HTMLElement;
      expect(['Retry', 'Edit the connection'].map(label => named(label).querySelector('mat-icon')?.textContent?.trim()), 'as Connections.dc.html draws them: Retry with the refresh icon, Edit the connection with the pencil').toEqual(['refresh', 'edit']);
      named('Retry').click();
      expect(service.connect).toHaveBeenCalledTimes(2);
      await settle();
      fixture.detectChanges();

      const edit = Array.from(element.querySelectorAll('[data-testid="connect-error"] button')).find(b => b.textContent?.trim().endsWith('Edit the connection')) as HTMLElement;
      edit.click();
      fixture.detectChanges();
      expect(dialog.open).toHaveBeenCalledTimes(1);
      expect(element.querySelector('[data-testid="connect-error"]'), 'the error leaves the screen when the connection is opened for edit, as the artboard draws').toBeNull();
    });

    describe('a failed connect says the reason the API classified, as Connections.dc.html draws it', () => {
      const failWith = (code?: string) => timer(0).pipe(switchMap(() => throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'fixed', ...(code ? { code } : {}) } }))));
      const reasonAfterConnect = async (code?: string) => {
        connectionServiceMock.getConnections.mockReturnValue(later([connection({})]));
        service.connect = vi.fn(() => failWith(code));
        const { fixture, element } = await render();
        (element.querySelector('[aria-label="Connect to orders-rabbitmq"]') as HTMLElement).click();
        await settle();
        fixture.detectChanges();
        return element.querySelector('[data-testid="connect-error"] .reason')?.textContent?.trim();
      };

      it.each([
        ['connection-refused', 'The broker at localhost:5672 refused the connection. Check the host name and the port.'],
        ['host-not-found', 'The host of localhost:5672 was not found. Check the host name.'],
        ['timeout', 'The broker at localhost:5672 did not answer in time. Check the host name, the port and the network.'],
        ['tls', 'The TLS handshake with localhost:5672 failed. Check the TLS setting and the port.'],
        ['credentials-refused', 'The broker at localhost:5672 refused the user name or the password. Check the user name and the password.'],
      ])('%s: the broker\'s reason with what to check', async (code, sentence) => {
        expect(await reasonAfterConnect(code), `the reason the API classified as ${code}, with the target of the connection`).toBe(sentence);
      });

      it('a failure the API could not classify keeps the general line', async () => {
        expect(await reasonAfterConnect(), 'no code: the general line').toBe('Check the target, the credentials and the port of this connection.');
      });
    });

    it('after a failed connect the panel says what the API reports is active now, never the stale guess', async () => {
      connectionServiceMock.getConnections.mockReturnValue(later([connection({})]));
      service.isConnected = true;
      service.currentNamespace = 'old-ns.servicebus.windows.net';
      const { fixture, element } = await render();
      (element.querySelector('[aria-label="Connect to orders-rabbitmq"]') as HTMLElement).click();
      await settle();
      fixture.detectChanges();
      const panel = () => element.querySelector('[data-testid="connect-error"]')?.textContent ?? '';
      expect(panel()).not.toContain('stays active');

      service.connectionStatus$.next({ connected: true, namespace: 'new-ns.servicebus.windows.net' });
      fixture.detectChanges();
      expect(panel()).toContain('The active connection is now new-ns.servicebus.windows.net. Nothing was changed on either broker.');
    });

    it('after a failed connect with nothing active the panel says so', async () => {
      connectionServiceMock.getConnections.mockReturnValue(later([connection({})]));
      const { fixture, element } = await render();
      (element.querySelector('[aria-label="Connect to orders-rabbitmq"]') as HTMLElement).click();
      await settle();
      service.connectionStatus$.next({ connected: false });
      fixture.detectChanges();
      expect(element.querySelector('[data-testid="connect-error"]')?.textContent).toContain('No connection is active. Nothing was changed on the broker.');
    });

    it('deleting the connection whose connect failed takes its error off the screen', async () => {
      connectionServiceMock.getConnections.mockReturnValue(later([connection({})]));
      confirmWith(true);
      const { fixture, element } = await render();
      (element.querySelector('[aria-label="Connect to orders-rabbitmq"]') as HTMLElement).click();
      await settle();
      fixture.detectChanges();
      expect(element.querySelector('[data-testid="connect-error"]')).not.toBeNull();

      (element.querySelector('[aria-label="Delete orders-rabbitmq"]') as HTMLElement).click();
      await settle();
      fixture.detectChanges();
      expect(element.querySelector('[data-testid="connect-error"]')).toBeNull();
    });

    it('the active connection is the one the service connected, not a stale saved flag', async () => {
      connectionServiceMock.getConnections.mockReturnValue(later([connection({ isConnected: false })]));
      service.currentConnectionId = 'c1';
      const order: string[] = [];
      service.disconnect = vi.fn(() => { order.push('disconnect'); return later({ connected: false }); });
      service.deleteConnection = vi.fn(() => { order.push('delete'); return later(undefined); });
      confirmWith(true);
      const { element } = await render();
      (element.querySelector('[aria-label="Delete orders-rabbitmq"]') as HTMLElement).click();
      await settle();
      expect(order).toEqual(['disconnect', 'delete']);
    });

    it('a saved Connected flag the service does not confirm never disconnects the active broker', async () => {
      connectionServiceMock.getConnections.mockReturnValue(later([connection({ isConnected: true })]));
      service.isConnected = true;
      service.currentNamespace = 'another-ns.servicebus.windows.net';
      confirmWith(true);
      const { element } = await render();
      (element.querySelector('[aria-label="Delete orders-rabbitmq"]') as HTMLElement).click();
      await settle();
      expect(service.disconnect).not.toHaveBeenCalled();
      expect(service.deleteConnection).toHaveBeenCalledWith('c1');
    });

    it('Delete asks in a dialog of the app that names the connection, its broker, target, group and stored secret, then deletes it', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm');
      connectionServiceMock.getConnections.mockReturnValue(later([connection({})]));
      confirmWith(true);
      const { element } = await render();

      (element.querySelector('[aria-label="Delete orders-rabbitmq"]') as HTMLElement).click();
      await settle();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(dialog.open.mock.calls[0][0]).toBe(ConfirmDialogComponent);
      const data = dialog.open.mock.calls[0][1].data as ConfirmDialogData;
      expect(data.title).toBe('Delete connection?');
      expect(data.message).toBe('This removes the saved connection from this computer, with its stored password. Nothing on the broker is changed. It cannot be undone, except by adding the connection again.');
      expect(data.notice).toBeUndefined();
      expect(data.facts).toEqual([
        { label: 'Connection', value: 'orders-rabbitmq' },
        { label: 'Broker', value: 'RabbitMQ' },
        { label: 'Target', value: 'localhost:5672' },
        { label: 'Client and environment', value: 'Ungrouped, no environment' },
      ]);
      expect(data.facts?.[3].value, 'as Connections.dc.html deleteConfirm draws an ungrouped connection').toBe('Ungrouped, no environment');
      expect(data.confirmText).toBe('Delete connection');
      expect(data.context, 'as Connections.dc.html deleteConfirm draws it: the chip, then "<name> to <target>"; NO ENVIRONMENT for an ungrouped connection')
        .toStrictEqual({ subject: 'orders-rabbitmq', where: 'to localhost:5672', mark: { name: null, isProduction: false } });
      expect(service.disconnect).not.toHaveBeenCalled();
      expect(service.deleteConnection).toHaveBeenCalledWith('c1');
    });

    it('Delete of a connection in an environment marked production opens with the PRODUCTION chip of that connection', async () => {
      connectionServiceMock.getConnections.mockReturnValue(later([connection({ id: 'c1', name: 'prod-bus', clientId: 'g1', environmentId: 'g2' })]));
      vi.mocked(groupService.getGroups).mockReturnValue(later([client, { ...production, isProduction: true }]));
      confirmWith(false);
      const { element } = await render();

      (element.querySelector('[aria-label="Delete prod-bus"]') as HTMLElement).click();
      await settle();

      const data = dialog.open.mock.calls[0][1].data as ConfirmDialogData;
      expect(data.context, 'the delete confirmation names the environment of the connection being deleted')
        .toStrictEqual({ subject: 'prod-bus', where: 'to localhost:5672', mark: { name: 'Production', isProduction: true } });
      expect(data.facts?.find(f => f.label === 'Client and environment')?.value, 'a grouped connection is named "client, environment"').toBe('Contoso, Production');
    });

    it('deleting the active connection says it disconnects first, and disconnects before it deletes', async () => {
      connectionServiceMock.getConnections.mockReturnValue(later([connection({ isConnected: true })]));
      service.isConnected = true;
      service.currentNamespace = 'localhost:5672';
      const order: string[] = [];
      service.disconnect = vi.fn(() => { order.push('disconnect'); return later({ connected: false }); });
      service.deleteConnection = vi.fn(() => { order.push('delete'); return later(undefined); });
      confirmWith(true);
      const { element } = await render();

      (element.querySelector('[aria-label="Delete orders-rabbitmq"]') as HTMLElement).click();
      await settle();

      const data = dialog.open.mock.calls[0][1].data as ConfirmDialogData;
      expect(data.notice).toBe('This is the active connection. The app disconnects from localhost:5672 first, and the Entities and Monitoring screens go empty.');
      expect(order).toEqual(['disconnect', 'delete']);
    });

    it('a cancelled delete changes nothing, and a failed disconnect deletes nothing', async () => {
      connectionServiceMock.getConnections.mockReturnValue(later([connection({ isConnected: true })]));
      service.currentConnectionId = 'c1';
      confirmWith(undefined);
      const { element } = await render();
      (element.querySelector('[aria-label="Delete orders-rabbitmq"]') as HTMLElement).click();
      await settle();
      expect(service.disconnect).not.toHaveBeenCalled();
      expect(service.deleteConnection).not.toHaveBeenCalled();

      confirmWith(true);
      service.disconnect = vi.fn(() => failLater());
      (element.querySelector('[aria-label="Delete orders-rabbitmq"]') as HTMLElement).click();
      await settle();
      expect(service.deleteConnection).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalledWith('The connection was not deleted: the local API answered with an error.', 'Close', { duration: 5000 });
    });
  });
});
