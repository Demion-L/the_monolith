/**
 * Story State Resolver (ARCH-002B) — one read-only view of what the state documents
 * say about ONE story.
 *
 * Principle: SINGLE AUTHORITY PER FACT. Planned, Active and Finalized are three
 * independent facts, each with one authoritative source:
 *
 *   Planned story    → roadmap-index.md (phase story tables under `## Phases`)
 *   Active story     → active.md `## Current Story` (structural `**Story:**` field)
 *   Finalized story  → story-index.md (structured entries)
 *   Active phase     → roadmap-index.md `## Current Focus` (not resolved here)
 *   Finalization evidence → Story capsule (referenced by path, never read here)
 *   Execution history / tech debt → their own append-only / registry documents (out of scope)
 *
 * The resolver keeps the three facts apart and checks that they are logically
 * compatible. It does NOT compute a single "status": a story that is planned,
 * active and finalized at once is reported as a CONFLICT, never collapsed.
 *
 * Contract:
 *  - Pure, deterministic, synchronous. No I/O, no Git, no network, no LLM, no writes.
 *  - Reuses Core's parsers (`parseActiveStoryClaim`, `parseRoadmapPhases`,
 *    `parseStoryIndex`, `parseRoadmapActiveStory`, `parseRoadmapStatuses`) and the
 *    single definition of "done" (`isDone`). No second parser of these documents.
 *  - A missing / unreadable / unparseable source is UNKNOWN, never "the story does
 *    not exist". Absence from a document is only `absent` when that document was
 *    read and recognised in full.
 *  - Legacy roadmap fields (`Active Story:`, status columns in story tables) are never
 *    a normative source of the Active Story; they only produce `LEGACY_*` drift
 *    diagnostics when they explicitly contradict the authoritative state.
 *  - Diagnostics are fixed codes plus short, clipped, project-relative provenance.
 */

import { isDone, parseActiveStoryClaim, parseRoadmapActiveStory, parseRoadmapStatuses } from '../brief/freshness.js';
import { maskNonContent } from '../brief/markdown-context.js';
import { extractCurrentStory } from '../brief/story.js';
import { parseRoadmapPhases } from './roadmap.js';
import { parseStoryIndex } from './story-index.js';
import type { StoryPhaseRef, StructuredRoadmapView, StructuredStoryIndexView } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * The document texts the resolver reads. `null` = the document is missing or could not
 * be read (the caller's reader already classified why). Paths are project-relative
 * labels used for provenance only.
 */
export interface StorySources {
  /** active.md */
  active: string | null;
  /** roadmap-index.md */
  roadmap: string | null;
  /** story-index.md */
  storyIndex: string | null;
}

/** Parsed documents, built once and reused for any number of stories. */
export interface StoryAuthorityContext {
  readonly sources: { active: SourceState; roadmap: SourceState; storyIndex: SourceState };
  readonly activeClaim: ActiveClaim;
  readonly roadmap: StructuredRoadmapView | null;
  readonly storyIndex: StructuredStoryIndexView | null;
  readonly roadmapRows: readonly RoadmapRow[];
  readonly roadmapActiveStoryLine: string | null;
}

export type SourceState = 'available' | 'missing' | 'unrecognized' | 'partial';

type ActiveClaim =
  | { kind: 'none' }
  | { kind: 'ids'; ids: string[] }
  | { kind: 'unknown'; contradiction: boolean }
  | { kind: 'unavailable' };

interface RoadmapRow {
  storyId: string;
  /** Phase id of the enclosing `### Phase <id>` section; null if the section id is unusable. */
  phaseId: string | null;
  /** Legacy status column, verbatim (uppercased). Never authoritative. */
  legacyStatus: string;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type Provenance = { document: 'active.md' | 'roadmap-index.md' | 'story-index.md'; locator: string };

export type PlanningFact =
  | { state: 'PLANNED'; entries: { phaseId: string | null; provenance: Provenance }[] }
  | { state: 'NOT_LISTED' }
  | { state: 'UNKNOWN' };

export type ActiveFact =
  | { state: 'ACTIVE'; provenance: Provenance }
  | { state: 'NOT_ACTIVE'; claimedIds: string[] | null; provenance: Provenance }
  | { state: 'UNKNOWN'; reason: 'DOCUMENT_UNAVAILABLE' | 'CLAIM_UNPARSEABLE' | 'CLAIM_SELF_CONTRADICTORY' };

export interface FinalizationEntry {
  /** Status as the document reports it (verbatim); null when missing/empty/self-contradicting. */
  status: string | null;
  /** True only for a status Core treats as done (COMPLETED / DONE). */
  finalized: boolean;
  title: string | null;
  date: string | null;
  phase: StoryPhaseRef;
  provenance: Provenance;
}

export type FinalizationFact =
  | { state: 'FINALIZED'; entries: FinalizationEntry[] }
  /** Present in story-index.md, but no entry carries a done status. */
  | { state: 'LISTED_NOT_FINAL'; entries: FinalizationEntry[] }
  | { state: 'NOT_FINALIZED' }
  | { state: 'UNKNOWN' };

export type PhaseAssociation =
  /** Exactly one phase is supported by the evidence. */
  | { state: 'RESOLVED'; phaseId: string; evidence: Provenance[] }
  /** Evidence points at several phases or at a phase that cannot be matched. */
  | { state: 'AMBIGUOUS'; candidates: string[] }
  /** No evidence at all, or the evidence is unverifiable. */
  | { state: 'UNKNOWN' };

export type StoryConsistency = 'CONSISTENT' | 'INCOMPLETE' | 'CONFLICT';

export type StoryDiagnosticCode =
  // CONFLICT
  | 'ACTIVE_AND_FINALIZED'
  | 'FINALIZATION_RECORDS_CONFLICT'
  | 'PHASE_EVIDENCE_CONFLICT'
  | 'ACTIVE_CLAIM_SELF_CONTRADICTORY'
  // INCOMPLETE (data missing or not interpretable)
  | 'ACTIVE_SOURCE_UNAVAILABLE'
  | 'ROADMAP_SOURCE_UNAVAILABLE'
  | 'STORY_INDEX_SOURCE_UNAVAILABLE'
  | 'ACTIVE_CLAIM_UNPARSEABLE'
  | 'PHASE_ASSOCIATION_AMBIGUOUS'
  | 'PHASE_ASSOCIATION_UNVERIFIED'
  | 'FINALIZATION_STATUS_UNREADABLE'
  // WARN / INFO (documents compatible, but worth knowing)
  | 'FINALIZATION_RECORD_DUPLICATED'
  | 'LISTED_NOT_FINAL'
  | 'LEGACY_ROADMAP_STATUS_DRIFT'
  | 'LEGACY_ROADMAP_ACTIVE_STORY_DRIFT'
  | 'LEGACY_ROADMAP_ACTIVE_STORY_IGNORED';

export interface StoryDiagnostic {
  code: StoryDiagnosticCode;
  /** `conflict` and `incomplete` determine `consistency`; `warn`/`info` never do. */
  level: 'conflict' | 'incomplete' | 'warn' | 'info';
  /** Fixed, project-controlled-text-free sentence. */
  message: string;
  /** Where the facts that triggered it were read. */
  sources: Provenance[];
}

export interface StoryStateResolution {
  storyId: string;
  planning: PlanningFact;
  active: ActiveFact;
  finalization: FinalizationFact;
  phase: PhaseAssociation;
  consistency: StoryConsistency;
  diagnostics: StoryDiagnostic[];
  /** Availability of each authoritative source, so UNKNOWN is explainable. */
  sources: { active: SourceState; roadmap: SourceState; storyIndex: SourceState };
}

// ---------------------------------------------------------------------------
// Parsing the sources once
// ---------------------------------------------------------------------------

const ROW_ID_RE = /^[A-Za-z0-9][A-Za-z0-9.\-]*$/;
const ROW_STATUS_RE = /^[A-Z][A-Z _]+$/;

/** Story-table rows scoped to the `### Phase <id>` section they sit in (legacy planning table). */
function parseRoadmapRows(roadmap: StructuredRoadmapView): RoadmapRow[] {
  const rows: RoadmapRow[] = [];
  for (const phase of roadmap.phases) {
    if (phase.details === null) continue;
    for (const line of maskNonContent(phase.details).split('\n')) {
      const cells = line.split('|').map((c) => c.trim());
      if (cells.length < 5 || cells[0] !== '' || cells[cells.length - 1] !== '') continue;
      if (!ROW_ID_RE.test(cells[1]) || !ROW_STATUS_RE.test(cells[3])) continue;
      rows.push({ storyId: cells[1], phaseId: phase.id, legacyStatus: cells[3] });
    }
  }
  return rows;
}

/**
 * Phase-scoped rows; when the roadmap has no phase structure at all (the older flat
 * layout: one story table, no `### Phase`), the same rows are read with Core's existing
 * flat parser and carry no phase (`phaseId: null`) — a phase is never guessed.
 */
function legacyRows(text: string, roadmap: StructuredRoadmapView | null): RoadmapRow[] {
  const scoped = roadmap !== null ? parseRoadmapRows(roadmap) : [];
  if (scoped.length > 0 || (roadmap !== null && roadmap.phases.length > 0)) return scoped;
  return [...parseRoadmapStatuses(text)].map(([storyId, legacyStatus]) => ({ storyId, phaseId: null, legacyStatus }));
}

function roadmapState(view: StructuredRoadmapView | null, text: string | null): SourceState {
  if (text === null) return 'missing';
  if (view === null) return 'unrecognized';
  if (view.state === 'ok') return 'available';
  if (view.state === 'partial') return 'partial';
  return 'unrecognized';
}

function storyIndexState(view: StructuredStoryIndexView | null, text: string | null): SourceState {
  if (text === null) return 'missing';
  if (view === null) return 'unrecognized';
  // `none_finalized`: a recognised, empty index. Finalization of a story is then answerable: NOT_FINALIZED.
  if (view.state === 'ok' || view.state === 'none_finalized') return 'available';
  if (view.state === 'partial') return 'partial';
  return 'unrecognized';
}

export function buildStoryAuthorityContext(src: StorySources): StoryAuthorityContext {
  let activeState: SourceState = 'missing';
  let activeClaim: ActiveClaim = { kind: 'unavailable' };
  if (src.active !== null) {
    const extraction = extractCurrentStory(src.active);
    if (!extraction.hasCurrentStorySection) {
      activeState = 'unrecognized';
    } else {
      activeState = 'available';
      const claim = parseActiveStoryClaim(extraction.excerpt);
      activeClaim =
        claim.kind === 'ids'
          ? { kind: 'ids', ids: [...claim.ids] }
          : claim.kind === 'none'
            ? { kind: 'none' }
            : { kind: 'unknown', contradiction: claim.contradiction !== undefined };
    }
  }

  let roadmap: StructuredRoadmapView | null = null;
  if (src.roadmap !== null) {
    try {
      roadmap = parseRoadmapPhases(src.roadmap);
    } catch {
      roadmap = null;
    }
  }
  const phaseIds = roadmap !== null && roadmap.state !== 'error' ? roadmap.phases.flatMap((p) => (p.id === null ? [] : [p.id])) : null;

  let storyIndex: StructuredStoryIndexView | null = null;
  if (src.storyIndex !== null) {
    try {
      storyIndex = parseStoryIndex(src.storyIndex, phaseIds, roadmap?.state !== 'partial');
    } catch {
      storyIndex = null;
    }
  }

  return {
    sources: { active: activeState, roadmap: roadmapState(roadmap, src.roadmap), storyIndex: storyIndexState(storyIndex, src.storyIndex) },
    activeClaim,
    roadmap,
    storyIndex,
    roadmapRows: src.roadmap === null ? [] : legacyRows(src.roadmap, roadmap),
    roadmapActiveStoryLine: src.roadmap === null ? null : parseRoadmapActiveStory(src.roadmap),
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

const ACTIVE_PROV: Provenance = { document: 'active.md', locator: '## Current Story' };
const clip = (s: string): string => (s.length <= 64 ? s : `${s.slice(0, 63)}…`);
const normId = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** `STORY 1.1` (story-index heading) and `1.1` (roadmap table id) name the same story; nothing else is equated. */
const bareId = (s: string): string => normId(s).replace(/^STORY\s+/i, '');
const sameStory = (a: string, b: string): boolean => bareId(a) === bareId(b);

/** Resolves one story from already-built context. Pure. */
export function resolveStoryStateIn(ctx: StoryAuthorityContext, rawStoryId: string): StoryStateResolution {
  const storyId = normId(rawStoryId);
  const diagnostics: StoryDiagnostic[] = [];
  const add = (code: StoryDiagnosticCode, level: StoryDiagnostic['level'], message: string, sources: Provenance[]): void => {
    diagnostics.push({ code, level, message, sources });
  };

  // ---- Planned: roadmap-index.md ----
  let planning: PlanningFact;
  const roadmapComplete = ctx.sources.roadmap === 'available';
  const plannedRows = ctx.roadmapRows.filter((r) => sameStory(r.storyId, storyId));
  if (plannedRows.length > 0) {
    planning = {
      state: 'PLANNED',
      entries: plannedRows.map((r) => ({ phaseId: r.phaseId, provenance: { document: 'roadmap-index.md', locator: `phase ${r.phaseId ?? '?'} story table` } })),
    };
  } else if (roadmapComplete) {
    planning = { state: 'NOT_LISTED' };
  } else {
    planning = { state: 'UNKNOWN' };
    add('ROADMAP_SOURCE_UNAVAILABLE', 'incomplete', 'roadmap-index.md is missing or not fully interpretable; planning of this story cannot be established.', [{ document: 'roadmap-index.md', locator: 'file' }]);
  }

  // ---- Active: active.md ----
  let active: ActiveFact;
  const claim = ctx.activeClaim;
  if (claim.kind === 'ids') {
    active = claim.ids.some((id) => sameStory(id, storyId))
      ? { state: 'ACTIVE', provenance: ACTIVE_PROV }
      : { state: 'NOT_ACTIVE', claimedIds: claim.ids.map(clip), provenance: ACTIVE_PROV };
  } else if (claim.kind === 'none') {
    active = { state: 'NOT_ACTIVE', claimedIds: null, provenance: ACTIVE_PROV };
  } else if (claim.kind === 'unknown') {
    active = { state: 'UNKNOWN', reason: claim.contradiction ? 'CLAIM_SELF_CONTRADICTORY' : 'CLAIM_UNPARSEABLE' };
    if (claim.contradiction) {
      add('ACTIVE_CLAIM_SELF_CONTRADICTORY', 'conflict', 'active.md both records no active story and carries a **Story:** field.', [ACTIVE_PROV]);
    } else {
      add('ACTIVE_CLAIM_UNPARSEABLE', 'incomplete', 'The Current Story section of active.md does not identify a single story.', [ACTIVE_PROV]);
    }
  } else {
    active = { state: 'UNKNOWN', reason: 'DOCUMENT_UNAVAILABLE' };
    add('ACTIVE_SOURCE_UNAVAILABLE', 'incomplete', 'active.md is missing or has no Current Story section; the active story cannot be established.', [{ document: 'active.md', locator: 'file' }]);
  }

  // ---- Finalized: story-index.md ----
  let finalization: FinalizationFact;
  const entries: FinalizationEntry[] = [];
  const indexed: { item: StructuredStoryIndexView['stories'][number]; ordinal: number }[] = [];
  if (ctx.storyIndex !== null) {
    ctx.storyIndex.stories.forEach((item, i) => {
      if (sameStory(item.id, storyId)) indexed.push({ item, ordinal: i + 1 });
    });
  }
  for (const { item, ordinal } of indexed) {
    const value = item.status.value;
    entries.push({
      status: value,
      finalized: value !== null && isDone(value.toUpperCase()),
      title: item.title === null ? null : clip(item.title),
      date: item.date,
      phase: item.phase,
      provenance: { document: 'story-index.md', locator: `entry #${ordinal}` },
    });
  }
  const indexComplete = ctx.sources.storyIndex === 'available';
  if (entries.length > 0) {
    finalization = entries.some((e) => e.finalized) ? { state: 'FINALIZED', entries } : { state: 'LISTED_NOT_FINAL', entries };
  } else if (indexComplete) {
    finalization = { state: 'NOT_FINALIZED' };
  } else {
    finalization = { state: 'UNKNOWN' };
    add('STORY_INDEX_SOURCE_UNAVAILABLE', 'incomplete', 'story-index.md is missing or not fully interpretable; finalization of this story cannot be established.', [{ document: 'story-index.md', locator: 'file' }]);
  }

  if (entries.some((e) => e.status === null)) {
    add('FINALIZATION_STATUS_UNREADABLE', 'incomplete', 'A story-index.md entry for this story has a missing, empty or self-contradicting status.', entries.filter((e) => e.status === null).map((e) => e.provenance));
  }
  if (finalization.state === 'LISTED_NOT_FINAL') {
    add('LISTED_NOT_FINAL', 'warn', 'story-index.md lists this story, but no entry carries a finalized status.', entries.map((e) => e.provenance));
  }

  // Duplicate finalization: several entries. Incompatible when they disagree on finality, status or phase token.
  if (entries.length > 1) {
    const signature = (e: FinalizationEntry): string => `${e.finalized}|${(e.status ?? '').toUpperCase()}|${e.phase.kind === 'outside' ? '' : e.phase.token}`;
    const incompatible = new Set(entries.map(signature)).size > 1;
    if (incompatible) {
      add('FINALIZATION_RECORDS_CONFLICT', 'conflict', 'story-index.md holds several incompatible entries for this story (different status or phase).', entries.map((e) => e.provenance));
    } else {
      add('FINALIZATION_RECORD_DUPLICATED', 'warn', 'story-index.md holds several identical entries for this story.', entries.map((e) => e.provenance));
    }
  }

  // ---- Independent facts must not contradict each other ----
  if (active.state === 'ACTIVE' && finalization.state === 'FINALIZED') {
    add('ACTIVE_AND_FINALIZED', 'conflict', 'active.md declares this story current, while story-index.md records it as finalized.', [ACTIVE_PROV, ...entries.filter((e) => e.finalized).map((e) => e.provenance)]);
  }

  // ---- Phase association: evidence from the roadmap table and the story-index nesting ----
  const phase = resolvePhase(plannedRows, entries, diagnostics);

  // ---- Legacy roadmap fields: drift diagnostics only ----
  const legacyLine = ctx.roadmapActiveStoryLine;
  const roadmapProv = (locator: string): Provenance => ({ document: 'roadmap-index.md', locator });
  if (legacyLine !== null) {
    const names = mentionsStory(legacyLine, storyId);
    if (names) {
      if (active.state === 'NOT_ACTIVE') {
        add('LEGACY_ROADMAP_ACTIVE_STORY_DRIFT', 'warn', 'Legacy `Active Story:` in roadmap-index.md names this story, but active.md does not.', [roadmapProv('Active Story:'), ACTIVE_PROV]);
      } else if (active.state === 'UNKNOWN') {
        add('LEGACY_ROADMAP_ACTIVE_STORY_IGNORED', 'info', 'Legacy `Active Story:` in roadmap-index.md names this story; it is not an authoritative source and was not used.', [roadmapProv('Active Story:')]);
      }
    } else if (active.state === 'ACTIVE') {
      add('LEGACY_ROADMAP_ACTIVE_STORY_DRIFT', 'warn', 'active.md declares this story current, but the legacy `Active Story:` in roadmap-index.md names something else.', [ACTIVE_PROV, roadmapProv('Active Story:')]);
    }
  }
  for (const row of plannedRows) {
    const rowDone = isDone(row.legacyStatus);
    const prov = roadmapProv(`phase ${row.phaseId ?? '?'} story table`);
    if (finalization.state === 'FINALIZED' && !rowDone) {
      add('LEGACY_ROADMAP_STATUS_DRIFT', 'warn', `Legacy roadmap status table says ${row.legacyStatus}, but story-index.md records the story as finalized.`, [prov, ...entries.filter((e) => e.finalized).map((e) => e.provenance)]);
    } else if (rowDone && (finalization.state === 'NOT_FINALIZED' || finalization.state === 'LISTED_NOT_FINAL')) {
      add('LEGACY_ROADMAP_STATUS_DRIFT', 'warn', `Legacy roadmap status table says ${row.legacyStatus}, but story-index.md has no finalized entry.`, [prov]);
    } else if (rowDone && active.state === 'ACTIVE') {
      add('LEGACY_ROADMAP_STATUS_DRIFT', 'warn', `Legacy roadmap status table says ${row.legacyStatus}, but active.md declares the story current.`, [prov, ACTIVE_PROV]);
    }
  }

  const consistency: StoryConsistency = diagnostics.some((d) => d.level === 'conflict') ? 'CONFLICT' : diagnostics.some((d) => d.level === 'incomplete') ? 'INCOMPLETE' : 'CONSISTENT';
  return { storyId, planning, active, finalization, phase, consistency, diagnostics, sources: ctx.sources };
}

function mentionsStory(line: string, storyId: string): boolean {
  const id = bareId(storyId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9-])(?:STORY\\s+)?${id}(?![A-Za-z0-9]|\\.\\d|-[A-Z0-9])`, 'i').test(line);
}

function resolvePhase(rows: RoadmapRow[], entries: FinalizationEntry[], diagnostics: StoryDiagnostic[]): PhaseAssociation {
  const add = (code: StoryDiagnosticCode, level: StoryDiagnostic['level'], message: string, sources: Provenance[]): void => {
    diagnostics.push({ code, level, message, sources });
  };
  const evidence: { phaseId: string; prov: Provenance }[] = [];
  let unverifiable = false;
  const unmatchedTokens: string[] = [];

  for (const r of rows) {
    if (r.phaseId !== null) evidence.push({ phaseId: r.phaseId, prov: { document: 'roadmap-index.md', locator: `phase ${r.phaseId} story table` } });
  }
  for (const e of entries) {
    const p = e.phase;
    if (p.kind === 'matched') evidence.push({ phaseId: p.phaseId, prov: e.provenance });
    else if (p.kind === 'ambiguous' || p.kind === 'unmatched') unmatchedTokens.push(p.token);
    else unverifiable = true; // unverified | outside
  }

  const distinct = [...new Set(evidence.map((x) => x.phaseId))];
  if (distinct.length > 1) {
    add('PHASE_EVIDENCE_CONFLICT', 'conflict', 'Documents associate this story with different phases.', evidence.map((x) => x.prov));
    return { state: 'AMBIGUOUS', candidates: distinct };
  }
  if (unmatchedTokens.length > 0) {
    add('PHASE_ASSOCIATION_AMBIGUOUS', 'incomplete', 'story-index.md nests this story under a phase that matches no (or several) roadmap phase ids.', entries.map((e) => e.provenance));
    return { state: 'AMBIGUOUS', candidates: [...new Set([...distinct, ...unmatchedTokens.map(clip)])] };
  }
  if (distinct.length === 1) {
    return { state: 'RESOLVED', phaseId: distinct[0], evidence: evidence.map((x) => x.prov) };
  }
  if (unverifiable) {
    add('PHASE_ASSOCIATION_UNVERIFIED', 'incomplete', 'The phase of this story cannot be verified against the roadmap.', entries.map((e) => e.provenance));
  }
  return { state: 'UNKNOWN' };
}

/** Convenience: parse the sources and resolve one story. */
export function resolveStoryState(sources: StorySources, storyId: string): StoryStateResolution {
  return resolveStoryStateIn(buildStoryAuthorityContext(sources), storyId);
}

/**
 * The story `active.md` declares current, resolved; `null` when it declares none or
 * cannot be read to a single id (those are visible via `buildStoryAuthorityContext`).
 */
export function resolveActiveStory(sources: StorySources): StoryStateResolution | null {
  const ctx = buildStoryAuthorityContext(sources);
  return ctx.activeClaim.kind === 'ids' && ctx.activeClaim.ids.length === 1 ? resolveStoryStateIn(ctx, ctx.activeClaim.ids[0]) : null;
}
