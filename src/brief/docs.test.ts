import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { discoverDocs } from './docs.js';
import type { BriefDiagnostic } from './types.js';

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

describe('discoverDocs — resilience to a broken filesystem entry (F-2)', () => {
  it('skips a dangling symlink without crashing, and still collects other documents', () => {
    const dir = makeTempDir();
    writeDoc(dir, 'adr/ADR-001.md', ['---', 'id: ADR-001', 'status: accepted', '---', '# One'].join('\n'));
    symlinkSync(join(dir, 'adr', 'does-not-exist.md'), join(dir, 'adr', 'dangling.md'));

    const diagnostics: BriefDiagnostic[] = [];
    const items = discoverDocs(dir, ['adr'], (fields) => fields.get('status') === 'accepted', diagnostics);
    expect(items.map((i) => i.id)).toEqual(['ADR-001']);
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(false); // a skipped symlink is not itself an error
  });

  it('does not hang or crash on a symlinked directory cycle', () => {
    const dir = makeTempDir();
    writeDoc(dir, 'adr/ADR-001.md', ['---', 'id: ADR-001', 'status: accepted', '---', '# One'].join('\n'));
    mkdirSync(join(dir, 'adr', 'sub'), { recursive: true });
    symlinkSync(join(dir, 'adr'), join(dir, 'adr', 'sub', 'loop')); // sub/loop -> adr, a cycle if ever followed

    const items = discoverDocs(dir, ['adr'], (fields) => fields.get('status') === 'accepted');
    expect(items.map((i) => i.id)).toEqual(['ADR-001']);
  });

  it('reports DOC_DIR_UNREADABLE and keeps collecting from sibling, readable directories', () => {
    const dir = makeTempDir();
    writeDoc(dir, 'adr/ADR-001.md', ['---', 'id: ADR-001', 'status: accepted', '---', '# One'].join('\n'));
    mkdirSync(join(dir, 'adr', 'locked'), { recursive: true });
    writeDoc(dir, 'adr/locked/ADR-999.md', ['---', 'id: ADR-999', 'status: accepted', '---', '# Hidden'].join('\n'));
    chmodSync(join(dir, 'adr', 'locked'), 0o000);

    try {
      const diagnostics: BriefDiagnostic[] = [];
      const items = discoverDocs(dir, ['adr'], (fields) => fields.get('status') === 'accepted', diagnostics);
      expect(items.map((i) => i.id)).toEqual(['ADR-001']);
      const diag = diagnostics.find((d) => d.code === 'DOC_DIR_UNREADABLE');
      expect(diag?.severity).toBe('error');
    } finally {
      chmodSync(join(dir, 'adr', 'locked'), 0o755);
    }
  });

  it('reports DOC_FILE_UNREADABLE and keeps collecting other files in the same directory', () => {
    const dir = makeTempDir();
    writeDoc(dir, 'adr/ADR-001.md', ['---', 'id: ADR-001', 'status: accepted', '---', '# One'].join('\n'));
    writeDoc(dir, 'adr/ADR-002.md', ['---', 'id: ADR-002', 'status: accepted', '---', '# Two'].join('\n'));
    chmodSync(join(dir, 'adr', 'ADR-002.md'), 0o000);

    try {
      const diagnostics: BriefDiagnostic[] = [];
      const items = discoverDocs(dir, ['adr'], (fields) => fields.get('status') === 'accepted', diagnostics);
      expect(items.map((i) => i.id)).toEqual(['ADR-001']);
      const diag = diagnostics.find((d) => d.code === 'DOC_FILE_UNREADABLE');
      expect(diag?.severity).toBe('error');
    } finally {
      chmodSync(join(dir, 'adr', 'ADR-002.md'), 0o644);
    }
  });
});

describe('discoverDocs — path containment (F-3)', () => {
  it('rejects a configured directory that escapes the project root via ".." and never reads it', () => {
    const dir = makeTempDir();
    const outside = makeTempDir();
    writeDoc(outside, 'secret/ADR-666.md', ['---', 'id: ADR-666', 'status: accepted', '---', '# Secret'].join('\n'));
    const escapingRelDir = relative(dir, join(outside, 'secret'));
    expect(escapingRelDir.startsWith('..')).toBe(true); // sanity check on the fixture itself

    const diagnostics: BriefDiagnostic[] = [];
    const items = discoverDocs(dir, [escapingRelDir], (fields) => fields.get('status') === 'accepted', diagnostics);
    expect(items).toEqual([]);
    const diag = diagnostics.find((d) => d.code === 'DOC_DIR_OUTSIDE_PROJECT');
    expect(diag?.severity).toBe('error');
  });

  it('rejects a configured directory that is itself a symlink escaping the project root', () => {
    const dir = makeTempDir();
    const outside = makeTempDir();
    writeDoc(outside, 'ADR-666.md', ['---', 'id: ADR-666', 'status: accepted', '---', '# Secret'].join('\n'));
    symlinkSync(outside, join(dir, 'escape-adr'));

    const diagnostics: BriefDiagnostic[] = [];
    const items = discoverDocs(dir, ['escape-adr'], (fields) => fields.get('status') === 'accepted', diagnostics);
    expect(items).toEqual([]);
    const diag = diagnostics.find((d) => d.code === 'DOC_DIR_OUTSIDE_PROJECT');
    expect(diag?.severity).toBe('error');
  });

  it('still accepts a normal, project-contained extra directory (contextGateway.adrDirs keeps working)', () => {
    const dir = makeTempDir();
    writeDoc(dir, 'docs/adr/ADR-001.md', ['---', 'id: ADR-001', 'status: accepted', '---', '# One'].join('\n'));

    const diagnostics: BriefDiagnostic[] = [];
    const items = discoverDocs(dir, ['docs/adr'], (fields) => fields.get('status') === 'accepted', diagnostics);
    expect(items.map((i) => i.id)).toEqual(['ADR-001']);
    expect(diagnostics.some((d) => d.code === 'DOC_DIR_OUTSIDE_PROJECT')).toBe(false);
  });
});
