import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { discoverDocs } from './docs.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-brief-docs-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function writeDoc(dir: string, relPath: string, content: string): void {
  const full = join(dir, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

describe('discoverDocs', () => {
  it('finds documents matching the predicate, sorted by id', () => {
    const dir = makeTempDir();
    writeDoc(
      dir,
      'adr/ADR-002.md',
      ['---', 'type: adr', 'id: ADR-002', 'title: Second', 'status: accepted', '---', '# Second'].join('\n'),
    );
    writeDoc(
      dir,
      'adr/ADR-001.md',
      ['---', 'type: adr', 'id: ADR-001', 'title: First', 'status: accepted', '---', '# First'].join('\n'),
    );
    writeDoc(
      dir,
      'adr/ADR-003.md',
      ['---', 'type: adr', 'id: ADR-003', 'title: Draft', 'status: proposed', '---', '# Draft'].join('\n'),
    );

    const items = discoverDocs(dir, ['adr'], (fields) => fields.get('status') === 'accepted');
    expect(items.map((i) => i.id)).toEqual(['ADR-001', 'ADR-002']);
    expect(items[0]).toEqual({ id: 'ADR-001', title: 'First', path: 'adr/ADR-001.md' });
  });

  it('falls back to the first H1 heading when frontmatter has no title', () => {
    const dir = makeTempDir();
    writeDoc(
      dir,
      'protocols/p1.md',
      ['---', 'type: protocol', 'id: protocol-x', 'enforcement: mandatory', '---', '', '# X Protocol', 'body'].join('\n'),
    );
    const items = discoverDocs(dir, ['protocols'], (fields) => fields.get('enforcement') === 'mandatory');
    expect(items).toEqual([{ id: 'protocol-x', title: 'X Protocol', path: 'protocols/p1.md' }]);
  });

  it('falls back to the id when there is no frontmatter title and no H1', () => {
    const dir = makeTempDir();
    writeDoc(dir, 'protocols/p1.md', ['---', 'id: protocol-x', 'enforcement: mandatory', '---', 'no heading here'].join('\n'));
    const items = discoverDocs(dir, ['protocols'], (fields) => fields.get('enforcement') === 'mandatory');
    expect(items[0].title).toBe('protocol-x');
  });

  it('skips files with no frontmatter block', () => {
    const dir = makeTempDir();
    writeDoc(dir, 'adr/README.md', '# Not a frontmatter doc\n');
    const items = discoverDocs(dir, ['adr'], () => true);
    expect(items).toEqual([]);
  });

  it('skips files with frontmatter but no id', () => {
    const dir = makeTempDir();
    writeDoc(dir, 'adr/no-id.md', ['---', 'status: accepted', '---', '# No Id'].join('\n'));
    const items = discoverDocs(dir, ['adr'], (fields) => fields.get('status') === 'accepted');
    expect(items).toEqual([]);
  });

  it('returns [] when the directory does not exist (no implicit fallback)', () => {
    const dir = makeTempDir();
    expect(discoverDocs(dir, ['adr'], () => true)).toEqual([]);
  });

  it('walks nested subdirectories', () => {
    const dir = makeTempDir();
    writeDoc(
      dir,
      'protocols/governance/deep.md',
      ['---', 'id: protocol-deep', 'enforcement: mandatory', '---', '# Deep'].join('\n'),
    );
    const items = discoverDocs(dir, ['protocols'], (fields) => fields.get('enforcement') === 'mandatory');
    expect(items).toEqual([{ id: 'protocol-deep', title: 'Deep', path: 'protocols/governance/deep.md' }]);
  });

  it('merges multiple directories and still sorts deterministically', () => {
    const dir = makeTempDir();
    writeDoc(dir, 'adr/ADR-002.md', ['---', 'id: ADR-002', 'status: accepted', '---', '# B'].join('\n'));
    writeDoc(dir, 'extra-adr/ADR-001.md', ['---', 'id: ADR-001', 'status: accepted', '---', '# A'].join('\n'));
    const items = discoverDocs(dir, ['adr', 'extra-adr'], (fields) => fields.get('status') === 'accepted');
    expect(items.map((i) => i.id)).toEqual(['ADR-001', 'ADR-002']);
  });
});
