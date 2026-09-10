import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@personal-os/domain': path.resolve(__dirname, './packages/domain/src'),
      '@personal-os/db': path.resolve(__dirname, './packages/db/src'),
      '@personal-os/core': path.resolve(__dirname, './packages/core/src'),
      '@personal-os/worker': path.resolve(__dirname, './apps/worker/src'),
    },
  },
});
