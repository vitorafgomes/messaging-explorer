import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { EntitySelectionService } from './entity-selection.service';
import { ConnectionService } from './connection.service';
import { QueueService } from './queue.service';
import { TopicService } from './topic.service';
import { ConnectionStatus, TreeNode } from '../models';
import { QueueInfo } from '../models/queue.model';

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
});
