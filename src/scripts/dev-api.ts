/**
 * Local development entry for Mission Control: serves the read-only dashboard
 * API for the current directory's project on a fixed loopback port, so the Vite
 * dev server can proxy `/api/dashboard` to it. Not a production server.
 *
 *   pnpm build && pnpm dev:api     # terminal 1
 *   pnpm dev:ui                    # terminal 2
 */
import { resolve } from 'path';
import { startDashboardServer } from '../http/index.js';

const port = Number(process.env.MONOLITH_API_PORT ?? 7420);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('MONOLITH_API_PORT must be an integer between 1 and 65535.');
  process.exit(1);
}

const projectRoot = resolve(process.cwd());
const server = await startDashboardServer({ projectRoot, port });
console.log(`MONOLITH dashboard API: ${server.url}/api/dashboard  (project: ${projectRoot})`);

const shutdown = (): void => {
  void server.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
