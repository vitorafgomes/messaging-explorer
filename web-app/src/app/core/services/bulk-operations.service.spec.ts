import { TestBed } from '@angular/core/testing';
import { BulkOperationsService, TabType, BulkOperationsState } from './bulk-operations.service';
import { MessageInfo } from '../models';

describe('BulkOperationsService', () => {
  let service: BulkOperationsService;

  // Helper function to create mock messages
  const createMockMessage = (sequenceNumber: number, overrides: Partial<MessageInfo> = {}): MessageInfo => ({
    messageId: `test-message-${sequenceNumber}`,
    body: `Test message body ${sequenceNumber}`,
    bodyType: 'string',
    sequenceNumber,
    deliveryCount: 0,
    enqueuedTime: new Date(),
    timeToLive: '14.00:00:00',
    applicationProperties: {},
    ...overrides
  });

  // Helper to create an array of mock messages
  const createMockMessages = (count: number, startSequence: number = 1): MessageInfo[] => {
    return Array.from({ length: count }, (_, i) => createMockMessage(startSequence + i));
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [BulkOperationsService]
    });
    service = TestBed.inject(BulkOperationsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should initialize with empty selections for both tabs', () => {
      const state = service.currentState;

      expect(state.active.selectedSequenceNumbers.size).toBe(0);
      expect(state.active.allSelected).toBe(false);
      expect(state.active.indeterminate).toBe(false);

      expect(state.deadletter.selectedSequenceNumbers.size).toBe(0);
      expect(state.deadletter.allSelected).toBe(false);
      expect(state.deadletter.indeterminate).toBe(false);
    });

    it('should provide empty selection counts for both tabs', () => {
      expect(service.getSelectionCount('active')).toBe(0);
      expect(service.getSelectionCount('deadletter')).toBe(0);
    });

    it('should provide empty sequence number arrays for both tabs', () => {
      expect(service.getSelectedSequenceNumbers('active')).toEqual([]);
      expect(service.getSelectedSequenceNumbers('deadletter')).toEqual([]);
    });
  });

  describe('state observables', () => {
    it('should emit state changes via state$', async () => {
      const promise = new Promise<void>((resolve) => {
        let emissionCount = 0;
        service.state$.subscribe(state => {
          emissionCount++;
          if (emissionCount === 2) {
            // Second emission should include the selection
            expect(state.active.selectedSequenceNumbers.size).toBe(1);
            expect(state.active.selectedSequenceNumbers.has(1)).toBe(true);
            resolve();
          }
        });
      });

      service.selectMessage('active', 1, 5);
      await promise;
    });

    it('should emit active selection changes via activeSelection$', async () => {
      const promise = new Promise<void>((resolve) => {
        let emissionCount = 0;
        service.activeSelection$.subscribe(state => {
          emissionCount++;
          if (emissionCount === 2) {
            expect(state.selectedSequenceNumbers.size).toBe(1);
            expect(state.selectedSequenceNumbers.has(10)).toBe(true);
            resolve();
          }
        });
      });

      service.selectMessage('active', 10, 5);
      await promise;
    });

    it('should emit deadletter selection changes via deadletterSelection$', async () => {
      const promise = new Promise<void>((resolve) => {
        let emissionCount = 0;
        service.deadletterSelection$.subscribe(state => {
          emissionCount++;
          if (emissionCount === 2) {
            expect(state.selectedSequenceNumbers.size).toBe(1);
            expect(state.selectedSequenceNumbers.has(20)).toBe(true);
            resolve();
          }
        });
      });

      service.selectMessage('deadletter', 20, 5);
      await promise;
    });

    it('should not affect other tab when selecting in one tab', async () => {
      service.selectMessage('active', 1, 5);

      const promise = new Promise<void>((resolve) => {
        service.state$.subscribe(state => {
          if (state.active.selectedSequenceNumbers.size > 0) {
            expect(state.active.selectedSequenceNumbers.has(1)).toBe(true);
            expect(state.deadletter.selectedSequenceNumbers.size).toBe(0);
            resolve();
          }
        });
      });

      await promise;
    });
  });

  describe('selectMessage', () => {
    it('should select a single message in active tab', () => {
      service.selectMessage('active', 1, 5);

      expect(service.isSelected('active', 1)).toBe(true);
      expect(service.getSelectionCount('active')).toBe(1);
    });

    it('should select a single message in deadletter tab', () => {
      service.selectMessage('deadletter', 10, 5);

      expect(service.isSelected('deadletter', 10)).toBe(true);
      expect(service.getSelectionCount('deadletter')).toBe(1);
    });

    it('should select multiple messages', () => {
      service.selectMessage('active', 1, 5);
      service.selectMessage('active', 2, 5);
      service.selectMessage('active', 3, 5);

      expect(service.getSelectionCount('active')).toBe(3);
      expect(service.isSelected('active', 1)).toBe(true);
      expect(service.isSelected('active', 2)).toBe(true);
      expect(service.isSelected('active', 3)).toBe(true);
    });

    it('should set indeterminate state when some messages selected', () => {
      service.selectMessage('active', 1, 5);

      expect(service.isIndeterminate('active')).toBe(true);
      expect(service.isAllSelected('active')).toBe(false);
    });

    it('should set allSelected when all messages selected individually', () => {
      service.selectMessage('active', 1, 3);
      service.selectMessage('active', 2, 3);
      service.selectMessage('active', 3, 3);

      expect(service.isAllSelected('active')).toBe(true);
      expect(service.isIndeterminate('active')).toBe(false);
    });

    it('should not duplicate selection of same message', () => {
      service.selectMessage('active', 1, 5);
      service.selectMessage('active', 1, 5);

      expect(service.getSelectionCount('active')).toBe(1);
    });
  });

  describe('deselectMessage', () => {
    it('should deselect a previously selected message', () => {
      service.selectMessage('active', 1, 5);
      expect(service.isSelected('active', 1)).toBe(true);

      service.deselectMessage('active', 1, 5);
      expect(service.isSelected('active', 1)).toBe(false);
      expect(service.getSelectionCount('active')).toBe(0);
    });

    it('should update indeterminate state after deselection', () => {
      service.selectMessage('active', 1, 5);
      service.selectMessage('active', 2, 5);
      expect(service.isIndeterminate('active')).toBe(true);

      service.deselectMessage('active', 1, 5);
      expect(service.isIndeterminate('active')).toBe(true);
      expect(service.getSelectionCount('active')).toBe(1);
    });

    it('should clear indeterminate and allSelected when deselecting all', () => {
      service.selectMessage('active', 1, 2);
      service.selectMessage('active', 2, 2);
      expect(service.isAllSelected('active')).toBe(true);

      service.deselectMessage('active', 1, 2);
      service.deselectMessage('active', 2, 2);

      expect(service.isAllSelected('active')).toBe(false);
      expect(service.isIndeterminate('active')).toBe(false);
      expect(service.getSelectionCount('active')).toBe(0);
    });

    it('should handle deselecting non-selected message gracefully', () => {
      service.deselectMessage('active', 999, 5);
      expect(service.getSelectionCount('active')).toBe(0);
    });
  });

  describe('toggleMessage', () => {
    it('should select message when not currently selected', () => {
      service.toggleMessage('active', 1, 5);
      expect(service.isSelected('active', 1)).toBe(true);
    });

    it('should deselect message when currently selected', () => {
      service.selectMessage('active', 1, 5);
      expect(service.isSelected('active', 1)).toBe(true);

      service.toggleMessage('active', 1, 5);
      expect(service.isSelected('active', 1)).toBe(false);
    });

    it('should toggle multiple times correctly', () => {
      service.toggleMessage('active', 1, 5);
      expect(service.isSelected('active', 1)).toBe(true);

      service.toggleMessage('active', 1, 5);
      expect(service.isSelected('active', 1)).toBe(false);

      service.toggleMessage('active', 1, 5);
      expect(service.isSelected('active', 1)).toBe(true);
    });
  });

  describe('selectAll', () => {
    it('should select all messages in the provided array', () => {
      const messages = createMockMessages(5);
      service.selectAll('active', messages);

      expect(service.getSelectionCount('active')).toBe(5);
      expect(service.isAllSelected('active')).toBe(true);
      expect(service.isIndeterminate('active')).toBe(false);
    });

    it('should replace previous selection with new selection', () => {
      service.selectMessage('active', 1, 10);
      service.selectMessage('active', 2, 10);

      const messages = createMockMessages(5, 10);
      service.selectAll('active', messages);

      expect(service.getSelectionCount('active')).toBe(5);
      expect(service.isSelected('active', 1)).toBe(false);
      expect(service.isSelected('active', 10)).toBe(true);
    });

    it('should handle empty message array', () => {
      service.selectAll('active', []);

      expect(service.getSelectionCount('active')).toBe(0);
      expect(service.isAllSelected('active')).toBe(false);
      expect(service.isIndeterminate('active')).toBe(false);
    });

    it('should select all in one tab without affecting other tab', () => {
      const activeMessages = createMockMessages(3, 1);
      const deadletterMessages = createMockMessages(2, 10);

      service.selectAll('active', activeMessages);
      service.selectMessage('deadletter', 10, 2);

      expect(service.getSelectionCount('active')).toBe(3);
      expect(service.getSelectionCount('deadletter')).toBe(1);
    });
  });

  describe('clearSelection', () => {
    it('should clear all selections in active tab', () => {
      const messages = createMockMessages(5);
      service.selectAll('active', messages);
      expect(service.getSelectionCount('active')).toBe(5);

      service.clearSelection('active');

      expect(service.getSelectionCount('active')).toBe(0);
      expect(service.isAllSelected('active')).toBe(false);
      expect(service.isIndeterminate('active')).toBe(false);
    });

    it('should clear all selections in deadletter tab', () => {
      const messages = createMockMessages(3);
      service.selectAll('deadletter', messages);
      expect(service.getSelectionCount('deadletter')).toBe(3);

      service.clearSelection('deadletter');

      expect(service.getSelectionCount('deadletter')).toBe(0);
    });

    it('should only clear specified tab', () => {
      service.selectMessage('active', 1, 5);
      service.selectMessage('deadletter', 10, 5);

      service.clearSelection('active');

      expect(service.getSelectionCount('active')).toBe(0);
      expect(service.getSelectionCount('deadletter')).toBe(1);
    });

    it('should handle clearing empty selection gracefully', () => {
      service.clearSelection('active');
      expect(service.getSelectionCount('active')).toBe(0);
    });
  });

  describe('clearAllSelections', () => {
    it('should clear selections in both tabs', () => {
      service.selectMessage('active', 1, 5);
      service.selectMessage('deadletter', 10, 5);

      service.clearAllSelections();

      expect(service.getSelectionCount('active')).toBe(0);
      expect(service.getSelectionCount('deadletter')).toBe(0);
    });

    it('should reset all state flags', () => {
      const activeMessages = createMockMessages(3);
      const deadletterMessages = createMockMessages(2);

      service.selectAll('active', activeMessages);
      service.selectAll('deadletter', deadletterMessages);

      service.clearAllSelections();

      const state = service.currentState;
      expect(state.active.allSelected).toBe(false);
      expect(state.active.indeterminate).toBe(false);
      expect(state.deadletter.allSelected).toBe(false);
      expect(state.deadletter.indeterminate).toBe(false);
    });
  });

  describe('getTabState', () => {
    it('should return correct state for active tab', () => {
      service.selectMessage('active', 1, 5);

      const tabState = service.getTabState('active');
      expect(tabState.selectedSequenceNumbers.has(1)).toBe(true);
      expect(tabState.indeterminate).toBe(true);
    });

    it('should return correct state for deadletter tab', () => {
      const messages = createMockMessages(2);
      service.selectAll('deadletter', messages);

      const tabState = service.getTabState('deadletter');
      expect(tabState.selectedSequenceNumbers.size).toBe(2);
      expect(tabState.allSelected).toBe(true);
    });
  });

  describe('getSelectedSequenceNumbers', () => {
    it('should return array of selected sequence numbers', () => {
      service.selectMessage('active', 1, 5);
      service.selectMessage('active', 5, 5);
      service.selectMessage('active', 10, 5);

      const sequenceNumbers = service.getSelectedSequenceNumbers('active');
      expect(sequenceNumbers).toContain(1);
      expect(sequenceNumbers).toContain(5);
      expect(sequenceNumbers).toContain(10);
      expect(sequenceNumbers.length).toBe(3);
    });

    it('should return empty array when no selection', () => {
      const sequenceNumbers = service.getSelectedSequenceNumbers('active');
      expect(sequenceNumbers).toEqual([]);
    });

    it('should return independent arrays for different tabs', () => {
      service.selectMessage('active', 1, 5);
      service.selectMessage('deadletter', 10, 5);

      const activeNumbers = service.getSelectedSequenceNumbers('active');
      const deadletterNumbers = service.getSelectedSequenceNumbers('deadletter');

      expect(activeNumbers).toEqual([1]);
      expect(deadletterNumbers).toEqual([10]);
    });
  });

  describe('isSelected', () => {
    it('should return true for selected message', () => {
      service.selectMessage('active', 5, 10);
      expect(service.isSelected('active', 5)).toBe(true);
    });

    it('should return false for non-selected message', () => {
      service.selectMessage('active', 5, 10);
      expect(service.isSelected('active', 3)).toBe(false);
    });

    it('should return false for message in different tab', () => {
      service.selectMessage('active', 5, 10);
      expect(service.isSelected('deadletter', 5)).toBe(false);
    });
  });

  describe('isAllSelected', () => {
    it('should return true when all messages are selected', () => {
      const messages = createMockMessages(3);
      service.selectAll('active', messages);
      expect(service.isAllSelected('active')).toBe(true);
    });

    it('should return false when some messages are selected', () => {
      service.selectMessage('active', 1, 5);
      expect(service.isAllSelected('active')).toBe(false);
    });

    it('should return false when no messages are selected', () => {
      expect(service.isAllSelected('active')).toBe(false);
    });
  });

  describe('isIndeterminate', () => {
    it('should return true when some but not all messages selected', () => {
      service.selectMessage('active', 1, 5);
      service.selectMessage('active', 2, 5);
      expect(service.isIndeterminate('active')).toBe(true);
    });

    it('should return false when all messages selected', () => {
      const messages = createMockMessages(3);
      service.selectAll('active', messages);
      expect(service.isIndeterminate('active')).toBe(false);
    });

    it('should return false when no messages selected', () => {
      expect(service.isIndeterminate('active')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle large selections efficiently', () => {
      const messages = createMockMessages(1000);
      service.selectAll('active', messages);

      expect(service.getSelectionCount('active')).toBe(1000);
      expect(service.isAllSelected('active')).toBe(true);
    });

    it('should handle sequence numbers with large values', () => {
      service.selectMessage('active', 9999999999, 5);
      expect(service.isSelected('active', 9999999999)).toBe(true);
    });

    it('should maintain separate state between tabs during complex operations', () => {
      const activeMessages = createMockMessages(5, 1);
      const deadletterMessages = createMockMessages(3, 100);

      service.selectAll('active', activeMessages);
      service.selectMessage('deadletter', 100, 3);
      service.deselectMessage('active', 1, 5);
      service.selectMessage('deadletter', 101, 3);

      expect(service.getSelectionCount('active')).toBe(4);
      expect(service.getSelectionCount('deadletter')).toBe(2);
      expect(service.isIndeterminate('active')).toBe(true);
      expect(service.isIndeterminate('deadletter')).toBe(true);
    });

    it('should handle rapid selection/deselection', () => {
      for (let i = 0; i < 100; i++) {
        service.toggleMessage('active', 1, 10);
      }

      expect(service.isSelected('active', 1)).toBe(false);
      expect(service.getSelectionCount('active')).toBe(0);
    });
  });

  describe('state immutability', () => {
    it('should not mutate state when getting selected sequence numbers', () => {
      service.selectMessage('active', 1, 5);
      const numbers1 = service.getSelectedSequenceNumbers('active');
      numbers1.push(999);

      const numbers2 = service.getSelectedSequenceNumbers('active');
      expect(numbers2).not.toContain(999);
      expect(numbers2.length).toBe(1);
    });

    it('should not mutate state when getting tab state', () => {
      service.selectMessage('active', 1, 5);
      const state = service.getTabState('active');
      state.selectedSequenceNumbers.add(999);

      expect(service.isSelected('active', 999)).toBe(false);
    });
  });
});
