import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MessageTemplateService } from './message-template.service';
import { MessageTemplate } from '../models';

describe('MessageTemplateService', () => {
  let service: MessageTemplateService;
  const STORAGE_KEY = 'explorer-messages-templates';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MessageTemplateService],
    });
    service = TestBed.inject(MessageTemplateService);
    localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getTemplates', () => {
    it('should return empty array when no templates exist', () => {
      const result = service.getTemplates();
      expect(result).toEqual([]);
    });

    it('should return empty array when localStorage has invalid JSON', () => {
      localStorage.setItem(STORAGE_KEY, 'invalid-json');
      const result = service.getTemplates();
      expect(result).toEqual([]);
    });

    it('should return empty array when localStorage has non-array JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{"not": "an array"}');
      const result = service.getTemplates();
      expect(result).toEqual([]);
    });

    it('should retrieve saved templates', () => {
      const templates: MessageTemplate[] = [
        {
          id: 'test-id-1',
          name: 'Template 1',
          body: '{"key":"value"}',
          contentType: 'application/json',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'test-id-2',
          name: 'Template 2',
          body: 'plain text body',
          contentType: 'text/plain',
          subject: 'Test Subject',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));

      const result = service.getTemplates();

      expect(result).toEqual(templates);
      expect(result.length).toBe(2);
      expect(result[0].name).toBe('Template 1');
      expect(result[1].subject).toBe('Test Subject');
    });
  });

  describe('saveTemplate', () => {
    it('should save template to localStorage', () => {
      const input = {
        name: 'My Template',
        body: '{"message":"hello"}',
        contentType: 'application/json',
      };

      const saved = service.saveTemplate(input);

      expect(saved.name).toBe('My Template');
      expect(saved.body).toBe('{"message":"hello"}');
      expect(saved.contentType).toBe('application/json');

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.length).toBe(1);
      expect(stored[0].name).toBe('My Template');
    });

    it('should generate unique IDs', () => {
      const input = {
        name: 'Template',
        body: 'body',
        contentType: 'text/plain',
      };

      const first = service.saveTemplate(input);
      const second = service.saveTemplate({ ...input, name: 'Template 2' });

      expect(first.id).toBeDefined();
      expect(second.id).toBeDefined();
      expect(first.id).not.toBe(second.id);
    });

    it('should set createdAt timestamp', () => {
      const before = new Date().toISOString();

      const saved = service.saveTemplate({
        name: 'Template',
        body: 'body',
        contentType: 'text/plain',
      });

      const after = new Date().toISOString();

      expect(saved.createdAt).toBeDefined();
      expect(saved.createdAt >= before).toBe(true);
      expect(saved.createdAt <= after).toBe(true);
    });

    it('should preserve optional fields', () => {
      const input = {
        name: 'Full Template',
        body: '{"data":true}',
        contentType: 'application/json',
        applicationProperties: { env: 'production', version: 2 },
        subject: 'Important',
        to: 'target-queue',
        replyTo: 'reply-queue',
      };

      const saved = service.saveTemplate(input);

      expect(saved.applicationProperties).toEqual({ env: 'production', version: 2 });
      expect(saved.subject).toBe('Important');
      expect(saved.to).toBe('target-queue');
      expect(saved.replyTo).toBe('reply-queue');
    });

    it('should append to existing templates', () => {
      service.saveTemplate({ name: 'First', body: 'a', contentType: 'text/plain' });
      service.saveTemplate({ name: 'Second', body: 'b', contentType: 'text/plain' });
      service.saveTemplate({ name: 'Third', body: 'c', contentType: 'text/plain' });

      const templates = service.getTemplates();
      expect(templates.length).toBe(3);
      expect(templates[0].name).toBe('First');
      expect(templates[1].name).toBe('Second');
      expect(templates[2].name).toBe('Third');
    });
  });

  describe('deleteTemplate', () => {
    it('should delete template by ID', () => {
      const t1 = service.saveTemplate({ name: 'Keep', body: 'a', contentType: 'text/plain' });
      const t2 = service.saveTemplate({ name: 'Delete', body: 'b', contentType: 'text/plain' });
      const t3 = service.saveTemplate({ name: 'Also Keep', body: 'c', contentType: 'text/plain' });

      service.deleteTemplate(t2.id);

      const remaining = service.getTemplates();
      expect(remaining.length).toBe(2);
      expect(remaining.find((t) => t.id === t2.id)).toBeUndefined();
      expect(remaining.find((t) => t.id === t1.id)).toBeDefined();
      expect(remaining.find((t) => t.id === t3.id)).toBeDefined();
    });

    it('should handle deleting non-existent ID gracefully', () => {
      service.saveTemplate({ name: 'Template', body: 'body', contentType: 'text/plain' });

      service.deleteTemplate('non-existent-id');

      const templates = service.getTemplates();
      expect(templates.length).toBe(1);
    });

    it('should handle deleting from empty storage', () => {
      expect(() => service.deleteTemplate('any-id')).not.toThrow();
      expect(service.getTemplates()).toEqual([]);
    });
  });
});
