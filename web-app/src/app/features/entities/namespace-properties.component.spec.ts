import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NEVER, Observable, Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { NamespacePropertiesComponent } from './namespace-properties.component';
import { DefinitionsService } from '../../core/services/definitions.service';
import { DEFAULT_AZURE_CAPABILITIES, ProviderService } from '../../core/services/provider.service';
import { NamespaceInfo } from '../../core/models';

describe('NamespacePropertiesComponent: the namespace facts under the empty state', () => {
  const standard: NamespaceInfo = {
    name: 'contoso-test', tier: 'Standard', messagingUnits: null, alias: null,
    createdTime: '2024-03-01T09:30:00+00:00', modifiedTime: '2026-11-02T17:05:00+00:00', maxMessageSizeInBytes: 262144
  };
  const premium: NamespaceInfo = { ...standard, tier: 'Premium', messagingUnits: 4, alias: 'contoso-alias', maxMessageSizeInBytes: 104857600 };

  function render(answer: Observable<NamespaceInfo>) {
    const properties = vi.fn(() => answer);
    TestBed.configureTestingModule({
      imports: [NamespacePropertiesComponent],
      providers: [
        { provide: DefinitionsService, useValue: { properties } },
        { provide: ProviderService, useValue: { capabilities: signal({ ...DEFAULT_AZURE_CAPABILITIES, supportsNamespaceProperties: true }) } }
      ]
    });
    const fixture = TestBed.createComponent(NamespacePropertiesComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, properties };
  }

  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const facts = (el: HTMLElement) => Array.from(el.querySelectorAll('dl.facts > div')).map(d => [text(d.querySelector('dt')), text(d.querySelector('dd'))]);

  it('a Standard namespace shows its tier, when it was created and the 256 KB limit; no units and no alias', () => {
    const { el, properties } = render(of(standard));

    expect(properties).toHaveBeenCalledTimes(1);
    expect(facts(el), 'the facts list says what the namespace is, as the API read it').toStrictEqual([
      ['Tier', 'Standard'],
      ['Created', 'Mar 1, 2024, 9:30:00 AM'],
      ['Max message size', '256 KB']
    ]);
  });

  it('a Premium namespace shows its messaging units, its geo-DR alias and that the size limit is set on each queue and topic, up to 100 MB', () => {
    const { el } = render(of(premium));

    expect(facts(el), 'a Premium namespace is not held to 256 KB').toStrictEqual([
      ['Tier', 'Premium'],
      ['Messaging units', '4'],
      ['Geo-DR alias', 'contoso-alias'],
      ['Created', 'Mar 1, 2024, 9:30:00 AM'],
      ['Max message size', 'Up to 100 MB, set on each queue and topic']
    ]);
  });

  it('a read that fails says the properties could not be read and that the read needs the Manage right, and shows no made-up tier', () => {
    const { el } = render(throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'An internal error occurred.' } })));

    expect(text(el.querySelector('[role="alert"]')), 'the failure is said, with the right it needs').toBe(
      'The namespace properties could not be read. Reading them needs the Manage right on the namespace.');
    expect(facts(el), 'never a made-up tier: only the default limit, said to be the default').toStrictEqual([
      ['Max message size', '256 KB, the default limit: the tier could not be read']
    ]);
  });

  it('while the read runs it says so, and leaving the empty state stops the read', () => {
    const answer = new Subject<NamespaceInfo>();
    const { fixture, el } = render(answer);

    expect(text(el.querySelector('[role="status"]'))).toBe('Reading the namespace properties');
    expect(answer.observed, 'the read is running').toBe(true);
    fixture.destroy();
    expect(answer.observed, 'the read is cancelled when the panel leaves the empty state').toBe(false);
  });

  it('the read is the one request it makes, and nothing is shown as read before it answers', () => {
    const { el, properties } = render(NEVER);

    expect(properties).toHaveBeenCalledTimes(1);
    expect(el.querySelector('dl.facts')).toBeNull();
  });
});
