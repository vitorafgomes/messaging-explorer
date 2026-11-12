import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EntityDetailsComponent } from './entity-details.component';
import { ConnectionService, EntitySelectionService, QueueService, SessionService, TopicService } from '../../core/services';
import { EntitySelection } from '../../core/models';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';

describe('EntityDetailsComponent purge confirmation', () => {
  let dialog: { open: ReturnType<typeof vi.fn> };

  function create(selection: EntitySelection) {
    dialog = { open: vi.fn().mockReturnValue({ afterClosed: () => of(false) }) };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: EntitySelectionService,
          useValue: { state$: of({ selection, loading: false, error: null }), currentSelection: selection, isLoading: false }
        },
        { provide: ConnectionService, useValue: { currentTarget: 'prod.example.net' } },
        { provide: QueueService, useValue: {} },
        { provide: TopicService, useValue: {} },
        { provide: SessionService, useValue: {} },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: MatDialog, useValue: dialog }
      ]
    });
    return TestBed.runInInjectionContext(() => new EntityDetailsComponent());
  }

  const confirmation = () => {
    expect(dialog.open).toHaveBeenCalledTimes(1);
    const [component, config] = dialog.open.mock.calls[0];
    expect(component).toBe(ConfirmDialogComponent);
    return config.data;
  };

  describe('the purge confirmation names the entity, its parent, the connection and the live count', () => {
    it('for a queue: the queue, the connection target and the count, with an acknowledgement naming the queue', () => {
      const component = create({
        type: 'queue',
        node: { id: 'orders', name: 'orders', type: 'queue', icon: 'inbox', expandable: false, level: 1 },
        entity: { name: 'orders', activeMessageCount: 120, deadLetterMessageCount: 7 } as never
      });

      component.purgeMessages('active');

      const data = confirmation();
      expect(data.title).toBe('Purge active messages?');
      expect(data.message).toBe('This deletes every active message in queue "orders" on prod.example.net: 120 when the queue was loaded. It cannot be undone.');
      expect(data.confirmText).toBe('Purge 120 messages');
      expect(data.requireAcknowledgement).toBe(true);
      expect(data.acknowledgementText).toBe('I understand this deletes every active message in orders');
    });

    it('for a subscription: the subscription, its topic, the connection target and the live count instead of the snapshot', () => {
      const component = create({
        type: 'subscription',
        node: { id: 'events/billing', name: 'billing', type: 'subscription', icon: 'mail', expandable: false, level: 2, data: { topicName: 'events' } as never },
        entity: { topicName: 'events', name: 'billing', activeMessageCount: 5, deadLetterMessageCount: 2 } as never
      });
      component.liveActiveCount.set(42);
      component.liveDeadLetterCount.set(9);

      component.purgeMessages('deadletter');

      const data = confirmation();
      expect(data.title).toBe('Purge dead-letter messages?');
      expect(data.message).toBe('This deletes every dead-letter message in subscription "billing" of topic "events" on prod.example.net: 9 now. It cannot be undone.');
      expect(data.confirmText).toBe('Purge 9 messages');
      expect(data.requireAcknowledgement).toBe(true);
      expect(data.acknowledgementText).toBe('I understand this deletes every dead-letter message in billing');
    });
  });
});
