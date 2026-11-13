import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DefinitionsService, countDefinitions, describeCounts } from './definitions.service';
import { ApiService } from './api.service';

describe('DefinitionsService: export, dry run and import of the namespace definitions, through ApiService only', () => {
  let service: DefinitionsService;
  let post: ReturnType<typeof vi.fn>;

  const DOCUMENT = { version: 1, entities: { queues: [{ name: 'orders' }], topics: [] } };

  beforeEach(() => {
    post = vi.fn(() => of({}));
    TestBed.configureTestingModule({ providers: [DefinitionsService, { provide: ApiService, useValue: { post } }] });
    service = TestBed.inject(DefinitionsService);
  });

  it('export posts to namespace/export; the dry run and the import post the same document to namespace/import with dryRun true, then false', () => {
    service.export().subscribe();
    service.dryRun(DOCUMENT).subscribe();
    service.import(DOCUMENT).subscribe();

    expect(post.mock.calls).toStrictEqual([
      ['namespace/export', {}],
      ['namespace/import?dryRun=true', DOCUMENT],
      ['namespace/import?dryRun=false', DOCUMENT]
    ]);
  });

  it('counts the queues, topics, subscriptions and rules of a document, a null entry or a missing list as none', () => {
    const counts = countDefinitions({
      version: 1,
      entities: {
        queues: [{ name: 'orders' }, null, { name: 'billing' }],
        topics: [{ name: 'events', subscriptions: [{ name: 'audit', rules: [{}, {}] }, null, { name: 'email' }] }, null]
      }
    });

    expect(counts).toStrictEqual({ queues: 2, topics: 1, subscriptions: 2, rules: 2 });
    expect(describeCounts(counts)).toBe('2 queues, 1 topic, 2 subscriptions, 2 rules');
    expect(countDefinitions({})).toStrictEqual({ queues: 0, topics: 0, subscriptions: 0, rules: 0 });
  });
});
