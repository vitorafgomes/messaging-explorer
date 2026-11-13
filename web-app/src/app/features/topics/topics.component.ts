import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Subscription, finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TopicService, ConnectionService, LoggerService } from '../../core/services';
import { TopicInfo, SubscriptionInfo } from '../../core/models';
import { SendMessageDialogComponent } from '../messages/send-message-dialog.component';
import { ViewMessagesDialogComponent } from '../messages/view-messages-dialog.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';

@Component({
  selector: 'app-topics',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDialogModule
  ],
  template: `
    <div class="topics-container">
      <div class="header">
        <h2>Topics</h2>
        <button matButton="outlined" type="button" (click)="loadTopics()" [disabled]="!isConnected || loading()">
          <mat-icon fontIcon="refresh" aria-hidden="true"></mat-icon>
          Refresh
        </button>
      </div>

      @if (!isConnected) {
        <div class="state">
          <mat-icon class="state-icon" fontIcon="cloud_off" aria-hidden="true"></mat-icon>
          <h3>Not connected</h3>
          <p>Please connect to a Service Bus namespace first</p>
        </div>
      } @else if (loading()) {
        <div class="state" role="status">
          <mat-progress-spinner mode="indeterminate" diameter="32" aria-label="Loading"></mat-progress-spinner>
          <span>Loading the topics</span>
        </div>
      } @else if (loadError()) {
        <section class="load-error" role="alert" aria-label="Error">
          <mat-icon fontIcon="error" aria-hidden="true"></mat-icon>
          <div class="load-error-body">
            <h3>Could not load the topics</h3>
            <p>The API did not return the topic list. Nothing is shown because nothing was read, and nothing on the broker was changed.</p>
            <button matButton="outlined" type="button" (click)="loadTopics()">
              <mat-icon fontIcon="refresh" aria-hidden="true"></mat-icon>
              Retry
            </button>
          </div>
        </section>
      } @else if (topics().length === 0) {
        <div class="state">
          <mat-icon class="state-icon" fontIcon="inbox" aria-hidden="true"></mat-icon>
          <h3>No topics found</h3>
          <p>The broker answered and holds no topic.</p>
        </div>
      } @else {
        <div class="topics-list">
          @for (topic of topics(); track topic.name) {
            <section class="topic-card" [attr.aria-label]="'Topic ' + topic.name">
              <div class="topic-header">
                <button matButton type="button" class="topic-toggle" [attr.aria-expanded]="!!topic.expanded" (click)="toggleTopic(topic)">
                  <mat-icon [fontIcon]="topic.expanded ? 'expand_more' : 'chevron_right'" aria-hidden="true"></mat-icon>
                  <span class="topic-name">{{ topic.name }}</span>
                  <span class="topic-meta">{{ topic.subscriptionCount }} subscription(s) | {{ formatSize(topic.sizeInBytes) }}</span>
                </button>
                <button matButton="outlined" type="button" (click)="sendMessage(topic)">
                  <mat-icon fontIcon="send" aria-hidden="true"></mat-icon>
                  Send Message
                </button>
              </div>

              @if (topic.expanded) {
                <div class="topic-body">
                  <h3 class="subscriptions-title">Subscriptions</h3>
                  @if (!subscriptionsLoaded.has(topic)) {
                    <p class="note" role="status">Loading subscriptions...</p>
                  } @else if (topic.subscriptions && topic.subscriptions.length > 0) {
                    @for (sub of topic.subscriptions; track sub.name) {
                      <div class="subscription-card">
                        <div class="subscription-info">
                          <span class="subscription-name">{{ sub.name }}</span>
                          <span class="counts">
                            Active:
                            <button matButton type="button" class="count" (click)="viewSubscriptionMessages(topic, sub, 0)"
                                    [attr.aria-label]="'View the ' + sub.activeMessageCount + ' active messages of ' + sub.name">{{ sub.activeMessageCount }}</button>
                            Dead Letter:
                            <button matButton type="button" class="count" [class.dead-letter]="sub.deadLetterMessageCount > 0" (click)="viewSubscriptionMessages(topic, sub, 1)"
                                    [attr.aria-label]="'View the ' + sub.deadLetterMessageCount + ' dead-letter messages of ' + sub.name">{{ sub.deadLetterMessageCount }}</button>
                          </span>
                        </div>
                        <div class="actions">
                          <button matIconButton type="button" (click)="viewSubscriptionMessages(topic, sub)" title="View Messages" [attr.aria-label]="'View the messages of ' + sub.name">
                            <mat-icon fontIcon="visibility" aria-hidden="true"></mat-icon>
                          </button>
                          <button matIconButton type="button" [matMenuTriggerFor]="purgeMenu" title="More actions" [attr.aria-label]="'More actions for ' + sub.name">
                            <mat-icon fontIcon="more_vert" aria-hidden="true"></mat-icon>
                          </button>
                          <mat-menu #purgeMenu="matMenu">
                            <button mat-menu-item class="danger" (click)="purgeSubscriptionMessages(topic, sub)" [disabled]="sub.activeMessageCount === 0">
                              <mat-icon fontIcon="delete_sweep" aria-hidden="true"></mat-icon>
                              Purge Messages
                            </button>
                            <button mat-menu-item class="danger" (click)="purgeSubscriptionDeadLetter(topic, sub)" [disabled]="sub.deadLetterMessageCount === 0">
                              <mat-icon fontIcon="delete_forever" aria-hidden="true"></mat-icon>
                              Purge Dead Letter
                            </button>
                          </mat-menu>
                        </div>
                      </div>
                    }
                  } @else {
                    <p class="note">No subscriptions</p>
                  }
                </div>
              }
            </section>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './topics.component.scss'
})
export class TopicsComponent implements OnInit {
  private topicService = inject(TopicService);
  private connectionService = inject(ConnectionService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private logger = inject(LoggerService);

  topics = signal<TopicInfo[]>([]);
  loading = signal(false);
  loadError = signal(false);
  protected readonly subscriptionsLoaded = new WeakSet<TopicInfo>();
  private topicsLoad?: Subscription;

  get isConnected(): boolean {
    return this.connectionService.isConnected;
  }

  ngOnInit() {
    if (this.isConnected) {
      this.loadTopics();
    }

    this.connectionService.connectionStatus$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(status => {
      if (status.connected) {
        this.loadTopics();
      } else {
        this.topics.set([]);
      }
    });
  }

  loadTopics() {
    this.topicsLoad?.unsubscribe();
    this.loading.set(true);
    this.loadError.set(false);
    this.topicsLoad = this.topicService.getTopics().pipe(
      finalize(() => {
        this.loading.set(false);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (topics) => {
        this.topics.set(topics);
      },
      error: () => {
        this.topics.set([]);
        this.loadError.set(true);
      }
    });
  }

  toggleTopic(topic: TopicInfo) {
    topic.expanded = !topic.expanded;
    if (topic.expanded && !this.subscriptionsLoaded.has(topic)) {
      this.loadSubscriptions(topic);
    }
    this.topics.set([...this.topics()]);
  }

  loadSubscriptions(topic: TopicInfo) {
    this.logger.log(`[TopicsComponent] Loading subscriptions for topic: ${topic.name}`);
    this.topicService.getSubscriptions(topic.name).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (subscriptions) => {
        this.logger.log(`[TopicsComponent] Loaded ${subscriptions.length} subscriptions for topic ${topic.name}`);
        topic.subscriptions = subscriptions;
        this.subscriptionsLoaded.add(topic);
        this.topics.set([...this.topics()]);

        if (subscriptions.length > 0) {
          this.logger.log(`[TopicsComponent] Subscription names: ${subscriptions.map(s => s.name).join(', ')}`);
        }
      },
      error: (err) => {
        this.logger.log(`[TopicsComponent] Failed to load subscriptions for topic ${topic.name}:`, err);
        this.snackBar.open(`Failed to load the subscriptions of ${topic.name}`, 'Close', { duration: 3000 });
        if (!this.subscriptionsLoaded.has(topic)) {
          topic.expanded = false;
          this.topics.set([...this.topics()]);
        }
      }
    });
  }

  formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  sendMessage(topic: TopicInfo) {
    const dialogRef = this.dialog.open(SendMessageDialogComponent, {
      width: '700px',
      data: {
        entityType: 'topic',
        entityName: topic.name
      }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.loadTopics();
      }
    });
  }

  viewSubscriptionMessages(topic: TopicInfo, subscription: SubscriptionInfo, initialTab?: number) {
    this.dialog.open(ViewMessagesDialogComponent, {
      width: '95vw',
      maxWidth: '1400px',
      height: '90vh',
      data: {
        entityType: 'subscription',
        entityName: subscription.name,
        topicName: topic.name,
        activeMessageCount: subscription.activeMessageCount,
        deadLetterMessageCount: subscription.deadLetterMessageCount,
        initialTab
      }
    });
  }

  purgeSubscriptionMessages(topic: TopicInfo, subscription: SubscriptionInfo) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Purge Messages',
        message: `Are you sure you want to delete all ${subscription.activeMessageCount} active messages from subscription "${subscription.name}"? This action cannot be undone.`,
        confirmText: 'Purge',
        confirmColor: 'warn',
        icon: 'delete_sweep'
      }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.topicService.purgeMessages(topic.name, subscription.name).pipe(
          takeUntilDestroyed(this.destroyRef)
        ).subscribe({
          next: () => {
            this.snackBar.open(`Purged all messages from ${subscription.name}`, 'Close', { duration: 3000 });
            this.loadSubscriptions(topic);
          },
          error: () => {
            this.snackBar.open('Failed to purge messages', 'Close', { duration: 3000 });
          }
        });
      }
    });
  }

  purgeSubscriptionDeadLetter(topic: TopicInfo, subscription: SubscriptionInfo) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Purge Dead Letter Queue',
        message: `Are you sure you want to delete all ${subscription.deadLetterMessageCount} dead letter messages from subscription "${subscription.name}"? This action cannot be undone.`,
        confirmText: 'Purge',
        confirmColor: 'warn',
        icon: 'delete_forever'
      }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.topicService.purgeDeadLetterMessages(topic.name, subscription.name).pipe(
          takeUntilDestroyed(this.destroyRef)
        ).subscribe({
          next: () => {
            this.snackBar.open(`Purged all dead letter messages from ${subscription.name}`, 'Close', { duration: 3000 });
            this.loadSubscriptions(topic);
          },
          error: () => {
            this.snackBar.open('Failed to purge dead letter messages', 'Close', { duration: 3000 });
          }
        });
      }
    });
  }
}
