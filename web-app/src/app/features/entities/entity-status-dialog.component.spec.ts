import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ConnectionGroupService, ConnectionService, EntitySelectionService, QueueService, TopicService } from '../../core/services';
import { EntityStatusDialogComponent, EntityStatusDialogData } from './entity-status-dialog.component';

describe('EntityStatusDialogComponent: enable and disable an entity', () => {
  let fixture: ComponentFixture<EntityStatusDialogComponent>;
  let el: HTMLElement;
  let close: ReturnType<typeof vi.fn>;
  let updateQueue: ReturnType<typeof vi.fn>;
  let updateTopic: ReturnType<typeof vi.fn>;
  let updateSubscription: ReturnType<typeof vi.fn>;
  let selection: Record<string, ReturnType<typeof vi.fn>>;

  function open(data: EntityStatusDialogData) {
    close = vi.fn();
    updateQueue = vi.fn((name: string, body: object) => of({ name, ...body }));
    updateTopic = vi.fn((name: string, body: object) => of({ name, ...body }));
    updateSubscription = vi.fn((topic: string, name: string, body: object) => of({ topicName: topic, name, ...body }));
    selection = { showEntity: vi.fn(), refreshTree: vi.fn(), clearSelection: vi.fn() };
    TestBed.configureTestingModule({
      imports: [EntityStatusDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
        { provide: QueueService, useValue: { updateQueue } },
        { provide: TopicService, useValue: { updateTopic, updateSubscription } },
        { provide: EntitySelectionService, useValue: selection },
        {
          provide: ConnectionService,
          useValue: { currentTarget: 'ns.example.net', currentConnectionId: 'c-1', getConnections: () => of([{ id: 'c-1', name: 'contoso-prod', environmentId: 'g-env' }]) }
        },
        { provide: ConnectionGroupService, useValue: { getGroups: () => of([{ id: 'g-env', name: 'Production', type: 'environment' }]) } }
      ]
    });
    fixture = TestBed.createComponent(EntityStatusDialogComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    return fixture.componentInstance;
  }

  const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const options = () => Array.from(el.querySelectorAll('mat-radio-button')).map(r => text(r.querySelector('b')));
  const button = (label: string) => Array.from(el.querySelectorAll('button')).find(b => text(b) === label) as HTMLButtonElement | undefined;
  const click = (label: string) => {
    button(label)!.click();
    fixture.detectChanges();
  };
  const choose = (status: string) => {
    fixture.componentInstance.choice.set(status as never);
    fixture.detectChanges();
  };
  const typeName = (value: string) => {
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const facts = () => Array.from(el.querySelectorAll('.fact')).map(f => `${text(f.querySelector('dt'))}: ${text(f.querySelector('dd'))}`);

  describe('only the values the contract allows for the kind are offered', () => {
    it('a queue: Active, Send disabled, Receive disabled, Disabled', () => {
      open({ kind: 'queue', entityName: 'orders', status: 'Active' });
      expect(options()).toStrictEqual(['Active', 'Send disabled', 'Receive disabled', 'Disabled']);
    });

    it('a topic: no Receive disabled', () => {
      open({ kind: 'topic', entityName: 'events', status: 'Active' });
      expect(options()).toStrictEqual(['Active', 'Send disabled', 'Disabled']);
    });

    it('a subscription: no Send disabled', () => {
      open({ kind: 'subscription', entityName: 'billing', topicName: 'events', status: 'Active' });
      expect(options()).toStrictEqual(['Active', 'Receive disabled', 'Disabled']);
    });
  });

  it('Continue is disabled while the chosen status is the current one', () => {
    open({ kind: 'queue', entityName: 'orders', status: 'Active' });
    expect(button('Continue')!.disabled).toBe(true);
    choose('Disabled');
    expect(button('Continue')!.disabled).toBe(false);
  });

  it('a non-Active value says what stops, names the entity, connection and environment, and needs the typed name; the PATCH is { status } only', () => {
    open({ kind: 'queue', entityName: 'orders', status: 'Active' });
    choose('SendDisabled');
    click('Continue');

    expect(text(el.querySelector('h2'))).toBe('warning Disable sending to orders?');
    expect(text(el.querySelector('.consequence'))).toBe('Senders are refused. Receivers keep draining the messages already there. It lasts until the status is set back to Active.');
    expect(facts()).toStrictEqual([
      'Queue: orders',
      'Connection: contoso-prod (ns.example.net)',
      'Environment: Production',
      'Status: Active to Send disabled'
    ]);
    expect(button('Disable sending')!.disabled, 'Disable sending is off before the name is typed').toBe(true);
    typeName('order');
    expect(button('Disable sending')!.disabled, 'Disable sending is off for a name that differs').toBe(true);
    typeName('orders');
    expect(button('Disable sending')!.disabled, 'Disable sending is on once the name matches').toBe(false);

    click('Disable sending');

    expect(updateQueue.mock.calls).toStrictEqual([['orders', { status: 'SendDisabled' }]]);
    expect(selection['showEntity']).toHaveBeenCalledWith({ name: 'orders', status: 'SendDisabled' });
    expect(close).toHaveBeenCalledWith({ name: 'orders', status: 'SendDisabled' });
  });

  it('Disabled says nothing is sent or received; ReceiveDisabled says receivers are refused', () => {
    open({ kind: 'subscription', entityName: 'billing', topicName: 'events', status: 'Active' });
    choose('Disabled');
    click('Continue');
    expect(text(el.querySelector('.consequence'))).toContain('Nothing is sent or received');
    expect(facts()[1]).toBe('Topic: events');
    click('Back');
    choose('ReceiveDisabled');
    click('Continue');
    expect(text(el.querySelector('.consequence'))).toContain('Receivers are refused');
    typeName('billing');
    click('Disable receiving');

    expect(updateSubscription.mock.calls).toStrictEqual([['events', 'billing', { status: 'ReceiveDisabled' }]]);
  });

  it('by keyboard: Continue puts focus in the typed-name field, Back returns it to the chosen status', () => {
    open({ kind: 'queue', entityName: 'orders', status: 'Active' });
    choose('Disabled');
    click('Continue');
    expect(document.activeElement, 'focus after Continue').toBe(el.querySelector('input'));

    click('Back');
    expect((document.activeElement as HTMLInputElement | null)?.value, 'focus after Back').toBe('Disabled');
  });

  it('returning to Active needs a plain confirmation, without the typed name', () => {
    open({ kind: 'topic', entityName: 'events', status: 'SendDisabled' });
    choose('Active');
    click('Continue');

    expect(el.querySelector('input')).toBeNull();
    expect(button('Set Active')!.disabled).toBe(false);
    click('Set Active');

    expect(updateTopic.mock.calls).toStrictEqual([['events', { status: 'Active' }]]);
  });

  it('a refused change (400) shows the API message in the dialog, which stays open; a 500 shows a generic failure', () => {
    open({ kind: 'queue', entityName: 'orders', status: 'Active' });
    updateQueue.mockImplementation(() => throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'The broker refused this configuration.' } })));
    choose('Disabled');
    click('Continue');
    typeName('orders');
    click('Disable');

    expect(text(el.querySelector('[role="alert"] .grow'))).toBe('The broker refused this configuration.');
    expect(close).not.toHaveBeenCalled();
    expect(selection['showEntity']).not.toHaveBeenCalled();
    expect(el.querySelector('mat-progress-bar')).toBeNull();

    updateQueue.mockImplementation(() => throwError(() => new HttpErrorResponse({ status: 500 })));
    click('Disable');
    expect(text(el.querySelector('[role="alert"] .grow'))).toBe('Could not change the status: the API did not confirm it. Try again.');
    expect(close).not.toHaveBeenCalled();
  });

  it('a 404 says the entity no longer exists and offers Refresh', () => {
    open({ kind: 'queue', entityName: 'orders', status: 'Active' });
    updateQueue.mockImplementation(() => throwError(() => new HttpErrorResponse({ status: 404 })));
    choose('Disabled');
    click('Continue');
    typeName('orders');
    click('Disable');

    expect(text(el.querySelector('[role="alert"] .grow'))).toBe('This queue no longer exists. Refresh to see the entities as they are now.');
    expect(button('Refresh'), 'a Refresh action is offered').toBeDefined();
    click('Refresh');
    expect(selection['refreshTree']).toHaveBeenCalledTimes(1);
    expect(selection['clearSelection']).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
