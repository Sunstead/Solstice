import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Separate from vite.config.ts so tests don't run the router generator or
// the Tauri dev-server settings.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
