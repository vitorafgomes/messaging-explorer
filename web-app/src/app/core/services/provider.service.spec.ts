import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { ProviderService } from './provider.service';
import { ApiService } from './api.service';
import { ConnectionService } from './connection.service';
import { ConnectionStatus } from '../models';
import { ProviderCapabilities, ProviderType } from '../models/provider.model';

describe('ProviderService holds the capabilities of the connected provider', () => {
  let status$: BehaviorSubject<ConnectionStatus>;
  let capabilitiesResponse: () => Observable<Partial<ProviderCapabilities>>;
  let get: ReturnType<typeof vi.fn>;
  let service: ProviderService;

  const rabbitConnected = { connected: true, namespace: 'broker.example.net', providerType: 'RabbitMQ' } as unknown as ConnectionStatus;

  beforeEach(() => {
    status$ = new BehaviorSubject<ConnectionStatus>({ connected: false });
    capabilitiesResponse = () => of({});
    get = vi.fn((url: string) => (url === 'connections/providers' ? of([]) : capabilitiesResponse()));
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { get } },
        { provide: ConnectionService, useValue: { connectionStatus$: status$.asObservable() } }
      ]
    });
    service = TestBed.inject(ProviderService);
  });

  it('a RabbitMQ connection loads the capabilities the API returns for RabbitMQ', () => {
    capabilitiesResponse = () => of({ supportsSessions: false, supportsScheduledMessages: false, supportsDeadLetterQueue: false });

    status$.next(rabbitConnected);

    expect(get).toHaveBeenCalledWith('connections/providers/1/capabilities');
    expect(service.selectedProvider).toBe(ProviderType.RabbitMQ);
    expect(service.capabilities()?.supportsDeadLetterQueue).toBe(false);
    expect(service.capabilities()?.supportsSessions).toBe(false);
    expect(service.isFeatureSupported('supportsDeadLetterQueue')).toBe(false);
  });

  it('while the capabilities load, the built-in defaults of the connected provider apply', () => {
    capabilitiesResponse = () => new Subject<ProviderCapabilities>();

    status$.next(rabbitConnected);

    expect(service.capabilities()?.supportsSessions).toBe(false);
    expect(service.capabilities()?.supportsScheduledMessages).toBe(false);
    expect(service.capabilities()?.supportsDeadLetterQueue).toBe(true);
  });

  it('when the capabilities call fails with a 500, the defaults of the connected provider apply and the failure does not escape', () => {
    capabilitiesResponse = () => throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' }));
    const errors: unknown[] = [];
    service.providerState$.subscribe({ error: e => errors.push(e) });

    status$.next(rabbitConnected);

    expect(service.selectedProvider).toBe(ProviderType.RabbitMQ);
    expect(service.capabilities()?.supportsSessions).toBe(false);
    expect(service.capabilities()?.supportsScheduledMessages).toBe(false);
    expect(service.capabilities()?.supportsDeadLetterQueue).toBe(true);
    expect(service.currentCapabilities?.providerDisplayName).toBe('RabbitMQ');
    expect(errors).toEqual([]);
  });

  it('a capability the API leaves out keeps the default of the connected provider', () => {
    capabilitiesResponse = () => of({ supportsSessions: true });

    status$.next({ connected: true, namespace: 'ns.example.net', providerType: 'AzureServiceBus' } as unknown as ConnectionStatus);

    expect(get).toHaveBeenCalledWith('connections/providers/0/capabilities');
    expect(service.capabilities()?.supportsScheduledMessages).toBe(true);
    expect(service.capabilities()?.supportsDeadLetterQueue).toBe(true);
  });

  it('on disconnect the state resets, and a late answer for the old connection does not bring it back', () => {
    const late = new Subject<ProviderCapabilities>();
    capabilitiesResponse = () => late;
    status$.next(rabbitConnected);

    status$.next({ connected: false });
    late.next({ supportsSessions: true } as ProviderCapabilities);

    expect(service.capabilities()).toBeNull();
    expect(service.currentCapabilities).toBeNull();
    expect(service.selectedProvider).toBe(ProviderType.AzureServiceBus);
  });
});
