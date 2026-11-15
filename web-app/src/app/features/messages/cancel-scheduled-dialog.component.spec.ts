import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ConnectionGroupService, ConnectionService } from '../../core/services';
import { CancelScheduledDialogComponent, CancelScheduledDialogData } from './cancel-scheduled-dialog.component';

describe('CancelScheduledDialogComponent', () => {
  let close: ReturnType<typeof vi.fn>;

  function render(data: CancelScheduledDialogData) {
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [CancelScheduledDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
        {
          provide: ConnectionService,
          useValue: {
            currentTarget: 'ns.example.net',
            currentConnectionId: 'c-1',
            getConnections: () => of([{ id: 'c-1', name: 'contoso-prod', environmentId: 'g-env' }])
          }
        },
        { provide: ConnectionGroupService, useValue: { getGroups: () => of([{ id: 'g-env', name: 'Production', type: 'environment', isProduction: true }]) } }
      ]
    });
    const fixture = TestBed.createComponent(CancelScheduledDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const confirmButton = () => Array.from(el.querySelectorAll('button')).find(b => b.textContent!.includes('Cancel') && b.textContent!.includes('scheduled'))!;
    return { fixture, el, confirmButton };
  }

  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const fact = (el: HTMLElement, name: string) =>
    text(Array.from(el.querySelectorAll('.fact')).find(f => text(f.querySelector('dt')) === name)?.querySelector('dd') ?? null);

  it('says the messages are deleted before they are ever delivered, and names the count, the queue, the connection and the environment', () => {
    const { el } = render({ queueName: 'billing/invoices', sequenceNumbers: [12, 13, 14] });

    expect(text(el.querySelector('h2 .title-text'))).toBe('Cancel 3 scheduled messages?');
    expect(text(el.querySelector('.consequence'))).toContain('deleted before they are ever delivered');
    expect(fact(el, 'Queue')).toBe('billing/invoices');
    expect(fact(el, 'Connection')).toBe('contoso-prod (ns.example.net)');
    expect(fact(el, 'Environment')).toBe('Production');
    expect(fact(el, 'Messages')).toBe('3 scheduled');
    expect(text(el.querySelector('.environment-line .where')), 'as Messages.dc.html draws it: the queue on the connection').toBe('billing/invoices on contoso-prod (ns.example.net)');
    const chip = el.querySelector('.environment-line .environment-chip') as HTMLElement;
    expect(chip.textContent?.replace('warning', '').trim(), 'the cancel confirmation opens with the PRODUCTION chip').toBe('PRODUCTION');
    expect(chip.classList.contains('production'), 'a production environment takes the error container').toBe(true);
  });

  it('more than one message: the confirm button stays disabled until the queue name is typed exactly', () => {
    const { fixture, el, confirmButton } = render({ queueName: 'billing/invoices', sequenceNumbers: [12, 13] });
    const input = el.querySelector<HTMLInputElement>('input')!;
    expect(text(el.querySelector('mat-label'))).toBe('Type the queue name to confirm');

    confirmButton().click();
    expect(close).not.toHaveBeenCalled();
    expect(confirmButton().disabled).toBe(true);

    input.value = 'billing/invoice';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(confirmButton().disabled, 'a name that is not exactly the queue').toBe(true);

    input.value = 'billing/invoices';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    confirmButton().click();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('says the button waits for the exact name, and the confirm carries the delete icon', () => {
    const { el, confirmButton } = render({ queueName: 'billing/invoices', sequenceNumbers: [12, 13] });
    expect(el.querySelector('mat-hint')?.textContent?.trim()).toBe('The button stays disabled until the name matches exactly.');
    expect(confirmButton().querySelector('mat-icon')?.getAttribute('fonticon')).toBe('delete');
  });

  it('on a topic: names the topic, asks for the topic name, and offers no export it cannot do', () => {
    const { el } = render({ queueName: 'billing/events', entityKind: 'topic', sequenceNumbers: [12, 13] });

    expect(fact(el, 'Topic'), 'the facts name the topic, not a queue').toBe('billing/events');
    expect(fact(el, 'Queue')).toBe('');
    expect(text(el.querySelector('mat-label'))).toBe('Type the topic name to confirm');
    expect(text(el.querySelector('.consequence'))).toBe('The messages are deleted before they are ever delivered. This cannot be undone.');
  });

  it('one message: no name to type, and the dialog names its sequence number', () => {
    const { el, confirmButton } = render({ queueName: 'orders', sequenceNumbers: [12] });

    expect(el.querySelector('input')).toBeNull();
    expect(fact(el, 'Messages')).toBe('1 scheduled: 12');
    confirmButton().click();
    expect(close).toHaveBeenCalledWith(true);
  });
});
