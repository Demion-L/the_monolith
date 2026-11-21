/**
 * FIN-003 — Capsule YAML frontmatter: representation vs. semantics.
 *
 * Incident (Second Brain, SEM-001 / SEM-002): finalize wrote `title: "..."`, Prettier
 * (singleQuote) rewrote it to `title: '...'`, and the next `finalize plan` reported the
 * capsule as a conflict. Root cause: `capsuleCanonical` compared the whole frontmatter
 * block verbatim. The fix compares the flat key/value frontmatter of a capsule by its
 * decoded scalars; everything it cannot prove equivalent stays a verbatim comparison.
 * Approval digest, preconditions and the create-only rule are not touched (see the
 * plan/apply tests at the end).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { scaffoldInstance } from '../init/scaffold.js';
import { applyFinalization, capsuleCanonical, planFinalization, renderCapsule } from './core.js';
import { parseProposal, type FinalizationProposal } from './proposal.js';
import type { ProjectConfig } from '../init/types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const CONFIG: ProjectConfig = {
  projectName: 'fin003',
  language: 'typescript',
  packageManager: 'pnpm',
  aiTool: 'claude',
  finalizationProtocol: 'finalize-story',
  protocols: ['finalize-story'],
  monolithRoot: '.monolith',
};
const EVIDENCE = (kind: string, id: string): string =>
  `---\ntype: working\nid: ${kind}\n---\n\n## Last Check\n\n**Status:** PASS\n**Date:** 2026-11-02\n**Story:** ${id} — test\n`;

async function instance(id = 'SEM-001'): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-fin003-'));
  dirs.push(dir);
  await scaffoldInstance(dir, CONFIG);
  writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify({ ...CONFIG }, null, 2));
  writeFileSync(join(dir, '.monolith/memory/working/integrity-result.md'), EVIDENCE('integrity-result', id));
  writeFileSync(join(dir, '.monolith/memory/working/governance-result.md'), EVIDENCE('governance-result', id));
  return dir;
}

const TITLE = 'Hybrid Retrieval and Automatic Semantic Indexing';
function proposal(id = 'SEM-001', title = TITLE): FinalizationProposal {
  const parsed = parseProposal({
    schemaVersion: 1,
    story: { id, title, phase: 'phase-1', phaseHeading: 'Phase 1 — Test', slug: `story-${id.toLowerCase()}`, date: '2026-11-02' },
    expectedCurrentStory: 'none',
    work: { objective: 'obj', implementationSummary: 'impl', filesChanged: ['a.ts'], tests: '10 pass', keyDecisions: 'kd', adrs: [], lessons: 'none' },
    summary: 'Built.',
    keyOutputs: ['src'],
    history: { phaseName: '1 — Test', decision: 'ok', build: 'PASS' },
  });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.proposal;
}
const capsulePath = (id: string): string => `.monolith/memory/working/phases/phase-1/stories/story-${id.toLowerCase()}.md`;

/** What Prettier (singleQuote: true) does to the capsule frontmatter title. */
const singleQuoted = (s: string): string => s.replace(/^title: "(.*)"$/m, (_m, t: string) => `title: '${t.replace(/\\"/g, '"').replace(/'/g, "''")}'`);

const fm = (body: string): string => `---\n${body}\n---\n\n# A\n`;
const eq = (a: string, b: string): void => expect(capsuleCanonical(a)).toBe(capsuleCanonical(b));
const ne = (a: string, b: string): void => expect(capsuleCanonical(a)).not.toBe(capsuleCanonical(b));

describe('FIN-003 frontmatter scalar equivalence (unit)', () => {
  it('double quotes and single quotes of the same string are equivalent', () => {
    eq(fm('title: "Example"'), fm("title: 'Example'"));
  });
  it('quote escapes decode to the same value', () => {
    eq(fm('title: "say \\"hi\\""'), fm(`title: 'say "hi"'`));
    eq(fm(`title: "it's"`), fm(`title: 'it''s'`));
    eq(fm('title: "a\\\\b"'), fm("title: 'a\\b'"));
  });
  it('a real value change is a difference', () => ne(fm('title: "Example"'), fm('title: "Different Example"')));
  it('a case or whitespace change inside a quoted value is a difference', () => {
    ne(fm('title: "Example"'), fm("title: 'example'"));
    ne(fm('title: "Example"'), fm("title: 'Example '"));
  });
  it('Story identity change is a difference', () => ne(fm('id: story-sem-001'), fm('id: story-sem-002')));
  it('missing and added fields are differences; unknown fields are compared, not dropped', () => {
    ne(fm('id: x\ntitle: "T"'), fm('id: x'));
    ne(fm('id: x'), fm('id: x\nextra: "y"'));
    ne(fm('id: x\nextra: "y"'), fm('id: x\nextra: "z"'));
    eq(fm('id: x\nextra: "y"'), fm("id: x\nextra: 'y'"));
  });
  it('field order is significant', () => ne(fm('a: "1"\nb: "2"'), fm('b: "2"\na: "1"')));
  it('duplicate keys are never semantically equivalent to anything but themselves verbatim', () => {
    ne(fm('title: "A"\ntitle: "B"'), fm("title: 'B'"));
    ne(fm('title: "B"\ntitle: "B"'), fm("title: 'B'"));
    ne(fm('title: "A"\ntitle: "B"'), fm("title: 'A'\ntitle: 'B'")); // not proven: kept verbatim
  });
  it('YAML types are never coerced: string vs number/boolean/null/sequence/mapping', () => {
    ne(fm('n: "1"'), fm('n: 1'));
    ne(fm("n: '1'"), fm('n: 1'));
    ne(fm('b: "true"'), fm('b: true'));
    ne(fm('v: "null"'), fm('v: null'));
    ne(fm('v: "[a]"'), fm('v: [a]'));
    ne(fm('v: "{a: b}"'), fm('v: {a: b}'));
  });
  it('plain scalars are compared as written (no quote-style claim is made for them)', () => {
    eq(fm('status: COMPLETED'), fm('status: COMPLETED'));
    ne(fm('status: COMPLETED'), fm('status: DRAFT'));
    ne(fm('status: COMPLETED'), fm('status: "COMPLETED"'));
  });
  it('malformed or unsupported frontmatter is compared verbatim (never equivalent by guess)', () => {
    ne(fm('title: "Example'), fm("title: 'Example"));
    ne(fm('title: "A" # c'), fm("title: 'A' # c"));
    ne(fm('title: "A"  '), fm("title: 'A'"));
    ne(fm('t: |\n  x'), fm('t: >\n  x'));
    ne(fm('title:\t"A"'), fm("title:\t'A'"));
  });
  it('unterminated frontmatter protects the whole file', () => ne('---\ntitle: "A"\nbody', "---\ntitle: 'A'\nbody"));
  it('the body is still compared: a changed body is a difference even with equal frontmatter', () => {
    ne(`${fm('title: "A"')}\ntext\n`, `${fm("title: 'A'")}\nother\n`);
  });
  it('the unchanged frontmatter + formatter-only body differences stay equivalent', () => {
    eq('---\ntitle: "A"\n---\n\n# H\ntext  \n', "---\ntitle: 'A'\n---\n\n# H\n\ntext\n");
  });
});

describe('FIN-003 finalize lifecycle (SEM-001 / SEM-002 style)', () => {
  it.each(['SEM-001', 'SEM-002'])('%s: finalize → Prettier quote rewrite → plan is ALREADY_FINALIZED, file untouched', async (id) => {
    const dir = await instance(id);
    const p = proposal(id);
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('FINALIZED');
    const original = readFileSync(join(dir, capsulePath(id)), 'utf8');
    const formatted = singleQuoted(original);
    expect(formatted).not.toBe(original);
    writeFileSync(join(dir, capsulePath(id)), formatted);
    const plan = planFinalization(dir, p);
    expect(plan.status).toBe('ALREADY_FINALIZED');
    expect(plan.targets.find((t) => t.id === 'capsule')!.state).toBe('done');
    expect((await applyFinalization(dir, p, 'whatever')).status).toBe('ALREADY_FINALIZED');
    expect(readFileSync(join(dir, capsulePath(id)), 'utf8')).toBe(formatted);
  });

  it('title with quotes and apostrophes survives the same rewrite', async () => {
    const dir = await instance('SEM-003');
    const p = proposal('SEM-003', `It's a "quoted" title`);
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('FINALIZED');
    writeFileSync(join(dir, capsulePath('SEM-003')), singleQuoted(readFileSync(join(dir, capsulePath('SEM-003')), 'utf8')));
    expect(planFinalization(dir, p).status).toBe('ALREADY_FINALIZED');
  });

  it('repeated finalize without changes is ALREADY_FINALIZED', async () => {
    const dir = await instance();
    const p = proposal();
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('FINALIZED');
    expect(planFinalization(dir, p).status).toBe('ALREADY_FINALIZED');
  });

  it.each([
    ['real title change', (s: string) => s.replace(TITLE, 'Something else')],
    ['Story id change', (s: string) => s.replace('id: story-sem-001', 'id: story-sem-009')],
    ['missing required field', (s: string) => s.replace('phase: phase-1\n', '')],
    ['unknown field added', (s: string) => s.replace('status: COMPLETED', 'status: COMPLETED\nowner: "x"')],
    ['type change (date as string)', (s: string) => s.replace('date: 2026-11-02', 'date: "2026-11-02"')],
    ['duplicate key', (s: string) => s.replace('status: COMPLETED', 'status: COMPLETED\nstatus: COMPLETED')],
    ['body mutation', (s: string) => s.replace('impl', 'IMPL')],
    ['malformed frontmatter', (s: string) => s.replace(`title: "${TITLE}"`, `title: "${TITLE}`)],
  ])('after Prettier-style rewrite, %s is still a CONFLICT and never overwritten', async (_n, mutate) => {
    const dir = await instance();
    const p = proposal();
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('FINALIZED');
    const changed = singleQuoted(mutate(readFileSync(join(dir, capsulePath('SEM-001')), 'utf8')));
    writeFileSync(join(dir, capsulePath('SEM-001')), changed);
    const plan = planFinalization(dir, p);
    expect(plan.status).toBe('NOT_READY');
    expect(plan.targets.find((t) => t.id === 'capsule')!.state).toBe('conflict');
    expect((await applyFinalization(dir, p, plan.digest)).status).toBe('REFUSED');
    expect(readFileSync(join(dir, capsulePath('SEM-001')), 'utf8')).toBe(changed);
  });

  it('approval digest is independent of the on-disk capsule representation and still binds apply', async () => {
    const dir = await instance();
    const p = proposal();
    const d1 = planFinalization(dir, p).digest;
    // a stale/other digest is still refused
    expect((await applyFinalization(dir, p, 'not-the-digest')).status).not.toBe('FINALIZED');
    expect((await applyFinalization(dir, p, d1)).status).toBe('FINALIZED');
  });

  it('mutation of approved content between plan and apply is still detected', async () => {
    const dir = await instance();
    const p = proposal();
    const plan = planFinalization(dir, p);
    // another writer changes the proposal's target (the capsule path) after approval
    mkdirSync(dirname(join(dir, capsulePath('SEM-001'))), { recursive: true });
    writeFileSync(join(dir, capsulePath('SEM-001')), 'someone else wrote this\n');
    const r = await applyFinalization(dir, p, plan.digest);
    expect(r.status).not.toBe('FINALIZED');
    expect(readFileSync(join(dir, capsulePath('SEM-001')), 'utf8')).toBe('someone else wrote this\n');
  });

  it('a rendered capsule always parses on the semantic path (renderer and comparator agree)', () => {
    const r = renderCapsule(proposal());
    expect(capsuleCanonical(r)).toBe(capsuleCanonical(singleQuoted(r)));
  });
});
