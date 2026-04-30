import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: [
      'src/app/app.spec.ts',
      'src/app/core/services/theme.service.spec.ts',
      'src/app/core/models/session.model.spec.ts',
      'src/app/core/services/session.service.spec.ts',
      'src/app/features/entities/transfer-monitor.component.spec.ts',
      'src/app/core/services/message-template.service.spec.ts',
      'src/app/features/messages/send-message-dialog.component.spec.ts',
      'src/app/core/services/message-import.service.spec.ts',
      'src/app/features/messages/message-diff-dialog.component.spec.ts',
    ],
  },
});
