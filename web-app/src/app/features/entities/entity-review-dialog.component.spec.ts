import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { EntityReviewDialogComponent, EntityReviewDialogData } from './entity-review-dialog.component';

describe('EntityReviewDialogComponent', () => {
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  function render(data: EntityReviewDialogData): HTMLElement {
    TestBed.configureTestingModule({
      imports: [EntityReviewDialogComponent],
      providers: [{ provide: MAT_DIALOG_DATA, useValue: data }, { provide: MatDialogRef, useValue: { close: vi.fn() } }]
    });
    const fixture = TestBed.createComponent(EntityReviewDialogComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('the review lists each changed field with its current and new value, and names the entity, its topic, the connection and the environment', () => {
    const el = render({
      kind: 'subscription',
      entityName: 'billing',
      topicName: 'events',
      context: signal({ connection: 'contoso-prod (ns.example.net)', where: 'Contoso (ns.example.net)', environment: 'Contoso / Production', mark: { name: 'Production', isProduction: true } }),
      changes: [
        { label: 'Lock duration', from: '2 minutes', to: '5 minutes' },
        { label: 'Forward to', from: 'orders-retry', to: 'None' }
      ]
    });

    expect(text(el.querySelector('h2'))).toBe('warning Change the subscription billing?');
    expect(Array.from(el.querySelectorAll('.fact')).map(f => `${text(f.querySelector('dt'))}: ${text(f.querySelector('dd'))}`)).toStrictEqual([
      'Subscription: billing',
      'Topic: events',
      'Connection: contoso-prod (ns.example.net)',
      'Environment: Contoso / Production'
    ]);
    expect(Array.from(el.querySelectorAll('tr')).map(row => Array.from(row.children).map(text))).toStrictEqual([
      ['Field', 'Current value', 'New value'],
      ['Lock duration', '2 minutes', '5 minutes'],
      ['Forward to', 'orders-retry', 'None']
    ]);
    expect(Array.from(el.querySelectorAll('button')).map(text)).toStrictEqual(['Back', 'Apply 2 changes']);
  });

  it('as EntityAdmin.dc.html draws it: the line "billing on <connection>" under the title, the entity in bold', () => {
    const el = render({
      kind: 'subscription', entityName: 'billing', topicName: 'events',
      context: signal({ connection: 'contoso-prod (ns.example.net)', where: 'Contoso (ns.example.net)', environment: 'Contoso / Production', mark: { name: 'Production', isProduction: true } }),
      changes: [{ label: 'Lock duration', from: '2 minutes', to: '5 minutes' }]
    });

    expect(text(el.querySelector('.environment-line .where'))).toBe('billing on Contoso (ns.example.net)');
    expect(text(el.querySelector('.environment-line .where b'))).toBe('billing');
    const chip = el.querySelector('.environment-line .environment-chip') as HTMLElement;
    expect(chip.textContent?.replace('warning', '').trim(), 'the review opens with the PRODUCTION chip').toBe('PRODUCTION');
    expect(chip.classList.contains('production'), 'a production environment takes the error container').toBe(true);
  });
});
