/**
 * Defines the supported messaging provider types.
 * Matches the backend ProviderType enum.
 */
export enum ProviderType {
  AzureServiceBus = 0,
  RabbitMQ = 1
}

/**
 * Provider capability discovery interface.
 * Allows the UI to gracefully handle feature differences between messaging providers.
 */
export interface ProviderCapabilities {
  supportsTopics: boolean;
  supportsSubscriptions: boolean;
  supportsScheduledMessages: boolean;
  supportsSessions: boolean;
  supportsDeadLetterQueue: boolean;
  supportsSequenceNumbers: boolean;
  supportsMessageFiltering: boolean;
  supportsMessageBatching: boolean;
  supportsTransactions: boolean;
  supportsDeferral: boolean;
  supportsDuplicateDetection: boolean;
  supportsAutoForwarding: boolean;
  supportedExchangeTypes: string[];
  maxMessageSizeInBytes: number;
  maxTimeToLive: string;
  providerDisplayName: string;
  providerVersion: string;
}

/**
 * Information about an available messaging provider.
 */
export interface ProviderInfo {
  providerType: ProviderType;
  displayName: string;
  description: string;
  capabilities: ProviderCapabilities;
}

/**
 * Base interface for provider-specific connection configuration.
 */
export interface BaseConnectionConfig {
  id: string;
  name: string;
  providerType: ProviderType;
  createdAt: Date;
  lastUsedAt?: Date;
  clientId?: string;
  environmentId?: string;
}

/**
 * Azure Service Bus specific connection configuration.
 */
export interface AzureConnectionConfig extends BaseConnectionConfig {
  providerType: ProviderType.AzureServiceBus;
  connectionString: string;
  namespace?: string;
}

/**
 * RabbitMQ specific connection configuration.
 */
export interface RabbitMQConnectionConfig extends BaseConnectionConfig {
  providerType: ProviderType.RabbitMQ;
  hostName: string;
  port: number;
  userName: string;
  password: string;
  virtualHost: string;
  managementPort: number;
  useSsl: boolean;
  useManagementSsl: boolean;
}

/**
 * Union type for all provider connection configurations.
 */
export type ProviderConnectionConfig = AzureConnectionConfig | RabbitMQConnectionConfig;

/**
 * Helper type guard to check if config is Azure Service Bus.
 */
export function isAzureConnectionConfig(config: ProviderConnectionConfig): config is AzureConnectionConfig {
  return config.providerType === ProviderType.AzureServiceBus;
}

/**
 * Helper type guard to check if config is RabbitMQ.
 */
export function isRabbitMQConnectionConfig(config: ProviderConnectionConfig): config is RabbitMQConnectionConfig {
  return config.providerType === ProviderType.RabbitMQ;
}

/**
 * Default RabbitMQ connection values for new connections.
 */
export const DEFAULT_RABBITMQ_CONFIG: Omit<RabbitMQConnectionConfig, 'id' | 'name' | 'createdAt'> = {
  providerType: ProviderType.RabbitMQ,
  hostName: 'localhost',
  port: 5672,
  userName: 'guest',
  password: 'guest',
  virtualHost: '/',
  managementPort: 15672,
  useSsl: false,
  useManagementSsl: false
};

/**
 * Gets the display name for a provider type.
 */
export function getProviderDisplayName(providerType: ProviderType): string {
  switch (providerType) {
    case ProviderType.AzureServiceBus:
      return 'Azure Service Bus';
    case ProviderType.RabbitMQ:
      return 'RabbitMQ';
    default:
      return 'Unknown Provider';
  }
}

/**
 * Gets the icon name for a provider type.
 */
export function getProviderIcon(providerType: ProviderType): string {
  switch (providerType) {
    case ProviderType.AzureServiceBus:
      return 'cloud';
    case ProviderType.RabbitMQ:
      return 'dns';
    default:
      return 'help';
  }
}

/**
 * Component metadata for provider-specific UI rendering.
 * Provides additional display information beyond capabilities,
 * used by the ProviderRegistryService and UI components.
 */
export interface ProviderComponentMetadata {
  /** The provider type this metadata describes */
  providerType: ProviderType;

  /** Display name shown in the UI */
  displayName: string;

  /** Short description of the provider (1-2 sentences) */
  description: string;

  /** Material icon name for provider representation */
  icon: string;

  /** Optional color theme for provider UI elements (hex color) */
  themeColor?: string;

  /** Documentation URL for the provider */
  documentationUrl?: string;

  /** Whether the provider is considered stable/production-ready */
  isStable: boolean;

  /** Version string of the provider integration (e.g., "1.0.0") */
  version: string;
}

/**
 * Gets comprehensive component metadata for a provider type.
 * Used by UI components to consistently display provider information.
 *
 * @param providerType - The messaging provider type to get metadata for
 * @returns Complete metadata object for the provider
 *
 * @example
 * ```typescript
 * const metadata = getProviderMetadata(ProviderType.AzureServiceBus);
 * console.log(`Provider: ${metadata.displayName} (${metadata.version})`);
 * ```
 */
export function getProviderMetadata(providerType: ProviderType): ProviderComponentMetadata {
  switch (providerType) {
    case ProviderType.AzureServiceBus:
      return {
        providerType: ProviderType.AzureServiceBus,
        displayName: 'Azure Service Bus',
        description: 'Microsoft Azure\'s fully managed enterprise message broker with message queues and publish-subscribe topics.',
        icon: 'cloud',
        themeColor: '#0078D4', // Azure blue
        documentationUrl: 'https://docs.microsoft.com/azure/service-bus-messaging/',
        isStable: true,
        version: '1.0.0'
      };
    case ProviderType.RabbitMQ:
      return {
        providerType: ProviderType.RabbitMQ,
        displayName: 'RabbitMQ',
        description: 'Open-source message broker supporting multiple messaging protocols with flexible routing and exchange patterns.',
        icon: 'dns',
        themeColor: '#FF6600', // RabbitMQ orange
        documentationUrl: 'https://www.rabbitmq.com/documentation.html',
        isStable: true,
        version: '1.0.0'
      };
    default:
      return {
        providerType,
        displayName: 'Unknown Provider',
        description: 'Provider information not available.',
        icon: 'help',
        isStable: false,
        version: '0.0.0'
      };
  }
}
