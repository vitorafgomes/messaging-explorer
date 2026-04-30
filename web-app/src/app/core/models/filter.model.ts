/**
 * Defines the supported filter operators for message filtering.
 */
export enum FilterOperator {
  Equals = 0,
  Contains = 1,
  StartsWith = 2,
  EndsWith = 3,
  Regex = 4,
  IsEmpty = 5,
  IsNotEmpty = 6
}

/**
 * Represents a single filter condition to be applied to messages.
 */
export interface FilterCondition {
  /**
   * Unique identifier for this filter condition.
   */
  id: string;

  /**
   * The message property to filter on (e.g., 'messageId', 'correlationId', 'subject').
   */
  property: string;

  /**
   * The operator to apply for this condition.
   */
  operator: FilterOperator;

  /**
   * The value to compare against.
   * Not required for IsEmpty and IsNotEmpty operators.
   */
  value?: string;
}

/**
 * Gets the display label for a filter operator.
 */
export function getFilterOperatorLabel(operator: FilterOperator): string {
  switch (operator) {
    case FilterOperator.Equals:
      return 'Equals';
    case FilterOperator.Contains:
      return 'Contains';
    case FilterOperator.StartsWith:
      return 'Starts With';
    case FilterOperator.EndsWith:
      return 'Ends With';
    case FilterOperator.Regex:
      return 'Regex';
    case FilterOperator.IsEmpty:
      return 'Is Empty';
    case FilterOperator.IsNotEmpty:
      return 'Is Not Empty';
    default:
      return 'Unknown Operator';
  }
}

/**
 * Gets all available filter operators with their labels.
 */
export function getAvailableFilterOperators(): Array<{ value: FilterOperator; label: string }> {
  return [
    { value: FilterOperator.Equals, label: getFilterOperatorLabel(FilterOperator.Equals) },
    { value: FilterOperator.Contains, label: getFilterOperatorLabel(FilterOperator.Contains) },
    { value: FilterOperator.StartsWith, label: getFilterOperatorLabel(FilterOperator.StartsWith) },
    { value: FilterOperator.EndsWith, label: getFilterOperatorLabel(FilterOperator.EndsWith) },
    { value: FilterOperator.Regex, label: getFilterOperatorLabel(FilterOperator.Regex) },
    { value: FilterOperator.IsEmpty, label: getFilterOperatorLabel(FilterOperator.IsEmpty) },
    { value: FilterOperator.IsNotEmpty, label: getFilterOperatorLabel(FilterOperator.IsNotEmpty) }
  ];
}

/**
 * Checks if the operator requires a value input.
 */
export function operatorRequiresValue(operator: FilterOperator): boolean {
  return operator !== FilterOperator.IsEmpty && operator !== FilterOperator.IsNotEmpty;
}

/**
 * Defines the logical operator to combine multiple filter conditions.
 */
export enum FilterLogic {
  And = 'AND',
  Or = 'OR'
}

/**
 * Defines the available message properties that can be filtered.
 * Special value 'customProperty' indicates a custom application property.
 */
export type FilterProperty =
  | 'messageId'
  | 'correlationId'
  | 'subject'
  | 'contentType'
  | 'sessionId'
  | 'partitionKey'
  | 'replyTo'
  | 'to'
  | 'body'
  | 'sequenceNumber'
  | 'deliveryCount'
  | 'enqueuedTime'
  | 'deadLetterReason'
  | 'deadLetterErrorDescription'
  | 'customProperty';

/**
 * Holds the complete state of advanced filtering with multiple conditions.
 */
export interface AdvancedFilterState {
  /**
   * Array of filter conditions to apply.
   */
  conditions: FilterCondition[];

  /**
   * The logical operator to combine multiple conditions.
   * AND: All conditions must match
   * OR: At least one condition must match
   */
  logicOperator: FilterLogic;
}

/**
 * Gets all available filter properties with their display labels.
 */
export function getAvailableFilterProperties(): Array<{ value: FilterProperty; label: string }> {
  return [
    { value: 'messageId', label: 'Message ID' },
    { value: 'correlationId', label: 'Correlation ID' },
    { value: 'subject', label: 'Subject/Label' },
    { value: 'contentType', label: 'Content Type' },
    { value: 'sessionId', label: 'Session ID' },
    { value: 'partitionKey', label: 'Partition Key' },
    { value: 'replyTo', label: 'Reply To' },
    { value: 'to', label: 'To' },
    { value: 'body', label: 'Message Body' },
    { value: 'sequenceNumber', label: 'Sequence Number' },
    { value: 'deliveryCount', label: 'Delivery Count' },
    { value: 'enqueuedTime', label: 'Enqueued Time' },
    { value: 'deadLetterReason', label: 'Dead Letter Reason' },
    { value: 'deadLetterErrorDescription', label: 'Dead Letter Description' },
    { value: 'customProperty', label: 'Custom Property' }
  ];
}

/**
 * Gets the display label for a filter property.
 */
export function getFilterPropertyLabel(property: FilterProperty): string {
  const properties = getAvailableFilterProperties();
  const found = properties.find(p => p.value === property);
  return found ? found.label : property;
}
