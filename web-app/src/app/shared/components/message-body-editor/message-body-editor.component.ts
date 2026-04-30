import { Component, Input, Output, EventEmitter, forwardRef, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Prism.js imports for syntax highlighting
import Prism from 'prismjs';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markup';

/**
 * View mode for the message body editor
 */
export type ViewMode = 'raw' | 'formatted';

/**
 * Detected content type of the message body
 */
export type ContentType = 'json' | 'xml' | 'text';

/**
 * Validation error with line number
 */
export interface ValidationError {
  message: string;
  line?: number;
}

/**
 * MessageBodyEditorComponent provides a rich editing experience for message bodies
 * with syntax highlighting, validation, and formatting capabilities for JSON and XML.
 *
 * Features:
 * - Automatic format detection (JSON/XML)
 * - Syntax highlighting via Prism.js
 * - Toggle between raw and formatted views
 * - Validation with line-numbered error reporting
 * - Copy to clipboard (raw and formatted)
 * - Collapsible sections for nested structures
 * - Two-way binding support via [(ngModel)]
 *
 * @example
 * // Read-only mode (view messages dialog)
 * <app-message-body-editor [value]="message.body" [readonly]="true"></app-message-body-editor>
 *
 * // Editable mode with ngModel (send message dialog)
 * <app-message-body-editor [(ngModel)]="message.body"></app-message-body-editor>
 */
@Component({
  selector: 'app-message-body-editor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatButtonToggleModule
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MessageBodyEditorComponent),
      multi: true
    }
  ],
  template: `
    <div class="message-body-editor" [class.readonly]="isReadonly" [class.disabled]="_disabled">
      <div class="toolbar">
        <mat-button-toggle-group [(ngModel)]="viewMode" (change)="onViewModeChange()">
          <mat-button-toggle value="formatted" matTooltip="Formatted view">
            <mat-icon>code</mat-icon>
          </mat-button-toggle>
          <mat-button-toggle value="raw" matTooltip="Raw view">
            <mat-icon>article</mat-icon>
          </mat-button-toggle>
        </mat-button-toggle-group>

        <span class="content-type-badge" [class]="detectedType">
          {{ detectedType | uppercase }}
        </span>

        <div class="spacer"></div>

        <button mat-icon-button matTooltip="Copy raw content" (click)="copyRaw()" [disabled]="!value">
          <mat-icon>content_copy</mat-icon>
        </button>

        @if (detectedType !== 'text') {
          <button mat-icon-button matTooltip="Copy formatted content" (click)="copyFormatted()" [disabled]="!value">
            <mat-icon>file_copy</mat-icon>
          </button>
        }

        @if (!isReadonly) {
          <button mat-icon-button matTooltip="Format" (click)="formatContent()" [disabled]="!canFormat">
            <mat-icon>auto_fix_high</mat-icon>
          </button>
          <button mat-icon-button matTooltip="Validate" (click)="validateContent()" [disabled]="!value">
            <mat-icon>check_circle</mat-icon>
          </button>
        }
      </div>

      @if (validationError) {
        <div class="validation-error">
          <mat-icon>error</mat-icon>
          <span>{{ validationError.message }}@if (validationError.line) { (line {{ validationError.line }}) }</span>
        </div>
      }

      <div class="content-container">
        @if (isReadonly) {
          <div class="body-content collapsible-content" [ngClass]="getLanguageClass()">
            @if (detectedType === 'json' && viewMode === 'formatted') {
              <div class="collapsible-tree" [innerHTML]="getCollapsibleJsonHtml()"></div>
            } @else if (detectedType === 'xml' && viewMode === 'formatted') {
              <div class="collapsible-tree" [innerHTML]="getCollapsibleXmlHtml()"></div>
            } @else {
              <pre class="raw-content" [innerHTML]="displayContent"></pre>
            }
          </div>
        } @else {
          <textarea
            class="body-content editable"
            [ngModel]="value"
            (ngModelChange)="onValueChange($event)"
            [placeholder]="placeholder"
            [disabled]="_disabled"
            [attr.readonly]="readonly ? true : null"
            spellcheck="false"
          ></textarea>
        }
      </div>

      @if (!value && isReadonly) {
        <div class="empty-state">
          <mat-icon>inbox</mat-icon>
          <span>No content</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .message-body-editor {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--bs-border-color);
      border-radius: 4px;
      overflow: hidden;

      &.readonly {
        border-color: var(--bs-border-color);

        .toolbar {
          background: var(--bs-tertiary-bg);
        }
      }

      &.disabled {
        opacity: 0.7;
        pointer-events: none;

        .toolbar {
          background: var(--bs-tertiary-bg);
        }
      }
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: var(--bs-secondary-bg);
      border-bottom: 1px solid var(--bs-border-color);
    }

    .content-type-badge {
      font-size: 11px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;

      &.json {
        background: #e3f2fd;
        color: #1976d2;
      }

      &.xml {
        background: #fff3e0;
        color: #ef6c00;
      }

      &.text {
        background: var(--bs-secondary-bg);
        color: var(--bs-secondary-color);
      }
    }

    .spacer {
      flex: 1;
    }

    .validation-error {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #ffebee;
      color: #c62828;
      font-size: 13px;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .content-container {
      position: relative;
    }

    .body-content {
      background: #263238;
      color: #aed581;
      padding: 16px;
      margin: 0;
      font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
      font-size: 13px;
      line-height: 1.5;
      overflow: auto;
      max-height: 300px;
      min-height: 100px;
      white-space: pre-wrap;
      word-break: break-word;

      &.editable {
        width: 100%;
        border: none;
        resize: vertical;
        outline: none;
        box-sizing: border-box;

        &:focus {
          outline: 2px solid #1976d2;
          outline-offset: -2px;
        }

        &:disabled,
        &[readonly] {
          cursor: not-allowed;
          opacity: 0.8;
          background: #37474f;
        }
      }
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px;
      color: #999;

      mat-icon {
        font-size: 32px;
        width: 32px;
        height: 32px;
        margin-bottom: 8px;
      }
    }

    /* Collapsible tree styles */
    .collapsible-content {
      font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
    }

    .collapsible-tree {
      font-size: 13px;
      line-height: 1.5;
    }

    .raw-content {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
    }

    :host ::ng-deep {
      .collapsible-tree {
        .collapse-toggle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          margin-right: 4px;
          cursor: pointer;
          color: #78909c;
          user-select: none;
          transition: transform 0.15s ease;
          vertical-align: middle;
          font-size: 14px;
          border-radius: 2px;

          &:hover {
            background: rgba(255, 255, 255, 0.1);
            color: #aed581;
          }

          &.collapsed {
            transform: rotate(-90deg);
          }
        }

        .collapsible-row {
          display: block;
        }

        .collapsible-children {
          padding-left: 20px;
          border-left: 1px solid #455a64;
          margin-left: 6px;

          &.hidden {
            display: none;
          }
        }

        .collapsed-placeholder {
          color: #78909c;
          font-style: italic;
        }

        .indent {
          display: inline-block;
        }
      }

      /* Syntax highlighting tokens (for Prism.js integration) */
      .token.property,
      .token.tag {
        color: #80cbc4;
      }

      .token.string {
        color: #c3e88d;
      }

      .token.number {
        color: #f78c6c;
      }

      .token.boolean,
      .token.null {
        color: #ff5370;
      }

      .token.punctuation {
        color: #89ddff;
      }

      .token.attr-name {
        color: #ffcb6b;
      }

      .token.attr-value {
        color: #c3e88d;
      }

      /* JSON-specific token colors */
      .json-key {
        color: #80cbc4;
      }

      .json-string {
        color: #c3e88d;
      }

      .json-number {
        color: #f78c6c;
      }

      .json-boolean,
      .json-null {
        color: #ff5370;
      }

      .json-punctuation {
        color: #89ddff;
      }

      /* XML-specific token colors */
      .xml-tag {
        color: #80cbc4;
      }

      .xml-attr-name {
        color: #ffcb6b;
      }

      .xml-attr-value {
        color: #c3e88d;
      }

      .xml-text {
        color: #aed581;
      }

      .xml-punctuation {
        color: #89ddff;
      }
    }
  `]
})
export class MessageBodyEditorComponent implements ControlValueAccessor, OnInit, OnDestroy {
  private snackBar = inject(MatSnackBar);
  private sanitizer = inject(DomSanitizer);

  /**
   * Set of paths that are currently collapsed (for collapsible sections)
   * Paths are represented as dot-separated keys like "root.items.0.name"
   */
  collapsedPaths = new Set<string>();

  /**
   * The raw message body content
   */
  @Input() value = '';

  /**
   * Emits when the value changes (for ngModel support)
   */
  @Output() valueChange = new EventEmitter<string>();

  /**
   * Whether the editor is in read-only mode.
   * When true, displays content in a non-editable view with syntax highlighting.
   * When false, shows an editable textarea for user input.
   */
  @Input() readonly = false;

  /**
   * Whether the editor is disabled (via reactive forms).
   * Works in conjunction with readonly for form control integration.
   */
  protected _disabled = false;

  /**
   * Placeholder text for empty editable content
   */
  @Input() placeholder = '{"key": "value"}';

  /**
   * Current view mode (raw or formatted)
   */
  viewMode: ViewMode = 'formatted';

  /**
   * Detected content type
   */
  detectedType: ContentType = 'text';

  /**
   * Current validation error, if any
   */
  validationError: ValidationError | null = null;

  /**
   * Whether the content can be formatted
   */
  get canFormat(): boolean {
    return this.detectedType !== 'text' && !!this.value;
  }

  /**
   * Content to display based on view mode
   */
  get displayContent(): string {
    if (!this.value) {
      return '';
    }

    if (this.viewMode === 'raw') {
      return this.escapeHtml(this.value);
    }

    return this.getFormattedContent();
  }

  /**
   * Returns the appropriate Prism.js language class for syntax highlighting
   */
  getLanguageClass(): string {
    switch (this.detectedType) {
      case 'json':
        return 'language-json';
      case 'xml':
        return 'language-xml';
      default:
        return 'language-text';
    }
  }

  // ControlValueAccessor implementation
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: string): void {
    this.value = value || '';
    this.detectContentType();
    this.validate();
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this._disabled = isDisabled;
  }

  /**
   * Returns true if the editor should be in read-only/disabled mode.
   * Combines both the readonly input and disabled state from forms.
   */
  get isReadonly(): boolean {
    return this.readonly || this._disabled;
  }

  /**
   * Handles value changes from the textarea
   */
  onValueChange(newValue: string): void {
    this.value = newValue;
    this.valueChange.emit(newValue);
    this.onChange(newValue);
    this.detectContentType();
    this.validate();
  }

  /**
   * Handles view mode change
   */
  onViewModeChange(): void {
    // View mode change is handled automatically via binding
  }

  /**
   * Copies raw (unformatted) content to clipboard
   */
  async copyRaw(): Promise<void> {
    if (!this.value) {
      this.snackBar.open('No content to copy', 'Close', { duration: 2000 });
      return;
    }

    try {
      await navigator.clipboard.writeText(this.value);
      this.snackBar.open('Raw content copied to clipboard', 'Close', { duration: 2000 });
    } catch {
      this.snackBar.open('Failed to copy to clipboard', 'Close', { duration: 2000 });
    }
  }

  /**
   * Copies formatted content to clipboard
   */
  async copyFormatted(): Promise<void> {
    if (!this.value) {
      this.snackBar.open('No content to copy', 'Close', { duration: 2000 });
      return;
    }

    const formatted = this.getPlainFormattedContent();

    try {
      await navigator.clipboard.writeText(formatted);
      this.snackBar.open('Formatted content copied to clipboard', 'Close', { duration: 2000 });
    } catch {
      this.snackBar.open('Failed to copy to clipboard', 'Close', { duration: 2000 });
    }
  }

  /**
   * Copies the current content to clipboard based on view mode
   * (Legacy method for backward compatibility)
   */
  async copyToClipboard(): Promise<void> {
    if (this.viewMode === 'formatted') {
      await this.copyFormatted();
    } else {
      await this.copyRaw();
    }
  }

  /**
   * Validates the content and shows result via snackbar
   */
  validateContent(): void {
    if (!this.value) {
      this.snackBar.open('No content to validate', 'Close', { duration: 2000 });
      return;
    }

    this.detectContentType();
    this.validate();

    if (this.validationError) {
      const errorMessage = this.validationError.line
        ? `${this.validationError.message} (line ${this.validationError.line})`
        : this.validationError.message;
      this.snackBar.open(errorMessage, 'Close', { duration: 4000 });
    } else if (this.detectedType === 'text') {
      this.snackBar.open('Plain text content (no JSON/XML detected)', 'Close', { duration: 2000 });
    } else {
      this.snackBar.open(`Valid ${this.detectedType.toUpperCase()}`, 'Close', { duration: 2000 });
    }
  }

  /**
   * Gets whether the content is valid (for external access)
   */
  get isValid(): boolean {
    return this.validationError === null;
  }

  /**
   * Formats the content in place
   */
  formatContent(): void {
    if (!this.canFormat || this.isReadonly) {
      return;
    }

    // Validate first - show snackbar error if invalid
    this.validate();
    if (this.validationError) {
      const errorMessage = this.validationError.line
        ? `${this.validationError.message} (line ${this.validationError.line})`
        : this.validationError.message;
      this.snackBar.open(errorMessage, 'Close', { duration: 4000 });
      return;
    }

    const formatted = this.getPlainFormattedContent();
    if (formatted !== this.value) {
      this.onValueChange(formatted);
      this.snackBar.open('Content formatted', 'Close', { duration: 2000 });
    }
  }

  /**
   * Detects the content type (JSON, XML, or plain text)
   */
  private detectContentType(): void {
    if (!this.value) {
      this.detectedType = 'text';
      return;
    }

    const trimmed = this.value.trim();

    // Check for JSON
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        JSON.parse(trimmed);
        this.detectedType = 'json';
        return;
      } catch {
        // Not valid JSON, continue checking
      }
    }

    // Check for XML
    if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(trimmed, 'application/xml');
        const parseError = doc.querySelector('parsererror');
        if (!parseError) {
          this.detectedType = 'xml';
          return;
        }
      } catch {
        // Not valid XML, continue
      }
    }

    this.detectedType = 'text';
  }

  /**
   * Validates the content and sets validation errors
   */
  private validate(): void {
    this.validationError = null;

    if (!this.value) {
      return;
    }

    if (this.detectedType === 'json') {
      this.validateJson();
    } else if (this.detectedType === 'xml') {
      this.validateXml();
    }
  }

  /**
   * Validates JSON content
   */
  private validateJson(): void {
    try {
      JSON.parse(this.value);
    } catch (e) {
      const error = e as Error;
      let line: number | undefined;

      // Different browsers format JSON parse errors differently
      // Chrome/Edge: "Unexpected token X in JSON at position N"
      // Firefox: "JSON.parse: expected ',' or '}' after property value at line N column N"
      // Safari: Similar to Chrome

      // Try to extract position (Chrome/Edge/Safari style)
      const positionMatch = error.message.match(/at position (\d+)/i);
      if (positionMatch) {
        const position = parseInt(positionMatch[1], 10);
        line = this.getLineFromPosition(position);
      }

      // Try to extract line directly (Firefox style)
      if (!line) {
        const lineMatch = error.message.match(/at line (\d+)/i);
        if (lineMatch) {
          line = parseInt(lineMatch[1], 10);
        }
      }

      // Clean up error message for display
      let message = error.message
        .replace(/^JSON\.parse: /, '')
        .replace(/at position \d+/, '')
        .replace(/at line \d+ column \d+/, '')
        .trim();

      // Capitalize first letter
      if (message.length > 0) {
        message = message.charAt(0).toUpperCase() + message.slice(1);
      }

      this.validationError = {
        message: message || 'Invalid JSON syntax',
        line
      };
    }
  }

  /**
   * Validates XML content
   */
  private validateXml(): void {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(this.value, 'application/xml');
      const parseError = doc.querySelector('parsererror');

      if (parseError) {
        const errorText = parseError.textContent || 'Invalid XML';

        // Extract line number from error text
        const lineMatch = errorText.match(/line\s*(\d+)/i);
        const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;

        // Extract column number if available
        const colMatch = errorText.match(/column\s*(\d+)/i);
        const column = colMatch ? parseInt(colMatch[1], 10) : undefined;

        // Try to extract a meaningful error message
        let message = 'Invalid XML syntax';

        // Common error patterns
        if (errorText.includes('not well-formed') || errorText.includes('mismatched tag')) {
          message = 'XML is not well-formed (mismatched tags)';
        } else if (errorText.includes('no root element') || errorText.includes('no element found')) {
          message = 'No root element found';
        } else if (errorText.includes('unclosed')) {
          message = 'Unclosed XML element';
        } else if (errorText.includes('attribute')) {
          message = 'Invalid XML attribute syntax';
        }

        // Add column info to message if available
        if (column && !message.includes('column')) {
          message += ` at column ${column}`;
        }

        this.validationError = {
          message,
          line
        };
      }
    } catch (e) {
      this.validationError = {
        message: 'Failed to parse XML'
      };
    }
  }

  /**
   * Gets line number from character position
   */
  private getLineFromPosition(position: number): number {
    const lines = this.value.substring(0, position).split('\n');
    return lines.length;
  }

  /**
   * Gets formatted content with syntax highlighting (HTML)
   * Uses Prism.js for language-specific highlighting
   */
  private getFormattedContent(): string {
    const formatted = this.getPlainFormattedContent();
    return this.highlightContent(formatted);
  }

  /**
   * Applies Prism.js syntax highlighting to content
   */
  private highlightContent(content: string): string {
    if (!content) {
      return '';
    }

    try {
      if (this.detectedType === 'json') {
        return Prism.highlight(content, Prism.languages['json'], 'json');
      } else if (this.detectedType === 'xml') {
        return Prism.highlight(content, Prism.languages['markup'], 'markup');
      }
    } catch {
      // Fallback to escaped HTML if highlighting fails
    }

    return this.escapeHtml(content);
  }

  /**
   * Gets plain formatted content (no HTML)
   */
  private getPlainFormattedContent(): string {
    if (this.detectedType === 'json') {
      return this.formatJson();
    } else if (this.detectedType === 'xml') {
      return this.formatXml();
    }
    return this.value;
  }

  /**
   * Formats JSON with proper indentation
   */
  private formatJson(): string {
    try {
      const parsed = JSON.parse(this.value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return this.value;
    }
  }

  /**
   * Formats XML with proper indentation
   */
  private formatXml(): string {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(this.value, 'application/xml');

      if (doc.querySelector('parsererror')) {
        return this.value;
      }

      const serializer = new XMLSerializer();
      let formatted = serializer.serializeToString(doc);

      // Simple XML formatting with indentation
      formatted = this.indentXml(formatted);

      return formatted;
    } catch {
      return this.value;
    }
  }

  /**
   * Indents XML content
   */
  private indentXml(xml: string): string {
    let formatted = '';
    let indent = 0;
    const tab = '  ';

    xml.split(/>\s*</).forEach((node, index) => {
      if (node.match(/^\/\w/)) {
        indent--;
      }

      formatted += (index > 0 ? '\n' : '') + tab.repeat(Math.max(0, indent)) + (index > 0 ? '<' : '') + node + (index < xml.split(/>\s*</).length - 1 ? '>' : '');

      if (node.match(/^<?\w[^>]*[^/]$/) && !node.startsWith('?')) {
        indent++;
      }
    });

    return formatted;
  }

  /**
   * Escapes HTML entities for safe display
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Toggles the collapsed state of a path
   */
  toggleCollapse(path: string): void {
    if (this.collapsedPaths.has(path)) {
      this.collapsedPaths.delete(path);
    } else {
      this.collapsedPaths.add(path);
    }
  }

  /**
   * Checks if a path is collapsed
   */
  isCollapsed(path: string): boolean {
    return this.collapsedPaths.has(path);
  }

  /**
   * Generates collapsible HTML for JSON content
   */
  getCollapsibleJsonHtml(): SafeHtml {
    if (!this.value) {
      return '';
    }

    try {
      const parsed = JSON.parse(this.value);
      const html = this.renderJsonValue(parsed, 'root', 0);
      return this.sanitizer.bypassSecurityTrustHtml(html);
    } catch {
      // If parsing fails, return escaped raw content
      return this.sanitizer.bypassSecurityTrustHtml(this.escapeHtml(this.value));
    }
  }

  /**
   * Renders a JSON value to collapsible HTML
   */
  private renderJsonValue(value: unknown, path: string, depth: number): string {
    const indent = '  '.repeat(depth);

    if (value === null) {
      return `<span class="json-null">null</span>`;
    }

    if (typeof value === 'boolean') {
      return `<span class="json-boolean">${value}</span>`;
    }

    if (typeof value === 'number') {
      return `<span class="json-number">${value}</span>`;
    }

    if (typeof value === 'string') {
      return `<span class="json-string">"${this.escapeHtml(value)}"</span>`;
    }

    if (Array.isArray(value)) {
      return this.renderJsonArray(value, path, depth);
    }

    if (typeof value === 'object') {
      return this.renderJsonObject(value as Record<string, unknown>, path, depth);
    }

    return this.escapeHtml(String(value));
  }

  /**
   * Renders a JSON array to collapsible HTML
   */
  private renderJsonArray(arr: unknown[], path: string, depth: number): string {
    if (arr.length === 0) {
      return `<span class="json-punctuation">[]</span>`;
    }

    const isCollapsed = this.collapsedPaths.has(path);
    const toggleClass = isCollapsed ? 'collapse-toggle collapsed' : 'collapse-toggle';
    const childClass = isCollapsed ? 'collapsible-children hidden' : 'collapsible-children';
    const componentId = (this as any).__ngContext__?.[0] || Math.random().toString(36).substr(2, 9);
    const toggleId = `toggle-${path.replace(/\./g, '-')}-${componentId}`;

    let html = `<span class="json-punctuation">[</span>`;
    html += `<span class="${toggleClass}" data-path="${this.escapeHtml(path)}" onclick="window.dispatchEvent(new CustomEvent('mbe-toggle', {detail: '${this.escapeHtml(path)}'}))" title="Click to ${isCollapsed ? 'expand' : 'collapse'}">▼</span>`;

    if (isCollapsed) {
      html += `<span class="collapsed-placeholder">...${arr.length} items</span>`;
      html += `<span class="json-punctuation">]</span>`;
    } else {
      html += `<div class="${childClass}">`;

      arr.forEach((item, index) => {
        const itemPath = `${path}.${index}`;
        const isLast = index === arr.length - 1;
        html += `<div class="collapsible-row">`;
        html += this.renderJsonValue(item, itemPath, depth + 1);
        if (!isLast) {
          html += `<span class="json-punctuation">,</span>`;
        }
        html += `</div>`;
      });

      html += `</div>`;
      html += `<span class="json-punctuation">]</span>`;
    }

    return html;
  }

  /**
   * Renders a JSON object to collapsible HTML
   */
  private renderJsonObject(obj: Record<string, unknown>, path: string, depth: number): string {
    const keys = Object.keys(obj);

    if (keys.length === 0) {
      return `<span class="json-punctuation">{}</span>`;
    }

    const isCollapsed = this.collapsedPaths.has(path);
    const toggleClass = isCollapsed ? 'collapse-toggle collapsed' : 'collapse-toggle';
    const childClass = isCollapsed ? 'collapsible-children hidden' : 'collapsible-children';

    let html = `<span class="json-punctuation">{</span>`;
    html += `<span class="${toggleClass}" data-path="${this.escapeHtml(path)}" onclick="window.dispatchEvent(new CustomEvent('mbe-toggle', {detail: '${this.escapeHtml(path)}'}))" title="Click to ${isCollapsed ? 'expand' : 'collapse'}">▼</span>`;

    if (isCollapsed) {
      html += `<span class="collapsed-placeholder">...${keys.length} properties</span>`;
      html += `<span class="json-punctuation">}</span>`;
    } else {
      html += `<div class="${childClass}">`;

      keys.forEach((key, index) => {
        const keyPath = `${path}.${key}`;
        const isLast = index === keys.length - 1;
        html += `<div class="collapsible-row">`;
        html += `<span class="json-key">"${this.escapeHtml(key)}"</span>`;
        html += `<span class="json-punctuation">: </span>`;
        html += this.renderJsonValue(obj[key], keyPath, depth + 1);
        if (!isLast) {
          html += `<span class="json-punctuation">,</span>`;
        }
        html += `</div>`;
      });

      html += `</div>`;
      html += `<span class="json-punctuation">}</span>`;
    }

    return html;
  }

  /**
   * Generates collapsible HTML for XML content
   */
  getCollapsibleXmlHtml(): SafeHtml {
    if (!this.value) {
      return '';
    }

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(this.value.trim(), 'application/xml');

      // Check for parse errors
      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        return this.sanitizer.bypassSecurityTrustHtml(this.escapeHtml(this.value));
      }

      const html = this.renderXmlNode(doc.documentElement, 'root', 0);
      return this.sanitizer.bypassSecurityTrustHtml(html);
    } catch {
      return this.sanitizer.bypassSecurityTrustHtml(this.escapeHtml(this.value));
    }
  }

  /**
   * Renders an XML node to collapsible HTML
   */
  private renderXmlNode(node: Element, path: string, depth: number): string {
    const tagName = node.tagName;
    const attributes = Array.from(node.attributes);
    const children = Array.from(node.childNodes).filter(child =>
      child.nodeType === Node.ELEMENT_NODE ||
      (child.nodeType === Node.TEXT_NODE && child.textContent?.trim())
    );

    // Build opening tag
    let html = `<span class="xml-punctuation">&lt;</span>`;
    html += `<span class="xml-tag">${this.escapeHtml(tagName)}</span>`;

    // Add attributes
    attributes.forEach(attr => {
      html += ` <span class="xml-attr-name">${this.escapeHtml(attr.name)}</span>`;
      html += `<span class="xml-punctuation">=</span>`;
      html += `<span class="xml-attr-value">"${this.escapeHtml(attr.value)}"</span>`;
    });

    // Handle self-closing or empty elements
    if (children.length === 0) {
      html += `<span class="xml-punctuation">/&gt;</span>`;
      return html;
    }

    html += `<span class="xml-punctuation">&gt;</span>`;

    // Check if only text content (no element children)
    const elementChildren = children.filter(child => child.nodeType === Node.ELEMENT_NODE);
    const hasElementChildren = elementChildren.length > 0;

    if (!hasElementChildren) {
      // Just text content - render inline
      const textContent = children
        .filter(child => child.nodeType === Node.TEXT_NODE)
        .map(child => child.textContent?.trim() || '')
        .join('');
      html += `<span class="xml-text">${this.escapeHtml(textContent)}</span>`;
      html += `<span class="xml-punctuation">&lt;/</span>`;
      html += `<span class="xml-tag">${this.escapeHtml(tagName)}</span>`;
      html += `<span class="xml-punctuation">&gt;</span>`;
      return html;
    }

    // Has element children - make collapsible
    const isCollapsed = this.collapsedPaths.has(path);
    const toggleClass = isCollapsed ? 'collapse-toggle collapsed' : 'collapse-toggle';
    const childClass = isCollapsed ? 'collapsible-children hidden' : 'collapsible-children';

    html += `<span class="${toggleClass}" data-path="${this.escapeHtml(path)}" onclick="window.dispatchEvent(new CustomEvent('mbe-toggle', {detail: '${this.escapeHtml(path)}'}))" title="Click to ${isCollapsed ? 'expand' : 'collapse'}">▼</span>`;

    if (isCollapsed) {
      html += `<span class="collapsed-placeholder">...${elementChildren.length} elements</span>`;
    } else {
      html += `<div class="${childClass}">`;

      children.forEach((child, index) => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const childPath = `${path}.${(child as Element).tagName}.${index}`;
          html += `<div class="collapsible-row">`;
          html += this.renderXmlNode(child as Element, childPath, depth + 1);
          html += `</div>`;
        } else if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
          html += `<div class="collapsible-row">`;
          html += `<span class="xml-text">${this.escapeHtml(child.textContent.trim())}</span>`;
          html += `</div>`;
        }
      });

      html += `</div>`;
    }

    // Closing tag
    html += `<span class="xml-punctuation">&lt;/</span>`;
    html += `<span class="xml-tag">${this.escapeHtml(tagName)}</span>`;
    html += `<span class="xml-punctuation">&gt;</span>`;

    return html;
  }

  /**
   * Initializes the event listener for collapsible toggle events
   * This is called in ngOnInit or when the component is rendered
   */
  private setupToggleListener(): void {
    // Remove any existing listener to avoid duplicates
    if ((window as any).__mbeToggleHandler) {
      window.removeEventListener('mbe-toggle', (window as any).__mbeToggleHandler);
    }

    // Create and store the handler
    const handler = (event: CustomEvent<string>) => {
      this.toggleCollapse(event.detail);
    };
    (window as any).__mbeToggleHandler = handler;

    window.addEventListener('mbe-toggle', handler as EventListener);
  }

  /**
   * Lifecycle hook to set up event listeners
   */
  ngOnInit(): void {
    this.setupToggleListener();
  }

  /**
   * Lifecycle hook to clean up event listeners
   */
  ngOnDestroy(): void {
    if ((window as any).__mbeToggleHandler) {
      window.removeEventListener('mbe-toggle', (window as any).__mbeToggleHandler);
      delete (window as any).__mbeToggleHandler;
    }
  }
}
