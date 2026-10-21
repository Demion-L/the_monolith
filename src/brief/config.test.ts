import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readBriefConfig } from './config.js';

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

  it('returns safe defaults when monolith.config.json is not valid JSON', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'monolith.config.json'), '{ not json', 'utf8');
    expect(readBriefConfig(dir)).toEqual({ monolithRoot: '.monolith', projectName: 'project', extraAdrDirs: [] });
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
