import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, EMPTY, Observable, of } from 'rxjs';
import { tap, catchError, map, switchMap } from 'rxjs/operators';
import { ApiService } from './api.service';
import { apiPath } from './api-path';
import { ConnectionService } from './connection.service';
import { ProviderType, ProviderCapabilities, ProviderInfo, getProviderDisplayName } from '../models/provider.model';

/**
 * Represents the current provider selection state.
 */
export interface ProviderSelectionState {
  selectedProvider: ProviderType;
  capabilities: ProviderCapabilities | null;
  isLoading: boolean;
}

/**
 * Default Azure Service Bus capabilities used when API is unavailable.
 * These values match the backend AzureProviderCapabilities.
 */
export const DEFAULT_AZURE_CAPABILITIES: ProviderCapabilities = {
  supportsTopics: true,
  supportsSubscriptions: true,
  supportsScheduledMessages: true,
  supportsSessions: true,
  supportsDeadLetterQueue: true,
  supportsSequenceNumbers: true,
  supportsMessageFiltering: true,
  supportsMessageBatching: true,
  supportsTransactions: true,
  supportsDeferral: true,
  supportsDuplicateDetection: true,
  supportsAutoForwarding: true,
  supportsEntityUpdate: true,
  supportsSubscriptionRules: true,
  supportedExchangeTypes: [],
  maxMessageSizeInBytes: 262144, // 256KB Standard tier
  maxTimeToLive: '14.00:00:00', // 14 days
  providerDisplayName: 'Azure Service Bus',
  providerVersion: '1.0.0'
};

/**
 * Default RabbitMQ capabilities used when API is unavailable.
 * These values match the backend RabbitMQProviderCapabilities.
 */
export const DEFAULT_RABBITMQ_CAPABILITIES: ProviderCapabilities = {
  supportsTopics: true, // via Exchanges
  supportsSubscriptions: true, // via Queue Bindings
  supportsScheduledMessages: false, // requires plugin
  supportsSessions: false,
  supportsDeadLetterQueue: true, // via DLX
  supportsSequenceNumbers: false,
  supportsMessageFiltering: true, // routing keys/headers
  supportsMessageBatching: true,
  supportsTransactions: true, // TX mode
  supportsDeferral: false,
  supportsDuplicateDetection: false,
  supportsAutoForwarding: false,
  supportsEntityUpdate: false,
  supportsSubscriptionRules: false,
  supportedExchangeTypes: ['direct', 'fanout', 'topic', 'headers'],
  maxMessageSizeInBytes: 134217728, // 128MB
  maxTimeToLive: '10675199.02:48:05.4775807', // TimeSpan.MaxValue
  providerDisplayName: 'RabbitMQ',
  providerVersion: '1.0.0'
};

const DISCONNECTED_STATE: ProviderSelectionState = {
  selectedProvider: ProviderType.AzureServiceBus,
  capabilities: null,
  isLoading: false
};

/**
 * The built-in defaults standing in for an API answer: entity administration and the rules editor
 * need the API's own explicit true, because an older API that lacks the routes does not send the flag.
 */
function unconfirmed(capabilities: ProviderCapabilities): ProviderCapabilities {
  return { ...capabilities, supportsEntityUpdate: false, supportsSubscriptionRules: false };
}

/**
 * Reads the provider type of a connection status, which the API sends as the enum name.
 */
function toProviderType(value: ProviderType | string | undefined): ProviderType {
  const parsed = typeof value === 'string' ? ProviderType[value as keyof typeof ProviderType] : value;
  return typeof parsed === 'number' ? parsed : ProviderType.AzureServiceBus;
}

@Injectable({
  providedIn: 'root'
})
export class ProviderService {
  private api = inject(ApiService);

  private providerStateSubject = new BehaviorSubject<ProviderSelectionState>(DISCONNECTED_STATE);
  providerState$ = this.providerStateSubject.asObservable();

  /** Capabilities of the connected provider; null while no connection is active. */
  readonly capabilities = toSignal(this.providerState$.pipe(map(state => state.capabilities)), { requireSync: true });

  private availableProvidersSubject = new BehaviorSubject<ProviderInfo[]>([]);
  availableProviders$ = this.availableProvidersSubject.asObservable();

  private capabilitiesCacheSubject = new BehaviorSubject<Map<ProviderType, ProviderCapabilities>>(new Map());
  private capabilitiesCache$ = this.capabilitiesCacheSubject.asObservable();

  /**
   * Follows the active connection: on connect it holds that connection's provider type and
   * its capabilities, on disconnect it resets.
   */
  constructor() {
    this.loadAvailableProviders();
    inject(ConnectionService).connectionStatus$.pipe(
      switchMap(status => {
        if (!status.connected) {
          this.providerStateSubject.next(DISCONNECTED_STATE);
          return EMPTY;
        }
        return this.selectProvider(toProviderType(status.providerType));
      })
    ).subscribe();
  }

  /**
   * Gets the list of available messaging providers from the API.
   */
  getProviders(): Observable<ProviderInfo[]> {
    return this.api.get<ProviderInfo[]>('connections/providers').pipe(
      tap(providers => this.availableProvidersSubject.next(providers)),
      catchError(error => {
        // Return default providers if API fails
        const defaultProviders = this.getDefaultProviders();
        this.availableProvidersSubject.next(defaultProviders);
        return of(defaultProviders);
      })
    );
  }

  /**
   * Gets the capabilities for a specific provider type.
   */
  getCapabilities(providerType: ProviderType): Observable<ProviderCapabilities> {
    // Check cache first
    const cache = this.capabilitiesCacheSubject.value;
    if (cache.has(providerType)) {
      return of(cache.get(providerType)!);
    }

    return this.api.get<ProviderCapabilities>(apiPath`connections/providers/${providerType}/capabilities`).pipe(
      tap(capabilities => {
        // Update cache
        const updatedCache = new Map(this.capabilitiesCacheSubject.value);
        updatedCache.set(providerType, capabilities);
        this.capabilitiesCacheSubject.next(updatedCache);
      }),
      catchError(error => {
        // Return default capabilities based on provider type
        const defaultCapabilities = this.getDefaultCapabilities(providerType);
        return of(unconfirmed(defaultCapabilities));
      })
    );
  }

  /**
   * Selects a provider and loads its capabilities.
   * Updates the provider state with the selected provider and its capabilities.
   */
  selectProvider(providerType: ProviderType): Observable<ProviderCapabilities> {
    const defaultCapabilities = this.getDefaultCapabilities(providerType);
    this.providerStateSubject.next({
      selectedProvider: providerType,
      capabilities: unconfirmed(defaultCapabilities),
      isLoading: true
    });

    return this.getCapabilities(providerType).pipe(
      map(capabilities => ({
        ...defaultCapabilities,
        ...capabilities,
        supportsEntityUpdate: capabilities.supportsEntityUpdate === true,
        supportsSubscriptionRules: capabilities.supportsSubscriptionRules === true
      })),
      tap(capabilities => {
        this.providerStateSubject.next({
          selectedProvider: providerType,
          capabilities: capabilities,
          isLoading: false
        });
      }),
      catchError(error => {
        const defaultCapabilities = unconfirmed(this.getDefaultCapabilities(providerType));
        this.providerStateSubject.next({
          selectedProvider: providerType,
          capabilities: defaultCapabilities,
          isLoading: false
        });
        return of(defaultCapabilities);
      })
    );
  }

  /**
   * Gets the currently selected provider type.
   */
  get selectedProvider(): ProviderType {
    return this.providerStateSubject.value.selectedProvider;
  }

  /**
   * Gets the capabilities for the currently selected provider.
   */
  get currentCapabilities(): ProviderCapabilities | null {
    return this.providerStateSubject.value.capabilities;
  }

  /**
   * Checks if a specific feature is supported by the currently selected provider.
   */
  isFeatureSupported(feature: keyof ProviderCapabilities): boolean {
    const capabilities = this.providerStateSubject.value.capabilities;
    if (!capabilities) {
      return false;
    }

    const value = capabilities[feature];
    return typeof value === 'boolean' ? value : true;
  }

  /**
   * Gets the display name for the currently selected provider.
   */
  getSelectedProviderDisplayName(): string {
    return getProviderDisplayName(this.providerStateSubject.value.selectedProvider);
  }

  /**
   * Gets the list of supported exchange types for the current provider.
   * Only relevant for RabbitMQ; returns empty array for Azure.
   */
  getSupportedExchangeTypes(): string[] {
    const capabilities = this.providerStateSubject.value.capabilities;
    return capabilities?.supportedExchangeTypes ?? [];
  }

  /**
   * Clears the capabilities cache and reloads from API.
   */
  refreshCapabilities(): void {
    this.capabilitiesCacheSubject.next(new Map());
    this.loadAvailableProviders();

    // Reload capabilities for currently selected provider
    const currentProvider = this.providerStateSubject.value.selectedProvider;
    this.selectProvider(currentProvider).subscribe();
  }

  /**
   * Gets all supported provider types as an array.
   */
  getSupportedProviderTypes(): ProviderType[] {
    return [ProviderType.AzureServiceBus, ProviderType.RabbitMQ];
  }

  /**
   * Observable for checking if the current provider supports topics/exchanges.
   */
  get supportsTopics$(): Observable<boolean> {
    return this.providerState$.pipe(
      map(state => state.capabilities?.supportsTopics ?? false)
    );
  }

  /**
   * Observable for checking if the current provider supports subscriptions/bindings.
   */
  get supportsSubscriptions$(): Observable<boolean> {
    return this.providerState$.pipe(
      map(state => state.capabilities?.supportsSubscriptions ?? false)
    );
  }

  /**
   * Observable for checking if the current provider supports scheduled messages.
   */
  get supportsScheduledMessages$(): Observable<boolean> {
    return this.providerState$.pipe(
      map(state => state.capabilities?.supportsScheduledMessages ?? false)
    );
  }

  /**
   * Observable for checking if the current provider supports sessions.
   */
  get supportsSessions$(): Observable<boolean> {
    return this.providerState$.pipe(
      map(state => state.capabilities?.supportsSessions ?? false)
    );
  }

  /**
   * Observable for checking if the current provider supports dead letter queue.
   */
  get supportsDeadLetterQueue$(): Observable<boolean> {
    return this.providerState$.pipe(
      map(state => state.capabilities?.supportsDeadLetterQueue ?? false)
    );
  }

  /**
   * Loads available providers on service initialization.
   */
  private loadAvailableProviders(): void {
    this.getProviders().subscribe();
  }

  /**
   * Returns default provider info when API is unavailable.
   */
  private getDefaultProviders(): ProviderInfo[] {
    return [
      {
        providerType: ProviderType.AzureServiceBus,
        displayName: 'Azure Service Bus',
        description: 'Microsoft Azure Service Bus messaging service',
        capabilities: DEFAULT_AZURE_CAPABILITIES
      },
      {
        providerType: ProviderType.RabbitMQ,
        displayName: 'RabbitMQ',
        description: 'RabbitMQ open-source message broker',
        capabilities: DEFAULT_RABBITMQ_CAPABILITIES
      }
    ];
  }

  /**
   * Returns default capabilities for a provider type when API is unavailable.
   */
  private getDefaultCapabilities(providerType: ProviderType): ProviderCapabilities {
    switch (providerType) {
      case ProviderType.AzureServiceBus:
        return DEFAULT_AZURE_CAPABILITIES;
      case ProviderType.RabbitMQ:
        return DEFAULT_RABBITMQ_CAPABILITIES;
      default:
        return DEFAULT_AZURE_CAPABILITIES;
    }
  }
}
