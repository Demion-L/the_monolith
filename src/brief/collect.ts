/**
 * `collect()` — the read-only Collection stage of the brief pipeline.
 *
 * readMonolithRoot → collect() → BriefModel → render(model, budget) → stdout
 *
 * Strictly read-only: no directories, lock files, or state.json are ever
 * created; `mutateState()` is never imported here. state.json is read at
 * most once (one `readFile` call) per invocation — every section that needs
 * Coordinatorium data derives it from that single snapshot via the pure
 * selectors in selectors.ts, never by calling `listMissions()`/
 * `listCheckpoints()` (which each independently re-read the file).
 */

import { existsSync } from 'fs';
import { join, relative, posix } from 'path';
import { readBriefConfig } from './config.js';
import {
  resolveMonolithRootValue,
  checkContainedFile,
  readBoundedFileStable,
  isReadSecurityViolation,
  findWriteArtifacts,
  describeWriteArtifacts,
  type ResolvedMonolithRoot,
} from '../root/index.js';
import { discoverDocs } from './docs.js';
import { extractCurrentStory } from './story.js';
import {
  selectActiveMissions,
  selectRecentFinishedMissions,
  selectLatestCheckpoint,
  hasCheckpointOrderMismatch,
} from './selectors.js';
import { stateFilePath, validateState, createInitialState, MAX_STATE_BYTES } from '../coordinatorium/index.js';
import type { CoordinatoriumState } from '../coordinatorium/types.js';
import type {
  BriefModel,
  BriefDiagnostic,
  StateKeeperSummary,
  MissionsSummary,
  CheckpointSummary,
  StorySummary,
  ParkedIdeasSummary,
} from './types.js';
import { ACTIVE_MD_REL, PARKED_IDEAS_LIMIT, PROTOCOLS_DIR, ROADMAP_INDEX_REL, STORY_INDEX_REL, HANDOFF_REL } from './constants.js';
import {
  evaluateFreshness,
  parseActiveStoryClaim,
  parseRoadmapActiveStory,
  parseRoadmapStatuses,
  parseStoryIndexStatuses,
  type FreshnessResult,
  type FreshnessEvidence,
} from './freshness.js';
import { readGitSignals } from './git-signals.js';
import { ideaStore, listIdeas } from '../ideas/index.js';
import { ideaNumber } from '../ideas/format.js';

const RECENT_FINISHED_MISSIONS_LIMIT = 5;

/** SEC-001B.1: `active.md` is a short hand-written context file (~3 KB today). */
export const MAX_ACTIVE_CONTEXT_BYTES = 256 * 1024;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function readStateForBrief(
  targetDir: string,
  monolithRoot: string,
  root: ResolvedMonolithRoot,
  diagnostics: BriefDiagnostic[],
): Promise<{ summary: StateKeeperSummary; state: CoordinatoriumState }> {
  const stateDir = join(targetDir, monolithRoot);
  const filePath = stateFilePath(stateDir);
  const provenance = { source: relative(targetDir, filePath) };

  // SEC-001A: never read a state.json that resolves outside the project.
  const escape = checkContainedFile(root, 'state.json');
  if (escape) {
    diagnostics.push({
      code: 'PATH_OUTSIDE_PROJECT',
      severity: 'error',
      message: `${provenance.source} was not read: ${escape.message}`,
    });
    return { summary: { status: 'unreadable', provenance }, state: createInitialState() };
  }

  // Rule (section 4, #1): existence is established by the same bounded,
  // non-blocking open that reads the file (SEC-001B.1) — a FIFO or an
  // over-limit file is rejected before any content is read.
  const read = readBoundedFileStable(
    filePath,
    provenance.source,
    { boundary: targetDir, maxBytes: MAX_STATE_BYTES, allowEmpty: true },
    true,
  );
  if (!read.ok && read.code === 'FILE_MISSING') {
    diagnostics.push({
      code: 'STATE_NOT_INITIALIZED',
      severity: 'info',
      message: `${provenance.source} does not exist — no missions have ever been recorded.`,
      readCode: 'FILE_MISSING',
    });
    return { summary: { status: 'absent', provenance }, state: createInitialState() };
  }
  if (!read.ok) {
    diagnostics.push({
      code: 'STATE_UNREADABLE',
      severity: 'error',
      message: `${provenance.source} exists but could not be read: ${read.code}: ${read.detail}`,
      readCode: read.code,
    });
    return { summary: { status: 'unreadable', provenance }, state: createInitialState() };
  }
  const raw = 'content' in read ? read.content : '';

  // A literally empty file is distinguished from corrupted content
  // (DEC-CONTEXT-002: "corrupted state.json must not be treated as empty
  // state") precisely so the STATE_UNREADABLE path below is never reached
  // for this case by accident — it gets its own diagnostic instead.
  //
  // Review finding F-1: an empty state.json means no actual state could be
  // read — that is a loss of information, not a benign "zero missions"
  // result (which only a successfully parsed, valid file can report).
  // severity 'error' here is what makes render() treat this as INCOMPLETE
  // (and --strict exit 2), the same way STATE_UNREADABLE already does.
  if (raw.trim() === '') {
    diagnostics.push({
      code: 'STATE_EMPTY',
      severity: 'error',
      message: `${provenance.source} exists but is empty — no state could be read.`,
    });
    return { summary: { status: 'empty', provenance }, state: createInitialState() };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    diagnostics.push({
      code: 'STATE_UNREADABLE',
      severity: 'error',
      message: `${provenance.source} is not valid JSON: ${msg}`,
    });
    return { summary: { status: 'unreadable', provenance }, state: createInitialState() };
  }

  const onDiskSchemaVersion =
    isPlainObject(parsedJson) && typeof parsedJson.schemaVersion === 'number' ? parsedJson.schemaVersion : undefined;

  let state: CoordinatoriumState;
  try {
    // Supports schemaVersion 2 and an in-memory v1→v2 migration of legacy
    // files — nothing is ever written back (section 4, #6/#7).
    state = validateState(parsedJson);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    diagnostics.push({
      code: 'STATE_UNREADABLE',
      severity: 'error',
      message: `${provenance.source} failed schema validation: ${msg}`,
    });
    return { summary: { status: 'unreadable', schemaVersionOnDisk: onDiskSchemaVersion, provenance }, state: createInitialState() };
  }

  if (onDiskSchemaVersion === 1) {
    diagnostics.push({
      code: 'STATE_LEGACY_SCHEMA_MIGRATED',
      severity: 'info',
      message: `${provenance.source} is schemaVersion 1 — read via the existing in-memory v1→v2 migration; nothing was written to disk.`,
    });
  }

  return { summary: { status: 'ok', schemaVersionOnDisk: onDiskSchemaVersion, provenance }, state };
}

function collectMissions(
  targetDir: string,
  monolithRoot: string,
  state: CoordinatoriumState,
  diagnostics: BriefDiagnostic[],
): MissionsSummary {
  const active = selectActiveMissions(state);
  const recentFinished = selectRecentFinishedMissions(state, RECENT_FINISHED_MISSIONS_LIMIT);

  if (active.length > 1) {
    diagnostics.push({
      code: 'MULTIPLE_ACTIVE_MISSIONS',
      severity: 'info',
      message: `${active.length} missions are in_progress simultaneously: ${active.map((m) => m.id).join(', ')}.`,
    });
  }

  const filePath = stateFilePath(join(targetDir, monolithRoot));
  return { active, recentFinished, provenance: { source: `${relative(targetDir, filePath)}#tactical.missions` } };
}

function collectCheckpoints(
  targetDir: string,
  monolithRoot: string,
  state: CoordinatoriumState,
  active: MissionsSummary['active'],
  diagnostics: BriefDiagnostic[],
): CheckpointSummary[] {
  const filePath = stateFilePath(join(targetDir, monolithRoot));
  const provenance = { source: `${relative(targetDir, filePath)}#tactical.checkpoints` };

  return active.map((m) => {
    const latest = selectLatestCheckpoint(state, m.id);
    if (latest && hasCheckpointOrderMismatch(state, m.id, latest)) {
      diagnostics.push({
        code: 'CHECKPOINT_ORDER_MISMATCH',
        severity: 'info',
        message: `Mission "${m.id}": another checkpoint has a later createdAt than "${latest.id}" (the highest-ordinal one) — timestamp order and ID order disagree.`,
      });
    }
    return { missionId: m.id, latest, provenance };
  });
}

function collectStory(
  targetDir: string,
  monolithRoot: string,
  root: ResolvedMonolithRoot,
  diagnostics: BriefDiagnostic[],
): StorySummary {
  const activeMdAbs = join(targetDir, monolithRoot, ACTIVE_MD_REL);
  const relPath = relative(targetDir, activeMdAbs);

  // SEC-001A: never present a file outside the project as project context.
  const escape = checkContainedFile(root, ACTIVE_MD_REL);
  if (escape) {
    diagnostics.push({
      code: 'PATH_OUTSIDE_PROJECT',
      severity: 'error',
      message: `${relPath} was not read: ${escape.message}`,
    });
    return { fileExists: false, hasCurrentStorySection: false, excerpt: null, lineRange: null, provenance: null };
  }

  const read = readBoundedFileStable(
    activeMdAbs,
    relPath,
    { boundary: targetDir, maxBytes: MAX_ACTIVE_CONTEXT_BYTES, allowEmpty: true },
    true,
  );
  if (!read.ok) {
    // SEC-001B.1-R (M-1): three different situations, three different diagnostics.
    // Only a really absent file is "missing" (a warning: a project may have no story
    // yet). A file the safe-read policy refuses, or one that cannot be read, is an
    // error: the story exists but was not shown, so the brief is INCOMPLETE. The
    // detail never carries file content — only the label and the typed code.
    if (read.code === 'FILE_MISSING') {
      diagnostics.push({
        code: 'ACTIVE_MD_MISSING',
        severity: 'warn',
        message: `${relPath} does not exist.`,
        readCode: read.code,
      });
    } else if (isReadSecurityViolation(read.code)) {
      diagnostics.push({
        code: 'ACTIVE_MD_REJECTED',
        severity: 'error',
        message: `${relPath} exists but was refused by the safe-read policy and not read: ${read.code}: ${read.detail}`,
        readCode: read.code,
      });
    } else {
      diagnostics.push({
        code: 'ACTIVE_MD_UNREADABLE',
        severity: 'error',
        message: `${relPath} exists but could not be read: ${read.code}: ${read.detail}`,
        readCode: read.code,
      });
    }
    return { fileExists: false, hasCurrentStorySection: false, excerpt: null, lineRange: null, provenance: null };
  }
  const content = 'content' in read ? read.content : '';

  const extraction = extractCurrentStory(content);
  if (!extraction.hasCurrentStorySection) {
    diagnostics.push({
      code: 'ACTIVE_MD_NO_CURRENT_STORY',
      severity: 'info',
      message: `${relPath} exists but has no "## Current Story" section.`,
    });
  }

  return {
    fileExists: true,
    hasCurrentStorySection: extraction.hasCurrentStorySection,
    excerpt: extraction.excerpt,
    lineRange: extraction.lineRange,
    provenance: { source: extraction.lineRange ? `${relPath}:${extraction.lineRange}` : relPath },
  };
}

const IDEAS_UNREADABLE_LISTED = 3;

/**
 * IDEA-002A: the `inbox` ideas, via the Idea Capture reader (`listIdeas`: bounded,
 * symlink/hardlink/special-file refusing, never writes). A file that cannot be read
 * as an idea is not counted and is reported as one warning — it never breaks the
 * brief. Idea content is untrusted; only ids and titles are kept.
 */
function collectParkedIdeas(targetDir: string, diagnostics: BriefDiagnostic[]): ParkedIdeasSummary {
  const empty: ParkedIdeasSummary = { total: 0, items: [] };
  let entries;
  try {
    entries = listIdeas(ideaStore(targetDir));
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? String((err as { code: unknown }).code) : 'ERROR';
    diagnostics.push({
      code: 'IDEAS_UNREADABLE',
      severity: 'warn',
      message: `The ideas directory was not read (${code}); parked ideas are not shown.`,
    });
    return empty;
  }

  const inbox = entries.flatMap((e) => (e.ok && e.idea.status === 'inbox' ? [e.idea] : []));
  inbox.sort((a, b) => ideaNumber(b.id) - ideaNumber(a.id));

  const bad = entries.flatMap((e) => (e.ok ? [] : [e]));
  if (bad.length > 0) {
    const listed = bad.slice(0, IDEAS_UNREADABLE_LISTED).map((e) => `${e.id} (${e.code})`).join(', ');
    const more = bad.length > IDEAS_UNREADABLE_LISTED ? `, and ${bad.length - IDEAS_UNREADABLE_LISTED} more` : '';
    diagnostics.push({
      code: 'IDEAS_UNREADABLE',
      severity: 'warn',
      message: `${bad.length} idea file(s) could not be read and are not counted as parked: ${listed}${more}. Run \`monolith idea show <id>\`.`,
    });
  }

  return { total: inbox.length, items: inbox.slice(0, PARKED_IDEAS_LIMIT).map((i) => ({ id: i.id, title: i.title })) };
}

/**
 * Best-effort read of one state document for the freshness check. A missing,
 * refused or unreadable file simply contributes no evidence — freshness never
 * adds a diagnostic of its own and never makes the brief INCOMPLETE.
 */
function readStateDocument(targetDir: string, monolithRoot: string, root: ResolvedMonolithRoot, rel: string): string | null {
  if (checkContainedFile(root, rel)) return null;
  const abs = join(targetDir, monolithRoot, rel);
  const read = readBoundedFileStable(
    abs,
    relative(targetDir, abs),
    { boundary: targetDir, maxBytes: MAX_ACTIVE_CONTEXT_BYTES, allowEmpty: true },
    true,
  );
  return read.ok && 'content' in read ? read.content : null;
}

function collectFreshness(
  targetDir: string,
  monolithRoot: string,
  root: ResolvedMonolithRoot,
  story: StorySummary,
): { result: FreshnessResult; evidence: FreshnessEvidence } {
  const docs = [ACTIVE_MD_REL, ROADMAP_INDEX_REL, STORY_INDEX_REL, HANDOFF_REL];
  const stateFiles = docs.map((rel) => posix.normalize(`${monolithRoot}/${rel}`));
  const content = new Map<string, string | null>(docs.map((rel) => [rel, readStateDocument(targetDir, monolithRoot, root, rel)]));
  const roadmap = content.get(ROADMAP_INDEX_REL) ?? null;
  const storyIndex = content.get(STORY_INDEX_REL) ?? null;

  const evidence: FreshnessEvidence = {
    git: readGitSignals(targetDir, stateFiles),
    activeStory: story.fileExists && story.hasCurrentStorySection ? parseActiveStoryClaim(story.excerpt) : { kind: 'unknown' },
    roadmapActiveStory: roadmap === null ? null : parseRoadmapActiveStory(roadmap),
    roadmapStatuses: roadmap === null ? new Map() : parseRoadmapStatuses(roadmap),
    storyIndexStatuses: storyIndex === null ? new Map() : parseStoryIndexStatuses(storyIndex),
    recordedText: [...content.values()].filter((c): c is string => c !== null).join('\n'),
    stateFiles: new Set(stateFiles),
  };
  return { result: evaluateFreshness(evidence), evidence };
}

export async function collect(targetDir: string): Promise<BriefModel> {
  const diagnostics: BriefDiagnostic[] = [];
  const config = readBriefConfig(targetDir, diagnostics);
  // Re-validates (and realpath-checks) the root readBriefConfig just accepted.
  const root = resolveMonolithRootValue(targetDir, config.monolithRoot);
  const monolithRootAbs = root.rootAbs;
  const monolithInitialized = existsSync(monolithRootAbs);

  if (!monolithInitialized) {
    diagnostics.push({
      code: 'MONOLITH_NOT_INITIALIZED',
      severity: 'warn',
      message: `No MONOLITH instance found at "${config.monolithRoot}" — nothing to summarize.`,
    });
  }

  if (monolithInitialized) {
    // Read-only (SEC-001B.2): names only. A warning, never an error — it does
    // not make the brief INCOMPLETE — and nothing is deleted or repaired.
    const artifacts = findWriteArtifacts(monolithRootAbs);
    if (artifacts.length > 0) {
      diagnostics.push({
        code: 'WRITE_ARTIFACTS_PRESENT',
        severity: 'warn',
        message: describeWriteArtifacts(artifacts, config.monolithRoot),
      });
    }
  }

  const identity = {
    name: config.projectName,
    monolithRoot: config.monolithRoot,
    provenance: { source: 'monolith.config.json#project.name' },
  };

  const { summary: stateKeeper, state } = await readStateForBrief(targetDir, config.monolithRoot, root, diagnostics);
  const missions = collectMissions(targetDir, config.monolithRoot, state, diagnostics);
  const checkpoints = collectCheckpoints(targetDir, config.monolithRoot, state, missions.active, diagnostics);
  const story = collectStory(targetDir, config.monolithRoot, root, diagnostics);
  const { result: freshness, evidence: freshnessEvidence } = collectFreshness(targetDir, config.monolithRoot, root, story);

  const protocolsRelDir = `${config.monolithRoot}/${PROTOCOLS_DIR}`;
  const mandatoryProtocols = {
    items: discoverDocs(targetDir, [protocolsRelDir], (fields) => fields.get('enforcement') === 'mandatory', diagnostics),
    provenance: { source: protocolsRelDir },
  };

  const adrDirs = config.adrDirs;
  const adrs = {
    items: discoverDocs(targetDir, adrDirs, (fields) => fields.get('status') === 'accepted', diagnostics),
    provenance: { source: adrDirs.join(', ') },
  };

  const parkedIdeas = monolithInitialized ? collectParkedIdeas(targetDir, diagnostics) : { total: 0, items: [] };

  return {
    identity,
    monolithInitialized,
    stateKeeper,
    missions,
    checkpoints,
    story,
    mandatoryProtocols,
    adrs,
    parkedIdeas,
    diagnostics,
    freshness,
    freshnessEvidence,
  };
}
