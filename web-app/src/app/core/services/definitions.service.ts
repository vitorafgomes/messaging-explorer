import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { DefinitionCounts, DefinitionsImportResult, EntityDefinitionsDocument } from '../models';

/**
 * The definitions of the connected namespace: export to one document, a dry run of an import, and the import itself,
 * which creates only what does not exist.
 */
@Injectable({
  providedIn: 'root'
})
export class DefinitionsService {
  private api = inject(ApiService);

  export(): Observable<EntityDefinitionsDocument> {
    return this.api.post<EntityDefinitionsDocument>('namespace/export', {});
  }

  dryRun(document: unknown): Observable<DefinitionsImportResult> {
    return this.api.post<DefinitionsImportResult>('namespace/import?dryRun=true', document);
  }

  import(document: unknown): Observable<DefinitionsImportResult> {
    return this.api.post<DefinitionsImportResult>('namespace/import?dryRun=false', document);
  }
}

/** How many queues, topics, subscriptions and rules a document holds; a missing list counts as none. */
export function countDefinitions(document: EntityDefinitionsDocument | null | undefined): DefinitionCounts {
  const topics = (document?.entities?.topics ?? []).filter(t => !!t);
  const subscriptions = topics.flatMap(t => (t!.subscriptions ?? []).filter(s => !!s));
  return {
    queues: (document?.entities?.queues ?? []).filter(q => !!q).length,
    topics: topics.length,
    subscriptions: subscriptions.length,
    rules: subscriptions.reduce((sum, s) => sum + (s!.rules?.length ?? 0), 0)
  };
}

/** "4 queues, 1 topic, 2 subscriptions, 3 rules". */
export function describeCounts(counts: DefinitionCounts): string {
  const part = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  return [part(counts.queues, 'queue'), part(counts.topics, 'topic'), part(counts.subscriptions, 'subscription'), part(counts.rules, 'rule')].join(', ');
}
