import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ConnectionGroupService, ConnectionService, QueueService } from '../../core/services';
import { MoveMessagesDialogComponent } from './move-messages-dialog.component';

describe('MoveMessagesDialogComponent', () => {
  let fixture: ComponentFixture<MoveMessagesDialogComponent>;
  let el: HTMLElement;

  function open(queues: string[], detecting: string[] = []) {
    TestBed.configureTestingModule({
      imports: [MoveMessagesDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { currentQueueName: 'orders', messageCount: 3, isDeadLetter: false } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: QueueService, useValue: { getQueues: () => of(queues.map(name => ({ name }))), getQueue: (name: string) => of({ name, requiresDuplicateDetection: detecting.includes(name) }) } },
        { provide: ConnectionService, useValue: { currentTarget: 'sample.example.net', currentConnectionId: null } },
        { provide: ConnectionGroupService, useValue: {} }
      ]
    });
    fixture = TestBed.createComponent(MoveMessagesDialogComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    return fixture.componentInstance;
  }

  const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('a target that detects duplicates offers "Send with a new message ID", off by default, and the move carries it only when ticked', () => {
    const component = open(['orders', 'archive', 'audit'], ['archive']);

    const choose = (name: string) => {
      const select = el.querySelector('select') as HTMLSelectElement;
      select.value = name;
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    choose('audit');
    expect(el.querySelector('.new-message-id'), 'a target without duplicate detection shows no option').toBeNull();

    choose('archive');
    expect(text(el.querySelector('.new-message-id')), 'the chosen target detects duplicates').toBe('Send with a new message ID');
    expect(component.choice(), 'unticked, the move keeps the original ids').toEqual({ targetQueueName: 'archive', newMessageIdOnDuplicateDetection: false });

    component.newMessageId.set(true);
    fixture.detectChanges();
    expect(component.choice(), 'ticked, the move asks for new ids').toEqual({ targetQueueName: 'archive', newMessageIdOnDuplicateDetection: true });
  });
  const buttons = () => Array.from(el.querySelectorAll('mat-dialog-actions button')) as HTMLButtonElement[];

  it('as Send.dc.html draws it: the title, the sentence, the target field and its hint, Cancel and a disabled Move Messages', () => {
    open(['orders', 'billing/invoices', 'notifications', 'orders-archive']);

    expect(text(el.querySelector('h2')), 'the title counts the messages').toBe('Move 3 Messages');
    expect(text(el.querySelector('mat-dialog-content > p')), 'the sentence').toBe('Select the target queue to move 3 messages from orders.');
    expect(text(el.querySelector('mat-label')), 'the field').toBe('Target Queue');
    expect(Array.from(el.querySelectorAll('option')).map(text), 'every queue but the source, after the placeholder')
      .toStrictEqual(['-- Select a queue --', 'billing/invoices', 'notifications', 'orders-archive']);
    expect(text(el.querySelector('mat-hint')), 'the hint').toBe('Select the destination queue for the selected messages');
    expect(el.querySelector('.note'), 'no note before a target is chosen').toBeNull();
    expect(buttons().map(text), 'Cancel, then Move Messages').toStrictEqual(['Cancel', 'Move Messages']);
    expect(buttons()[1].disabled, 'Move Messages waits for a target').toBe(true);
  });

  it('as Send.dc.html draws it: a chosen target shows the note that names both queues, and Move Messages is enabled', () => {
    const component = open(['orders', 'orders-archive']);

    const select = el.querySelector('select') as HTMLSelectElement;
    select.value = 'orders-archive';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(component.selectedTargetQueue, 'the chosen option is the target').toBe('orders-archive');
    expect(text(el.querySelector('.note[role="note"]')), 'the note names the source and the target')
      .toBe('Note: Messages will be moved from orders to orders-archive. The original messages will be removed from the source queue.');
    expect(buttons()[1].disabled, 'Move Messages is enabled once a target is chosen').toBe(false);
  });
});
