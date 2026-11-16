import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Must match the port `pnpm dev:api` listens on (src/scripts/dev-api.ts).
const apiPort = Number(process.env.MONOLITH_API_PORT ?? 7420);

// Relative base: assets resolve next to index.html, so dist/ui can be served
// from any mount point by a later backend.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [vue()],
  server: {
    proxy: {
      // The one endpoint the UI uses, forwarded to the local MONOLITH HTTP API.
      // changeOrigin rewrites Host to 127.0.0.1:<apiPort>, which the API's Host
      // allowlist requires. Origin is NOT touched: a same-origin browser GET
      // carries none, and anything that does carry one is still checked by the
      // API. No CORS or allowlist is relaxed anywhere.
      '^/api/dashboard$': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
      // The two on-demand diagnostics (POST). The browser sends the Vite dev origin, which the API
      // (correctly) does not allow; only in this dev proxy it is rewritten to the API's own origin.
      // The production server (`monolith ui`) serves the UI and the API from one origin and needs no rewrite.
      '^/api/diagnostics/(validate|reconcile)$': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            if (proxyReq.getHeader('origin') !== undefined) proxyReq.setHeader('origin', `http://127.0.0.1:${apiPort}`);
          });
        },
      },
    },
  },
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
    // Keep the small brand mark as a real file in dist/ui/assets instead of a data: URI in the JS.
    assetsInlineLimit: 0,
  },
});
