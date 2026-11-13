/**
 * A definitions document as the API writes it: the queues, topics, subscriptions and rules of a namespace with their
 * settings, and no secret. Read from a file it is sent back to the API unchanged, which checks it.
 */
export interface EntityDefinitionsDocument {
  version?: number;
  exportedAt?: string;
  entities?: {
    queues?: ({ name?: string } | null)[] | null;
    topics?: ({ name?: string; subscriptions?: ({ name?: string; rules?: unknown[] | null } | null)[] | null } | null)[] | null;
  } | null;
}

export type DefinitionEntityKind = 'Queue' | 'Topic' | 'Subscription';

/** A dry run answers Create, Exists or Differs; an import answers Created, Exists, Differs or Failed. */
export type DefinitionImportOutcome = 'Create' | 'Created' | 'Exists' | 'Differs' | 'Failed';

export interface DefinitionImportItem {
  kind: DefinitionEntityKind;
  name: string;
  /** The topic of a subscription. */
  topic: string | null;
  outcome: DefinitionImportOutcome;
  /** For Differs: the settings that differ, as the document names them. */
  differingFields: string[] | null;
  /** For Failed, or an entity created by someone else during the import: a fixed text from the API. */
  reason: string | null;
}

export interface DefinitionsImportResult {
  dryRun: boolean;
  items: DefinitionImportItem[];
}

export interface DefinitionCounts {
  queues: number;
  topics: number;
  subscriptions: number;
  rules: number;
}
