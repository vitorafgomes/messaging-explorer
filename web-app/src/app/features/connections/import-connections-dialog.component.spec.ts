import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { ImportConnectionsDialogComponent } from './import-connections-dialog.component';
import { ConnectionService } from '../../core/services';
import { ImportPreview } from '../../core/models';

const preview: ImportPreview = {
  items: [
    { name: 'Contoso', kind: 'Client', target: null, placement: null, exists: true, keepsStoredSecret: false },
    { name: 'Development', kind: 'Environment of Contoso', target: null, placement: null, exists: true, keepsStoredSecret: false },
    { name: 'Contoso development', kind: 'Azure Service Bus', target: 'contoso-dev.servicebus.windows.net', placement: 'Contoso, Development', exists: true, keepsStoredSecret: true },
    { name: 'Contoso development, CLI', kind: 'Azure Service Bus', target: 'contoso-dev.servicebus.windows.net', placement: 'Contoso, Development', exists: false, keepsStoredSecret: false }
  ],
  add: 1,
  update: 3,
  secretsMasked: true,
  notInFile: ['Contoso RabbitMQ']
};

describe('ImportConnectionsDialogComponent', () => {
  let service: { previewImport: ReturnType<typeof vi.fn>; importFullConfiguration: ReturnType<typeof vi.fn> };
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  function render() {
    dialogRef = { close: vi.fn() };
    TestBed.configureTestingModule({
      imports: [ImportConnectionsDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: ConnectionService, useValue: service },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { fileName: 'messaging-explorer-export.json', json: '{"Connections":[]}' } }
      ]
    });
    const fixture = TestBed.createComponent(ImportConnectionsDialogComponent);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const importButton = () => Array.from(element.querySelectorAll('button')).find(b => b.textContent?.includes('Import:'));
    return { fixture, element, importButton };
  }

  beforeEach(() => {
    service = {
      previewImport: vi.fn().mockReturnValue(of(preview)),
      importFullConfiguration: vi.fn().mockReturnValue(of({ message: 'Configuration imported successfully: 2 connections, 2 groups' }))
    };
  });

  it('names the file, says it is not yet applied, and previews every item with what the import does to it', () => {
    const { element, importButton } = render();

    expect(service.previewImport).toHaveBeenCalledWith('{"Connections":[]}');
    expect(service.importFullConfiguration).not.toHaveBeenCalled();
    expect(element.querySelector('h2')?.textContent?.trim()).toBe('Import connections');
    expect(Array.from(element.querySelectorAll('.file-line span')).map(s => s.textContent?.trim()))
      .toEqual(['messaging-explorer-export.json', 'read on this computer and not yet applied.']);
    expect(element.textContent).toContain('This will import connections and groups from the selected file. Existing items with the same ID will be updated.');
    expect(Array.from(element.querySelectorAll('thead th')).map(th => th.textContent?.trim())).toEqual(['Item', 'Kind', 'Target', 'On import']);
    const rows = Array.from(element.querySelectorAll('tbody tr')).map(tr =>
      Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.replace(/\s+/g, ' ').trim()));
    expect(rows).toEqual([
      ['Contoso', 'Client', 'Not applicable', 'Already exists, updated.'],
      ['Development', 'Environment of Contoso', 'Not applicable', 'Already exists, updated.'],
      ['Contoso development', 'Azure Service Bus', 'contoso-dev.servicebus.windows.net', 'Already exists, updated. The stored secret is kept.'],
      ['Contoso development, CLI', 'Azure Service Bus', 'contoso-dev.servicebus.windows.net', 'New, added to Contoso, Development']
    ]);
    expect(importButton()?.textContent?.replace('upload', '').trim()).toBe('Import: add 1, update 3');
  });

  it('a stored connection whose connection string arrives masked says "The stored connection string is kept."; a masked password says so', () => {
    const json = JSON.stringify({
      Groups: [{ Id: 'g1', Name: 'Contoso' }, { Id: 'g2', Name: 'Development' }],
      Connections: [
        { Id: 'c1', Name: 'Contoso development', ConnectionString: '***' },
        { Id: 'c2', Name: 'Contoso development, CLI' }
      ]
    });
    const rabbit = { ...preview.items[2], name: 'Contoso RabbitMQ', kind: 'RabbitMQ' };
    service.previewImport.mockReturnValue(of({ ...preview, items: [...preview.items, rabbit] }));
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { fileName: 'export.json', json: JSON.stringify({
      ...JSON.parse(json), Connections: [...JSON.parse(json).Connections, { id: 'c3', name: 'Contoso RabbitMQ', password: '***' }]
    }) } });
    const { element } = render();

    const outcomes = Array.from(element.querySelectorAll('tbody tr')).map(tr => tr.querySelector('td:last-child')?.textContent?.replace(/\s+/g, ' ').trim());
    expect(outcomes[2], 'the drawn outcome for a connection-string connection').toBe('Already exists, updated. The stored connection string is kept.');
    expect(outcomes[4], 'another secret kind is named as what it is').toBe('Already exists, updated. The stored password is kept.');
  });

  it('says the secrets in the file are masked, which stored connections keep theirs and what the import leaves', () => {
    const { element } = render();

    expect(element.querySelector('.masked')?.textContent?.replace('info', '').replace(/\s+/g, ' ').trim()).toBe(
      'The secrets in this file are masked. A masked value never overwrites a stored secret, so the 1 existing connection keeps its. '
      + 'Nothing is removed: the connection Contoso RabbitMQ is not in the file and stays.');
  });

  it('says nothing about masking when no secret in the file is masked', () => {
    service.previewImport.mockReturnValue(of({ ...preview, secretsMasked: false }));
    const { element } = render();

    expect(element.querySelector('.masked')).toBeNull();
  });

  it('a preview the API refuses is an error with no Import button, and nothing is imported', () => {
    service.previewImport.mockReturnValue(throwError(() => ({ error: { message: 'Invalid JSON format.' } })));
    const { element, importButton } = render();

    expect(element.querySelector('.error')?.textContent?.replace('error', '').replace(/\s+/g, ' ').trim())
      .toBe('The file could not be previewed. Invalid JSON format. Nothing was imported.');
    expect(importButton()).toBeUndefined();
    expect(element.querySelector('table')).toBeNull();
    expect(service.importFullConfiguration).not.toHaveBeenCalled();
  });

  it('Import sends the file and closes with the API message', () => {
    const { importButton } = render();

    importButton()!.click();

    expect(service.importFullConfiguration).toHaveBeenCalledWith('{"Connections":[]}');
    expect(dialogRef.close).toHaveBeenCalledWith('Configuration imported successfully: 2 connections, 2 groups');
  });

  it('a failed import keeps the dialog open, says the import failed and lets the user try again', () => {
    service.importFullConfiguration.mockReturnValue(throwError(() => ({ error: { message: 'An internal error occurred.' } })));
    const { fixture, element, importButton } = render();

    importButton()!.click();
    fixture.detectChanges();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(element.querySelector('.error')?.textContent?.replace('error', '').replace(/\s+/g, ' ').trim())
      .toBe('The import failed. An internal error occurred.');
    expect(importButton()?.disabled).toBe(false);
  });
});
