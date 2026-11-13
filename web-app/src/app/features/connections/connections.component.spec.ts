import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { Observable, delay, of, throwError, timer, switchMap } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { ConnectionsComponent } from './connections.component';
import { ApiService, ConnectionGroupService, ConnectionService, DevSettingsService } from '../../core/services';
import { ConnectionGroup, ProviderType, ServiceBusConnection } from '../../core/models';

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
    const row = element.querySelector('tr.connection-card');
    expect(row?.querySelector('h3')?.textContent?.trim()).toBe('orders-rabbitmq');
  });

  it('shows one Add Connection button and the empty state when nothing is saved', async () => {
    const { element, buttons } = await render();

    expect(element.textContent).toContain('No connections configured');
    expect(buttons('Add Connection')).toHaveLength(1);
    expect(buttons('Export')).toHaveLength(0);
  });

  it('groups a connection under its client and environment', async () => {
    connectionServiceMock.getConnections.mockReturnValue(later([
      connection({ id: 'c1', name: 'prod-bus', clientId: 'g1', environmentId: 'g2' }),
      connection({ id: 'c2', name: 'loose-bus' })
    ]));
    vi.mocked(groupService.getGroups).mockReturnValue(later([client, production]));
    const { element } = await render();

    const groups = Array.from(element.querySelectorAll('tbody')).map(body => ({
      label: body.querySelector('th[scope="rowgroup"]')?.textContent?.trim(),
      names: Array.from(body.querySelectorAll('tr.connection-card h3')).map(h => h.textContent?.trim())
    }));
    expect(groups).toEqual([
      { label: 'Contoso, Production', names: ['prod-bus'] },
      { label: 'Ungrouped Connections', names: ['loose-bus'] }
    ]);
    expect(element.textContent).toContain('2 connections, 1 client, 1 environment.');
  });

  it('offers Open entities instead of Connect on the active connection', async () => {
    connectionServiceMock.getConnections.mockReturnValue(later([connection({ isConnected: true })]));
    const { element, buttons } = await render();

    const row = element.querySelector('tr.connection-card');
    expect(row).not.toBeNull();
    const open = row?.querySelector('a');
    expect(open?.textContent?.trim()).toBe('Open entities');
    expect(open?.getAttribute('href')).toBe('/entities');
    expect(row?.querySelector('.connected-chip')?.textContent?.replace('check_circle', '').trim()).toBe('Connected');
    expect(buttons('Connect').filter(b => row?.contains(b))).toHaveLength(0);
  });

  it('names each icon and delete control after its connection', async () => {
    connectionServiceMock.getConnections.mockReturnValue(later([connection({})]));
    const { element } = await render();

    const labels = Array.from(element.querySelectorAll('tr.connection-card button')).map(b => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Connect to orders-rabbitmq', 'Edit orders-rabbitmq', 'Delete orders-rabbitmq']);
  });
});
