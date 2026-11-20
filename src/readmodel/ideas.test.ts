/** GOV-EVOLUTION Phase 4: Ideas read model — read-only view over the existing idea store. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDashboardModel } from './index.js';
import { readIdeas, MAX_IDEA_DESCRIPTION_CHARS } from './ideas.js';
import { addIdea, ideaStore } from '../ideas/index.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'ideas-')));
  writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify({ project: { name: 'P' } }));
  mkdirSync(join(dir, '.monolith'), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function snapshot(root: string): string {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(`${p}:${st.size}:${st.mtimeMs}`);
    }
  };
  walk(root);
  return out.join('\n');
}

describe('readIdeas', () => {
  it("shows this repository's captured ideas IDEA-001..004 with provenance", () => {
    const s = readIdeas(REPO, '.monolith');
    expect(s.sources[0]).toMatchObject({ id: 'ideas', status: 'available', code: null });
    expect(s.data!.items.map((i) => i.id)).toEqual(['IDEA-001', 'IDEA-002', 'IDEA-003', 'IDEA-004']);
    const first = s.data!.items[0];
    expect(first).toMatchObject({ path: '.monolith/memory/long-term/ideas/IDEA-001.md' });
    expect(first.title.length).toBeGreaterThan(0);
    expect(first.description.length).toBeGreaterThan(0);
    expect(['inbox', 'planned', 'archived']).toContain(first.status);
    expect(s.data!.complete).toBe(true);
  });

  it('is part of the dashboard model, independent of hypotheses', () => {
    const m = readDashboardModel(REPO);
    expect(m.ideas!.data!.items).toHaveLength(4);
    expect(m.hypotheses!.sources[0].id).toBe('hypotheses');
  });

  it('absent directory is "absent" (nothing captured yet), not an empty list', () => {
    const s = readIdeas(dir, '.monolith');
    expect(s.data).toBeNull();
    expect(s.sources[0]).toMatchObject({ status: 'absent', code: 'SOURCE_ABSENT' });
  });

  it('reads what `idea add` wrote and does not modify the store (incl. .ids)', () => {
    const store = ideaStore(dir);
    addIdea(store, { title: 'First <b>idea</b>', description: 'Body with `code` and <script>alert(1)</script>', context: 'ctx' });
    addIdea(store, { title: 'Second', description: 'x'.repeat(MAX_IDEA_DESCRIPTION_CHARS + 50) });
    const before = snapshot(join(dir, '.monolith'));
    const s = readIdeas(dir, '.monolith');
    expect(snapshot(join(dir, '.monolith'))).toBe(before);
    expect(readIdeas(dir, '.monolith')).toEqual(s);
    expect(s.data!.items.map((i) => i.id)).toEqual(['IDEA-001', 'IDEA-002']);
    expect(s.data!.items[0]).toMatchObject({ title: 'First <b>idea</b>', status: 'inbox', context: 'ctx', descriptionTruncated: false });
    expect(s.data!.items[0].description).toContain('<script>alert(1)</script>'); // data, never interpreted
    expect(s.data!.items[1].descriptionTruncated).toBe(true);
    expect(s.data!.items[1].description.length).toBeLessThanOrEqual(MAX_IDEA_DESCRIPTION_CHARS);
  });

  it('a corrupt frontmatter is an issue, not a silent drop and not a crash', () => {
    addIdea(ideaStore(dir), { title: 'Good', description: 'ok' });
    writeFileSync(join(dir, '.monolith/memory/long-term/ideas/IDEA-002.md'), '---\nid: IDEA-002\n(broken\n');
    const s = readIdeas(dir, '.monolith');
    expect(s.data!.items.map((i) => i.id)).toEqual(['IDEA-001']);
    expect(s.data!.issues).toEqual([{ id: 'IDEA-002', code: 'IDEA_CORRUPT' }]);
    expect(s.data!.complete).toBe(false);
    expect(JSON.stringify(s)).not.toContain(dir); // no absolute path crosses the boundary
  });

  it('refuses a symlinked idea file and a symlinked ideas directory', () => {
    addIdea(ideaStore(dir), { title: 'Good', description: 'ok' });
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'ideas-out-')));
    try {
      writeFileSync(join(outside, 'secret.md'), 'TOP SECRET');
      symlinkSync(join(outside, 'secret.md'), join(dir, '.monolith/memory/long-term/ideas/IDEA-002.md'));
      const s = readIdeas(dir, '.monolith');
      expect(s.data!.issues).toEqual([{ id: 'IDEA-002', code: 'IDEA_UNSAFE_PATH' }]);
      expect(JSON.stringify(s)).not.toContain('TOP SECRET');

      rmSync(join(dir, '.monolith/memory/long-term/ideas'), { recursive: true });
      mkdirSync(join(outside, 'ideas'));
      cpSync(join(REPO, '.monolith/memory/long-term/ideas/IDEA-001.md'), join(outside, 'ideas/IDEA-001.md'));
      symlinkSync(join(outside, 'ideas'), join(dir, '.monolith/memory/long-term/ideas'));
      const t = readIdeas(dir, '.monolith');
      expect(t.data).toBeNull();
      expect(t.sources[0].status).toBe('forbidden');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('works without any idea and leaves the other sources independent', () => {
    mkdirSync(join(dir, '.monolith/memory/long-term/ideas'), { recursive: true });
    const s = readIdeas(dir, '.monolith');
    expect(s.data).toEqual({ items: [], issues: [], truncated: false, complete: true });
    expect(readFileSync(join(dir, 'monolith.config.json'), 'utf8')).toContain('"P"');
  });
});
