import { Component, computed, inject, signal } from '@angular/core';
import { formatDate } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { DefinitionsService } from '../../core/services/definitions.service';
import { ProviderService } from '../../core/services/provider.service';
import { NamespaceInfo } from '../../core/models';

type Read = { status: 'loading' } | { status: 'ready'; info: NamespaceInfo } | { status: 'failed' };

/** "256 KB", "100 MB": the size limits the broker sets are whole kilobytes or megabytes. */
function size(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${bytes / (1024 * 1024)} MB` : `${bytes / 1024} KB`;
}

/**
 * The facts of the connected namespace under the panel's empty state: tier, messaging units, geo-DR alias, when it was
 * created and its largest message. Read once when shown; leaving the empty state cancels the read. A failed read says
 * so and shows only the provider's default size limit, named as the default, never a tier it did not read.
 */
@Component({
  selector: 'app-namespace-properties',
  standalone: true,
  imports: [MatIconModule],
  template: `
    @switch (read().status) {
      @case ('loading') {
        <p class="note" role="status">Reading the namespace properties</p>
      }
      @case ('failed') {
        <p class="error" role="alert">
          <mat-icon fontIcon="error" aria-hidden="true" />
          <span>The namespace properties could not be read. Reading them needs the Manage right on the namespace.</span>
        </p>
      }
    }
    @if (facts().length) {
      <dl class="facts" aria-label="Namespace properties">
        @for (fact of facts(); track fact.label) {
          <div><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></div>
        }
      </dl>
    }
  `,
  styles: [`
    :host { display: block; width: 100%; max-width: 480px; }
    .note { margin: 0; color: var(--mat-sys-on-surface-variant); }
    .error { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 8px; color: var(--mat-sys-error); }
    .facts { margin: 8px 0 0; border-top: 1px solid var(--mat-sys-outline-variant); text-align: start; }
    .facts div { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .facts dt { flex: 0 0 40%; color: var(--mat-sys-on-surface-variant); }
    .facts dd { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; }
  `]
})
export class NamespacePropertiesComponent {
  private readonly providerService = inject(ProviderService);
  readonly read = signal<Read>({ status: 'loading' });

  /** What the read gave, in the order the panel lists it; on a failure only the default size limit, said to be one. */
  readonly facts = computed(() => {
    const read = this.read();
    if (read.status === 'failed') {
      const fallback = this.providerService.capabilities()?.maxMessageSizeInBytes;
      return fallback ? [{ label: 'Max message size', value: `${size(fallback)}, the default limit: the tier could not be read` }] : [];
    }
    if (read.status !== 'ready') return [];
    const { info } = read;
    return [
      { label: 'Tier', value: info.tier },
      ...(info.messagingUnits != null ? [{ label: 'Messaging units', value: `${info.messagingUnits}` }] : []),
      ...(info.alias ? [{ label: 'Geo-DR alias', value: info.alias }] : []),
      { label: 'Created', value: formatDate(info.createdTime, 'medium', 'en-US', 'UTC') },
      {
        label: 'Max message size',
        value: info.tier === 'Premium' ? `Up to ${size(info.maxMessageSizeInBytes)}, set on each queue and topic` : size(info.maxMessageSizeInBytes)
      }
    ];
  });

  constructor() {
    inject(DefinitionsService).properties().pipe(takeUntilDestroyed()).subscribe({
      next: info => this.read.set({ status: 'ready', info }),
      error: () => this.read.set({ status: 'failed' })
    });
  }
}
