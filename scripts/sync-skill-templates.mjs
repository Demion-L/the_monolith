#!/usr/bin/env node
// Single canonical skill source (ARCH-002A).
//
// `.monolith/skills/<name>/SKILL.md` is the ONLY editable source of a distributed skill. The
// copy under `templates/default-instance/monolith/skills/<name>/SKILL.md` is a GENERATED
// artifact: the npm package ships `templates/` but forbids `.monolith/`, so the text has to be
// copied there at build time. Do not edit the generated copy.
//
// Transform (deterministic): the literal `.monolith/` root becomes `{{MONOLITH_ROOT}}/`, which
// `init`/`update` substitute back. With the default root the installed file is byte-identical
// to the canonical one.
//
//   node scripts/sync-skill-templates.mjs           write generated copies
//   node scripts/sync-skill-templates.mjs --check   exit 1 if a generated copy drifts (no writes)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SYNCED_SKILLS = ['finalize-story'];

export function generate(canonical) {
  return canonical.replace(/\.monolith\//g, '{{MONOLITH_ROOT}}/');
}

export function paths(root, name) {
  return {
    source: join(root, '.monolith/skills', name, 'SKILL.md'),
    target: join(root, 'templates/default-instance/monolith/skills', name, 'SKILL.md'),
  };
}

/** Returns [{ name, ok }]; writes only when `write` is true. */
export function sync(root, { write }) {
  return SYNCED_SKILLS.map((name) => {
    const { source, target } = paths(root, name);
    const want = generate(readFileSync(source, 'utf8'));
    const have = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (have === want) return { name, ok: true };
    if (write) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, want);
      return { name, ok: true, written: true };
    }
    return { name, ok: false };
  });
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const check = process.argv.includes('--check');
  const res = sync(root, { write: !check });
  const bad = res.filter((r) => !r.ok);
  if (bad.length) {
    console.error(`Skill template drift: ${bad.map((r) => r.name).join(', ')} differs from its canonical .monolith/skills source. Run \`npm run sync:skills\`; never edit the generated copy.`);
    process.exit(1);
  }
  for (const r of res) console.log(`${r.written ? 'wrote' : 'ok   '} ${r.name}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
