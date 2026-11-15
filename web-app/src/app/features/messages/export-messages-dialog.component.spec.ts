import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ConnectionGroupService, ConnectionService } from '../../core/services';
import { ExportMessagesDialogComponent } from './export-messages-dialog.component';

describe('ExportMessagesDialogComponent', () => {
  let fixture: ComponentFixture<ExportMessagesDialogComponent>;
  let el: HTMLElement;

  function open() {
    TestBed.configureTestingModule({
      imports: [ExportMessagesDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { messageCount: 3, entityName: 'orders', entityType: 'queue', isDeadLetter: false } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: ConnectionService, useValue: { currentTarget: 'sample.example.net', currentConnectionId: null } },
        { provide: ConnectionGroupService, useValue: {} }
      ]
    });
    fixture = TestBed.createComponent(ExportMessagesDialogComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    return fixture.componentInstance;
  }

  const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const checkboxes = () => Array.from(el.querySelectorAll('mat-checkbox')).map(text);

  it('as Send.dc.html draws it: the title, the sentence, the formats, the options, the note and the buttons', () => {
    open();

    expect(text(el.querySelector('h2')), 'the title counts the messages').toBe('Export 3 Messages');
    expect(text(el.querySelector('mat-dialog-content > p:not(.note)')), 'the sentence').toBe('Export 3 messages from orders');
    expect(Array.from(el.querySelectorAll('legend')).map(text), 'the two groups').toStrictEqual(['Export Format', 'Export Options']);
    expect(Array.from(el.querySelectorAll('mat-radio-button')).map(r => [text(r.querySelector('strong')), text(r.querySelector('.hint'))]), 'the three formats and their notes').toStrictEqual([
      ['JSON', 'Structured data format, suitable for re-import'],
      ['CSV', 'Tabular format, suitable for Excel/spreadsheets'],
      ['Excel (XLSX)', 'Native Excel format with formatted headers and multi-sheet support']
    ]);
    expect(checkboxes(), 'the options of a JSON export and their hints').toStrictEqual([
      'Include application properties Include custom application properties in the export',
      'Pretty-print JSON Format JSON with indentation for better readability'
    ]);
    expect(text(el.querySelector('.note[role="note"]')), 'the note').toBe("Note: The file will be downloaded to your browser's default download location.");
    expect(Array.from(el.querySelectorAll('mat-dialog-actions button')).map(text), 'Cancel, then Export').toStrictEqual(['Cancel', 'Export']);
  });

  it('as Send.dc.html draws it: Pretty-print JSON is offered only for JSON', () => {
    const component = open();

    (el.querySelectorAll('mat-radio-button input')[1] as HTMLInputElement).click();
    fixture.detectChanges();

    expect(component.exportOptions.format, 'CSV is the chosen format').toBe('csv');
    expect(checkboxes(), 'a CSV export has only the properties option')
      .toStrictEqual(['Include application properties Include custom application properties in the export']);
  });
});
