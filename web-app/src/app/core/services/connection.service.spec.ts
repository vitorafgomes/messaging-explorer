import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ConnectionService } from './connection.service';
import { ApiService } from './api.service';
import { ProviderType, getProviderDisplayName } from '../models/provider.model';
import { getConnectionDisplayTarget } from '../models/connection.model';

describe('ConnectionService knows which stored connection is active', () => {
  let post: ReturnType<typeof vi.fn>;
  let get: ReturnType<typeof vi.fn>;
  let service: ConnectionService;

  beforeEach(() => {
    post = vi.fn();
    get = vi.fn(() => of({ connected: false }));
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: { get, post } }]
    });
    service = TestBed.inject(ConnectionService);
  });

  it('no connection is known at startup, when the status came from the API alone', () => {
    expect(service.currentConnectionId).toBeNull();
  });

  it('a successful connect remembers the id; a disconnect forgets it', async () => {
    post.mockReturnValueOnce(of({ connected: true, namespace: 'ns.example.net' }));
    await firstValueFrom(service.connect('c-1'));
    expect(service.currentConnectionId).toBe('c-1');

    post.mockReturnValueOnce(of({ connected: false }));
    await firstValueFrom(service.disconnect());
    expect(service.currentConnectionId).toBeNull();
  });

  it('a connect that fails keeps no id', async () => {
    post.mockReturnValueOnce(throwError(() => new Error('500')));
    await expect(firstValueFrom(service.connect('c-2'))).rejects.toThrow('500');

    expect(service.currentConnectionId).toBeNull();
  });

  it('a status read again that names another target forgets the stored connection, as after a switch that failed half-way', async () => {
    post.mockReturnValueOnce(of({ connected: true, namespace: 'a.example.net' }));
    await firstValueFrom(service.connect('c-a'));

    get.mockReturnValueOnce(of({ connected: true, namespace: 'a.example.net' }));
    service.refreshStatus();
    expect(service.currentConnectionId, 'the same target keeps the connection').toBe('c-a');

    get.mockReturnValueOnce(of({ connected: true, namespace: 'b.example.net' }));
    service.refreshStatus();
    expect(service.currentConnectionId, 'another target: the stored connection is no longer known').toBeNull();
  });

  it('takes the active stored connection from the status the API answers, after a reload with no connect of its own', () => {
    get.mockReturnValueOnce(of({ connected: true, namespace: 'localhost:5672', connectionId: 'c-2' }));
    service.refreshStatus();
    expect(service.currentConnectionId, 'the service takes the active id from the status').toBe('c-2');

    get.mockReturnValueOnce(of({ connected: true, namespace: 'localhost:5672', connectionId: 'c-3' }));
    service.refreshStatus();
    expect(service.currentConnectionId, 'the id the API names wins over the one the service knew').toBe('c-3');

    get.mockReturnValueOnce(of({ connected: false, connectionId: 'c-3' }));
    service.refreshStatus();
    expect(service.currentConnectionId, 'not connected: no stored connection is active').toBeNull();
  });

  it('a saved connection is announced, so its environment can be read again', async () => {
    const announced = vi.fn();
    service.saved$.subscribe(announced);
    post.mockReturnValueOnce(of({ id: 'c-1' }));
    await firstValueFrom(service.saveConnection({ name: 'x' }));
    expect(announced).toHaveBeenCalledTimes(1);
  });
});

describe('ConnectionService reads the provider of a stored connection as the API names it', () => {
  let get: ReturnType<typeof vi.fn>;
  let service: ConnectionService;

  beforeEach(() => {
    get = vi.fn(() => of({ connected: false }));
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: { get, post: vi.fn() } }]
    });
    service = TestBed.inject(ConnectionService);
  });

  it('the list shows Azure Service Bus and RabbitMQ with their targets, never Unknown Provider, when the API sends the provider by name', async () => {
    get.mockReturnValueOnce(of([
      { id: 'a', name: 'orders-servicebus', providerType: 'AzureServiceBus', namespace: 'sample.servicebus.windows.net' },
      { id: 'r', name: 'orders-rabbitmq', providerType: 'RabbitMQ', hostName: 'rabbit.example.net', port: 5672 }
    ]));

    const connections = await firstValueFrom(service.getConnections());

    expect(connections.map(c => getProviderDisplayName(c.providerType))).toStrictEqual(['Azure Service Bus', 'RabbitMQ']);
    expect(connections.map(getConnectionDisplayTarget)).toStrictEqual(['sample.servicebus.windows.net', 'rabbit.example.net:5672']);
  });

  it('a connection that signs in shows its fully qualified namespace as its target, never Unknown', () => {
    expect(getConnectionDisplayTarget({ id: 's', name: 'signin', providerType: ProviderType.AzureServiceBus, fullyQualifiedNamespace: 'sample.servicebus.windows.net' } as never))
      .toBe('sample.servicebus.windows.net');
  });

  it('one connection read by id is a RabbitMQ connection when the API names it so, so its edit opens the RabbitMQ form', async () => {
    get.mockReturnValueOnce(of({ id: 'r', name: 'orders-rabbitmq', providerType: 'RabbitMQ' }));

    const connection = await firstValueFrom(service.getConnection('r'));

    expect(connection.providerType).toBe(ProviderType.RabbitMQ);
  });
});
