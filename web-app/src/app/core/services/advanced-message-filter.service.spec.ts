import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AdvancedMessageFilterService } from './advanced-message-filter.service';
import { MessageSearchService } from './message-search.service';
import { MessageInfo } from '../models';
import {
  FilterCondition,
  FilterOperator,
  FilterLogic,
  AdvancedFilterState
} from '../models/filter.model';

describe('AdvancedMessageFilterService', () => {
  let service: AdvancedMessageFilterService;
  let messageSearchService: { isValidRegex: ReturnType<typeof vi.fn> };

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

  // Helper function to create filter condition
  const createCondition = (
    property: string,
    operator: FilterOperator,
    value?: string
  ): FilterCondition => ({
    id: Math.random().toString(36),
    property,
    operator,
    value
  });

  beforeEach(() => {
    const messageSearchServiceSpy = {
      isValidRegex: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        AdvancedMessageFilterService,
        { provide: MessageSearchService, useValue: messageSearchServiceSpy }
      ]
    });

    service = TestBed.inject(AdvancedMessageFilterService);
    messageSearchService = TestBed.inject(MessageSearchService) as any;

    // Clear sessionStorage before each test
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up sessionStorage after each test
    sessionStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('filterMessages', () => {
    it('should return all messages when no conditions provided', () => {
      const messages = [createMockMessage(), createMockMessage()];
      const filterState: AdvancedFilterState = {
        conditions: [],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(2);
    });

    it('should return all messages when conditions array is empty', () => {
      const messages = [createMockMessage(), createMockMessage()];
      const filterState: AdvancedFilterState = {
        conditions: [],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result).toEqual(messages);
    });
  });

  describe('AND logic filtering', () => {
    it('should return messages matching ALL conditions', () => {
      const messages = [
        createMockMessage({ messageId: 'msg-1', correlationId: 'corr-1', subject: 'Order' }),
        createMockMessage({ messageId: 'msg-2', correlationId: 'corr-1', subject: 'Invoice' }),
        createMockMessage({ messageId: 'msg-3', correlationId: 'corr-2', subject: 'Order' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [
          createCondition('correlationId', FilterOperator.Equals, 'corr-1'),
          createCondition('subject', FilterOperator.Equals, 'Order')
        ],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
      expect(result[0].messageId).toBe('msg-1');
    });

    it('should return empty array when not all conditions match', () => {
      const messages = [
        createMockMessage({ messageId: 'msg-1', correlationId: 'corr-1', subject: 'Order' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [
          createCondition('correlationId', FilterOperator.Equals, 'corr-1'),
          createCondition('subject', FilterOperator.Equals, 'Invoice')
        ],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(0);
    });

    it('should handle multiple conditions with AND logic', () => {
      const messages = [
        createMockMessage({
          messageId: 'msg-1',
          correlationId: 'corr-abc-123',
          subject: 'Test Order',
          contentType: 'application/json'
        }),
        createMockMessage({
          messageId: 'msg-2',
          correlationId: 'corr-abc-456',
          subject: 'Test Order',
          contentType: 'text/plain'
        })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [
          createCondition('correlationId', FilterOperator.Contains, 'abc'),
          createCondition('subject', FilterOperator.Contains, 'Order'),
          createCondition('contentType', FilterOperator.Equals, 'application/json')
        ],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
      expect(result[0].messageId).toBe('msg-1');
    });
  });

  describe('OR logic filtering', () => {
    it('should return messages matching ANY condition', () => {
      const messages = [
        createMockMessage({ messageId: 'msg-1', correlationId: 'corr-1', subject: 'Order' }),
        createMockMessage({ messageId: 'msg-2', correlationId: 'corr-2', subject: 'Invoice' }),
        createMockMessage({ messageId: 'msg-3', correlationId: 'corr-3', subject: 'Receipt' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [
          createCondition('correlationId', FilterOperator.Equals, 'corr-1'),
          createCondition('subject', FilterOperator.Equals, 'Invoice')
        ],
        logicOperator: FilterLogic.Or
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(2);
      expect(result.map(m => m.messageId)).toContain('msg-1');
      expect(result.map(m => m.messageId)).toContain('msg-2');
    });

    it('should return empty array when no conditions match', () => {
      const messages = [
        createMockMessage({ messageId: 'msg-1', correlationId: 'corr-1', subject: 'Order' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [
          createCondition('correlationId', FilterOperator.Equals, 'corr-999'),
          createCondition('subject', FilterOperator.Equals, 'Invoice')
        ],
        logicOperator: FilterLogic.Or
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(0);
    });

    it('should return all matching messages with OR logic', () => {
      const messages = [
        createMockMessage({ messageId: 'msg-1', subject: 'Order' }),
        createMockMessage({ messageId: 'msg-2', subject: 'Invoice' }),
        createMockMessage({ messageId: 'msg-3', subject: 'Receipt' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [
          createCondition('subject', FilterOperator.Equals, 'Order'),
          createCondition('subject', FilterOperator.Equals, 'Invoice'),
          createCondition('subject', FilterOperator.Equals, 'Receipt')
        ],
        logicOperator: FilterLogic.Or
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(3);
    });
  });

  describe('Equals operator', () => {
    it('should match messages with exact value (case-insensitive)', () => {
      const messages = [
        createMockMessage({ messageId: 'test-123' }),
        createMockMessage({ messageId: 'TEST-123' }),
        createMockMessage({ messageId: 'test-456' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('messageId', FilterOperator.Equals, 'test-123')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(2);
    });

    it('should not match partial values', () => {
      const messages = [
        createMockMessage({ subject: 'Order Confirmation' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('subject', FilterOperator.Equals, 'Order')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(0);
    });
  });

  describe('Contains operator', () => {
    it('should match messages containing the value (case-insensitive)', () => {
      const messages = [
        createMockMessage({ subject: 'Order Confirmation' }),
        createMockMessage({ subject: 'New Order Received' }),
        createMockMessage({ subject: 'Invoice Sent' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('subject', FilterOperator.Contains, 'order')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(2);
    });

    it('should match with different casing', () => {
      const messages = [
        createMockMessage({ subject: 'TEST MESSAGE' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('subject', FilterOperator.Contains, 'test')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
    });
  });

  describe('StartsWith operator', () => {
    it('should match messages starting with the value (case-insensitive)', () => {
      const messages = [
        createMockMessage({ messageId: 'order-123' }),
        createMockMessage({ messageId: 'ORDER-456' }),
        createMockMessage({ messageId: 'invoice-789' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('messageId', FilterOperator.StartsWith, 'order')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(2);
    });

    it('should not match if value is in the middle', () => {
      const messages = [
        createMockMessage({ subject: 'New Order' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('subject', FilterOperator.StartsWith, 'Order')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(0);
    });
  });

  describe('EndsWith operator', () => {
    it('should match messages ending with the value (case-insensitive)', () => {
      const messages = [
        createMockMessage({ contentType: 'application/json' }),
        createMockMessage({ contentType: 'application/xml' }),
        createMockMessage({ contentType: 'text/JSON' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('contentType', FilterOperator.EndsWith, 'json')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(2);
    });

    it('should not match if value is at the beginning', () => {
      const messages = [
        createMockMessage({ subject: 'Order Confirmation' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('subject', FilterOperator.EndsWith, 'Order')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(0);
    });
  });

  describe('Regex operator', () => {
    it('should match messages using valid regex pattern', () => {
      messageSearchService.isValidRegex.mockReturnValue(true);

      const messages = [
        createMockMessage({ messageId: 'order-123' }),
        createMockMessage({ messageId: 'order-456' }),
        createMockMessage({ messageId: 'invoice-789' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('messageId', FilterOperator.Regex, 'order-\\d+')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(2);
      expect(messageSearchService.isValidRegex).toHaveBeenCalledWith('order-\\d+');
    });

    it('should return no matches for invalid regex', () => {
      messageSearchService.isValidRegex.mockReturnValue(false);

      const messages = [
        createMockMessage({ messageId: 'order-123' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('messageId', FilterOperator.Regex, '[invalid')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(0);
      expect(messageSearchService.isValidRegex).toHaveBeenCalledWith('[invalid');
    });

    it('should be case-insensitive by default', () => {
      messageSearchService.isValidRegex.mockReturnValue(true);

      const messages = [
        createMockMessage({ subject: 'ERROR: failed' }),
        createMockMessage({ subject: 'error: failed' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('subject', FilterOperator.Regex, 'ERROR')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(2);
    });

    it('should handle complex regex patterns', () => {
      messageSearchService.isValidRegex.mockReturnValue(true);

      const messages = [
        createMockMessage({ correlationId: 'email@example.com' }),
        createMockMessage({ correlationId: 'test@test.org' }),
        createMockMessage({ correlationId: 'not-an-email' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('correlationId', FilterOperator.Regex, '\\S+@\\S+\\.\\S+')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(2);
    });
  });

  describe('IsEmpty operator', () => {
    it('should match messages with empty property', () => {
      const messages = [
        createMockMessage({ correlationId: '' }),
        createMockMessage({ correlationId: 'corr-123' }),
        createMockMessage({ correlationId: undefined })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('correlationId', FilterOperator.IsEmpty)],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(2);
    });

    it('should match messages with whitespace-only property', () => {
      const messages = [
        createMockMessage({ subject: '   ' }),
        createMockMessage({ subject: 'Test' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('subject', FilterOperator.IsEmpty)],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
    });

    it('should not require a value parameter', () => {
      const messages = [
        createMockMessage({ sessionId: undefined })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('sessionId', FilterOperator.IsEmpty)],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
    });
  });

  describe('IsNotEmpty operator', () => {
    it('should match messages with non-empty property', () => {
      const messages = [
        createMockMessage({ correlationId: 'corr-123' }),
        createMockMessage({ correlationId: '' }),
        createMockMessage({ correlationId: undefined })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('correlationId', FilterOperator.IsNotEmpty)],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
      expect(result[0].correlationId).toBe('corr-123');
    });

    it('should not match whitespace-only property', () => {
      const messages = [
        createMockMessage({ subject: '   ' }),
        createMockMessage({ subject: 'Test' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('subject', FilterOperator.IsNotEmpty)],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
      expect(result[0].subject).toBe('Test');
    });
  });

  describe('Custom property filtering', () => {
    it('should filter by custom application properties', () => {
      const messages = [
        createMockMessage({ applicationProperties: { userId: '123' } }),
        createMockMessage({ applicationProperties: { userId: '456' } }),
        createMockMessage({ applicationProperties: { orderId: '789' } })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('customProperty:userId', FilterOperator.Equals, '123')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
      expect(result[0].applicationProperties!['userId']).toBe('123');
    });

    it('should handle custom properties with different operators', () => {
      const messages = [
        createMockMessage({ applicationProperties: { status: 'completed' } }),
        createMockMessage({ applicationProperties: { status: 'pending' } }),
        createMockMessage({ applicationProperties: { status: 'completed-with-errors' } })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('customProperty:status', FilterOperator.Contains, 'completed')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(2);
    });

    it('should return no matches when custom property does not exist', () => {
      const messages = [
        createMockMessage({ applicationProperties: { userId: '123' } })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('customProperty:orderId', FilterOperator.Equals, '456')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(0);
    });

    it('should handle messages with no application properties', () => {
      const messages = [
        createMockMessage({ applicationProperties: undefined })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('customProperty:userId', FilterOperator.Equals, '123')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(0);
    });

    it('should convert custom property values to string', () => {
      const messages = [
        createMockMessage({ applicationProperties: { count: 42 } }),
        createMockMessage({ applicationProperties: { count: 100 } })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('customProperty:count', FilterOperator.Equals, '42')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
    });

    it('should handle null custom property values', () => {
      const messages = [
        createMockMessage({ applicationProperties: { value: null } })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('customProperty:value', FilterOperator.IsEmpty)],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
    });
  });

  describe('Standard message properties', () => {
    it('should filter by messageId', () => {
      const messages = [
        createMockMessage({ messageId: 'msg-123' }),
        createMockMessage({ messageId: 'msg-456' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('messageId', FilterOperator.Equals, 'msg-123')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
    });

    it('should filter by sessionId', () => {
      const messages = [
        createMockMessage({ sessionId: 'session-abc' }),
        createMockMessage({ sessionId: 'session-def' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('sessionId', FilterOperator.Contains, 'abc')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
    });

    it('should filter by partitionKey', () => {
      const messages = [
        createMockMessage({ partitionKey: 'partition-1' }),
        createMockMessage({ partitionKey: 'partition-2' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('partitionKey', FilterOperator.StartsWith, 'partition-1')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
    });

    it('should filter by replyTo', () => {
      const messages = [
        createMockMessage({ replyTo: 'queue-a' }),
        createMockMessage({ replyTo: 'queue-b' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('replyTo', FilterOperator.Equals, 'queue-a')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
    });

    it('should filter by to', () => {
      const messages = [
        createMockMessage({ to: 'destination-1' }),
        createMockMessage({ to: 'destination-2' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('to', FilterOperator.EndsWith, '1')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
    });
  });

  describe('Session persistence', () => {
    it('should save filter state to sessionStorage', () => {
      const filterState: AdvancedFilterState = {
        conditions: [createCondition('messageId', FilterOperator.Equals, 'test')],
        logicOperator: FilterLogic.And
      };

      service.saveFilterState('queue', 'my-queue', filterState);

      const stored = sessionStorage.getItem('advanced-filter-queue-my-queue');
      expect(stored).toBeTruthy();

      const parsed = JSON.parse(stored!);
      expect(parsed.logicOperator).toBe(FilterLogic.And);
      expect(parsed.conditions.length).toBe(1);
    });

    it('should load filter state from sessionStorage', () => {
      const filterState: AdvancedFilterState = {
        conditions: [
          createCondition('correlationId', FilterOperator.Contains, 'test-123')
        ],
        logicOperator: FilterLogic.Or
      };

      sessionStorage.setItem('advanced-filter-subscription-my-sub', JSON.stringify(filterState));

      const loaded = service.loadFilterState('subscription', 'my-sub');
      expect(loaded.logicOperator).toBe(FilterLogic.Or);
      expect(loaded.conditions.length).toBe(1);
      expect(loaded.conditions[0].property).toBe('correlationId');
      expect(loaded.conditions[0].value).toBe('test-123');
    });

    it('should return default state when nothing stored', () => {
      const loaded = service.loadFilterState('queue', 'non-existent');

      expect(loaded.conditions).toEqual([]);
      expect(loaded.logicOperator).toBe(FilterLogic.And);
    });

    it('should clear filter state from sessionStorage', () => {
      const filterState: AdvancedFilterState = {
        conditions: [createCondition('messageId', FilterOperator.Equals, 'test')],
        logicOperator: FilterLogic.And
      };

      service.saveFilterState('queue', 'my-queue', filterState);
      expect(sessionStorage.getItem('advanced-filter-queue-my-queue')).toBeTruthy();

      service.clearFilterState('queue', 'my-queue');
      expect(sessionStorage.getItem('advanced-filter-queue-my-queue')).toBeNull();
    });

    it('should scope filters by entity type and name', () => {
      const filterState1: AdvancedFilterState = {
        conditions: [createCondition('messageId', FilterOperator.Equals, 'test-1')],
        logicOperator: FilterLogic.And
      };

      const filterState2: AdvancedFilterState = {
        conditions: [createCondition('messageId', FilterOperator.Equals, 'test-2')],
        logicOperator: FilterLogic.Or
      };

      service.saveFilterState('queue', 'queue-1', filterState1);
      service.saveFilterState('queue', 'queue-2', filterState2);

      const loaded1 = service.loadFilterState('queue', 'queue-1');
      const loaded2 = service.loadFilterState('queue', 'queue-2');

      expect(loaded1.conditions[0].value).toBe('test-1');
      expect(loaded2.conditions[0].value).toBe('test-2');
      expect(loaded1.logicOperator).toBe(FilterLogic.And);
      expect(loaded2.logicOperator).toBe(FilterLogic.Or);
    });

    it('should handle sessionStorage errors gracefully when saving', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage error'); });
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const filterState: AdvancedFilterState = {
        conditions: [],
        logicOperator: FilterLogic.And
      };

      expect(() => {
        service.saveFilterState('queue', 'my-queue', filterState);
      }).not.toThrow();

      expect(console.warn).toHaveBeenCalled();
    });

    it('should handle sessionStorage errors gracefully when loading', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage error'); });
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const loaded = service.loadFilterState('queue', 'my-queue');

      expect(loaded.conditions).toEqual([]);
      expect(loaded.logicOperator).toBe(FilterLogic.And);
      expect(console.warn).toHaveBeenCalled();
    });

    it('should handle JSON parse errors gracefully when loading', () => {
      sessionStorage.setItem('advanced-filter-queue-my-queue', 'invalid-json{');
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const loaded = service.loadFilterState('queue', 'my-queue');

      expect(loaded.conditions).toEqual([]);
      expect(loaded.logicOperator).toBe(FilterLogic.And);
      expect(console.warn).toHaveBeenCalled();
    });

    it('should handle sessionStorage errors gracefully when clearing', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Storage error'); });
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        service.clearFilterState('queue', 'my-queue');
      }).not.toThrow();

      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('extractCustomPropertyNames', () => {
    it('should extract unique custom property names from messages', () => {
      const messages = [
        createMockMessage({ applicationProperties: { userId: '123', orderId: '456' } }),
        createMockMessage({ applicationProperties: { userId: '789', status: 'completed' } }),
        createMockMessage({ applicationProperties: { orderId: '101', priority: 'high' } })
      ];

      const propertyNames = service.extractCustomPropertyNames(messages);

      expect(propertyNames.length).toBe(4);
      expect(propertyNames).toContain('userId');
      expect(propertyNames).toContain('orderId');
      expect(propertyNames).toContain('status');
      expect(propertyNames).toContain('priority');
    });

    it('should return sorted property names', () => {
      const messages = [
        createMockMessage({ applicationProperties: { zebra: '1', alpha: '2', middle: '3' } })
      ];

      const propertyNames = service.extractCustomPropertyNames(messages);

      expect(propertyNames).toEqual(['alpha', 'middle', 'zebra']);
    });

    it('should handle messages with no application properties', () => {
      const messages = [
        createMockMessage({ applicationProperties: undefined }),
        createMockMessage({ applicationProperties: {} })
      ];

      const propertyNames = service.extractCustomPropertyNames(messages);

      expect(propertyNames.length).toBe(0);
    });

    it('should deduplicate property names', () => {
      const messages = [
        createMockMessage({ applicationProperties: { userId: '123' } }),
        createMockMessage({ applicationProperties: { userId: '456' } }),
        createMockMessage({ applicationProperties: { userId: '789' } })
      ];

      const propertyNames = service.extractCustomPropertyNames(messages);

      expect(propertyNames.length).toBe(1);
      expect(propertyNames[0]).toBe('userId');
    });

    it('should handle empty message array', () => {
      const propertyNames = service.extractCustomPropertyNames([]);

      expect(propertyNames.length).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty property values', () => {
      const messages = [
        createMockMessage({ correlationId: undefined }),
        createMockMessage({ correlationId: '' }),
        createMockMessage({ correlationId: null as any })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('correlationId', FilterOperator.Equals, 'test')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(0);
    });

    it('should handle condition without value for comparison operators', () => {
      const messages = [
        createMockMessage({ messageId: 'test-123' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('messageId', FilterOperator.Equals, undefined)],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(0);
    });

    it('should handle unknown property gracefully', () => {
      const messages = [
        createMockMessage({ messageId: 'test-123' })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [createCondition('unknownProperty', FilterOperator.Equals, 'test')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(0);
    });

    it('should handle empty messages array', () => {
      const filterState: AdvancedFilterState = {
        conditions: [createCondition('messageId', FilterOperator.Equals, 'test')],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages([], filterState);
      expect(result.length).toBe(0);
    });

    it('should handle multiple filters with mixed operators', () => {
      const messages = [
        createMockMessage({
          messageId: 'order-123',
          correlationId: 'corr-abc-456',
          subject: 'Order Confirmation',
          contentType: 'application/json',
          sessionId: undefined
        }),
        createMockMessage({
          messageId: 'order-456',
          correlationId: 'corr-xyz-789',
          subject: 'Order Notification',
          contentType: 'text/plain',
          sessionId: 'session-1'
        })
      ];

      const filterState: AdvancedFilterState = {
        conditions: [
          createCondition('messageId', FilterOperator.StartsWith, 'order'),
          createCondition('correlationId', FilterOperator.Contains, 'abc'),
          createCondition('subject', FilterOperator.Contains, 'Confirmation'),
          createCondition('sessionId', FilterOperator.IsEmpty)
        ],
        logicOperator: FilterLogic.And
      };

      const result = service.filterMessages(messages, filterState);
      expect(result.length).toBe(1);
      expect(result[0].messageId).toBe('order-123');
    });
  });
});
