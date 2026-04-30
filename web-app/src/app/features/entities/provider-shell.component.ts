import {
  Component,
  OnInit,
  OnChanges,
  SimpleChanges,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ViewContainerRef,
  ComponentRef,
  DestroyRef,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ProviderService } from '../../core/services/provider.service';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import {
  IProviderEntityDetailsComponent,
  EntityInfo,
  EntityAction
} from '../../core/models/provider-component.interface';
import { ServiceBusConnection } from '../../core/models/connection.model';
import { ProviderType } from '../../core/models/provider.model';

/**
 * Shell component for dynamically loading provider-specific entity detail components.
 *
 * This component acts as a container that watches the current provider selection
 * and dynamically loads the appropriate provider-specific component at runtime.
 * It follows the Provider Registry Pattern to enable isolated provider implementations
 * without tight coupling to specific provider types.
 *
 * Architecture:
 * - Subscribes to provider state changes via ProviderService
 * - Resolves component types via ProviderRegistryService
 * - Dynamically instantiates components using ViewContainerRef
 * - Binds inputs and proxies outputs to maintain communication with parent components
 *
 * This enables:
 * - Hot-swapping provider UI without page reload
 * - Complete isolation between provider implementations
 * - Easy addition of new providers without modifying shell logic
 *
 * @example
 * ```html
 * <app-provider-shell
 *   [entity]="selectedEntity"
 *   [connection]="activeConnection"
 *   (onRefresh)="handleRefresh()"
 *   (onAction)="handleAction($event)">
 * </app-provider-shell>
 * ```
 */
@Component({
  selector: 'app-provider-shell',
  standalone: true,
  template: `
    <div class="provider-shell-container">
      <ng-container #providerHost></ng-container>
    </div>
  `,
  styles: [`
    .provider-shell-container {
      width: 100%;
      height: 100%;
    }
  `]
})
export class ProviderShellComponent implements OnInit, OnChanges {
  /**
   * ViewContainerRef for dynamically creating provider components.
   * This is the injection point where provider-specific components will be rendered.
   */
  @ViewChild('providerHost', { read: ViewContainerRef }) providerHost!: ViewContainerRef;

  /**
   * The entity to display (queue, topic, exchange, subscription, etc.).
   * This input is passed through to the dynamically loaded provider component.
   */
  @Input() entity?: EntityInfo;

  /**
   * The active connection configuration.
   * This input is passed through to the dynamically loaded provider component.
   */
  @Input() connection?: ServiceBusConnection;

  /**
   * Event emitted when the entity should be refreshed.
   * Proxied from the dynamically loaded provider component.
   */
  @Output() onRefresh = new EventEmitter<void>();

  /**
   * Event emitted when an action is performed on the entity.
   * Proxied from the dynamically loaded provider component.
   */
  @Output() onAction = new EventEmitter<EntityAction>();

  /**
   * Reference to the currently loaded provider component.
   * Used for cleanup when switching providers.
   */
  private currentComponentRef?: ComponentRef<IProviderEntityDetailsComponent>;

  /**
   * DestroyRef for managing subscription lifecycle.
   * Angular 21 pattern for automatic cleanup with takeUntilDestroyed().
   */
  private destroyRef = inject(DestroyRef);

  constructor(
    private providerService: ProviderService,
    private providerRegistry: ProviderRegistryService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (this.currentComponentRef && (changes['entity'] || changes['connection'])) {
      const instance = this.currentComponentRef.instance;
      if (changes['entity'] && this.entity) {
        instance.entity = this.entity;
      }
      if (changes['connection'] && this.connection) {
        instance.connection = this.connection;
      }
      this.currentComponentRef.changeDetectorRef.detectChanges();
    }
  }

  ngOnInit(): void {
    // Watch for provider changes and dynamically load components
    // Use debounceTime to prevent rapid component thrashing (Edge Case #4 from spec)
    // Use distinctUntilChanged to prevent unnecessary reloads when provider hasn't changed
    this.providerService.providerState$
      .pipe(
        debounceTime(100), // Debounce rapid provider switching
        distinctUntilChanged((prev, curr) => prev.selectedProvider === curr.selectedProvider),
        takeUntilDestroyed(this.destroyRef) // Proper cleanup for Angular 21
      )
      .subscribe(state => {
        this.loadProviderComponent(state.selectedProvider);
      });
  }

  /**
   * Dynamically loads and renders the component for the specified provider type.
   *
   * This method performs the following steps:
   * 1. Clears any existing provider component from the view
   * 2. Destroys the previous component reference to free memory
   * 3. Resolves the new component type from the registry
   * 4. Creates the new component instance
   * 5. Binds inputs from shell to provider component
   * 6. Proxies outputs from provider component to shell outputs
   * 7. Triggers change detection for the new component
   *
   * @param providerType - The messaging provider type to load components for
   * @private
   */
  private loadProviderComponent(providerType: ProviderType): void {
    // Clear existing component from view
    this.providerHost.clear();

    // Clean up previous component reference
    if (this.currentComponentRef) {
      this.currentComponentRef.destroy();
      this.currentComponentRef = undefined;
    }

    // Get component type from registry
    const componentType = this.providerRegistry.getEntityDetailsComponent(providerType);

    if (!componentType) {
      console.error(`No component registered for provider: ${providerType}`);
      // TODO: Show error boundary component
      // For now, we'll silently fail - the container will be empty
      return;
    }

    // Dynamically create component
    this.currentComponentRef = this.providerHost.createComponent(componentType);

    // Bind inputs to dynamically created component
    const instance = this.currentComponentRef.instance;
    if (this.entity) {
      instance.entity = this.entity;
    }
    if (this.connection) {
      instance.connection = this.connection;
    }

    // Proxy outputs from dynamically created component to shell outputs
    // This allows parent components to listen to events without knowing
    // which provider component is currently loaded
    instance.onRefresh.subscribe(() => this.onRefresh.emit());
    instance.onAction.subscribe((action) => this.onAction.emit(action));

    // Trigger change detection for the dynamically created component
    this.currentComponentRef.changeDetectorRef.detectChanges();
  }
}
