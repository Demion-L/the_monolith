import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

// Real, independent OS processes adding ideas to the SAME instance at the same
// time. The sources are transpiled once into plain .mjs files (as the
// Coordinatorium concurrency tests do) so the children need no loader.
const here = dirname(fileURLToPath(import.meta.url));
let work: string;
let modules: string;

function transpile(src: string, dest: string, rewrite: (code: string) => string): void {
  const out = ts.transpileModule(readFileSync(src, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: src,
  }).outputText;
  writeFileSync(dest, rewrite(out), 'utf8');
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'monolith-idea-conc-'));
  modules = join(work, 'modules');
  mkdirSync(modules);
  const mjs = (code: string) => code.replace(/(from\s+')(\.\/[\w-]+)\.js(')/g, '$1$2.mjs$3').replace(/'\.\.\/root\/index\.js'/g, "'./root.mjs'");
  for (const m of ['types', 'format', 'store']) transpile(join(here, `${m}.ts`), join(modules, `${m}.mjs`), mjs);
  transpile(join(here, '..', 'root', 'index.ts'), join(modules, 'root.mjs'), mjs);
  transpile(join(here, '..', 'root', 'safe-write.ts'), join(modules, 'safe-write.mjs'), mjs);
  transpile(join(here, '..', 'root', 'write-artifacts.ts'), join(modules, 'write-artifacts.mjs'), mjs);
  writeFileSync(
    join(modules, 'child.mjs'),
    `import { ideaStore, addIdea } from './store.mjs';
const [dir, tag, count] = process.argv.slice(2);
const store = ideaStore(dir);
const ids = [];
for (let i = 0; i < Number(count); i++) ids.push(addIdea(store, { title: tag + '-' + i, description: 'from ' + tag }).idea.id);
console.log(JSON.stringify(ids));
`,
    'utf8',
  );
});

afterAll(() => rmSync(work, { recursive: true, force: true }));

function runChild(project: string, tag: string, count: number): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(modules, 'child.mjs'), project, tag, String(count)]);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

describe('concurrent idea capture across processes', () => {
  it('hands out every id exactly once and loses no idea', async () => {
    const project = join(work, 'project');
    mkdirSync(join(project, '.monolith'), { recursive: true });
    const PROCS = 8;
    const EACH = 6;
    const results = await Promise.all(Array.from({ length: PROCS }, (_, i) => runChild(project, `p${i}`, EACH)));
    for (const r of results) expect(r, r.err).toMatchObject({ code: 0 });

    const reported = results.flatMap((r) => JSON.parse(r.out.trim()) as string[]);
    expect(new Set(reported).size).toBe(PROCS * EACH);

    const dir = join(project, '.monolith', 'memory', 'long-term', 'ideas');
    const files = readdirSync(dir).filter((f) => f !== '.ids').sort();
    expect(files).toEqual(Array.from({ length: PROCS * EACH }, (_, i) => `IDEA-${String(i + 1).padStart(3, '0')}.md`));
    expect(files.some((f) => f.includes('.tmp.'))).toBe(false);
    // One reservation marker per id, no residue next to them.
    expect(readdirSync(join(dir, '.ids')).sort()).toEqual(files.map((f) => f.replace(/\.md$/, '')));

    // Each reported id's file holds exactly that process's text.
    const titles = new Set(files.map((f) => /title: "(.*)"/.exec(readFileSync(join(dir, f), 'utf8'))![1]));
    expect(titles.size).toBe(PROCS * EACH);
  }, 60_000);
});
