import { TestBed } from '@angular/core/testing';
import { MessageImportService } from './message-import.service';
import { SendMessageRequest } from '../models';

describe('MessageImportService', () => {
  let service: MessageImportService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MessageImportService]
    });
    service = TestBed.inject(MessageImportService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // =========================================================================
  // parseJsonFile
  // =========================================================================

  describe('parseJsonFile', () => {
    it('should parse a valid JSON array of messages', () => {
      const json = JSON.stringify([
        { body: 'Hello', messageId: 'msg-1', subject: 'Test' },
        { body: 'World', messageId: 'msg-2' }
      ]);

      const result = service.parseJsonFile(json);

      expect(result).toHaveLength(2);
      expect(result[0].body).toBe('Hello');
      expect(result[0].messageId).toBe('msg-1');
      expect(result[0].subject).toBe('Test');
      expect(result[1].body).toBe('World');
      expect(result[1].messageId).toBe('msg-2');
    });

    it('should ignore read-only fields from exported MessageInfo', () => {
      const json = JSON.stringify([{
        body: 'Test body',
        messageId: 'msg-1',
        sequenceNumber: 42,
        deliveryCount: 3,
        enqueuedTime: '2024-01-15T10:30:00Z',
        expiresAt: '2024-01-16T10:30:00Z',
        bodyType: 'string',
        deadLetterSource: 'some-queue',
        deadLetterReason: 'MaxDeliveryCountExceeded',
        deadLetterErrorDescription: 'Failed',
        replyToSessionId: 'reply-session',
        contentType: 'application/json',
        correlationId: 'corr-1',
        sessionId: 'session-1',
        subject: 'Test Subject'
      }]);

      const result = service.parseJsonFile(json);

      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('Test body');
      expect(result[0].messageId).toBe('msg-1');
      expect(result[0].contentType).toBe('application/json');
      expect(result[0].correlationId).toBe('corr-1');
      expect(result[0].sessionId).toBe('session-1');
      expect(result[0].subject).toBe('Test Subject');
      // Read-only fields should NOT be present
      expect((result[0] as any).sequenceNumber).toBeUndefined();
      expect((result[0] as any).deliveryCount).toBeUndefined();
      expect((result[0] as any).enqueuedTime).toBeUndefined();
      expect((result[0] as any).expiresAt).toBeUndefined();
      expect((result[0] as any).bodyType).toBeUndefined();
      expect((result[0] as any).deadLetterSource).toBeUndefined();
      expect((result[0] as any).deadLetterReason).toBeUndefined();
      expect((result[0] as any).deadLetterErrorDescription).toBeUndefined();
      expect((result[0] as any).replyToSessionId).toBeUndefined();
    });

    it('should preserve applicationProperties from JSON', () => {
      const json = JSON.stringify([{
        body: 'Test',
        applicationProperties: { key1: 'value1', key2: 42, nested: { a: true } }
      }]);

      const result = service.parseJsonFile(json);

      expect(result[0].applicationProperties).toEqual({
        key1: 'value1',
        key2: 42,
        nested: { a: true }
      });
    });

    it('should handle a single object (not array)', () => {
      const json = JSON.stringify({ body: 'Single message', messageId: 'msg-solo' });

      const result = service.parseJsonFile(json);

      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('Single message');
      expect(result[0].messageId).toBe('msg-solo');
    });

    it('should handle empty file', () => {
      const result = service.parseJsonFile('');
      expect(result).toHaveLength(0);
    });

    it('should handle whitespace-only file', () => {
      const result = service.parseJsonFile('   \n  \t  ');
      expect(result).toHaveLength(0);
    });

    it('should handle empty JSON array', () => {
      const result = service.parseJsonFile('[]');
      expect(result).toHaveLength(0);
    });

    it('should throw on malformed JSON', () => {
      expect(() => service.parseJsonFile('{invalid json')).toThrow(/Invalid JSON/);
    });

    it('should throw on non-object array items', () => {
      expect(() => service.parseJsonFile('["string1", "string2"]')).toThrow(/not an object/);
    });

    it('should throw on primitive JSON value', () => {
      expect(() => service.parseJsonFile('42')).toThrow(/Expected a JSON array/);
    });

    it('should convert scheduledEnqueueTime string to Date', () => {
      const json = JSON.stringify([{
        body: 'Scheduled',
        scheduledEnqueueTime: '2024-06-15T14:00:00Z'
      }]);

      const result = service.parseJsonFile(json);

      expect(result[0].scheduledEnqueueTime).toBeInstanceOf(Date);
      expect(result[0].scheduledEnqueueTime!.toISOString()).toBe('2024-06-15T14:00:00.000Z');
    });

    it('should preserve all sendable fields', () => {
      const json = JSON.stringify([{
        body: 'Full message',
        contentType: 'text/plain',
        messageId: 'msg-full',
        correlationId: 'corr-full',
        sessionId: 'session-full',
        partitionKey: 'partition-1',
        subject: 'Full Subject',
        to: 'target-queue',
        replyTo: 'reply-queue',
        timeToLive: '01:00:00',
        applicationProperties: { env: 'test' }
      }]);

      const result = service.parseJsonFile(json);
      const msg = result[0];

      expect(msg.body).toBe('Full message');
      expect(msg.contentType).toBe('text/plain');
      expect(msg.messageId).toBe('msg-full');
      expect(msg.correlationId).toBe('corr-full');
      expect(msg.sessionId).toBe('session-full');
      expect(msg.partitionKey).toBe('partition-1');
      expect(msg.subject).toBe('Full Subject');
      expect(msg.to).toBe('target-queue');
      expect(msg.replyTo).toBe('reply-queue');
      expect(msg.timeToLive).toBe('01:00:00');
      expect(msg.applicationProperties).toEqual({ env: 'test' });
    });

    it('should stringify non-string body values', () => {
      const json = JSON.stringify([{
        body: { nested: 'object', count: 5 }
      }]);

      const result = service.parseJsonFile(json);

      expect(typeof result[0].body).toBe('string');
      expect(JSON.parse(result[0].body)).toEqual({ nested: 'object', count: 5 });
    });
  });

  // =========================================================================
  // parseCsvFile
  // =========================================================================

  describe('parseCsvFile', () => {
    it('should parse CSV with standard export headers', () => {
      const csv = [
        '"Sequence Number","Message ID","Correlation ID","Session ID","Partition Key","Subject","Content Type","Body","Body Type","Delivery Count","Enqueued Time","Scheduled Enqueue Time","Expires At","Time To Live","Reply To","Reply To Session ID","To","Dead Letter Source","Dead Letter Reason","Dead Letter Error Description"',
        '"1","msg-1","corr-1","","","Test Subject","application/json","Hello World","string","0","2024-01-15T10:30:00.000Z","","","14.00:00:00","","","","","",""'
      ].join('\n');

      const result = service.parseCsvFile(csv);

      expect(result).toHaveLength(1);
      expect(result[0].messageId).toBe('msg-1');
      expect(result[0].correlationId).toBe('corr-1');
      expect(result[0].subject).toBe('Test Subject');
      expect(result[0].contentType).toBe('application/json');
      expect(result[0].body).toBe('Hello World');
      expect(result[0].timeToLive).toBe('14.00:00:00');
      // Read-only fields should not be mapped
      expect((result[0] as any).sequenceNumber).toBeUndefined();
      expect((result[0] as any).deliveryCount).toBeUndefined();
      expect((result[0] as any).enqueuedTime).toBeUndefined();
    });

    it('should handle CSV with application properties column', () => {
      const csv = [
        '"Sequence Number","Message ID","Correlation ID","Session ID","Partition Key","Subject","Content Type","Body","Body Type","Delivery Count","Enqueued Time","Scheduled Enqueue Time","Expires At","Time To Live","Reply To","Reply To Session ID","To","Dead Letter Source","Dead Letter Reason","Dead Letter Error Description","Application Properties"',
        '"1","msg-1","","","","","application/json","test body","string","0","","","","","","","","","","","{""key1"":""value1"",""key2"":42}"'
      ].join('\n');

      const result = service.parseCsvFile(csv);

      expect(result).toHaveLength(1);
      expect(result[0].applicationProperties).toEqual({ key1: 'value1', key2: 42 });
    });

    it('should handle CSV with quoted fields containing commas', () => {
      const csv = [
        '"Message ID","Body","Subject"',
        '"msg-1","Hello, World","Subject, with comma"'
      ].join('\n');

      const result = service.parseCsvFile(csv);

      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('Hello, World');
      expect(result[0].subject).toBe('Subject, with comma');
    });

    it('should handle CSV with escaped double quotes', () => {
      const csv = [
        '"Message ID","Body"',
        '"msg-1","He said ""hello"" to me"'
      ].join('\n');

      const result = service.parseCsvFile(csv);

      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('He said "hello" to me');
    });

    it('should handle empty CSV file', () => {
      const result = service.parseCsvFile('');
      expect(result).toHaveLength(0);
    });

    it('should handle CSV with only headers (no data)', () => {
      const csv = '"Message ID","Body","Subject"';
      const result = service.parseCsvFile(csv);
      expect(result).toHaveLength(0);
    });

    it('should handle multiple data rows', () => {
      const csv = [
        '"Message ID","Body","Subject","Content Type"',
        '"msg-1","Body 1","Subject 1","application/json"',
        '"msg-2","Body 2","Subject 2","text/plain"',
        '"msg-3","Body 3","Subject 3","application/xml"'
      ].join('\n');

      const result = service.parseCsvFile(csv);

      expect(result).toHaveLength(3);
      expect(result[0].messageId).toBe('msg-1');
      expect(result[1].messageId).toBe('msg-2');
      expect(result[2].messageId).toBe('msg-3');
    });

    it('should skip empty rows', () => {
      const csv = [
        '"Message ID","Body"',
        '"msg-1","Body 1"',
        '',
        '"msg-2","Body 2"'
      ].join('\n');

      const result = service.parseCsvFile(csv);

      expect(result).toHaveLength(2);
    });

    it('should handle CSV with Windows-style line endings', () => {
      const csv = '"Message ID","Body"\r\n"msg-1","Hello"\r\n"msg-2","World"';

      const result = service.parseCsvFile(csv);

      expect(result).toHaveLength(2);
      expect(result[0].body).toBe('Hello');
      expect(result[1].body).toBe('World');
    });
  });

  // =========================================================================
  // parseFile (format detection)
  // =========================================================================

  describe('parseFile', () => {
    it('should detect JSON format from .json extension', () => {
      const json = JSON.stringify([{ body: 'Test' }]);
      const result = service.parseFile(json, 'messages.json');

      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('Test');
    });

    it('should detect CSV format from .csv extension', () => {
      const csv = '"Message ID","Body"\n"msg-1","Hello"';
      const result = service.parseFile(csv, 'export.csv');

      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('Hello');
    });

    it('should handle uppercase extension', () => {
      const json = JSON.stringify([{ body: 'Test' }]);
      const result = service.parseFile(json, 'messages.JSON');

      expect(result).toHaveLength(1);
    });

    it('should throw on unsupported extension', () => {
      expect(() => service.parseFile('data', 'file.xml'))
        .toThrow(/Unsupported file format.*\.xml/);
    });

    it('should throw on file without extension', () => {
      expect(() => service.parseFile('data', 'noextension'))
        .toThrow(/Unsupported file format/);
    });

    it('should handle filename with multiple dots', () => {
      const json = JSON.stringify([{ body: 'Test' }]);
      const result = service.parseFile(json, 'my.messages.export.json');

      expect(result).toHaveLength(1);
    });
  });
});
