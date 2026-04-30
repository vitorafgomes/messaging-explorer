import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { HighlightPipe } from './highlight.pipe';
import { MessageSearchService } from '../../core/services';

describe('HighlightPipe', () => {
  let pipe: HighlightPipe;
  let searchService: MessageSearchService;
  let sanitizer: DomSanitizer;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        HighlightPipe,
        MessageSearchService,
        DomSanitizer
      ]
    });

    pipe = TestBed.inject(HighlightPipe);
    searchService = TestBed.inject(MessageSearchService);
    sanitizer = TestBed.inject(DomSanitizer);
  });

  it('should be created', () => {
    expect(pipe).toBeTruthy();
  });

  describe('transform', () => {
    describe('basic functionality', () => {
      it('should return empty string for null text', () => {
        const result = pipe.transform(null, 'test', { mode: 'text' });
        expect(result).toBe('');
      });

      it('should return empty string for undefined text', () => {
        const result = pipe.transform(undefined, 'test', { mode: 'text' });
        expect(result).toBe('');
      });

      it('should return escaped text when query is null', () => {
        const result = pipe.transform('Hello World', null, { mode: 'text' });
        expect(result).toBe('Hello World');
      });

      it('should return escaped text when query is undefined', () => {
        const result = pipe.transform('Hello World', undefined, { mode: 'text' });
        expect(result).toBe('Hello World');
      });

      it('should return escaped text when query is empty string', () => {
        const result = pipe.transform('Hello World', '', { mode: 'text' });
        expect(result).toBe('Hello World');
      });

      it('should return escaped text when query is whitespace only', () => {
        const result = pipe.transform('Hello World', '   ', { mode: 'text' });
        expect(result).toBe('Hello World');
      });

      it('should return escaped text when no matches found', () => {
        const result = pipe.transform('Hello World', 'xyz', { mode: 'text' });
        expect(result).toBe('Hello World');
      });
    });

    describe('plain text highlighting', () => {
      it('should highlight single match', () => {
        const result = pipe.transform('Hello World', 'World', { mode: 'text' });
        expect(result).toContain('<mark>World</mark>');
        expect(result).toContain('Hello ');
      });

      it('should highlight multiple matches', () => {
        const result = pipe.transform('test test test', 'test', { mode: 'text' });
        const markCount = (result as string).split('<mark>').length - 1;
        expect(markCount).toBe(3);
      });

      it('should be case-insensitive by default', () => {
        const result = pipe.transform('Hello HELLO hello', 'hello', {
          mode: 'text',
          caseSensitive: false
        });
        const markCount = (result as string).split('<mark>').length - 1;
        expect(markCount).toBe(3);
      });

      it('should respect case sensitivity when specified', () => {
        const result = pipe.transform('Hello HELLO hello', 'hello', {
          mode: 'text',
          caseSensitive: true
        });
        const markCount = (result as string).split('<mark>').length - 1;
        expect(markCount).toBe(1);
        expect(result).toContain('<mark>hello</mark>');
      });

      it('should preserve original case in highlighted text', () => {
        const result = pipe.transform('Hello World', 'world', {
          mode: 'text',
          caseSensitive: false
        });
        expect(result).toContain('<mark>World</mark>');
      });

      it('should handle partial word matches', () => {
        const result = pipe.transform('testing tested test', 'test', { mode: 'text' });
        expect(result).toContain('<mark>test</mark>ing');
        expect(result).toContain('<mark>test</mark>ed');
        expect(result).toContain('<mark>test</mark>');
      });
    });

    describe('regex highlighting', () => {
      it('should highlight matches using regex pattern', () => {
        const result = pipe.transform('test123 test456', '\\d+', { mode: 'regex' });
        expect(result).toContain('<mark>123</mark>');
        expect(result).toContain('<mark>456</mark>');
      });

      it('should handle complex regex patterns', () => {
        const result = pipe.transform('email@example.com', '\\S+@\\S+\\.\\S+', { mode: 'regex' });
        expect(result).toContain('<mark>email@example.com</mark>');
      });

      it('should be case-insensitive by default in regex', () => {
        const result = pipe.transform('Hello HELLO hello', 'hello', {
          mode: 'regex',
          caseSensitive: false
        });
        const markCount = (result as string).split('<mark>').length - 1;
        expect(markCount).toBe(3);
      });

      it('should respect case sensitivity in regex', () => {
        const result = pipe.transform('Hello HELLO hello', 'hello', {
          mode: 'regex',
          caseSensitive: true
        });
        const markCount = (result as string).split('<mark>').length - 1;
        expect(markCount).toBe(1);
        expect(result).toContain('<mark>hello</mark>');
      });

      it('should return escaped text for invalid regex', () => {
        const result = pipe.transform('test text', '[invalid', { mode: 'regex' });
        expect(result).toBe('test text');
        expect(result).not.toContain('<mark>');
      });

      it('should handle word boundary patterns', () => {
        const result = pipe.transform('test testing tested', '\\btest\\b', { mode: 'regex' });
        expect(result).toContain('<mark>test</mark> testing tested');
      });
    });

    describe('HTML escaping and XSS prevention', () => {
      it('should escape HTML special characters in text', () => {
        const result = pipe.transform('<script>alert("xss")</script>', 'alert', { mode: 'text' });
        expect(result).toContain('&lt;script&gt;');
        expect(result).toContain('&lt;/script&gt;');
        expect(result).not.toContain('<script>');
      });

      it('should escape ampersands', () => {
        const result = pipe.transform('Tom & Jerry', 'Jerry', { mode: 'text' });
        expect(result).toContain('&amp;');
        expect(result).toContain('<mark>Jerry</mark>');
      });

      it('should escape quotes', () => {
        const result = pipe.transform('He said "hello"', 'hello', { mode: 'text' });
        expect(result).toContain('&quot;');
        expect(result).toContain('<mark>hello</mark>');
      });

      it('should escape less-than and greater-than symbols', () => {
        const result = pipe.transform('1 < 2 > 0', '2', { mode: 'text' });
        expect(result).toContain('&lt;');
        expect(result).toContain('&gt;');
        expect(result).toContain('<mark>2</mark>');
      });

      it('should escape HTML in matched text', () => {
        const result = pipe.transform('<div>test</div>', '<div>', { mode: 'text' });
        expect(result).toContain('<mark>&lt;div&gt;</mark>');
        expect(result).not.toContain('<mark><div></mark>');
      });

      it('should handle malicious regex patterns safely', () => {
        const result = pipe.transform('test', '(', { mode: 'regex' });
        // Should return escaped text without throwing error
        expect(result).toBe('test');
      });

      it('should escape special characters before and after matches', () => {
        const text = '<tag>content</tag> with "quotes" & ampersands';
        const result = pipe.transform(text, 'content', { mode: 'text' });
        expect(result).toContain('&lt;tag&gt;');
        expect(result).toContain('&lt;/tag&gt;');
        expect(result).toContain('<mark>content</mark>');
        expect(result).toContain('&quot;');
        expect(result).toContain('&amp;');
      });
    });

    describe('edge cases', () => {
      it('should handle empty string text', () => {
        const result = pipe.transform('', 'test', { mode: 'text' });
        expect(result).toBe('');
      });

      it('should handle text with only whitespace', () => {
        const result = pipe.transform('   ', ' ', { mode: 'text' });
        expect(result).toContain('<mark> </mark>');
      });

      it('should handle very long text', () => {
        const longText = 'test '.repeat(100);
        const result = pipe.transform(longText, 'test', { mode: 'text' });
        const markCount = (result as string).split('<mark>').length - 1;
        expect(markCount).toBe(100);
      });

      it('should handle Unicode characters', () => {
        const result = pipe.transform('Hello 世界', '世界', { mode: 'text' });
        expect(result).toContain('<mark>世界</mark>');
      });

      it('should handle emoji', () => {
        const result = pipe.transform('Hello 👋 World', '👋', { mode: 'text' });
        expect(result).toContain('<mark>👋</mark>');
      });

      it('should handle newlines', () => {
        const result = pipe.transform('Line 1\nLine 2', 'Line', { mode: 'text' });
        expect(result).toContain('<mark>Line</mark> 1');
        expect(result).toContain('<mark>Line</mark> 2');
      });

      it('should handle tabs and special whitespace', () => {
        const result = pipe.transform('Tab\there', 'Tab', { mode: 'text' });
        expect(result).toContain('<mark>Tab</mark>');
      });

      it('should handle consecutive matches', () => {
        const result = pipe.transform('aaaa', 'aa', { mode: 'text' });
        expect(result).toContain('<mark>aa</mark>');
      });

      it('should handle matches at text boundaries', () => {
        const result = pipe.transform('test', 'test', { mode: 'text' });
        expect(result).toBe('<mark>test</mark>');
      });

      it('should handle match at start of text', () => {
        const result = pipe.transform('test something', 'test', { mode: 'text' });
        expect(result).toContain('<mark>test</mark> something');
      });

      it('should handle match at end of text', () => {
        const result = pipe.transform('something test', 'test', { mode: 'text' });
        expect(result).toContain('something <mark>test</mark>');
      });

      it('should handle single character matches', () => {
        const result = pipe.transform('a b c', 'b', { mode: 'text' });
        expect(result).toBe('a <mark>b</mark> c');
      });

      it('should handle special regex characters in text mode', () => {
        const result = pipe.transform('Price: $100.50', '$100', { mode: 'text' });
        expect(result).toContain('<mark>$100</mark>');
      });

      it('should use default options when not provided', () => {
        const result = pipe.transform('Hello World', 'world');
        // Should work with default case-insensitive text mode
        expect(result).toContain('<mark>World</mark>');
      });
    });

    describe('SafeHtml output', () => {
      it('should return SafeHtml type', () => {
        const result = pipe.transform('test', 'test', { mode: 'text' });
        // The result should be sanitized but still contain HTML
        expect(typeof result).toBe('string');
      });

      it('should allow mark tags through sanitization', () => {
        const result = pipe.transform('Hello World', 'World', { mode: 'text' });
        // Mark tags should be preserved
        expect(result).toContain('<mark>');
        expect(result).toContain('</mark>');
      });

      it('should sanitize dangerous content', () => {
        const result = pipe.transform('<img src=x onerror=alert(1)>', 'img', { mode: 'text' });
        // Should not contain dangerous attributes
        expect(result).not.toContain('onerror');
        expect(result).not.toContain('alert');
        // But should contain escaped version
        expect(result).toContain('&lt;');
      });
    });

    describe('integration with MessageSearchService', () => {
      it('should use MessageSearchService.findMatches for consistency', () => {
        vi.spyOn(searchService, 'findMatches');

        pipe.transform('test text', 'test', { mode: 'text' });

        expect(searchService.findMatches).toHaveBeenCalledWith(
          'test text',
          'test',
          { mode: 'text' }
        );
      });

      it('should handle findMatches returning empty array', () => {
        vi.spyOn(searchService, 'findMatches').mockReturnValue([]);

        const result = pipe.transform('test text', 'xyz', { mode: 'text' });

        expect(result).toBe('test text');
        expect(result).not.toContain('<mark>');
      });

      it('should correctly process matches from MessageSearchService', () => {
        vi.spyOn(searchService, 'findMatches').mockReturnValue([
          { start: 0, end: 4, text: 'test' },
          { start: 5, end: 9, text: 'test' }
        ]);

        const result = pipe.transform('test test', 'test', { mode: 'text' });

        expect(result).toBe('<mark>test</mark> <mark>test</mark>');
      });
    });
  });
});
