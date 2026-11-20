/* eslint-disable no-console */
/**
 * `monolith handover check [--json] [--strict]` and `monolith evidence run|report|list`
 * (ACCOUNTABILITY-001).
 *
 * `handover check` is read-only: it writes nothing, runs no test, needs no LLM or network.
 * `evidence run` executes ONE command given as argv (no shell) and records its exit status; `evidence report`
 * records somebody's statement as REPORTED. Only those two commands write, and only a new file under the
 * verification directory. They never finalize, close missions or touch any document.
 *
 * Exit codes — handover check: 0 ran, 1 usage, 2 --strict and status is not READY_FOR_REVIEW, 3 could not run.
 * evidence run: the command's own exit code when it ran (so it can gate a script), 1 usage/refusal, 3 internal.
 */

import { spawnSync } from 'child_process';
import { colorEnabled, paint } from '../cli/style.js';
import { sanitizeSingleLine } from '../brief/sanitize.js';
import { STORY_ID_RE } from '../coordinatorium/types.js';
import { buildHandoverReport } from './check.js';
import { EvidenceError, addEvidence, assessAll, evidenceStore, listEvidence, type EvidenceResult } from './evidence.js';
import { readGitView } from './git.js';
import type { HandoverReport, HandoverStatus } from './types.js';

export const HANDOVER_USAGE = 'Usage: monolith handover check [--json] [--strict]';
export const EVIDENCE_USAGE = [
  'Usage: monolith evidence run [--story <STORY-ID>] [--timeout-sec N] -- <command> [args...]   (runs the command, no shell; records its exit status as OBSERVED)',
  '       monolith evidence report --command "<text>" --result pass|fail [--story <STORY-ID>] [--note "..."]   (records a statement as REPORTED; not verification)',
  '       monolith evidence list [--json]',
].join('\n');

const MAX_RUN_SEC = 3600;
const DEFAULT_RUN_SEC = 1800;

// ---------------------------------------------------------------------------
// handover check
// ---------------------------------------------------------------------------

export type HandoverArgs = { ok: true; json: boolean; strict: boolean } | { ok: false; message: string };

export function parseHandoverArgs(args: string[]): HandoverArgs {
  if (args[0] !== 'check') return { ok: false, message: `Unknown handover subcommand: ${args[0] ?? '(none)'}\n${HANDOVER_USAGE}` };
  let json = false;
  let strict = false;
  for (const a of args.slice(1)) {
    if (a === '--json') json = true;
    else if (a === '--strict') strict = true;
    else return { ok: false, message: `Unknown option: ${a}\n${HANDOVER_USAGE}` };
  }
  return { ok: true, json, strict };
}

const STATUS_TEXT: Record<HandoverStatus, string> = {
  READY_FOR_REVIEW: 'READY FOR REVIEW',
  REVIEW_WITH_ISSUES: 'REVIEW WITH ISSUES',
  INCOMPLETE: 'INCOMPLETE',
  UNKNOWN: 'UNKNOWN',
};

const one = (s: string): string => sanitizeSingleLine(s);

export function renderHandoverReport(r: HandoverReport, color = false): string {
  const tone = (s: string, kind: 'good' | 'warn' | 'bad' | 'dim'): string => paint(s, kind, color);
  const lines: string[] = ['HANDOVER CHECK', ''];
  const statusTone = r.status === 'READY_FOR_REVIEW' ? 'good' : r.status === 'REVIEW_WITH_ISSUES' ? 'warn' : 'bad';
  lines.push(`Status: ${tone(STATUS_TEXT[r.status], statusTone)}${r.statusReasons.length > 0 ? `  (${r.statusReasons.slice(0, 8).join(', ')}${r.statusReasons.length > 8 ? ', …' : ''})` : ''}`);
  lines.push('This is a reviewability status, not a statement that the project is correct or production-ready.', '');

  lines.push('## Project');
  lines.push(`  Name: ${r.project.name === null ? 'UNKNOWN' : one(r.project.name)}`);
  const ph = r.project.activePhase;
  lines.push(`  Active phase: ${ph.kind === 'phase' ? one(ph.id ?? '?') : ph.kind === 'none' ? 'none declared' : ph.kind === 'unknown' ? 'UNKNOWN' : ph.kind}`);
  const cur = r.project.currentStory;
  lines.push(`  Current story: ${cur.kind === 'ids' ? cur.ids.map(one).join(', ') : cur.kind === 'none' ? 'none recorded' : 'UNKNOWN'}`);
  const g = r.project.governance;
  lines.push(`  Governance: ${g.result === 'NOT_CHECKED' ? 'not checked' : g.result === 'NO_ISSUES' ? 'no findings' : `${g.errors} error(s), ${g.warnings} warning(s)`}`);
  lines.push('');

  const p = r.progress;
  lines.push('## Development progress (REPORTED by the project documents)');
  lines.push(`  Planned: ${p.planned}   Active: ${p.active}   Finalized: ${p.finalized}   Listed, not final: ${p.listedNotFinal}   Unclassified: ${p.unknown}`);
  if (p.awaitingReview.length > 0) lines.push(`  Awaiting review (story-index says so): ${p.awaitingReview.map(one).join(', ')}`);
  for (const s of p.stories.slice(0, 30)) {
    lines.push(`  - ${one(s.id)}: ${s.finalization === 'FINALIZED' ? 'FINALIZED' : s.active === 'ACTIVE' ? 'ACTIVE' : s.planned === 'PLANNED' ? 'PLANNED' : s.finalization === 'LISTED_NOT_FINAL' ? `LISTED (${one(s.indexStatus ?? '?')})` : 'not classified'}` +
      `${s.consistency !== 'CONSISTENT' ? ` [${s.consistency}]` : ''}; missions ${s.missions.completed} done/${s.missions.inProgress} open/${s.missions.failed} failed; evidence ${s.evidence.verified} verified, ${s.evidence.reported} reported, ${s.evidence.stale} stale`);
  }
  if (p.stories.length > 30 || p.storiesTruncated) lines.push('  … list shortened; use --json for all stories.');
  lines.push('');

  const m = r.missions;
  lines.push('## Mission history');
  lines.push(`  Total ${m.total}: ${m.completed} completed, ${m.failed} failed, ${m.cancelled} cancelled, ${m.inProgress} active; ${m.checkpoints} checkpoint(s); ${m.withoutStoryLink} without a story link`);
  for (const a of m.active) lines.push(`  active: ${one(a.id)} ${one(a.title)} (${a.checkpointCount} checkpoint(s))`);
  lines.push('');

  const a = r.architecture;
  lines.push('## Architecture decisions');
  lines.push(a.available ? `  ${a.total} ADR(s): ${a.accepted} accepted, ${a.proposed} proposed${a.other.map((o) => `, ${o.count} ${one(o.status)}`).join('')}; ${a.unrecognized} unrecognised, ${a.missingMetadata} with missing metadata${a.complete ? '' : ' (list incomplete)'}` : '  UNKNOWN (docs/adr not available)');
  lines.push('');

  const v = r.verification;
  lines.push('## Verification evidence');
  lines.push(`  Git: ${v.git.available ? `HEAD ${v.git.head?.slice(0, 12) ?? '(none)'}, working tree ${v.git.dirty === null ? 'UNKNOWN' : v.git.dirty ? 'DIRTY' : 'clean'}` : 'unavailable (freshness UNKNOWN)'}`);
  lines.push(`  VERIFIED ${v.counts.verified}   REPORTED ${v.counts.reported}   STALE ${v.counts.stale}   UNKNOWN ${v.counts.unknown}   FAILED ${v.counts.failed}`);
  for (const e of v.items.slice(-10)) lines.push(`  - ${e.id} ${e.level} [${e.provenance}, ${e.result}, ${e.freshness}] ${e.storyId ?? '(no story)'}: ${one(e.command)}`);
  if (v.storiesWithoutVerifiedEvidence.length > 0) lines.push(`  Completed work without VERIFIED evidence: ${v.storiesWithoutVerifiedEvidence.map(one).join(', ')}`);
  lines.push('');

  const o = r.outstanding;
  lines.push('## Outstanding issues');
  if (o.issues.length === 0) lines.push('  none listed (this does not mean the project is correct)');
  for (const i of o.issues) lines.push(`  [${i.kind}] ${i.code}: ${i.message}${i.basis ? `  (basis: ${one(i.basis)})` : ''}`);
  lines.push('', '## Owner decisions required');
  if (o.ownerDecisions.length === 0) lines.push('  none established from the sources');
  for (const d of o.ownerDecisions) lines.push(`  - ${d.code} ${one(d.subject)}: ${d.message}  (basis: ${one(d.basis)})`);
  lines.push('', '## Not established by this report');
  for (const l of r.limitations) lines.push(`  - ${l}`);
  return lines.join('\n');
}

export async function runHandoverCommand(args: string[], cwd: string = process.cwd()): Promise<number> {
  const parsed = parseHandoverArgs(args);
  if (!parsed.ok) {
    console.error(parsed.message);
    return 1;
  }
  let report: HandoverReport;
  try {
    report = buildHandoverReport(cwd);
  } catch {
    console.error('monolith handover check: the check could not be executed.');
    return 3;
  }
  if (parsed.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderHandoverReport(report, colorEnabled(process.stdout)));
  return parsed.strict && report.status !== 'READY_FOR_REVIEW' ? 2 : 0;
}

// ---------------------------------------------------------------------------
// evidence
// ---------------------------------------------------------------------------

interface Flags {
  values: Map<string, string>;
  rest: string[] | null;
}

function parseFlags(args: string[], known: string[], boolFlags: string[] = []): Flags | string {
  const values = new Map<string, string>();
  let rest: string[] | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      rest = args.slice(i + 1);
      break;
    }
    if (boolFlags.includes(a)) {
      values.set(a, 'true');
      continue;
    }
    if (!known.includes(a)) return `Unexpected argument ${JSON.stringify(one(a))}.`;
    const v = args[i + 1];
    if (v === undefined || v.startsWith('--')) return `${a} needs a value.`;
    if (values.has(a)) return `${a} was given more than once.`;
    values.set(a, v);
    i++;
  }
  return { values, rest };
}

export async function runEvidenceCommand(args: string[], cwd: string = process.cwd()): Promise<number> {
  const sub = args[0];
  try {
    if (sub === 'list') return evidenceList(args.slice(1), cwd);
    if (sub === 'report') return evidenceReport(args.slice(1), cwd);
    if (sub === 'run') return evidenceRun(args.slice(1), cwd);
    console.error(`Unknown evidence subcommand: ${sub ?? '(none)'}\n${EVIDENCE_USAGE}`);
    return 1;
  } catch (err) {
    if (err instanceof EvidenceError) {
      console.error(`monolith evidence: ${one(err.message)}`);
      return err.code === 'EVIDENCE_INVALID_INPUT' ? 1 : 3;
    }
    console.error('monolith evidence: the command could not be executed.');
    return 3;
  }
}

function storyFlag(f: Flags): string | null | undefined {
  const s = f.values.get('--story');
  if (s === undefined) return null;
  return STORY_ID_RE.test(s) ? s : undefined;
}

function evidenceReport(args: string[], cwd: string): number {
  const f = parseFlags(args, ['--command', '--result', '--story', '--note']);
  if (typeof f === 'string' || f.rest !== null) {
    console.error(`${typeof f === 'string' ? f : 'Unexpected "--".'}\n${EVIDENCE_USAGE}`);
    return 1;
  }
  const command = f.values.get('--command');
  const result = f.values.get('--result');
  const story = storyFlag(f);
  if (command === undefined || (result !== 'pass' && result !== 'fail') || story === undefined) {
    console.error(`--command and --result pass|fail are required; --story must be a valid story id.\n${EVIDENCE_USAGE}`);
    return 1;
  }
  const store = evidenceStore(cwd);
  const view = readGitView(cwd, [store.dirRel]);
  const rec = addEvidence(store, { storyId: story, command, result: result as EvidenceResult, exitCode: null, provenance: 'REPORTED', gitHead: view.head, dirty: view.dirty, note: f.values.get('--note') ?? null, durationMs: null });
  console.log(`Recorded ${rec.id} (REPORTED, ${rec.result}). A reported result is a statement, not verification.`);
  return 0;
}

function evidenceRun(args: string[], cwd: string): number {
  const f = parseFlags(args, ['--story', '--timeout-sec']);
  if (typeof f === 'string' || f.rest === null || f.rest.length === 0) {
    console.error(`${typeof f === 'string' ? f : 'A command is required after "--".'}\n${EVIDENCE_USAGE}`);
    return 1;
  }
  const story = storyFlag(f);
  const timeoutRaw = f.values.get('--timeout-sec');
  const timeoutSec = timeoutRaw === undefined ? DEFAULT_RUN_SEC : Number(timeoutRaw);
  if (story === undefined || !Number.isInteger(timeoutSec) || timeoutSec < 1 || timeoutSec > MAX_RUN_SEC) {
    console.error(`--story must be a valid story id and --timeout-sec an integer 1..${MAX_RUN_SEC}.\n${EVIDENCE_USAGE}`);
    return 1;
  }
  const store = evidenceStore(cwd);
  const [cmd, ...cmdArgs] = f.rest;
  const before = readGitView(cwd, [store.dirRel]);
  const started = Date.now();
  // No shell: the command and its arguments are passed as argv, so nothing is interpreted. The environment is the caller's,
  // unchanged: an altered environment would make the observed result describe a different run than the one being verified.
  const res = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: false, timeout: timeoutSec * 1000 });
  const durationMs = Date.now() - started;
  if (res.error !== undefined && res.status === null && res.signal === null) {
    console.error(`monolith evidence run: the command could not be started (${one((res.error as NodeJS.ErrnoException).code ?? 'error')}); nothing was recorded.`);
    return 1;
  }
  const exitCode = res.status ?? 1; // a signal or timeout is a failure
  const after = readGitView(cwd, [store.dirRel]);
  // If the revision moved while the command ran, it cannot be tied to one revision: record no revision.
  const stable = before.head === after.head && before.available === after.available;
  const rec = addEvidence(store, {
    storyId: story,
    command: [cmd, ...cmdArgs].join(' '),
    result: exitCode === 0 ? 'pass' : 'fail',
    exitCode,
    provenance: 'OBSERVED',
    gitHead: stable ? before.head : null,
    dirty: stable ? before.dirty : null,
    note: res.signal !== null ? `terminated by ${res.signal}` : null,
    durationMs,
  });
  console.log(`Recorded ${rec.id} (OBSERVED, ${rec.result}, exit ${exitCode}${stable ? '' : ', revision changed during the run: freshness UNKNOWN'}${before.dirty === true ? ', working tree was dirty' : ''}).`);
  return exitCode;
}

function evidenceList(args: string[], cwd: string): number {
  const json = args.includes('--json');
  if (args.some((a) => a !== '--json')) {
    console.error(EVIDENCE_USAGE);
    return 1;
  }
  const store = evidenceStore(cwd);
  const view = readGitView(cwd, [store.dirRel]);
  const listing = listEvidence(cwd);
  const assessed = assessAll(cwd, listing.records, view, [store.dirRel]);
  if (json) {
    console.log(JSON.stringify({ git: { available: view.available, head: view.head, dirty: view.dirty }, records: assessed.map((a) => ({ ...a.record, level: a.level, freshness: a.freshness, freshnessReason: a.reason })), unreadable: listing.unreadable, truncated: listing.truncated }, null, 2));
    return 0;
  }
  if (assessed.length === 0) console.log(listing.absent ? 'No verification evidence recorded yet.' : 'No readable evidence records.');
  for (const a of assessed) console.log(`${a.record.id} ${a.level.padEnd(8)} ${a.record.provenance.padEnd(8)} ${a.record.result.padEnd(4)} ${a.freshness} ${a.record.storyId ?? '-'}  ${one(a.record.command)}`);
  if (listing.unreadable.length > 0) console.log(`${listing.unreadable.length} file(s) could not be read as records.`);
  return 0;
}
