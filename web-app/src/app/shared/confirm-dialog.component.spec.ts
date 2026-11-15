import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { ConfirmDialogComponent, ConfirmDialogData } from './confirm-dialog.component';
import { ConnectionGroupService, ConnectionService } from '../core/services';

describe('ConfirmDialogComponent', () => {
  function render(data: ConfirmDialogData) {
    return renderFixture(data).nativeElement as HTMLElement;
  }

  /** The active connection: contoso-prod in Contoso / the given environment, or in none. */
  let environment: { name: string; isProduction?: boolean } | null = null;

  function renderFixture(data: ConfirmDialogData) {
    TestBed.configureTestingModule({
      imports: [ConfirmDialogComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: ConnectionService,
          useValue: {
            currentTarget: 'contoso-prod.servicebus.windows.net',
            currentConnectionId: 'c-1',
            getConnections: () => of([{ id: 'c-1', name: 'contoso-prod', clientId: 'g-client', environmentId: environment ? 'g-env' : undefined }])
          }
        },
        {
          provide: ConnectionGroupService,
          useValue: { getGroups: () => of([{ id: 'g-client', name: 'Contoso', type: 'client' }, { id: 'g-env', type: 'environment', ...environment }]) }
        },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(ConfirmDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('lists the facts it applies to and sets the notice apart, as named', () => {
    const el = render({
      title: 'Delete connection?',
      message: 'This removes the saved connection.',
      notice: 'This is the active connection.',
      facts: [{ label: 'Connection', value: 'orders' }, { label: 'Target', value: 'localhost:5672' }],
    });
    expect(el.querySelector('.notice')?.textContent?.replace('warning', '').trim()).toBe('This is the active connection.');
    expect(Array.from(el.querySelectorAll('.facts div')).map(d => [d.querySelector('dt')?.textContent, d.querySelector('dd')?.textContent]))
      .toEqual([['Connection', 'orders'], ['Target', 'localhost:5672']]);
  });

  describe('the environment line under the title, as Components.dc.html draws the purge confirmation', () => {
    const purge: ConfirmDialogData = {
      title: 'Purge active messages?',
      message: 'This deletes every active message in the queue. It cannot be undone.',
      context: { subject: 'orders' },
    };
    const line = (el: HTMLElement) => el.querySelector('mat-dialog-content > app-environment-line .environment-line') as HTMLElement;
    const chip = (el: HTMLElement) => line(el).querySelector('.environment-chip') as HTMLElement;

    it('a purge on a production connection: PRODUCTION in the error container, then "orders on <connection>", before the message', () => {
      environment = { name: 'Production', isProduction: true };
      const el = render(purge);

      expect(chip(el).textContent?.replace('warning', '').trim(), 'a production environment says PRODUCTION').toBe('PRODUCTION');
      expect(chip(el).classList.contains('production'), 'PRODUCTION takes the error container').toBe(true);
      expect(line(el).querySelector('.where')?.textContent?.trim(), 'the entity on the active connection').toBe('orders on Contoso (contoso-prod.servicebus.windows.net)');
      expect(line(el).querySelector('.where b')?.textContent).toBe('orders');
      expect(el.querySelector('mat-dialog-content > app-environment-line + p')?.textContent).toBe(purge.message);
    });

    it('a purge on a connection in no environment says NO ENVIRONMENT', () => {
      environment = null;
      expect(chip(render(purge)).textContent?.trim(), 'a connection in no environment says NO ENVIRONMENT').toBe('NO ENVIRONMENT');
    });

    it('a given environment and place are drawn as given, and the active connection is not read', () => {
      const el = render({
        title: 'Delete connection?', message: 'This removes the saved connection.',
        context: { subject: 'Contoso RabbitMQ', where: 'to rabbit.contoso.internal:5672', mark: { name: null, isProduction: false } }
      });

      expect(chip(el).textContent?.trim()).toBe('NO ENVIRONMENT');
      expect(line(el).querySelector('.where')?.textContent?.trim()).toBe('Contoso RabbitMQ to rabbit.contoso.internal:5672');
    });

    it('a dialog opened without a context draws no line', () => {
      expect(render({ title: 'Delete group?', message: 'Removes the group.' }).querySelector('app-environment-line')).toBeNull();
    });
  });

  describe('the actions, as Components.dc.html draws the destructive confirmation', () => {
    const actions = (el: HTMLElement) => Array.from(el.querySelectorAll('mat-dialog-actions button')) as HTMLButtonElement[];

    it('Cancel is the text button on the left of the pair; a destructive confirm is filled error with the delete icon', () => {
      const [cancel, confirm] = actions(render({ title: 'Delete connection?', message: 'Removes it.', confirmText: 'Delete connection' }));

      expect(cancel.textContent?.trim(), 'Cancel comes first, on the left of the pair').toBe('Cancel');
      expect(cancel.classList.contains('mat-mdc-button'), 'Cancel is always the text button').toBe(true);
      expect(cancel.classList.contains('mat-mdc-outlined-button'), 'Cancel is not outlined').toBe(false);
      expect(confirm.textContent?.trim(), 'the label says what').toBe('Delete connection');
      expect(confirm.classList.contains('mat-mdc-unelevated-button'), 'the confirm button is filled').toBe(true);
      expect(confirm.classList.contains('destructive'), 'a destructive confirm takes the error colour').toBe(true);
      expect(confirm.querySelector('mat-icon')?.getAttribute('fontIcon'), 'a destructive confirm carries the delete icon').toBe('delete');
      expect(confirm.querySelector('mat-icon')?.getAttribute('aria-hidden'), 'the icon adds nothing to the button name').toBe('true');
    });

    it('a non-destructive confirm is filled primary with no icon, as the dialog shell draws "Review changes"', () => {
      const [cancel, confirm] = actions(render({ title: 'Large selection', message: 'Select 600 messages?', confirmText: 'Select all', confirmColor: 'primary' }));

      expect(cancel.classList.contains('mat-mdc-button'), 'Cancel is always the text button').toBe(true);
      expect(confirm.classList.contains('destructive'), 'only a destructive confirm takes the error colour').toBe(false);
      expect(confirm.querySelector('mat-icon'), 'the shell draws no icon on a non-destructive confirm').toBeNull();
    });
  });

  it('shows neither a notice nor facts when none is given', () => {
    const el = render({ title: 'Purge?', message: 'Removes every message.' });
    expect(el.querySelector('.notice')).toBeNull();
    expect(el.querySelector('.facts')).toBeNull();
  });

  describe('a purge is confirmed by typing the entity name', () => {
    const purge: ConfirmDialogData = {
      title: 'Purge active messages?',
      message: 'This deletes every active message in queue "orders". It cannot be undone.',
      confirmText: 'Purge 3 messages',
      typedName: 'orders',
      typedLabel: 'Type the queue name to confirm',
    };

    it('the confirm button stays disabled until the trimmed text equals the name, case included', () => {
      const fixture = renderFixture(purge);
      const el = fixture.nativeElement as HTMLElement;
      const input = el.querySelector('input') as HTMLInputElement;
      const confirm = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Purge 3 messages')!;
      const cancel = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Cancel')!;
      const type = (text: string) => {
        input.value = text;
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        return confirm.disabled;
      };

      expect(el.querySelector('mat-label')?.textContent?.trim(), 'the field is labelled with what to type').toBe('Type the queue name to confirm');
      expect(el.querySelector('mat-hint')?.textContent?.trim(), 'the hint says why the button is disabled').toBe('The button stays disabled until the name matches exactly.');
      expect([input.placeholder, input.getAttribute('autocomplete'), input.getAttribute('spellcheck')]).toStrictEqual(['orders', 'off', 'false']);
      expect(el.querySelector('mat-checkbox'), 'the typed name replaces the checkbox').toBeNull();
      expect(confirm.disabled, 'disabled before anything is typed').toBe(true);
      expect(type('Orders'), 'a name that differs only in case does not confirm').toBe(true);
      expect(type('order'), 'part of the name does not confirm').toBe(true);
      expect(type('  orders  '), 'the exact name, surrounding spaces trimmed, confirms').toBe(false);
      expect(type('orders1'), 'the button is disabled again when the text stops matching').toBe(true);
      expect(cancel.disabled, 'Cancel is never disabled').toBe(false);
    });

    it('keeps the facts and the notice beside the typed name', () => {
      const el = render({ ...purge, notice: 'Production', facts: [{ label: 'Queue', value: 'orders' }] });
      expect(el.querySelector('.notice')?.textContent?.replace('warning', '').trim()).toBe('Production');
      expect(Array.from(el.querySelectorAll('.facts dd')).map(d => d.textContent)).toStrictEqual(['orders']);
      expect(el.querySelector('mat-label')?.textContent?.trim()).toBe('Type the queue name to confirm');
    });

    it('a confirmation with no typed name has no field and its button is enabled', () => {
      const el = render({ title: 'Large selection', message: 'Select 600 messages?', confirmText: 'Select all' });
      expect(el.querySelector('input')).toBeNull();
      expect(Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Select all')!.disabled).toBe(false);
    });
  });
});
