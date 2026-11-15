import { Type, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { NEVER, of } from 'rxjs';
import {
  ConnectionGroupService, ConnectionService, MessageExportService, MessageImportService, MessageTemplateService,
  QueueService, ResubmitRunService, TopicService
} from '../core/services';
import { ProviderService } from '../core/services/provider.service';
import { SendMessageDialogComponent } from '../features/messages/send-message-dialog.component';
import { MoveMessagesDialogComponent } from '../features/messages/move-messages-dialog.component';
import { ImportMessagesDialogComponent } from '../features/messages/import-messages-dialog.component';
import { ExportMessagesDialogComponent } from '../features/messages/export-messages-dialog.component';
import { MessageDiffDialogComponent } from '../features/messages/message-diff-dialog.component';
import { ContinuousResubmitDialogComponent } from '../features/messages/continuous-resubmit-dialog.component';
import { ViewMessagesDialogComponent } from '../features/messages/view-messages-dialog.component';
import { ClearAllDataDialogComponent } from '../features/settings/clear-all-data-dialog.component';
import { BulkOperationProgressDialogComponent } from './components/bulk-operation-progress-dialog/bulk-operation-progress-dialog.component';
import { BulkOperationResultsDialogComponent } from './components/bulk-operation-results-dialog/bulk-operation-results-dialog.component';

const HOST = 'contoso-prod.servicebus.windows.net';
const ON = `on Contoso (${HOST})`;
const message = (sequenceNumber: number) => ({ sequenceNumber, messageId: `m-${sequenceNumber}`, body: '{}', applicationProperties: {} });

/** Each dialog the Messages, Send, AutoResubmit and Settings artboards draw with the environment line, and the words after the chip. */
const DIALOGS: { name: string; component: Type<unknown>; data: unknown; where: string }[] = [
  { name: 'Messages (Messages.dc.html header)', component: ViewMessagesDialogComponent, data: { entityType: 'queue', entityName: 'orders' }, where: `orders ${ON}` },
  { name: 'Send (Send.dc.html)', component: SendMessageDialogComponent, data: { entityType: 'queue', entityName: 'orders' }, where: `orders ${ON}` },
  { name: 'Move (Send.dc.html move)', component: MoveMessagesDialogComponent, data: { currentQueueName: 'orders', messageCount: 3, isDeadLetter: true }, where: `orders ${ON}` },
  { name: 'Import (Send.dc.html import)', component: ImportMessagesDialogComponent, data: { entityType: 'queue', entityName: 'orders' }, where: `orders ${ON}` },
  { name: 'Export (Send.dc.html export)', component: ExportMessagesDialogComponent, data: { messageCount: 3, entityName: 'orders', entityType: 'queue', isDeadLetter: false }, where: `orders ${ON}` },
  { name: 'Compare (Send.dc.html diff)', component: MessageDiffDialogComponent, data: { left: message(1), right: message(2), entityName: 'orders' }, where: `orders ${ON}` },
  {
    name: 'Bulk progress (Messages.dc.html progress)', component: BulkOperationProgressDialogComponent,
    data: { operation: 'resubmit', totalCount: 5, entityName: 'orders', entityType: 'queue', subQueue: 'deadletter' }, where: `orders ${ON}`
  },
  {
    name: 'Bulk results (Messages.dc.html results)', component: BulkOperationResultsDialogComponent,
    data: { operation: 'resubmit', result: { successCount: 5, failureCount: 0, failures: [], success: true }, entityName: 'orders', entityType: 'queue' }, where: `orders ${ON}`
  },
  { name: 'Auto resubmit of a queue (AutoResubmit.dc.html)', component: ContinuousResubmitDialogComponent, data: { entityType: 'queue', entityName: 'orders' }, where: `orders ${ON}` },
  {
    name: 'Auto resubmit of a subscription (AutoResubmit.dc.html)', component: ContinuousResubmitDialogComponent,
    data: { entityType: 'subscription', entityName: 'email', topicName: 'order-events' }, where: `email in topic order-events, ${ON}`
  },
  { name: 'Clear all data (Settings.dc.html clearConfirm)', component: ClearAllDataDialogComponent, data: {}, where: `Connected now to ${HOST}; the app disconnects first.` },
];

/** Any service the dialog reads and this spec does not care about: every call waits forever. */
const idle = (known: Record<string, unknown> = {}) =>
  new Proxy(known, { get: (target, key) => key in target ? target[key as string] : key === 'then' ? undefined : () => NEVER });

describe('the environment line in every dialog header the artboards draw it in: the chip, then "<entity> on <connection>"', () => {
  function render(component: Type<unknown>, data: unknown, environment: { name: string; isProduction?: boolean } | null): HTMLElement {
    TestBed.configureTestingModule({
      imports: [component],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialog, useValue: idle() },
        { provide: MatDialogRef, useValue: idle({ close: vi.fn(), disableClose: false }) },
        {
          provide: ConnectionService,
          useValue: idle({
            currentTarget: HOST, currentConnectionId: 'c-1', isConnected: true,
            connectionStatus$: of({ connected: true, namespace: HOST }),
            getConnections: () => of([{ id: 'c-1', name: 'contoso-prod', clientId: 'g-client', environmentId: environment ? 'g-env' : undefined }])
          })
        },
        {
          provide: ConnectionGroupService,
          useValue: idle({ getGroups: () => of([{ id: 'g-client', name: 'Contoso', type: 'client' }, { id: 'g-env', type: 'environment', ...environment }]) })
        },
        { provide: ProviderService, useValue: idle({ capabilities: signal(null) }) },
        { provide: ResubmitRunService, useValue: idle({ activeRuns: signal([]), find: () => undefined }) },
        { provide: QueueService, useValue: idle() },
        { provide: TopicService, useValue: idle() },
        { provide: MessageExportService, useValue: idle() },
        { provide: MessageImportService, useValue: idle() },
        { provide: MessageTemplateService, useValue: idle({ getTemplates: () => of([]) }) },
      ],
    });
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  for (const dialog of DIALOGS) {
    describe(dialog.name, () => {
      it('on a production connection: PRODUCTION in the error container with a warning icon, then the entity on the connection', () => {
        const line = render(dialog.component, dialog.data, { name: 'Production', isProduction: true }).querySelector('.environment-line') as HTMLElement;
        const chip = line?.querySelector('.environment-chip') as HTMLElement;

        expect(chip?.textContent?.replace('warning', '').trim(), `${dialog.name} opens with the PRODUCTION chip`).toBe('PRODUCTION');
        expect(chip.classList.contains('production'), 'PRODUCTION takes the error container').toBe(true);
        expect(chip.querySelector('mat-icon')?.textContent?.trim(), 'a production chip carries the warning icon').toBe('warning');
        expect(line.querySelector('.where')?.textContent?.replace(/\s+/g, ' ').trim(), 'the words the artboard draws after the chip').toBe(dialog.where);
      });

      it('on a connection in no environment: NO ENVIRONMENT', () => {
        const chip = render(dialog.component, dialog.data, null).querySelector('.environment-line .environment-chip');

        expect(chip?.textContent?.trim(), `${dialog.name} says NO ENVIRONMENT for a connection in none`).toBe('NO ENVIRONMENT');
      });
    });
  }
});
