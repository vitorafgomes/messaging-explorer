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

  describe('entity administration is offered only when the API explicitly says true', () => {
    const azureConnected = { connected: true, namespace: 'ns.example.net', providerType: 'AzureServiceBus' } as unknown as ConnectionStatus;

    it('an Azure API that answers supportsEntityUpdate: true enables it', () => {
      capabilitiesResponse = () => of({ supportsEntityUpdate: true });

      status$.next(azureConnected);

      expect(service.capabilities()?.supportsEntityUpdate).toBe(true);
    });

    it('an older Azure API that does not send the flag leaves it off, although the Azure default is true', () => {
      capabilitiesResponse = () => of({ supportsSessions: true });

      status$.next(azureConnected);

      expect(service.capabilities()?.supportsEntityUpdate, 'supportsEntityUpdate without the API saying so').toBe(false);
      expect(service.capabilities()?.supportsScheduledMessages).toBe(true);
    });

    it('while the capabilities load, and when the call fails with a 500, it is off', () => {
      const pending = new Subject<ProviderCapabilities>();
      capabilitiesResponse = () => pending;
      status$.next(azureConnected);
      expect(service.capabilities()?.supportsEntityUpdate).toBe(false);

      pending.error(new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' }));
      expect(service.capabilities()?.supportsEntityUpdate).toBe(false);
      expect(service.capabilities()?.supportsSessions).toBe(true);
    });

    it('RabbitMQ: off by default and when its API says false', () => {
      capabilitiesResponse = () => of({ supportsEntityUpdate: false });

      status$.next(rabbitConnected);

      expect(service.capabilities()?.supportsEntityUpdate).toBe(false);
    });
  });

  describe('the rules editor is offered only when the API explicitly says supportsSubscriptionRules is true', () => {
    const azureConnected = { connected: true, namespace: 'ns.example.net', providerType: 'AzureServiceBus' } as unknown as ConnectionStatus;

    it('an Azure API that answers supportsSubscriptionRules: true enables it', () => {
      capabilitiesResponse = () => of({ supportsSubscriptionRules: true });

      status$.next(azureConnected);

      expect(service.capabilities()?.supportsSubscriptionRules).toBe(true);
    });

    it('an older Azure API that does not send the flag leaves it off, although the Azure default is true', () => {
      capabilitiesResponse = () => of({ supportsSessions: true });

      status$.next(azureConnected);

      expect(service.capabilities()?.supportsSubscriptionRules, 'the API did not send the flag').toBe(false);
    });

    it('while the capabilities load, and when the call fails with a 500, it is off', () => {
      const pending = new Subject<ProviderCapabilities>();
      capabilitiesResponse = () => pending;
      status$.next(azureConnected);
      expect(service.capabilities()?.supportsSubscriptionRules, 'while the capabilities load').toBe(false);

      pending.error(new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' }));
      expect(service.capabilities()?.supportsSubscriptionRules, 'after a 500').toBe(false);
    });

    it('RabbitMQ: off when its API says false', () => {
      capabilitiesResponse = () => of({ supportsSubscriptionRules: false });

      status$.next(rabbitConnected);

      expect(service.capabilities()?.supportsSubscriptionRules).toBe(false);
    });
  });

  describe('the transfer dead-letter queue is offered only when the API explicitly says supportsTransferDeadLetter is true', () => {
    const azureConnected = { connected: true, namespace: 'ns.example.net', providerType: 'AzureServiceBus' } as unknown as ConnectionStatus;

    it('an Azure API that answers supportsTransferDeadLetter: true enables it', () => {
      capabilitiesResponse = () => of({ supportsTransferDeadLetter: true });

      status$.next(azureConnected);

      expect(service.capabilities()?.supportsTransferDeadLetter).toBe(true);
    });

    it('an Azure API that does not send the flag leaves it off', () => {
      capabilitiesResponse = () => of({ supportsSessions: true });

      status$.next(azureConnected);

      expect(service.capabilities()?.supportsTransferDeadLetter, 'the API did not send the flag').toBe(false);
    });

    it('while the capabilities load, and when the call fails with a 500, it is off', () => {
      const pending = new Subject<ProviderCapabilities>();
      capabilitiesResponse = () => pending;
      status$.next(azureConnected);
      expect(service.capabilities()?.supportsTransferDeadLetter, 'while the capabilities load').toBe(false);

      pending.error(new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' }));
      expect(service.capabilities()?.supportsTransferDeadLetter, 'after a 500').toBe(false);
    });

    it('RabbitMQ: off when its API says false', () => {
      capabilitiesResponse = () => of({ supportsTransferDeadLetter: false });

      status$.next(rabbitConnected);

      expect(service.capabilities()?.supportsTransferDeadLetter).toBe(false);
    });
  });

  describe('a dead-letter peek from a position is offered only when the API explicitly says supportsPeekFromSequenceNumber is true', () => {
    const azureConnected = { connected: true, namespace: 'ns.example.net', providerType: 'AzureServiceBus' } as unknown as ConnectionStatus;

    it('an Azure API that answers true enables it', () => {
      capabilitiesResponse = () => of({ supportsPeekFromSequenceNumber: true });

      status$.next(azureConnected);

      expect(service.capabilities()?.supportsPeekFromSequenceNumber).toBe(true);
    });

    it('an API that leaves the flag out, or sends anything but true, leaves it off', () => {
      capabilitiesResponse = () => of({ supportsSessions: true });
      status$.next(azureConnected);
      expect(service.capabilities()?.supportsPeekFromSequenceNumber, 'the API did not send the flag').toBe(false);

      capabilitiesResponse = () => of({ supportsPeekFromSequenceNumber: 'true' } as unknown as ProviderCapabilities);
      status$.next(rabbitConnected);
      expect(service.capabilities()?.supportsPeekFromSequenceNumber, 'the text "true"').toBe(false);
    });

    it('while the capabilities load, and when the call fails with a 500, it is off', () => {
      const pending = new Subject<ProviderCapabilities>();
      capabilitiesResponse = () => pending;
      status$.next(azureConnected);
      expect(service.capabilities()?.supportsPeekFromSequenceNumber, 'while the capabilities load').toBe(false);

      pending.error(new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' }));
      expect(service.capabilities()?.supportsPeekFromSequenceNumber, 'after a 500').toBe(false);
    });
  });

  describe('export and import of definitions are offered only when the API explicitly says supportsDefinitions is true', () => {
    const azureConnected = { connected: true, namespace: 'ns.example.net', providerType: 'AzureServiceBus' } as unknown as ConnectionStatus;

    it('an Azure API that answers supportsDefinitions: true enables it', () => {
      capabilitiesResponse = () => of({ supportsDefinitions: true });

      status$.next(azureConnected);

      expect(service.capabilities()?.supportsDefinitions).toBe(true);
    });

    it('an Azure API that does not send the flag, one still loading and one that fails with a 500 leave it off', () => {
      capabilitiesResponse = () => of({ supportsSessions: true });
      status$.next(azureConnected);
      expect(service.capabilities()?.supportsDefinitions, 'the API did not send the flag').toBe(false);

      const pending = new Subject<ProviderCapabilities>();
      capabilitiesResponse = () => pending;
      status$.next({ connected: false } as ConnectionStatus);
      status$.next(azureConnected);
      expect(service.capabilities()?.supportsDefinitions, 'while the capabilities load').toBe(false);

      pending.error(new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' }));
      expect(service.capabilities()?.supportsDefinitions, 'after a 500').toBe(false);
    });
  });

  describe('deferral is not declared for Azure', () => {
    it('an Azure connection whose API leaves the flag out, and one whose call fails, does not declare deferral', () => {
      const azureConnected = { connected: true, namespace: 'ns.example.net', providerType: 'AzureServiceBus' } as unknown as ConnectionStatus;
      const pending = new Subject<ProviderCapabilities>();
      capabilitiesResponse = () => pending;

      status$.next(azureConnected);
      expect(service.capabilities()?.supportsDeferral, 'while the capabilities load').toBe(false);
      pending.error(new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' }));
      expect(service.capabilities()?.supportsDeferral, 'after a 500').toBe(false);

      capabilitiesResponse = () => of({ supportsSessions: true });
      service.refreshCapabilities();
      expect(service.capabilities()?.supportsDeferral, 'the API left the flag out').toBe(false);
    });
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
