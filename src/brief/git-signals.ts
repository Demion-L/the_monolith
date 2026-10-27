/**
 * Read-only git signals for the freshness check (SELF-AWARENESS-001).
 *
 * Runs only `git log` and `git rev-parse`, never a command that writes, never
 * through a shell, with config that could launch helper programs switched off.
 * Any failure degrades to `{ status: 'unavailable' }` — git being absent,
 * broken or refusing the directory must never fail the brief.
 */

import { execFileSync } from 'child_process';
import type { GitSignals, GitCommitSignal } from './freshness.js';

/** Upper bound on commits read after the last state update. Hitting it marks the result truncated. */
export const MAX_COMMITS_SINCE = 500;
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

const SAFE_CONFIG = [
  '-c', 'core.fsmonitor=false',
  '-c', 'core.pager=cat',
  '-c', 'log.showSignature=false',
  '-c', 'diff.external=',
];

class GitMissingError extends Error {}

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', [...SAFE_CONFIG, ...args], {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_EXTERNAL_DIFF: '' },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new GitMissingError('git not installed');
    throw err;
  }
}

const RS = '\x1e'; // record separator, starts each commit
const US = '\x1f'; // unit separator, between header fields

/**
 * @param targetDir project directory (git is run from here; paths are relative to it)
 * @param stateFiles state documents, relative to `targetDir`. Only existing ones need be passed.
 */
export function readGitSignals(targetDir: string, stateFiles: string[]): GitSignals {
  try {
    const inside = git(targetDir, ['rev-parse', '--is-inside-work-tree']).trim();
    if (inside !== 'true') return { status: 'unavailable', reason: 'NOT_A_GIT_REPOSITORY' };
  } catch (err) {
    if (err instanceof GitMissingError) return { status: 'unavailable', reason: 'GIT_NOT_INSTALLED' };
    const stderr = String((err as { stderr?: unknown }).stderr ?? '');
    return { status: 'unavailable', reason: /not a git repository/i.test(stderr) ? 'NOT_A_GIT_REPOSITORY' : 'GIT_FAILED' };
  }

  try {
    // A repository without commits has no HEAD: nothing to compare with.
    try {
      git(targetDir, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    } catch {
      return { status: 'ok', lastStateUpdate: null, commitsSince: [], truncated: false };
    }

    let lastStateUpdate: { sha: string; date: string } | null = null;
    if (stateFiles.length > 0) {
      const out = git(targetDir, ['log', '-1', `--format=%H${US}%cI`, '--', ...stateFiles]).trim();
      if (out) {
        const [sha, date] = out.split(US);
        lastStateUpdate = { sha, date };
      }
    }
    if (!lastStateUpdate) return { status: 'ok', lastStateUpdate: null, commitsSince: [], truncated: false };

    const raw = git(targetDir, [
      'log',
      `-n${MAX_COMMITS_SINCE + 1}`,
      '--no-ext-diff',
      '--no-textconv',
      '--relative',
      '--name-only',
      `--format=${RS}%H${US}%cI${US}%s`,
      `${lastStateUpdate.sha}..HEAD`,
    ]);

    const commits: GitCommitSignal[] = [];
    for (const rec of raw.split(RS)) {
      if (!rec.trim()) continue;
      const nl = rec.indexOf('\n');
      const header = nl === -1 ? rec : rec.slice(0, nl);
      const [sha, date, subject] = header.split(US);
      const files = (nl === -1 ? '' : rec.slice(nl + 1)).split('\n').filter((l) => l.trim() !== '');
      commits.push({ sha, date, subject: subject ?? '', files });
    }
    const truncated = commits.length > MAX_COMMITS_SINCE;
    return { status: 'ok', lastStateUpdate, commitsSince: commits.slice(0, MAX_COMMITS_SINCE), truncated };
  } catch {
    return { status: 'unavailable', reason: 'GIT_FAILED' };
  }
}
