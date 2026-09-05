import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(root, 'shared/src'),
      '@': path.resolve(root, 'client/src/designer'),
    },
  },
  test: {
    include: [
      'shared/**/*.test.ts',
      'src/**/*.test.ts',
      'client/src/**/*.test.{ts,tsx}',
    ],
    environment: 'node',
  },
});
