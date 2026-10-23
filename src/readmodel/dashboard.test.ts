import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import {
  mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, lstatSync, symlinkSync, writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readDashboardModel, ROADMAP_REL, MAX_ROADMAP_BYTES } from './index.js';
import type { DashboardReadModel, SourceId } from './index.js';

let dir: string;
let outside: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'rm-proj-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'rm-out-')));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function write(rel: string, content: string, base = dir): void {
  const abs = join(base, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

interface M { id: string; status?: string; startedAt?: string; title?: string }
function mission(m: M) {
  return {
    id: m.id, title: m.title ?? `Title ${m.id}`, system: 'sys', status: m.status ?? 'in_progress',
    startedAt: m.startedAt ?? '2026-01-01T00:00:00.000Z', updatedAt: m.startedAt ?? '2026-01-01T00:00:00.000Z', summary: null,
  };
}
function checkpoint(missionId: string, n: number, createdAt = '2026-01-02T00:00:00.000Z') {
  const id = `${missionId}-CKPT-${String(n).padStart(4, '0')}`;
  return { id, missionId, createdAt, summary: `sum ${id}`, remainingSteps: [`step of ${id}`], context: null };
}
function writeState(missions: M[], checkpoints: ReturnType<typeof checkpoint>[] = [], extra: object = {}): void {
  write('.monolith/state.json', JSON.stringify({
    schemaVersion: 2, revision: 7, strategic: { systems: {} },
    tactical: {
      missions: Object.fromEntries(missions.map((m) => [m.id, mission(m)])),
      checkpoints: Object.fromEntries(checkpoints.map((c) => [c.id, c])),
    },
    ...extra,
  }));
}
const ACTIVE_MD = '# Active\n\n## Current Story\n\nStory text here.\n\n---\n\n## Other\n';
function fullProject(): void {
  write('monolith.config.json', JSON.stringify({ project: { name: 'Demo' } }));
  writeState([{ id: 'MIS-0001' }, { id: 'MIS-0002', status: 'completed' }], [checkpoint('MIS-0001', 1), checkpoint('MIS-0001', 2)]);
  write('.monolith/memory/working/active.md', ACTIVE_MD);
  write(`.monolith/${ROADMAP_REL}`, '# Roadmap\n| a | b |\n');
}
const src = (m: DashboardReadModel, id: SourceId) => m.diagnostics.sources.find((s) => s.id === id)!;

describe('readDashboardModel — functional', () => {
  it('reads a correct project', () => {
    fullProject();
    const m = readDashboardModel(dir);
    expect(m.projectOverview.data).toEqual({
      name: 'Demo', monolithRoot: '.monolith', monolithRootSource: 'default',
      stateSchemaVersionOnDisk: 2, stateRevision: 7, activeMissionCount: 1, finishedMissionCount: 1,
      currentStory: { excerpt: 'Story text here.', lineRange: '5-5' },
    });
    expect(m.currentMissions.data!.active.map((x) => x.id)).toEqual(['MIS-0001']);
    const cp = m.checkpoints.data!.byActiveMission;
    expect(cp).toHaveLength(1);
    expect(cp[0].count).toBe(2);
    expect(cp[0].latest!.id).toBe('MIS-0001-CKPT-0002');
    expect(cp[0].latest!.remainingSteps).toEqual(['step of MIS-0001-CKPT-0002']);
    expect(m.roadmap.data!.text).toBe('# Roadmap\n| a | b |\n');
    expect(m.diagnostics.validation).toBe('NOT_PERFORMED');
    expect(m.diagnostics.sources.map((s) => [s.id, s.status])).toEqual([
      ['config', 'available'], ['state', 'available'], ['activeStory', 'available'], ['roadmap', 'available'],
    ]);
    expect(m.diagnostics.sources.map((s) => s.path)).toEqual([
      'monolith.config.json', '.monolith/state.json', '.monolith/memory/working/active.md', `.monolith/${ROADMAP_REL}`,
    ]);
    expect(m.diagnostics.notes).toEqual([]);
  });

  it('reports all active missions, never picking one, ordered by (startedAt, id)', () => {
    writeState([
      { id: 'MIS-0003', startedAt: '2026-01-03T00:00:00.000Z' },
      { id: 'MIS-0002', startedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'MIS-0001', startedAt: '2026-01-02T00:00:00.000Z' },
    ]);
    const m = readDashboardModel(dir);
    expect(m.currentMissions.data!.active.map((x) => x.id)).toEqual(['MIS-0001', 'MIS-0002', 'MIS-0003']);
    expect(m.checkpoints.data!.byActiveMission.map((c) => c.missionId)).toEqual(['MIS-0001', 'MIS-0002', 'MIS-0003']);
    expect(m.diagnostics.notes).toContainEqual({ code: 'MULTIPLE_ACTIVE_MISSIONS', severity: 'info' });
  });

  it('no active missions: empty list, state still available', () => {
    writeState([{ id: 'MIS-0001', status: 'failed' }]);
    const m = readDashboardModel(dir);
    expect(m.currentMissions.data).toEqual({ active: [] });
    expect(m.projectOverview.data!.finishedMissionCount).toBe(1);
    expect(src(m, 'state').status).toBe('available');
  });

  it('active mission without checkpoint: latest is null, count 0', () => {
    writeState([{ id: 'MIS-0001' }]);
    expect(readDashboardModel(dir).checkpoints.data!.byActiveMission).toEqual([{ missionId: 'MIS-0001', count: 0, latest: null }]);
  });

  it('latest checkpoint follows ID ordinal, and a timestamp disagreement is noted', () => {
    writeState([{ id: 'MIS-0001' }], [checkpoint('MIS-0001', 1, '2026-02-01T00:00:00.000Z'), checkpoint('MIS-0001', 2, '2026-01-01T00:00:00.000Z')]);
    const m = readDashboardModel(dir);
    expect(m.checkpoints.data!.byActiveMission[0].latest!.id).toBe('MIS-0001-CKPT-0002');
    expect(m.diagnostics.notes).toContainEqual({ code: 'CHECKPOINT_ORDER_MISMATCH', severity: 'info' });
  });

  it('missing roadmap: data null, source absent, other sections unaffected', () => {
    fullProject();
    rmSync(join(dir, '.monolith', ROADMAP_REL));
    const m = readDashboardModel(dir);
    expect(m.roadmap.data).toBeNull();
    expect(src(m, 'roadmap')).toMatchObject({ status: 'absent', code: 'SOURCE_ABSENT' });
    expect(m.currentMissions.data!.active).toHaveLength(1);
  });

  it('fresh project (nothing exists): absent everywhere, zero counts, no throw', () => {
    const m = readDashboardModel(dir);
    expect(m.diagnostics.sources.map((s) => s.status)).toEqual(['absent', 'absent', 'absent', 'absent']);
    expect(m.projectOverview.data).toMatchObject({
      name: null, activeMissionCount: 0, finishedMissionCount: 0, stateRevision: null, stateSchemaVersionOnDisk: null, currentStory: null,
    });
    expect(m.currentMissions.data).toEqual({ active: [] });
    expect(m.roadmap.data).toBeNull();
  });

  it('partial state: active.md without a Current Story section keeps the rest', () => {
    writeState([{ id: 'MIS-0001' }]);
    write('.monolith/memory/working/active.md', '# Active\n\nNo story heading.\n');
    const m = readDashboardModel(dir);
    expect(m.projectOverview.data!.currentStory).toBeNull();
    expect(src(m, 'activeStory').status).toBe('available');
    expect(m.diagnostics.notes).toContainEqual({ code: 'ACTIVE_MD_NO_CURRENT_STORY', severity: 'info' });
    expect(m.projectOverview.data!.activeMissionCount).toBe(1);
  });

  it('legacy schemaVersion 1 is read via the in-memory migration and noted', () => {
    write('.monolith/state.json', JSON.stringify({
      schemaVersion: 1, revision: 3, strategic: { systems: {} }, tactical: { missions: { 'MIS-0001': mission({ id: 'MIS-0001' }) } },
    }));
    const m = readDashboardModel(dir);
    expect(m.projectOverview.data).toMatchObject({ stateSchemaVersionOnDisk: 1, stateRevision: 3, activeMissionCount: 1 });
    expect(m.diagnostics.notes).toContainEqual({ code: 'STATE_LEGACY_SCHEMA_MIGRATED', severity: 'info' });
  });

  it('honours a configured monolithRoot', () => {
    write('monolith.config.json', JSON.stringify({ monolithRoot: 'custom/inst' }));
    write('custom/inst/state.json', JSON.stringify({
      schemaVersion: 2, revision: 1, strategic: { systems: {} }, tactical: { missions: { 'MIS-0001': mission({ id: 'MIS-0001' }) }, checkpoints: {} },
    }));
    const m = readDashboardModel(dir);
    expect(m.projectOverview.data).toMatchObject({ monolithRoot: 'custom/inst', monolithRootSource: 'config', activeMissionCount: 1 });
    expect(src(m, 'state').path).toBe('custom/inst/state.json');
  });
});

describe('readDashboardModel — damaged sources', () => {
  const SECRET = 'TOPSECRET-VALUE-123';

  it('invalid JSON state → corrupt, sections empty, no content or path leak', () => {
    write('.monolith/state.json', `{"revision": ${SECRET}`);
    const m = readDashboardModel(dir);
    expect(src(m, 'state')).toMatchObject({ status: 'corrupt', code: 'PARSE_ERROR' });
    expect(m.currentMissions.data).toBeNull();
    expect(m.checkpoints.data).toBeNull();
    expect(m.projectOverview.data!.activeMissionCount).toBeNull();
    const json = JSON.stringify(m);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(dir);
  });

  it('schema-invalid state → corrupt SCHEMA_INVALID, offending value not leaked', () => {
    writeState([{ id: 'MIS-0001', status: SECRET }]);
    const m = readDashboardModel(dir);
    expect(src(m, 'state')).toMatchObject({ status: 'corrupt', code: 'SCHEMA_INVALID' });
    expect(JSON.stringify(m)).not.toContain(SECRET);
  });

  it('empty state.json is corrupt, not "no missions"', () => {
    write('.monolith/state.json', '  \n');
    const m = readDashboardModel(dir);
    expect(src(m, 'state')).toMatchObject({ status: 'corrupt', code: 'SOURCE_EMPTY' });
    expect(m.currentMissions.data).toBeNull();
  });

  it('a damaged state does not hide healthy sources', () => {
    fullProject();
    write('.monolith/state.json', '{nope');
    const m = readDashboardModel(dir);
    expect(m.roadmap.data!.text).toContain('Roadmap');
    expect(m.projectOverview.data!.currentStory!.excerpt).toBe('Story text here.');
  });

  it.each([['not json {'], ['[1,2]'], ['"str"']])('unusable config %j fails closed (no default fallback)', (body) => {
    write('monolith.config.json', body);
    writeState([{ id: 'MIS-0001' }]);
    const m = readDashboardModel(dir);
    expect(src(m, 'config')).toMatchObject({ status: 'corrupt', code: 'CONFIG_INVALID' });
    expect(src(m, 'state')).toMatchObject({ status: 'forbidden', code: 'ROOT_INVALID', path: null });
    expect(m.projectOverview.data).toBeNull();
    expect(m.currentMissions.data).toBeNull();
    expect(m.roadmap.data).toBeNull();
  });

  it('FIFO in place of a source is rejected without hanging', () => {
    execFileSync('mkfifo', [join(dir, 'monolith.config.json')]);
    mkdirSync(join(dir, '.monolith/context/maps'), { recursive: true });
    execFileSync('mkfifo', [join(dir, '.monolith', ROADMAP_REL)]);
    const m = readDashboardModel(dir);
    expect(src(m, 'config')).toMatchObject({ status: 'unreadable', code: 'SOURCE_NOT_REGULAR' });
    expect(m.projectOverview.data).toBeNull();
    const m2 = (() => { rmSync(join(dir, 'monolith.config.json')); return readDashboardModel(dir); })();
    expect(src(m2, 'roadmap')).toMatchObject({ status: 'unreadable', code: 'SOURCE_NOT_REGULAR' });
  });

  it('oversized roadmap is refused, never truncated', () => {
    write(`.monolith/${ROADMAP_REL}`, 'x'.repeat(MAX_ROADMAP_BYTES + 1));
    const m = readDashboardModel(dir);
    expect(src(m, 'roadmap')).toMatchObject({ status: 'unreadable', code: 'SOURCE_TOO_LARGE' });
    expect(m.roadmap.data).toBeNull();
  });

  it('dangling symlink source is unreadable, not a crash', () => {
    mkdirSync(join(dir, '.monolith'), { recursive: true });
    symlinkSync(join(dir, 'nowhere.json'), join(dir, '.monolith/state.json'));
    const m = readDashboardModel(dir);
    expect(src(m, 'state')).toMatchObject({ status: 'unreadable', code: 'SOURCE_UNRESOLVABLE' });
  });

  it('nonexistent project root yields a typed result, not an exception', () => {
    const m = readDashboardModel(join(dir, 'does-not-exist'));
    expect(src(m, 'state')).toMatchObject({ status: 'forbidden', code: 'ROOT_INVALID' });
    expect(JSON.stringify(m)).not.toContain(dir);
  });
});

describe('readDashboardModel — security regression (G1)', () => {
  const OUT_SECRET = 'OUTSIDE-SECRET-XYZ';

  it('a normal file inside the root is read', () => {
    fullProject();
    expect(src(readDashboardModel(dir), 'roadmap').status).toBe('available');
  });

  it.each([
    ['state', '.monolith/state.json'],
    ['activeStory', '.monolith/memory/working/active.md'],
    ['roadmap', `.monolith/${ROADMAP_REL}`],
  ] as const)('symlinked %s escaping the project is forbidden and unread', (id, rel) => {
    write('payload', OUT_SECRET, outside);
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    symlinkSync(join(outside, 'payload'), join(dir, rel));
    const m = readDashboardModel(dir);
    expect(src(m, id)).toMatchObject({ status: 'forbidden', code: 'SOURCE_OUTSIDE_PROJECT' });
    const json = JSON.stringify(m);
    expect(json).not.toContain(OUT_SECRET);
    expect(json).not.toContain(outside);
  });

  it('symlinked monolith.config.json escaping the project is forbidden (file outside .monolith, inside project root rules)', () => {
    write('c.json', JSON.stringify({ project: { name: OUT_SECRET } }), outside);
    symlinkSync(join(outside, 'c.json'), join(dir, 'monolith.config.json'));
    const m = readDashboardModel(dir);
    expect(src(m, 'config')).toMatchObject({ status: 'forbidden', code: 'SOURCE_OUTSIDE_PROJECT' });
    expect(src(m, 'state')).toMatchObject({ status: 'forbidden', code: 'ROOT_INVALID' });
    expect(JSON.stringify(m)).not.toContain(OUT_SECRET);
  });

  it('symlinked instance directory escaping the project is refused as a root', () => {
    write('state.json', OUT_SECRET, outside);
    symlinkSync(outside, join(dir, '.monolith'));
    const m = readDashboardModel(dir);
    expect(src(m, 'state')).toMatchObject({ status: 'forbidden', code: 'ROOT_INVALID' });
    expect(m.currentMissions.data).toBeNull();
    expect(JSON.stringify(m)).not.toContain(OUT_SECRET);
  });

  it('symlinked intermediate directory escaping the project is forbidden', () => {
    write('roadmap-index.md', OUT_SECRET, outside);
    mkdirSync(join(dir, '.monolith/context'), { recursive: true });
    symlinkSync(outside, join(dir, '.monolith/context/maps'));
    const m = readDashboardModel(dir);
    expect(src(m, 'roadmap')).toMatchObject({ status: 'forbidden', code: 'SOURCE_OUTSIDE_PROJECT' });
    expect(JSON.stringify(m)).not.toContain(OUT_SECRET);
  });

  it.each([
    ['../escape'], ['/etc'], ['a/../b'], ['.'], [''], [42],
  ])('config monolithRoot %j cannot redirect reads outside the contained set', (value) => {
    write('monolith.config.json', JSON.stringify({ monolithRoot: value }));
    write('state.json', OUT_SECRET, outside);
    const m = readDashboardModel(dir);
    expect(m.projectOverview.data).toBeNull();
    expect(src(m, 'state')).toMatchObject({ status: 'forbidden', code: 'ROOT_INVALID' });
    expect(JSON.stringify(m)).not.toContain(OUT_SECRET);
  });

  it('a symlink that stays inside the project keeps the existing Core policy (allowed)', () => {
    write('real/state.json', JSON.stringify({
      schemaVersion: 2, revision: 9, strategic: { systems: {} }, tactical: { missions: {}, checkpoints: {} },
    }));
    mkdirSync(join(dir, '.monolith'), { recursive: true });
    symlinkSync(join(dir, 'real/state.json'), join(dir, '.monolith/state.json'));
    expect(readDashboardModel(dir).projectOverview.data!.stateRevision).toBe(9);
  });

  it('the API takes no path other than the fixed project root', () => {
    expect(readDashboardModel.length).toBe(1);
  });

  // Not covered, deliberately: a swap of a path component between the realpath
  // check and open(). Node has no openat/O_NOFOLLOW per component, Core does
  // not close it (SEC-001B), and a unit test cannot interleave the two
  // syscalls deterministically. The residual risk is recorded in the report.
});

function snapshot(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const abs = join(d, name);
      const st = lstatSync(abs);
      if (st.isDirectory()) { out.push(`d ${abs} ${st.mtimeMs}`); walk(abs); }
      else if (st.isSymbolicLink()) out.push(`l ${abs}`);
      else out.push(`f ${abs} ${st.mtimeMs} ${st.size} ${createHash('sha256').update(readFileSync(abs)).digest('hex')}`);
    }
  };
  walk(root);
  return out;
}

describe('readDashboardModel — read-only, deterministic, no code execution', () => {
  it('performs no writes (no new files, locks, temp files; no mtime/content change)', () => {
    fullProject();
    const before = snapshot(dir);
    readDashboardModel(dir);
    readDashboardModel(dir);
    expect(snapshot(dir)).toEqual(before);
  });

  it('does not create anything in a fresh project', () => {
    readDashboardModel(dir);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('is deterministic: identical sources give deep-equal results (no timestamps)', () => {
    fullProject();
    expect(readDashboardModel(dir)).toEqual(readDashboardModel(dir));
  });

  it('ordering does not depend on key order in state.json', () => {
    const ms = [{ id: 'MIS-0002' }, { id: 'MIS-0001' }, { id: 'MIS-0003' }];
    writeState(ms);
    const a = readDashboardModel(dir).currentMissions.data!.active.map((x) => x.id);
    writeState([...ms].reverse());
    const b = readDashboardModel(dir).currentMissions.data!.active.map((x) => x.id);
    expect(a).toEqual(['MIS-0001', 'MIS-0002', 'MIS-0003']);
    expect(b).toEqual(a);
  });

  it('never executes project JavaScript (project.definition.mjs and friends)', () => {
    const marker = join(outside, 'EXECUTED');
    const body = `import { writeFileSync } from 'fs'; writeFileSync(${JSON.stringify(marker)}, 'x'); export const PROJECT_DEFINITION = {};`;
    write('project.definition.mjs', body);
    write('.monolith/hooks.mjs', body);
    write('.monolith/context/maps/evil.js', body);
    fullProject();
    readDashboardModel(dir);
    expect(() => lstatSync(marker)).toThrow();
  });

  it('source module imports no writer, validator, process or dynamic-import machinery', () => {
    const text = readdirSync(__dirnameOfModule()).filter((f) => /^(dashboard|types|index)\.ts$/.test(f))
      .map((f) => readFileSync(join(__dirnameOfModule(), f), 'utf8')).join('\n');
    for (const forbidden of ['mutateState', 'writeFile', 'child_process', 'validate/', 'import(', 'readState', 'createCheckpoint', 'startMission']) {
      // comments may mention these words; code must not call or import them
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('markup in the roadmap is returned verbatim as text (no interpretation)', () => {
    write(`.monolith/${ROADMAP_REL}`, '<script>alert(1)</script>\n| Status | DONE |\n');
    expect(readDashboardModel(dir).roadmap.data!.text).toBe('<script>alert(1)</script>\n| Status | DONE |\n');
  });
});

function __dirnameOfModule(): string {
  return new URL('.', import.meta.url).pathname;
}
