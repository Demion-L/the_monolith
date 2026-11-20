/**
 * Test-only fixture builder (lives in scripts/: never packed): a disposable MONOLITH project (optionally a git repository) with stories,
 * missions, checkpoints, ADRs and evidence in chosen states. Imported only by tests; never shipped
 * (dist/scripts is excluded from the package).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckpoint, finishMission, resolveStateLocation, startMission } from '../coordinatorium/index.js';
import { scaffoldInstance } from '../init/scaffold.js';

export const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

export async function makeProject(opts: { git?: boolean } = {}): Promise<string> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'handover-')));
  const log = console.log;
  console.log = () => undefined;
  try {
    await scaffoldInstance(dir, { projectName: 'Fx', language: 'typescript', packageManager: 'pnpm', aiTool: 'claude', finalizationProtocol: 'finalize-story', protocols: ['finalize-story'], monolithRoot: '.monolith' });
  } finally {
    console.log = log;
  }
  if (opts.git === true) {
    git(dir, 'init', '-q', '-b', 'main');
    commitAll(dir, 'init');
  }
  return dir;
}

export function commitAll(dir: string, msg: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', msg, '--allow-empty');
}

export function write(dir: string, rel: string, text: string): void {
  const p = join(dir, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, text);
}

export function adr(dir: string, n: number, status: string | null, extra = ''): void {
  const id = `ADR-${String(n).padStart(3, '0')}`;
  write(dir, `docs/adr/${id}-x.md`, `---\nid: ${id}\n${status === null ? '' : `status: ${status}\n`}---\n\n# ${id}\n${extra}\n`);
}

export function finalizedStory(dir: string, phase: string, id: string): void {
  const p = '.monolith/memory/working/story-index.md';
  
  const cur = readFileSync(join(dir, p), 'utf8');
  const entry = `\n## Phase ${phase} — P\n\n### ${id} — Title ${id}\n\n**Date:** 2026-01-01\n**Status:** COMPLETED\n`;
  writeFileSync(join(dir, p), cur + entry);
}

export function roadmap(dir: string, stories: string[], active = '—'): void {
  write(dir, '.monolith/context/maps/roadmap-index.md', `---\ntype: context\nid: roadmap-index\ntopology_role: root\nauthority: authoritative\n---\n\n# Roadmap\n\n## Phases\n\n### Phase 1 — P\n\n**Status:** IN PROGRESS\n\n| Story | Name | Status | x | \n|---|---|---|---|\n${stories.map((s) => `| ${s} | n | PLANNED | |`).join('\n')}\n\n---\n\n## Current Focus\n\nActive Phase: ${active}\n`);
}

export function activeStory(dir: string, id: string | null): void {
  write(dir, '.monolith/memory/working/active.md', `---\ntype: memory\nid: memory-working-active\ncategory: working\ntopology_role: root\n---\n\n# Active\n\n## Current Story\n\n${id === null ? 'No active story.' : `**Story:** ${id} — t`}\n`);
}

/** A mission with optional checkpoints, finished or left in progress. */
export async function mission(dir: string, o: { title?: string; story?: string; checkpoints?: number; result?: 'completed' | 'failed' | 'cancelled' }): Promise<string> {
  const loc = resolveStateLocation(dir);
  const target = { scope: 'project' as const, projectRoot: dir, stateDir: loc.stateDir };
  const m = await startMission(target, { title: o.title ?? 'm', system: 's', ...(o.story !== undefined ? { storyId: o.story } : {}) });
  for (let i = 0; i < (o.checkpoints ?? 0); i++) await createCheckpoint(target, m.id, { summary: `step ${i + 1}`, remainingSteps: [`next ${i + 1}`], context: null });
  if (o.result !== undefined) await finishMission(target, m.id, { result: o.result, summary: 'done' });
  return m.id;
}
