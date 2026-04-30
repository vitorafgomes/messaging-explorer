import { Injectable } from '@angular/core';
import { SendMessageRequest } from '../models';

/**
 * Fields from MessageInfo that are read-only and should be ignored during import.
 * These are set by the broker, not by the sender.
 */
const READ_ONLY_FIELDS = new Set([
  'sequenceNumber',
  'enqueuedTime',
  'deliveryCount',
  'expiresAt',
  'bodyType',
  'deadLetterSource',
  'deadLetterReason',
  'deadLetterErrorDescription',
  'replyToSessionId',
]);

/**
 * Fields that can be mapped from MessageInfo to SendMessageRequest.
 */
const SENDABLE_FIELDS = new Set([
  'body',
  'contentType',
  'messageId',
  'correlationId',
  'sessionId',
  'partitionKey',
  'subject',
  'to',
  'replyTo',
  'timeToLive',
  'scheduledEnqueueTime',
  'applicationProperties',
]);

/**
 * Mapping from CSV column headers (as exported by MessageExportService) to
 * SendMessageRequest field names. Only sendable fields are included.
 */
const CSV_HEADER_TO_FIELD: Record<string, string> = {
  'Message ID': 'messageId',
  'Correlation ID': 'correlationId',
  'Session ID': 'sessionId',
  'Partition Key': 'partitionKey',
  'Subject': 'subject',
  'Content Type': 'contentType',
  'Body': 'body',
  'Reply To': 'replyTo',
  'To': 'to',
  'Time To Live': 'timeToLive',
  'Scheduled Enqueue Time': 'scheduledEnqueueTime',
  'Application Properties': 'applicationProperties',
};

/**
 * Service for importing messages from JSON and CSV file formats.
 * Parses exported message files and converts them to SendMessageRequest arrays
 * suitable for batch sending.
 */
@Injectable({
  providedIn: 'root'
})
export class MessageImportService {

  /**
   * Parses a JSON file content into an array of SendMessageRequest objects.
   * Accepts both a JSON array of MessageInfo objects (as exported) and
   * a JSON array of SendMessageRequest objects.
   * Read-only fields (sequenceNumber, enqueuedTime, deliveryCount, etc.) are stripped.
   *
   * @param content - Raw JSON string
   * @returns Array of SendMessageRequest objects
   * @throws Error if JSON is invalid or not an array
   */
  parseJsonFile(content: string): SendMessageRequest[] {
    const trimmed = content.trim();
    if (!trimmed) {
      return [];
    }

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      throw new Error('Invalid JSON: ' + (e instanceof Error ? e.message : String(e)));
    }

    if (!Array.isArray(parsed)) {
      // If it's a single object, wrap it
      if (typeof parsed === 'object' && parsed !== null) {
        parsed = [parsed];
      } else {
        throw new Error('Expected a JSON array of messages');
      }
    }

    return parsed.map((item: any, index: number) => this.mapToSendRequest(item, index));
  }

  /**
   * Parses a CSV file content into an array of SendMessageRequest objects.
   * Expects CSV with headers matching the export format from MessageExportService.
   * Handles quoted fields and escaped quotes per RFC 4180.
   *
   * @param content - Raw CSV string
   * @returns Array of SendMessageRequest objects
   * @throws Error if CSV has no data rows or headers cannot be parsed
   */
  parseCsvFile(content: string): SendMessageRequest[] {
    const trimmed = content.trim();
    if (!trimmed) {
      return [];
    }

    const rows = this.parseCsvRows(trimmed);
    if (rows.length < 2) {
      // Only header row or empty
      return [];
    }

    const headers = rows[0];
    const fieldMapping = this.buildFieldMapping(headers);

    const messages: SendMessageRequest[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length === 0 || (row.length === 1 && row[0] === '')) {
        continue; // Skip empty rows
      }
      const msg = this.mapCsvRowToSendRequest(row, fieldMapping);
      if (msg) {
        messages.push(msg);
      }
    }

    return messages;
  }

  /**
   * Detects the file format from the filename extension and parses accordingly.
   *
   * @param content - Raw file content
   * @param filename - The filename (used to detect format from extension)
   * @returns Array of SendMessageRequest objects
   * @throws Error if format is unsupported or content is invalid
   */
  parseFile(content: string, filename: string): SendMessageRequest[] {
    const extension = this.getFileExtension(filename);

    switch (extension) {
      case 'json':
        return this.parseJsonFile(content);
      case 'csv':
        return this.parseCsvFile(content);
      default:
        throw new Error(`Unsupported file format: .${extension}. Expected .json or .csv`);
    }
  }

  /**
   * Maps a raw object (from JSON parse) to a SendMessageRequest,
   * stripping read-only fields.
   */
  private mapToSendRequest(item: any, index: number): SendMessageRequest {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Item at index ${index} is not an object`);
    }

    const request: SendMessageRequest = {
      body: ''
    };

    for (const key of Object.keys(item)) {
      if (SENDABLE_FIELDS.has(key)) {
        const value = item[key];
        if (value !== null && value !== undefined) {
          if (key === 'scheduledEnqueueTime' && typeof value === 'string') {
            (request as any)[key] = new Date(value);
          } else if (key === 'applicationProperties' && typeof value === 'object') {
            request.applicationProperties = { ...value };
          } else {
            (request as any)[key] = value;
          }
        }
      }
    }

    // Ensure body is a string
    if (typeof request.body !== 'string') {
      request.body = JSON.stringify(request.body);
    }

    return request;
  }

  /**
   * Parses CSV content into a 2D array of strings.
   * Handles RFC 4180 quoted fields, escaped double quotes, and newlines within quotes.
   */
  private parseCsvRows(content: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    while (i < content.length) {
      const char = content[i];

      if (inQuotes) {
        if (char === '"') {
          // Check for escaped quote (double quote)
          if (i + 1 < content.length && content[i + 1] === '"') {
            currentField += '"';
            i += 2;
            continue;
          }
          // End of quoted field
          inQuotes = false;
          i++;
          continue;
        }
        currentField += char;
        i++;
      } else {
        if (char === '"') {
          inQuotes = true;
          i++;
        } else if (char === ',') {
          currentRow.push(currentField);
          currentField = '';
          i++;
        } else if (char === '\n') {
          currentRow.push(currentField);
          currentField = '';
          rows.push(currentRow);
          currentRow = [];
          i++;
        } else if (char === '\r') {
          // Handle \r\n
          i++;
          if (i < content.length && content[i] === '\n') {
            i++;
          }
          currentRow.push(currentField);
          currentField = '';
          rows.push(currentRow);
          currentRow = [];
        } else {
          currentField += char;
          i++;
        }
      }
    }

    // Push last field and row
    if (currentField || currentRow.length > 0) {
      currentRow.push(currentField);
      rows.push(currentRow);
    }

    return rows;
  }

  /**
   * Builds a mapping from column index to SendMessageRequest field name.
   */
  private buildFieldMapping(headers: string[]): Map<number, string> {
    const mapping = new Map<number, string>();
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i].trim();
      const fieldName = CSV_HEADER_TO_FIELD[header];
      if (fieldName) {
        mapping.set(i, fieldName);
      }
    }
    return mapping;
  }

  /**
   * Maps a single CSV row to a SendMessageRequest using the column-to-field mapping.
   */
  private mapCsvRowToSendRequest(row: string[], fieldMapping: Map<number, string>): SendMessageRequest | null {
    const request: SendMessageRequest = {
      body: ''
    };

    let hasData = false;

    for (const [colIndex, fieldName] of fieldMapping) {
      if (colIndex >= row.length) continue;

      const value = row[colIndex].trim();
      if (!value) continue;

      hasData = true;

      if (fieldName === 'applicationProperties') {
        try {
          request.applicationProperties = JSON.parse(value);
        } catch {
          // If it's not valid JSON, store as a single property
          request.applicationProperties = { raw: value };
        }
      } else if (fieldName === 'scheduledEnqueueTime') {
        request.scheduledEnqueueTime = new Date(value);
      } else {
        (request as any)[fieldName] = value;
      }
    }

    return hasData ? request : null;
  }

  /**
   * Extracts the file extension from a filename (lowercased, without dot).
   */
  private getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1) return '';
    return filename.substring(lastDot + 1).toLowerCase();
  }
}
