import type { DashboardReadModel } from '../../../src/readmodel/types';

/**
 * Minimal runtime shape check of the HTTP response (TypeScript types are erased
 * and prove nothing about data that arrived over the network). It covers exactly
 * the fields the Dashboard reads; unknown extra fields are ignored. It is not a
 * schema platform and not a security boundary: free text is still rendered only
 * through Vue's escaping.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isNumOrNull = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isArr = <T>(v: unknown, item: (x: unknown) => x is T): v is T[] => Array.isArray(v) && v.every(item);

const MISSION_STATUSES = ['in_progress', 'completed', 'failed', 'cancelled'];
const SOURCE_STATUSES = ['available', 'absent', 'corrupt', 'forbidden', 'unreadable'];

function isSourceReport(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isStrOrNull(v.path) &&
    isStr(v.status) &&
    SOURCE_STATUSES.includes(v.status) &&
    isStrOrNull(v.code)
  );
}

/** `{ data: T | null, sources: SourceReport[] }` */
function isSection(v: unknown, data: (d: unknown) => boolean): boolean {
  return isObj(v) && isArr(v.sources, isSourceReport as (x: unknown) => x is unknown) && (v.data === null || data(v.data));
}

function isMission(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isStr(v.title) &&
    isStr(v.status) &&
    MISSION_STATUSES.includes(v.status) &&
    isStrOrNull(v.summary) &&
    isStr(v.startedAt) &&
    isStr(v.updatedAt)
  );
}

function isCheckpoint(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isStr(v.missionId) &&
    isStr(v.createdAt) &&
    isStr(v.summary) &&
    isArr(v.remainingSteps, isStr)
  );
}

function isOverview(d: unknown): boolean {
  return (
    isObj(d) &&
    isStrOrNull(d.name) &&
    isNumOrNull(d.stateRevision) &&
    (d.currentStory === null || (isObj(d.currentStory) && isStr(d.currentStory.excerpt) && isStr(d.currentStory.lineRange)))
  );
}

export function isDashboardReadModel(v: unknown): v is DashboardReadModel {
  if (!isObj(v)) return false;
  const diag = v.diagnostics;
  return (
    isSection(v.projectOverview, isOverview) &&
    isSection(v.currentMissions, (d) => isObj(d) && Array.isArray(d.active) && d.active.every(isMission)) &&
    isSection(
      v.checkpoints,
      (d) =>
        isObj(d) &&
        Array.isArray(d.byActiveMission) &&
        d.byActiveMission.every(
          (m) => isObj(m) && isStr(m.missionId) && isNum(m.count) && (m.latest === null || isCheckpoint(m.latest)),
        ),
    ) &&
    isSection(v.roadmap, (d) => isObj(d) && isStr(d.text)) &&
    isObj(diag) &&
    Array.isArray(diag.sources) &&
    diag.sources.every(isSourceReport) &&
    Array.isArray(diag.notes) &&
    diag.notes.every((n) => isObj(n) && isStr(n.code) && (n.severity === 'info' || n.severity === 'warn'))
  );
}
