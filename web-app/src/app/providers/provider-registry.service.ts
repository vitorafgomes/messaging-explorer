import { Injectable, Type } from '@angular/core';
import { ProviderType } from '../core/models/provider.model';
import { IProviderEntityDetailsComponent } from '../core/models/provider-component.interface';

/**
 * Represents the registration of a provider's components in the registry.
 * Maps a provider type to its corresponding UI components.
 */
interface ProviderComponentRegistration {
  /** The messaging provider type (Azure, RabbitMQ, Kafka, etc.) */
  providerType: ProviderType;

  /** The component class to display entity details for this provider */
  entityDetailsComponent: Type<IProviderEntityDetailsComponent>;
}

/**
 * Central registry service for dynamically resolving provider-specific components.
 *
 * This service maintains a mapping between ProviderType and their corresponding
 * Angular component classes. It enables dynamic component loading in the
 * ProviderShellComponent, allowing provider-specific UI to be loaded at runtime
 * based on the active connection.
 *
 * Providers are registered via lazy imports to optimize bundle size and
 * enable code splitting. Each provider module is only loaded when needed.
 *
 * @example
 * ```typescript
 * constructor(private providerRegistry: ProviderRegistryService) {
 *   const componentType = this.providerRegistry.getEntityDetailsComponent(
 *     ProviderType.AzureServiceBus
 *   );
 *   // Use componentType for dynamic component creation
 * }
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class ProviderRegistryService {
  private registrations = new Map<ProviderType, ProviderComponentRegistration>();

  constructor() {
    this.registerProviders();
  }

  /**
   * Registers all available messaging providers with their components.
   * Uses lazy imports to enable code splitting and reduce initial bundle size.
   * Provider modules are only loaded when they are first accessed.
   *
   * @private
   */
  private registerProviders(): void {
    // Register Azure Service Bus provider
    import('../providers/azure-service-bus').then(module => {
      this.registerProvider({
        providerType: ProviderType.AzureServiceBus,
        entityDetailsComponent: module.AzureEntityDetailsComponent
      });
    }).catch(error => {
      console.error('Failed to load Azure Service Bus provider module:', error);
    });

    // Register RabbitMQ provider
    import('../providers/rabbitmq').then(module => {
      this.registerProvider({
        providerType: ProviderType.RabbitMQ,
        entityDetailsComponent: module.RabbitMQEntityDetailsComponent
      });
    }).catch(error => {
      console.error('Failed to load RabbitMQ provider module:', error);
    });

    // Future providers can be registered here
    // Example: Kafka provider
    // import('../providers/kafka').then(module => {
    //   this.registerProvider({
    //     providerType: ProviderType.Kafka,
    //     entityDetailsComponent: module.KafkaEntityDetailsComponent
    //   });
    // });
  }

  /**
   * Retrieves the entity details component for a specific provider type.
   *
   * Returns null if no component is registered for the given provider.
   * This can occur if:
   * - The provider module hasn't been loaded yet (lazy loading in progress)
   * - The provider is not supported
   * - There was an error loading the provider module
   *
   * @param providerType - The messaging provider type to get the component for
   * @returns The component class implementing IProviderEntityDetailsComponent, or null if not found
   *
   * @example
   * ```typescript
   * const componentType = this.providerRegistry.getEntityDetailsComponent(
   *   ProviderType.RabbitMQ
   * );
   * if (componentType) {
   *   // Dynamically create the component
   *   const componentRef = viewContainerRef.createComponent(componentType);
   * }
   * ```
   */
  getEntityDetailsComponent(providerType: ProviderType): Type<IProviderEntityDetailsComponent> | null {
    const registration = this.registrations.get(providerType);
    return registration?.entityDetailsComponent ?? null;
  }

  /**
   * Registers a provider and its components in the registry.
   *
   * This method is called internally by registerProviders() after lazy loading
   * each provider module. It can also be used to dynamically register new
   * providers at runtime (e.g., for plugin systems or third-party providers).
   *
   * @param registration - The provider registration containing the provider type and component classes
   *
   * @example
   * ```typescript
   * // Register a custom provider
   * this.providerRegistry.registerProvider({
   *   providerType: ProviderType.Custom,
   *   entityDetailsComponent: CustomEntityDetailsComponent
   * });
   * ```
   */
  registerProvider(registration: ProviderComponentRegistration): void {
    this.registrations.set(registration.providerType, registration);
  }

  /**
   * Checks if a provider is currently registered in the registry.
   *
   * This is useful for determining if a provider module has finished loading
   * before attempting to access its components.
   *
   * @param providerType - The provider type to check
   * @returns true if the provider is registered, false otherwise
   *
   * @example
   * ```typescript
   * if (this.providerRegistry.isProviderRegistered(ProviderType.Kafka)) {
   *   // Kafka provider is available
   * }
   * ```
   */
  isProviderRegistered(providerType: ProviderType): boolean {
    return this.registrations.has(providerType);
  }

  /**
   * Gets a list of all currently registered provider types.
   *
   * Note: This only includes providers whose modules have finished loading.
   * Providers that are still being lazy-loaded will not appear in this list.
   *
   * @returns Array of registered provider types
   *
   * @example
   * ```typescript
   * const registeredProviders = this.providerRegistry.getRegisteredProviders();
   * console.log(`Available providers: ${registeredProviders.join(', ')}`);
   * ```
   */
  getRegisteredProviders(): ProviderType[] {
    return Array.from(this.registrations.keys());
  }
}
