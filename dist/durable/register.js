/**
 * The persisted prune decision register: record formats and the pure derivation of the prune state.
 *
 * Design A (docs/architecture/DURABLE-PRUNE-PROTOCOL-DESIGN-004.md, sections 5, 19, 20, 32, 37, 41; ADR-019).
 * This module does no I/O of its own. `derivePruneState` is a function of the names in the task directory and of what
 * `RegisterIO` returns for them, so its decisions can be tested with injected partial listings and I/O errors
 * without a filesystem. It never writes, never deletes and never repairs.
 *
 * Every verdict is fail-closed: `corrupt`, `unreadable`, `missing` and `legacy` never grant an irreversible action,
 * and a missing name is never read as permission to delete anything (section 37, "absence of information is not
 * permission").
 */
import { canonicalize, sha256Hex } from './canonical.js';
import { MAX_PRUNE_ATTEMPTS } from './types.js';
export { MAX_PRUNE_ATTEMPTS };
/** Re-checks of the register by a writer that has published a file (Design A, section 24.2). */
export const MAX_WRITE_RESOLVE = 3;
/** A register record is tiny; anything larger is refused before it is read. */
export const MAX_REGISTER_BYTES = 64 * 1024;
export const REGISTER_FORMAT_VERSION = 2;
/**
 * Staging files of the write primitive: `<name>.tmp.<pid>.<hex16>`. The ONE definition: the filesystem store uses it
 * for its own temp names too (Design A, section 20.2, N1), so the register can never mistake a staging file for a record.
 */
export const STAGING_RE = /^(.+)\.tmp\.\d+\.[0-9a-f]{16}$/;
const PREPARE_RE = /^prune-([1-9][0-9]{0,8})\.prepare\.json$/;
const DECISION_RE = /^prune-([1-9][0-9]{0,8})\.decision\.json$/;
export const TOMBSTONE_FILE = 'tombstone.json';
export const PROTOCOL_MARKER_FILE = 'durable-protocol.json';
export const prepareFile = (n) => `prune-${n}.prepare.json`;
export const decisionFile = (n) => `prune-${n}.decision.json`;
const DECISION_BY = ['pruner', 'child', 'creator', 'claim', 'append', 'compact', 'pin'];
const TASK_STATUSES = ['active', 'completed', 'failed', 'cancelled'];
const withoutCheck = (r) => {
    const { check: _check, ...rest } = r;
    return rest;
};
/** SHA-256 of the canonical serialization of every other field: a guard against accidental damage, not against an adversary. */
export function checkOf(record) {
    return sha256Hex(canonicalize(withoutCheck(record)));
}
export function encodePrepare(attempt, tombstone) {
    const body = { v: REGISTER_FORMAT_VERSION, attempt, tombstone };
    return `${canonicalize({ ...body, check: checkOf(body) })}\n`;
}
export function encodeDecision(attempt, outcome, tombstone, by) {
    const body = outcome === 'commit'
        ? { v: REGISTER_FORMAT_VERSION, attempt, outcome, tombstone: tombstone }
        : { v: REGISTER_FORMAT_VERSION, attempt, outcome, ...(by ? { by } : {}) };
    return `${canonicalize({ ...body, check: checkOf(body) })}\n`;
}
/** The `tombstone.json` file published from a commit. Same content, any reader of the v1 format understands it. */
export function encodeTombstone(tombstone) {
    return `${canonicalize(tombstone)}\n`;
}
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const TOMBSTONE_KEYS = ['v', 'taskId', 'kind', 'finalStatus', 'createdAt', 'closedAt', 'prunedAt', 'headSeq', 'headHash', 'outcomeDigest'];
/** Closed schema of a v1 tombstone. `null` when it is anything else. */
export function asTombstone(v, taskId) {
    if (!isObj(v))
        return null;
    const keys = Object.keys(v);
    if (keys.length !== TOMBSTONE_KEYS.length || !TOMBSTONE_KEYS.every((k) => keys.includes(k)))
        return null;
    const str = (k) => typeof v[k] === 'string';
    if (v.v !== 1 || v.taskId !== taskId)
        return null;
    if (!['kind', 'createdAt', 'closedAt', 'prunedAt', 'headHash', 'outcomeDigest'].every(str))
        return null;
    if (typeof v.finalStatus !== 'string' || !TASK_STATUSES.includes(v.finalStatus))
        return null;
    if (typeof v.headSeq !== 'number' || !Number.isInteger(v.headSeq) || v.headSeq < 0)
        return null;
    return v;
}
/** Same tombstone, whatever the key order. */
export const sameTombstone = (a, b) => canonicalize(a) === canonicalize(b);
function parseCanonical(text) {
    const body = text.endsWith('\n') ? text.slice(0, -1) : text;
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        return undefined;
    }
    // Written canonically by us. Re-serializing and comparing refuses duplicate keys, a BOM, odd whitespace and any other
    // spelling the strict reader did not produce itself.
    try {
        return canonicalize(parsed) === body ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
export function parsePrepare(text, n, taskId) {
    const o = parseCanonical(text);
    if (!isObj(o))
        return { k: 'bad', reason: 'not-canonical-json' };
    const keys = Object.keys(o).sort().join(',');
    if (keys !== 'attempt,check,tombstone,v')
        return { k: 'bad', reason: 'schema' };
    if (o.v !== REGISTER_FORMAT_VERSION)
        return { k: 'bad', reason: 'version' };
    if (o.attempt !== n)
        return { k: 'bad', reason: 'attempt' };
    const tomb = asTombstone(o.tombstone, taskId);
    if (!tomb)
        return { k: 'bad', reason: 'tombstone' };
    if (o.check !== checkOf(o))
        return { k: 'bad', reason: 'check' };
    return { k: 'ok', v: o };
}
export function parseDecision(text, n, taskId) {
    const o = parseCanonical(text);
    if (!isObj(o))
        return { k: 'bad', reason: 'not-canonical-json' };
    if (o.v !== REGISTER_FORMAT_VERSION)
        return { k: 'bad', reason: 'version' };
    if (o.attempt !== n)
        return { k: 'bad', reason: 'attempt' };
    const keys = Object.keys(o);
    const allowed = o.outcome === 'abort'
        ? ['v', 'attempt', 'outcome', 'by', 'check']
        : o.outcome === 'commit'
            ? ['v', 'attempt', 'outcome', 'tombstone', 'migrated', 'legacySha256', 'check']
            : null;
    if (!allowed)
        return { k: 'bad', reason: 'outcome' };
    if (keys.some((k) => !allowed.includes(k)) || !['v', 'attempt', 'outcome', 'check'].every((k) => keys.includes(k)))
        return { k: 'bad', reason: 'schema' };
    if (o.outcome === 'abort') {
        if ('by' in o && !DECISION_BY.includes(o.by))
            return { k: 'bad', reason: 'by' };
    }
    else {
        if (!asTombstone(o.tombstone, taskId))
            return { k: 'bad', reason: 'tombstone' };
        const hasM = 'migrated' in o;
        const hasS = 'legacySha256' in o;
        if (hasM !== hasS || (hasM && (o.migrated !== true || typeof o.legacySha256 !== 'string' || !/^[0-9a-f]{64}$/.test(o.legacySha256)))) {
            return { k: 'bad', reason: 'migration' };
        }
    }
    if (o.check !== checkOf(o))
        return { k: 'bad', reason: 'check' };
    return { k: 'ok', v: o };
}
/** `tombstone.json` is the v1 format and is written by older code with its own key order: parse leniently, validate strictly. */
export function parseTombstoneFile(text, taskId) {
    let o;
    try {
        o = JSON.parse(text);
    }
    catch {
        return { k: 'bad', reason: 'not-json' };
    }
    const t = asTombstone(o, taskId);
    return t ? { k: 'ok', v: t } : { k: 'bad', reason: 'schema' };
}
class Unstable extends Error {
}
function classify(names) {
    const c = { prep: new Set(), dec: new Set(), tomb: false, unknown: [] };
    for (const name of names) {
        if (STAGING_RE.test(name))
            continue; // N1: a staging file is never interpreted, whatever its base name
        let m = PREPARE_RE.exec(name);
        if (m) {
            c.prep.add(Number(m[1]));
            continue;
        }
        m = DECISION_RE.exec(name);
        if (m) {
            c.dec.add(Number(m[1]));
            continue;
        }
        if (name === TOMBSTONE_FILE) {
            c.tomb = true;
            continue;
        }
        if (name.startsWith('prune-'))
            c.unknown.push(name); // N5
    }
    return c;
}
const maxOf = (...sets) => {
    let m = 0;
    for (const s of sets)
        for (const n of s)
            if (n > m)
                m = n;
    return m;
};
const corrupt = (reason, file, attempt, basis = 'present') => ({
    kind: 'corrupt',
    reason,
    basis,
    ...(file ? { file } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
});
const unreadable = (reason) => ({ kind: 'unreadable', reason });
class Known {
    io;
    prep;
    dec;
    tomb;
    unknown;
    cache = new Map();
    constructor(c, io) {
        this.io = io;
        this.prep = new Set(c.prep);
        this.dec = new Set(c.dec);
        this.tomb = c.tomb;
        this.unknown = c.unknown;
    }
    /** A name that was listed must still be there: a name that vanished is not damage and not permission (it is "unstable"). */
    seen(key, read) {
        let o = this.cache.get(key);
        if (!o) {
            o = read();
            this.cache.set(key, o);
        }
        if (o.k === 'absent')
            throw new Unstable();
        return o;
    }
    readPrepare(n) {
        return this.seen(`p${n}`, () => this.io.prepare(n));
    }
    readDecision(n) {
        return this.seen(`d${n}`, () => this.io.decision(n));
    }
    readTombstone() {
        return this.seen('t', () => this.io.tombstone());
    }
    /** Look a name up that was NOT in the listing (A8: a lookup sees every name published before it started). */
    lookup(kind, n) {
        const key = `${kind}${n}`;
        let o = this.cache.get(key);
        if (!o) {
            o = kind === 'p' ? this.io.prepare(n) : this.io.decision(n);
            if (o.k !== 'absent')
                this.cache.set(key, o);
        }
        return o;
    }
    add(kind, n) {
        (kind === 'p' ? this.prep : this.dec).add(n);
    }
}
const ioName = (kind, n) => (kind === 't' ? TOMBSTONE_FILE : kind === 'p' ? prepareFile(n) : decisionFile(n));
function foldCommit(K, k, commit) {
    // (b1) A record with an index above the commit cannot exist in a correct run, whatever it contains. Independent of any I/O error.
    for (const n of [...K.prep, ...K.dec])
        if (n > k)
            return { t: 'final', state: corrupt('history', undefined, n) };
    let prepFinding = null;
    let io = null;
    const absent = [];
    // (a) audit: prepare.k and tombstone.json (when present) must agree with the commit.
    if (K.prep.has(k)) {
        const p = K.readPrepare(k);
        if (p.k === 'ok') {
            if (!sameTombstone(p.v.tombstone, commit.tombstone))
                prepFinding = 'commit-audit';
        }
        else if (p.k === 'bad')
            prepFinding = 'commit-audit';
        else if (p.k === 'ioerr')
            io = io ?? `io:${ioName('p', k)}`;
    }
    else {
        absent.push({ reason: 'commit-audit', file: prepareFile(k) });
    }
    if (K.tomb) {
        const t = K.readTombstone();
        if (t.k === 'ok') {
            if (!sameTombstone(t.v, commit.tombstone))
                prepFinding = prepFinding ?? 'commit-audit';
        }
        else if (t.k === 'bad')
            prepFinding = prepFinding ?? 'commit-audit';
        else if (t.k === 'ioerr')
            io = io ?? `io:${TOMBSTONE_FILE}`;
    }
    // A finding that rests on a present, successfully read file stands whatever happens to the other inputs.
    if (prepFinding)
        return { t: 'final', state: corrupt(prepFinding, undefined, k) };
    // Otherwise an input whose value is unknown means the audit cannot be done: unreadable, not corrupt, not committed.
    if (io)
        return { t: 'final', state: unreadable(io) };
    // (b2) every name below k must be there. Their CONTENT is not read: damage below k does not undo a verified commit.
    for (let j = 1; j < k; j++) {
        if (!K.prep.has(j))
            absent.push({ reason: 'history', file: prepareFile(j) });
        else if (!K.dec.has(j))
            absent.push({ reason: 'history', file: decisionFile(j) });
    }
    if (absent.length > 0)
        return { t: 'absent', reason: absent[0].reason, file: absent[0].file, attempt: k };
    const anomalies = K.unknown.map((n) => `UNKNOWN_PRUNE:${n}`);
    return {
        t: 'final',
        state: {
            kind: 'committed',
            attempt: k,
            tombstone: commit.tombstone,
            durability: 'NOT_GUARANTEED',
            ...(commit.migrated ? { migrated: true } : {}),
            ...(anomalies.length ? { anomalies } : {}),
        },
    };
}
function foldNoCommit(K, decs, ioDecisions) {
    // IO-G1: any decision whose value is unknown may be the commit. No finding of steps 4-5 is established.
    if (ioDecisions.length > 0)
        return { t: 'final', state: unreadable(`io:${ioDecisions[0]}`) };
    const m = maxOf(K.prep);
    const prepObs = new Map();
    const ioOther = [];
    let bad = null;
    let badFile;
    const markBad = (reason, file) => {
        // fixed order of reasons: register > unknown-artifact > gap
        const rank = (r) => (r === 'register' ? 3 : r === 'unknown-artifact' ? 2 : r ? 1 : 0);
        if (rank(reason) > rank(bad)) {
            bad = reason;
            badFile = file;
        }
    };
    for (const n of [...K.prep].sort((a, b) => a - b)) {
        const p = K.readPrepare(n);
        prepObs.set(n, p);
        if (p.k === 'bad')
            markBad('register', prepareFile(n));
        else if (p.k === 'ioerr')
            ioOther.push(prepareFile(n));
    }
    for (const [n, d] of decs)
        if (d.k === 'bad')
            markBad('register', decisionFile(n));
    for (const u of K.unknown)
        markBad('unknown-artifact', u);
    let tombObs = null;
    if (K.tomb) {
        tombObs = K.readTombstone();
        if (tombObs.k === 'bad')
            markBad('register', TOMBSTONE_FILE);
        else if (tombObs.k === 'ioerr')
            ioOther.push(TOMBSTONE_FILE);
    }
    if (bad)
        return { t: 'final', state: corrupt(bad, badFile) };
    // Structure by NAME: absence findings (class A-bar).
    const gaps = [];
    for (let j = 1; j <= m; j++)
        if (!K.prep.has(j))
            gaps.push({ reason: 'gap', file: prepareFile(j), attempt: j });
    for (const j of K.dec)
        if (!K.prep.has(j))
            gaps.push({ reason: 'gap', file: decisionFile(j), attempt: j });
    for (let j = 1; j < m; j++)
        if (K.prep.has(j) && !K.dec.has(j))
            gaps.push({ reason: 'gap', file: decisionFile(j), attempt: j });
    if (K.tomb && m > 0)
        gaps.push({ reason: 'tombstone-without-commit', file: TOMBSTONE_FILE });
    const legacyCandidate = K.tomb && m === 0 && gaps.length === 0;
    if (K.tomb && m === 0 && gaps.length > 0)
        gaps.push({ reason: 'tombstone-without-commit', file: TOMBSTONE_FILE });
    if ((gaps.length > 0 || legacyCandidate) && ioOther.length > 0)
        return { t: 'final', state: unreadable(`io:${ioOther[0]}`) }; // IO-G2
    if (gaps.length > 0)
        return { t: 'absent', reason: gaps[0].reason, file: gaps[0].file, ...(gaps[0].attempt !== undefined ? { attempt: gaps[0].attempt } : {}) };
    if (legacyCandidate)
        return { t: 'legacy' };
    if (ioOther.length > 0)
        return { t: 'final', state: unreadable(`io:${ioOther[0]}`) };
    if (m === 0)
        return { t: 'final', state: { kind: 'live', attempt: 0 } };
    const last = decs.get(m);
    if (last && last.k === 'ok')
        return { t: 'final', state: { kind: 'live', attempt: m } };
    const prep = prepObs.get(m);
    return { t: 'final', state: { kind: 'preparing', attempt: m, tombstone: prep.v.tombstone } };
}
function fold(K) {
    const decs = new Map();
    const commits = [];
    const ioDecisions = [];
    for (const n of [...K.dec].sort((a, b) => a - b)) {
        const d = K.readDecision(n);
        decs.set(n, d);
        if (d.k === 'ok' && d.v.outcome === 'commit')
            commits.push(n);
        else if (d.k === 'ioerr')
            ioDecisions.push(decisionFile(n));
    }
    if (commits.length >= 2)
        return { t: 'final', state: corrupt('multiple-commit', decisionFile(commits[1]), commits[1]) };
    if (commits.length === 1) {
        const k = commits[0];
        return foldCommit(K, k, decs.get(k).v);
    }
    return foldNoCommit(K, decs, ioDecisions);
}
/** Names that the protocol says must exist because of `x` (Req(x), section 32.3). */
function expected(K, commitAttempt) {
    const out = new Set();
    for (const j of K.prep)
        for (let i = 1; i < j; i++) {
            out.add(`p${i}`);
            out.add(`d${i}`);
        }
    for (const j of K.dec) {
        for (let i = 1; i <= j; i++)
            out.add(`p${i}`);
        for (let i = 1; i < j; i++)
            out.add(`d${i}`);
    }
    if (K.tomb && commitAttempt !== null)
        for (let i = 1; i <= commitAttempt; i++) {
            out.add(`p${i}`);
            out.add(`d${i}`);
        }
    for (const j of K.prep)
        out.delete(`p${j}`);
    for (const j of K.dec)
        out.delete(`d${j}`);
    return out;
}
/**
 * The state of a task's register.
 *
 * `names` is ONE directory listing of `tasks/<id>/` (not an atomic snapshot: a name created during the listing may be
 * missing from it). `io` reads individual files. A verdict that rests only on names that were NOT in the listing is
 * not given without looking those names up (section 32.3); if the lookup finds the names the verdict is recomputed, if
 * every one is confirmed absent it stands with `basis: 'lookup'`, and if anything cannot be confirmed the answer is
 * `unreadable` — never a guess.
 */
export function derivePruneState(names, io, maxAttempts = MAX_PRUNE_ATTEMPTS) {
    const c = classify(names);
    // Fast path: nothing in the directory belongs to the register (staging files do not count).
    if (c.prep.size === 0 && c.dec.size === 0 && !c.tomb && c.unknown.length === 0)
        return { kind: 'live', attempt: 0 };
    const K = new Known(c, io);
    try {
        let v = fold(K);
        for (let round = 0; round < 2 && v.t !== 'final'; round++) {
            const commitAttempt = (() => {
                for (const n of K.dec) {
                    const d = K.lookup('d', n);
                    if (d.k === 'ok' && d.v.outcome === 'commit')
                        return n;
                }
                return null;
            })();
            const want = expected(K, commitAttempt);
            const ruleT = K.tomb && commitAttempt === null;
            if (want.size === 0 && !ruleT)
                return unreadable('register-observation-unstable');
            if (want.size > 2 * maxAttempts)
                return unreadable('register-observation-unstable');
            const found = [];
            const look = (kind, n) => {
                const o = K.lookup(kind, n);
                return o.k === 'absent' ? 'absent' : o.k === 'ioerr' ? 'ioerr' : 'found';
            };
            for (const e of want) {
                const kind = e[0];
                const n = Number(e.slice(1));
                const r = look(kind, n);
                if (r === 'ioerr')
                    return unreadable(`io-lookup:${ioName(kind, n)}`);
                if (r === 'found')
                    found.push([kind, n]);
            }
            if (ruleT) {
                // Rule T (and 004F, R4E-03: also when there is no register at all): the tombstone was published after a commit
                // of an attempt the listing did not show. Look for the decisions up to M, then walk the tail until the first
                // prepare that is absent.
                const M = maxOf(K.prep, K.dec);
                for (let j = 1; j <= M; j++) {
                    if (K.dec.has(j))
                        continue;
                    const r = look('d', j);
                    if (r === 'ioerr')
                        return unreadable(`io-lookup:${decisionFile(j)}`);
                    if (r === 'found' && !found.some((f) => f[0] === 'd' && f[1] === j))
                        found.push(['d', j]);
                }
                for (let j = M + 1; j <= maxAttempts; j++) {
                    if (K.prep.has(j)) {
                        // already known: only its decision can be new
                    }
                    else {
                        const r = look('p', j);
                        if (r === 'ioerr')
                            return unreadable(`io-lookup:${prepareFile(j)}`);
                        if (r === 'absent')
                            break;
                        found.push(['p', j]);
                    }
                    const rd = K.dec.has(j) ? 'known' : look('d', j);
                    if (rd === 'ioerr')
                        return unreadable(`io-lookup:${decisionFile(j)}`);
                    if (rd === 'found')
                        found.push(['d', j]);
                }
            }
            if (found.length === 0) {
                // Everything the protocol says must exist is confirmed absent: the finding is real.
                if (v.t === 'legacy') {
                    const t = K.readTombstone();
                    return { kind: 'legacy', basis: 'lookup', ...(t.k === 'ok' ? { tombstone: t.v } : {}) };
                }
                return corrupt(v.reason, v.file, v.attempt, 'lookup');
            }
            for (const [kind, n] of found)
                K.add(kind, n);
            v = fold(K);
        }
        if (v.t === 'final')
            return v.state;
        return unreadable('register-observation-unstable');
    }
    catch (e) {
        if (e instanceof Unstable)
            return unreadable('register-observation-unstable');
        throw e;
    }
}
