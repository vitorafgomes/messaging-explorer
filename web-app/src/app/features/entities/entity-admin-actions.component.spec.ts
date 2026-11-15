import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ProviderService } from '../../core/services/provider.service';
import { ProviderCapabilities } from '../../core/models/provider.model';
import { EntityAdminActionsComponent } from './entity-admin-actions.component';
import { EntityFormDialogComponent } from './entity-form-dialog.component';
import { EntityStatusDialogComponent } from './entity-status-dialog.component';

describe('EntityAdminActionsComponent', () => {
  let open: ReturnType<typeof vi.fn>;
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  function render(kind: string, entity: object | null, capabilities: Partial<ProviderCapabilities> | null, part: 'status' | 'edit' = 'edit') {
    open = vi.fn();
    TestBed.configureTestingModule({
      imports: [EntityAdminActionsComponent],
      providers: [
        { provide: MatDialog, useValue: { open } },
        { provide: ProviderService, useValue: { capabilities: signal(capabilities) } }
      ]
    });
    const fixture = TestBed.createComponent(EntityAdminActionsComponent);
    fixture.componentRef.setInput('kind', kind);
    fixture.componentRef.setInput('entity', entity);
    fixture.componentRef.setInput('part', part);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const button = (el: HTMLElement, label: string) =>
    Array.from(el.querySelectorAll('button')).find(b => text(b).endsWith(label)) as HTMLButtonElement;

  it('the status chip says the status in words with an icon, not by colour alone, and is named "Status: <status>. Change status"', () => {
    const el = render('queue', { name: 'orders', status: 'SendDisabled' }, { supportsEntityUpdate: true }, 'status');
    const chip = el.querySelector('button.status-chip')!;

    expect(text(chip)).toBe('Send disabled');
    expect(chip.querySelector('mat-icon')!.getAttribute('fontIcon')).toBe('cancel_schedule_send');
    expect(chip.getAttribute('aria-label')).toBe('Status: Send disabled. Change status');
    expect(el.querySelectorAll('button').length, 'only the chip in the status part').toBe(1);
  });

  it('Edit opens the form dialog in edit mode with the entity as read', () => {
    const entity = { name: 'orders', status: 'Active' };
    const el = render('queue', entity, { supportsEntityUpdate: true });

    button(el, 'Edit').click();

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(EntityFormDialogComponent);
    expect(open.mock.calls[0][1].data).toStrictEqual({ mode: 'edit', kind: 'queue', entity, topicName: undefined });
  });

  it('the status chip opens the status dialog for the subscription under its topic, with the status as read', () => {
    const el = render('subscription', { topicName: 'events', name: 'billing', status: 'Active' }, { supportsEntityUpdate: true }, 'status');

    el.querySelector<HTMLButtonElement>('button.status-chip')!.click();

    expect(open.mock.calls[0][0]).toBe(EntityStatusDialogComponent);
    expect(open.mock.calls[0][1].data).toStrictEqual({ kind: 'subscription', entityName: 'billing', topicName: 'events', status: 'Active' });
  });

  it('nothing is rendered unless the capability is explicitly true', () => {
    for (const capabilities of [null, {}, { supportsEntityUpdate: false }]) {
      for (const part of ['status', 'edit'] as const) {
        const el = render('queue', { name: 'orders', status: 'Active' }, capabilities, part);
        expect(el.querySelectorAll('button').length).toBe(0);
        TestBed.resetTestingModule();
      }
    }
  });
});
