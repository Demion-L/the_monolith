import type {
  RoadmapDiagnosticCode,
  Section,
  StoryIndexDiagnosticCode,
  StoryPhaseRef,
  StoryState,
  StructuredRoadmapView,
  StructuredStoryIndexView,
} from '../types/dashboard';

/**
 * Local UI projection for the Project Execution Graph (UI-008B).
 *
 * It only arranges what Core already decided (Roadmap phases, Story Index entries, `StoryPhaseRef`,
 * `ActivePhaseView`, the story claim). It parses no Markdown, matches nothing by title or order, and
 * invents no relation: an edge exists only for `phase.kind === 'matched'` + a unique story id + a phase id
 * that occurs exactly once in the displayed Roadmap. Everything else stays visible as "not linked", with the reason.
 */

export interface ProjectionInput {
  roadmapText: string | null;
  roadmap: StructuredRoadmapView | undefined;
  /** `undefined` = the data source does not provide a story index (older server / demo). */
  storyIndex: Section<StructuredStoryIndexView> | undefined;
  story: StoryState | undefined;
}

export type NoticeTone = 'info' | 'warn' | 'error';
export interface Notice {
  code: string;
  tone: NoticeTone;
  text: string;
}

export interface StatusView {
  /** Verbatim, as the document states it; `null` = not stated. Always a REPORTED claim. */
  value: string | null;
  recognized: boolean;
}

export interface PhaseNode {
  kind: 'phase';
  key: string;
  /** Position in the Roadmap (document order). */
  index: number;
  id: string | null;
  title: string | null;
  status: StatusView;
  /** True only when `ActivePhaseView.kind === 'phase'` names this (unique) phase. */
  current: boolean;
  /** The id occurs more than once in the Roadmap: the phase cannot be an edge endpoint. */
  duplicateId: boolean;
  diagnostics: RoadmapDiagnosticCode[];
  storyKeys: string[];
}

export type UnlinkedReason = 'duplicate_id' | 'outside' | 'unmatched' | 'ambiguous' | 'unverified' | 'phase_not_shown';

export interface StoryNode {
  kind: 'story';
  key: string;
  /** Position in the Story Index. */
  index: number;
  id: string;
  title: string | null;
  status: StatusView;
  date: string | null;
  /** How many entries of the index declare this id. */
  idCount: number;
  phaseRef: StoryPhaseRef;
  diagnostics: StoryIndexDiagnosticCode[];
  /** The Story Index entry that active.md's unambiguous claim names. */
  current: boolean;
  /** Key of the phase this story is confirmed to belong to; `null` = no edge. */
  phaseKey: string | null;
  unlinkedReason: UnlinkedReason | null;
}

/** The current story, claimed by active.md, that is not in the (finished-stories) index. Not completed, not in a phase. */
export interface CurrentOutsideNode {
  kind: 'current';
  key: string;
  id: string;
}

export type GraphNode = PhaseNode | StoryNode | CurrentOutsideNode;

export interface GraphEdge {
  key: string;
  from: string;
  to: string;
}

export interface GraphProjection {
  phases: PhaseNode[];
  stories: StoryNode[];
  currentOutside: CurrentOutsideNode[];
  edges: GraphEdge[];
  notices: Notice[];
  /** The Roadmap was read completely (`state === 'ok'`). When false, "unmatched" does not prove a phase is missing. */
  roadmapReliable: boolean;
  hasData: boolean;
}

export const STORY_DIAGNOSTIC_LABELS: Record<StoryIndexDiagnosticCode, string> = {
  DOCUMENT_EMPTY: 'The story index document is empty.',
  STORIES_NOT_FOUND: 'No story section was found in the story index.',
  NO_FINALIZED_STORIES: 'No story has been finalized yet. This is expected before the first finalization.',
  STORY_HEADING_MALFORMED: 'A story heading could not be read and was skipped.',
  PHASE_HEADING_MALFORMED: 'A phase heading in the story index could not be read.',
  STORIES_TRUNCATED: 'Too many stories; the list was truncated.',
  STORY_ID_DUPLICATE: 'The story id is declared more than once.',
  STORY_OUTSIDE_PHASE: 'The story is not nested under any phase heading.',
  STORY_STATUS_MISSING: 'The story states no status.',
  STORY_STATUS_EMPTY: 'The story has an empty status field.',
  STORY_STATUS_CONFLICT: 'The story states contradicting statuses; none is shown.',
  STORY_STATUS_UNRECOGNIZED: 'The story status is not a recognised value.',
  STORY_PHASE_UNMATCHED: 'The phase the story is nested under matches no phase of the roadmap.',
  STORY_PHASE_AMBIGUOUS: 'The phase the story is nested under matches more than one roadmap phase.',
  STORY_PHASE_UNVERIFIED: 'The roadmap supplied no phase ids, so the story\'s phase is not confirmed.',
  INTERNAL: 'The story index could not be interpreted (internal error).',
};

export const ROADMAP_DIAGNOSTIC_LABELS: Record<RoadmapDiagnosticCode, string> = {
  DOCUMENT_EMPTY: 'The roadmap document is empty.',
  PHASES_SECTION_MISSING: 'No "Phases" section was found.',
  PHASES_SECTION_DUPLICATED: 'More than one "Phases" section; only the first was read.',
  NO_PHASES_FOUND: 'The "Phases" section contains no phase in the expected form ("### Phase <id> — <title>" + "**Status:**"); a table there is not read as phases. Contract: document-formats.md (run `monolith update` if it is missing).',
  PHASE_HEADING_MALFORMED: 'A phase heading could not be read and was skipped.',
  PHASES_TRUNCATED: 'Too many phases; the list was truncated.',
  PHASE_STATUS_MISSING: 'The phase states no status.',
  PHASE_STATUS_EMPTY: 'The phase has an empty status field.',
  PHASE_STATUS_CONFLICT: 'The phase states contradicting statuses; none is shown.',
  PHASE_STATUS_UNRECOGNIZED: 'The phase status is not a recognised value.',
  PHASE_DETAILS_TRUNCATED: 'The phase details were truncated.',
  PHASE_ID_DUPLICATE: 'The phase id is used more than once.',
  ACTIVE_PHASE_CONFLICT: 'The document names different active phases.',
  ACTIVE_PHASE_UNMATCHED: 'The active-phase pointer names no recognised phase.',
  ACTIVE_PHASE_AMBIGUOUS_ID: 'The active-phase pointer names a duplicated phase id.',
  ACTIVE_PHASE_REPORTED_COMPLETE: 'The active phase reports itself as complete.',
  INTERNAL: 'The roadmap could not be interpreted (internal error).',
};

const ROADMAP_STATE_TEXT: Record<'empty' | 'no_phases' | 'unrecognized' | 'error' | 'partial', string> = {
  empty: 'The roadmap document is empty: no phases can be shown.',
  no_phases: 'The roadmap has a "Phases" section, but no phase could be read from it.',
  unrecognized: 'The roadmap structure was not recognised: no phases can be shown.',
  error: 'The roadmap could not be interpreted: no phases can be shown.',
  partial: 'Only part of the roadmap could be read. A phase that is "not found" below may still exist in the document.',
};

const STORY_STATE_TEXT: Record<'empty' | 'none_finalized' | 'no_stories' | 'unrecognized' | 'error' | 'partial', string> = {
  empty: 'The story index is empty: no stories are shown.',
  none_finalized: 'No story has been finalized yet: the story index is valid and empty.',
  no_stories: 'The story index has phase sections but lists no story.',
  unrecognized: 'The story index structure was not recognised: no stories are shown.',
  error: 'The story index could not be interpreted: no stories are shown.',
  partial: 'Only part of the story index could be read; the stories shown are not necessarily all of them.',
};

const ACTIVE_PHASE_TEXT: Record<'none' | 'not_declared' | 'unmatched' | 'ambiguous', string> = {
  none: 'The roadmap states that there is no active phase.',
  not_declared: 'The roadmap does not declare an active phase.',
  unmatched: 'The roadmap points to an active phase that is not among the recognised phases.',
  ambiguous: 'The roadmap\'s active-phase indication is ambiguous or contradictory; no phase is marked current.',
};

export const UNLINKED_LABELS: Record<UnlinkedReason, string> = {
  duplicate_id: 'Story id declared more than once — no link drawn',
  outside: 'Not nested under any phase',
  unmatched: 'Phase not found in the roadmap',
  ambiguous: 'Phase id matches several roadmap phases',
  unverified: 'Phase not confirmed (roadmap unreadable)',
  phase_not_shown: 'Phase reference could not be resolved to a single displayed phase',
};

/** Order in which unlinked groups are shown. */
export const UNLINKED_ORDER: UnlinkedReason[] = ['duplicate_id', 'unmatched', 'ambiguous', 'unverified', 'phase_not_shown', 'outside'];

function countBy<T>(items: T[], key: (t: T) => string | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function projectExecutionGraph(input: ProjectionInput): GraphProjection {
  const notices: Notice[] = [];
  const { roadmap, roadmapText, storyIndex, story } = input;

  // ---- Roadmap ----
  let roadmapReliable = false;
  if (roadmapText === null) {
    notices.push({ code: 'ROADMAP_UNAVAILABLE', tone: 'error', text: 'The roadmap is not available: phases cannot be shown.' });
  } else if (roadmap === undefined) {
    notices.push({ code: 'ROADMAP_NOT_STRUCTURED', tone: 'warn', text: 'This data source provides no structured roadmap: phases cannot be shown.' });
  } else {
    roadmapReliable = roadmap.state === 'ok';
    if (roadmap.state !== 'ok') notices.push({ code: `ROADMAP_${roadmap.state.toUpperCase()}`, tone: 'warn', text: ROADMAP_STATE_TEXT[roadmap.state] });
    for (const d of roadmap.diagnostics) {
      if (d.phaseIndex === null) notices.push({ code: `ROADMAP_${d.code}`, tone: d.severity === 'warn' ? 'warn' : 'info', text: ROADMAP_DIAGNOSTIC_LABELS[d.code] });
    }
  }

  const roadmapPhases = roadmapText !== null && roadmap !== undefined ? roadmap.phases : [];
  const phaseIdCounts = countBy(roadmapPhases, (p) => p.id);
  const activeId = roadmap !== undefined && roadmap.activePhase.kind === 'phase' ? roadmap.activePhase.id : null;
  if (roadmap !== undefined && roadmapText !== null && roadmap.activePhase.kind !== 'phase' && roadmapPhases.length > 0) {
    notices.push({ code: `ACTIVE_${roadmap.activePhase.kind.toUpperCase()}`, tone: 'info', text: ACTIVE_PHASE_TEXT[roadmap.activePhase.kind] });
  }

  const phaseDiag = new Map<number, RoadmapDiagnosticCode[]>();
  for (const d of roadmap?.diagnostics ?? []) {
    if (d.phaseIndex !== null) phaseDiag.set(d.phaseIndex, [...(phaseDiag.get(d.phaseIndex) ?? []), d.code]);
  }

  const phases: PhaseNode[] = roadmapPhases.map((p, index) => {
    const duplicateId = p.id !== null && (phaseIdCounts.get(p.id) ?? 0) > 1;
    return {
      kind: 'phase',
      key: `phase:${index}`,
      index,
      id: p.id,
      title: p.title,
      status: { value: p.status.value, recognized: p.status.recognized },
      // CURRENT is shown only for the phase Core named, and only when that id is unambiguous here.
      current: p.id !== null && p.id === activeId && !duplicateId,
      duplicateId,
      diagnostics: phaseDiag.get(index) ?? [],
      storyKeys: [],
    };
  });
  const linkablePhase = new Map<string, PhaseNode>();
  for (const p of phases) if (p.id !== null && !p.duplicateId) linkablePhase.set(p.id, p);

  // ---- Story Index ----
  let storiesSrc: StructuredStoryIndexView['stories'] = [];
  let indexDiag: StructuredStoryIndexView['diagnostics'] = [];
  if (storyIndex === undefined) {
    notices.push({ code: 'STORY_INDEX_NOT_PROVIDED', tone: 'warn', text: 'This server does not provide the story index (older version): stories cannot be shown.' });
  } else if (storyIndex.data === null) {
    const src = storyIndex.sources[0];
    const absent = src !== undefined && src.status === 'absent';
    notices.push({
      code: absent ? 'STORY_INDEX_ABSENT' : 'STORY_INDEX_ERROR',
      tone: absent ? 'warn' : 'error',
      text: absent
        ? 'The story index is not available (the file does not exist): stories cannot be shown.'
        : `The story index could not be read${src?.code ? ` [${src.code}]` : ''}: stories cannot be shown.`,
    });
  } else {
    storiesSrc = storyIndex.data.stories;
    indexDiag = storyIndex.data.diagnostics;
    if (storyIndex.data.state !== 'ok') notices.push({ code: `STORY_INDEX_${storyIndex.data.state.toUpperCase()}`, tone: storyIndex.data.state === 'none_finalized' ? 'info' : 'warn', text: STORY_STATE_TEXT[storyIndex.data.state] });
    for (const d of indexDiag) {
      if (d.storyIndex === null) notices.push({ code: `STORY_${d.code}`, tone: d.severity === 'warn' ? 'warn' : 'info', text: STORY_DIAGNOSTIC_LABELS[d.code] });
    }
  }

  const storyDiag = new Map<number, StoryIndexDiagnosticCode[]>();
  for (const d of indexDiag) {
    if (d.storyIndex !== null) storyDiag.set(d.storyIndex, [...(storyDiag.get(d.storyIndex) ?? []), d.code]);
  }
  const storyIdCounts = countBy(storiesSrc, (s) => s.id);

  // ---- Current story (active.md claim) ----
  let currentId: string | null = null;
  if (story !== undefined && story.kind === 'active') {
    if (story.ids.length === 1) currentId = story.ids[0]!;
    else notices.push({ code: 'CURRENT_STORY_AMBIGUOUS', tone: 'warn', text: `The current-story claim names ${story.ids.length} stories (${story.ids.join(', ')}); none is selected.` });
  } else if (story !== undefined && (story.kind === 'unknown' || story.kind === 'source')) {
    notices.push({ code: 'CURRENT_STORY_UNKNOWN', tone: 'info', text: 'The current story could not be identified from active.md; none is shown.' });
  }
  const currentInIndex = currentId === null ? 0 : (storyIdCounts.get(currentId) ?? 0);
  if (currentId !== null && currentInIndex > 1) {
    notices.push({ code: 'CURRENT_STORY_DUPLICATE', tone: 'warn', text: `The current story ${currentId} is declared more than once in the story index; none of the entries is marked current.` });
  }

  const edges: GraphEdge[] = [];
  const stories: StoryNode[] = storiesSrc.map((s, index) => {
    const idCount = storyIdCounts.get(s.id) ?? 1;
    const duplicate = idCount > 1 || s.idStatus === 'duplicate';
    const key = `story:${index}`;
    let phaseKey: string | null = null;
    let unlinkedReason: UnlinkedReason | null = null;
    if (duplicate) {
      unlinkedReason = 'duplicate_id';
    } else if (s.phase.kind === 'matched') {
      const target = linkablePhase.get(s.phase.phaseId);
      if (target !== undefined) {
        phaseKey = target.key;
        target.storyKeys.push(key);
        edges.push({ key: `${target.key}>${key}`, from: target.key, to: key });
      } else {
        unlinkedReason = 'phase_not_shown';
      }
    } else {
      unlinkedReason = s.phase.kind;
    }
    return {
      kind: 'story',
      key,
      index,
      id: s.id,
      title: s.title,
      status: { value: s.status.value, recognized: s.status.recognized },
      date: s.date,
      idCount,
      phaseRef: s.phase,
      diagnostics: storyDiag.get(index) ?? [],
      current: currentId !== null && s.id === currentId && currentInIndex === 1,
      phaseKey,
      unlinkedReason,
    };
  });

  const currentOutside: CurrentOutsideNode[] =
    currentId !== null && currentInIndex === 0 ? [{ kind: 'current', key: `current:${currentId}`, id: currentId }] : [];

  // An unmatched/unverified reference under a roadmap that was not fully read is not proof of absence.
  if (!roadmapReliable && roadmapText !== null && stories.some((s) => s.unlinkedReason === 'unmatched' || s.unlinkedReason === 'unverified')) {
    notices.push({
      code: 'ROADMAP_LIMITS_MATCHING',
      tone: 'warn',
      text: 'The roadmap was not fully readable, so stories shown as "not found" or "not confirmed" may still belong to a phase that exists in the document.',
    });
  }

  return { phases, stories, currentOutside, edges, notices, roadmapReliable, hasData: phases.length > 0 || stories.length > 0 || currentOutside.length > 0 };
}
