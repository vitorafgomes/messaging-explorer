import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdvancedFilterPanelComponent } from './advanced-filter-panel.component';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
  FilterOperator,
  FilterLogic,
  AdvancedFilterState
} from '../../../core/models/filter.model';
import { MessageInfo } from '../../../core/models';
import { AdvancedMessageFilterService } from '../../../core/services';

describe('AdvancedFilterPanelComponent', () => {
  let component: AdvancedFilterPanelComponent;
  let fixture: ComponentFixture<AdvancedFilterPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdvancedFilterPanelComponent, NoopAnimationsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(AdvancedFilterPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize with empty filter state', () => {
    expect(component.filterState.conditions).toEqual([]);
    expect(component.filterState.logicOperator).toBe(FilterLogic.And);
  });

  it('should add a new filter condition', () => {
    const initialLength = component.filterState.conditions.length;

    component.addCondition();

    expect(component.filterState.conditions.length).toBe(initialLength + 1);
    expect(component.filterState.conditions[0].property).toBe('messageId');
    expect(component.filterState.conditions[0].operator).toBe(FilterOperator.Contains);
  });

  it('should remove a filter condition', () => {
    component.addCondition();
    const conditionId = component.filterState.conditions[0].id;

    component.removeCondition(conditionId);

    expect(component.filterState.conditions.length).toBe(0);
  });

  it('should clear all filters', () => {
    component.addCondition();
    component.addCondition();

    component.clearAllFilters();

    expect(component.filterState.conditions.length).toBe(0);
    expect(component.customPropertyName).toEqual({});
  });

  it('should emit filterStateChange when condition is added', async () => {
    const promise = new Promise<void>((resolve) => {
      component.filterStateChange.subscribe((state: AdvancedFilterState) => {
        expect(state.conditions.length).toBe(1);
        resolve();
      });
    });

    component.addCondition();
    await promise;
  });

  it('should emit filterStateChange when condition is removed', async () => {
    component.addCondition();
    const conditionId = component.filterState.conditions[0].id;

    const promise = new Promise<void>((resolve) => {
      let emitCount = 0;
      component.filterStateChange.subscribe((state: AdvancedFilterState) => {
        emitCount++;
        // First emit is from addCondition, second is from removeCondition
        if (emitCount === 2) {
          expect(state.conditions.length).toBe(0);
          resolve();
        }
      });
    });

    component.removeCondition(conditionId);
    await promise;
  });

  it('should emit filterStateChange when logic operator changes', async () => {
    component.addCondition();
    component.addCondition();

    const promise = new Promise<void>((resolve) => {
      let emitCount = 0;
      component.filterStateChange.subscribe((state: AdvancedFilterState) => {
        emitCount++;
        // First two emits are from addCondition calls
        if (emitCount === 3) {
          expect(state.logicOperator).toBe(FilterLogic.Or);
          resolve();
        }
      });
    });

    component.filterState.logicOperator = FilterLogic.Or;
    component['onFilterStateChange']();
    await promise;
  });

  it('should handle custom property selection', () => {
    component.addCondition();
    const condition = component.filterState.conditions[0];

    component.onPropertyChange(condition);

    // Should initialize custom property name mapping
    expect(component.customPropertyName[condition.id]).toBeDefined();
  });

  it('should update custom property name', () => {
    component.addCondition();
    const condition = component.filterState.conditions[0];
    condition.property = 'customProperty';

    component.onCustomPropertyNameChange(condition, 'myCustomProp');

    expect(component.customPropertyName[condition.id]).toBe('myCustomProp');
    expect(condition.property).toBe('customProperty:myCustomProp');
  });

  it('should clear value when operator does not require value', () => {
    component.addCondition();
    const condition = component.filterState.conditions[0];
    condition.value = 'test value';
    condition.operator = FilterOperator.IsEmpty;

    component.onOperatorChange(condition);

    expect(condition.value).toBeUndefined();
  });

  it('should filter custom properties for autocomplete', () => {
    component.availableCustomProperties = ['customProp1', 'customProp2', 'otherProp'];
    component.addCondition();
    const condition = component.filterState.conditions[0];
    component.customPropertyName[condition.id] = 'custom';

    const filtered = component.filteredCustomProperties(condition.id);

    expect(filtered).toContain('customProp1');
    expect(filtered).toContain('customProp2');
    expect(filtered).not.toContain('otherProp');
  });

  it('should return all custom properties when filter is empty', () => {
    component.availableCustomProperties = ['prop1', 'prop2', 'prop3'];
    component.addCondition();
    const condition = component.filterState.conditions[0];
    component.customPropertyName[condition.id] = '';

    const filtered = component.filteredCustomProperties(condition.id);

    expect(filtered.length).toBe(3);
    expect(filtered).toEqual(component.availableCustomProperties);
  });

  it('should identify custom properties correctly', () => {
    expect(component.isCustomProperty('customProperty')).toBe(true);
    expect(component.isCustomProperty('customProperty:myProp')).toBe(true);
    expect(component.isCustomProperty('messageId')).toBe(false);
    expect(component.isCustomProperty('correlationId')).toBe(false);
  });

  it('should generate unique condition IDs', () => {
    component.addCondition();
    const id1 = component.filterState.conditions[0].id;

    component.addCondition();
    const id2 = component.filterState.conditions[1].id;

    expect(id1).not.toBe(id2);
    expect(id1).toContain('condition-');
    expect(id2).toContain('condition-');
  });

  it('should initialize custom property names from existing conditions', () => {
    component.filterState = {
      conditions: [
        {
          id: 'test-1',
          property: 'customProperty:existingProp',
          operator: FilterOperator.Equals,
          value: 'test'
        }
      ],
      logicOperator: FilterLogic.And
    };

    component.ngOnInit();

    expect(component.customPropertyName['test-1']).toBe('existingProp');
  });

  describe('Custom Property Extraction from Messages', () => {
    let mockMessages: MessageInfo[];
    let filterService: AdvancedMessageFilterService;

    beforeEach(() => {
      filterService = TestBed.inject(AdvancedMessageFilterService);

      mockMessages = [
        {
          messageId: 'msg1',
          body: 'test',
          bodyType: 'string',
          sequenceNumber: 1,
          deliveryCount: 1,
          enqueuedTime: new Date(),
          timeToLive: '1d',
          applicationProperties: {
            'customProp1': 'value1',
            'customProp2': 'value2'
          }
        },
        {
          messageId: 'msg2',
          body: 'test2',
          bodyType: 'string',
          sequenceNumber: 2,
          deliveryCount: 1,
          enqueuedTime: new Date(),
          timeToLive: '1d',
          applicationProperties: {
            'customProp2': 'value2',
            'customProp3': 'value3'
          }
        }
      ] as MessageInfo[];
    });

    it('should automatically extract custom properties from messages on init', () => {
      component.messages = mockMessages;

      component.ngOnInit();

      expect(component.availableCustomProperties.length).toBe(3);
      expect(component.availableCustomProperties).toContain('customProp1');
      expect(component.availableCustomProperties).toContain('customProp2');
      expect(component.availableCustomProperties).toContain('customProp3');
    });

    it('should extract custom properties when messages input changes', () => {
      component.messages = mockMessages;
      fixture.detectChanges();

      expect(component.availableCustomProperties.length).toBe(3);

      // Change messages
      const newMessages: MessageInfo[] = [
        {
          messageId: 'msg3',
          body: 'test3',
          bodyType: 'string',
          sequenceNumber: 3,
          deliveryCount: 1,
          enqueuedTime: new Date(),
          timeToLive: '1d',
          applicationProperties: {
            'newProp1': 'value1'
          }
        }
      ] as MessageInfo[];

      component.messages = newMessages;
      component.ngOnChanges({
        messages: {
          currentValue: newMessages,
          previousValue: mockMessages,
          firstChange: false,
          isFirstChange: () => false
        }
      });

      expect(component.availableCustomProperties.length).toBe(1);
      expect(component.availableCustomProperties).toContain('newProp1');
    });

    it('should not extract properties if messages are not provided', () => {
      component.messages = undefined;

      component.ngOnInit();

      expect(component.availableCustomProperties.length).toBe(0);
    });

    it('should not extract properties if messages array is empty', () => {
      component.messages = [];

      component.ngOnInit();

      expect(component.availableCustomProperties.length).toBe(0);
    });

    it('should use manually set availableCustomProperties when messages not provided', () => {
      component.availableCustomProperties = ['manualProp1', 'manualProp2'];
      component.messages = undefined;

      component.ngOnInit();

      expect(component.availableCustomProperties.length).toBe(2);
      expect(component.availableCustomProperties).toContain('manualProp1');
      expect(component.availableCustomProperties).toContain('manualProp2');
    });

    it('should extract sorted custom properties', () => {
      const messagesWithUnsortedProps: MessageInfo[] = [
        {
          messageId: 'msg1',
          body: 'test',
          bodyType: 'string',
          sequenceNumber: 1,
          deliveryCount: 1,
          enqueuedTime: new Date(),
          timeToLive: '1d',
          applicationProperties: {
            'zProp': 'value1',
            'aProp': 'value2',
            'mProp': 'value3'
          }
        }
      ] as MessageInfo[];

      component.messages = messagesWithUnsortedProps;

      component.ngOnInit();

      expect(component.availableCustomProperties).toEqual(['aProp', 'mProp', 'zProp']);
    });
  });

  describe('Collapsible Panel', () => {
    it('should toggle collapse state', () => {
      expect(component.isCollapsed).toBe(false);

      component.toggleCollapse();

      expect(component.isCollapsed).toBe(true);

      component.toggleCollapse();

      expect(component.isCollapsed).toBe(false);
    });

    it('should emit collapsedChange event when toggling', async () => {
      component.isCollapsed = false;

      const promise = new Promise<void>((resolve) => {
        component.collapsedChange.subscribe((collapsed: boolean) => {
          expect(collapsed).toBe(true);
          resolve();
        });
      });

      component.toggleCollapse();
      await promise;
    });

    it('should emit correct value on multiple toggles', () => {
      const emittedValues: boolean[] = [];
      component.isCollapsed = false;

      component.collapsedChange.subscribe((collapsed: boolean) => {
        emittedValues.push(collapsed);
      });

      component.toggleCollapse();
      component.toggleCollapse();
      component.toggleCollapse();

      expect(emittedValues).toEqual([true, false, true]);
    });

    it('should accept isCollapsed as input', () => {
      component.isCollapsed = true;
      fixture.detectChanges();

      expect(component.isCollapsed).toBe(true);

      component.isCollapsed = false;
      fixture.detectChanges();

      expect(component.isCollapsed).toBe(false);
    });
  });

  describe('Property Changes', () => {
    it('should clear custom property name when switching away from custom property', () => {
      component.addCondition();
      const condition = component.filterState.conditions[0];

      // First set to custom property
      condition.property = 'customProperty';
      component.onPropertyChange(condition);
      component.onCustomPropertyNameChange(condition, 'myProp');

      expect(component.customPropertyName[condition.id]).toBe('myProp');

      // Switch to different property
      condition.property = 'messageId';
      component.onPropertyChange(condition);

      expect(component.customPropertyName[condition.id]).toBeUndefined();
    });

    it('should initialize custom property name when switching to custom property', () => {
      component.addCondition();
      const condition = component.filterState.conditions[0];

      condition.property = 'customProperty';
      component.onPropertyChange(condition);

      expect(component.customPropertyName[condition.id]).toBeDefined();
    });

    it('should update condition property with custom property format', () => {
      component.addCondition();
      const condition = component.filterState.conditions[0];
      condition.property = 'customProperty';

      component.onCustomPropertyNameChange(condition, 'testProperty');

      expect(condition.property).toBe('customProperty:testProperty');
    });

    it('should keep customProperty base when property name is empty', () => {
      component.addCondition();
      const condition = component.filterState.conditions[0];
      condition.property = 'customProperty';

      component.onCustomPropertyNameChange(condition, '');

      expect(condition.property).toBe('customProperty');
    });
  });

  describe('Edge Cases and Additional Scenarios', () => {
    it('should handle removing conditions and cleaning up custom property mappings', () => {
      component.addCondition();
      component.addCondition();
      const condition1 = component.filterState.conditions[0];
      const condition2 = component.filterState.conditions[1];

      component.customPropertyName[condition1.id] = 'prop1';
      component.customPropertyName[condition2.id] = 'prop2';

      component.removeCondition(condition1.id);

      expect(component.customPropertyName[condition1.id]).toBeUndefined();
      expect(component.customPropertyName[condition2.id]).toBe('prop2');
    });

    it('should emit filterStateChange when clear all is called', async () => {
      component.addCondition();
      component.addCondition();

      const promise = new Promise<void>((resolve) => {
        let emitCount = 0;
        component.filterStateChange.subscribe((state: AdvancedFilterState) => {
          emitCount++;
          // First two emits from addCondition, third from clearAllFilters
          if (emitCount === 3) {
            expect(state.conditions.length).toBe(0);
            resolve();
          }
        });
      });

      component.clearAllFilters();
      await promise;
    });

    it('should not crash when removing non-existent condition', () => {
      component.addCondition();
      const initialLength = component.filterState.conditions.length;

      component.removeCondition('non-existent-id');

      expect(component.filterState.conditions.length).toBe(initialLength);
    });

    it('should handle ngOnChanges with firstChange true', () => {
      const messages: MessageInfo[] = [
        {
          messageId: 'msg1',
          body: 'test',
          bodyType: 'string',
          sequenceNumber: 1,
          deliveryCount: 1,
          enqueuedTime: new Date(),
          timeToLive: '1d',
          applicationProperties: {
            'prop1': 'value1'
          }
        }
      ] as MessageInfo[];

      component.ngOnChanges({
        messages: {
          currentValue: messages,
          previousValue: undefined,
          firstChange: true,
          isFirstChange: () => true
        }
      });

      // First change should be ignored, extraction happens in ngOnInit
      expect(component.availableCustomProperties.length).toBe(0);
    });

    it('should handle ngOnChanges without messages change', () => {
      component.availableCustomProperties = ['existingProp'];

      component.ngOnChanges({
        isCollapsed: {
          currentValue: true,
          previousValue: false,
          firstChange: false,
          isFirstChange: () => false
        }
      });

      // availableCustomProperties should remain unchanged
      expect(component.availableCustomProperties).toEqual(['existingProp']);
    });

    it('should have correct default values for all properties', () => {
      const newComponent = new AdvancedFilterPanelComponent();

      expect(newComponent.filterState.conditions).toEqual([]);
      expect(newComponent.filterState.logicOperator).toBe(FilterLogic.And);
      expect(newComponent.availableCustomProperties).toEqual([]);
      expect(newComponent.isCollapsed).toBe(false);
      expect(newComponent.customPropertyName).toEqual({});
    });

    it('should generate conditions with default property and operator', () => {
      component.addCondition();
      const condition = component.filterState.conditions[0];

      expect(condition.property).toBe('messageId');
      expect(condition.operator).toBe(FilterOperator.Contains);
      expect(condition.value).toBe('');
    });

    it('should maintain value when operator requires value', () => {
      component.addCondition();
      const condition = component.filterState.conditions[0];
      condition.value = 'test value';
      condition.operator = FilterOperator.Contains;

      component.onOperatorChange(condition);

      expect(condition.value).toBe('test value');
    });

    it('should filter custom properties case-insensitively', () => {
      component.availableCustomProperties = ['CustomProp1', 'customProp2', 'CUSTOMPROP3', 'otherProp'];
      component.addCondition();
      const condition = component.filterState.conditions[0];
      component.customPropertyName[condition.id] = 'CUSTOM';

      const filtered = component.filteredCustomProperties(condition.id);

      expect(filtered.length).toBe(3);
      expect(filtered).toContain('CustomProp1');
      expect(filtered).toContain('customProp2');
      expect(filtered).toContain('CUSTOMPROP3');
    });

    it('should extract custom property name correctly from property string', () => {
      component.filterState = {
        conditions: [
          {
            id: 'test-id',
            property: 'customProperty:extractedName',
            operator: FilterOperator.Equals,
            value: 'test'
          }
        ],
        logicOperator: FilterLogic.And
      };

      component.ngOnInit();

      expect(component.customPropertyName['test-id']).toBe('extractedName');
    });

    it('should not extract property name from non-custom property', () => {
      component.filterState = {
        conditions: [
          {
            id: 'test-id',
            property: 'messageId',
            operator: FilterOperator.Equals,
            value: 'test'
          }
        ],
        logicOperator: FilterLogic.And
      };

      component.ngOnInit();

      expect(component.customPropertyName['test-id']).toBeUndefined();
    });
  });
});
