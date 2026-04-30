import { Injectable } from '@angular/core';
import { MessageInfo } from '../models';
import {
  FilterCondition,
  FilterOperator,
  FilterLogic,
  AdvancedFilterState
} from '../models/filter.model';
import { MessageSearchService } from './message-search.service';

/**
 * Service for advanced message filtering with multiple conditions, AND/OR logic,
 * and session persistence support
 */
@Injectable({
  providedIn: 'root',
})
export class AdvancedMessageFilterService {
  private readonly STORAGE_KEY_PREFIX = 'advanced-filter-';

  constructor(private messageSearchService: MessageSearchService) {}

  /**
   * Filters messages based on the provided filter state with multiple conditions
   *
   * @param messages - Array of messages to filter
   * @param filterState - Filter state containing conditions and logic operator
   * @returns Filtered array of messages matching the filter criteria
   */
  filterMessages(messages: MessageInfo[], filterState: AdvancedFilterState): MessageInfo[] {
    // If no conditions, return all messages
    if (!filterState.conditions || filterState.conditions.length === 0) {
      return messages;
    }

    return messages.filter(message => this.evaluateMessage(message, filterState));
  }

  /**
   * Evaluates if a message matches the filter state
   *
   * @param message - Message to evaluate
   * @param filterState - Filter state to evaluate against
   * @returns True if message matches the filter criteria
   */
  private evaluateMessage(message: MessageInfo, filterState: AdvancedFilterState): boolean {
    const { conditions, logicOperator } = filterState;

    if (logicOperator === FilterLogic.And) {
      // AND logic: all conditions must match
      return conditions.every(condition => this.evaluateCondition(message, condition));
    } else {
      // OR logic: at least one condition must match
      return conditions.some(condition => this.evaluateCondition(message, condition));
    }
  }

  /**
   * Evaluates if a message matches a single filter condition
   *
   * @param message - Message to evaluate
   * @param condition - Filter condition to evaluate
   * @returns True if message matches the condition
   */
  private evaluateCondition(message: MessageInfo, condition: FilterCondition): boolean {
    // Get the property value from the message
    const propertyValue = this.getPropertyValue(message, condition.property);

    // Handle isEmpty and isNotEmpty operators
    if (condition.operator === FilterOperator.IsEmpty) {
      return !propertyValue || propertyValue.trim() === '';
    }

    if (condition.operator === FilterOperator.IsNotEmpty) {
      return !!propertyValue && propertyValue.trim() !== '';
    }

    // For other operators, we need a value to compare
    if (!condition.value) {
      return false;
    }

    // If property value is empty, it doesn't match any comparison operator
    if (!propertyValue) {
      return false;
    }

    // Evaluate based on operator
    switch (condition.operator) {
      case FilterOperator.Equals:
        return propertyValue.toLowerCase() === condition.value.toLowerCase();

      case FilterOperator.Contains:
        return propertyValue.toLowerCase().includes(condition.value.toLowerCase());

      case FilterOperator.StartsWith:
        return propertyValue.toLowerCase().startsWith(condition.value.toLowerCase());

      case FilterOperator.EndsWith:
        return propertyValue.toLowerCase().endsWith(condition.value.toLowerCase());

      case FilterOperator.Regex:
        return this.evaluateRegex(propertyValue, condition.value);

      default:
        return false;
    }
  }

  /**
   * Evaluates a regex pattern against a value
   *
   * @param value - Value to test
   * @param pattern - Regex pattern
   * @returns True if value matches the pattern
   */
  private evaluateRegex(value: string, pattern: string): boolean {
    // Use MessageSearchService for regex validation
    if (!this.messageSearchService.isValidRegex(pattern)) {
      return false;
    }

    try {
      const regex = new RegExp(pattern, 'i'); // Case-insensitive by default
      return regex.test(value);
    } catch {
      return false;
    }
  }

  /**
   * Gets the value of a specific property from a message
   * Handles both standard message properties and custom application properties
   *
   * @param message - Message to extract property from
   * @param property - Property name (can be 'customProperty:propertyName' for custom props)
   * @returns Property value as string
   */
  private getPropertyValue(message: MessageInfo, property: string): string {
    // Check if this is a custom property (format: 'customProperty:actualPropertyName')
    if (property.startsWith('customProperty:')) {
      const customPropertyName = property.substring('customProperty:'.length);
      return this.getCustomPropertyValue(message, customPropertyName);
    }

    // Standard message properties
    switch (property) {
      case 'messageId':
        return message.messageId || '';
      case 'correlationId':
        return message.correlationId || '';
      case 'sessionId':
        return message.sessionId || '';
      case 'subject':
        return message.subject || '';
      case 'contentType':
        return message.contentType || '';
      case 'partitionKey':
        return message.partitionKey || '';
      case 'replyTo':
        return message.replyTo || '';
      case 'to':
        return message.to || '';
      case 'body':
        return message.body || '';
      case 'sequenceNumber':
        return message.sequenceNumber?.toString() || '';
      case 'deliveryCount':
        return message.deliveryCount?.toString() || '';
      case 'enqueuedTime':
        return message.enqueuedTime ? message.enqueuedTime.toISOString() : '';
      case 'deadLetterReason':
        return message.deadLetterReason || '';
      case 'deadLetterErrorDescription':
        return message.deadLetterErrorDescription || '';
      default:
        return '';
    }
  }

  /**
   * Gets a custom application property value from a message
   *
   * @param message - Message to extract property from
   * @param propertyName - Name of the custom property
   * @returns Property value as string
   */
  private getCustomPropertyValue(message: MessageInfo, propertyName: string): string {
    if (!message.applicationProperties || !propertyName) {
      return '';
    }

    const value = message.applicationProperties[propertyName];
    return value !== null && value !== undefined ? value.toString() : '';
  }

  /**
   * Saves filter state to session storage for a specific entity
   *
   * @param entityType - Type of entity (queue/subscription)
   * @param entityName - Name of the entity
   * @param filterState - Filter state to save
   */
  saveFilterState(entityType: string, entityName: string, filterState: AdvancedFilterState): void {
    const key = this.getStorageKey(entityType, entityName);
    try {
      sessionStorage.setItem(key, JSON.stringify(filterState));
    } catch (error) {
      console.warn('Failed to save filter state to session storage:', error);
    }
  }

  /**
   * Loads filter state from session storage for a specific entity
   *
   * @param entityType - Type of entity (queue/subscription)
   * @param entityName - Name of the entity
   * @returns Filter state if found, or default empty state
   */
  loadFilterState(entityType: string, entityName: string): AdvancedFilterState {
    const key = this.getStorageKey(entityType, entityName);
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load filter state from session storage:', error);
    }

    // Return default empty state
    return {
      conditions: [],
      logicOperator: FilterLogic.And
    };
  }

  /**
   * Clears filter state from session storage for a specific entity
   *
   * @param entityType - Type of entity (queue/subscription)
   * @param entityName - Name of the entity
   */
  clearFilterState(entityType: string, entityName: string): void {
    const key = this.getStorageKey(entityType, entityName);
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      console.warn('Failed to clear filter state from session storage:', error);
    }
  }

  /**
   * Generates a storage key for a specific entity
   *
   * @param entityType - Type of entity (queue/subscription)
   * @param entityName - Name of the entity
   * @returns Storage key
   */
  private getStorageKey(entityType: string, entityName: string): string {
    return `${this.STORAGE_KEY_PREFIX}${entityType}-${entityName}`;
  }

  /**
   * Extracts all unique custom property names from a set of messages
   *
   * @param messages - Array of messages to extract properties from
   * @returns Array of unique custom property names
   */
  extractCustomPropertyNames(messages: MessageInfo[]): string[] {
    const propertyNames = new Set<string>();

    messages.forEach(message => {
      if (message.applicationProperties) {
        Object.keys(message.applicationProperties).forEach(key => {
          propertyNames.add(key);
        });
      }
    });

    return Array.from(propertyNames).sort();
  }
}
