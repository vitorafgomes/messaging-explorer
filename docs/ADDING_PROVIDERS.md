# Adding New Messaging Providers

This guide explains how to add support for new messaging providers (e.g., Kafka, AWS SQS, Google Cloud Pub/Sub) to the Messaging Explorer application.

## Architecture Overview

The application uses a **Provider Registry Pattern** to isolate provider-specific UI implementations. This architecture ensures:

- **Complete Isolation**: Changes to one provider never affect another
- **Easy Extensibility**: New providers can be added without modifying existing code
- **Dynamic Loading**: Provider components are lazy-loaded for optimal performance
- **Type Safety**: Compile-time checks ensure interface compliance

### Key Components

1. **IProviderEntityDetailsComponent**: Interface contract that all providers must implement
2. **ProviderRegistryService**: Central registry mapping provider types to components
3. **ProviderShellComponent**: Dynamic loader that instantiates provider components at runtime
4. **Provider Modules**: Isolated folders containing provider-specific implementations

### Architecture Flow

```
User selects connection
       ↓
ProviderService emits provider change
       ↓
ProviderShellComponent receives change
       ↓
ProviderRegistryService resolves component type
       ↓
ViewContainerRef creates component instance
       ↓
Provider-specific UI renders
```

## Provider Folder Structure

Each provider must follow this standardized folder structure:

```
src/app/providers/
└── {provider-name}/              # e.g., kafka, aws-sqs, gcp-pubsub
    ├── components/                # Provider-specific UI components
    │   ├── {provider}-entity-details.component.ts
    │   ├── {provider}-entity-details.component.html
    │   └── {provider}-entity-details.component.scss
    ├── models/                    # Provider-specific data models (optional)
    │   ├── {provider}-queue.model.ts
    │   └── {provider}-topic.model.ts
    ├── services/                  # Provider-specific services (optional)
    │   └── {provider}-entity.service.ts
    └── index.ts                   # Barrel export for lazy loading
```

### Naming Conventions

- **Folder name**: Lowercase with hyphens (e.g., `kafka`, `aws-sqs`)
- **Component name**: PascalCase with provider prefix (e.g., `KafkaEntityDetailsComponent`)
- **File name**: Kebab-case matching component name (e.g., `kafka-entity-details.component.ts`)

## Step-by-Step Implementation Guide

### Step 1: Add Provider Type to Enum

First, add your provider to the `ProviderType` enum:

**File**: `src/app/core/models/provider.model.ts`

```typescript
export enum ProviderType {
  AzureServiceBus = 0,
  RabbitMQ = 1,
  Kafka = 2  // Add your new provider here
}
```

### Step 2: Create Provider Directory Structure

Create the folder structure for your provider:

```bash
cd web-app/src/app/providers
mkdir -p kafka/components
mkdir -p kafka/models
mkdir -p kafka/services
```

### Step 3: Define Provider-Specific Models

Create models for your provider's entity types (queues, topics, exchanges, etc.):

**File**: `src/app/providers/kafka/models/kafka-topic.model.ts`

```typescript
/**
 * Represents a Kafka topic entity.
 */
export interface KafkaTopicInfo {
  name: string;
  partitionCount: number;
  replicationFactor: number;
  retentionMs: number;
  cleanupPolicy: 'delete' | 'compact';
  messageCount: number;
  sizeBytes: number;
  // Add Kafka-specific properties
}

/**
 * Type guard to check if an entity is a Kafka topic.
 */
export function isKafkaTopic(entity: any): entity is KafkaTopicInfo {
  return entity && 'partitionCount' in entity && 'replicationFactor' in entity;
}
```

### Step 4: Implement Entity Details Component

Create the main component that displays entity details:

**File**: `src/app/providers/kafka/components/kafka-entity-details.component.ts`

```typescript
import { Component, Input, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { IProviderEntityDetailsComponent, EntityInfo, EntityAction } from '../../../core/models/provider-component.interface';
import { ServiceBusConnection } from '../../../core/models/connection.model';
import { KafkaTopicInfo, isKafkaTopic } from '../models/kafka-topic.model';

/**
 * Kafka entity details component.
 * Displays Kafka-specific properties for topics and consumer groups.
 *
 * This component implements IProviderEntityDetailsComponent and is
 * dynamically loaded by ProviderShellComponent when a Kafka connection is active.
 */
@Component({
  selector: 'app-kafka-entity-details',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule
    // Add other Angular Material modules as needed
  ],
  templateUrl: './kafka-entity-details.component.html',
  styleUrls: ['./kafka-entity-details.component.scss']
})
export class KafkaEntityDetailsComponent implements IProviderEntityDetailsComponent, OnInit {
  /**
   * The entity to display (topic, consumer group, etc.).
   * Use type guards to narrow to specific Kafka entity types.
   */
  @Input() entity!: EntityInfo;

  /**
   * The active Kafka connection configuration.
   */
  @Input() connection!: ServiceBusConnection;

  /**
   * Emits when the entity should be refreshed.
   */
  @Output() onRefresh = new EventEmitter<void>();

  /**
   * Emits when an action is performed on the entity.
   */
  @Output() onAction = new EventEmitter<EntityAction>();

  ngOnInit(): void {
    // Validate entity type
    if (!this.isKafkaEntity()) {
      console.error('KafkaEntityDetailsComponent received non-Kafka entity:', this.entity);
    }
  }

  /**
   * Type guard to check if this is a Kafka entity.
   */
  private isKafkaEntity(): boolean {
    return isKafkaTopic(this.entity);
  }

  /**
   * Checks if the current entity is a topic.
   */
  isTopic(): boolean {
    return isKafkaTopic(this.entity);
  }

  /**
   * Gets the entity as a KafkaTopicInfo.
   */
  asTopic(): KafkaTopicInfo {
    return this.entity as KafkaTopicInfo;
  }

  /**
   * Handles refresh button click.
   */
  handleRefresh(): void {
    this.onRefresh.emit();
  }

  /**
   * Handles entity action (delete, send message, etc.).
   */
  handleAction(actionType: string): void {
    this.onAction.emit({
      actionType: actionType as any,
      entity: this.entity
    });
  }

  /**
   * Format bytes to human-readable format.
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }
}
```

### Step 5: Create Component Template

**File**: `src/app/providers/kafka/components/kafka-entity-details.component.html`

```html
<div class="kafka-entity-details" *ngIf="entity">
  <!-- Header Section -->
  <div class="entity-header">
    <div class="entity-title">
      <mat-icon>topic</mat-icon>
      <h2>{{ entity.name }}</h2>
    </div>
    <div class="entity-actions">
      <button mat-raised-button color="primary" (click)="handleRefresh()">
        <mat-icon>refresh</mat-icon>
        Refresh
      </button>
      <button mat-button (click)="handleAction('send')">
        <mat-icon>send</mat-icon>
        Send Message
      </button>
    </div>
  </div>

  <!-- Topic Details -->
  <div class="entity-body" *ngIf="isTopic()">
    <div class="stats-cards">
      <div class="stat-card">
        <div class="stat-label">Partitions</div>
        <div class="stat-value">{{ asTopic().partitionCount }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Replication Factor</div>
        <div class="stat-value">{{ asTopic().replicationFactor }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Messages</div>
        <div class="stat-value">{{ asTopic().messageCount | number }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Size</div>
        <div class="stat-value">{{ formatBytes(asTopic().sizeBytes) }}</div>
      </div>
    </div>

    <!-- Properties Grid -->
    <div class="properties-section">
      <h3>Configuration</h3>
      <div class="properties-grid">
        <div class="property-row">
          <span class="property-label">Cleanup Policy:</span>
          <span class="property-value">{{ asTopic().cleanupPolicy }}</span>
        </div>
        <div class="property-row">
          <span class="property-label">Retention:</span>
          <span class="property-value">{{ asTopic().retentionMs / 1000 / 60 / 60 }} hours</span>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Step 6: Add Component Styles

**File**: `src/app/providers/kafka/components/kafka-entity-details.component.scss`

```scss
.kafka-entity-details {
  padding: 1.5rem;
  background: var(--background-color);

  .entity-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid #e91e63; // Kafka theme color

    .entity-title {
      display: flex;
      align-items: center;
      gap: 0.75rem;

      mat-icon {
        font-size: 2rem;
        width: 2rem;
        height: 2rem;
        color: #e91e63;
      }

      h2 {
        margin: 0;
        font-size: 1.5rem;
        font-weight: 500;
      }
    }

    .entity-actions {
      display: flex;
      gap: 0.75rem;
    }
  }

  .stats-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;

    .stat-card {
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 1rem;
      text-align: center;

      .stat-label {
        font-size: 0.875rem;
        color: #666;
        margin-bottom: 0.5rem;
      }

      .stat-value {
        font-size: 1.5rem;
        font-weight: 600;
        color: #e91e63;
      }
    }
  }

  .properties-section {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 1.5rem;

    h3 {
      margin: 0 0 1rem 0;
      font-size: 1.125rem;
      font-weight: 500;
    }

    .properties-grid {
      display: grid;
      gap: 0.75rem;

      .property-row {
        display: flex;
        justify-content: space-between;
        padding: 0.5rem 0;
        border-bottom: 1px solid #f0f0f0;

        &:last-child {
          border-bottom: none;
        }

        .property-label {
          font-weight: 500;
          color: #666;
        }

        .property-value {
          color: #333;
        }
      }
    }
  }
}
```

### Step 7: Create Barrel Export

**File**: `src/app/providers/kafka/index.ts`

```typescript
export * from './components/kafka-entity-details.component';
```

### Step 8: Register Provider in Registry

Add your provider to the registry service:

**File**: `src/app/providers/provider-registry.service.ts`

```typescript
private registerProviders(): void {
  // Existing registrations...

  // Register Kafka provider
  import('../providers/kafka').then(module => {
    this.registerProvider({
      providerType: ProviderType.Kafka,
      entityDetailsComponent: module.KafkaEntityDetailsComponent
    });
  }).catch(error => {
    console.error('Failed to load Kafka provider module:', error);
  });
}
```

### Step 9: Update Entity Type Union (if needed)

If your provider introduces new entity types, update the `EntityInfo` union:

**File**: `src/app/core/models/provider-component.interface.ts`

```typescript
import { KafkaTopicInfo } from '../../providers/kafka/models/kafka-topic.model';

export type EntityInfo =
  | QueueInfo
  | TopicInfo
  | SubscriptionInfo
  | KafkaTopicInfo;  // Add your new entity type
```

## Testing Your Provider

### 1. TypeScript Compilation

Verify your code compiles without errors:

```bash
cd web-app
npx tsc --noEmit
```

### 2. Start Development Server

```bash
cd web-app
npm start
```

Navigate to `http://localhost:4200`

### 3. Manual Testing Checklist

- [ ] Create a connection to your messaging provider
- [ ] Select the connection (verify provider switch occurs)
- [ ] Navigate to entities view
- [ ] Verify your provider-specific component renders
- [ ] Check browser console for errors
- [ ] Test all action buttons (refresh, send, delete, etc.)
- [ ] Verify entity properties display correctly
- [ ] Switch to a different provider
- [ ] Switch back to your provider (verify hot-swap works)
- [ ] Check for memory leaks (use browser DevTools)

### 4. Provider Switching Test

Test the dynamic loading mechanism:

1. Connect to Azure Service Bus → Verify Azure component loads
2. Connect to RabbitMQ → Verify RabbitMQ component loads
3. Connect to your provider → Verify your component loads
4. Rapidly switch between providers → Verify no console errors
5. Check that old components are destroyed properly

### 5. Integration Testing

Ensure your provider integrates with shared components:

- [ ] Message editor works with your provider
- [ ] Filter panel works with your provider
- [ ] Bulk actions toolbar works with your provider
- [ ] Navigation between entities works correctly

## Best Practices

### Do's ✅

1. **Follow the Interface**: Always implement `IProviderEntityDetailsComponent`
2. **Use Type Guards**: Use type guards to safely narrow entity types
3. **Follow Angular 21 Patterns**: Use standalone components, `DestroyRef`, `takeUntilDestroyed()`
4. **Add JSDoc Comments**: Document all public methods and properties
5. **Emit Events**: Use `@Output()` events to communicate with parent components
6. **Keep It Isolated**: All provider-specific logic stays within your provider folder
7. **Reuse Shared Components**: Leverage existing shared components where possible
8. **Handle Errors Gracefully**: Add error boundaries and fallback UI
9. **Use Provider Theme Colors**: Choose a distinctive color for your provider's UI
10. **Clean Up Subscriptions**: Use `takeUntilDestroyed()` for proper cleanup

### Don'ts ❌

1. **Don't Modify Shared Components**: Keep shared components provider-agnostic
2. **Don't Import Other Providers**: No cross-provider dependencies
3. **Don't Use `any` Types**: Maintain type safety with proper interfaces
4. **Don't Skip Error Handling**: Always handle edge cases
5. **Don't Forget Lazy Loading**: Use barrel exports for code splitting
6. **Don't Hardcode Connection Logic**: Use the provided `connection` input
7. **Don't Create Global State**: Use Angular services for state management
8. **Don't Skip Cleanup**: Always clean up subscriptions and event listeners
9. **Don't Break Naming Conventions**: Follow established naming patterns
10. **Don't Skip Documentation**: Document your implementation thoroughly

## Common Patterns

### Type Guards for Entity Types

```typescript
export function isKafkaTopic(entity: any): entity is KafkaTopicInfo {
  return entity && 'partitionCount' in entity && 'replicationFactor' in entity;
}
```

### Conditional Rendering in Templates

```html
<div *ngIf="isTopic()">
  <h3>Topic: {{ asTopic().name }}</h3>
  <p>Partitions: {{ asTopic().partitionCount }}</p>
</div>
```

### Action Handlers

```typescript
handleAction(actionType: string, payload?: any): void {
  this.onAction.emit({
    actionType: actionType as any,
    entity: this.entity,
    payload
  });
}
```

### Proper Subscription Cleanup

```typescript
export class KafkaEntityDetailsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.someService.data$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(data => {
        // Handle data
      });
  }
}
```

## Troubleshooting

### Component Not Loading

**Symptom**: Your component doesn't appear when provider is selected

**Solutions**:
1. Verify `ProviderType` enum value is correct
2. Check registry registration in `provider-registry.service.ts`
3. Verify barrel export in `index.ts`
4. Check browser console for import errors
5. Ensure component implements `IProviderEntityDetailsComponent`

### TypeScript Compilation Errors

**Symptom**: `tsc --noEmit` fails with type errors

**Solutions**:
1. Verify interface implementation is complete
2. Check that all `@Input()` and `@Output()` decorators are present
3. Ensure entity types are properly defined
4. Verify imports are correct

### Provider Switch Doesn't Work

**Symptom**: Switching providers doesn't update the UI

**Solutions**:
1. Check that `ProviderService.providerState$` is emitting changes
2. Verify `ProviderShellComponent` subscription is active
3. Check for errors in browser console
4. Ensure `ProviderType` enum matches your provider

### Component Not Destroyed

**Symptom**: Memory leaks or duplicate event handlers

**Solutions**:
1. Use `takeUntilDestroyed(this.destroyRef)` for all subscriptions
2. Check that `ProviderShellComponent.loadProviderComponent()` calls `destroy()`
3. Verify event handlers are properly unsubscribed
4. Use Chrome DevTools Memory Profiler to identify leaks

### Styling Issues

**Symptom**: Component doesn't match application theme

**Solutions**:
1. Use CSS variables for colors: `var(--background-color)`
2. Follow existing component style patterns
3. Import Angular Material modules for consistent UI
4. Test in both light and dark themes (if applicable)

## Reference Implementations

Study these implementations for guidance:

- **Azure Service Bus**: `src/app/providers/azure-service-bus/`
  - Full-featured implementation with queues, topics, and subscriptions
  - Demonstrates session management and scheduled messages
  - Shows comprehensive property displays

- **RabbitMQ**: `src/app/providers/rabbitmq/`
  - Queue and exchange implementation
  - Demonstrates bindings and exchange types
  - Shows RabbitMQ-specific properties

- **Kafka**: `src/app/providers/kafka/`
  - Placeholder structure for future implementation
  - Use as a starting template for new providers

## Additional Resources

- **Provider Component Interface**: `src/app/core/models/provider-component.interface.ts`
- **Provider Registry Service**: `src/app/providers/provider-registry.service.ts`
- **Provider Shell Component**: `src/app/features/entities/provider-shell.component.ts`
- **Provider Model**: `src/app/core/models/provider.model.ts`

## Architecture Decisions

### Why Dynamic Loading?

Dynamic loading enables:
- **Code Splitting**: Provider modules are only loaded when needed
- **Bundle Size Optimization**: Initial load size is minimized
- **Runtime Flexibility**: Providers can be added without recompilation
- **Plugin Architecture**: Future support for third-party providers

### Why Provider Isolation?

Provider isolation ensures:
- **Maintainability**: Changes to one provider don't affect others
- **Team Scalability**: Multiple developers can work on different providers
- **Testing**: Providers can be tested independently
- **Stability**: Bugs in one provider don't crash others

### Why Interface Contracts?

Interface contracts provide:
- **Type Safety**: Compile-time checking prevents runtime errors
- **Consistency**: All providers have the same API
- **Documentation**: Interfaces serve as API documentation
- **Tooling Support**: IDEs can provide better autocomplete and validation

## Future Enhancements

Planned improvements to the provider system:

1. **Error Boundaries**: Catch and display provider-specific errors gracefully
2. **Provider Plugins**: Support for dynamically loaded third-party providers
3. **Provider Configuration UI**: Visual configuration for provider settings
4. **Provider Health Checks**: Real-time monitoring of provider availability
5. **Provider Metrics**: Performance and usage metrics per provider

---

**Questions?** Contact the development team or open an issue on the project repository.

**Last Updated**: 2026-02-03
