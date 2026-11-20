/**
 * Read-only git signals for verification freshness (ACCOUNTABILITY-001).
 *
 * Same safe-git posture as `brief/git-signals.ts` (no pager, no external diff, no lazy fetch, no
 * helper programs, no shell, nothing written). Every failure degrades to "unknown": a missing git,
 * a non-repository or unparseable output is never evidence of anything.
 */
import { execFileSync } from 'child_process';
import { SAFE_CONFIG, SAFE_ENV } from '../brief/git-signals.js';
const TIMEOUT_MS = 10_000;
const MAX_BUFFER = 8 * 1024 * 1024;
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** Pathspec magic is needed for `exclude`, so literal-pathspec mode is switched off — the paths are fixed constants, never user input. */
function run(cwd, args) {
    try {
        return execFileSync('git', [...SAFE_CONFIG, ...args], {
            cwd,
            encoding: 'utf8',
            timeout: TIMEOUT_MS,
            maxBuffer: MAX_BUFFER,
            stdio: ['ignore', 'pipe', 'ignore'],
            env: { ...process.env, ...SAFE_ENV, GIT_LITERAL_PATHSPECS: '0' },
        });
    }
    catch {
        return null;
    }
}
const exclude = (rels) => rels.map((r) => `:(exclude,literal)${r}`);
/** HEAD and working-tree cleanliness of the repository containing `projectRoot`. */
export function readGitView(projectRoot, excludeRels = []) {
    const inside = run(projectRoot, ['rev-parse', '--is-inside-work-tree']);
    if (inside === null || inside.trim() !== 'true')
        return { available: false, head: null, dirty: null, dirtyEntries: null };
    const headOut = run(projectRoot, ['rev-parse', '--verify', '-q', 'HEAD']);
    const head = headOut !== null && SHA_RE.test(headOut.trim()) ? headOut.trim() : null;
    const status = run(projectRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', ...exclude(excludeRels)]);
    if (status === null)
        return { available: true, head, dirty: null, dirtyEntries: null };
    const entries = status === '' ? 0 : status.split('\0').filter((e) => e !== '').length;
    return { available: true, head, dirty: entries > 0, dirtyEntries: entries };
}
/**
 * Paths changed between two revisions, outside the excluded paths. `null` when either revision is
 * not a known commit (e.g. a different clone) — the caller must treat that as "cannot tell".
 */
export function changedBetween(projectRoot, from, to, excludeRels = []) {
    if (!SHA_RE.test(from) || !SHA_RE.test(to))
        return null;
    if (run(projectRoot, ['cat-file', '-e', `${from}^{commit}`]) === null)
        return null;
    const out = run(projectRoot, ['diff', '--name-only', '-z', from, to, '--', '.', ...exclude(excludeRels)]);
    if (out === null)
        return null;
    return out.split('\0').filter((e) => e !== '');
}
