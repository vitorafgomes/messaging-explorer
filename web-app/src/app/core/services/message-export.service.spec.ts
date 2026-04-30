import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MessageExportService, MessageExportOptions } from './message-export.service';
import { MessageInfo } from '../models';

describe('MessageExportService', () => {
  let service: MessageExportService;

  // Helper function to create mock messages
  const createMockMessage = (overrides: Partial<MessageInfo> = {}): MessageInfo => ({
    messageId: 'test-message-id',
    body: 'Test message body',
    bodyType: 'string',
    sequenceNumber: 1,
    deliveryCount: 0,
    enqueuedTime: new Date('2024-01-15T10:30:00Z'),
    timeToLive: '14.00:00:00',
    applicationProperties: { key1: 'value1', key2: 'value2' },
    correlationId: 'corr-123',
    sessionId: 'session-abc',
    subject: 'Test Subject',
    contentType: 'application/json',
    ...overrides
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MessageExportService]
    });
    service = TestBed.inject(MessageExportService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up any created elements
    const anchors = document.querySelectorAll('a[download]');
    anchors.forEach(anchor => anchor.remove());
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('exportToJson', () => {
    it('should export messages to JSON with pretty print', () => {
      const messages = [createMockMessage({ sequenceNumber: 1 })];
      const options: MessageExportOptions = {
        format: 'json',
        includeApplicationProperties: true,
        prettyPrint: true
      };

      const result = service.exportToJson(messages, options);

      expect(result).toContain('"messageId"');
      expect(result).toContain('"test-message-id"');
      expect(result).toContain('"sequenceNumber"');
      expect(result).toContain('\n');
      expect(result).toContain('  ');
    });

    it('should export messages to JSON without pretty print', () => {
      const messages = [createMockMessage({ sequenceNumber: 1 })];
      const options: MessageExportOptions = {
        format: 'json',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToJson(messages, options);
      const parsed = JSON.parse(result);

      expect(parsed).toBeInstanceOf(Array);
      expect(parsed.length).toBe(1);
      expect(parsed[0].messageId).toBe('test-message-id');
      expect(result).not.toContain('\n  ');
    });

    it('should include application properties when option is true', () => {
      const messages = [createMockMessage()];
      const options: MessageExportOptions = {
        format: 'json',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToJson(messages, options);
      const parsed = JSON.parse(result);

      expect(parsed[0].applicationProperties).toBeDefined();
      expect(parsed[0].applicationProperties.key1).toBe('value1');
    });

    it('should exclude application properties when option is false', () => {
      const messages = [createMockMessage()];
      const options: MessageExportOptions = {
        format: 'json',
        includeApplicationProperties: false,
        prettyPrint: false
      };

      const result = service.exportToJson(messages, options);
      const parsed = JSON.parse(result);

      expect(parsed[0].applicationProperties).toBeUndefined();
      expect(parsed[0].messageId).toBe('test-message-id');
    });

    it('should export multiple messages', () => {
      const messages = [
        createMockMessage({ sequenceNumber: 1, messageId: 'msg-1' }),
        createMockMessage({ sequenceNumber: 2, messageId: 'msg-2' }),
        createMockMessage({ sequenceNumber: 3, messageId: 'msg-3' })
      ];
      const options: MessageExportOptions = {
        format: 'json',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToJson(messages, options);
      const parsed = JSON.parse(result);

      expect(parsed.length).toBe(3);
      expect(parsed[0].messageId).toBe('msg-1');
      expect(parsed[1].messageId).toBe('msg-2');
      expect(parsed[2].messageId).toBe('msg-3');
    });

    it('should handle empty message array', () => {
      const messages: MessageInfo[] = [];
      const options: MessageExportOptions = {
        format: 'json',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToJson(messages, options);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual([]);
    });

    it('should handle messages with special characters', () => {
      const messages = [createMockMessage({
        body: 'Special chars: "quotes", \'apostrophes\', \n newlines, \t tabs',
        subject: 'Test "Subject" with quotes'
      })];
      const options: MessageExportOptions = {
        format: 'json',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToJson(messages, options);
      const parsed = JSON.parse(result);

      expect(parsed[0].body).toContain('Special chars');
      expect(parsed[0].subject).toContain('Test "Subject" with quotes');
    });

    it('should preserve Date objects in JSON', () => {
      const testDate = new Date('2024-01-15T10:30:00Z');
      const messages = [createMockMessage({ enqueuedTime: testDate })];
      const options: MessageExportOptions = {
        format: 'json',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToJson(messages, options);
      const parsed = JSON.parse(result);

      expect(parsed[0].enqueuedTime).toBe(testDate.toISOString());
    });
  });

  describe('exportToCsv', () => {
    it('should export messages to CSV format', () => {
      const messages = [createMockMessage()];
      const options: MessageExportOptions = {
        format: 'csv',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToCsv(messages, options);

      expect(result).toContain('Sequence Number');
      expect(result).toContain('Message ID');
      expect(result).toContain('test-message-id');
      expect(result).toContain('Test message body');
    });

    it('should include CSV headers', () => {
      const messages = [createMockMessage()];
      const options: MessageExportOptions = {
        format: 'csv',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToCsv(messages, options);
      const lines = result.split('\n');
      const headers = lines[0];

      expect(headers).toContain('Sequence Number');
      expect(headers).toContain('Message ID');
      expect(headers).toContain('Correlation ID');
      expect(headers).toContain('Body');
      expect(headers).toContain('Delivery Count');
    });

    it('should include application properties column when option is true', () => {
      const messages = [createMockMessage()];
      const options: MessageExportOptions = {
        format: 'csv',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToCsv(messages, options);
      const lines = result.split('\n');

      expect(lines[0]).toContain('Application Properties');
      expect(result).toContain('"key1"');
      expect(result).toContain('"value1"');
    });

    it('should exclude application properties column when option is false', () => {
      const messages = [createMockMessage()];
      const options: MessageExportOptions = {
        format: 'csv',
        includeApplicationProperties: false,
        prettyPrint: false
      };

      const result = service.exportToCsv(messages, options);
      const lines = result.split('\n');

      expect(lines[0]).not.toContain('Application Properties');
    });

    it('should export multiple messages with correct row count', () => {
      const messages = [
        createMockMessage({ sequenceNumber: 1, messageId: 'msg-1' }),
        createMockMessage({ sequenceNumber: 2, messageId: 'msg-2' }),
        createMockMessage({ sequenceNumber: 3, messageId: 'msg-3' })
      ];
      const options: MessageExportOptions = {
        format: 'csv',
        includeApplicationProperties: false,
        prettyPrint: false
      };

      const result = service.exportToCsv(messages, options);
      const lines = result.split('\n');

      expect(lines.length).toBe(4);
      expect(lines[1]).toContain('msg-1');
      expect(lines[2]).toContain('msg-2');
      expect(lines[3]).toContain('msg-3');
    });

    it('should return empty string for empty message array', () => {
      const messages: MessageInfo[] = [];
      const options: MessageExportOptions = {
        format: 'csv',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToCsv(messages, options);

      expect(result).toBe('');
    });

    it('should return empty string for null message array', () => {
      const options: MessageExportOptions = {
        format: 'csv',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToCsv(null as any, options);

      expect(result).toBe('');
    });

    it('should escape CSV special characters correctly', () => {
      const messages = [createMockMessage({
        body: 'Text with, comma',
        subject: 'Text with "quotes"',
        correlationId: 'Text with\nnewline'
      })];
      const options: MessageExportOptions = {
        format: 'csv',
        includeApplicationProperties: false,
        prettyPrint: false
      };

      const result = service.exportToCsv(messages, options);

      expect(result).toContain('"Text with, comma"');
      expect(result).toContain('"Text with ""quotes"""');
      expect(result).toContain('"Text with\nnewline"');
    });

    it('should format dates as ISO strings in CSV', () => {
      const testDate = new Date('2024-01-15T10:30:00Z');
      const messages = [createMockMessage({ enqueuedTime: testDate })];
      const options: MessageExportOptions = {
        format: 'csv',
        includeApplicationProperties: false,
        prettyPrint: false
      };

      const result = service.exportToCsv(messages, options);

      expect(result).toContain(testDate.toISOString());
    });

    it('should handle null and undefined values gracefully', () => {
      const messages = [createMockMessage({
        correlationId: undefined,
        sessionId: undefined,
        subject: undefined,
        deadLetterReason: undefined
      })];
      const options: MessageExportOptions = {
        format: 'csv',
        includeApplicationProperties: false,
        prettyPrint: false
      };

      const result = service.exportToCsv(messages, options);
      const lines = result.split('\n');

      expect(lines.length).toBe(2);
      expect(result).toContain('""');
    });

    it('should handle messages with all fields populated', () => {
      const messages = [createMockMessage({
        sequenceNumber: 12345,
        messageId: 'msg-id-123',
        correlationId: 'corr-456',
        sessionId: 'session-789',
        partitionKey: 'partition-1',
        subject: 'Test Subject',
        contentType: 'application/json',
        body: 'Message body',
        bodyType: 'string',
        deliveryCount: 3,
        replyTo: 'reply-queue',
        replyToSessionId: 'reply-session',
        to: 'target-queue',
        deadLetterSource: 'source-queue',
        deadLetterReason: 'MaxDeliveryCountExceeded',
        deadLetterErrorDescription: 'Failed after 3 attempts'
      })];
      const options: MessageExportOptions = {
        format: 'csv',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToCsv(messages, options);

      expect(result).toContain('12345');
      expect(result).toContain('msg-id-123');
      expect(result).toContain('corr-456');
      expect(result).toContain('session-789');
      expect(result).toContain('MaxDeliveryCountExceeded');
    });

    it('should stringify application properties as JSON in CSV', () => {
      const messages = [createMockMessage({
        applicationProperties: { status: 'pending', userId: 123, active: true }
      })];
      const options: MessageExportOptions = {
        format: 'csv',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToCsv(messages, options);

      expect(result).toContain('"status"');
      expect(result).toContain('"pending"');
      expect(result).toContain('"userId"');
    });
  });

  describe('downloadFile', () => {
    it('should create a blob and trigger download', () => {
      const content = 'test file content';
      const filename = 'test.txt';
      const mimeType = 'text/plain';

      vi.spyOn(document, 'createElement');
      vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test-url');
      vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});

      service.downloadFile(content, filename, mimeType);

      expect(window.URL.createObjectURL).toHaveBeenCalled();
      expect(document.createElement).toHaveBeenCalledWith('a');
    });

    it('should set correct download attributes on anchor element', () => {
      const content = 'test content';
      const filename = 'test-file.json';
      const mimeType = 'application/json';

      let createdAnchor: HTMLAnchorElement | null = null;
      const originalCreateElement = document.createElement.bind(document);

      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const element = originalCreateElement(tagName);
        if (tagName === 'a') {
          createdAnchor = element as HTMLAnchorElement;
        }
        return element;
      });

      vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test-url');
      vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});

      service.downloadFile(content, filename, mimeType);

      expect(createdAnchor).not.toBeNull();
      expect((createdAnchor as unknown as HTMLAnchorElement).download).toBe(filename);
      expect((createdAnchor as unknown as HTMLAnchorElement).href).toBe('blob:test-url');
    });

    it('should revoke object URL after download', async () => {
      const content = 'test content';
      const filename = 'test.txt';
      const mimeType = 'text/plain';

      vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test-url');
      vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});

      service.downloadFile(content, filename, mimeType);

      await new Promise(resolve => setTimeout(resolve, 150));
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });

    it('should handle JSON content', () => {
      const jsonContent = JSON.stringify({ test: 'data' });
      const filename = 'export.json';
      const mimeType = 'application/json';

      vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test-url');
      vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});

      expect(() => {
        service.downloadFile(jsonContent, filename, mimeType);
      }).not.toThrow();
    });

    it('should handle CSV content', () => {
      const csvContent = 'header1,header2\nvalue1,value2';
      const filename = 'export.csv';
      const mimeType = 'text/csv';

      vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test-url');
      vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});

      expect(() => {
        service.downloadFile(csvContent, filename, mimeType);
      }).not.toThrow();
    });

    it('should handle large content', () => {
      const largeContent = 'x'.repeat(1000000);
      const filename = 'large-file.txt';
      const mimeType = 'text/plain';

      vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test-url');
      vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});

      expect(() => {
        service.downloadFile(largeContent, filename, mimeType);
      }).not.toThrow();
    });

    it('should handle special characters in filename', () => {
      const content = 'test';
      const filename = 'test-file_2024-01-15_10:30:00.json';
      const mimeType = 'application/json';

      let createdAnchor: HTMLAnchorElement | null = null;
      const originalCreateElement = document.createElement.bind(document);

      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const element = originalCreateElement(tagName);
        if (tagName === 'a') {
          createdAnchor = element as HTMLAnchorElement;
        }
        return element;
      });

      vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test-url');
      vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});

      service.downloadFile(content, filename, mimeType);

      expect((createdAnchor as unknown as HTMLAnchorElement)?.download).toBe(filename);
    });
  });

  describe('edge cases and special scenarios', () => {
    it('should handle messages with Unicode characters in JSON', () => {
      const messages = [createMockMessage({
        body: 'Hello 世界 🌍',
        subject: 'Тест'
      })];
      const options: MessageExportOptions = {
        format: 'json',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToJson(messages, options);
      const parsed = JSON.parse(result);

      expect(parsed[0].body).toBe('Hello 世界 🌍');
      expect(parsed[0].subject).toBe('Тест');
    });

    it('should handle messages with Unicode characters in CSV', () => {
      const messages = [createMockMessage({
        body: 'Hello 世界 🌍',
        subject: 'Тест'
      })];
      const options: MessageExportOptions = {
        format: 'csv',
        includeApplicationProperties: false,
        prettyPrint: false
      };

      const result = service.exportToCsv(messages, options);

      expect(result).toContain('Hello 世界 🌍');
      expect(result).toContain('Тест');
    });

    it('should handle very long message bodies', () => {
      const longBody = 'A'.repeat(10000);
      const messages = [createMockMessage({ body: longBody })];
      const options: MessageExportOptions = {
        format: 'json',
        includeApplicationProperties: false,
        prettyPrint: false
      };

      const result = service.exportToJson(messages, options);
      const parsed = JSON.parse(result);

      expect(parsed[0].body.length).toBe(10000);
    });

    it('should handle messages with nested objects in application properties', () => {
      const messages = [createMockMessage({
        applicationProperties: {
          user: { id: 123, name: 'Test' },
          settings: { enabled: true, options: ['a', 'b'] }
        }
      })];
      const options: MessageExportOptions = {
        format: 'json',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToJson(messages, options);
      const parsed = JSON.parse(result);

      expect(parsed[0].applicationProperties.user.id).toBe(123);
      expect(parsed[0].applicationProperties.settings.enabled).toBe(true);
    });

    it('should handle CSV with all empty values', () => {
      const messages = [createMockMessage({
        body: '',
        correlationId: undefined,
        sessionId: undefined,
        subject: undefined
      })];
      const options: MessageExportOptions = {
        format: 'csv',
        includeApplicationProperties: false,
        prettyPrint: false
      };

      const result = service.exportToCsv(messages, options);
      const lines = result.split('\n');

      expect(lines.length).toBe(2);
      expect(lines[1]).toContain('""');
    });

    it('should handle multiple messages with mixed content', () => {
      const messages = [
        createMockMessage({
          sequenceNumber: 1,
          body: 'Simple text',
          applicationProperties: { type: 'simple' }
        }),
        createMockMessage({
          sequenceNumber: 2,
          body: 'Complex "text", with\nspecial chars',
          applicationProperties: { type: 'complex', nested: { value: 123 } }
        }),
        createMockMessage({
          sequenceNumber: 3,
          body: '',
          applicationProperties: {}
        })
      ];
      const options: MessageExportOptions = {
        format: 'csv',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToCsv(messages, options);
      const lines = result.split('\n');

      expect(lines.length).toBe(4);
      expect(result).toContain('Simple text');
      expect(result).toContain('Complex ""text"", with\nspecial chars');
    });

    it('should handle large batch of messages efficiently', () => {
      const messages = Array.from({ length: 1000 }, (_, i) =>
        createMockMessage({ sequenceNumber: i + 1, messageId: `msg-${i}` })
      );
      const options: MessageExportOptions = {
        format: 'json',
        includeApplicationProperties: true,
        prettyPrint: false
      };

      const result = service.exportToJson(messages, options);
      const parsed = JSON.parse(result);

      expect(parsed.length).toBe(1000);
      expect(parsed[0].sequenceNumber).toBe(1);
      expect(parsed[999].sequenceNumber).toBe(1000);
    });
  });
});
