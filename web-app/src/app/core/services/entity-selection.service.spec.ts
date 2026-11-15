import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { EntitySelectionService } from './entity-selection.service';
import { ConnectionService } from './connection.service';
import { QueueService } from './queue.service';
import { TopicService } from './topic.service';
import { ConnectionStatus, TreeNode } from '../models';
import { QueueInfo } from '../models/queue.model';
import { SubscriptionInfo } from '../models/topic.model';

describe('EntitySelectionService', () => {
  let status$: BehaviorSubject<ConnectionStatus>;
  let pending: Map<string, Subject<QueueInfo>>;
  let service: EntitySelectionService;

  const queueNode = (name: string): TreeNode => ({
    id: `queue/${name}`, name, type: 'queue', icon: 'inbox', expandable: false, level: 1
  });

  beforeEach(() => {
    status$ = new BehaviorSubject<ConnectionStatus>({ connected: true, namespace: 'prod.example.net' });
    pending = new Map();
    TestBed.configureTestingModule({
      providers: [
        { provide: ConnectionService, useValue: { connectionStatus$: status$.asObservable() } },
        {
          provide: QueueService,
          useValue: {
            getQueue: (name: string) => {
              const response = new Subject<QueueInfo>();
              pending.set(name, response);
              return response.asObservable();
            }
          }
        },
        { provide: TopicService, useValue: {} }
      ]
    });
    service = TestBed.inject(EntitySelectionService);
  });

  const respond = (name: string) => {
    pending.get(name)!.next({ name } as QueueInfo);
    pending.get(name)!.complete();
  };

  it('after switching connection the previous connection\'s entity is no longer selected', () => {
    service.select(queueNode('orders'));
    respond('orders');
    expect(service.currentSelection?.node.name).toBe('orders');

    status$.next({ connected: true, namespace: 'staging.example.net' });

    expect(service.currentSelection).toBeNull();
  });

  it('a successful connect to the same target also clears the selection', () => {
    service.select(queueNode('orders'));
    respond('orders');

    status$.next({ connected: true, namespace: 'prod.example.net' });

    expect(service.currentSelection).toBeNull();
  });

  it('a response for an entity of the previous connection arriving after the switch is not selected', () => {
    service.select(queueNode('orders'));

    status$.next({ connected: true, namespace: 'staging.example.net' });
    respond('orders');

    expect(service.currentSelection).toBeNull();
    expect(service.isLoading).toBe(false);
  });

  it('a late response for a previous selection does not overwrite a newer one', () => {
    service.select(queueNode('a'));
    service.select(queueNode('b'));
    respond('b');
    respond('a');

    expect(service.currentSelection?.node.name).toBe('b');
  });

  it('showEntity puts the entity the API returned after a change into the panel, and a late read does not overwrite it', () => {
    service.select(queueNode('orders'));
    respond('orders');
    service.refreshCurrentSelection();

    service.showEntity({ name: 'orders', lockDuration: '00:05:00' } as QueueInfo);
    pending.get('orders')!.next({ name: 'orders', lockDuration: '00:01:00' } as QueueInfo);

    expect(service.currentSelection?.node.name).toBe('orders');
    expect((service.currentSelection?.entity as QueueInfo).lockDuration).toBe('00:05:00');
    expect(service.isLoading).toBe(false);
  });

  it('while an entity loads, the state names the node being read', () => {
    service.select(queueNode('orders'));

    expect(service['stateSubject'].value.loadingNode?.name, 'the panel can say which entity it is reading').toBe('orders');
  });

  it('showEntity leaves the panel alone when the change is for another entity, as from the Queues screen while the tree shows another', () => {
    service.select(queueNode('orders'));
    respond('orders');

    service.showEntity({ name: 'invoices', lockDuration: '00:05:00' } as QueueInfo);

    expect(service.currentSelection?.node.name).toBe('orders');
    expect((service.currentSelection?.entity as QueueInfo).name, 'the panel of orders never shows invoices').toBe('orders');
  });

  it('showEntity leaves the panel alone for a subscription of the same name under another topic', () => {
    service.select(queueNode('audit'));
    pending.get('audit')!.next({ name: 'audit', topicName: 'orders' } as unknown as QueueInfo);
    pending.get('audit')!.complete();

    service.showEntity({ name: 'audit', topicName: 'invoices' } as SubscriptionInfo);

    expect((service.currentSelection?.entity as SubscriptionInfo).topicName, 'audit of orders never shows audit of invoices').toBe('orders');
  });
});
