import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { finalize } from 'rxjs';
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
    CommonModule,
    MatSnackBarModule,
    MatDialogModule
  ],
  template: `
    <div class="topics-container">
      <div class="header d-flex justify-content-between align-items-center mb-4">
        <h2 class="mb-0">Topics</h2>
        <button class="btn btn-primary" (click)="loadTopics()" [disabled]="!isConnected">
          <i class="fa-solid fa-arrows-rotate me-2"></i>
          Refresh
        </button>
      </div>

      @if (!isConnected) {
        <div class="card text-center py-5">
          <div class="card-body">
            <i class="fa fa-exclamation-triangle fa-4x text-warning mb-3"></i>
            <p class="mb-0">Please connect to a Service Bus namespace first</p>
          </div>
        </div>
      } @else if (loading()) {
        <div class="text-center py-5">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
        </div>
      } @else if (topics().length === 0) {
        <div class="card text-center py-5">
          <div class="card-body">
            <i class="fa fa-inbox fa-4x text-secondary mb-3"></i>
            <p class="mb-0">No topics found</p>
          </div>
        </div>
      } @else {
        <div class="topics-list">
          @for (topic of topics(); track topic.name) {
            <div class="card topic-card mb-3">
              <div class="card-header cursor-pointer user-select-none" (click)="toggleTopic(topic)">
                <div class="d-flex align-items-center justify-content-between">
                  <div class="d-flex align-items-center">
                    <i class="fa fa-comments text-primary fa-lg me-3"></i>
                    <div>
                      <h5 class="mb-0 d-flex align-items-center">
                        <i class="fa me-2" [class.fa-chevron-down]="topic.expanded" [class.fa-chevron-right]="!topic.expanded"></i>
                        {{ topic.name }}
                      </h5>
                      <small class="text-muted">{{ topic.subscriptionCount }} subscription(s) | {{ formatSize(topic.sizeInBytes) }}</small>
                    </div>
                  </div>
                  <button class="btn btn-sm btn-outline-primary" (click)="sendMessage(topic); $event.stopPropagation()">
                    <i class="fa fa-paper-plane me-1"></i>
                    Send Message
                  </button>
                </div>
              </div>

              @if (topic.expanded) {
                <div class="card-body">
                  <h6 class="text-muted mb-3">Subscriptions</h6>
                  @if (topic.subscriptions && topic.subscriptions.length > 0) {
                    @for (sub of topic.subscriptions; track sub.name) {
                      <div class="card subscription-card mb-2">
                        <div class="card-body">
                          <div class="d-flex align-items-center justify-content-between">
                            <div class="d-flex align-items-center">
                              <i class="fa-solid fa-bell text-success fa-lg me-3"></i>
                              <div>
                                <h6 class="mb-0">{{ sub.name }}</h6>
                                <small class="text-muted">
                                  Active: <span class="clickable-stat badge bg-primary" (click)="viewSubscriptionMessages(topic, sub, 0); $event.stopPropagation()">{{ sub.activeMessageCount }}</span>
                                  Dead Letter: <span class="clickable-stat badge" [class.bg-danger]="sub.deadLetterMessageCount > 0" [class.bg-secondary]="sub.deadLetterMessageCount === 0" (click)="viewSubscriptionMessages(topic, sub, 1); $event.stopPropagation()">{{ sub.deadLetterMessageCount }}</span>
                                </small>
                              </div>
                            </div>
                            <div class="btn-group">
                              <button class="btn btn-sm btn-outline-primary" (click)="viewSubscriptionMessages(topic, sub)" title="View Messages">
                                <i class="fa fa-eye"></i>
                              </button>
                              <button class="btn btn-sm btn-outline-secondary" (click)="purgeSubscriptionMessages(topic, sub)" [disabled]="sub.activeMessageCount === 0" title="Purge Messages">
                                <i class="fa fa-trash"></i>
                              </button>
                              <button class="btn btn-sm btn-outline-danger" (click)="purgeSubscriptionDeadLetter(topic, sub)" [disabled]="sub.deadLetterMessageCount === 0" title="Purge Dead Letter">
                                <i class="fa fa-times-circle"></i>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    }
                  } @else {
                    <p class="text-muted text-center fst-italic py-3">No subscriptions</p>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .topics-container {
      max-width: 1200px;
      margin: 0 auto;
      height: 100%;
      display: flex;
      flex-direction: column;
      padding: 12px;
    }

    .topics-list {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .cursor-pointer {
      cursor: pointer;
    }

    .user-select-none {
      user-select: none;
    }

    .topic-card {
      border-left: 4px solid var(--bs-primary);
    }

    .subscription-card {
      border-left: 3px solid var(--bs-success);
    }

    .card-header:hover {
      background-color: rgba(0, 0, 0, 0.02);
    }

    .clickable-stat {
      cursor: pointer;
      transition: opacity 0.2s ease;

      &:hover {
        opacity: 0.8;
      }
    }
  `]
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
    this.loading.set(true);
    this.topicService.getTopics().pipe(
      finalize(() => {
        this.loading.set(false);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (topics) => {
        this.topics.set(topics);
        // Load subscriptions for each topic
        topics.forEach(topic => this.loadSubscriptions(topic));
      },
      error: () => {
        this.snackBar.open('Failed to load topics', 'Close', { duration: 3000 });
      }
    });
  }

  toggleTopic(topic: TopicInfo) {
    topic.expanded = !topic.expanded;
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

        if (subscriptions.length > 0) {
          this.logger.log(`[TopicsComponent] Subscription names: ${subscriptions.map(s => s.name).join(', ')}`);
        }
      },
      error: (err) => {
        this.logger.log(`[TopicsComponent] Failed to load subscriptions for topic ${topic.name}:`, err);
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
