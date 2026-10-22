import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Relative base: assets resolve next to index.html, so dist/ui can be served
// from any mount point by a later backend.
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [vue()],
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
  },
});
