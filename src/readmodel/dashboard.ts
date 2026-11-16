/**
 * `readDashboardModel(projectRoot)` — builds the DashboardReadModel.
 *
 * Contract:
 *  - `projectRoot` is supplied by the embedding process (fixed at startup),
 *    never by a request. The set of files read is closed (see SourceId).
 *  - Strictly read-only and synchronous: no write, no lock, no `mutateState`,
 *    no `validate`, no `import()` of project code, no network. Nothing is
 *    cached; every call re-reads.
 *  - Never throws. Failures become SourceReport / ReadNote data.
 *  - Deterministic: same files ⇒ deep-equal result; no timestamps.
 *
 * Containment (G1): the instance root is resolved with `resolveMonolithRoot`
 * (ADR-009) and every file is read with `readProjectFile`, which realpath-checks
 * each path component against the real project root and then performs the
 * bounded, non-blocking read of SEC-001B.1. `readState` is deliberately NOT
 * used: it does not check containment. Check-then-use races are NOT closed by
 * Core (SEC-001B) and are therefore not closed here.
 *
 * Every source goes through `readProjectFile` (ADR-014): no symlink in any
 * component, one hard link, regular file, absolute boundary, never the cwd.
 * This module adds no filesystem checks of its own; it only interprets Core's
 * typed result (`FILE_CODE_MAP`). Threat model (ADR-013): TM-A supported with
 * limitations, TM-B partially supported, TM-C (concurrent mutation) NOT supported.
 */

import { MAX_STATE_BYTES, validateState } from '../coordinatorium/index.js';
import { resolveStateLocation, collectStateProvenance, openStateFileBounded, type StateLocation, type StateProvenance } from '../coordinatorium/state-location.js';
import { relative } from 'path';
import type { CoordinatoriumState } from '../coordinatorium/types.js';
import {
  CONFIG_FILE_NAME,
  MAX_PROJECT_FILE_BYTES,
  isReadSecurityViolation,
  RootContainmentError,
  readProjectFile,
  resolveMonolithRoot,
  type ConfigRead,
  type ProjectFileErrorCode,
  type ResolvedMonolithRoot,
} from '../root/index.js';
import { MAX_ACTIVE_CONTEXT_BYTES } from '../brief/collect.js';
import { ACTIVE_MD_REL } from '../brief/constants.js';
import { extractCurrentStory } from '../brief/story.js';
import { parseActiveStoryClaim } from '../brief/freshness.js';
import { parseRoadmapPhases } from './roadmap.js';
import {
  hasCheckpointOrderMismatch,
  selectActiveMissions,
  selectLatestCheckpoint,
} from '../brief/selectors.js';
import type {
  CheckpointsData,
  CurrentMissions,
  DashboardReadModel,
  ProjectOverview,
  ReadNote,
  StateProvenanceView,
  RoadmapData,
  StoryClaimView,
  StructuredRoadmapView,
  Section,
  SourceErrorCode,
  SourceId,
  SourceReport,
  SourceStatus,
} from './types.js';

export const ROADMAP_REL = 'context/maps/roadmap-index.md';
/** Protective ceiling, like the other SEC-001B.1 limits — not a content policy. */
export const MAX_ROADMAP_BYTES = 256 * 1024;

const CHANGED_RETRIES = 3;

interface Loaded {
  report: SourceReport;
  content: string | null;
}

/**
 * Exhaustive over Core's `ProjectFileErrorCode`: a new Core code is a compile
 * error here until it is mapped. The status of a security violation is NOT
 * decided here — `sourceFailure` takes it from Core's `isReadSecurityViolation`,
 * so the UI keeps no second classification of filesystem security. The
 * 'forbidden' entries only document that and are checked against Core in tests.
 */
export const FILE_CODE_MAP: Readonly<Record<ProjectFileErrorCode, readonly [SourceStatus, SourceErrorCode]>> = {
  FILE_MISSING: ['absent', 'SOURCE_ABSENT'],
  FILE_OUTSIDE_PROJECT: ['forbidden', 'SOURCE_OUTSIDE_PROJECT'],
  FILE_UNRESOLVABLE: ['unreadable', 'SOURCE_UNRESOLVABLE'],
  FILE_NOT_REGULAR: ['forbidden', 'SOURCE_NOT_REGULAR'],
  FILE_EMPTY: ['corrupt', 'SOURCE_EMPTY'],
  FILE_TOO_LARGE: ['unreadable', 'SOURCE_TOO_LARGE'],
  FILE_CHANGED: ['unreadable', 'SOURCE_CHANGED'],
  FILE_UNREADABLE: ['unreadable', 'SOURCE_UNREADABLE'],
  FILE_SYMLINK: ['forbidden', 'SOURCE_SYMLINK'],
  FILE_HARDLINKED: ['forbidden', 'SOURCE_HARDLINKED'],
  READ_BOUNDARY_INVALID: ['forbidden', 'SOURCE_BOUNDARY_INVALID'],
  READ_UNSUPPORTED_PLATFORM: ['forbidden', 'SOURCE_UNSUPPORTED_PLATFORM'],
};

/** Never maps a security violation to anything but 'forbidden'; no default for unknown codes. */
function sourceFailure(code: ProjectFileErrorCode): [SourceStatus, SourceErrorCode] {
  const [status, sourceCode] = FILE_CODE_MAP[code];
  return [isReadSecurityViolation(code) ? 'forbidden' : status, sourceCode];
}

function report(id: SourceId, path: string | null, status: SourceStatus, code: SourceErrorCode | null): SourceReport {
  return { id, path, status, code };
}

function withStatus(r: SourceReport, status: SourceStatus, code: SourceErrorCode | null): SourceReport {
  return { ...r, status, code };
}

/** One contained, bounded read of a fixed project-relative path. */
function load(projectRoot: string, id: SourceId, relPath: string, maxBytes: number): Loaded {
  try {
    let read = readProjectFile(projectRoot, relPath, { maxBytes, allowEmpty: true });
    // A rename-based writer replacing the file under us is normal, not a fault.
    for (let i = 1; i < CHANGED_RETRIES && !read.ok && read.code === 'FILE_CHANGED'; i++) {
      read = readProjectFile(projectRoot, relPath, { maxBytes, allowEmpty: true });
    }
    if (read.ok) return { report: report(id, relPath, 'available', null), content: read.content };
    const [status, code] = sourceFailure(read.code);
    return { report: report(id, relPath, status, code), content: null };
  } catch {
    return { report: report(id, relPath, 'unreadable', 'INTERNAL'), content: null };
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

interface ConfigResult {
  report: SourceReport;
  read: ConfigRead | null;
  name: string | null;
}

function loadConfig(projectRoot: string): ConfigResult {
  const loaded = load(projectRoot, 'config', CONFIG_FILE_NAME, MAX_PROJECT_FILE_BYTES);
  if (loaded.report.status === 'absent') return { report: loaded.report, read: { status: 'absent' }, name: null };
  if (loaded.content === null) {
    return { report: loaded.report, read: null, name: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(loaded.content);
  } catch {
    return { report: withStatus(loaded.report, 'corrupt', 'CONFIG_INVALID'), read: null, name: null };
  }
  if (!isPlainObject(parsed)) {
    return { report: withStatus(loaded.report, 'corrupt', 'CONFIG_INVALID'), read: null, name: null };
  }
  const project = parsed.project;
  const rawName = isPlainObject(project) ? project.name : undefined;
  const name = typeof rawName === 'string' && rawName.length > 0 ? rawName : null;
  return { report: loaded.report, read: { status: 'ok', cfg: parsed }, name };
}

interface StateResult {
  report: SourceReport;
  state: CoordinatoriumState | null;
  schemaVersionOnDisk: number | null;
  provenance: StateProvenanceView | null;
}

function provenanceView(loc: StateLocation, p: StateProvenance): StateProvenanceView {
  return {
    mode: loc.kind === 'git-common-dir' ? 'shared' : loc.mode === 'isolated' ? 'isolated' : 'local',
    location: loc.kind,
    localReason: loc.localReason,
    statePath: loc.displayPath,
    revision: p.canonical.revision,
    schemaVersion: p.canonical.schemaVersion,
    monolithVersion: p.monolithVersion,
    repositoryIdentity: p.repositoryIdentity,
    worktreeCount: p.worktreeCount,
    splitBrain: {
      detected: p.splitBrain.detected,
      canonicalMissingWithLocalData: p.splitBrain.canonicalMissingWithLocalData,
      localStates: p.splitBrain.candidates.map((c) => ({
        path: relative(loc.projectRoot, c.path),
        status: c.status === 'absent' ? 'unreadable' : c.status,
        schemaVersion: c.schemaVersion,
        revision: c.revision,
        missionCount: c.missionCount,
        checkpointCount: c.checkpointCount,
        currentWorktree: c.current,
      })),
    },
  };
}

function loadState(projectRoot: string, root: ResolvedMonolithRoot, config: ConfigRead): StateResult {
  let loc: StateLocation;
  try {
    loc = resolveStateLocation(projectRoot, config);
  } catch {
    return {
      report: report('state', null, 'unreadable', 'SOURCE_BOUNDARY_INVALID'),
      state: null,
      schemaVersionOnDisk: null,
      provenance: null,
    };
  }
  let provenance: StateProvenanceView | null = null;
  try {
    provenance = provenanceView(loc, collectStateProvenance(loc));
  } catch {
    /* provenance is additive diagnostics: its failure never hides the state itself */
  }

  let loaded: Loaded;
  if (loc.kind === 'git-common-dir') {
    // The shared directory lies outside the project root, so it is its own boundary.
    try {
      const read = openStateFileBounded(loc, loc.displayPath, projectRoot);
      if (read.ok && 'content' in read) {
        loaded = { report: report('state', loc.displayPath, 'available', null), content: read.content };
      } else if (!read.ok) {
        const [status, code] = sourceFailure(read.code);
        loaded = { report: report('state', loc.displayPath, status, code), content: null };
      } else {
        loaded = { report: report('state', loc.displayPath, 'unreadable', 'INTERNAL'), content: null };
      }
    } catch {
      loaded = { report: report('state', loc.displayPath, 'unreadable', 'INTERNAL'), content: null };
    }
  } else {
    loaded = load(projectRoot, 'state', `${root.monolithRoot}/state.json`, MAX_STATE_BYTES);
  }
  if (loaded.content === null) return { report: loaded.report, state: null, schemaVersionOnDisk: null, provenance };

  const corrupt = (code: SourceErrorCode): StateResult => ({
    report: withStatus(loaded.report, 'corrupt', code),
    state: null,
    schemaVersionOnDisk: null,
    provenance,
  });
  if (loaded.content.trim() === '') return corrupt('SOURCE_EMPTY');
  let parsed: unknown;
  try {
    parsed = JSON.parse(loaded.content);
  } catch {
    return corrupt('PARSE_ERROR');
  }
  try {
    const state = validateState(parsed);
    const onDisk = isPlainObject(parsed) && typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : null;
    return { report: loaded.report, state, schemaVersionOnDisk: onDisk, provenance };
  } catch {
    return corrupt('SCHEMA_INVALID');
  }
}

function section<T>(data: T | null, sources: SourceReport[]): Section<T> {
  return { data, sources };
}

/** Root could not be trusted: nothing below it is read (fail closed, never a default fallback). */
function unreadableModel(config: SourceReport, rootCode: SourceErrorCode = 'ROOT_INVALID'): DashboardReadModel {
  const refused = (id: SourceId): SourceReport => report(id, null, 'forbidden', rootCode);
  const state = refused('state');
  const story = refused('activeStory');
  const roadmap = refused('roadmap');
  return {
    projectOverview: section<ProjectOverview>(null, [config, state, story]),
    currentMissions: section<CurrentMissions>(null, [state]),
    checkpoints: section<CheckpointsData>(null, [state]),
    roadmap: section<RoadmapData>(null, [roadmap]),
    diagnostics: { validation: 'NOT_PERFORMED', sources: [config, state, story, roadmap], notes: [] },
  };
}

function buildModel(projectRoot: string): DashboardReadModel {
  const config = loadConfig(projectRoot);
  if (config.read === null) return unreadableModel(config.report);

  let root: ResolvedMonolithRoot;
  try {
    root = resolveMonolithRoot(projectRoot, config.read);
  } catch (err) {
    if (err instanceof RootContainmentError) return unreadableModel(config.report);
    throw err;
  }

  const notes: ReadNote[] = [];
  const stateResult = loadState(projectRoot, root, config.read);
  const storyLoaded = load(projectRoot, 'activeStory', `${root.monolithRoot}/${ACTIVE_MD_REL}`, MAX_ACTIVE_CONTEXT_BYTES);
  const roadmapLoaded = load(projectRoot, 'roadmap', `${root.monolithRoot}/${ROADMAP_REL}`, MAX_ROADMAP_BYTES);

  // An absent state.json means "no missions ever recorded", exactly like `brief`.
  const stateUsable = stateResult.report.status === 'available' || stateResult.report.status === 'absent';
  const state = stateResult.state;
  const missions = state ? Object.values(state.tactical.missions) : [];
  const active = state ? selectActiveMissions(state) : [];

  if (stateResult.provenance?.splitBrain.detected) notes.push({ code: 'STATE_SPLIT_BRAIN', severity: 'warn' });
  if (active.length > 1) notes.push({ code: 'MULTIPLE_ACTIVE_MISSIONS', severity: 'info' });

  let currentStory: ProjectOverview['currentStory'] = null;
  let storyClaim: StoryClaimView | null = null;
  if (storyLoaded.content !== null) {
    const extraction = extractCurrentStory(storyLoaded.content);
    if (extraction.hasCurrentStorySection && extraction.excerpt !== null && extraction.lineRange !== null) {
      currentStory = { excerpt: extraction.excerpt, lineRange: extraction.lineRange };
      // Core's existing parser; no second Story parser in the read model.
      const claim = parseActiveStoryClaim(extraction.excerpt);
      storyClaim = claim.kind === 'ids' ? { kind: 'ids', ids: [...claim.ids] } : { kind: claim.kind };
    } else {
      notes.push({ code: 'ACTIVE_MD_NO_CURRENT_STORY', severity: 'info' });
    }
  }

  const overview: ProjectOverview = {
    name: config.name,
    monolithRoot: root.monolithRoot,
    monolithRootSource: root.source,
    stateSchemaVersionOnDisk: stateResult.schemaVersionOnDisk,
    stateRevision: state && stateResult.report.status === 'available' ? state.revision : null,
    activeMissionCount: stateUsable ? active.length : null,
    finishedMissionCount: stateUsable ? missions.length - active.length : null,
    currentStory,
    storyClaim,
  };

  const currentMissions: CurrentMissions | null = stateUsable ? { active } : null;

  let checkpoints: CheckpointsData | null = null;
  if (state !== null || stateResult.report.status === 'absent') {
    const all = state ? Object.values(state.tactical.checkpoints) : [];
    checkpoints = {
      byActiveMission: active.map((m) => {
        const latest = state ? selectLatestCheckpoint(state, m.id) : null;
        if (state && latest && hasCheckpointOrderMismatch(state, m.id, latest)) {
          notes.push({ code: 'CHECKPOINT_ORDER_MISMATCH', severity: 'info' });
        }
        return { missionId: m.id, count: all.filter((c) => c.missionId === m.id).length, latest };
      }),
    };
  }

  let roadmap: RoadmapData | null = null;
  if (roadmapLoaded.content !== null) {
    let structured: StructuredRoadmapView;
    try {
      structured = parseRoadmapPhases(roadmapLoaded.content);
    } catch {
      // A parser fault is reported as such, never as an empty roadmap.
      structured = { state: 'error', phases: [], activePhase: { kind: 'not_declared' }, diagnostics: [{ code: 'INTERNAL', severity: 'warn', phaseIndex: null }] };
    }
    roadmap = { text: roadmapLoaded.content, structured };
  }

  return {
    projectOverview: section(overview, [config.report, stateResult.report, storyLoaded.report]),
    currentMissions: section(currentMissions, [stateResult.report]),
    checkpoints: section(checkpoints, [stateResult.report]),
    roadmap: section(roadmap, [roadmapLoaded.report]),
    diagnostics: {
      validation: 'NOT_PERFORMED',
      sources: [config.report, stateResult.report, storyLoaded.report, roadmapLoaded.report],
      notes,
      ...(stateResult.provenance ? { state: stateResult.provenance } : {}),
    },
  };
}

export function readDashboardModel(projectRoot: string): DashboardReadModel {
  try {
    return buildModel(projectRoot);
  } catch {
    // Unexpected fault: report it as data, without any message or path.
    const internal = report('config', null, 'unreadable', 'INTERNAL');
    return unreadableModel(internal, 'INTERNAL');
  }
}
