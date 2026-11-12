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
        { provide: ConnectionGroupService, useValue: { getGroups: () => of([{ id: 'g-env', name: 'Production', type: 'environment' }]) } }
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

  it('one message: no name to type, and the dialog names its sequence number', () => {
    const { el, confirmButton } = render({ queueName: 'orders', sequenceNumbers: [12] });

    expect(el.querySelector('input')).toBeNull();
    expect(fact(el, 'Messages')).toBe('1 scheduled: 12');
    confirmButton().click();
    expect(close).toHaveBeenCalledWith(true);
  });
});
