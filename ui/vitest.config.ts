import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type UserConfig } from 'vitest/config';

type Plugins = NonNullable<UserConfig['plugins']>;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // vitest 2 bundles vite 5 types; the vite 6 plugin is structurally compatible.
  plugins: [vue() as unknown as Plugins[number]],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
