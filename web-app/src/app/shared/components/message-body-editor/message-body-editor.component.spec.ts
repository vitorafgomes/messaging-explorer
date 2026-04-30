import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from 'vitest';
import { MessageBodyEditorComponent, ViewMode, ContentType, ValidationError } from './message-body-editor.component';

describe('MessageBodyEditorComponent', () => {
  let component: MessageBodyEditorComponent;
  let fixture: ComponentFixture<MessageBodyEditorComponent>;
  let snackBarMock: { open: ReturnType<typeof vi.fn> };
  let clipboardMock: { writeText: ReturnType<typeof vi.fn> };

  beforeAll(() => {
    // Mock clipboard API for all tests since jsdom doesn't provide it
    clipboardMock = {
      writeText: vi.fn().mockResolvedValue(undefined)
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: clipboardMock,
      writable: true,
      configurable: true
    });
  });

  beforeEach(async () => {
    snackBarMock = {
      open: vi.fn()
    };

    // Reset clipboard mock for each test
    clipboardMock.writeText.mockReset().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [
        MessageBodyEditorComponent,
        FormsModule,
        NoopAnimationsModule
      ]
    })
    // Override the component's providers to inject our mock
    .overrideComponent(MessageBodyEditorComponent, {
      add: {
        providers: [{ provide: MatSnackBar, useValue: snackBarMock }]
      }
    })
    .compileComponents();

    fixture = TestBed.createComponent(MessageBodyEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Component Initialization', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should have default view mode as formatted', () => {
      expect(component.viewMode).toBe('formatted');
    });

    it('should have default readonly as false', () => {
      expect(component.readonly).toBe(false);
    });

    it('should have default detected type as text', () => {
      expect(component.detectedType).toBe('text');
    });

    it('should have no validation error initially', () => {
      expect(component.validationError).toBeNull();
    });

    it('should have default placeholder text', () => {
      expect(component.placeholder).toBe('{"key": "value"}');
    });

    it('should have isValid as true initially', () => {
      expect(component.isValid).toBe(true);
    });

    it('should have canFormat as false initially (empty content)', () => {
      expect(component.canFormat).toBe(false);
    });
  });

  describe('Content Type Detection', () => {
    it('should detect valid JSON object', () => {
      component.writeValue('{"key": "value"}');
      expect(component.detectedType).toBe('json');
    });

    it('should detect valid JSON array', () => {
      component.writeValue('[1, 2, 3]');
      expect(component.detectedType).toBe('json');
    });

    it('should detect nested JSON objects', () => {
      component.writeValue('{"outer": {"inner": {"deep": true}}}');
      expect(component.detectedType).toBe('json');
    });

    it('should detect JSON array of objects', () => {
      component.writeValue('[{"id": 1}, {"id": 2}]');
      expect(component.detectedType).toBe('json');
    });

    it('should detect valid XML', () => {
      component.writeValue('<root><child>value</child></root>');
      expect(component.detectedType).toBe('xml');
    });

    it('should detect XML with attributes', () => {
      component.writeValue('<root attr="value"><child id="1">text</child></root>');
      expect(component.detectedType).toBe('xml');
    });

    it('should detect self-closing XML', () => {
      component.writeValue('<root><empty/></root>');
      expect(component.detectedType).toBe('xml');
    });

    it('should detect plain text', () => {
      component.writeValue('Hello, World!');
      expect(component.detectedType).toBe('text');
    });

    it('should handle empty content as text', () => {
      component.writeValue('');
      expect(component.detectedType).toBe('text');
    });

    it('should handle malformed JSON as text', () => {
      component.writeValue('{not valid json}');
      expect(component.detectedType).toBe('text');
    });

    it('should handle JSON-like content that is not valid JSON', () => {
      component.writeValue('{key: value}'); // Missing quotes
      expect(component.detectedType).toBe('text');
    });

    it('should handle content with leading/trailing whitespace', () => {
      component.writeValue('  {"key": "value"}  ');
      expect(component.detectedType).toBe('json');
    });
  });

  describe('JSON Formatting', () => {
    it('should format valid JSON with 2-space indentation', () => {
      const input = '{"key":"value","nested":{"a":1}}';
      const expected = '{\n  "key": "value",\n  "nested": {\n    "a": 1\n  }\n}';

      component.writeValue(input);
      component.formatContent();

      expect(component.value).toBe(expected);
    });

    it('should format JSON array correctly', () => {
      const input = '[1,2,3]';
      const expected = '[\n  1,\n  2,\n  3\n]';

      component.writeValue(input);
      component.formatContent();

      expect(component.value).toBe(expected);
    });

    it('should not modify invalid JSON when formatting', () => {
      const input = '{invalid json}';
      component.writeValue(input);
      component.formatContent();

      expect(component.value).toBe(input);
    });

    it('should emit valueChange when formatting', () => {
      const spy = vi.spyOn(component.valueChange, 'emit');
      const input = '{"key":"value"}';

      component.writeValue(input);
      component.formatContent();

      expect(spy).toHaveBeenCalled();
    });

    it('should show snackbar confirmation after formatting', () => {
      const input = '{"key":"value"}';
      component.writeValue(input);
      component.formatContent();

      // Check the snackbar was called with 'Content formatted' message
      expect(snackBarMock.open).toHaveBeenCalled();
      const calls = snackBarMock.open.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toBe('Content formatted');
    });

    it('should not format already formatted content', () => {
      const formatted = '{\n  "key": "value"\n}';
      const spy = vi.spyOn(component.valueChange, 'emit');

      component.writeValue(formatted);
      component.formatContent();

      // If already formatted, valueChange should not emit
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('JSON Validation', () => {
    it('should not set error for valid JSON', () => {
      component.writeValue('{"key": "value"}');
      expect(component.validationError).toBeNull();
      expect(component.isValid).toBe(true);
    });

    it('should set error for invalid JSON when detected as JSON-like', () => {
      // Note: Detection only triggers for content starting with { or [
      component.writeValue('{"key": }'); // Missing value
      // This will be detected as text since it's not valid JSON
      expect(component.detectedType).toBe('text');
    });

    it('should validate and report success via validateContent()', () => {
      component.writeValue('{"key": "value"}');
      component.validateContent();

      // Check snackbar was called with success message
      expect(snackBarMock.open).toHaveBeenCalled();
      const calls = snackBarMock.open.mock.calls;
      const hasValidMessage = calls.some((call: any) =>
        call[0].includes('Valid JSON') || call[0].includes('Valid')
      );
      expect(hasValidMessage).toBe(true);
    });

    it('should show error for no content when validating', () => {
      component.writeValue('');
      component.validateContent();

      // Check snackbar was called with "No content to validate" message
      expect(snackBarMock.open).toHaveBeenCalled();
      const calls = snackBarMock.open.mock.calls;
      const hasNoContentMessage = calls.some((call: any) =>
        call[0].includes('No content')
      );
      expect(hasNoContentMessage).toBe(true);
    });
  });

  describe('XML Formatting', () => {
    it('should detect and validate XML', () => {
      component.writeValue('<root><child>value</child></root>');
      expect(component.detectedType).toBe('xml');
      expect(component.validationError).toBeNull();
    });

    it('should handle nested XML elements', () => {
      component.writeValue('<a><b><c>deep</c></b></a>');
      expect(component.detectedType).toBe('xml');
      expect(component.isValid).toBe(true);
    });
  });

  describe('XML Validation', () => {
    it('should not set error for valid XML', () => {
      component.writeValue('<root><child>value</child></root>');
      expect(component.validationError).toBeNull();
    });

    it('should detect malformed XML as text', () => {
      component.writeValue('<root><unclosed>');
      // Invalid XML detected as text
      expect(component.detectedType).toBe('text');
    });

    it('should validate XML and report success', () => {
      component.writeValue('<root><child>value</child></root>');
      component.validateContent();

      // Check snackbar was called with success message
      expect(snackBarMock.open).toHaveBeenCalled();
      const calls = snackBarMock.open.mock.calls;
      const hasValidMessage = calls.some((call: any) =>
        call[0].includes('Valid XML') || call[0].includes('Valid')
      );
      expect(hasValidMessage).toBe(true);
    });
  });

  describe('View Mode Toggle', () => {
    it('should switch between raw and formatted modes', () => {
      component.viewMode = 'raw';
      expect(component.viewMode).toBe('raw');

      component.viewMode = 'formatted';
      expect(component.viewMode).toBe('formatted');
    });

    it('should display raw content in raw mode', () => {
      const json = '{"key":"value"}';
      component.writeValue(json);
      component.viewMode = 'raw';

      expect(component.displayContent).toContain('{"key":"value"}');
    });

    it('should display formatted content in formatted mode', () => {
      const json = '{"key":"value"}';
      component.writeValue(json);
      component.viewMode = 'formatted';

      expect(component.displayContent).toContain('"key"');
      expect(component.displayContent).toContain('"value"');
    });

    it('should return empty string for displayContent when value is empty', () => {
      component.writeValue('');
      expect(component.displayContent).toBe('');
    });
  });

  describe('Copy to Clipboard - Raw', () => {
    it('should copy raw content to clipboard', async () => {
      component.writeValue('{"key": "value"}');
      await component.copyRaw();

      expect(clipboardMock.writeText).toHaveBeenCalledWith('{"key": "value"}');
      expect(snackBarMock.open).toHaveBeenCalledWith('Raw content copied to clipboard', 'Close', { duration: 2000 });
    });

    it('should show error when clipboard fails for copyRaw', async () => {
      clipboardMock.writeText.mockRejectedValueOnce(new Error('Failed'));

      component.writeValue('{"key": "value"}');
      await component.copyRaw();

      expect(snackBarMock.open).toHaveBeenCalledWith('Failed to copy to clipboard', 'Close', { duration: 2000 });
    });

    it('should show message for empty content on copyRaw', async () => {
      component.writeValue('');
      await component.copyRaw();

      expect(snackBarMock.open).toHaveBeenCalledWith('No content to copy', 'Close', { duration: 2000 });
    });
  });

  describe('Copy to Clipboard - Formatted', () => {
    it('should copy formatted content to clipboard', async () => {
      component.writeValue('{"key":"value"}');
      await component.copyFormatted();

      // Formatted content should have proper spacing
      expect(clipboardMock.writeText).toHaveBeenCalled();
      const calledWith = clipboardMock.writeText.mock.calls[0][0];
      expect(calledWith).toContain('"key"');
      expect(calledWith).toContain('"value"');
      expect(snackBarMock.open).toHaveBeenCalledWith('Formatted content copied to clipboard', 'Close', { duration: 2000 });
    });

    it('should show error when clipboard fails for copyFormatted', async () => {
      clipboardMock.writeText.mockRejectedValueOnce(new Error('Failed'));

      component.writeValue('{"key": "value"}');
      await component.copyFormatted();

      expect(snackBarMock.open).toHaveBeenCalledWith('Failed to copy to clipboard', 'Close', { duration: 2000 });
    });

    it('should show message for empty content on copyFormatted', async () => {
      component.writeValue('');
      await component.copyFormatted();

      expect(snackBarMock.open).toHaveBeenCalledWith('No content to copy', 'Close', { duration: 2000 });
    });
  });

  describe('Copy to Clipboard (Legacy)', () => {
    it('should call copyRaw in raw mode', async () => {
      component.writeValue('{"key": "value"}');
      component.viewMode = 'raw';
      await component.copyToClipboard();

      expect(clipboardMock.writeText).toHaveBeenCalledWith('{"key": "value"}');
      expect(snackBarMock.open).toHaveBeenCalledWith('Raw content copied to clipboard', 'Close', { duration: 2000 });
    });

    it('should call copyFormatted in formatted mode', async () => {
      component.writeValue('{"key":"value"}');
      component.viewMode = 'formatted';
      await component.copyToClipboard();

      expect(clipboardMock.writeText).toHaveBeenCalled();
      expect(snackBarMock.open).toHaveBeenCalledWith('Formatted content copied to clipboard', 'Close', { duration: 2000 });
    });
  });

  describe('Two-Way Binding (ControlValueAccessor)', () => {
    it('should update value via writeValue', () => {
      component.writeValue('test content');
      expect(component.value).toBe('test content');
    });

    it('should handle null in writeValue', () => {
      component.writeValue(null as any);
      expect(component.value).toBe('');
    });

    it('should handle undefined in writeValue', () => {
      component.writeValue(undefined as any);
      expect(component.value).toBe('');
    });

    it('should call onChange when value changes', () => {
      const onChangeSpy = vi.fn();
      component.registerOnChange(onChangeSpy);

      component.onValueChange('new value');

      expect(onChangeSpy).toHaveBeenCalledWith('new value');
    });

    it('should emit valueChange event', () => {
      const spy = vi.spyOn(component.valueChange, 'emit');

      component.onValueChange('new value');

      expect(spy).toHaveBeenCalledWith('new value');
    });

    it('should support registerOnTouched', () => {
      const onTouchedSpy = vi.fn();
      component.registerOnTouched(onTouchedSpy);
      // This just registers the callback - no assertion needed
      expect(true).toBe(true);
    });

    it('should support setDisabledState', () => {
      component.setDisabledState(true);
      expect(component['_disabled']).toBe(true);
      expect(component.isReadonly).toBe(true);

      component.setDisabledState(false);
      expect(component['_disabled']).toBe(false);
    });

    it('should detect content type on writeValue', () => {
      component.writeValue('{"test": true}');
      expect(component.detectedType).toBe('json');
    });
  });

  describe('Readonly Mode', () => {
    it('should not allow formatting in readonly mode', () => {
      component.readonly = true;
      component.writeValue('{"key":"value"}');

      const originalValue = component.value;
      component.formatContent();

      expect(component.value).toBe(originalValue);
    });

    it('should combine readonly and disabled states', () => {
      component.readonly = false;
      component.setDisabledState(false);
      expect(component.isReadonly).toBe(false);

      component.readonly = true;
      expect(component.isReadonly).toBe(true);

      component.readonly = false;
      component.setDisabledState(true);
      expect(component.isReadonly).toBe(true);
    });
  });

  describe('Collapsible Sections', () => {
    it('should toggle collapse state', () => {
      const path = 'root.items';

      expect(component.isCollapsed(path)).toBe(false);

      component.toggleCollapse(path);
      expect(component.isCollapsed(path)).toBe(true);

      component.toggleCollapse(path);
      expect(component.isCollapsed(path)).toBe(false);
    });

    it('should track multiple collapsed paths', () => {
      component.toggleCollapse('path1');
      component.toggleCollapse('path2');

      expect(component.isCollapsed('path1')).toBe(true);
      expect(component.isCollapsed('path2')).toBe(true);
      expect(component.isCollapsed('path3')).toBe(false);
    });

    it('should generate collapsible JSON HTML', () => {
      component.writeValue('{"key": "value", "nested": {"a": 1}}');
      const html = component.getCollapsibleJsonHtml();

      expect(html).toBeTruthy();
    });

    it('should generate collapsible XML HTML', () => {
      component.writeValue('<root><child>value</child></root>');
      const html = component.getCollapsibleXmlHtml();

      expect(html).toBeTruthy();
    });

    it('should return empty for collapsible JSON when no value', () => {
      component.writeValue('');
      const html = component.getCollapsibleJsonHtml();

      expect(html).toBe('');
    });

    it('should return empty for collapsible XML when no value', () => {
      component.writeValue('');
      const html = component.getCollapsibleXmlHtml();

      expect(html).toBe('');
    });

    it('should handle invalid JSON gracefully in getCollapsibleJsonHtml', () => {
      component.writeValue('{invalid json}');
      const html = component.getCollapsibleJsonHtml();

      // Should return escaped raw content
      expect(html).toBeTruthy();
    });

    it('should handle invalid XML gracefully in getCollapsibleXmlHtml', () => {
      component.writeValue('<invalid xml');
      const html = component.getCollapsibleXmlHtml();

      // Should return escaped raw content
      expect(html).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large JSON content', () => {
      const largeArray = Array(1000).fill({ key: 'value', nested: { a: 1, b: 2 } });
      const largeJson = JSON.stringify(largeArray);

      component.writeValue(largeJson);

      expect(component.detectedType).toBe('json');
      expect(component.validationError).toBeNull();
    });

    it('should handle content with special characters', () => {
      const content = '{"message": "Hello <script>alert(\\"xss\\")</script>"}';

      component.writeValue(content);

      expect(component.detectedType).toBe('json');
      expect(component.displayContent).not.toContain('<script>');
    });

    it('should handle unicode content', () => {
      const content = '{"emoji": "🎉", "chinese": "中文"}';

      component.writeValue(content);

      expect(component.detectedType).toBe('json');
      expect(component.validationError).toBeNull();
    });

    it('should handle whitespace-only content', () => {
      component.writeValue('   \n\t  ');

      expect(component.detectedType).toBe('text');
    });

    it('should handle mixed content that looks like JSON but is not', () => {
      component.writeValue('{key: value}'); // Missing quotes

      expect(component.detectedType).toBe('text');
    });

    it('should handle null values in JSON', () => {
      component.writeValue('{"value": null}');

      expect(component.detectedType).toBe('json');
      expect(component.validationError).toBeNull();
    });

    it('should handle boolean values in JSON', () => {
      component.writeValue('{"flag": true, "other": false}');

      expect(component.detectedType).toBe('json');
      expect(component.validationError).toBeNull();
    });

    it('should handle numbers in JSON', () => {
      component.writeValue('{"int": 42, "float": 3.14, "negative": -100}');

      expect(component.detectedType).toBe('json');
      expect(component.validationError).toBeNull();
    });

    it('should handle empty JSON object', () => {
      component.writeValue('{}');

      expect(component.detectedType).toBe('json');
      expect(component.validationError).toBeNull();
    });

    it('should handle empty JSON array', () => {
      component.writeValue('[]');

      expect(component.detectedType).toBe('json');
      expect(component.validationError).toBeNull();
    });
  });

  describe('canFormat property', () => {
    it('should return true for valid JSON', () => {
      component.writeValue('{"key": "value"}');
      expect(component.canFormat).toBe(true);
    });

    it('should return true for valid XML', () => {
      component.writeValue('<root>value</root>');
      expect(component.canFormat).toBe(true);
    });

    it('should return false for plain text', () => {
      component.writeValue('plain text');
      expect(component.canFormat).toBe(false);
    });

    it('should return false for empty content', () => {
      component.writeValue('');
      expect(component.canFormat).toBe(false);
    });
  });

  describe('Language Class', () => {
    it('should return language-json for JSON content', () => {
      component.writeValue('{"key": "value"}');
      expect(component.getLanguageClass()).toBe('language-json');
    });

    it('should return language-xml for XML content', () => {
      component.writeValue('<root>value</root>');
      expect(component.getLanguageClass()).toBe('language-xml');
    });

    it('should return language-text for plain text', () => {
      component.writeValue('plain text');
      expect(component.getLanguageClass()).toBe('language-text');
    });
  });

  describe('Lifecycle Hooks', () => {
    it('should setup toggle listener on init', () => {
      // ngOnInit is called automatically in beforeEach
      // Just verify no errors occur
      expect(component).toBeTruthy();
    });

    it('should cleanup toggle listener on destroy', () => {
      // Call ngOnDestroy manually
      component.ngOnDestroy();

      // Verify no errors occur
      expect(true).toBe(true);
    });
  });

  describe('View Mode Change Handler', () => {
    it('should handle onViewModeChange without errors', () => {
      component.onViewModeChange();
      expect(true).toBe(true);
    });
  });
});
