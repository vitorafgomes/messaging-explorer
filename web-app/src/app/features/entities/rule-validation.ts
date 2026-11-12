import { CorrelationFilter, RuleFilterType, RulePropertyType, SubscriptionRuleInfo, SubscriptionRuleWrite } from '../../core/models';

export type SystemField = Exclude<keyof CorrelationFilter, 'applicationProperties'>;

/** The eight system fields of a correlation filter, in the order the form shows them. */
export const SYSTEM_FIELDS: readonly { key: SystemField; label: string }[] = [
  { key: 'subject', label: 'Subject' },
  { key: 'correlationId', label: 'Correlation id' },
  { key: 'messageId', label: 'Message id' },
  { key: 'to', label: 'To' },
  { key: 'replyTo', label: 'Reply to' },
  { key: 'sessionId', label: 'Session id' },
  { key: 'replyToSessionId', label: 'Reply to session id' },
  { key: 'contentType', label: 'Content type' }
];

export const PROPERTY_TYPES: readonly RulePropertyType[] = ['String', 'Int64', 'Double', 'Boolean'];

/** A rule as the form holds it: every field a string, empty meaning not set. */
export interface RuleDraft {
  name: string;
  filterType: RuleFilterType;
  sqlExpression: string;
  sqlAction: string;
  correlation: Record<SystemField, string>;
  properties: { name: string; type: RulePropertyType; value: string }[];
}

const RULE_NAME = /^(?:[A-Za-z0-9._-]{1,50}|\$Default)$/;
const INT64 = /^-?\d+$/;
const DOUBLE = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const MAX_SQL = 1024;
const MAX_FIELD = 128;

const VALUE_RULES: Record<RulePropertyType, { valid: (value: string) => boolean; message: string }> = {
  String: { valid: () => true, message: '' },
  Int64: {
    valid: value => INT64.test(value) && BigInt(value) >= -(2n ** 63n) && BigInt(value) < 2n ** 63n,
    message: 'An Int64 is a whole number from -9223372036854775808 to 9223372036854775807.'
  },
  Double: { valid: value => DOUBLE.test(value), message: 'A Double is a number such as 2.5 or -1E+20.' },
  Boolean: { valid: value => value === 'true' || value === 'false', message: 'A Boolean is true or false.' }
};

export function emptyDraft(): RuleDraft {
  return {
    name: '',
    filterType: 'Sql',
    sqlExpression: '',
    sqlAction: '',
    correlation: Object.fromEntries(SYSTEM_FIELDS.map(f => [f.key, ''])) as Record<SystemField, string>,
    properties: []
  };
}

/**
 * The errors of a rule against the contract, keyed by field path (`name`, `sqlExpression`, `sqlAction`,
 * `correlation`, `correlation.<field>`, `properties.<i>.name`, `properties.<i>.value`). Only the fields
 * the chosen filter kind sends are checked. The server stays the authority.
 */
export function ruleErrors(draft: RuleDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.name) errors['name'] = 'A name is required.';
  else if (!RULE_NAME.test(draft.name)) errors['name'] = 'Use 1 to 50 letters, digits, ".", "-" or "_"; $Default is the only name with "$".';
  if (draft.sqlAction.length > MAX_SQL) errors['sqlAction'] = `The action must be at most ${MAX_SQL} characters.`;

  if (draft.filterType === 'Sql') {
    if (!draft.sqlExpression) errors['sqlExpression'] = 'A SQL filter needs an expression.';
    else if (draft.sqlExpression.length > MAX_SQL) errors['sqlExpression'] = `The SQL filter must be at most ${MAX_SQL} characters.`;
  }

  if (draft.filterType === 'Correlation') {
    for (const f of SYSTEM_FIELDS) {
      if (draft.correlation[f.key].length > MAX_FIELD) errors[`correlation.${f.key}`] = `${f.label} must be at most ${MAX_FIELD} characters.`;
    }
    draft.properties.forEach((p, i) => {
      if (!p.name) errors[`properties.${i}.name`] = 'A property name is required.';
      else if (p.name.length > MAX_FIELD) errors[`properties.${i}.name`] = `A property name must be at most ${MAX_FIELD} characters.`;
      else if (draft.properties.some((other, j) => j !== i && other.name === p.name)) errors[`properties.${i}.name`] = 'Another property has this name.';
      const rule = VALUE_RULES[p.type];
      if (!rule.valid(p.value)) errors[`properties.${i}.value`] = rule.message;
    });
    if (!draft.properties.length && SYSTEM_FIELDS.every(f => !draft.correlation[f.key])) {
      errors['correlation'] = 'A correlation filter needs at least one field or property.';
    }
  }
  return errors;
}

/** The contract's rule for a draft: every key present, null for what the filter kind does not send or the user left empty. */
export function toWire(draft: RuleDraft): SubscriptionRuleWrite {
  return {
    name: draft.name,
    filterType: draft.filterType,
    sqlExpression: draft.filterType === 'Sql' ? draft.sqlExpression : null,
    correlation: draft.filterType === 'Correlation'
      ? {
        ...Object.fromEntries(SYSTEM_FIELDS.map(f => [f.key, draft.correlation[f.key] || null])) as Record<SystemField, string | null>,
        applicationProperties: draft.properties.map(p => ({ name: p.name, type: p.type, value: p.value }))
      }
      : null,
    sqlAction: draft.sqlAction || null
  };
}

/** The text of a rule's filter in one line: the SQL, the correlation fields and properties that are set, or what True and False match. */
export function describeFilter(rule: SubscriptionRuleInfo): string {
  switch (rule.filterType) {
    case 'True': return 'Matches every message';
    case 'False': return 'Matches no message';
    case 'Correlation': {
      const c = rule.correlation;
      const fields = SYSTEM_FIELDS.filter(f => c?.[f.key]).map(f => `${f.label} = ${c![f.key]}`);
      const properties = (c?.applicationProperties ?? []).map(p => `${p.name} = ${p.value}`);
      return [...fields, ...properties].join(', ');
    }
    default: return rule.sqlExpression ?? '';
  }
}

/** The draft of a stored rule; the caller checks first that it holds no `Other` property. */
export function fromRule(rule: SubscriptionRuleInfo): RuleDraft {
  return {
    name: rule.name,
    filterType: rule.filterType as RuleFilterType,
    sqlExpression: rule.sqlExpression ?? '',
    sqlAction: rule.sqlAction ?? '',
    correlation: Object.fromEntries(SYSTEM_FIELDS.map(f => [f.key, rule.correlation?.[f.key] ?? ''])) as Record<SystemField, string>,
    properties: (rule.correlation?.applicationProperties ?? []).map(p => ({ name: p.name, type: p.type as RulePropertyType, value: p.value }))
  };
}
