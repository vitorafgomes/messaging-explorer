import { Component, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QueueService, TopicService, ThemeService, MessageTemplateService } from '../../core/services';
import { SendMessageRequest, MessageTemplate } from '../../core/models';

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
    MatDialogModule,
    MatSnackBarModule
  ],
  host: {
    '[class.dark-mode-dialog]': 'themeService.isDark()'
  },
  template: `
    <div class="modal-header" [class.bg-dark]="themeService.isDark()" [class.text-light]="themeService.isDark()">
      <h5 class="modal-title d-flex align-items-center gap-2" [class.text-light]="themeService.isDark()">
        <i class="fa" [class.fa-paper-plane]="!isResubmitMode" [class.fa-pencil]="isResubmitMode" [class.text-primary]="!isResubmitMode" [class.text-warning]="isResubmitMode"></i>
        {{ dialogTitle }}
      </h5>
    </div>

    <div class="modal-body" [class.bg-dark]="themeService.isDark()" [class.text-light]="themeService.isDark()">
      @if (templates().length > 0) {
        <div class="template-picker mb-3">
          <label class="form-label d-flex align-items-center gap-2">
            <i class="fa fa-bookmark text-muted"></i>
            Load Template
          </label>
          <div class="d-flex gap-2">
            <select class="form-select" [(ngModel)]="selectedTemplateId" (ngModelChange)="onTemplateSelected($event)">
              <option value="">-- Select a template --</option>
              @for (tpl of templates(); track tpl.id) {
                <option [value]="tpl.id">{{ tpl.name }}</option>
              }
            </select>
            @if (selectedTemplateId) {
              <button class="btn btn-outline-danger btn-sm" (click)="deleteSelectedTemplate()" title="Delete template">
                <i class="fa fa-trash"></i>
              </button>
            }
          </div>
        </div>
      }

      <ul class="nav nav-tabs mb-3" role="tablist">
        <li class="nav-item" role="presentation">
          <button class="nav-link" [class.active]="activeTab === 0" (click)="activeTab = 0" type="button">
            Message Body
          </button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link" [class.active]="activeTab === 1" (click)="activeTab = 1" type="button">
            Properties
          </button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link" [class.active]="activeTab === 2" (click)="activeTab = 2" type="button">
            Custom Properties
          </button>
        </li>
      </ul>

      <div class="tab-content">
        @if (activeTab === 0) {
          <div class="tab-pane-content">
            <div class="mb-3">
              <label class="form-label">Content Type</label>
              <select class="form-select" [(ngModel)]="message.contentType">
                <option value="application/json">application/json</option>
                <option value="text/plain">text/plain</option>
                <option value="application/xml">application/xml</option>
              </select>
            </div>

            <div class="mb-3">
              <label class="form-label">Message Body</label>
              <textarea class="form-control font-monospace" [(ngModel)]="message.body" rows="12"
                placeholder='{"key": "value"}'></textarea>
            </div>

            <button class="btn btn-outline-secondary" type="button" (click)="formatJson()" [disabled]="!message.body">
              <i class="fa fa-code me-2"></i>
              Format JSON
            </button>
          </div>
        }

        @if (activeTab === 1) {
          <div class="tab-pane-content">
            <div class="row mb-3">
              <div class="col-md-6">
                <label class="form-label">Message ID</label>
                <input class="form-control" [(ngModel)]="message.messageId" placeholder="Auto-generated if empty">
              </div>
              <div class="col-md-6">
                <label class="form-label">Correlation ID</label>
                <input class="form-control" [(ngModel)]="message.correlationId">
              </div>
            </div>

            <div class="row mb-3">
              <div class="col-md-6">
                <label class="form-label">Session ID</label>
                <input class="form-control" [(ngModel)]="message.sessionId">
              </div>
              <div class="col-md-6">
                <label class="form-label">Partition Key</label>
                <input class="form-control" [(ngModel)]="message.partitionKey">
              </div>
            </div>

            <div class="row mb-3">
              <div class="col-md-6">
                <label class="form-label">Subject / Label</label>
                <input class="form-control" [(ngModel)]="message.subject">
              </div>
              <div class="col-md-6">
                <label class="form-label">To</label>
                <input class="form-control" [(ngModel)]="message.to">
              </div>
            </div>

            <div class="mb-3">
              <label class="form-label">Reply To</label>
              <input class="form-control" [(ngModel)]="message.replyTo">
            </div>

            <hr class="my-3">
            <h6 class="text-muted mb-3">
              <i class="fa fa-clock me-2"></i>Delivery Options
            </h6>

            <div class="row mb-3">
              <div class="col-md-6">
                <label class="form-label">Scheduled Delivery</label>
                <input type="datetime-local" class="form-control"
                  data-testid="scheduled-enqueue-time"
                  [(ngModel)]="scheduledEnqueueTimeLocal"
                  [min]="minDateTimeLocal">
              </div>
              <div class="col-md-6">
                <label class="form-label">Time to Live</label>
                <input type="text" class="form-control"
                  data-testid="time-to-live"
                  [(ngModel)]="message.timeToLive"
                  placeholder="HH:mm:ss">
              </div>
            </div>
          </div>
        }

        @if (activeTab === 2) {
          <div class="tab-pane-content">
            <p class="text-muted mb-3">Add custom application properties to the message</p>

            @for (prop of customProperties; track $index) {
              <div class="property-row mb-2">
                <div class="flex-fill">
                  <input class="form-control" [(ngModel)]="prop.key" placeholder="Key">
                </div>
                <div class="flex-fill">
                  <input class="form-control" [(ngModel)]="prop.value" placeholder="Value">
                </div>
                <button class="btn btn-outline-danger btn-sm" (click)="removeProperty($index)">
                  <i class="fa fa-trash"></i>
                </button>
              </div>
            }

            <button class="btn btn-outline-secondary" (click)="addProperty()">
              <i class="fa fa-plus me-2"></i>
              Add Property
            </button>
          </div>
        }
      </div>
    </div>

    <div class="modal-footer" [class.bg-dark]="themeService.isDark()">
      <button class="btn btn-outline-info me-auto" (click)="saveAsTemplate()" [disabled]="!message.body">
        <i class="fa fa-bookmark me-2"></i>
        Save as Template
      </button>
      <button class="btn btn-secondary" mat-dialog-close>Cancel</button>
      <button class="btn btn-primary" (click)="send()" [disabled]="sending() || !message.body">
        @if (sending()) {
          <span class="spinner-border spinner-border-sm me-2"></span>
        } @else {
          <i class="fa fa-paper-plane me-2"></i>
        }
        {{ isResubmitMode ? 'Resubmit' : (isScheduled ? 'Schedule' : 'Send') }}
      </button>
    </div>
  `,
  styles: [`
    .modal-header {
      border-bottom: 1px solid var(--bs-border-color);
      padding: 16px 24px;
    }

    .modal-title {
      margin: 0;
      font-size: 18px;
      font-weight: 500;
      color: var(--bs-body-color);

      i {
        font-size: 20px;
      }
    }

    .modal-body {
      padding: 24px;
      min-width: 600px;
      min-height: 400px;
    }

    .modal-footer {
      border-top: 1px solid var(--bs-border-color);
      padding: 16px 24px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .tab-content {
      padding: 16px 0;
    }

    .property-row {
      display: flex;
      gap: 16px;
      align-items: center;

      .flex-fill {
        flex: 1;
      }
    }

    .template-picker {
      padding-bottom: 12px;
      border-bottom: 1px solid var(--bs-border-color);
    }
  `]
})
export class SendMessageDialogComponent {
  data = inject<SendMessageDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<SendMessageDialogComponent>);
  private queueService = inject(QueueService);
  private topicService = inject(TopicService);
  private snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  protected themeService = inject(ThemeService);
  private templateService = inject(MessageTemplateService);

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
    // Build application properties
    if (this.customProperties.length > 0) {
      this.message.applicationProperties = {};
      for (const prop of this.customProperties) {
        if (prop.key) {
          this.message.applicationProperties[prop.key] = prop.value;
        }
      }
    }

    // Convert datetime-local string to Date for the API
    if (this.scheduledEnqueueTimeLocal) {
      this.message.scheduledEnqueueTime = new Date(this.scheduledEnqueueTimeLocal);
    }

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
      error: () => {
        this.snackBar.open('Failed to send message', 'Close', { duration: 3000 });
      }
    });
  }
}
