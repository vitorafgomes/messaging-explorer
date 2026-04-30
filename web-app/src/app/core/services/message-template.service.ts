import { Injectable } from '@angular/core';
import { MessageTemplate } from '../models';

@Injectable({ providedIn: 'root' })
export class MessageTemplateService {
  private readonly STORAGE_KEY = 'explorer-messages-templates';

  getTemplates(): MessageTemplate[] {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  saveTemplate(template: Omit<MessageTemplate, 'id' | 'createdAt'>): MessageTemplate {
    const templates = this.getTemplates();
    const newTemplate: MessageTemplate = {
      ...template,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    templates.push(newTemplate);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(templates));
    return newTemplate;
  }

  deleteTemplate(id: string): void {
    const templates = this.getTemplates().filter((t) => t.id !== id);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(templates));
  }
}
