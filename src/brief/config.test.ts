import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readBriefConfig } from './config.js';
import type { BriefDiagnostic } from './types.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-brief-config-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('readBriefConfig', () => {
  it('returns safe defaults when monolith.config.json does not exist', () => {
    const dir = makeTempDir();
    expect(readBriefConfig(dir)).toEqual({ monolithRoot: '.monolith', projectName: 'project', extraAdrDirs: [] });
  });

  it('returns safe defaults when monolith.config.json is not valid JSON, and does not mask the corruption (F-6)', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'monolith.config.json'), '{ not json', 'utf8');
    const diagnostics: BriefDiagnostic[] = [];
    expect(readBriefConfig(dir, diagnostics)).toEqual({ monolithRoot: '.monolith', projectName: 'project', extraAdrDirs: [] });
    const diag = diagnostics.find((d) => d.code === 'CONFIG_UNREADABLE');
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe('error');
  });

  it('does not emit any diagnostic when monolith.config.json is simply absent (F-6 — absence is a legitimate default)', () => {
    const dir = makeTempDir();
    const diagnostics: BriefDiagnostic[] = [];
    readBriefConfig(dir, diagnostics);
    expect(diagnostics).toEqual([]);
  });

  it('reports CONFIG_UNREADABLE when monolith.config.json parses but is not a JSON object', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify(['not', 'an', 'object']), 'utf8');
    const diagnostics: BriefDiagnostic[] = [];
    const cfg = readBriefConfig(dir, diagnostics);
    expect(cfg).toEqual({ monolithRoot: '.monolith', projectName: 'project', extraAdrDirs: [] });
    expect(diagnostics.some((d) => d.code === 'CONFIG_UNREADABLE' && d.severity === 'error')).toBe(true);
  });

  it('reports CONFIG_ADR_DIRS_INVALID (error) rather than silently collapsing a wrong-type adrDirs to []', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify({ contextGateway: { adrDirs: 'docs/adr' } }), 'utf8');
    const diagnostics: BriefDiagnostic[] = [];
    const cfg = readBriefConfig(dir, diagnostics);
    expect(cfg.extraAdrDirs).toEqual([]);
    const diag = diagnostics.find((d) => d.code === 'CONFIG_ADR_DIRS_INVALID');
    expect(diag?.severity).toBe('error');
  });

  it('reports CONFIG_ADR_DIRS_INVALID (warn) when some entries are dropped from an otherwise-valid array', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify({ contextGateway: { adrDirs: ['ok', 42, null] } }), 'utf8');
    const diagnostics: BriefDiagnostic[] = [];
    const cfg = readBriefConfig(dir, diagnostics);
    expect(cfg.extraAdrDirs).toEqual(['ok']);
    const diag = diagnostics.find((d) => d.code === 'CONFIG_ADR_DIRS_INVALID');
    expect(diag?.severity).toBe('warn');
  });

  it('reads monolithRoot and project.name', () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, 'monolith.config.json'),
      JSON.stringify({ monolithRoot: '.custom', project: { name: 'Acme' } }),
      'utf8',
    );
    const cfg = readBriefConfig(dir);
    expect(cfg.monolithRoot).toBe('.custom');
    expect(cfg.projectName).toBe('Acme');
  });

  it('reads contextGateway.adrDirs as the minimal additional-ADR-directory extension', () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, 'monolith.config.json'),
      JSON.stringify({ contextGateway: { adrDirs: ['docs/adr', 'legacy/decisions'] } }),
      'utf8',
    );
    expect(readBriefConfig(dir).extraAdrDirs).toEqual(['docs/adr', 'legacy/decisions']);
  });

  it('ignores a non-array adrDirs rather than throwing', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify({ contextGateway: { adrDirs: 'oops' } }), 'utf8');
    expect(readBriefConfig(dir).extraAdrDirs).toEqual([]);
  });

  it('filters non-string entries out of adrDirs', () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, 'monolith.config.json'),
      JSON.stringify({ contextGateway: { adrDirs: ['ok', 42, null] } }),
      'utf8',
    );
    expect(readBriefConfig(dir).extraAdrDirs).toEqual(['ok']);
  });
});
