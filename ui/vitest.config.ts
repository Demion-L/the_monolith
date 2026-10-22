import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: import.meta.dirname,
  // vitest 2 bundles its own vite types; the plugin is structurally compatible.
  plugins: [vue() as never],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
