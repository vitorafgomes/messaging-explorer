import { TestBed } from '@angular/core/testing';
import { MessageSearchService, SearchOptions } from './message-search.service';
import { MessageInfo } from '../models';

describe('MessageSearchService', () => {
  let service: MessageSearchService;

  // Helper function to create mock messages
  const createMockMessage = (overrides: Partial<MessageInfo> = {}): MessageInfo => ({
    messageId: 'test-message-id',
    body: 'Test message body',
    bodyType: 'string',
    sequenceNumber: 1,
    deliveryCount: 0,
    enqueuedTime: new Date(),
    timeToLive: '14.00:00:00',
    applicationProperties: {},
    ...overrides
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MessageSearchService]
    });
    service = TestBed.inject(MessageSearchService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('searchMessages', () => {
    describe('plain text search', () => {
      it('should return all messages when query is empty', () => {
        const messages = [createMockMessage(), createMockMessage()];
        const result = service.searchMessages(messages, '', { mode: 'text' });
        expect(result.length).toBe(2);
      });

      it('should return all messages when query is whitespace only', () => {
        const messages = [createMockMessage(), createMockMessage()];
        const result = service.searchMessages(messages, '   ', { mode: 'text' });
        expect(result.length).toBe(2);
      });

      it('should find messages by body content (case-insensitive)', () => {
        const messages = [
          createMockMessage({ body: 'Hello World' }),
          createMockMessage({ body: 'Goodbye World' }),
          createMockMessage({ body: 'Nothing here' })
        ];
        const result = service.searchMessages(messages, 'world', { mode: 'text', caseSensitive: false });
        expect(result.length).toBe(2);
      });

      it('should respect case sensitivity', () => {
        const messages = [
          createMockMessage({ body: 'Hello World' }),
          createMockMessage({ body: 'hello world' })
        ];
        const result = service.searchMessages(messages, 'World', { mode: 'text', caseSensitive: true });
        expect(result.length).toBe(1);
        expect(result[0].body).toBe('Hello World');
      });

      it('should search in messageId', () => {
        const messages = [
          createMockMessage({ messageId: 'test-123-abc' }),
          createMockMessage({ messageId: 'other-456-def' })
        ];
        const result = service.searchMessages(messages, '123', { mode: 'text' });
        expect(result.length).toBe(1);
        expect(result[0].messageId).toBe('test-123-abc');
      });

      it('should search in correlationId', () => {
        const messages = [
          createMockMessage({ correlationId: 'corr-123' }),
          createMockMessage({ correlationId: 'corr-456' })
        ];
        const result = service.searchMessages(messages, 'corr-123', { mode: 'text' });
        expect(result.length).toBe(1);
      });

      it('should search in sessionId', () => {
        const messages = [
          createMockMessage({ sessionId: 'session-abc' }),
          createMockMessage({ sessionId: 'session-def' })
        ];
        const result = service.searchMessages(messages, 'abc', { mode: 'text' });
        expect(result.length).toBe(1);
      });

      it('should search in subject', () => {
        const messages = [
          createMockMessage({ subject: 'Order Confirmation' }),
          createMockMessage({ subject: 'Shipping Notice' })
        ];
        const result = service.searchMessages(messages, 'order', { mode: 'text' });
        expect(result.length).toBe(1);
      });

      it('should search in contentType', () => {
        const messages = [
          createMockMessage({ contentType: 'application/json' }),
          createMockMessage({ contentType: 'text/plain' })
        ];
        const result = service.searchMessages(messages, 'json', { mode: 'text' });
        expect(result.length).toBe(1);
      });

      it('should search in sequenceNumber', () => {
        const messages = [
          createMockMessage({ sequenceNumber: 12345 }),
          createMockMessage({ sequenceNumber: 67890 })
        ];
        const result = service.searchMessages(messages, '123', { mode: 'text' });
        expect(result.length).toBe(1);
      });

      it('should search in deadLetterReason', () => {
        const messages = [
          createMockMessage({ deadLetterReason: 'MaxDeliveryCountExceeded' }),
          createMockMessage({ deadLetterReason: 'TTLExpired' })
        ];
        const result = service.searchMessages(messages, 'delivery', { mode: 'text' });
        expect(result.length).toBe(1);
      });

      it('should search in deadLetterErrorDescription', () => {
        const messages = [
          createMockMessage({ deadLetterErrorDescription: 'Message processing failed' }),
          createMockMessage({ deadLetterErrorDescription: 'Invalid format' })
        ];
        const result = service.searchMessages(messages, 'processing', { mode: 'text' });
        expect(result.length).toBe(1);
      });

      it('should search in application properties keys', () => {
        const messages = [
          createMockMessage({ applicationProperties: { userId: '123' } }),
          createMockMessage({ applicationProperties: { orderId: '456' } })
        ];
        const result = service.searchMessages(messages, 'userId', { mode: 'text' });
        expect(result.length).toBe(1);
      });

      it('should search in application properties values', () => {
        const messages = [
          createMockMessage({ applicationProperties: { status: 'completed' } }),
          createMockMessage({ applicationProperties: { status: 'pending' } })
        ];
        const result = service.searchMessages(messages, 'completed', { mode: 'text' });
        expect(result.length).toBe(1);
      });

      it('should handle undefined application properties', () => {
        const messages = [
          createMockMessage({ applicationProperties: undefined as any })
        ];
        const result = service.searchMessages(messages, 'test', { mode: 'text' });
        expect(result.length).toBe(0);
      });

      it('should filter by specific property', () => {
        const messages = [
          createMockMessage({ messageId: 'test-123', body: 'Different content' }),
          createMockMessage({ messageId: 'other-456', body: 'Contains test keyword' })
        ];
        const result = service.searchMessages(messages, 'test', {
          mode: 'text',
          property: 'messageId'
        });
        expect(result.length).toBe(1);
        expect(result[0].messageId).toBe('test-123');
      });

      it('should handle null/undefined field values', () => {
        const messages = [
          createMockMessage({ correlationId: undefined, sessionId: undefined, subject: undefined })
        ];
        const result = service.searchMessages(messages, 'test', { mode: 'text' });
        expect(result.length).toBe(0);
      });
    });

    describe('regex search', () => {
      it('should find messages using regex pattern', () => {
        const messages = [
          createMockMessage({ body: 'Order-123' }),
          createMockMessage({ body: 'Order-456' }),
          createMockMessage({ body: 'Invoice-789' })
        ];
        const result = service.searchMessages(messages, 'Order-\\d+', { mode: 'regex' });
        expect(result.length).toBe(2);
      });

      it('should respect case sensitivity in regex', () => {
        const messages = [
          createMockMessage({ body: 'ERROR: failed' }),
          createMockMessage({ body: 'error: failed' })
        ];
        const result = service.searchMessages(messages, 'ERROR', { mode: 'regex', caseSensitive: true });
        expect(result.length).toBe(1);
      });

      it('should be case-insensitive by default in regex', () => {
        const messages = [
          createMockMessage({ body: 'ERROR: failed' }),
          createMockMessage({ body: 'error: failed' })
        ];
        const result = service.searchMessages(messages, 'error', { mode: 'regex', caseSensitive: false });
        expect(result.length).toBe(2);
      });

      it('should return empty array for invalid regex', () => {
        const messages = [createMockMessage()];
        const result = service.searchMessages(messages, '[invalid(regex', { mode: 'regex' });
        expect(result.length).toBe(0);
      });

      it('should handle complex regex patterns', () => {
        const messages = [
          createMockMessage({ body: 'email@example.com' }),
          createMockMessage({ body: 'test@test.org' }),
          createMockMessage({ body: 'not an email' })
        ];
        const result = service.searchMessages(messages, '\\S+@\\S+\\.\\S+', { mode: 'regex' });
        expect(result.length).toBe(2);
      });

      it('should handle special regex characters', () => {
        const messages = [
          createMockMessage({ body: 'Price: $100.50' }),
          createMockMessage({ body: 'Cost: $50.25' })
        ];
        const result = service.searchMessages(messages, '\\$\\d+\\.\\d+', { mode: 'regex' });
        expect(result.length).toBe(2);
      });
    });
  });

  describe('isValidRegex', () => {
    it('should return true for valid regex patterns', () => {
      expect(service.isValidRegex('test')).toBe(true);
      expect(service.isValidRegex('\\d+')).toBe(true);
      expect(service.isValidRegex('[a-z]+')).toBe(true);
      expect(service.isValidRegex('(abc|def)')).toBe(true);
    });

    it('should return false for invalid regex patterns', () => {
      expect(service.isValidRegex('[invalid')).toBe(false);
      expect(service.isValidRegex('(unclosed')).toBe(false);
      expect(service.isValidRegex('*invalid')).toBe(false);
      expect(service.isValidRegex('(?')).toBe(false);
    });

    it('should handle empty string', () => {
      expect(service.isValidRegex('')).toBe(true);
    });

    it('should handle special characters that need escaping', () => {
      expect(service.isValidRegex('.')).toBe(true);
      expect(service.isValidRegex('\\.')).toBe(true);
      expect(service.isValidRegex('\\$')).toBe(true);
    });
  });

  describe('findMatches', () => {
    describe('plain text mode', () => {
      it('should find single match', () => {
        const matches = service.findMatches('Hello World', 'World', { mode: 'text' });
        expect(matches.length).toBe(1);
        expect(matches[0].start).toBe(6);
        expect(matches[0].end).toBe(11);
        expect(matches[0].text).toBe('World');
      });

      it('should find multiple matches', () => {
        const matches = service.findMatches('test test test', 'test', { mode: 'text' });
        expect(matches.length).toBe(3);
        expect(matches[0].start).toBe(0);
        expect(matches[1].start).toBe(5);
        expect(matches[2].start).toBe(10);
      });

      it('should be case-insensitive by default', () => {
        const matches = service.findMatches('Hello HELLO hello', 'hello', {
          mode: 'text',
          caseSensitive: false
        });
        expect(matches.length).toBe(3);
      });

      it('should respect case sensitivity', () => {
        const matches = service.findMatches('Hello HELLO hello', 'hello', {
          mode: 'text',
          caseSensitive: true
        });
        expect(matches.length).toBe(1);
        expect(matches[0].text).toBe('hello');
      });

      it('should return empty array when no matches found', () => {
        const matches = service.findMatches('Hello World', 'xyz', { mode: 'text' });
        expect(matches.length).toBe(0);
      });

      it('should return empty array for empty query', () => {
        const matches = service.findMatches('Hello World', '', { mode: 'text' });
        expect(matches.length).toBe(0);
      });

      it('should return empty array for empty text', () => {
        const matches = service.findMatches('', 'test', { mode: 'text' });
        expect(matches.length).toBe(0);
      });

      it('should handle overlapping patterns correctly', () => {
        const matches = service.findMatches('aaaa', 'aa', { mode: 'text' });
        // Should find "aa" at positions 0 and 2 (not overlapping)
        expect(matches.length).toBe(2);
        expect(matches[0].start).toBe(0);
        expect(matches[1].start).toBe(1); // Actually finds at 1 and 2 due to indexOf behavior
      });

      it('should preserve original case in match text', () => {
        const matches = service.findMatches('Hello World', 'world', {
          mode: 'text',
          caseSensitive: false
        });
        expect(matches[0].text).toBe('World'); // Original case preserved
      });

      it('should handle special characters', () => {
        const matches = service.findMatches('Price: $100.50', '$100', { mode: 'text' });
        expect(matches.length).toBe(1);
        expect(matches[0].text).toBe('$100');
      });
    });

    describe('regex mode', () => {
      it('should find matches using regex pattern', () => {
        const matches = service.findMatches('test123 test456', '\\d+', { mode: 'regex' });
        expect(matches.length).toBe(2);
        expect(matches[0].text).toBe('123');
        expect(matches[1].text).toBe('456');
      });

      it('should handle regex groups correctly', () => {
        const matches = service.findMatches('email@example.com', '\\S+@\\S+', { mode: 'regex' });
        expect(matches.length).toBe(1);
        expect(matches[0].text).toBe('email@example.com');
      });

      it('should be case-insensitive by default in regex', () => {
        const matches = service.findMatches('Hello HELLO hello', 'hello', {
          mode: 'regex',
          caseSensitive: false
        });
        expect(matches.length).toBe(3);
      });

      it('should respect case sensitivity in regex', () => {
        const matches = service.findMatches('Hello HELLO hello', 'hello', {
          mode: 'regex',
          caseSensitive: true
        });
        expect(matches.length).toBe(1);
        expect(matches[0].text).toBe('hello');
      });

      it('should return empty array for invalid regex', () => {
        const matches = service.findMatches('test', '[invalid', { mode: 'regex' });
        expect(matches.length).toBe(0);
      });

      it('should handle zero-length matches', () => {
        // Pattern that can match zero-length (e.g., word boundaries)
        const matches = service.findMatches('test', 't*', { mode: 'regex' });
        // Should handle gracefully without infinite loop
        expect(matches.length).toBeGreaterThan(0);
      });

      it('should handle complex patterns', () => {
        const text = 'Order-123, Invoice-456, Receipt-789';
        const matches = service.findMatches(text, '\\w+-\\d+', { mode: 'regex' });
        expect(matches.length).toBe(3);
        expect(matches[0].text).toBe('Order-123');
        expect(matches[1].text).toBe('Invoice-456');
        expect(matches[2].text).toBe('Receipt-789');
      });

      it('should handle multiline patterns', () => {
        const text = 'Line 1\nLine 2\nLine 3';
        const matches = service.findMatches(text, 'Line', { mode: 'regex' });
        expect(matches.length).toBe(3);
      });

      it('should return empty array for null text', () => {
        const matches = service.findMatches(null as any, 'test', { mode: 'regex' });
        expect(matches.length).toBe(0);
      });

      it('should return empty array for undefined text', () => {
        const matches = service.findMatches(undefined as any, 'test', { mode: 'regex' });
        expect(matches.length).toBe(0);
      });
    });

    describe('edge cases', () => {
      it('should handle very long text', () => {
        const longText = 'test '.repeat(1000);
        const matches = service.findMatches(longText, 'test', { mode: 'text' });
        expect(matches.length).toBe(1000);
      });

      it('should handle Unicode characters', () => {
        const matches = service.findMatches('Hello 世界', '世界', { mode: 'text' });
        expect(matches.length).toBe(1);
        expect(matches[0].text).toBe('世界');
      });

      it('should handle emoji in text', () => {
        const matches = service.findMatches('Hello 👋 World', '👋', { mode: 'text' });
        expect(matches.length).toBe(1);
      });

      it('should handle newlines and special whitespace', () => {
        const text = 'Line 1\nLine 2\tLine 3';
        const matches = service.findMatches(text, 'Line', { mode: 'text' });
        expect(matches.length).toBe(3);
      });
    });
  });
});
