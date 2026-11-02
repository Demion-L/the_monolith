/**
 * Deterministic story finalization (DOCSYNC-001, ADR-022).
 *
 * `planFinalization` is read-only: it validates a proposal against the
 * instance, evaluates explicit preconditions (PASS / FAIL / NOT_VERIFIED),
 * classifies every write target and returns a digest that binds an owner's
 * approval to exactly what was inspected. `applyFinalization` re-plans under a
 * cross-process lock and writes only if the digest still matches.
 *
 * Consistency model (narrower than a transaction, deliberately): there is no
 * rollback. Targets are written one at a time in a fixed order with `active.md`
 * LAST, every write is an atomic single-file publish (src/root safe-write), and
 * each target has a deterministic "already done" predicate. An interruption
 * leaves a state that `planFinalization` reports as partial and that re-running
 * plan + apply rolls forward; success is only reported after a post-write
 * re-read of every target. See ADR-022.
 *
 * Reused, not reimplemented: safe reads/writes and containment (src/root),
 * the cross-process lock (src/coordinatorium/lock), the Current Story section
 * extractor of `monolith brief` (src/brief/story).
 */
import { createHash } from 'crypto';
import { constants as fsc, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { RootContainmentError, SafeWriteError, createFile, openParent, projectBoundary, readConfigFile, readProjectFile, replaceFile, resolveMonolithRoot, } from '../root/index.js';
import { acquireLock } from '../coordinatorium/lock.js';
import { extractCurrentStory } from '../brief/story.js';
import { hasLookalikeIdToken, hasStoryIdToken, validDate, validateRelPath } from './proposal.js';
const MAX_DOC_BYTES = 4 * 1024 * 1024;
const LOCK_NAME = 'finalize.lock';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const norm = (s) => s.replace(/\r\n/g, '\n');
export function readFinalizeConfig(config) {
    const out = { requiredDocs: [], allowedDocs: [], errors: [] };
    if (config.status !== 'ok')
        return out;
    const f = config.cfg.finalization;
    if (f === undefined)
        return out;
    if (typeof f !== 'object' || f === null || Array.isArray(f)) {
        out.errors.push('finalization must be an object.');
        return out;
    }
    const rec = f;
    for (const k of Object.keys(rec))
        if (k !== 'requiredDocs' && k !== 'allowedDocs')
            out.errors.push(`finalization.${k}: unknown field.`);
    if (rec.requiredDocs !== undefined) {
        if (!Array.isArray(rec.requiredDocs))
            out.errors.push('finalization.requiredDocs must be an array of {path, label}.');
        else {
            rec.requiredDocs.forEach((d, i) => {
                const o = d;
                const bad = typeof o === 'object' && o !== null ? validateRelPath(o.path) : 'entry must be an object';
                if (bad !== null || typeof o?.label !== 'string')
                    out.errors.push(`finalization.requiredDocs[${i}]: ${bad ?? 'label must be a string'}.`);
                else
                    out.requiredDocs.push({ path: o.path, label: o.label });
            });
        }
    }
    if (rec.allowedDocs !== undefined) {
        if (!Array.isArray(rec.allowedDocs))
            out.errors.push('finalization.allowedDocs must be an array of paths.');
        else {
            rec.allowedDocs.forEach((p, i) => {
                const bad = validateRelPath(p);
                if (bad !== null)
                    out.errors.push(`finalization.allowedDocs[${i}]: ${bad}.`);
                else
                    out.allowedDocs.push(p);
            });
        }
    }
    return out;
}
function readDoc(projectRoot, rel) {
    const r = readProjectFile(projectRoot, rel, { allowEmpty: true, strictUtf8: true, maxBytes: MAX_DOC_BYTES });
    if (r.ok)
        return { kind: 'present', content: r.content, sha: sha(r.content) };
    if (r.code === 'FILE_MISSING')
        return { kind: 'missing' };
    return { kind: 'unreadable', code: r.code, detail: r.detail };
}
// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function bullets(items) {
    return items.length === 0 ? 'None' : items.map((i) => `- ${i}`).join('\n');
}
export function renderCapsule(p) {
    const s = p.story;
    const w = p.work;
    return [
        '---',
        'type: story-capsule',
        `id: story-${s.id.toLowerCase()}`,
        `phase: ${s.phase}`,
        `title: ${JSON.stringify(s.title)}`,
        `date: ${s.date}`,
        'status: COMPLETED',
        '---',
        '',
        `# STORY ${s.id} — ${s.title}`,
        '',
        '## Objective',
        w.objective,
        '',
        '## Implementation Summary',
        w.implementationSummary,
        '',
        '## Files Changed',
        bullets(w.filesChanged),
        '',
        '## Tests',
        w.tests,
        '',
        '## Key Decisions',
        w.keyDecisions,
        '',
        '## ADRs Written',
        bullets(w.adrs),
        '',
        '## Lessons Learned',
        w.lessons,
        '',
    ].join('\n');
}
const capsulePathOf = (root, p) => `${root}/memory/working/phases/${p.story.phase}/stories/${p.story.slug}.md`;
function historyHeading(p) {
    return `## ${p.story.id} — ${p.story.title} (${p.story.date})`;
}
function historyFragment(root, p) {
    return [
        historyHeading(p),
        '',
        `**Phase:** ${p.history.phaseName}`,
        `**Decision:** ${p.history.decision}`,
        `**Build:** ${p.history.build}`,
        `**Capsule:** \`${capsulePathOf(root, p)}\``,
    ].join('\n');
}
function indexHeading(p) {
    return `### ${p.story.id} — ${p.story.title}`;
}
function indexFragment(root, p) {
    return [
        indexHeading(p),
        '',
        `**Date:** ${p.story.date}`,
        '**Status:** COMPLETED',
        `**Capsule:** \`${capsulePathOf(root, p)}\``,
        '',
        `**Summary:** ${p.summary}`,
        '',
        `**Key outputs:** ${p.keyOutputs.length === 0 ? 'None' : p.keyOutputs.join(', ')}`,
        '',
        '---',
    ].join('\n');
}
function activeBodies(root, p) {
    const s = p.story;
    return {
        current: `No active story recorded.\n\nPrevious recorded story: **${s.id} — ${s.title}** (COMPLETED ${s.date})`,
        last: `**Story:** ${s.id} — ${s.title}\n**Date:** ${s.date}\n**Capsule:** \`${capsulePathOf(root, p)}\``,
    };
}
// ---------------------------------------------------------------------------
// Text transforms (pure)
// ---------------------------------------------------------------------------
const eolOf = (s) => (s.includes('\r\n') ? '\r\n' : '\n');
/** Boundaries as in brief/story.ts: the next heading or a `---` rule ends a section. */
function findSection(lines, re) {
    const hits = [];
    lines.forEach((l, i) => {
        if (re.test(l.trim()))
            hits.push(i);
    });
    if (hits.length === 0)
        return 'absent';
    if (hits.length > 1)
        return 'ambiguous';
    let end = lines.length;
    for (let i = hits[0] + 1; i < lines.length; i++) {
        const t = lines[i].trim();
        if (/^#{1,6}\s+/.test(t) || /^-{3,}\s*$/.test(t)) {
            end = i;
            break;
        }
    }
    return { start: hits[0], end };
}
const sectionBody = (lines, s) => lines
    .slice(s.start + 1, s.end)
    .map((l) => l.replace(/\r$/, ''))
    .join('\n')
    .trim();
const CURRENT_RE = /^##\s+Current Story\s*$/i;
const LAST_RE = /^##\s+Last Finalization\s*$/i;
function editActive(content, bodies) {
    const lines = content.split('\n');
    const cur = findSection(lines, CURRENT_RE);
    const last = findSection(lines, LAST_RE);
    for (const [name, s] of [['## Current Story', cur], ['## Last Finalization', last]]) {
        if (s === 'absent')
            return { state: 'conflict', reason: `active.md has no "${name}" section; it is never created automatically.` };
        if (s === 'ambiguous')
            return { state: 'conflict', reason: `active.md has more than one "${name}" section.` };
    }
    const c = cur;
    const l = last;
    if (sectionBody(lines, c) === bodies.current && sectionBody(lines, l) === bodies.last)
        return { state: 'done' };
    const eol = eolOf(content);
    const cr = eol === '\r\n' ? '\r' : '';
    const fill = (body) => [cr, ...body.split('\n').map((x) => x + cr), cr];
    const out = lines.slice();
    const ordered = [[c, bodies.current], [l, bodies.last]];
    ordered.sort((a, b) => b[0].start - a[0].start);
    for (const [sec, body] of ordered)
        out.splice(sec.start + 1, sec.end - sec.start - 1, ...fill(body));
    return { state: 'pending', content: out.join('\n') };
}
/**
 * Structural identity of an entry: a heading line `<level> <story id> — …`
 * (id compared case-insensitively, the em dash separator is part of the
 * contract). Title, slug and date are NOT part of the identity, so a repeat
 * with different wording is found instead of being appended again.
 */
function entryHeadings(content, level, id) {
    const prefix = `${level} ${id.toLowerCase()} — `;
    return norm(content)
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.toLowerCase().startsWith(prefix));
}
function checkRecorded(content, level, id, heading, fragment, where) {
    const hits = entryHeadings(content, level, id);
    if (hits.length > 1)
        return { state: 'conflict', reason: `story ${id} is already recorded ${hits.length} times in ${where}; one story has one finalization.` };
    if (hits.length === 1) {
        return hits[0] === heading && norm(content).includes(fragment)
            ? { state: 'done' }
            : { state: 'conflict', reason: `story ${id} is already recorded in ${where} ("${hits[0].slice(0, 120)}") with different content; one story has one finalization and recorded entries are never edited.` };
    }
    return null;
}
function editAppendEntry(content, id, heading, fragment) {
    const recorded = checkRecorded(content, '##', id, heading, fragment, 'execution-history.md');
    if (recorded)
        return recorded;
    const eol = eolOf(content);
    const body = content.replace(/\s+$/, '');
    return { state: 'pending', content: `${body}${eol}${eol}---${eol}${eol}${fragment.replace(/\n/g, eol)}${eol}` };
}
function editIndex(content, phaseHeading, id, heading, fragment) {
    const recorded = checkRecorded(content, '###', id, heading, fragment, 'story-index.md');
    if (recorded)
        return recorded;
    const eol = eolOf(content);
    const lines = content.split('\n').map((l) => l.replace(/\r$/, ''));
    const hits = lines.map((l, i) => (l.trim() === `## ${phaseHeading}` ? i : -1)).filter((i) => i >= 0);
    if (hits.length > 1)
        return { state: 'conflict', reason: `phase heading "## ${phaseHeading}" appears more than once.` };
    const fragLines = fragment.split('\n');
    if (hits.length === 0) {
        const body = content.replace(/\s+$/, '');
        return { state: 'pending', content: `${body}${eol}${eol}## ${phaseHeading}${eol}${eol}${fragLines.join(eol)}${eol}` };
    }
    let j = lines.length;
    for (let i = hits[0] + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) {
            j = i;
            break;
        }
    }
    const before = lines.slice(0, j);
    while (before.length > 0 && before[before.length - 1].trim() === '')
        before.pop();
    const after = lines.slice(j);
    const out = [...before, '', ...fragLines, '', ...after];
    return { state: 'pending', content: out.join(eol) };
}
/** Evidence older than this many days before the finalization date is not accepted. */
export const EVIDENCE_MAX_AGE_DAYS = 7;
/** Lines `**Field:** value` at the start of a line (CR tolerant). */
function fieldLines(content, field) {
    const re = new RegExp(`^\\*\\*${field}:\\*\\*[ \\t]*(.*)$`, 'gm');
    return [...content.matchAll(re)].map((m) => m[1].replace(/\r$/, '').trim());
}
/**
 * Attested evidence. Contract: exactly one `**Status:**` (PASS or FAIL, nothing
 * else on the line), exactly one `**Story:**` whose FIRST token is the story id,
 * exactly one valid `**Date:**` not after the finalization date and at most
 * EVIDENCE_MAX_AGE_DAYS before it. Anything repeated, contradictory or
 * malformed is NOT_VERIFIED (never PASS); only a single clean `FAIL` for this
 * story is FAIL. This is still the assistant's own report: it ties the claim to
 * a story and a date, not to a commit, and nobody here ran the tests.
 */
function evidenceCheck(ctx, p, id, label, file) {
    const rel = `${ctx.root}/memory/working/${file}`;
    const source = `${rel} (attested by the assistant that ran the ${label} step; MONOLITH does not execute it)`;
    const nv = (detail, sha) => ({ check: { id, status: 'NOT_VERIFIED', detail, source }, sha });
    const d = readDoc(ctx.projectRoot, rel);
    if (d.kind === 'missing')
        return nv(`${rel} does not exist; ${label} was not recorded.`, 'ABSENT');
    if (d.kind === 'unreadable')
        return nv(`${rel} is unreadable (${d.code}).`, 'UNREADABLE');
    const stories = fieldLines(d.content, 'Story');
    if (stories.length !== 1)
        return nv(`expected exactly one "**Story:**" line, found ${stories.length}; ambiguous evidence is not evidence for ${p.story.id}.`, d.sha);
    const first = /^(\S+)(?:\s|$)/.exec(stories[0])?.[1];
    if (first !== p.story.id)
        return nv(`the recorded result is for another story ("${stories[0].slice(0, 120)}"), not ${p.story.id}; the first token of the Story line must be exactly the story id.`, d.sha);
    const statuses = fieldLines(d.content, 'Status');
    if (statuses.length !== 1)
        return nv(`expected exactly one "**Status:**" line, found ${statuses.length}${statuses.length > 1 ? ` (${statuses.map((x) => x.slice(0, 20)).join(' / ')}): contradictory or repeated` : ''}.`, d.sha);
    const dates = fieldLines(d.content, 'Date');
    if (dates.length !== 1 || !validDate(dates[0]))
        return nv(`expected exactly one valid "**Date:** YYYY-MM-DD" line, found ${dates.length === 1 ? `"${dates[0].slice(0, 30)}"` : dates.length}.`, d.sha);
    const ageDays = (Date.parse(`${p.story.date}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 86_400_000;
    if (ageDays < 0)
        return nv(`the recorded result is dated ${dates[0]}, after the finalization date ${p.story.date}.`, d.sha);
    if (ageDays > EVIDENCE_MAX_AGE_DAYS)
        return nv(`the recorded result is dated ${dates[0]}, more than ${EVIDENCE_MAX_AGE_DAYS} days before ${p.story.date}; it is stale. Re-run and re-record it.`, d.sha);
    const status = statuses[0].toUpperCase();
    if (status === 'PASS')
        return { check: { id, status: 'PASS', detail: `recorded Status: PASS for ${p.story.id} on ${dates[0]}.`, source }, sha: d.sha };
    if (status === 'FAIL')
        return { check: { id, status: 'FAIL', detail: `recorded Status: FAIL for ${p.story.id} on ${dates[0]}.`, source }, sha: d.sha };
    return nv(`the Status line must be exactly PASS or FAIL, found "${statuses[0].slice(0, 40)}".`, d.sha);
}
const MAX_CAPSULE_SCAN = 2000;
/**
 * Other capsules of the same story id (frontmatter line `id: story-<id>`),
 * found by scanning `phases/<any>/stories/*.md` with the safe reader. Symlinked
 * directories/files are not followed. A file that cannot be read safely cannot
 * be shown to be a different story, so it is reported (fail closed).
 */
function findOtherCapsules(ctx, p, ownPath) {
    const phasesRel = `${ctx.root}/memory/working/phases`;
    const wanted = `id: story-${p.story.id.toLowerCase()}`;
    const found = [];
    let scanned = 0;
    let phases = [];
    try {
        phases = readdirSync(join(ctx.projectRoot, phasesRel), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    }
    catch {
        return found;
    }
    for (const ph of phases.sort()) {
        let files = [];
        try {
            files = readdirSync(join(ctx.projectRoot, phasesRel, ph, 'stories'), { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name);
        }
        catch {
            continue;
        }
        for (const f of files.sort()) {
            const rel = `${phasesRel}/${ph}/stories/${f}`;
            if (rel === ownPath)
                continue;
            if (++scanned > MAX_CAPSULE_SCAN) {
                found.push(`(more than ${MAX_CAPSULE_SCAN} capsules: cannot rule out another capsule of this story)`);
                return found;
            }
            const d = readDoc(ctx.projectRoot, rel);
            if (d.kind === 'unreadable') {
                found.push(`${rel} (unreadable: ${d.code}; cannot rule out that it is this story)`);
                continue;
            }
            if (d.kind !== 'present')
                continue;
            const lines = norm(d.content).split('\n');
            if (lines[0]?.trim() !== '---')
                continue;
            for (let i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
                if (lines[i].trim().toLowerCase() === wanted) {
                    found.push(rel);
                    break;
                }
            }
        }
    }
    return found;
}
const STAGING_RE = (name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.tmp\\.\\d+\\.[0-9a-f]{16}$`);
/**
 * Explains a hard-linked capsule. `createFile` publishes with link(2) and then
 * removes its staging name; a process killed in between leaves the capsule with
 * a second name. Nothing is ever deleted here: this only reports whether the
 * second name looks like exactly that residue, so the OWNER can remove it by
 * hand. Without a journal the origin cannot be proven (anyone can create a
 * file with such a name), so the verdict is deliberately worded as "consistent
 * with", and any deviation is reported as not recoverable.
 */
function diagnoseCapsuleResidue(ctx, rel, expected) {
    const generic = 'the capsule has more than one hard link, so it is not trusted. Nothing was changed. Do not delete anything unless you have verified the other link yourself.';
    try {
        const abs = join(ctx.projectRoot, rel);
        const dir = dirname(abs);
        const name = rel.slice(rel.lastIndexOf('/') + 1);
        const st = lstatSync(abs, { bigint: true });
        if (!st.isFile() || st.nlink !== 2n)
            return `${generic} (link count ${st.nlink}, not exactly 2.)`;
        const fd = openSync(abs, fsc.O_RDONLY | fsc.O_NOFOLLOW);
        let content;
        try {
            const fst = fstatSync(fd, { bigint: true });
            if (fst.ino !== st.ino || fst.dev !== st.dev)
                return `${generic} (the file changed while being inspected.)`;
            content = readFileSync(fd, 'utf8');
        }
        finally {
            closeSync(fd);
        }
        if (content !== expected)
            return `${generic} (its content differs from what this proposal would create, so it is not this operation's staging residue.)`;
        const twins = readdirSync(dir)
            .filter((n) => STAGING_RE(name).test(n))
            .filter((n) => {
            const t = lstatSync(join(dir, n), { bigint: true });
            return t.isFile() && !t.isSymbolicLink() && t.ino === st.ino && t.dev === st.dev;
        });
        if (twins.length !== 1)
            return `${generic} (found ${twins.length} matching staging names, expected exactly 1.)`;
        const twinRel = `${dirname(rel)}/${twins[0]}`;
        return `consistent with an interrupted create (the process stopped after link(), before removing its staging name): the second name is "${twinRel}", same file, identical content, no other links. Owner recovery, taking care to remove ONLY that staging name: rm -- '${twinRel}' — then run \`monolith finalize plan\` again. MONOLITH never deletes it automatically because the origin of a hard link cannot be proven.`;
    }
    catch (err) {
        return `${generic} (could not be inspected: ${err.message}.)`;
    }
}
function buildInternals(ctx, p) {
    const out = [];
    const r = ctx.root;
    // capsule — created, never overwritten
    {
        const path = capsulePathOf(r, p);
        const content = renderCapsule(p);
        const d = readDoc(ctx.projectRoot, path);
        const t = { id: 'capsule', kind: 'capsule', path, state: 'pending', reason: 'will be created', base: 'ABSENT' };
        const others = findOtherCapsules(ctx, p, path);
        if (others.length > 0) {
            out.push({ target: { ...t, state: 'conflict', reason: `story ${p.story.id} already has a capsule elsewhere (${others.join(', ')}); a second capsule is never created`, base: d.kind === 'present' ? d.sha : 'ABSENT' } });
        }
        else if (d.kind === 'missing')
            out.push({ target: { ...t, preview: content }, write: { mode: 'create', content, baseSha: null } });
        else if (d.kind === 'unreadable') {
            const why = d.code === 'FILE_HARDLINKED' ? `${d.code}: ${diagnoseCapsuleResidue(ctx, path, content)}` : `${d.code}: ${d.detail}`;
            out.push({ target: { ...t, state: 'unreadable', reason: why, base: 'UNREADABLE' } });
        }
        else if (d.content === content)
            out.push({ target: { ...t, state: 'done', reason: 'capsule already present with identical content', base: 'DONE' } });
        else
            out.push({ target: { ...t, state: 'conflict', reason: 'a different file already exists at the capsule path; it is never overwritten', base: d.sha } });
    }
    const textTarget = (id, kind, path, edit, preview, missingReason) => {
        const d = readDoc(ctx.projectRoot, path);
        const t = { id, kind, path, state: 'pending', reason: '', base: 'ABSENT' };
        if (d.kind === 'missing') {
            out.push({ target: { ...t, state: 'missing', reason: missingReason } });
            return;
        }
        if (d.kind === 'unreadable') {
            out.push({ target: { ...t, state: 'unreadable', reason: `${d.code}: ${d.detail}`, base: 'UNREADABLE' } });
            return;
        }
        const e = edit(d.content);
        if (e.state === 'done')
            out.push({ target: { ...t, state: 'done', reason: 'already in its final state', base: 'DONE' } });
        else if (e.state === 'conflict')
            out.push({ target: { ...t, state: 'conflict', reason: e.reason, base: d.sha } });
        else
            out.push({ target: { ...t, reason: 'will be updated', base: d.sha, preview }, write: { mode: 'replace', content: e.content, baseSha: d.sha } });
    };
    textTarget('execution-history', 'execution-history', `${r}/memory/long-term/execution-history.md`, (c) => editAppendEntry(c, p.story.id, historyHeading(p), historyFragment(r, p)), historyFragment(r, p), 'execution-history.md does not exist; it is never created automatically');
    textTarget('story-index', 'story-index', `${r}/memory/working/story-index.md`, (c) => editIndex(c, p.story.phaseHeading, p.story.id, indexHeading(p), indexFragment(r, p)), indexFragment(r, p), 'story-index.md does not exist; it is never created automatically');
    for (const [i, u] of (p.docUpdates ?? []).entries()) {
        const allowed = new Set([...ctx.config.requiredDocs.map((x) => x.path), ...ctx.config.allowedDocs]);
        const id = `doc:${i}`;
        if (!allowed.has(u.path)) {
            out.push({ target: { id, kind: 'doc', path: u.path, state: 'conflict', reason: 'path is not an allowed write target (monolith.config.json finalization.requiredDocs / allowedDocs)', base: 'ABSENT' } });
            continue;
        }
        textTarget(id, 'doc', u.path, (c) => (c === u.newContent ? { state: 'done' } : { state: 'pending', content: u.newContent }), `(${Buffer.byteLength(u.newContent)} bytes, sha256 ${sha(u.newContent).slice(0, 12)}…) ${u.reason}`, 'document does not exist; it is never created automatically');
    }
    if (p.handoff) {
        const content = p.handoff.content;
        textTarget('handoff', 'handoff', `${r}/context/boot/HANDOFF.md`, (c) => (c === content ? { state: 'done' } : { state: 'pending', content }), `(full replacement, ${Buffer.byteLength(content)} bytes, sha256 ${sha(content).slice(0, 12)}…)`, 'HANDOFF.md does not exist; it is never created automatically');
    }
    const bodies = activeBodies(r, p);
    textTarget('active', 'active', `${r}/memory/working/active.md`, (c) => editActive(c, bodies), `## Current Story ← ${bodies.current.split('\n')[0]} …\n## Last Finalization ← ${bodies.last.split('\n')[0]} …`, 'active.md does not exist; it is never created automatically');
    // two targets must never share a path (a doc update cannot alias a canonical file)
    const seen = new Map();
    for (const it of out) {
        const prior = seen.get(it.target.path);
        if (prior !== undefined) {
            it.target.state = 'conflict';
            it.target.reason = `path is also the target "${prior}"`;
            delete it.write;
        }
        else
            seen.set(it.target.path, it.target.id);
    }
    return out;
}
function makeContext(targetDir) {
    let config;
    try {
        config = readConfigFile(targetDir);
    }
    catch (err) {
        return { error: `cannot read monolith.config.json: ${err.message}` };
    }
    let resolved;
    try {
        resolved = resolveMonolithRoot(targetDir, config);
    }
    catch (err) {
        if (err instanceof RootContainmentError)
            return { error: `${err.code}: ${err.message}` };
        throw err;
    }
    const fc = readFinalizeConfig(config);
    return { ctx: { projectRoot: resolved.projectRoot, root: resolved.monolithRoot, config: fc, configProblem: fc.errors.length > 0 ? fc.errors.join(' ') : null } };
}
function refusedPlan(p, message) {
    return {
        status: 'NOT_READY',
        storyId: p.story.id,
        digest: '',
        partial: false,
        checks: [{ id: 'instance', status: 'FAIL', detail: message, source: 'monolith.config.json' }],
        targets: [],
        diagnostics: [message],
    };
}
function plan(ctx, p) {
    const internals = buildInternals(ctx, p);
    const targets = internals.map((i) => i.target);
    const checks = [];
    const diagnostics = [];
    if (ctx.configProblem !== null)
        checks.push({ id: 'config', status: 'FAIL', detail: ctx.configProblem, source: 'monolith.config.json' });
    else if (ctx.config.requiredDocs.length === 0)
        diagnostics.push('finalization.requiredDocs is not configured in monolith.config.json: no documents were required.');
    const bad = targets.filter((t) => t.state === 'conflict' || t.state === 'missing' || t.state === 'unreadable');
    checks.push(bad.length === 0
        ? { id: 'targets', status: 'PASS', detail: `${targets.length} write target(s) are inside the instance, regular files and applicable.`, source: 'MONOLITH (safe read, containment, no symlinks)' }
        : { id: 'targets', status: 'FAIL', detail: bad.map((t) => `${t.id} [${t.state}]: ${t.reason}`).join(' | '), source: 'MONOLITH (safe read, containment, no symlinks)' });
    const active = targets.find((t) => t.id === 'active');
    if (active?.state === 'done') {
        checks.push({ id: 'expected-state', status: 'PASS', detail: 'active.md is already in its final state.', source: 'MONOLITH' });
    }
    else {
        const d = readDoc(ctx.projectRoot, `${ctx.root}/memory/working/active.md`);
        const exp = p.expectedCurrentStory;
        if (d.kind !== 'present')
            checks.push({ id: 'expected-state', status: 'FAIL', detail: 'active.md could not be read.', source: 'MONOLITH' });
        else {
            const ex = extractCurrentStory(d.content);
            const excerpt = ex.excerpt ?? '';
            let ok;
            let want;
            if (exp === 'none')
                (ok = ex.hasCurrentStorySection && /no active story/i.test(excerpt)), (want = 'no active story');
            else
                (ok = excerpt.includes(exp.contains) && hasStoryIdToken(excerpt, p.story.id) && !hasLookalikeIdToken(excerpt, p.story.id)), (want = `Current Story containing "${exp.contains}" and naming story ${p.story.id} as a whole id`);
            checks.push({ id: 'expected-state', status: ok ? 'PASS' : 'FAIL', detail: ok ? `Current Story matches the expected state: ${want}.` : `Current Story does not match the expected state: ${want}.`, source: 'MONOLITH (brief Current Story extraction)' });
        }
    }
    const reqShas = [];
    if (ctx.config.requiredDocs.length > 0) {
        const problems = [];
        for (const rd of ctx.config.requiredDocs) {
            const d = readDoc(ctx.projectRoot, rd.path);
            if (d.kind === 'missing')
                (problems.push(`${rd.path} (${rd.label}): MISSING`), reqShas.push(`${rd.path}:ABSENT`));
            else if (d.kind === 'unreadable')
                (problems.push(`${rd.path} (${rd.label}): UNREADABLE ${d.code}`), reqShas.push(`${rd.path}:UNREADABLE`));
            else
                reqShas.push(`${rd.path}:${d.sha}`);
        }
        checks.push(problems.length === 0
            ? { id: 'required-docs', status: 'PASS', detail: `${ctx.config.requiredDocs.length} required document(s) exist and are readable.`, source: 'monolith.config.json finalization.requiredDocs' }
            : { id: 'required-docs', status: 'FAIL', detail: problems.join('; '), source: 'monolith.config.json finalization.requiredDocs' });
    }
    const integrity = evidenceCheck(ctx, p, 'integrity', 'integrity verification', 'integrity-result.md');
    const governance = evidenceCheck(ctx, p, 'governance', 'governance evaluation', 'governance-result.md');
    checks.push(integrity.check, governance.check);
    const allDone = targets.length > 0 && targets.every((t) => t.state === 'done');
    const someDone = targets.some((t) => t.state === 'done');
    const ready = checks.every((c) => c.status === 'PASS');
    const status = allDone ? 'ALREADY_FINALIZED' : ready ? 'READY' : 'NOT_READY';
    const digest = sha(JSON.stringify({
        v: 1,
        proposal: p,
        root: ctx.root,
        targets: targets.map((t) => [t.id, t.path, t.state, t.base]),
        required: reqShas,
        evidence: [integrity.sha, governance.sha],
        config: [ctx.config.requiredDocs, ctx.config.allowedDocs],
    }));
    return { plan: { status, storyId: p.story.id, digest, partial: someDone && !allDone, checks, targets, diagnostics }, internals };
}
export function planFinalization(targetDir, proposal) {
    const c = makeContext(targetDir);
    if ('error' in c)
        return refusedPlan(proposal, c.error);
    return plan(c.ctx, proposal).plan;
}
// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------
function refused(p, pl, msg) {
    return { status: 'REFUSED', storyId: p.story.id, plan: pl, applied: [], pending: pl.targets.filter((t) => t.state !== 'done').map((t) => t.id), diagnostics: [msg] };
}
export async function applyFinalization(targetDir, proposal, approvedDigest, opts = {}) {
    const c = makeContext(targetDir);
    if ('error' in c)
        return refused(proposal, refusedPlan(proposal, c.error), c.error);
    const { ctx } = c;
    const boundary = projectBoundary(ctx.projectRoot);
    let release = null;
    try {
        const workingAbs = join(ctx.projectRoot, ctx.root, 'memory', 'working');
        const lockParent = openParent(boundary, workingAbs, { ops: opts.ops });
        release = await acquireLock(join(workingAbs, LOCK_NAME), { timeoutMs: 10_000, ...opts.lock }, {}, lockParent);
    }
    catch (err) {
        const msg = `cannot take the finalization lock (another finalization may be running, or this is not an instance): ${err.message}`;
        return refused(proposal, plan(ctx, proposal).plan, msg);
    }
    try {
        const { plan: pl, internals } = plan(ctx, proposal);
        if (pl.status === 'ALREADY_FINALIZED') {
            return { status: 'ALREADY_FINALIZED', storyId: proposal.story.id, plan: pl, applied: [], pending: [], diagnostics: ['Every target is already in its final state; nothing was written.'] };
        }
        if (pl.status !== 'READY')
            return refused(proposal, pl, 'Preconditions are not satisfied; nothing was written.');
        if (approvedDigest !== pl.digest) {
            return refused(proposal, pl, 'STALE: the approved digest does not match the current state (a document, the evidence or the proposal changed since the plan was approved). Run `monolith finalize plan` again and re-approve; nothing was written.');
        }
        const order = ['capsule', 'execution-history', 'story-index', 'doc', 'handoff', 'active'];
        const todo = internals.filter((i) => i.write !== undefined).sort((a, b) => order.indexOf(a.target.kind) - order.indexOf(b.target.kind));
        const applied = [];
        for (const it of todo) {
            const w = it.write;
            const t = it.target;
            try {
                if (w.mode === 'replace') {
                    const cur = readDoc(ctx.projectRoot, t.path);
                    if (cur.kind !== 'present' || cur.sha !== w.baseSha) {
                        throw new SafeWriteError(`${t.path} changed between planning and writing; refusing to overwrite it.`, { code: 'WRITE_TARGET_EXISTS', phase: 'validate', publication: 'NOT_PUBLISHED', path: t.path });
                    }
                }
                const parent = openParent(boundary, join(ctx.projectRoot, dirname(t.path)), { create: t.kind === 'capsule', ops: opts.ops });
                const name = t.path.slice(t.path.lastIndexOf('/') + 1);
                const wo = { mode: 0o666, exactMode: false, durability: 'full', maxBytes: MAX_DOC_BYTES, ops: opts.ops };
                const outcome = w.mode === 'create' ? createFile(parent, name, w.content, wo) : replaceFile(parent, name, w.content, wo);
                for (const warn of outcome.warnings)
                    opts.onWarning?.(warn);
                applied.push(t.id);
            }
            catch (err) {
                const pending = todo.filter((x) => !applied.includes(x.target.id)).map((x) => x.target.id);
                const msg = err instanceof Error ? err.message : String(err);
                const publication = err instanceof SafeWriteError ? err.publication : undefined;
                const nothing = applied.length === 0 && publication === 'NOT_PUBLISHED';
                return {
                    status: nothing ? 'REFUSED' : 'INCOMPLETE',
                    storyId: proposal.story.id,
                    plan: pl,
                    applied,
                    pending,
                    failed: { target: t.id, message: msg, publication },
                    diagnostics: [
                        nothing
                            ? 'The first write failed before anything was published; nothing changed.'
                            : `Finalization stopped after ${applied.length} of ${todo.length} write(s). The story is NOT finalized. Fix the cause, then run \`monolith finalize plan\` (it reports the partial state) and apply the new digest to roll forward.`,
                    ],
                };
            }
        }
        const after = plan(ctx, proposal).plan;
        const notDone = after.targets.filter((t) => t.state !== 'done');
        if (notDone.length > 0) {
            return {
                status: 'INCOMPLETE',
                storyId: proposal.story.id,
                plan: after,
                applied,
                pending: notDone.map((t) => t.id),
                diagnostics: [`Post-write verification failed: ${notDone.map((t) => `${t.id} [${t.state}] ${t.reason}`).join('; ')}. The story is NOT reported as finalized.`],
            };
        }
        return { status: 'FINALIZED', storyId: proposal.story.id, plan: after, applied, pending: [], diagnostics: ['All targets were written and re-read in their final state.'] };
    }
    finally {
        try {
            release?.();
        }
        catch {
            /* the lock helper reports its own residue; the outcome above is already decided */
        }
    }
}
