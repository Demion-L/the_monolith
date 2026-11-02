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
import { dirname, join } from 'path';
import {
  RootContainmentError,
  SafeWriteError,
  createFile,
  openParent,
  projectBoundary,
  readConfigFile,
  readProjectFile,
  replaceFile,
  resolveMonolithRoot,
  type ConfigRead,
  type FsOps,
  type WriteWarning,
} from '../root/index.js';
import { acquireLock, type LockOptions } from '../coordinatorium/lock.js';
import { extractCurrentStory } from '../brief/story.js';
import { validateRelPath, type FinalizationProposal } from './proposal.js';

export type CheckStatus = 'PASS' | 'FAIL' | 'NOT_VERIFIED';
export type TargetKind = 'capsule' | 'execution-history' | 'story-index' | 'doc' | 'handoff' | 'active';
export type TargetState = 'pending' | 'done' | 'conflict' | 'missing' | 'unreadable';
export type PlanStatus = 'READY' | 'NOT_READY' | 'ALREADY_FINALIZED';
export type ApplyStatus = 'FINALIZED' | 'ALREADY_FINALIZED' | 'REFUSED' | 'INCOMPLETE';

export interface Check {
  id: string;
  status: CheckStatus;
  detail: string;
  /** Where the verdict comes from (a MONOLITH computation vs. attested evidence). */
  source: string;
}

export interface PlannedTarget {
  id: string;
  kind: TargetKind;
  /** Project-relative, `/`-separated. */
  path: string;
  state: TargetState;
  reason: string;
  /** sha256 of the file as inspected, `ABSENT`, or `DONE`. Part of the digest. */
  base: string;
  /** What will be written/appended; omitted for done/blocked targets and for opaque documents. */
  preview?: string;
}

export interface FinalizationPlan {
  status: PlanStatus;
  storyId: string;
  /** Approval token: sha256 over the proposal, every target's state/base and the evidence inspected. */
  digest: string;
  /** True when some, but not all, targets are already in their final state (an earlier run was interrupted). */
  partial: boolean;
  checks: Check[];
  targets: PlannedTarget[];
  diagnostics: string[];
}

export interface ApplyResult {
  status: ApplyStatus;
  storyId: string;
  plan: FinalizationPlan;
  applied: string[];
  pending: string[];
  failed?: { target: string; message: string; publication?: string };
  diagnostics: string[];
}

export interface FinalizeOptions {
  /** Test-only fault injection for the safe-write primitives. */
  ops?: Partial<FsOps>;
  lock?: LockOptions;
  onWarning?: (w: WriteWarning) => void;
}

const MAX_DOC_BYTES = 4 * 1024 * 1024;
const LOCK_NAME = 'finalize.lock';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const norm = (s: string): string => s.replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------
// Config (`monolith.config.json` → finalization) — data only, never executed
// ---------------------------------------------------------------------------

export interface FinalizeConfig {
  requiredDocs: Array<{ path: string; label: string }>;
  allowedDocs: string[];
  errors: string[];
}

export function readFinalizeConfig(config: ConfigRead): FinalizeConfig {
  const out: FinalizeConfig = { requiredDocs: [], allowedDocs: [], errors: [] };
  if (config.status !== 'ok') return out;
  const f = config.cfg.finalization;
  if (f === undefined) return out;
  if (typeof f !== 'object' || f === null || Array.isArray(f)) {
    out.errors.push('finalization must be an object.');
    return out;
  }
  const rec = f as Record<string, unknown>;
  for (const k of Object.keys(rec)) if (k !== 'requiredDocs' && k !== 'allowedDocs') out.errors.push(`finalization.${k}: unknown field.`);
  if (rec.requiredDocs !== undefined) {
    if (!Array.isArray(rec.requiredDocs)) out.errors.push('finalization.requiredDocs must be an array of {path, label}.');
    else {
      rec.requiredDocs.forEach((d: unknown, i: number) => {
        const o = d as Record<string, unknown> | null;
        const bad = typeof o === 'object' && o !== null ? validateRelPath(o.path) : 'entry must be an object';
        if (bad !== null || typeof o?.label !== 'string') out.errors.push(`finalization.requiredDocs[${i}]: ${bad ?? 'label must be a string'}.`);
        else out.requiredDocs.push({ path: o.path as string, label: o.label });
      });
    }
  }
  if (rec.allowedDocs !== undefined) {
    if (!Array.isArray(rec.allowedDocs)) out.errors.push('finalization.allowedDocs must be an array of paths.');
    else {
      rec.allowedDocs.forEach((p: unknown, i: number) => {
        const bad = validateRelPath(p);
        if (bad !== null) out.errors.push(`finalization.allowedDocs[${i}]: ${bad}.`);
        else out.allowedDocs.push(p as string);
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// File access
// ---------------------------------------------------------------------------

type Doc = { kind: 'present'; content: string; sha: string } | { kind: 'missing' } | { kind: 'unreadable'; code: string; detail: string };

function readDoc(projectRoot: string, rel: string): Doc {
  const r = readProjectFile(projectRoot, rel, { allowEmpty: true, strictUtf8: true, maxBytes: MAX_DOC_BYTES });
  if (r.ok) return { kind: 'present', content: r.content, sha: sha(r.content) };
  if (r.code === 'FILE_MISSING') return { kind: 'missing' };
  return { kind: 'unreadable', code: r.code, detail: r.detail };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function bullets(items: string[]): string {
  return items.length === 0 ? 'None' : items.map((i) => `- ${i}`).join('\n');
}

export function renderCapsule(p: FinalizationProposal): string {
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

const capsulePathOf = (root: string, p: FinalizationProposal): string => `${root}/memory/working/phases/${p.story.phase}/stories/${p.story.slug}.md`;

function historyHeading(p: FinalizationProposal): string {
  return `## ${p.story.id} — ${p.story.title} (${p.story.date})`;
}
function historyFragment(root: string, p: FinalizationProposal): string {
  return [
    historyHeading(p),
    '',
    `**Phase:** ${p.history.phaseName}`,
    `**Decision:** ${p.history.decision}`,
    `**Build:** ${p.history.build}`,
    `**Capsule:** \`${capsulePathOf(root, p)}\``,
  ].join('\n');
}

function indexHeading(p: FinalizationProposal): string {
  return `### ${p.story.id} — ${p.story.title}`;
}
function indexFragment(root: string, p: FinalizationProposal): string {
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

function activeBodies(root: string, p: FinalizationProposal): { current: string; last: string } {
  const s = p.story;
  return {
    current: `No active story recorded.\n\nPrevious recorded story: **${s.id} — ${s.title}** (COMPLETED ${s.date})`,
    last: `**Story:** ${s.id} — ${s.title}\n**Date:** ${s.date}\n**Capsule:** \`${capsulePathOf(root, p)}\``,
  };
}

// ---------------------------------------------------------------------------
// Text transforms (pure)
// ---------------------------------------------------------------------------

const eolOf = (s: string): string => (s.includes('\r\n') ? '\r\n' : '\n');

type Section = { start: number; end: number };

/** Boundaries as in brief/story.ts: the next heading or a `---` rule ends a section. */
function findSection(lines: string[], re: RegExp): Section | 'absent' | 'ambiguous' {
  const hits: number[] = [];
  lines.forEach((l, i) => {
    if (re.test(l.trim())) hits.push(i);
  });
  if (hits.length === 0) return 'absent';
  if (hits.length > 1) return 'ambiguous';
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

const sectionBody = (lines: string[], s: Section): string =>
  lines
    .slice(s.start + 1, s.end)
    .map((l) => l.replace(/\r$/, ''))
    .join('\n')
    .trim();

const CURRENT_RE = /^##\s+Current Story\s*$/i;
const LAST_RE = /^##\s+Last Finalization\s*$/i;

type Edit = { state: 'done' } | { state: 'pending'; content: string } | { state: 'conflict'; reason: string };

function editActive(content: string, bodies: { current: string; last: string }): Edit {
  const lines = content.split('\n');
  const cur = findSection(lines, CURRENT_RE);
  const last = findSection(lines, LAST_RE);
  for (const [name, s] of [['## Current Story', cur], ['## Last Finalization', last]] as const) {
    if (s === 'absent') return { state: 'conflict', reason: `active.md has no "${name}" section; it is never created automatically.` };
    if (s === 'ambiguous') return { state: 'conflict', reason: `active.md has more than one "${name}" section.` };
  }
  const c = cur as Section;
  const l = last as Section;
  if (sectionBody(lines, c) === bodies.current && sectionBody(lines, l) === bodies.last) return { state: 'done' };
  const eol = eolOf(content);
  const cr = eol === '\r\n' ? '\r' : '';
  const fill = (body: string): string[] => [cr, ...body.split('\n').map((x) => x + cr), cr];
  const out = lines.slice();
  const ordered: Array<[Section, string]> = [[c, bodies.current], [l, bodies.last]];
  ordered.sort((a, b) => b[0].start - a[0].start);
  for (const [sec, body] of ordered) out.splice(sec.start + 1, sec.end - sec.start - 1, ...fill(body));
  return { state: 'pending', content: out.join('\n') };
}

function editAppendEntry(content: string, heading: string, fragment: string): Edit {
  const n = norm(content);
  const headingCount = n.split('\n').filter((l) => l.trim() === heading).length;
  if (headingCount > 1) return { state: 'conflict', reason: `"${heading}" is already recorded more than once.` };
  if (headingCount === 1) {
    return n.includes(fragment)
      ? { state: 'done' }
      : { state: 'conflict', reason: `"${heading}" is already recorded with different content; append-only entries are never edited.` };
  }
  const eol = eolOf(content);
  const body = content.replace(/\s+$/, '');
  return { state: 'pending', content: `${body}${eol}${eol}---${eol}${eol}${fragment.replace(/\n/g, eol)}${eol}` };
}

function editIndex(content: string, phaseHeading: string, heading: string, fragment: string): Edit {
  const n = norm(content);
  const count = n.split('\n').filter((l) => l.trim() === heading).length;
  if (count > 1) return { state: 'conflict', reason: `"${heading}" appears more than once in the story index.` };
  if (count === 1) {
    return n.includes(fragment) ? { state: 'done' } : { state: 'conflict', reason: `"${heading}" is already in the story index with different content.` };
  }
  const eol = eolOf(content);
  const lines = content.split('\n').map((l) => l.replace(/\r$/, ''));
  const hits = lines.map((l, i) => (l.trim() === `## ${phaseHeading}` ? i : -1)).filter((i) => i >= 0);
  if (hits.length > 1) return { state: 'conflict', reason: `phase heading "## ${phaseHeading}" appears more than once.` };
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
  while (before.length > 0 && before[before.length - 1].trim() === '') before.pop();
  const after = lines.slice(j);
  const out = [...before, '', ...fragLines, '', ...after];
  return { state: 'pending', content: out.join(eol) };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

interface Internal {
  target: PlannedTarget;
  /** Present when pending: how to write. */
  write?: { mode: 'create' | 'replace'; content: string; baseSha: string | null };
}

interface Context {
  projectRoot: string;
  root: string; // monolithRoot (relative)
  config: FinalizeConfig;
  configProblem: string | null;
}

function evidenceCheck(ctx: Context, p: FinalizationProposal, id: string, label: string, file: string): { check: Check; sha: string } {
  const rel = `${ctx.root}/memory/working/${file}`;
  const source = `${rel} (attested by the assistant that ran the ${label} step; MONOLITH does not execute it)`;
  const d = readDoc(ctx.projectRoot, rel);
  if (d.kind === 'missing') return { check: { id, status: 'NOT_VERIFIED', detail: `${rel} does not exist; ${label} was not recorded.`, source }, sha: 'ABSENT' };
  if (d.kind === 'unreadable') return { check: { id, status: 'NOT_VERIFIED', detail: `${rel} is unreadable (${d.code}).`, source }, sha: 'UNREADABLE' };
  const status = /^\*\*Status:\*\*\s*([A-Za-z_]+)/m.exec(d.content)?.[1]?.toUpperCase();
  const storyLine = /^\*\*Story:\*\*\s*(.+)$/m.exec(d.content)?.[1] ?? '';
  const esc = p.story.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentions = new RegExp(`(^|[^A-Za-z0-9._-])${esc}($|[^A-Za-z0-9._-])`, 'i').test(storyLine);
  if (!mentions) {
    return { check: { id, status: 'NOT_VERIFIED', detail: `the recorded result is for another story ("${storyLine.slice(0, 120)}"), not ${p.story.id}; it is not evidence for this one.`, source }, sha: d.sha };
  }
  if (status === 'PASS') return { check: { id, status: 'PASS', detail: `recorded Status: PASS for ${p.story.id}.`, source }, sha: d.sha };
  if (status === 'FAIL') return { check: { id, status: 'FAIL', detail: `recorded Status: FAIL for ${p.story.id}.`, source }, sha: d.sha };
  return { check: { id, status: 'NOT_VERIFIED', detail: `no recognizable "**Status:** PASS|FAIL" for ${p.story.id}.`, source }, sha: d.sha };
}

function buildInternals(ctx: Context, p: FinalizationProposal): Internal[] {
  const out: Internal[] = [];
  const r = ctx.root;

  // capsule — created, never overwritten
  {
    const path = capsulePathOf(r, p);
    const content = renderCapsule(p);
    const d = readDoc(ctx.projectRoot, path);
    const t: PlannedTarget = { id: 'capsule', kind: 'capsule', path, state: 'pending', reason: 'will be created', base: 'ABSENT' };
    if (d.kind === 'missing') out.push({ target: { ...t, preview: content }, write: { mode: 'create', content, baseSha: null } });
    else if (d.kind === 'unreadable') out.push({ target: { ...t, state: 'unreadable', reason: `${d.code}: ${d.detail}`, base: 'UNREADABLE' } });
    else if (d.content === content) out.push({ target: { ...t, state: 'done', reason: 'capsule already present with identical content', base: 'DONE' } });
    else out.push({ target: { ...t, state: 'conflict', reason: 'a different file already exists at the capsule path; it is never overwritten', base: d.sha } });
  }

  const textTarget = (id: string, kind: TargetKind, path: string, edit: (c: string) => Edit, preview: string, missingReason: string): void => {
    const d = readDoc(ctx.projectRoot, path);
    const t: PlannedTarget = { id, kind, path, state: 'pending', reason: '', base: 'ABSENT' };
    if (d.kind === 'missing') {
      out.push({ target: { ...t, state: 'missing', reason: missingReason } });
      return;
    }
    if (d.kind === 'unreadable') {
      out.push({ target: { ...t, state: 'unreadable', reason: `${d.code}: ${d.detail}`, base: 'UNREADABLE' } });
      return;
    }
    const e = edit(d.content);
    if (e.state === 'done') out.push({ target: { ...t, state: 'done', reason: 'already in its final state', base: 'DONE' } });
    else if (e.state === 'conflict') out.push({ target: { ...t, state: 'conflict', reason: e.reason, base: d.sha } });
    else out.push({ target: { ...t, reason: 'will be updated', base: d.sha, preview }, write: { mode: 'replace', content: e.content, baseSha: d.sha } });
  };

  textTarget('execution-history', 'execution-history', `${r}/memory/long-term/execution-history.md`, (c) => editAppendEntry(c, historyHeading(p), historyFragment(r, p)), historyFragment(r, p), 'execution-history.md does not exist; it is never created automatically');
  textTarget('story-index', 'story-index', `${r}/memory/working/story-index.md`, (c) => editIndex(c, p.story.phaseHeading, indexHeading(p), indexFragment(r, p)), indexFragment(r, p), 'story-index.md does not exist; it is never created automatically');

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
  const seen = new Map<string, string>();
  for (const it of out) {
    const prior = seen.get(it.target.path);
    if (prior !== undefined) {
      it.target.state = 'conflict';
      it.target.reason = `path is also the target "${prior}"`;
      delete it.write;
    } else seen.set(it.target.path, it.target.id);
  }
  return out;
}

function makeContext(targetDir: string): { ctx: Context } | { error: string } {
  let config: ConfigRead;
  try {
    config = readConfigFile(targetDir);
  } catch (err) {
    return { error: `cannot read monolith.config.json: ${(err as Error).message}` };
  }
  let resolved;
  try {
    resolved = resolveMonolithRoot(targetDir, config);
  } catch (err) {
    if (err instanceof RootContainmentError) return { error: `${err.code}: ${err.message}` };
    throw err;
  }
  const fc = readFinalizeConfig(config);
  return { ctx: { projectRoot: resolved.projectRoot, root: resolved.monolithRoot, config: fc, configProblem: fc.errors.length > 0 ? fc.errors.join(' ') : null } };
}

function refusedPlan(p: FinalizationProposal, message: string): FinalizationPlan {
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

function plan(ctx: Context, p: FinalizationProposal): { plan: FinalizationPlan; internals: Internal[] } {
  const internals = buildInternals(ctx, p);
  const targets = internals.map((i) => i.target);
  const checks: Check[] = [];
  const diagnostics: string[] = [];

  if (ctx.configProblem !== null) checks.push({ id: 'config', status: 'FAIL', detail: ctx.configProblem, source: 'monolith.config.json' });
  else if (ctx.config.requiredDocs.length === 0) diagnostics.push('finalization.requiredDocs is not configured in monolith.config.json: no documents were required.');

  const bad = targets.filter((t) => t.state === 'conflict' || t.state === 'missing' || t.state === 'unreadable');
  checks.push(
    bad.length === 0
      ? { id: 'targets', status: 'PASS', detail: `${targets.length} write target(s) are inside the instance, regular files and applicable.`, source: 'MONOLITH (safe read, containment, no symlinks)' }
      : { id: 'targets', status: 'FAIL', detail: bad.map((t) => `${t.id} [${t.state}]: ${t.reason}`).join(' | '), source: 'MONOLITH (safe read, containment, no symlinks)' },
  );

  const active = targets.find((t) => t.id === 'active');
  if (active?.state === 'done') {
    checks.push({ id: 'expected-state', status: 'PASS', detail: 'active.md is already in its final state.', source: 'MONOLITH' });
  } else {
    const d = readDoc(ctx.projectRoot, `${ctx.root}/memory/working/active.md`);
    const exp = p.expectedCurrentStory;
    if (d.kind !== 'present') checks.push({ id: 'expected-state', status: 'FAIL', detail: 'active.md could not be read.', source: 'MONOLITH' });
    else {
      const ex = extractCurrentStory(d.content);
      const excerpt = ex.excerpt ?? '';
      let ok: boolean;
      let want: string;
      if (exp === 'any') (ok = ex.hasCurrentStorySection), (want = 'any state (section must exist)');
      else if (exp === 'none') (ok = /no active story/i.test(excerpt)), (want = 'no active story');
      else (ok = excerpt.includes(exp.contains)), (want = `Current Story containing "${exp.contains}"`);
      checks.push({ id: 'expected-state', status: ok ? 'PASS' : 'FAIL', detail: ok ? `Current Story matches the expected state: ${want}.` : `Current Story does not match the expected state: ${want}.`, source: 'MONOLITH (brief Current Story extraction)' });
    }
  }

  const reqShas: string[] = [];
  if (ctx.config.requiredDocs.length > 0) {
    const problems: string[] = [];
    for (const rd of ctx.config.requiredDocs) {
      const d = readDoc(ctx.projectRoot, rd.path);
      if (d.kind === 'missing') (problems.push(`${rd.path} (${rd.label}): MISSING`), reqShas.push(`${rd.path}:ABSENT`));
      else if (d.kind === 'unreadable') (problems.push(`${rd.path} (${rd.label}): UNREADABLE ${d.code}`), reqShas.push(`${rd.path}:UNREADABLE`));
      else reqShas.push(`${rd.path}:${d.sha}`);
    }
    checks.push(
      problems.length === 0
        ? { id: 'required-docs', status: 'PASS', detail: `${ctx.config.requiredDocs.length} required document(s) exist and are readable.`, source: 'monolith.config.json finalization.requiredDocs' }
        : { id: 'required-docs', status: 'FAIL', detail: problems.join('; '), source: 'monolith.config.json finalization.requiredDocs' },
    );
  }

  const integrity = evidenceCheck(ctx, p, 'integrity', 'integrity verification', 'integrity-result.md');
  const governance = evidenceCheck(ctx, p, 'governance', 'governance evaluation', 'governance-result.md');
  checks.push(integrity.check, governance.check);

  const allDone = targets.length > 0 && targets.every((t) => t.state === 'done');
  const someDone = targets.some((t) => t.state === 'done');
  const ready = checks.every((c) => c.status === 'PASS');
  const status: PlanStatus = allDone ? 'ALREADY_FINALIZED' : ready ? 'READY' : 'NOT_READY';

  const digest = sha(
    JSON.stringify({
      v: 1,
      proposal: p,
      root: ctx.root,
      targets: targets.map((t) => [t.id, t.path, t.state, t.base]),
      required: reqShas,
      evidence: [integrity.sha, governance.sha],
      config: [ctx.config.requiredDocs, ctx.config.allowedDocs],
    }),
  );

  return { plan: { status, storyId: p.story.id, digest, partial: someDone && !allDone, checks, targets, diagnostics }, internals };
}

export function planFinalization(targetDir: string, proposal: FinalizationProposal): FinalizationPlan {
  const c = makeContext(targetDir);
  if ('error' in c) return refusedPlan(proposal, c.error);
  return plan(c.ctx, proposal).plan;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function refused(p: FinalizationProposal, pl: FinalizationPlan, msg: string): ApplyResult {
  return { status: 'REFUSED', storyId: p.story.id, plan: pl, applied: [], pending: pl.targets.filter((t) => t.state !== 'done').map((t) => t.id), diagnostics: [msg] };
}

export async function applyFinalization(targetDir: string, proposal: FinalizationProposal, approvedDigest: string, opts: FinalizeOptions = {}): Promise<ApplyResult> {
  const c = makeContext(targetDir);
  if ('error' in c) return refused(proposal, refusedPlan(proposal, c.error), c.error);
  const { ctx } = c;
  const boundary = projectBoundary(ctx.projectRoot);

  let release: (() => void) | null = null;
  try {
    const workingAbs = join(ctx.projectRoot, ctx.root, 'memory', 'working');
    const lockParent = openParent(boundary, workingAbs, { ops: opts.ops });
    release = await acquireLock(join(workingAbs, LOCK_NAME), { timeoutMs: 10_000, ...opts.lock }, {}, lockParent);
  } catch (err) {
    const msg = `cannot take the finalization lock (another finalization may be running, or this is not an instance): ${(err as Error).message}`;
    return refused(proposal, plan(ctx, proposal).plan, msg);
  }

  try {
    const { plan: pl, internals } = plan(ctx, proposal);
    if (pl.status === 'ALREADY_FINALIZED') {
      return { status: 'ALREADY_FINALIZED', storyId: proposal.story.id, plan: pl, applied: [], pending: [], diagnostics: ['Every target is already in its final state; nothing was written.'] };
    }
    if (pl.status !== 'READY') return refused(proposal, pl, 'Preconditions are not satisfied; nothing was written.');
    if (approvedDigest !== pl.digest) {
      return refused(proposal, pl, 'STALE: the approved digest does not match the current state (a document, the evidence or the proposal changed since the plan was approved). Run `monolith finalize plan` again and re-approve; nothing was written.');
    }

    const order: TargetKind[] = ['capsule', 'execution-history', 'story-index', 'doc', 'handoff', 'active'];
    const todo = internals.filter((i) => i.write !== undefined).sort((a, b) => order.indexOf(a.target.kind) - order.indexOf(b.target.kind));
    const applied: string[] = [];

    for (const it of todo) {
      const w = it.write!;
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
        const wo = { mode: 0o666, exactMode: false, durability: 'full' as const, maxBytes: MAX_DOC_BYTES, ops: opts.ops };
        const outcome = w.mode === 'create' ? createFile(parent, name, w.content, wo) : replaceFile(parent, name, w.content, wo);
        for (const warn of outcome.warnings) opts.onWarning?.(warn);
        applied.push(t.id);
      } catch (err) {
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
  } finally {
    try {
      release?.();
    } catch {
      /* the lock helper reports its own residue; the outcome above is already decided */
    }
  }
}
