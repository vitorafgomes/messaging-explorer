import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MessageSearchService, SearchOptions } from '../../core/services';

/**
 * Pipe that highlights matching text portions in a string
 *
 * Usage:
 *   text | highlight:searchQuery:searchOptions
 *
 * Example:
 *   <div [innerHTML]="message.body | highlight:query:{ mode: 'text' }"></div>
 */
@Pipe({
  name: 'highlight',
  standalone: true
})
export class HighlightPipe implements PipeTransform {
  private searchService = inject(MessageSearchService);
  private sanitizer = inject(DomSanitizer);

  /**
   * Transforms text by wrapping matching portions in <mark> tags
   *
   * @param text - The text content to search and highlight
   * @param query - The search query to highlight
   * @param options - Search options (mode, caseSensitive)
   * @returns SafeHtml with highlighted matches, or original text if no query
   */
  transform(
    text: string | null | undefined,
    query: string | null | undefined,
    options?: SearchOptions
  ): SafeHtml {
    // Return empty string if text is null/undefined
    if (!text) {
      return '';
    }

    // Return original text if no query provided
    if (!query || query.trim() === '') {
      return this.escapeHtml(text);
    }

    const searchOptions: SearchOptions = options || { mode: 'text', caseSensitive: false };

    // Find all matches in the text
    const matches = this.searchService.findMatches(text, query, searchOptions);

    // If no matches found, return escaped original text
    if (matches.length === 0) {
      return this.escapeHtml(text);
    }

    // Build the highlighted text by inserting <mark> tags
    let highlightedText = '';
    let lastIndex = 0;

    for (const match of matches) {
      // Add text before the match (escaped)
      highlightedText += this.escapeHtml(text.substring(lastIndex, match.start));

      // Add the match wrapped in <mark> tags (escaped content)
      highlightedText += '<mark>' + this.escapeHtml(match.text) + '</mark>';

      lastIndex = match.end;
    }

    // Add remaining text after the last match (escaped)
    highlightedText += this.escapeHtml(text.substring(lastIndex));

    // Return as SafeHtml since we've already escaped the content and only added safe <mark> tags
    return this.sanitizer.sanitize(1, highlightedText) || '';
  }

  /**
   * Escapes HTML special characters to prevent XSS attacks
   *
   * @param text - Text to escape
   * @returns Escaped text safe for HTML insertion
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
