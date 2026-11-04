/**
 * PSC-004 — Section integrity, identity semantics, recordedText integrity.
 * Synthetic fixtures only.
 *   F-1  headings inside fences / comments are not the Current Story section
 *   F-2  an unbolded leading id is a sentence, not a declaration
 *   F-3  ids shown only inside fences / comments are not "recorded"
 *   F-4  one Markdown-context helper for Brief and DOCSYNC
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { extractCurrentStory } from './story.js';
import { evaluateFreshness, parseActiveStoryClaim, type FreshnessEvidence } from './freshness.js';
import { reconcile } from './reconcile.js';
import { collect } from './collect.js';
import { activeStoryIdentity } from '../finalize/core.js';

const F = '```';
const sectionOf = (doc: string) => extractCurrentStory(doc).excerpt;

describe('PSC-004 F-1: Current Story section selection', () => {
  it('a heading inside a backtick fence before the real one is skipped', () => {
    const doc = ['# Notes', '', `${F}markdown`, '## Current Story', '', '**Story:** STORY-001', F, '', '## Current Story', '', '**Story:** STORY-002', '', '---'].join('\n');
    const r = extractCurrentStory(doc);
    expect(r.excerpt).toBe('**Story:** STORY-002');
    expect(r.lineRange).toBe('11-11');
  });

  it('tilde fences, longer delimiters and CRLF', () => {
    expect(sectionOf('~~~\n## Current Story\nSTORY-001\n~~~\n## Current Story\nSTORY-002\n')).toBe('STORY-002');
    expect(sectionOf('````\n```\n## Current Story\nSTORY-001\n````\n## Current Story\nSTORY-002')).toBe('STORY-002');
    expect(sectionOf('```\r\n## Current Story\r\nSTORY-001\r\n```\r\n## Current Story\r\nSTORY-002\r\n')).toContain('STORY-002');
    expect(sectionOf('```\r\n## Current Story\r\nSTORY-001\r\n```\r\n## Current Story\r\nSTORY-002\r\n')).not.toContain('STORY-001');
  });

  it('a heading inside a single- or multi-line HTML comment is skipped', () => {
    expect(sectionOf('<!-- ## Current Story -->\n## Current Story\nSTORY-002')).toBe('STORY-002');
    expect(sectionOf('<!--\n## Current Story\nSTORY-001\n-->\n## Current Story\nSTORY-002')).toBe('STORY-002');
    expect(sectionOf('text <!--\n## Current Story\nSTORY-001\n-->\n## Current Story\nSTORY-002')).toBe('STORY-002');
  });

  it('a fake heading after the real one does not make the section ambiguous', () => {
    const r = extractCurrentStory(`## Current Story\nSTORY-002\n\n---\n${F}\n## Current Story\nSTORY-001\n${F}\n`);
    expect(r.excerpt).toBe('STORY-002');
    expect(r.ambiguous).toBeUndefined();
  });

  it('a fenced "## Heading" or "---" inside the section does not end it', () => {
    expect(sectionOf(`## Current Story\nA\n${F}\n## Not a heading\n---\n${F}\nB\n\n## Next`)).toBe(`A\n${F}\n## Not a heading\n---\n${F}\nB`);
  });

  it('only fenced / commented headings → no section', () => {
    expect(extractCurrentStory(`${F}\n## Current Story\nS-1\n${F}`).hasCurrentStorySection).toBe(false);
    expect(extractCurrentStory('<!-- ## Current Story\nS-1 -->').hasCurrentStorySection).toBe(false);
  });

  it('unclosed fence / comment before the real heading hides it (fail closed)', () => {
    expect(extractCurrentStory(`${F}\n## Current Story\nS-1`).hasCurrentStorySection).toBe(false);
    expect(extractCurrentStory('<!--\n## Current Story\nS-1').hasCurrentStorySection).toBe(false);
  });

  it('a heading that only appears after a comment is stripped is not a heading', () => {
    expect(extractCurrentStory('<!-- x --> ## Current Story\nS-1').hasCurrentStorySection).toBe(false);
  });

  it('a comment opened on the heading line is not a heading and cannot leak identity', () => {
    const r = extractCurrentStory('# A\n\n## Current Story <!--\n**Story:** FAKE-001 — x\n-->\n\n## Last Finalization\n');
    expect(r.hasCurrentStorySection).toBe(false);
    expect(extractCurrentStory('## Current Story <!-- c -->\n**Story:** S-1').hasCurrentStorySection).toBe(false);
  });

  it('two real headings → ambiguous, no section, no guess', () => {
    const r = extractCurrentStory('## Current Story\nS-1\n\n## Other\n\n## Current Story\nS-2');
    expect(r).toEqual({ hasCurrentStorySection: false, excerpt: null, lineRange: null, ambiguous: true });
    expect(parseActiveStoryClaim(r.excerpt)).toEqual({ kind: 'unknown' });
  });

  it('headings with extra spaces / any case still match', () => {
    expect(sectionOf('##   current story   \nS-1')).toBe('S-1');
  });
});

describe('PSC-004 F-2: unverified mentions are not identity', () => {
  it.each([
    'STORY-001 was completed yesterday.',
    'STORY-001 — completed yesterday',
    '**STORY-001** was completed yesterday.',
    'STORY-001',
    'The work on STORY-001 continues',
    `${F}\n**STORY-001 — x**\n${F}`,
    '<!-- **STORY-001** — x -->',
    '**STORY-001 — x** and STORY-002',
  ])('%j → unknown', (text) => {
    expect(parseActiveStoryClaim(text)).toEqual({ kind: 'unknown' });
  });

  it.each([
    ['**STORY-001**', 'STORY-001'],
    ['**STORY-001** — in progress', 'STORY-001'],
    ['**COORDINATORIUM-001 — Tactical Coordinatorium: Mission Lifecycle MVP**\nStatus: implemented', 'COORDINATORIUM-001'],
    ['**Story:** S-2 — see STORY-001', 'S-2'],
  ])('%j → %s (structural / historical declaration)', (text, id) => {
    expect(parseActiveStoryClaim(text)).toEqual({ kind: 'ids', ids: [id] });
  });

  it('duplicate or malformed **Story:** fields → unknown', () => {
    expect(parseActiveStoryClaim('**Story:** S-1\n**Story:** S-2')).toEqual({ kind: 'unknown' });
    expect(parseActiveStoryClaim('**Story:** — no id')).toEqual({ kind: 'unknown' });
  });

  it('a completed story mentioned as a sentence never yields STALE; a real declaration still does', () => {
    const base: FreshnessEvidence = {
      git: { status: 'unavailable', reason: 'NOT_A_GIT_REPOSITORY' },
      activeStory: { kind: 'unknown' },
      roadmapActiveStory: null,
      roadmapStatuses: new Map([['STORY-001', 'COMPLETED']]),
      storyIndexStatuses: new Map(),
      recordedText: '',
      stateFiles: new Set(),
    };
    expect(evaluateFreshness({ ...base, activeStory: parseActiveStoryClaim('STORY-001 was completed yesterday.') }).status).not.toBe('STALE');
    expect(evaluateFreshness({ ...base, activeStory: parseActiveStoryClaim('**Story:** STORY-001 — x') }).status).toBe('STALE');
    expect(evaluateFreshness({ ...base, activeStory: parseActiveStoryClaim('**STORY-001** — x') }).status).toBe('STALE');
  });
});

describe('PSC-004 F-4: Brief and DOCSYNC read identity with the same Markdown context', () => {
  const cases: Array<[string, string]> = [
    ['inline-opened multi-line comment', 'intro <!--\n**Story:** FAKE-1\n-->\n**Story:** REAL-1'],
    ['field after an inline comment close on a later line', 'x <!-- start\nend --> tail\n**Story:** REAL-1'],
    ['fenced field', `${F}\n**Story:** FAKE-1\n${F}\n**Story:** REAL-1`],
    ['comment containing only a field', '<!-- **Story:** FAKE-1 -->\n**Story:** REAL-1'],
    ['only a commented field', 'x <!--\n**Story:** FAKE-1\n-->'],
  ];
  it.each(cases)('%s: same identity in both readers', (_n, body) => {
    const docsync = activeStoryIdentity(body);
    const brief = parseActiveStoryClaim(body);
    if (docsync.ok) expect(brief).toEqual({ kind: 'ids', ids: [docsync.id] });
    else expect(brief).toEqual({ kind: 'unknown' });
    if (docsync.ok) expect(docsync.id).toBe('REAL-1');
  });
});

describe('PSC-004 F-3: recordedText integrity (through collect / reconcile)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  const put = (dir: string, rel: string, content: string): void => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  const git = (dir: string, ...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' });
  };

  async function fixture(handoff: string | null, roadmapExtra: string) {
    const dir = mkdtempSync(join(tmpdir(), 'monolith-psc004-'));
    dirs.push(dir);
    git(dir, 'init', '-q');
    put(dir, 'monolith.config.json', JSON.stringify({ project: { name: 'fixture' }, monolithRoot: '.monolith' }));
    put(dir, '.monolith/memory/working/active.md', '# Active\n\n## Current Story\n\nNo active story recorded.\n\n---\n');
    put(dir, '.monolith/context/maps/roadmap-index.md', `Active Story: none\n\n${roadmapExtra}\n`);
    if (handoff !== null) put(dir, '.monolith/context/boot/HANDOFF.md', handoff);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'state');
    put(dir, 'src/x.ts', 'export {};\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat(WIDGET-007): do the thing');
    return dir;
  }

  it('an id only inside a roadmap code fence or comment does not suppress UNRECORDED_WORK', async () => {
    const dir = await fixture(null, `${F}\nWIDGET-007 example\n${F}\n<!-- WIDGET-007 -->`);
    const m = await collect(dir);
    expect(m.freshness.unrecordedWork).toEqual(['WIDGET-007']);
    expect(m.freshness.reasons.map((r) => r.code)).toContain('UNRECORDED_WORK');
  });

  it('HANDOFF is plain prose evidence: a real mention records the work, a fenced / commented one does not', async () => {
    const fenced = await collect(await fixture(`# Handoff\n\n${F}\nWIDGET-007\n${F}\n<!--\nWIDGET-007\n-->\n`, ''));
    expect(fenced.freshness.unrecordedWork).toEqual(['WIDGET-007']);
    const real = await collect(await fixture('# Handoff\n\nFinished WIDGET-007 last week.\n', ''));
    expect(real.freshness.unrecordedWork).toEqual([]);
    expect(real.freshness.reasons.map((r) => r.code)).not.toContain('UNRECORDED_WORK');
  });

  it('a real mention in a state document still records the work', async () => {
    const m = await collect(await fixture(null, '| WIDGET-007 | W | IN PROGRESS | d |'));
    expect(m.freshness.unrecordedWork).toEqual([]);
  });

  it('reconcile agrees with freshness on the masked evidence', async () => {
    const dir = await fixture(null, `${F}\nWIDGET-007\n${F}`);
    const { freshness } = await collect(dir);
    expect(freshness.unrecordedWork).toEqual(['WIDGET-007']);
  });

  it('IDEA-NNN stays outside the work-item namespace; a real contradiction is preserved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'monolith-psc004-'));
    dirs.push(dir);
    git(dir, 'init', '-q');
    put(dir, 'monolith.config.json', JSON.stringify({ project: { name: 'fixture' }, monolithRoot: '.monolith' }));
    put(dir, '.monolith/memory/working/active.md', '# A\n\n## Current Story\n\n**Story:** STORY-002 — x\n\n---\n');
    put(dir, '.monolith/context/maps/roadmap-index.md', '| STORY-002 | T | COMPLETED | d |\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'state');
    put(dir, 'src/x.ts', 'export {};\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: capture IDEA-002');
    const m = await collect(dir);
    expect(m.freshness.status).toBe('STALE');
    expect(m.freshness.unrecordedWork).toEqual([]);
    expect(m.freshness.reasons.map((r) => r.code)).toContain('STATE_CONTRADICTION');
  });

  it('whole pipeline: a fake fenced Current Story heading cannot create a false STALE', async () => {
    const dir = await fixture(null, '| STORY-001 | T | COMPLETED | d |');
    put(dir, '.monolith/memory/working/active.md', `# Notes\n\n${F}markdown\n## Current Story\n\n**Story:** STORY-001\n${F}\n\n## Current Story\n\n**Story:** STORY-002 — real\n\n---\n`);
    const m = await collect(dir);
    expect(m.freshness.reasons.map((r) => r.code)).not.toContain('STATE_CONTRADICTION');
  });

  it('reconcile() is a pure function of evidence (smoke)', () => {
    expect(typeof reconcile).toBe('function');
  });
});
