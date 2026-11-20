/**
 * Verification evidence (ACCOUNTABILITY-001, Phase 4).
 *
 * One small JSON file per recorded check in `<monolithRoot>/memory/long-term/verification/EVD-NNNN.json`
 * (git-tracked project knowledge, like ideas). It is the minimal structure the existing sources cannot
 * represent: no mission, checkpoint or capsule field records *which command ran, with what result, at
 * which revision*. It is NOT a telemetry framework and NOT part of the Durable State schema or finalize.
 *
 * Provenance vocabulary (this module's own, deliberately narrow):
 *  - REPORTED — somebody (an agent) stated the result. MONOLITH did not observe it.
 *  - OBSERVED — `monolith evidence run` executed the command itself and captured its exit status.
 *  - VERIFIED is never stored. It is a verdict computed at read time (see `classifyEvidence`):
 *    an OBSERVED pass whose recorded revision still equals HEAD on a clean working tree. It means the
 *    stated command passed at this revision — not that the command is adequate, nor that the project is correct.
 *
 * What is NOT stored: command output (only the exit status), environment, or anything not listed in
 * `EvidenceRecord`. Command lines and notes are redacted for obvious secrets; redaction is best effort.
 */
import { readdirSync } from 'fs';
import { join } from 'path';
import { sanitizeSingleLine } from '../brief/sanitize.js';
import { SafeWriteError, assertContainedFile, createFile, openParent, projectBoundary, readBoundedFile, resolveMonolithRoot, } from '../root/index.js';
import { STORY_ID_RE } from '../coordinatorium/types.js';
import { changedBetween } from './git.js';
export const EVIDENCE_REL = 'memory/long-term/verification';
export const EVIDENCE_SCHEMA = 1;
export const MAX_EVIDENCE_FILE_BYTES = 8 * 1024;
export const MAX_EVIDENCE_RECORDS = 500;
export const MAX_COMMAND_CHARS = 500;
export const MAX_NOTE_CHARS = 500;
const EVD_NAME_RE = /^(EVD-\d{4,9})\.json$/;
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
export class EvidenceError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'EvidenceError';
    }
}
// ---------------------------------------------------------------------------
// Redaction (best effort, deterministic)
// ---------------------------------------------------------------------------
const REDACTIONS = [
    [/(--?[A-Za-z0-9_-]*(?:token|secret|passw(?:or)?d|api[-_]?key|auth|credential)[A-Za-z0-9_-]*)(=|\s+)\S+/gi, '$1$2[REDACTED]'],
    [/\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSW(?:OR)?D|API_?KEY|AUTH|CREDENTIAL)[A-Za-z0-9_]*)=\S+/gi, '$1=[REDACTED]'],
    [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
    [/\b(?:sk|pk|ghp|gho|ghu|ghs|github_pat|xox[abprs]|AKIA)[-_A-Za-z0-9]{12,}/g, '[REDACTED]'],
    [/(\/\/[^\s/:@]+:)[^\s/@]+@/g, '$1[REDACTED]@'],
    [/\b[A-Za-z0-9_+-]{40,}\b/g, '[REDACTED]'],
];
export function redact(s) {
    let out = s;
    for (const [re, to] of REDACTIONS)
        out = out.replace(re, to);
    return out;
}
function cleanText(s, max) {
    const one = sanitizeSingleLine(redact(s)).trim();
    return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}
// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Strict parse: anything that is not exactly an `EvidenceRecord` is rejected (`null`), never repaired. */
export function parseEvidence(text, expectedId) {
    let v;
    try {
        v = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (!isObj(v) || v.schema !== EVIDENCE_SCHEMA || v.id !== expectedId)
        return null;
    const str = (x) => typeof x === 'string';
    if (!(v.storyId === null || (str(v.storyId) && STORY_ID_RE.test(v.storyId))))
        return null;
    if (!str(v.command) || v.command.length > MAX_COMMAND_CHARS)
        return null;
    if (v.result !== 'pass' && v.result !== 'fail')
        return null;
    if (!(v.exitCode === null || (typeof v.exitCode === 'number' && Number.isInteger(v.exitCode))))
        return null;
    if (v.provenance !== 'REPORTED' && v.provenance !== 'OBSERVED')
        return null;
    if (v.source !== 'monolith evidence run' && v.source !== 'monolith evidence report')
        return null;
    if (!str(v.recordedAt) || Number.isNaN(Date.parse(v.recordedAt)))
        return null;
    if (!(v.gitHead === null || (str(v.gitHead) && SHA_RE.test(v.gitHead))))
        return null;
    if (!(v.dirty === null || typeof v.dirty === 'boolean'))
        return null;
    if (!(v.note === null || (str(v.note) && v.note.length <= MAX_NOTE_CHARS)))
        return null;
    if (!(v.durationMs === null || (typeof v.durationMs === 'number' && v.durationMs >= 0)))
        return null;
    // An OBSERVED record must carry an exit status that agrees with its result; a REPORTED one never claims one.
    if (v.provenance === 'OBSERVED' && (v.exitCode === null || (v.exitCode === 0) !== (v.result === 'pass')))
        return null;
    if (v.provenance === 'REPORTED' && v.exitCode !== null)
        return null;
    return v;
}
function serialize(r) {
    return `${JSON.stringify(r, null, 2)}\n`;
}
export function evidenceStore(projectRoot) {
    const root = resolveMonolithRoot(projectRoot);
    assertContainedFile(root, EVIDENCE_REL);
    return { projectRoot: root.projectRoot, monolithRoot: root.monolithRoot, dirRel: `${root.monolithRoot}/${EVIDENCE_REL}`, dirAbs: join(root.rootAbs, EVIDENCE_REL) };
}
function evdNumber(id) {
    return Number(id.slice(4));
}
function scanIds(dirAbs) {
    let names;
    try {
        names = readdirSync(dirAbs);
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return [];
        throw err;
    }
    const ids = [];
    for (const n of names) {
        const m = EVD_NAME_RE.exec(n);
        if (m !== null)
            ids.push(m[1]);
    }
    return ids.sort((a, b) => evdNumber(a) - evdNumber(b));
}
export function validateNewEvidence(input) {
    const bad = (m) => {
        throw new EvidenceError('EVIDENCE_INVALID_INPUT', m);
    };
    if (input.storyId !== null && !STORY_ID_RE.test(input.storyId))
        bad('Invalid story id.');
    if (input.command.trim() === '')
        bad('The command must not be empty.');
    if (input.provenance === 'OBSERVED' && (input.exitCode === null || (input.exitCode === 0) !== (input.result === 'pass')))
        bad('An observed record needs an exit code consistent with its result.');
    if (input.provenance === 'REPORTED' && input.exitCode !== null)
        bad('A reported record cannot carry an exit code.');
    if (input.gitHead !== null && !SHA_RE.test(input.gitHead))
        bad('Invalid git revision.');
}
/** Creates exactly one new file; never overwrites. Ids come from exclusive creation, so concurrent writers cannot collide. */
export function addEvidence(store, input, opts = {}) {
    validateNewEvidence(input);
    let parent;
    try {
        parent = openParent(projectBoundary(store.projectRoot), store.dirAbs, { create: true });
    }
    catch (err) {
        if (err instanceof SafeWriteError)
            throw new EvidenceError('EVIDENCE_UNSAFE_PATH', err.message);
        throw err;
    }
    const recordedAt = (opts.now ?? (() => new Date()))().toISOString();
    for (let attempt = 0; attempt < 64; attempt++) {
        const ids = scanIds(store.dirAbs);
        const next = (ids.length === 0 ? 0 : evdNumber(ids[ids.length - 1])) + 1;
        const id = `EVD-${String(next).padStart(4, '0')}`;
        const record = {
            schema: EVIDENCE_SCHEMA,
            id,
            storyId: input.storyId,
            command: cleanText(input.command, MAX_COMMAND_CHARS),
            result: input.result,
            exitCode: input.exitCode,
            provenance: input.provenance,
            source: input.provenance === 'OBSERVED' ? 'monolith evidence run' : 'monolith evidence report',
            recordedAt,
            gitHead: input.gitHead,
            dirty: input.dirty,
            note: input.note === null ? null : cleanText(input.note, MAX_NOTE_CHARS),
            durationMs: input.durationMs,
        };
        try {
            createFile(parent, `${id}.json`, serialize(record), { mode: 0o666, exactMode: false, durability: 'full', maxBytes: MAX_EVIDENCE_FILE_BYTES });
            return record;
        }
        catch (err) {
            if (err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS')
                continue;
            if (err instanceof SafeWriteError)
                throw new EvidenceError('EVIDENCE_UNSAFE_PATH', err.message);
            throw err;
        }
    }
    throw new EvidenceError('EVIDENCE_ID_EXHAUSTED', 'Could not allocate an evidence id; nothing was written.');
}
/** Read-only. Never throws on bad data: a bad file is listed as unreadable, not guessed at. */
export function listEvidence(projectRoot) {
    let store;
    try {
        store = evidenceStore(projectRoot);
    }
    catch {
        return { records: [], unreadable: [], absent: true, truncated: false };
    }
    let ids;
    try {
        ids = scanIds(store.dirAbs);
    }
    catch {
        return { records: [], unreadable: [{ id: 'EVD-0000', code: 'EVIDENCE_UNSAFE_PATH' }], absent: false, truncated: false };
    }
    let absent = false;
    try {
        readdirSync(store.dirAbs);
    }
    catch {
        absent = true;
    }
    const truncated = ids.length > MAX_EVIDENCE_RECORDS;
    const take = truncated ? ids.slice(ids.length - MAX_EVIDENCE_RECORDS) : ids;
    const records = [];
    const unreadable = [];
    for (const id of take) {
        const read = readBoundedFile(join(store.dirAbs, `${id}.json`), id, { boundary: store.projectRoot, maxBytes: MAX_EVIDENCE_FILE_BYTES }, true);
        if (!read.ok) {
            unreadable.push({ id, code: read.code === 'FILE_MISSING' ? 'EVIDENCE_CORRUPT' : 'EVIDENCE_UNSAFE_PATH' });
            continue;
        }
        const rec = parseEvidence(read.content, id);
        if (rec === null)
            unreadable.push({ id, code: 'EVIDENCE_CORRUPT' });
        else
            records.push(rec);
    }
    return { records, unreadable, absent, truncated };
}
export function assessFreshness(rec, view, changed) {
    if (!view.available || view.head === null)
        return { freshness: 'UNKNOWN', reason: 'NO_GIT' };
    if (rec.gitHead === null)
        return { freshness: 'UNKNOWN', reason: 'NO_RECORDED_REVISION' };
    let sameFiles = rec.gitHead === view.head;
    let evidenceOnly = false;
    if (!sameFiles) {
        const diff = changed(rec.gitHead, view.head);
        if (diff === null)
            return { freshness: 'UNKNOWN', reason: 'REVISION_UNREACHABLE' };
        if (diff.length > 0)
            return { freshness: 'POTENTIALLY_STALE', reason: 'HEAD_CHANGED' };
        sameFiles = true;
        evidenceOnly = true;
    }
    if (rec.dirty !== false)
        return { freshness: rec.dirty === true ? 'REVISION_MATCH_DIRTY' : 'UNKNOWN', reason: rec.dirty === true ? 'DIRTY_AT_RECORD' : 'TREE_STATE_UNKNOWN' };
    if (view.dirty === null)
        return { freshness: 'UNKNOWN', reason: 'TREE_STATE_UNKNOWN' };
    if (view.dirty)
        return { freshness: 'REVISION_MATCH_DIRTY', reason: 'DIRTY_NOW' };
    return { freshness: 'REVISION_MATCH', reason: evidenceOnly ? 'HEAD_MATCH_EVIDENCE_ONLY_CHANGES' : 'HEAD_MATCH_CLEAN' };
}
export function classifyEvidence(rec, a) {
    if (rec.result === 'fail')
        return 'FAILED';
    if (a.freshness === 'POTENTIALLY_STALE')
        return 'STALE';
    if (rec.provenance === 'REPORTED')
        return 'REPORTED';
    if (a.freshness === 'REVISION_MATCH')
        return 'VERIFIED';
    return 'UNKNOWN';
}
export function assessAll(projectRoot, records, view, excludeRels) {
    const cache = new Map();
    const changed = (from, to) => {
        const k = `${from}..${to}`;
        if (!cache.has(k))
            cache.set(k, changedBetween(projectRoot, from, to, excludeRels));
        return cache.get(k) ?? null;
    };
    return records.map((record) => {
        const a = assessFreshness(record, view, changed);
        return { record, freshness: a.freshness, reason: a.reason, level: classifyEvidence(record, a) };
    });
}
