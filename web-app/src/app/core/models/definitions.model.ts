/**
 * A definitions document as the API writes it: the queues, topics, subscriptions and rules of a namespace with their
 * settings, and no secret. Read from a file it is sent back to the API unchanged, which checks it.
 */
export interface EntityDefinitionsDocument {
  version?: number;
  exportedAt?: string;
  /** The namespace or host the export was read from, as the app shows the connection target; absent from older files. */
  source?: string;
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
  /** For Differs: each setting of differingFields, in its order, with its value on the broker and in the file. */
  differences?: DefinitionFieldDifference[] | null;
  /** For Failed, or an entity created by someone else during the import: a fixed text from the API. */
  reason: string | null;
}

/** One setting that differs; the rules of a subscription are one setting, 'rules', given without values. */
export interface DefinitionFieldDifference {
  field: string;
  current: unknown;
  inFile: unknown;
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

/** The connected namespace as GET namespace/properties reads it; a field the broker did not give is null. */
export interface NamespaceInfo {
  name: string;
  /** Basic, Standard or Premium. */
  tier: string;
  /** The messaging units of a Premium namespace; null on any other tier. */
  messagingUnits: number | null;
  /** The geo-disaster-recovery alias; null when the namespace has none. */
  alias: string | null;
  createdTime: string;
  modifiedTime: string;
  /** 256 KB on Basic and Standard; on Premium the most a queue or a topic can be set to, 100 MB. */
  maxMessageSizeInBytes: number;
}
