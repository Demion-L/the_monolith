import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { collect } from './collect.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-brief-collect-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function write(dir: string, relPath: string, content: string): void {
  const full = join(dir, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function scaffoldMinimalInstance(dir: string): void {
  write(dir, 'monolith.config.json', JSON.stringify({ monolithRoot: '.monolith', project: { name: 'Fixture' } }));
  mkdirSync(join(dir, '.monolith'), { recursive: true });
}

describe('collect — MONOLITH instance presence', () => {
  it('flags MONOLITH_NOT_INITIALIZED for a directory with no .monolith/ at all', async () => {
    const dir = makeTempDir();
    const model = await collect(dir);
    expect(model.monolithInitialized).toBe(false);
    expect(model.diagnostics.some((d) => d.code === 'MONOLITH_NOT_INITIALIZED')).toBe(true);
    expect(model.stateKeeper.status).toBe('absent');
    expect(model.mandatoryProtocols.items).toEqual([]);
    expect(model.adrs.items).toEqual([]);
  });

  it('does not write anything to disk while collecting', async () => {
    const dir = makeTempDir();
    const before = existsSync(join(dir, '.monolith'));
    await collect(dir);
    expect(existsSync(join(dir, '.monolith'))).toBe(before); // still false — never created
  });
});

describe('collect — State Keeper classification', () => {
  it('STATE_NOT_INITIALIZED when state.json is absent but .monolith/ exists', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    const model = await collect(dir);
    expect(model.stateKeeper.status).toBe('absent');
    expect(model.diagnostics.map((d) => d.code)).toContain('STATE_NOT_INITIALIZED');
  });

  it('STATE_EMPTY for a literally empty state.json, distinct from corruption', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    write(dir, '.monolith/state.json', '');
    const model = await collect(dir);
    expect(model.stateKeeper.status).toBe('empty');
    const diag = model.diagnostics.find((d) => d.code === 'STATE_EMPTY');
    expect(diag).toBeDefined();
    // Review finding F-1: an empty state.json is a loss of information (no
    // state could be read at all), not a benign "zero missions" result —
    // it must carry severity 'error' so render() treats it as INCOMPLETE,
    // the same way STATE_UNREADABLE already does.
    expect(diag?.severity).toBe('error');
  });

  it('STATE_UNREADABLE for corrupted JSON, never silently treated as empty/zero missions', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    write(dir, '.monolith/state.json', '{ this is not json');
    const model = await collect(dir);
    expect(model.stateKeeper.status).toBe('unreadable');
    const diag = model.diagnostics.find((d) => d.code === 'STATE_UNREADABLE');
    expect(diag?.severity).toBe('error');
    expect(model.missions.active).toEqual([]); // no missions is reported as "unknown", not asserted true
  });

  it('STATE_UNREADABLE for an unsupported/unknown schemaVersion', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    write(
      dir,
      '.monolith/state.json',
      JSON.stringify({ schemaVersion: 99, revision: 0, strategic: { systems: {} }, tactical: { missions: {}, checkpoints: {} } }),
    );
    const model = await collect(dir);
    expect(model.stateKeeper.status).toBe('unreadable');
  });

  it('reads a valid v2 state.json and reports status ok', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    write(
      dir,
      '.monolith/state.json',
      JSON.stringify({
        schemaVersion: 2,
        revision: 3,
        strategic: { systems: {} },
        tactical: {
          missions: { 'MIS-0001': { id: 'MIS-0001', title: 'T', system: 'S', status: 'in_progress', startedAt: 'a', updatedAt: 'a', summary: null } },
          checkpoints: {},
        },
      }),
    );
    const model = await collect(dir);
    expect(model.stateKeeper.status).toBe('ok');
    expect(model.missions.active.map((m) => m.id)).toEqual(['MIS-0001']);
    // A genuinely successful read with zero total missions is NOT STATE_EMPTY —
    // that code is reserved for a literally blank file.
    expect(model.diagnostics.some((d) => d.code === 'STATE_EMPTY')).toBe(false);
  });

  it('migrates a legacy v1 file in-memory, without ever writing to disk, and notes it', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    write(
      dir,
      '.monolith/state.json',
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        strategic: { systems: {} },
        tactical: { missions: { 'MIS-0001': { id: 'MIS-0001', title: 'T', system: 'S', status: 'in_progress', startedAt: 'a', updatedAt: 'a', summary: null } } },
      }),
    );
    const before = readFileSync(join(dir, '.monolith/state.json'), 'utf8');
    const model = await collect(dir);
    const after = readFileSync(join(dir, '.monolith/state.json'), 'utf8');
    expect(after).toBe(before); // byte-for-byte unchanged — read-only
    expect(model.stateKeeper.status).toBe('ok');
    expect(model.diagnostics.map((d) => d.code)).toContain('STATE_LEGACY_SCHEMA_MIGRATED');
    expect(model.missions.active.map((m) => m.id)).toEqual(['MIS-0001']);
  });
});

describe('collect — missions', () => {
  function missionsState(missions: Record<string, unknown>): string {
    return JSON.stringify({ schemaVersion: 2, revision: 1, strategic: { systems: {} }, tactical: { missions, checkpoints: {} } });
  }

  it('flags MULTIPLE_ACTIVE_MISSIONS as informational when more than one mission is in_progress', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    write(
      dir,
      '.monolith/state.json',
      missionsState({
        'MIS-0001': { id: 'MIS-0001', title: 'A', system: 'S', status: 'in_progress', startedAt: 'a', updatedAt: 'a', summary: null },
        'MIS-0002': { id: 'MIS-0002', title: 'B', system: 'S', status: 'in_progress', startedAt: 'b', updatedAt: 'b', summary: null },
      }),
    );
    const model = await collect(dir);
    const diag = model.diagnostics.find((d) => d.code === 'MULTIPLE_ACTIVE_MISSIONS');
    expect(diag?.severity).toBe('info');
    expect(model.missions.active).toHaveLength(2);
  });

  it('reports a single active mission with no MULTIPLE_ACTIVE_MISSIONS diagnostic', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    write(
      dir,
      '.monolith/state.json',
      missionsState({ 'MIS-0001': { id: 'MIS-0001', title: 'A', system: 'S', status: 'in_progress', startedAt: 'a', updatedAt: 'a', summary: null } }),
    );
    const model = await collect(dir);
    expect(model.diagnostics.some((d) => d.code === 'MULTIPLE_ACTIVE_MISSIONS')).toBe(false);
  });

  it('reports zero active missions for a project with none, without a false "0 missions read" claim on an absent file', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    const model = await collect(dir);
    expect(model.missions.active).toEqual([]);
    expect(model.stateKeeper.status).toBe('absent');
  });
});

describe('collect — checkpoints', () => {
  it('picks the latest checkpoint by ID ordinal for each active mission and flags order mismatch', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    write(
      dir,
      '.monolith/state.json',
      JSON.stringify({
        schemaVersion: 2,
        revision: 1,
        strategic: { systems: {} },
        tactical: {
          missions: { 'MIS-0001': { id: 'MIS-0001', title: 'A', system: 'S', status: 'in_progress', startedAt: 'a', updatedAt: 'a', summary: null } },
          checkpoints: {
            'MIS-0001-CKPT-0001': { id: 'MIS-0001-CKPT-0001', missionId: 'MIS-0001', createdAt: '2026-02-01T00:00:00.000Z', summary: 's1', remainingSteps: [], context: null },
            'MIS-0001-CKPT-0002': { id: 'MIS-0001-CKPT-0002', missionId: 'MIS-0001', createdAt: '2026-01-01T00:00:00.000Z', summary: 's2', remainingSteps: [], context: null },
          },
        },
      }),
    );
    const model = await collect(dir);
    expect(model.checkpoints).toHaveLength(1);
    expect(model.checkpoints[0].latest?.id).toBe('MIS-0001-CKPT-0002');
    expect(model.diagnostics.some((d) => d.code === 'CHECKPOINT_ORDER_MISMATCH')).toBe(true);
  });

  it('never crashes on an orphan checkpoint whose missionId has no corresponding mission', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    write(
      dir,
      '.monolith/state.json',
      JSON.stringify({
        schemaVersion: 2,
        revision: 1,
        strategic: { systems: {} },
        tactical: {
          missions: {},
          checkpoints: {
            'MIS-9999-CKPT-0001': { id: 'MIS-9999-CKPT-0001', missionId: 'MIS-9999', createdAt: 'a', summary: 's', remainingSteps: [], context: null },
          },
        },
      }),
    );
    const model = await collect(dir);
    expect(model.checkpoints).toEqual([]); // no active missions, so no checkpoint summaries — orphan simply isn't surfaced
  });

  it('reports "no checkpoints" for an active mission with none', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    write(
      dir,
      '.monolith/state.json',
      JSON.stringify({
        schemaVersion: 2,
        revision: 1,
        strategic: { systems: {} },
        tactical: { missions: { 'MIS-0001': { id: 'MIS-0001', title: 'A', system: 'S', status: 'in_progress', startedAt: 'a', updatedAt: 'a', summary: null } }, checkpoints: {} },
      }),
    );
    const model = await collect(dir);
    expect(model.checkpoints[0].latest).toBeNull();
  });
});

describe('collect — Story', () => {
  it('reports ACTIVE_MD_MISSING when the file does not exist', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    const model = await collect(dir);
    expect(model.story.fileExists).toBe(false);
    expect(model.diagnostics.map((d) => d.code)).toContain('ACTIVE_MD_MISSING');
  });

  it('reports ACTIVE_MD_NO_CURRENT_STORY when the file exists but has no such section', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    write(dir, '.monolith/memory/working/active.md', '# Active Working Memory\n\n## Something Else\n\nx\n');
    const model = await collect(dir);
    expect(model.story.fileExists).toBe(true);
    expect(model.story.hasCurrentStorySection).toBe(false);
    expect(model.diagnostics.map((d) => d.code)).toContain('ACTIVE_MD_NO_CURRENT_STORY');
  });

  it('extracts the confirmed Current Story section with provenance including a line range', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    write(dir, '.monolith/memory/working/active.md', '# Title\n\n## Current Story\n\nDoing CONTEXT-001A.\n\n## Next\n');
    const model = await collect(dir);
    expect(model.story.excerpt).toBe('Doing CONTEXT-001A.');
    expect(model.story.provenance?.source).toMatch(/^\.monolith\/memory\/working\/active\.md:\d+-\d+$/);
  });
});

describe('collect — mandatory protocols and ADR discovery', () => {
  it('includes only enforcement: mandatory protocols, by frontmatter field not path/filename', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    write(dir, '.monolith/protocols/a.md', '---\nid: protocol-a\nenforcement: mandatory\n---\n# A\n');
    write(dir, '.monolith/protocols/b.md', '---\nid: protocol-b\nenforcement: conditional\n---\n# B\n');
    const model = await collect(dir);
    expect(model.mandatoryProtocols.items.map((p) => p.id)).toEqual(['protocol-a']);
  });

  it('includes only status: accepted ADRs from the standard <monolithRoot>/adr directory', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    write(dir, '.monolith/adr/ADR-001.md', '---\nid: ADR-001\ntitle: Accepted One\nstatus: accepted\n---\n# Accepted One\n');
    write(dir, '.monolith/adr/ADR-002.md', '---\nid: ADR-002\ntitle: Still Draft\nstatus: proposed\n---\n# Still Draft\n');
    const model = await collect(dir);
    expect(model.adrs.items.map((a) => a.id)).toEqual(['ADR-001']);
  });

  it('does not implicitly fall back to docs/adr when the standard directory is empty', async () => {
    const dir = makeTempDir();
    scaffoldMinimalInstance(dir);
    write(dir, 'docs/adr/ADR-999.md', '---\nid: ADR-999\nstatus: accepted\n---\n# Should not appear\n');
    const model = await collect(dir);
    expect(model.adrs.items).toEqual([]);
  });

  it('includes extra ADR directories only when explicitly configured via contextGateway.adrDirs', async () => {
    const dir = makeTempDir();
    write(dir, 'monolith.config.json', JSON.stringify({ monolithRoot: '.monolith', contextGateway: { adrDirs: ['docs/adr'] } }));
    mkdirSync(join(dir, '.monolith'), { recursive: true });
    write(dir, 'docs/adr/ADR-999.md', '---\nid: ADR-999\nstatus: accepted\n---\n# Extra\n');
    const model = await collect(dir);
    expect(model.adrs.items.map((a) => a.id)).toEqual(['ADR-999']);
  });
});
