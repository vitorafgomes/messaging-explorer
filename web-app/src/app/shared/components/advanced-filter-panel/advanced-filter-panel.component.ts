import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import {
  FilterCondition,
  FilterOperator,
  FilterLogic,
  AdvancedFilterState,
  FilterProperty,
  getAvailableFilterOperators,
  getAvailableFilterProperties,
  operatorRequiresValue
} from '../../../core/models/filter.model';
import { MessageInfo } from '../../../core/models';
import { AdvancedMessageFilterService } from '../../../core/services';

/**
 * AdvancedFilterPanelComponent provides a UI for managing multiple filter conditions
 * with AND/OR logic for advanced message filtering.
 *
 * Features:
 * - Add/remove filter conditions
 * - Select property, operator, and value for each condition
 * - Choose AND/OR logic to combine conditions
 * - Clear all filters
 * - Support for custom application properties
 * - Automatic extraction of custom properties from messages
 * - Collapsible panel to save space
 * - Filter count badge when collapsed
 * - Responsive layout for different screen sizes
 *
 * @example
 * <!-- Option 1: Pass messages and let component extract custom properties -->
 * <app-advanced-filter-panel
 *   [filterState]="currentFilters"
 *   [messages]="allMessages"
 *   [isCollapsed]="false"
 *   (filterStateChange)="onFilterChange($event)"
 *   (collapsedChange)="onCollapseChange($event)"
 * ></app-advanced-filter-panel>
 *
 * <!-- Option 2: Pass pre-extracted custom properties -->
 * <app-advanced-filter-panel
 *   [filterState]="currentFilters"
 *   [availableCustomProperties]="customProps"
 *   (filterStateChange)="onFilterChange($event)"
 * ></app-advanced-filter-panel>
 */
@Component({
  selector: 'app-advanced-filter-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatInputModule,
    MatFormFieldModule,
    MatTooltipModule,
    MatButtonToggleModule,
    MatAutocompleteModule
  ],
  template: `
    <div class="advanced-filter-panel" [class.collapsed]="isCollapsed">
      <!-- Header with collapse toggle, logic toggle and clear all button -->
      <div class="panel-header" (click)="toggleCollapse()">
        <div class="header-left">
          <button matButton type="button" class="collapse-toggle" [attr.aria-expanded]="!isCollapsed">
            <mat-icon [fontIcon]="isCollapsed ? 'chevron_right' : 'expand_more'" aria-hidden="true"></mat-icon>
            Advanced Filters
          </button>
          @if (filterState.conditions.length > 0) {
            <span class="filter-count-badge">{{ filterState.conditions.length }}</span>
          }
        </div>
        <div class="header-right" (click)="$event.stopPropagation()">
          @if (filterState.conditions.length > 1 && !isCollapsed) {
            <mat-button-toggle-group
              [(ngModel)]="filterState.logicOperator"
              (change)="onFilterStateChange()"
              class="logic-toggle">
              <mat-button-toggle [value]="FilterLogic.And" matTooltip="All conditions must match">
                AND
              </mat-button-toggle>
              <mat-button-toggle [value]="FilterLogic.Or" matTooltip="At least one condition must match">
                OR
              </mat-button-toggle>
            </mat-button-toggle-group>
          }
          @if (filterState.conditions.length > 0 && !isCollapsed) {
            <button
              matButton
              type="button"
              class="danger"
              (click)="clearAllFilters()"
              matTooltip="Clear all filter conditions">
              <mat-icon fontIcon="clear_all" aria-hidden="true"></mat-icon>
              Clear All
            </button>
          }
        </div>
      </div>

      <!-- Collapsible content -->
      @if (!isCollapsed) {
        <div class="panel-content">
        <!-- Filter conditions list -->
        <div class="filter-conditions">
          @if (filterState.conditions.length === 0) {
            <div class="empty-state">
              <mat-icon fontIcon="filter_alt_off" aria-hidden="true"></mat-icon>
              <p>No filters applied</p>
              <p class="hint">Click "Add Filter" to create a new filter condition</p>
            </div>
          } @else {
            @for (condition of filterState.conditions; track condition.id) {
              <div class="filter-row">
                <!-- Property Selection -->
                <mat-form-field class="field-property" appearance="outline">
                  <mat-label>Property</mat-label>
                  <mat-select
                    [(ngModel)]="condition.property"
                    (selectionChange)="onPropertyChange(condition)"
                    placeholder="Select property">
                    @for (prop of availableProperties; track prop.value) {
                      <mat-option [value]="prop.value">{{ prop.label }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>

                <!-- Custom Property Name Input (shown when customProperty is selected) -->
                @if (isCustomProperty(condition.property)) {
                  <mat-form-field class="field-custom-property" appearance="outline">
                    <mat-label>Property Name</mat-label>
                    <input
                      matInput
                      [(ngModel)]="customPropertyName[condition.id]"
                      (ngModelChange)="onCustomPropertyNameChange(condition, $event)"
                      [matAutocomplete]="auto"
                      placeholder="Enter property name">
                    <mat-autocomplete #auto="matAutocomplete">
                      @for (propName of filteredCustomProperties(condition.id); track propName) {
                        <mat-option [value]="propName">{{ propName }}</mat-option>
                      }
                    </mat-autocomplete>
                  </mat-form-field>
                }

                <!-- Operator Selection -->
                <mat-form-field class="field-operator" appearance="outline">
                  <mat-label>Operator</mat-label>
                  <mat-select
                    [(ngModel)]="condition.operator"
                    (selectionChange)="onOperatorChange(condition)"
                    placeholder="Select operator">
                    @for (op of availableOperators; track op.value) {
                      <mat-option [value]="op.value">{{ op.label }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>

                <!-- Value Input (shown when operator requires a value) -->
                @if (operatorRequiresValue(condition.operator)) {
                  <mat-form-field class="field-value" appearance="outline">
                    <mat-label>Value</mat-label>
                    <input
                      matInput
                      [(ngModel)]="condition.value"
                      (ngModelChange)="onFilterStateChange()"
                      placeholder="Enter value">
                    @if (condition.operator === FilterOperator.Regex) {
                      <mat-hint>Use regex pattern (e.g., ^test.*$)</mat-hint>
                    }
                  </mat-form-field>
                }

                <!-- Remove Button -->
                <button
                  matIconButton
                  type="button"
                  (click)="removeCondition(condition.id)"
                  aria-label="Remove this filter condition"
                  matTooltip="Remove this filter condition"
                  class="remove danger">
                  <mat-icon fontIcon="delete" aria-hidden="true"></mat-icon>
                </button>
              </div>
            }
          }
        </div>

        <!-- Add Filter Button -->
        <div class="panel-footer">
          <button
            matButton="tonal"
            type="button"
            (click)="addCondition()"
            matTooltip="Add a new filter condition">
            <mat-icon fontIcon="add" aria-hidden="true"></mat-icon>
            Add Filter
          </button>
        </div>
        </div>
      }
    </div>
  `,
  styleUrl: './advanced-filter-panel.component.scss'
})
export class AdvancedFilterPanelComponent implements OnInit, OnChanges {
  /**
   * Current filter state with conditions and logic operator
   */
  @Input() filterState: AdvancedFilterState = {
    conditions: [],
    logicOperator: FilterLogic.And
  };

  /**
   * Optional: Messages to automatically extract custom properties from.
   * If provided, custom properties will be extracted automatically.
   * If not provided, use availableCustomProperties input instead.
   */
  @Input() messages?: MessageInfo[];

  /**
   * Optional: Available custom property names extracted from messages.
   * Use this if you want to manually control which properties are available,
   * or if you don't want to pass the full message array.
   */
  @Input() availableCustomProperties: string[] = [];

  /**
   * Controls whether the panel is collapsed
   */
  @Input() isCollapsed = false;

  /**
   * Emits when filter state changes
   */
  @Output() filterStateChange = new EventEmitter<AdvancedFilterState>();

  /**
   * Emits when collapse state changes
   */
  @Output() collapsedChange = new EventEmitter<boolean>();

  /**
   * Inject AdvancedMessageFilterService for extracting custom properties
   */
  private filterService = inject(AdvancedMessageFilterService);

  /**
   * Available filter properties
   */
  availableProperties = getAvailableFilterProperties();

  /**
   * Available filter operators
   */
  availableOperators = getAvailableFilterOperators();

  /**
   * Expose FilterLogic enum to template
   */
  FilterLogic = FilterLogic;

  /**
   * Expose FilterOperator enum to template
   */
  FilterOperator = FilterOperator;

  /**
   * Expose operatorRequiresValue function to template
   */
  operatorRequiresValue = operatorRequiresValue;

  /**
   * Map to store custom property names for each condition
   */
  customPropertyName: { [conditionId: string]: string } = {};

  ngOnInit(): void {
    // Initialize custom property names from existing conditions
    this.filterState.conditions.forEach(condition => {
      if (this.isCustomProperty(condition.property)) {
        const propertyName = this.extractCustomPropertyName(condition.property);
        if (propertyName) {
          this.customPropertyName[condition.id] = propertyName;
        }
      }
    });

    // Extract custom properties from messages if provided
    this.extractCustomPropertiesFromMessages();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Re-extract custom properties when messages change
    if (changes['messages'] && !changes['messages'].firstChange) {
      this.extractCustomPropertiesFromMessages();
    }
  }

  /**
   * Extracts custom properties from messages if messages input is provided
   * and availableCustomProperties is not manually set
   */
  private extractCustomPropertiesFromMessages(): void {
    // Only auto-extract if messages are provided
    if (this.messages && this.messages.length > 0) {
      const extracted = this.filterService.extractCustomPropertyNames(this.messages);

      // Only update if we don't have manually set custom properties
      // or if the messages input is the primary source
      if (this.availableCustomProperties.length === 0 || this.messages.length > 0) {
        this.availableCustomProperties = extracted;
      }
    }
  }

  /**
   * Adds a new empty filter condition
   */
  addCondition(): void {
    const newCondition: FilterCondition = {
      id: this.generateConditionId(),
      property: 'messageId',
      operator: FilterOperator.Contains,
      value: ''
    };

    this.filterState.conditions.push(newCondition);
    this.onFilterStateChange();
  }

  /**
   * Removes a filter condition by ID
   */
  removeCondition(conditionId: string): void {
    this.filterState.conditions = this.filterState.conditions.filter(
      c => c.id !== conditionId
    );

    // Clean up custom property name mapping
    delete this.customPropertyName[conditionId];

    this.onFilterStateChange();
  }

  /**
   * Clears all filter conditions
   */
  clearAllFilters(): void {
    this.filterState.conditions = [];
    this.customPropertyName = {};
    this.onFilterStateChange();
  }

  /**
   * Toggles the collapsed state of the panel
   */
  toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
    this.collapsedChange.emit(this.isCollapsed);
  }

  /**
   * Handles property selection change
   */
  onPropertyChange(condition: FilterCondition): void {
    // If switching to custom property, initialize the custom property name
    if (this.isCustomProperty(condition.property)) {
      if (!this.customPropertyName[condition.id]) {
        this.customPropertyName[condition.id] = '';
      }
      // Update the condition property to include the custom property name
      this.updateCustomProperty(condition);
    } else {
      // Clear custom property name if switching away from custom property
      delete this.customPropertyName[condition.id];
    }

    this.onFilterStateChange();
  }

  /**
   * Handles operator selection change
   */
  onOperatorChange(condition: FilterCondition): void {
    // Clear value if operator doesn't require it
    if (!operatorRequiresValue(condition.operator)) {
      condition.value = undefined;
    }

    this.onFilterStateChange();
  }

  /**
   * Handles custom property name change
   */
  onCustomPropertyNameChange(condition: FilterCondition, propertyName: string): void {
    this.customPropertyName[condition.id] = propertyName;
    this.updateCustomProperty(condition);
    this.onFilterStateChange();
  }

  /**
   * Updates the condition property with custom property format
   */
  private updateCustomProperty(condition: FilterCondition): void {
    const propertyName = this.customPropertyName[condition.id] || '';
    condition.property = propertyName
      ? `customProperty:${propertyName}`
      : 'customProperty';
  }

  /**
   * Checks if a property is a custom property
   */
  isCustomProperty(property: string): boolean {
    return property === 'customProperty' || property.startsWith('customProperty:');
  }

  /**
   * Extracts the custom property name from the property string
   */
  private extractCustomPropertyName(property: string): string | null {
    if (property.startsWith('customProperty:')) {
      return property.substring('customProperty:'.length);
    }
    return null;
  }

  /**
   * Gets filtered custom properties for autocomplete
   */
  filteredCustomProperties(conditionId: string): string[] {
    const inputValue = this.customPropertyName[conditionId] || '';

    if (!inputValue) {
      return this.availableCustomProperties;
    }

    const filterValue = inputValue.toLowerCase();
    return this.availableCustomProperties.filter(prop =>
      prop.toLowerCase().includes(filterValue)
    );
  }

  /**
   * Emits filter state change event
   */
  onFilterStateChange(): void {
    this.filterStateChange.emit(this.filterState);
  }

  /**
   * Generates a unique ID for a filter condition
   */
  private generateConditionId(): string {
    return `condition-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
