/**
 * Read-only, local, offline git signals for the freshness check
 * (SELF-AWARENESS-001, hardened in alpha.4 by A4-SEC-01/02).
 *
 * Contract:
 *  - Only `git log`, `git rev-list`, `git diff-tree`, `git rev-parse` and
 *    `git cat-file` are run; never a command that writes, never through a shell.
 *  - Offline: lazy fetch of missing objects (partial clones) is disabled
 *    (`GIT_NO_LAZY_FETCH=1`) and every transport is refused
 *    (`GIT_ALLOW_PROTOCOL=none`), so a missing object is an error here, never a
 *    download, an object-store write, or a program started from remote config.
 *    (`-c protocol.allow=never` alone was tested and does NOT stop a `file`
 *    promisor remote; it is kept only as an additional layer.)
 *  - Structural parsing: output that carries attacker-influenced text (commit
 *    subjects, file names) is never split on characters that text can contain.
 *    Records use NUL (`-z`), which neither a subject nor a path can contain;
 *    commit metadata and file lists come from separate commands; shas and dates
 *    are validated against strict patterns; the commit list is cross-checked
 *    against `git rev-list`. Anything unexpected is `GIT_OUTPUT_INVALID`.
 *  - Fail closed: every failure degrades to `{ status: 'unavailable' }`, which
 *    freshness turns into UNKNOWN. Git being absent, broken, refusing the
 *    directory or returning something unparseable never fails the brief and is
 *    never evidence of FRESH.
 */
import { execFileSync } from 'child_process';
/** Upper bound on commits read after the last state update. Hitting it marks the result truncated. */
export const MAX_COMMITS_SINCE = 500;
/** Largest blob `readBlobAt` will read; checked with `git cat-file -s` before the content is requested. */
export const MAX_BLOB_BYTES = 256 * 1024;
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
export const SAFE_CONFIG = [
    '-c', 'core.fsmonitor=false',
    '-c', 'core.pager=cat',
    '-c', 'log.showSignature=false',
    '-c', 'diff.external=',
    '-c', 'core.quotepath=off',
    '-c', 'protocol.allow=never',
    '-c', 'protocol.file.allow=never',
];
export const SAFE_ENV = {
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_EXTERNAL_DIFF: '',
    /** git >= 2.44: a missing object is an error instead of a fetch from the promisor remote. */
    GIT_NO_LAZY_FETCH: '1',
    /** Older git has no GIT_NO_LAZY_FETCH; refusing every transport stops the fetch itself. */
    GIT_ALLOW_PROTOCOL: 'none',
    /** State-document names come from config: never git pathspec magic. */
    GIT_LITERAL_PATHSPECS: '1',
    /** Replace refs would change the history this check reports. */
    GIT_NO_REPLACE_OBJECTS: '1',
};
class GitMissingError extends Error {
}
class GitOutputError extends Error {
}
function git(cwd, args, opts = {}) {
    try {
        return execFileSync('git', [...SAFE_CONFIG, ...args], {
            cwd,
            encoding: 'utf8',
            timeout: GIT_TIMEOUT_MS,
            maxBuffer: opts.maxBuffer ?? GIT_MAX_BUFFER,
            stdio: ['pipe', 'pipe', 'pipe'],
            input: opts.input ?? '',
            env: { ...process.env, ...SAFE_ENV },
        });
    }
    catch (err) {
        if (err.code === 'ENOENT')
            throw new GitMissingError('git not installed');
        throw err;
    }
}
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
/** `:oldmode newmode sha sha STATUS` (and the combined-diff form `::m m m sha sha sha SS`). Never a file name: names are consumed as the token after one. */
const RAW_HEADER_RE = /^:+[0-7]{6}(?: [0-7]{6})* [0-9a-f]{4,64}(?: [0-9a-f]{4,64})* [A-Z]+[0-9]*$/;
export function isGitSha(s) {
    return SHA_RE.test(s);
}
/** Tokens of NUL-terminated output. The output must be empty or end with NUL. */
function nulTokens(out) {
    if (out === '')
        return [];
    if (!out.endsWith('\0'))
        throw new GitOutputError('output is not NUL-terminated');
    return out.slice(0, -1).split('\0');
}
/** `git log -z --no-patch --format=%H%x00%cI%x00%s`: strict triples. */
function parseCommitTriples(out) {
    const t = nulTokens(out);
    if (t.length % 3 !== 0)
        throw new GitOutputError('commit records are not complete triples');
    const seen = new Set();
    const commits = [];
    for (let i = 0; i < t.length; i += 3) {
        const [sha, date, subject] = [t[i], t[i + 1], t[i + 2]];
        if (!SHA_RE.test(sha))
            throw new GitOutputError('a commit id is not a valid object name');
        if (!DATE_RE.test(date))
            throw new GitOutputError('a commit date is not an ISO-8601 date');
        if (seen.has(sha))
            throw new GitOutputError('a commit appears twice');
        seen.add(sha);
        commits.push({ sha, date, subject });
    }
    return commits;
}
/**
 * `git diff-tree --stdin -z --raw`: `<sha> NUL` then zero or more
 * `<:raw-header> NUL <path> NUL`. A path is only ever read as the token after a
 * raw header, so no file name (spaces, newlines, control characters, even a
 * 40-hex string) can be mistaken for a commit id or a header. Commits without
 * changes (clean merges, empty commits) may be absent; order must be preserved.
 */
function parseFileLists(out, expected, prefix) {
    const t = nulTokens(out);
    const files = new Map();
    let next = 0; // index into `expected` the next sha must be at or after
    let i = 0;
    while (i < t.length) {
        const sha = t[i++];
        const at = SHA_RE.test(sha) ? expected.indexOf(sha, next) : -1;
        if (at === -1)
            throw new GitOutputError('a file list belongs to an unexpected or out-of-order commit');
        next = at + 1;
        const list = [];
        while (i < t.length && t[i].startsWith(':')) {
            if (!RAW_HEADER_RE.test(t[i]) || i + 1 >= t.length)
                throw new GitOutputError('a raw diff entry is malformed');
            // `--relative` is ignored for combined (merge) entries, which start with `::`: make them project-relative here.
            if (t[i].startsWith('::')) {
                if (t[i + 1].startsWith(prefix))
                    list.push(t[i + 1].slice(prefix.length));
            }
            else
                list.push(t[i + 1]);
            i += 2;
        }
        files.set(sha, list);
    }
    return files;
}
/**
 * @param targetDir project directory (git is run from here; paths are relative to it)
 * @param stateFiles state documents, relative to `targetDir`. Only existing ones need be passed.
 */
export function readGitSignals(targetDir, stateFiles) {
    try {
        const inside = git(targetDir, ['rev-parse', '--is-inside-work-tree']).trim();
        if (inside !== 'true')
            return { status: 'unavailable', reason: 'NOT_A_GIT_REPOSITORY' };
    }
    catch (err) {
        if (err instanceof GitMissingError)
            return { status: 'unavailable', reason: 'GIT_NOT_INSTALLED' };
        const stderr = String(err.stderr ?? '');
        return { status: 'unavailable', reason: /not a git repository/i.test(stderr) ? 'NOT_A_GIT_REPOSITORY' : 'GIT_FAILED' };
    }
    try {
        // A repository without commits has no HEAD: nothing to compare with.
        let head;
        try {
            head = git(targetDir, ['rev-parse', '--verify', '--quiet', 'HEAD']).trim();
        }
        catch {
            return { status: 'ok', lastStateUpdate: null, commitsSince: [], truncated: false };
        }
        if (!SHA_RE.test(head))
            throw new GitOutputError('HEAD did not resolve to an object name');
        // A shallow clone has no history before its boundary: "no later commit" proves nothing.
        const shallowOut = git(targetDir, ['rev-parse', '--is-shallow-repository']).trim();
        if (shallowOut !== 'true' && shallowOut !== 'false')
            throw new GitOutputError('unexpected shallow-repository answer');
        const shallow = shallowOut === 'true';
        let lastStateUpdate = null;
        if (stateFiles.length > 0) {
            const t = nulTokens(git(targetDir, ['log', '-1', '-z', '--no-patch', '--format=%H%x00%cI', head, '--', ...stateFiles]));
            if (t.length !== 0) {
                if (t.length !== 2 || !SHA_RE.test(t[0]) || !DATE_RE.test(t[1]))
                    throw new GitOutputError('the last state update is not a valid record');
                lastStateUpdate = { sha: t[0], date: t[1] };
            }
        }
        if (!lastStateUpdate)
            return { status: 'ok', lastStateUpdate: null, commitsSince: [], truncated: false, shallow };
        const range = `${lastStateUpdate.sha}..${head}`;
        const limit = `-n${MAX_COMMITS_SINCE + 1}`;
        const commits = parseCommitTriples(git(targetDir, ['log', '-z', '--no-patch', limit, '--format=%H%x00%cI%x00%s', range]));
        // Independent cross-check of the commit list: same range, no free text in the output.
        const listed = nulTokens(git(targetDir, ['rev-list', '-z', limit, range]));
        if (listed.length !== commits.length || listed.some((s, k) => s !== commits[k].sha)) {
            throw new GitOutputError('the commit list disagrees with git rev-list');
        }
        let fileLists = new Map();
        if (commits.length > 0) {
            const prefix = git(targetDir, ['rev-parse', '--show-prefix']).replace(/\n$/, '');
            const raw = git(targetDir, ['diff-tree', '--stdin', '-z', '-r', '--raw', '-c', '--root', '--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--relative'], { input: `${commits.map((c) => c.sha).join('\n')}\n` });
            fileLists = parseFileLists(raw, commits.map((c) => c.sha), prefix);
        }
        const signals = commits.map((c) => ({ sha: c.sha, date: c.date, subject: c.subject, files: fileLists.get(c.sha) ?? [] }));
        const truncated = signals.length > MAX_COMMITS_SINCE;
        return { status: 'ok', lastStateUpdate, commitsSince: signals.slice(0, MAX_COMMITS_SINCE), truncated, shallow };
    }
    catch (err) {
        return { status: 'unavailable', reason: err instanceof GitOutputError ? 'GIT_OUTPUT_INVALID' : 'GIT_FAILED' };
    }
}
/**
 * Contents of `relPath` (relative to `targetDir`) as of commit `sha`, or null
 * when the file does not exist there, is larger than `MAX_BLOB_BYTES`, is not
 * available locally (a partial clone's missing blob is NOT fetched) or cannot be
 * read. `git cat-file` only: read-only, no textconv, no shell. Used by KA-001 to
 * judge an idea registration as it was when the commit was made.
 */
export function readBlobAt(targetDir, sha, relPath) {
    if (!SHA_RE.test(sha) || relPath.includes('\0') || relPath.startsWith('-'))
        return null;
    const spec = `${sha}:./${relPath}`;
    try {
        const size = git(targetDir, ['cat-file', '-s', spec]).trim();
        if (!/^\d{1,9}$/.test(size) || Number(size) > MAX_BLOB_BYTES)
            return null;
        return git(targetDir, ['cat-file', 'blob', spec], { maxBuffer: MAX_BLOB_BYTES + 1024 });
    }
    catch {
        return null;
    }
}
