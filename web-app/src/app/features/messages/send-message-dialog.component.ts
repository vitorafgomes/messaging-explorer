import { Component, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QueueService, TopicService, MessageTemplateService } from '../../core/services';
import { ProviderService } from '../../core/services/provider.service';
import { SendMessageRequest, MessageTemplate } from '../../core/models';
import { messageCallFailure } from './message-call-failure';

export interface SendMessageDialogData {
  entityType: 'queue' | 'topic';
  entityName: string;
  topicName?: string;
  mode?: 'send' | 'resubmit';
  prefill?: {
    body: string;
    contentType?: string;
    messageId?: string;
    correlationId?: string;
    sessionId?: string;
    subject?: string;
    to?: string;
    replyTo?: string;
    applicationProperties?: Record<string, any>;
  };
}

@Component({
  selector: 'app-send-message-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule
  ],
  template: `
    <h2 mat-dialog-title class="title">
      <mat-icon [fontIcon]="isResubmitMode ? 'edit' : 'send'" aria-hidden="true"></mat-icon>
      <span>{{ dialogTitle }}</span>
    </h2>

    <mat-dialog-content class="content">
      @if (isResubmitMode) {
        <p class="note" role="note">
          <mat-icon fontIcon="info" aria-hidden="true"></mat-icon>
          <span>This sends a new message to {{ data.entityName }} with the fields below. The original is not removed: it stays in the dead-letter queue until it is deleted.</span>
        </p>
      }

      @if (templates().length > 0) {
        <div class="template-picker">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
            <mat-label>Load Template</mat-label>
            <select matNativeControl [(ngModel)]="selectedTemplateId" (ngModelChange)="onTemplateSelected($event)">
              <option value="">-- Select a template --</option>
              @for (tpl of templates(); track tpl.id) {
                <option [value]="tpl.id">{{ tpl.name }}</option>
              }
            </select>
          </mat-form-field>
          @if (selectedTemplateId) {
            <button mat-icon-button type="button" class="danger" (click)="deleteSelectedTemplate()" aria-label="Delete template" matTooltip="Delete template">
              <mat-icon fontIcon="delete" aria-hidden="true"></mat-icon>
            </button>
          }
        </div>
      }

      <nav class="sections" aria-label="Message sections">
        <button mat-button type="button" class="section-tab" [class.current]="activeTab === 0" [attr.aria-current]="activeTab === 0 ? 'true' : null" (click)="activeTab = 0">Message Body</button>
        <button mat-button type="button" class="section-tab" [class.current]="activeTab === 1" [attr.aria-current]="activeTab === 1 ? 'true' : null" (click)="activeTab = 1">Properties</button>
        <button mat-button type="button" class="section-tab" [class.current]="activeTab === 2" [attr.aria-current]="activeTab === 2 ? 'true' : null" (click)="activeTab = 2">Custom Properties</button>
      </nav>

      @if (activeTab === 0) {
        <div class="section">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="content-type">
            <mat-label>Content Type</mat-label>
            <select matNativeControl [(ngModel)]="message.contentType">
              <option value="application/json">application/json</option>
              <option value="text/plain">text/plain</option>
              <option value="application/xml">application/xml</option>
            </select>
          </mat-form-field>

          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Message Body</mat-label>
            <textarea matInput class="mono" [(ngModel)]="message.body" rows="12" spellcheck="false"
              placeholder='{"key": "value"}'></textarea>
          </mat-form-field>

          <div>
            <button mat-stroked-button type="button" (click)="formatJson()" [disabled]="!message.body">
              <mat-icon fontIcon="data_object" aria-hidden="true"></mat-icon>
              Format JSON
            </button>
          </div>
        </div>
      }

      @if (activeTab === 1) {
        <div class="section">
          <div class="fields">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Message ID</mat-label>
              <input matInput [(ngModel)]="message.messageId" placeholder="Auto-generated if empty">
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Correlation ID</mat-label>
              <input matInput [(ngModel)]="message.correlationId">
            </mat-form-field>
            @if (capabilities()?.supportsSessions !== false) {
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>Session ID</mat-label>
                <input matInput id="send-session-id" [(ngModel)]="message.sessionId">
              </mat-form-field>
            }
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Partition Key</mat-label>
              <input matInput [(ngModel)]="message.partitionKey">
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Subject / Label</mat-label>
              <input matInput [(ngModel)]="message.subject">
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>To</mat-label>
              <input matInput [(ngModel)]="message.to">
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Reply To</mat-label>
              <input matInput [(ngModel)]="message.replyTo">
            </mat-form-field>
          </div>

          <h3 class="group-title">
            <mat-icon fontIcon="schedule" aria-hidden="true"></mat-icon>Delivery Options
          </h3>

          <div class="fields">
            @if (capabilities()?.supportsScheduledMessages !== false) {
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>Scheduled Delivery</mat-label>
                <input matInput id="send-scheduled-delivery" type="datetime-local"
                  data-testid="scheduled-enqueue-time"
                  [(ngModel)]="scheduledEnqueueTimeLocal"
                  [min]="minDateTimeLocal">
              </mat-form-field>
            }
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Time to Live</mat-label>
              <input matInput type="text"
                data-testid="time-to-live"
                [(ngModel)]="message.timeToLive"
                placeholder="HH:mm:ss">
            </mat-form-field>
          </div>
        </div>
      }

      @if (activeTab === 2) {
        <div class="section">
          <p class="hint">Add custom application properties to the message</p>

          @for (prop of customProperties; track $index) {
            <div class="property-row">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
                <mat-label>Key</mat-label>
                <input matInput class="mono" [(ngModel)]="prop.key" placeholder="Key">
              </mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
                <mat-label>Value</mat-label>
                <input matInput class="mono" [(ngModel)]="prop.value" placeholder="Value">
              </mat-form-field>
              <button mat-icon-button type="button" (click)="removeProperty($index)" [attr.aria-label]="'Remove property ' + ($index + 1)" matTooltip="Remove property">
                <mat-icon fontIcon="close" aria-hidden="true"></mat-icon>
              </button>
            </div>
          }

          <div>
            <button mat-stroked-button type="button" (click)="addProperty()">
              <mat-icon fontIcon="add" aria-hidden="true"></mat-icon>
              Add Property
            </button>
          </div>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions class="actions">
      <button mat-stroked-button type="button" (click)="saveAsTemplate()" [disabled]="!message.body">
        <mat-icon fontIcon="bookmark" aria-hidden="true"></mat-icon>
        Save as Template
      </button>
      <span class="spacer"></span>
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" class="send-button" (click)="send()" [disabled]="sending() || !message.body">
        @if (sending()) {
          <mat-progress-spinner mode="indeterminate" diameter="18" aria-hidden="true"></mat-progress-spinner>
        } @else {
          <mat-icon fontIcon="send" aria-hidden="true"></mat-icon>
        }
        {{ isResubmitMode ? 'Resubmit' : (isScheduled ? 'Schedule' : 'Send') }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .title { display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; }
    .title mat-icon { flex: none; color: var(--mat-sys-primary); }
    .content { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    p { margin: 0; }
    .note { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; border-radius: 8px; background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .note mat-icon { flex: none; }
    .template-picker { display: flex; align-items: center; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .grow { flex: 1; min-width: 0; }
    .danger { color: var(--mat-sys-error); }
    .sections { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .section-tab {
      --mat-button-text-container-shape: 0;
      --mat-button-text-container-height: 44px;
      --mat-button-text-label-text-color: var(--mat-sys-on-surface-variant);
      margin-bottom: -1px;
      border-bottom: 3px solid transparent;
    }
    .section-tab.current { --mat-button-text-label-text-color: var(--mat-sys-primary); border-bottom-color: var(--mat-sys-primary); }
    .section { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .content-type { max-width: 280px; }
    .mono { font-family: ui-monospace, monospace; }
    .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    .group-title { display: flex; align-items: center; gap: 8px; margin: 4px 0 0; font: var(--mat-sys-title-small); color: var(--mat-sys-on-surface-variant); }
    .hint { font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); }
    .property-row { display: flex; align-items: center; gap: 8px; }
    .actions { gap: 8px; flex-wrap: wrap; }
    .spacer { flex: 1; }
  `]
})
export class SendMessageDialogComponent {
  data = inject<SendMessageDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<SendMessageDialogComponent>);
  private queueService = inject(QueueService);
  private topicService = inject(TopicService);
  private snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private templateService = inject(MessageTemplateService);
  protected readonly capabilities = inject(ProviderService).capabilities;

  message: SendMessageRequest = {
    body: '',
    contentType: 'application/json'
  };

  customProperties: { key: string; value: string }[] = [];
  activeTab = 0;
  sending = signal(false);
  templates = signal<MessageTemplate[]>([]);
  selectedTemplateId = '';

  scheduledEnqueueTimeLocal = '';
  minDateTimeLocal = this.toDateTimeLocal(new Date());

  isResubmitMode = false;
  dialogTitle = '';

  get isScheduled(): boolean {
    return this.scheduledEnqueueTimeLocal !== '';
  }

  constructor() {
    this.isResubmitMode = this.data.mode === 'resubmit';

    if (this.isResubmitMode) {
      this.dialogTitle = `Edit & Resubmit to ${this.data.entityType === 'queue' ? 'Queue' : 'Topic'}: ${this.data.entityName}`;
    } else {
      this.dialogTitle = `Send Message to ${this.data.entityType === 'queue' ? 'Queue' : 'Topic'}: ${this.data.entityName}`;
    }

    if (this.isResubmitMode && this.data.prefill) {
      const prefill = this.data.prefill;
      this.message.body = prefill.body ?? '';
      this.message.contentType = prefill.contentType ?? 'application/json';
      this.message.messageId = prefill.messageId;
      this.message.correlationId = prefill.correlationId;
      this.message.sessionId = prefill.sessionId;
      this.message.subject = prefill.subject;
      this.message.to = prefill.to;
      this.message.replyTo = prefill.replyTo;

      if (prefill.applicationProperties) {
        for (const [key, value] of Object.entries(prefill.applicationProperties)) {
          this.customProperties.push({ key, value: String(value) });
        }
      }
    }

    this.refreshTemplates();
  }

  onTemplateSelected(templateId: string) {
    if (!templateId) {
      return;
    }
    const template = this.templates().find((t) => t.id === templateId);
    if (!template) {
      return;
    }
    this.message.body = template.body;
    this.message.contentType = template.contentType;
    this.message.subject = template.subject;
    this.message.to = template.to;
    this.message.replyTo = template.replyTo;
    this.customProperties = [];
    if (template.applicationProperties) {
      for (const [key, value] of Object.entries(template.applicationProperties)) {
        this.customProperties.push({ key, value: String(value) });
      }
    }
  }

  saveAsTemplate() {
    const name = prompt('Enter a name for this template:');
    if (!name || !name.trim()) {
      return;
    }
    const applicationProperties: Record<string, any> = {};
    for (const prop of this.customProperties) {
      if (prop.key) {
        applicationProperties[prop.key] = prop.value;
      }
    }
    this.templateService.saveTemplate({
      name: name.trim(),
      body: this.message.body,
      contentType: this.message.contentType || 'application/json',
      applicationProperties: Object.keys(applicationProperties).length > 0 ? applicationProperties : undefined,
      subject: this.message.subject,
      to: this.message.to,
      replyTo: this.message.replyTo,
    });
    this.refreshTemplates();
    this.snackBar.open(`Template "${name.trim()}" saved`, 'Close', { duration: 3000 });
  }

  deleteSelectedTemplate() {
    if (!this.selectedTemplateId) {
      return;
    }
    const template = this.templates().find((t) => t.id === this.selectedTemplateId);
    const confirmed = confirm(`Delete template "${template?.name}"?`);
    if (!confirmed) {
      return;
    }
    this.templateService.deleteTemplate(this.selectedTemplateId);
    this.selectedTemplateId = '';
    this.refreshTemplates();
    this.snackBar.open('Template deleted', 'Close', { duration: 2000 });
  }

  private refreshTemplates() {
    this.templates.set(this.templateService.getTemplates());
  }

  formatJson() {
    try {
      const parsed = JSON.parse(this.message.body);
      this.message.body = JSON.stringify(parsed, null, 2);
    } catch {
      this.snackBar.open('Invalid JSON', 'Close', { duration: 2000 });
    }
  }

  addProperty() {
    this.customProperties.push({ key: '', value: '' });
  }

  removeProperty(index: number) {
    this.customProperties.splice(index, 1);
  }

  /** Formats a Date as a yyyy-MM-ddTHH:mm string for datetime-local inputs */
  toDateTimeLocal(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  send() {
    const applicationProperties: Record<string, any> = {};
    for (const prop of this.customProperties) {
      if (prop.key) {
        applicationProperties[prop.key] = prop.value;
      }
    }
    this.message.applicationProperties = Object.keys(applicationProperties).length > 0 ? applicationProperties : undefined;
    this.message.scheduledEnqueueTime = this.scheduledEnqueueTimeLocal ? new Date(this.scheduledEnqueueTimeLocal) : undefined;

    this.sending.set(true);

    const sendObservable = this.data.entityType === 'queue'
      ? this.queueService.sendMessage(this.data.entityName, this.message)
      : this.topicService.sendMessage(this.data.entityName, this.message);

    sendObservable.pipe(
      finalize(() => this.sending.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.snackBar.open('Message sent successfully!', 'Close', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.snackBar.open(messageCallFailure(err, 'Failed to send message'), 'Close', { duration: 3000 });
      }
    });
  }
}
