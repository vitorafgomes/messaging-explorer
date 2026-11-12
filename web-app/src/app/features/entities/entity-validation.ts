import { EntityKind } from '../../core/models';

const QUEUE_OR_TOPIC_NAME = /^(?!\/)[A-Za-z0-9._\-/]{1,260}(?<!\/)$/;
const SUBSCRIPTION_NAME = /^[A-Za-z0-9._-]{1,50}$/;

const QUEUE_OR_TOPIC_RULE = 'Use 1 to 260 letters, digits, ".", "-", "_" or "/", not starting or ending with "/".';
const SUBSCRIPTION_RULE = 'Use 1 to 50 letters, digits, ".", "-" or "_".';

interface Range {
  min: number;
  max: number;
  whole?: boolean;
  message: string;
}

/** The limits of the contract, in seconds for durations; the server stays the authority. */
const RANGES: Record<string, Range> = {
  lockDuration: { min: 5, max: 300, message: 'Lock duration must be between 5 seconds and 5 minutes.' },
  maxDeliveryCount: { min: 1, max: 2000, whole: true, message: 'Max delivery count must be between 1 and 2000.' },
  defaultMessageTimeToLive: { min: 1, max: Infinity, message: 'Message time to live must be at least 1 second.' },
  autoDeleteOnIdle: { min: 300, max: Infinity, message: 'Auto delete on idle must be at least 5 minutes.' },
  duplicateDetectionHistoryTimeWindow: { min: 20, max: 7 * 86400, message: 'Duplicate detection window must be between 20 seconds and 7 days.' },
  maxSizeInMegabytes: { min: 1, max: Infinity, whole: true, message: 'Max size must be a positive whole number of megabytes.' }
};

const MAX_METADATA = 1024;

/** The error of an entity name, or null when the API will accept it. */
export function nameError(kind: EntityKind, name: string): string | null {
  if (!name) return 'A name is required.';
  if (kind === 'subscription') return SUBSCRIPTION_NAME.test(name) ? null : SUBSCRIPTION_RULE;
  return QUEUE_OR_TOPIC_NAME.test(name) ? null : QUEUE_OR_TOPIC_RULE;
}

/** The error of a field value (seconds for a duration), naming the allowed range; null when empty or valid. */
export function fieldError(field: string, value: number | string | null): string | null {
  if (value === null || value === '') return null;
  if (field === 'userMetadata') {
    return String(value).length > MAX_METADATA ? `User metadata must be at most ${MAX_METADATA} characters.` : null;
  }
  const range = RANGES[field];
  if (!range) return null;
  const n = Number(value);
  const valid = Number.isFinite(n) && n >= range.min && n <= range.max && (!range.whole || Number.isInteger(n));
  return valid ? null : range.message;
}

/** A forward target must be one of the loaded queues or topics and not the entity itself; empty means none. */
export function forwardTargetError(target: string, loadedNames: readonly string[], self: string | null): string | null {
  if (!target) return null;
  return target !== self && loadedNames.includes(target) ? null : 'Choose a queue or topic other than this one.';
}
