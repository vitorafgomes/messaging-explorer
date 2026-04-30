import { Injectable } from '@angular/core';
import { MessageInfo } from '../models';

/**
 * Search mode options
 */
export type SearchMode = 'text' | 'regex';

/**
 * Options for search configuration
 */
export interface SearchOptions {
  /**
   * Search mode: 'text' for plain text search, 'regex' for regular expression search
   */
  mode: SearchMode;

  /**
   * Whether the search should be case-sensitive (default: false)
   */
  caseSensitive?: boolean;

  /**
   * If specified, search only in this property
   */
  property?: string | null;
}

/**
 * Represents a single match found in the text
 */
export interface SearchMatch {
  /**
   * Start position of the match in the text
   */
  start: number;

  /**
   * End position of the match in the text
   */
  end: number;

  /**
   * The matched text
   */
  text: string;
}

/**
 * Service for searching and filtering messages with support for plain text and regex patterns
 */
@Injectable({
  providedIn: 'root',
})
export class MessageSearchService {
  /**
   * Searches messages based on the provided query and options
   *
   * @param messages - Array of messages to search
   * @param query - Search query string
   * @param options - Search configuration options
   * @returns Filtered array of messages that match the search criteria
   */
  searchMessages(
    messages: MessageInfo[],
    query: string,
    options: SearchOptions = { mode: 'text' }
  ): MessageInfo[] {
    if (!query || query.trim() === '') {
      return messages;
    }

    // Validate regex pattern if in regex mode
    if (options.mode === 'regex' && !this.isValidRegex(query)) {
      return [];
    }

    const searchText = options.caseSensitive ? query : query.toLowerCase();
    const filterProp = options.property;

    return messages.filter(msg => {
      // If a specific property is selected, search only in that property
      if (filterProp) {
        const value = this.getPropertyValue(msg, filterProp);
        return this.matchesQuery(value, searchText, options);
      }

      // Otherwise, search in all relevant fields
      return (
        this.matchesQuery(msg.messageId || '', searchText, options) ||
        this.matchesQuery(msg.correlationId || '', searchText, options) ||
        this.matchesQuery(msg.sessionId || '', searchText, options) ||
        this.matchesQuery(msg.subject || '', searchText, options) ||
        this.matchesQuery(msg.contentType || '', searchText, options) ||
        this.matchesQuery(msg.body || '', searchText, options) ||
        this.matchesQuery(msg.sequenceNumber?.toString() || '', searchText, options) ||
        this.matchesQuery(msg.deadLetterReason || '', searchText, options) ||
        this.matchesQuery(msg.deadLetterErrorDescription || '', searchText, options) ||
        this.searchInApplicationProperties(msg.applicationProperties, searchText, options)
      );
    });
  }

  /**
   * Validates if a string is a valid regular expression pattern
   *
   * @param pattern - The regex pattern to validate
   * @returns True if the pattern is valid, false otherwise
   */
  isValidRegex(pattern: string): boolean {
    try {
      new RegExp(pattern);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Finds all matches in a text for the given query
   *
   * @param text - Text to search in
   * @param query - Search query
   * @param options - Search options
   * @returns Array of search matches with positions
   */
  findMatches(
    text: string,
    query: string,
    options: SearchOptions = { mode: 'text' }
  ): SearchMatch[] {
    if (!query || !text) {
      return [];
    }

    const matches: SearchMatch[] = [];

    if (options.mode === 'regex') {
      if (!this.isValidRegex(query)) {
        return [];
      }

      try {
        const flags = options.caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(query, flags);
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
          matches.push({
            start: match.index,
            end: match.index + match[0].length,
            text: match[0]
          });

          // Prevent infinite loop on zero-length matches
          if (match.index === regex.lastIndex) {
            regex.lastIndex++;
          }
        }
      } catch {
        return [];
      }
    } else {
      // Plain text search
      const searchText = options.caseSensitive ? query : query.toLowerCase();
      const textToSearch = options.caseSensitive ? text : text.toLowerCase();

      let index = textToSearch.indexOf(searchText);
      while (index !== -1) {
        matches.push({
          start: index,
          end: index + query.length,
          text: text.substring(index, index + query.length)
        });
        index = textToSearch.indexOf(searchText, index + 1);
      }
    }

    return matches;
  }

  /**
   * Gets the value of a specific property from a message
   *
   * @param msg - Message to extract property from
   * @param property - Property name
   * @returns Property value as string
   */
  private getPropertyValue(msg: MessageInfo, property: string): string {
    switch (property) {
      case 'messageId':
        return msg.messageId || '';
      case 'correlationId':
        return msg.correlationId || '';
      case 'sessionId':
        return msg.sessionId || '';
      case 'subject':
        return msg.subject || '';
      case 'contentType':
        return msg.contentType || '';
      case 'body':
        return msg.body || '';
      case 'sequenceNumber':
        return msg.sequenceNumber?.toString() || '';
      case 'deadLetterReason':
        return msg.deadLetterReason || '';
      case 'deadLetterErrorDescription':
        return msg.deadLetterErrorDescription || '';
      default:
        return '';
    }
  }

  /**
   * Checks if a value matches the search query based on the search mode
   *
   * @param value - Value to check
   * @param query - Search query
   * @param options - Search options
   * @returns True if the value matches the query
   */
  private matchesQuery(value: string, query: string, options: SearchOptions): boolean {
    if (!value) {
      return false;
    }

    const textToSearch = options.caseSensitive ? value : value.toLowerCase();
    const searchText = options.caseSensitive ? query : query.toLowerCase();

    if (options.mode === 'regex') {
      try {
        const flags = options.caseSensitive ? '' : 'i';
        const regex = new RegExp(query, flags);
        return regex.test(value);
      } catch {
        return false;
      }
    }

    return textToSearch.includes(searchText);
  }

  /**
   * Searches in application properties dictionary
   *
   * @param props - Application properties dictionary
   * @param query - Search query
   * @param options - Search options
   * @returns True if any property key or value matches
   */
  private searchInApplicationProperties(
    props: { [key: string]: any } | undefined,
    query: string,
    options: SearchOptions
  ): boolean {
    if (!props) {
      return false;
    }

    return Object.entries(props).some(([key, value]) => {
      const keyMatch = this.matchesQuery(key, query, options);
      const valueMatch = this.matchesQuery(value?.toString() || '', query, options);
      return keyMatch || valueMatch;
    });
  }
}
