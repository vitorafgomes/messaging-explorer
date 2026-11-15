import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ConnectionGroupService, ConnectionService, MessageImportService, QueueService, TopicService } from '../../core/services';
import { SendMessageRequest } from '../../core/models';
import { ImportMessagesDialogComponent } from './import-messages-dialog.component';

describe('ImportMessagesDialogComponent', () => {
  let fixture: ComponentFixture<ImportMessagesDialogComponent>;
  let el: HTMLElement;
  let snack: { open: ReturnType<typeof vi.fn> };
  let queues: { sendMessages: ReturnType<typeof vi.fn> };

  const parsed = (count: number): SendMessageRequest[] =>
    Array.from({ length: count }, (_, i) => ({ messageId: `m-${i + 1}`, subject: 'OrderPlaced', contentType: 'application/json', body: `{"order":${i + 1}}` }));

  function open(send = vi.fn((_: string, messages: SendMessageRequest[]) => of({ count: messages.length }))) {
    snack = { open: vi.fn() };
    queues = { sendMessages: send };
    TestBed.configureTestingModule({
      imports: [ImportMessagesDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { entityType: 'queue', entityName: 'orders' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: QueueService, useValue: queues },
        { provide: TopicService, useValue: {} },
        { provide: MessageImportService, useValue: {} },
        { provide: ConnectionService, useValue: { currentTarget: 'sample.example.net', currentConnectionId: null } },
        { provide: ConnectionGroupService, useValue: {} }
      ]
    });
    TestBed.overrideProvider(MatSnackBar, { useValue: snack });
    fixture = TestBed.createComponent(ImportMessagesDialogComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    return fixture.componentInstance;
  }

  const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const button = (label: string) =>
    Array.from(el.querySelectorAll('mat-dialog-actions button')).find(b => text(b).startsWith(label)) as HTMLButtonElement;
  const loaded = (count: number) => {
    const component = open();
    component.fileName.set('orders-export.json');
    component.fileSize.set(18842);
    component.parsedMessages.set(parsed(count));
    fixture.detectChanges();
    return component;
  };

  it('as Send.dc.html draws it: the title, the file picker, the parsed note, the preview, the options and the buttons', () => {
    loaded(12);

    expect(text(el.querySelector('h2')), 'the title names the entity').toBe('Import Messages to Queue: orders');
    expect(text(el.querySelector('label[for="import-file"]')), 'the file field').toBe('Select File');
    expect(text(el.querySelector('#import-file-hint')), 'the file hint').toBe('Supported formats: JSON, CSV (exported from this application)');
    expect(text(el.querySelector('.file-info')), 'the chosen file and its size').toBe('orders-export.json18.4 KB');
    expect(text(el.querySelector('p.note[role="status"]')), 'the parsed note').toBe('Parsed 12 messages from file');
    expect(text(el.querySelector('caption')), 'the preview caption').toBe('Preview (first 5 of 12)');
    expect(text(el.querySelector('.preview > .hint')), 'the rest past the preview').toBe('... and 7 more messages');
    expect(text(el.querySelector('legend')), 'the options group').toBe('Import Options');
    expect(Array.from(el.querySelectorAll('mat-checkbox')).map(text), 'the two options and their hints').toStrictEqual([
      'Generate new Message IDs Replace existing message IDs with new UUIDs',
      'Skip messages with empty body Exclude messages that have no body content'
    ]);
    expect(Array.from(el.querySelectorAll('mat-dialog-actions button')).map(text), 'Cancel, then Import with the count').toStrictEqual(['Cancel', 'Import 12 messages']);
  });

  it('as Send.dc.html draws it: a sent import says "Import complete: N sent successfully" in a snack bar with Close, not in the dialog', () => {
    loaded(12);

    button('Import').click();
    fixture.detectChanges();

    expect(queues.sendMessages, 'the batch goes to the queue').toHaveBeenCalledWith('orders', parsed(12));
    expect(snack.open, 'the import result is a snack bar with Close').toHaveBeenCalledWith('Import complete: 12 sent successfully', 'Close', { duration: 5000 });
    expect(text(el.querySelector('mat-dialog-content')), 'a sent import says its result in the snack bar, not in the dialog').not.toContain('Import complete');
    expect(text(button('Close')), 'Cancel becomes Close once the import is done').toBe('Close');
    expect(button('Import').disabled, 'the same file cannot be imported twice').toBe(true);
  });

  it('a refused import is an error in the dialog, with the count that failed, and a snack bar with the reason', () => {
    const component = open(vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'The broker refused the batch' } }))));
    component.parsedMessages.set(parsed(3));
    fixture.detectChanges();

    button('Import').click();
    fixture.detectChanges();

    expect(text(el.querySelector('p.note.result.error')), 'the failure stays in the dialog as an error with its count').toBe('Import stopped: 0 sent, 3 not sent. A message the broker did not confirm may have been sent; read the entity before importing again.');
    expect(snack.open, 'the reason is said in a snack bar').toHaveBeenCalledWith('Import failed: The broker refused the batch', 'Close', { duration: 5000 });
  });

  it('a batch the API answers as partly sent is never shown as a success: it says how many were sent and not, and sends no further request', () => {
    const send = vi.fn((_: string, messages: SendMessageRequest[]) => of({
      success: false, count: 2, failures: messages.slice(2).map((_, i) => ({ index: i + 2, error: 'Not sent: the send stopped before this message.' }))
    }));
    const component = open(send);
    component.parsedMessages.set(parsed(5));
    fixture.detectChanges();

    button('Import').click();
    fixture.detectChanges();

    expect(text(el.querySelector('p.note.result.error')), 'a partial send is an error with both counts').toBe('Import stopped: 2 sent, 3 not sent. A message the broker did not confirm may have been sent; read the entity before importing again.');
    expect(snack.open, 'never the success snack bar').toHaveBeenCalledWith('Import stopped: 3 of 5 not sent', 'Close', { duration: 5000 });
  });

  it('a file of more than 1000 messages is sent in requests of 1000, one after the other, and stops at the first that is not whole', () => {
    const sizes: number[] = [];
    const send = vi.fn((_: string, messages: SendMessageRequest[]) => {
      sizes.push(messages.length);
      return of(sizes.length === 2 ? { success: false, count: 400, failures: [] } : { success: true, count: messages.length });
    });
    const component = open(send);
    component.parsedMessages.set(parsed(2500));
    fixture.detectChanges();

    button('Import').click();
    fixture.detectChanges();

    expect(sizes, 'the API takes at most 1000 per request; after a partial request nothing more is sent').toStrictEqual([1000, 1000]);
    expect(text(el.querySelector('p.note.result.error'))).toContain('Import stopped: 1400 sent, 1100 not sent.');
  });
});
