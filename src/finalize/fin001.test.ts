/**
 * FIN-001 — Capsule formatting instability (alpha.4).
 *
 * Incident (Second Brain): finalize created the capsule, a formatter (Prettier)
 * rewrote it (blank line after every heading), and the next `finalize plan`
 * reported the capsule as a conflicting file because "already present" was a
 * byte-exact comparison. Root cause: `d.content === content` in buildInternals
 * together with a renderer that is not formatter-stable.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldInstance } from '../init/scaffold.js';
import { applyFinalization, capsuleCanonical, planFinalization, renderCapsule } from './core.js';
import { parseProposal, type FinalizationProposal } from './proposal.js';
import type { ProjectConfig } from '../init/types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const CONFIG: ProjectConfig = {
  projectName: 'fin001',
  language: 'typescript',
  packageManager: 'pnpm',
  aiTool: 'claude',
  finalizationProtocol: 'finalize-story',
  protocols: ['finalize-story'],
  monolithRoot: '.monolith',
};
const EVIDENCE = (kind: string): string =>
  `---\ntype: working\nid: ${kind}\n---\n\n## Last Check\n\n**Status:** PASS\n**Date:** 2026-11-02\n**Story:** FIN-001 — test\n`;

async function instance(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-fin001-'));
  dirs.push(dir);
  await scaffoldInstance(dir, CONFIG);
  writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify({ ...CONFIG }, null, 2));
  writeFileSync(join(dir, '.monolith/memory/working/integrity-result.md'), EVIDENCE('integrity-result'));
  writeFileSync(join(dir, '.monolith/memory/working/governance-result.md'), EVIDENCE('governance-result'));
  return dir;
}

function proposal(objective = 'obj\n\nsecond paragraph'): FinalizationProposal {
  const parsed = parseProposal({
    schemaVersion: 1,
    story: { id: 'FIN-001', title: 'Capsule stability', phase: 'phase-1', phaseHeading: 'Phase 1 — Test', slug: 'story-fin-001', date: '2026-11-02' },
    expectedCurrentStory: 'none',
    work: { objective, implementationSummary: 'impl', filesChanged: ['a.ts'], tests: '10 pass', keyDecisions: 'kd', adrs: [], lessons: 'none' },
    summary: 'Built.',
    keyOutputs: ['src'],
    history: { phaseName: '1 — Test', decision: 'ok', build: 'PASS' },
  });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.proposal;
}

const CAPSULE = '.monolith/memory/working/phases/phase-1/stories/story-fin-001.md';

/** What Prettier does to this document: one blank line after each heading. */
const prettierLike = (s: string): string => s.replace(/^(#{1,6} .*)\n(?!\n)/gm, '$1\n\n');

describe('FIN-001 capsule formatting', () => {
  it('renders a formatter-stable layout: a blank line after every heading', () => {
    const out = renderCapsule(proposal());
    expect(prettierLike(out)).toBe(out);
  });

  it('capsule reformatted after finalize (blank lines, CRLF, trailing spaces) is still ALREADY_FINALIZED and untouched', async () => {
    const dir = await instance();
    const p = proposal();
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('FINALIZED');
    // simulate the formatter pass of an alpha.3-style (unspaced) capsule
    const legacy = renderCapsule(p).replace(/^(#{2} .*)\n\n/gm, '$1\n');
    const reformatted = prettierLike(legacy).replace(/\n/g, '\r\n').replace('obj', 'obj  ');
    writeFileSync(join(dir, CAPSULE), reformatted);
    const plan = planFinalization(dir, p);
    expect(plan.status).toBe('ALREADY_FINALIZED');
    expect(plan.targets.find((t) => t.id === 'capsule')!.state).toBe('done');
    const again = await applyFinalization(dir, p, 'whatever');
    expect(again.status).toBe('ALREADY_FINALIZED');
    expect(readFileSync(join(dir, CAPSULE), 'utf8')).toBe(reformatted); // never rewritten
  });

  it('a capsule written by alpha.3 (no blank lines) is recognised, not a conflict', async () => {
    const dir = await instance();
    const p = proposal();
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('FINALIZED');
    writeFileSync(join(dir, CAPSULE), renderCapsule(p).replace(/^(#{2} .*)\n\n/gm, '$1\n'));
    expect(planFinalization(dir, p).status).toBe('ALREADY_FINALIZED');
  });

  it.each([
    ['changed word', (s: string) => s.replace('impl', 'IMPL')],
    ['removed section line', (s: string) => s.replace('- a.ts', '- b.ts')],
    ['merged paragraph break (blank line outside a heading)', (s: string) => s.replace('obj\n\nsecond', 'obj\nsecond')],
    ['changed status', (s: string) => s.replace('status: COMPLETED', 'status: DRAFT')],
    ['appended text', (s: string) => `${s}\nextra claim\n`],
    ['non-breaking space instead of space', (s: string) => s.replace('10 pass', '10 pass')],
  ])('semantic change (%s) still conflicts and is never overwritten', async (_n, mutate) => {
    const dir = await instance();
    const p = proposal();
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('FINALIZED');
    const changed = prettierLike(mutate(renderCapsule(p)));
    writeFileSync(join(dir, CAPSULE), changed);
    const plan = planFinalization(dir, p);
    expect(plan.status).toBe('NOT_READY');
    expect(plan.targets.find((t) => t.id === 'capsule')!.state).toBe('conflict');
    const r = await applyFinalization(dir, p, plan.digest);
    expect(r.status).toBe('REFUSED');
    expect(readFileSync(join(dir, CAPSULE), 'utf8')).toBe(changed);
  });

  it('capsuleCanonical: two blank lines after a heading, or a blank inside a paragraph, are not equivalent', () => {
    expect(capsuleCanonical('# A\n\n\nx')).not.toBe(capsuleCanonical('# A\nx'));
    expect(capsuleCanonical('# A\nx\n\ny')).not.toBe(capsuleCanonical('# A\nx\ny'));
  });

  it('capsuleCanonical ignores only the documented classes', () => {
    expect(capsuleCanonical('# A\r\n\r\nx  \r\n\r\n')).toBe(capsuleCanonical('# A\nx'));
    expect(capsuleCanonical('x\n\ny')).not.toBe(capsuleCanonical('x\ny'));
    expect(capsuleCanonical('x\n\n\ny')).not.toBe(capsuleCanonical('x\n\ny'));
  });
});

describe('A4-FIN-01 — normalization is context-aware (whitespace that carries meaning is never ignored)', () => {
  const eq = (a: string, b: string): void => expect(capsuleCanonical(a)).toBe(capsuleCanonical(b));
  const ne = (a: string, b: string): void => expect(capsuleCanonical(a)).not.toBe(capsuleCanonical(b));

  describe('hard line breaks', () => {
    it('removing a hard break is a real change', () => ne('line one  \nline two', 'line one\nline two'));
    it('any run of 2+ spaces is the same break; the break survives CRLF', () => {
      eq('line one   \nline two', 'line one  \nline two');
      eq('line one  \r\nline two\r\n', 'line one  \nline two');
    });
    it('trailing spaces that end a paragraph, a heading or the file are not breaks (still ignored)', () => {
      eq('para  \n\nnext', 'para\n\nnext');
      eq('# H  \ntext', '# H\n\ntext');
      eq('last  ', 'last');
    });
    it('a single trailing space or a trailing tab is not a break', () => {
      eq('a \nb', 'a\nb');
      eq('a\t\nb', 'a\nb');
    });
    it('a backslash break is never ignored', () => ne('a\\\nb', 'a\nb'));
  });

  describe('fenced code blocks', () => {
    it('trailing whitespace inside a fence is significant', () => {
      ne('```\nrun  \n```', '```\nrun\n```');
      ne('~~~\nrun \n~~~', '~~~\nrun\n~~~');
    });
    it('a blank line after a "# comment" inside a fence is significant (it is not a heading)', () => {
      ne('```sh\n# comment\nrun\n```', '```sh\n# comment\n\nrun\n```');
    });
    it('blank lines at the end of an unterminated fence are content', () => ne('```\ncode\n\n', '```\ncode'));
    it('a longer closing fence closes; text after it is plain prose again', () => {
      ne('````\nx\n```\ny  \n````\n', '````\nx\n```\ny\n````\n');
      eq('```\nx\n```\nprose  \n\n', '```\nx\n```\nprose');
    });
    it('CRLF vs LF inside a fence is still format-only', () => eq('```\r\nx\r\n```\r\n', '```\nx\n```'));
    it('an inline-code triple backtick line is not a fence', () => eq('``` a`b\ntext  \n\nz', '``` a`b\ntext\n\nz'));
  });

  describe('YAML frontmatter', () => {
    it('trailing whitespace in frontmatter is significant', () => {
      ne('---\nkey: value  \n---\n\n# A', '---\nkey: value\n---\n\n# A');
      ne('---\ntext: |\n  a \n---\n', '---\ntext: |\n  a\n---\n');
    });
    it('an unterminated frontmatter protects the whole file', () => ne('---\nkey: v  \nbody', '---\nkey: v\nbody'));
    it('the body after a frontmatter is still normalised', () => eq('---\nk: v\n---\n# A\ntext  \n\n', '---\nk: v\n---\n# A\n\ntext'));
    it('a "---" thematic break later in the file is not frontmatter', () => eq('# A\n\n---\nafter  \n\n', '# A\n\n---\nafter'));
  });

  describe('other whitespace-sensitive regions', () => {
    it('indented code and tab-indented lines are compared as written', () => {
      ne('text\n\n    code  \n', 'text\n\n    code\n');
      ne('text\n\n\tcode \n', 'text\n\n\tcode\n');
    });
    it('HTML comments are compared as written', () => {
      ne('<!--\nnote  \n-->\n', '<!--\nnote\n-->\n');
      ne('<!-- note  -->  \nnext', '<!-- note  -->\nnext');
    });
  });

  describe('review round 1', () => {
    it('HTML blocks (a blank line ends them) are compared as written', () => {
      ne('<div>\n# x\n\ntext\n', '<div>\n# x\ntext\n');
      ne('<pre>\nraw  \n</pre>\n', '<pre>\nraw\n</pre>\n');
    });
    it('"#" followed by a non-breaking space is not a heading (no blank line is skipped)', () => {
      ne('#\u00a0foo\n\nbar', '#\u00a0foo\nbar');
    });
    it('blockquoted code keeps its whitespace', () => ne('> ```\n> code \n> ```', '> ```\n> code\n> ```'));
  });

  describe('compatibility is kept', () => {
    it('Prettier-style layout of plain content and alpha.3 capsules stay equivalent', () => {
      const alpha3 = '# STORY X\n## Objective\nobj\n\n## Tests\n10 pass\n';
      const prettier = '# STORY X\n\n## Objective\n\nobj\n\n## Tests\n\n10 pass\n';
      eq(alpha3, prettier);
      eq(prettier.replace(/\n/g, '\r\n').replace('obj', 'obj  '), alpha3);
    });
    it('identical documents are always equivalent, hard breaks, fences and frontmatter included', () => {
      const doc = '---\na: b \n---\n# T\n\nx  \ny\n\n```\n# c\nz  \n```\n\n    ind  \n\n<!--\nc  \n-->\n';
      eq(doc, doc);
      eq(doc.replace(/\n/g, '\r\n'), doc);
    });
  });

  describe('through finalization', () => {
    const richObjective = 'intro\n\n```sh\n# comment\nrun  \n```\n\nhard  \nbreak';
    const setup = async () => {
      const dir = await instance();
      const p = proposal(richObjective);
      expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('FINALIZED');
      return { dir, p, text: readFileSync(join(dir, CAPSULE), 'utf8') };
    };

    it('a formatter-style pass over plain lines (CRLF, trailing spaces on prose) is ALREADY_FINALIZED and untouched', async () => {
      const { dir, p, text } = await setup();
      const reformatted = text.replace(/\n/g, '\r\n').replace('intro', 'intro   ');
      writeFileSync(join(dir, CAPSULE), reformatted);
      expect(planFinalization(dir, p).status).toBe('ALREADY_FINALIZED');
      expect(readFileSync(join(dir, CAPSULE), 'utf8')).toBe(reformatted);
    });

    it.each([
      ['hard break removed', (t: string) => t.replace('hard  \nbreak', 'hard\nbreak')],
      ['trailing whitespace inside the code fence removed', (t: string) => t.replace('run  \n```', 'run\n```')],
      ['blank line added inside the code fence', (t: string) => t.replace('# comment\nrun', '# comment\n\nrun')],
      ['code line inside the fence changed', (t: string) => t.replace('run  ', 'rm -rf  ')],
    ])('%s → conflict, never overwritten', async (_n, mutate) => {
      const { dir, p, text } = await setup();
      const changed = mutate(text);
      expect(changed).not.toBe(text);
      writeFileSync(join(dir, CAPSULE), changed);
      const plan = planFinalization(dir, p);
      expect(plan.targets.find((t) => t.id === 'capsule')!.state).toBe('conflict');
      expect((await applyFinalization(dir, p, plan.digest)).status).toBe('REFUSED');
      expect(readFileSync(join(dir, CAPSULE), 'utf8')).toBe(changed);
    });

    it('re-finalizing the unchanged capsule is idempotent', async () => {
      const { dir, p, text } = await setup();
      expect((await applyFinalization(dir, p, 'x')).status).toBe('ALREADY_FINALIZED');
      expect(readFileSync(join(dir, CAPSULE), 'utf8')).toBe(text);
    });
  });
});
