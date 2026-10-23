import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Relative base: assets resolve next to index.html, so dist/ui can be served
// from any mount point by a later backend.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [vue()],
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
  },
});
