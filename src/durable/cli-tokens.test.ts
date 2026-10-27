/** DURABLE-FIX-001 / R-7 — await tokens are capabilities and are not printed by the CLI unless asked. */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runDurable, openDurable, initializeDurable } from './cli.js';

let proj: string;
beforeEach(() => {
  proj = mkdtempSync(join(tmpdir(), 'durable-cli-tok-'));
  mkdirSync(join(proj, '.monolith'));
});
afterEach(() => rmSync(proj, { recursive: true, force: true }));

async function cli(...args: string[]): Promise<string> {
  let out = '';
  await runDurable(args, { cwd: proj, out: (s) => (out += s), err: () => undefined });
  return out;
}

describe('token redaction in CLI output', () => {
  it('show and packet hide the secret part; --reveal-tokens prints it; the API still returns it', async () => {
    initializeDurable(proj);
    const rt = openDurable(proj);
    await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const f = await rt.claim('job1', { owner: 'w' });
    const { token } = await rt.registerAwait(f, { awaitId: 'a', purpose: 'p' });
    const secret = token.split('.')[3] as string;

    for (const sub of ['show', 'packet']) {
      const hidden = await cli(sub, 'job1');
      expect(hidden).not.toContain(secret);
      expect(hidden).toContain('dsc1.job1.a.<redacted>');
      expect(await cli(sub, 'job1', '--reveal-tokens')).toContain(token);
    }
    expect((await rt.getState('job1')).awaits['a']?.token).toBe(token);
    expect((await rt.resumePacket('job1')).awaits[0]?.token).toBe(token);
  });
});
