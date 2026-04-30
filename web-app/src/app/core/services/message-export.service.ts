import { Injectable } from '@angular/core';
import { MessageInfo } from '../models';

/**
 * Export format type
 */
export type ExportFormat = 'json' | 'csv' | 'xlsx';

/**
 * Export options for message export operations
 */
export interface MessageExportOptions {
  format: ExportFormat;
  includeApplicationProperties: boolean;
  prettyPrint: boolean;
}

/**
 * Service for exporting messages to various file formats.
 * Handles conversion of messages to JSON and CSV formats,
 * and triggers browser downloads.
 */
@Injectable({
  providedIn: 'root'
})
export class MessageExportService {

  /**
   * Exports messages to JSON format
   * @param messages - Array of messages to export
   * @param options - Export options including pretty-print and property inclusion settings
   * @returns JSON string representation of the messages
   */
  exportToJson(messages: MessageInfo[], options: MessageExportOptions): string {
    // Prepare messages for export
    const exportData = this.prepareMessagesForExport(messages, options.includeApplicationProperties);

    // Generate JSON with optional pretty-printing
    if (options.prettyPrint) {
      return JSON.stringify(exportData, null, 2);
    } else {
      return JSON.stringify(exportData);
    }
  }

  /**
   * Exports messages to CSV format
   * @param messages - Array of messages to export
   * @param options - Export options including property inclusion settings
   * @returns CSV string representation of the messages
   */
  exportToCsv(messages: MessageInfo[], options: MessageExportOptions): string {
    if (!messages || messages.length === 0) {
      return '';
    }

    // Define CSV columns
    const columns = [
      { key: 'sequenceNumber', header: 'Sequence Number' },
      { key: 'messageId', header: 'Message ID' },
      { key: 'correlationId', header: 'Correlation ID' },
      { key: 'sessionId', header: 'Session ID' },
      { key: 'partitionKey', header: 'Partition Key' },
      { key: 'subject', header: 'Subject' },
      { key: 'contentType', header: 'Content Type' },
      { key: 'body', header: 'Body' },
      { key: 'bodyType', header: 'Body Type' },
      { key: 'deliveryCount', header: 'Delivery Count' },
      { key: 'enqueuedTime', header: 'Enqueued Time' },
      { key: 'scheduledEnqueueTime', header: 'Scheduled Enqueue Time' },
      { key: 'expiresAt', header: 'Expires At' },
      { key: 'timeToLive', header: 'Time To Live' },
      { key: 'replyTo', header: 'Reply To' },
      { key: 'replyToSessionId', header: 'Reply To Session ID' },
      { key: 'to', header: 'To' },
      { key: 'deadLetterSource', header: 'Dead Letter Source' },
      { key: 'deadLetterReason', header: 'Dead Letter Reason' },
      { key: 'deadLetterErrorDescription', header: 'Dead Letter Error Description' }
    ];

    // Add application properties column if requested
    if (options.includeApplicationProperties) {
      columns.push({ key: 'applicationProperties', header: 'Application Properties' });
    }

    // Build CSV header row
    const headerRow = columns.map(col => this.escapeCsvValue(col.header)).join(',');

    // Build CSV data rows
    const dataRows = messages.map(message => {
      return columns.map(col => {
        const value = this.getMessageValue(message, col.key);
        return this.escapeCsvValue(this.formatCsvValue(value));
      }).join(',');
    });

    // Combine header and data rows
    return [headerRow, ...dataRows].join('\n');
  }

  /**
   * Triggers a browser download of the provided content
   * @param content - The file content to download
   * @param filename - The name for the downloaded file
   * @param mimeType - The MIME type of the file
   */
  downloadFile(content: string, filename: string, mimeType: string): void {
    // Create a Blob from the content
    const blob = new Blob([content], { type: mimeType });

    // Create a temporary URL for the blob
    const url = window.URL.createObjectURL(blob);

    // Create a temporary anchor element
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';

    // Add to document, trigger click, and clean up
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    // Release the object URL after a short delay
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 100);
  }

  /**
   * Exports messages to XLSX format with formatted headers and optional application properties sheet.
   * Uses dynamic import of exceljs for tree-shaking — the library is only loaded when XLSX export is triggered.
   * @param messages - Array of messages to export
   * @param options - Export options including property inclusion settings
   * @returns Promise resolving to a Blob containing the XLSX file
   */
  async exportToXlsx(messages: MessageInfo[], options: MessageExportOptions): Promise<Blob> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();

    // Sheet 1: Messages (same 20 columns as CSV)
    const sheet = workbook.addWorksheet('Messages');
    sheet.columns = [
      { header: 'Sequence Number', key: 'sequenceNumber', width: 18 },
      { header: 'Message ID', key: 'messageId', width: 38 },
      { header: 'Correlation ID', key: 'correlationId', width: 38 },
      { header: 'Session ID', key: 'sessionId', width: 20 },
      { header: 'Partition Key', key: 'partitionKey', width: 15 },
      { header: 'Subject', key: 'subject', width: 25 },
      { header: 'Content Type', key: 'contentType', width: 20 },
      { header: 'Body', key: 'body', width: 60 },
      { header: 'Body Type', key: 'bodyType', width: 12 },
      { header: 'Delivery Count', key: 'deliveryCount', width: 15 },
      { header: 'Enqueued Time', key: 'enqueuedTime', width: 22 },
      { header: 'Scheduled Enqueue Time', key: 'scheduledEnqueueTime', width: 22 },
      { header: 'Expires At', key: 'expiresAt', width: 22 },
      { header: 'Time To Live', key: 'timeToLive', width: 15 },
      { header: 'Reply To', key: 'replyTo', width: 20 },
      { header: 'Reply To Session ID', key: 'replyToSessionId', width: 20 },
      { header: 'To', key: 'to', width: 20 },
      { header: 'Dead Letter Source', key: 'deadLetterSource', width: 25 },
      { header: 'Dead Letter Reason', key: 'deadLetterReason', width: 30 },
      { header: 'Dead Letter Error', key: 'deadLetterErrorDescription', width: 40 },
    ];

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };

    // Add data rows
    for (const msg of messages) {
      sheet.addRow({
        sequenceNumber: msg.sequenceNumber,
        messageId: msg.messageId,
        correlationId: msg.correlationId ?? '',
        sessionId: msg.sessionId ?? '',
        partitionKey: msg.partitionKey ?? '',
        subject: msg.subject ?? '',
        contentType: msg.contentType ?? '',
        body: msg.body,
        bodyType: msg.bodyType,
        deliveryCount: msg.deliveryCount,
        enqueuedTime: msg.enqueuedTime ? new Date(msg.enqueuedTime).toISOString() : '',
        scheduledEnqueueTime: msg.scheduledEnqueueTime ? new Date(msg.scheduledEnqueueTime).toISOString() : '',
        expiresAt: msg.expiresAt ? new Date(msg.expiresAt).toISOString() : '',
        timeToLive: msg.timeToLive,
        replyTo: msg.replyTo ?? '',
        replyToSessionId: msg.replyToSessionId ?? '',
        to: msg.to ?? '',
        deadLetterSource: msg.deadLetterSource ?? '',
        deadLetterReason: msg.deadLetterReason ?? '',
        deadLetterErrorDescription: msg.deadLetterErrorDescription ?? '',
      });
    }

    // Sheet 2: Application Properties (if included)
    if (options.includeApplicationProperties) {
      const propsSheet = workbook.addWorksheet('Application Properties');
      propsSheet.columns = [
        { header: 'Message ID', key: 'messageId', width: 38 },
        { header: 'Sequence Number', key: 'sequenceNumber', width: 18 },
        { header: 'Property Key', key: 'key', width: 30 },
        { header: 'Property Value', key: 'value', width: 50 },
      ];
      const propsHeader = propsSheet.getRow(1);
      propsHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      propsHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } };

      for (const msg of messages) {
        if (msg.applicationProperties) {
          for (const [key, value] of Object.entries(msg.applicationProperties)) {
            propsSheet.addRow({
              messageId: msg.messageId,
              sequenceNumber: msg.sequenceNumber,
              key,
              value: value?.toString() ?? ''
            });
          }
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  /**
   * Triggers a browser download of the provided Blob
   * @param blob - The Blob to download
   * @param filename - The name for the downloaded file
   */
  downloadBlob(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => window.URL.revokeObjectURL(url), 100);
  }

  /**
   * Prepares messages for export by optionally filtering out application properties
   * @param messages - Array of messages to prepare
   * @param includeApplicationProperties - Whether to include application properties
   * @returns Prepared message data for export
   */
  private prepareMessagesForExport(messages: MessageInfo[], includeApplicationProperties: boolean): any[] {
    if (includeApplicationProperties) {
      return messages;
    }

    // Return messages without application properties
    return messages.map(message => {
      const { applicationProperties, ...messageWithoutAppProps } = message;
      return messageWithoutAppProps;
    });
  }

  /**
   * Gets a value from a message object by key path
   * @param message - The message object
   * @param key - The property key to retrieve
   * @returns The value at the specified key
   */
  private getMessageValue(message: MessageInfo, key: string): any {
    const value = (message as any)[key];

    // Handle special case for application properties
    if (key === 'applicationProperties' && value) {
      return JSON.stringify(value);
    }

    return value;
  }

  /**
   * Formats a value for CSV output
   * @param value - The value to format
   * @returns Formatted string value
   */
  private formatCsvValue(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }

  /**
   * Escapes a value for safe CSV output
   * Handles quotes, commas, and newlines according to CSV RFC 4180
   * @param value - The value to escape
   * @returns Escaped CSV value
   */
  private escapeCsvValue(value: string): string {
    if (!value) {
      return '""';
    }

    // Check if value contains special characters that require quoting
    const needsQuoting = value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r');

    if (needsQuoting) {
      // Escape double quotes by doubling them
      const escaped = value.replace(/"/g, '""');
      return `"${escaped}"`;
    }

    return `"${value}"`;
  }
}
