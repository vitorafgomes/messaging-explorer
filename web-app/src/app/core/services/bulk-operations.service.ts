import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { MessageInfo } from '../models';

/**
 * Tab type for bulk operations
 * Represents either active messages or dead letter messages
 */
export type TabType = 'active' | 'deadletter';

/**
 * Selection state for a specific tab
 * Tracks which messages are currently selected
 */
export interface TabSelectionState {
  selectedSequenceNumbers: Set<number>;
  allSelected: boolean;
  indeterminate: boolean;
}

/**
 * Complete bulk operations state
 * Maintains separate selection state for active and dead letter tabs
 */
export interface BulkOperationsState {
  active: TabSelectionState;
  deadletter: TabSelectionState;
}

/**
 * Service for managing bulk selection state and coordinating operations across the application.
 * Provides centralized state management for message selection in both active and dead letter tabs.
 *
 * Key features:
 * - Separate state tracking for active and dead letter messages
 * - Observable state changes for reactive UI updates
 * - Methods for select/deselect/selectAll/clearAll operations
 * - Sequence number-based selection tracking
 */
@Injectable({
  providedIn: 'root'
})
export class BulkOperationsService {
  private stateSubject = new BehaviorSubject<BulkOperationsState>({
    active: {
      selectedSequenceNumbers: new Set<number>(),
      allSelected: false,
      indeterminate: false
    },
    deadletter: {
      selectedSequenceNumbers: new Set<number>(),
      allSelected: false,
      indeterminate: false
    }
  });

  /**
   * Observable for the complete bulk operations state
   * Emits whenever selection state changes for any tab
   */
  state$ = this.stateSubject.asObservable();

  /**
   * Observable for active messages selection state
   */
  activeSelection$ = this.state$.pipe(
    map(state => state.active)
  );

  /**
   * Observable for dead letter messages selection state
   */
  deadletterSelection$ = this.state$.pipe(
    map(state => state.deadletter)
  );

  /**
   * Gets the current complete state
   */
  get currentState(): BulkOperationsState {
    return this.stateSubject.value;
  }

  /**
   * Gets the selection state for a specific tab
   * @param tabType - The tab type (active or deadletter)
   * @returns The selection state for the specified tab
   */
  getTabState(tabType: TabType): TabSelectionState {
    return this.stateSubject.value[tabType];
  }

  /**
   * Gets the selected sequence numbers for a specific tab
   * @param tabType - The tab type (active or deadletter)
   * @returns Array of selected sequence numbers
   */
  getSelectedSequenceNumbers(tabType: TabType): number[] {
    return Array.from(this.stateSubject.value[tabType].selectedSequenceNumbers);
  }

  /**
   * Gets the count of selected messages for a specific tab
   * @param tabType - The tab type (active or deadletter)
   * @returns Number of selected messages
   */
  getSelectionCount(tabType: TabType): number {
    return this.stateSubject.value[tabType].selectedSequenceNumbers.size;
  }

  /**
   * Selects a single message by sequence number
   * @param tabType - The tab type (active or deadletter)
   * @param sequenceNumber - The sequence number of the message to select
   * @param totalMessages - Total number of messages in the current view (for indeterminate state calculation)
   */
  selectMessage(tabType: TabType, sequenceNumber: number, totalMessages: number): void {
    const currentState = this.stateSubject.value;
    const tabState = currentState[tabType];

    // Create a new Set with the added sequence number
    const newSelectedSequenceNumbers = new Set(tabState.selectedSequenceNumbers);
    newSelectedSequenceNumbers.add(sequenceNumber);

    // Update the tab state
    this.updateTabState(tabType, newSelectedSequenceNumbers, totalMessages);
  }

  /**
   * Deselects a single message by sequence number
   * @param tabType - The tab type (active or deadletter)
   * @param sequenceNumber - The sequence number of the message to deselect
   * @param totalMessages - Total number of messages in the current view (for indeterminate state calculation)
   */
  deselectMessage(tabType: TabType, sequenceNumber: number, totalMessages: number): void {
    const currentState = this.stateSubject.value;
    const tabState = currentState[tabType];

    // Create a new Set without the sequence number
    const newSelectedSequenceNumbers = new Set(tabState.selectedSequenceNumbers);
    newSelectedSequenceNumbers.delete(sequenceNumber);

    // Update the tab state
    this.updateTabState(tabType, newSelectedSequenceNumbers, totalMessages);
  }

  /**
   * Toggles selection for a single message
   * @param tabType - The tab type (active or deadletter)
   * @param sequenceNumber - The sequence number of the message to toggle
   * @param totalMessages - Total number of messages in the current view
   */
  toggleMessage(tabType: TabType, sequenceNumber: number, totalMessages: number): void {
    const tabState = this.stateSubject.value[tabType];

    if (tabState.selectedSequenceNumbers.has(sequenceNumber)) {
      this.deselectMessage(tabType, sequenceNumber, totalMessages);
    } else {
      this.selectMessage(tabType, sequenceNumber, totalMessages);
    }
  }

  /**
   * Selects all messages in the current view
   * @param tabType - The tab type (active or deadletter)
   * @param messages - Array of messages to select
   */
  selectAll(tabType: TabType, messages: MessageInfo[]): void {
    const sequenceNumbers = messages.map(msg => msg.sequenceNumber);
    const newSelectedSequenceNumbers = new Set(sequenceNumbers);

    this.updateTabState(tabType, newSelectedSequenceNumbers, messages.length);
  }

  /**
   * Clears all selections for a specific tab
   * @param tabType - The tab type (active or deadletter)
   */
  clearSelection(tabType: TabType): void {
    this.updateTabState(tabType, new Set<number>(), 0);
  }

  /**
   * Clears all selections for all tabs
   */
  clearAllSelections(): void {
    this.stateSubject.next({
      active: {
        selectedSequenceNumbers: new Set<number>(),
        allSelected: false,
        indeterminate: false
      },
      deadletter: {
        selectedSequenceNumbers: new Set<number>(),
        allSelected: false,
        indeterminate: false
      }
    });
  }

  /**
   * Checks if a specific message is selected
   * @param tabType - The tab type (active or deadletter)
   * @param sequenceNumber - The sequence number to check
   * @returns True if the message is selected, false otherwise
   */
  isSelected(tabType: TabType, sequenceNumber: number): boolean {
    return this.stateSubject.value[tabType].selectedSequenceNumbers.has(sequenceNumber);
  }

  /**
   * Checks if all messages are selected in a tab
   * @param tabType - The tab type (active or deadletter)
   * @returns True if all messages are selected, false otherwise
   */
  isAllSelected(tabType: TabType): boolean {
    return this.stateSubject.value[tabType].allSelected;
  }

  /**
   * Checks if selection is in indeterminate state (some but not all selected)
   * @param tabType - The tab type (active or deadletter)
   * @returns True if selection is indeterminate, false otherwise
   */
  isIndeterminate(tabType: TabType): boolean {
    return this.stateSubject.value[tabType].indeterminate;
  }

  /**
   * Updates the tab state with new selection
   * @param tabType - The tab type to update
   * @param selectedSequenceNumbers - New set of selected sequence numbers
   * @param totalMessages - Total number of messages in the current view
   */
  private updateTabState(tabType: TabType, selectedSequenceNumbers: Set<number>, totalMessages: number): void {
    const currentState = this.stateSubject.value;
    const selectedCount = selectedSequenceNumbers.size;

    // Calculate allSelected and indeterminate states
    const allSelected = totalMessages > 0 && selectedCount === totalMessages;
    const indeterminate = selectedCount > 0 && selectedCount < totalMessages;

    // Create new state with updated tab
    const newState: BulkOperationsState = {
      ...currentState,
      [tabType]: {
        selectedSequenceNumbers,
        allSelected,
        indeterminate
      }
    };

    this.stateSubject.next(newState);
  }
}
