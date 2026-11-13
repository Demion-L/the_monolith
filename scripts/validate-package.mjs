#!/usr/bin/env node
// Package Validation (CI-001).
//
// Inspects the REAL npm tarball manifest (`npm pack --dry-run --json`; nothing
// is written to disk, nothing is published) and enforces the release policy.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only these top-level entries may ship.
const ALLOWED_TOP = [/^dist\//, /^templates\//, /^package\.json$/, /^README(\.md)?$/i, /^LICENSE(\.md)?$/i];

const REQUIRED = [
  'package.json',
  'dist/index.js',
  'dist/index.d.ts',
  'dist/cli/index.js',
  'dist/readmodel/roadmap.js',
  'dist/readmodel/roadmap.d.ts',
  'dist/readmodel/dashboard.js',
  'dist/readmodel/types.d.ts',
  'dist/ui/index.html',
];

const FORBIDDEN = [
  [/^dist\/scripts\//, 'dev scripts must not ship'],
  [/(^|\/)[^/]*\.(test|spec)\.[cm]?[jt]sx?(\.map)?$/, 'test file'],
  [/\.d\.ts\.map$/, null], // allowed: declaration maps are part of the current policy
  [/(^|\/)\.env(\.|$)/, 'environment file'],
  [/\.(log|tmp|bak|orig|swp|tgz|pem|key|p12|pfx)$/i, 'temporary / secret-like file'],
  [/tsbuildinfo$/, 'tsc incremental cache'],
  [/(^|\/)(node_modules|\.git|\.github|\.monolith|evidence|coverage)(\/|$)/, 'repo-local directory'],
];

const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bnpm_[A-Za-z0-9]{36}\b/, 'npm token'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
];

/** Collect `./assets/...` style references from the UI entry HTML. */
export function htmlAssetRefs(html) {
  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) refs.add(m[1]);
  return refs;
}

/**
 * Pure policy check. `files` = paths from the pack manifest; `readFile(path)`
 * returns file contents (string) or null. Returns an array of problem strings.
 */
export function validatePack({ files, pkg, readFile }) {
  const problems = [];
  const set = new Set(files);

  for (const p of files) {
    if (!ALLOWED_TOP.some((re) => re.test(p))) problems.push(`unexpected file outside release policy: ${p}`);
    for (const [re, why] of FORBIDDEN) {
      if (why && re.test(p)) problems.push(`forbidden file (${why}): ${p}`);
    }
  }

  for (const r of REQUIRED) if (!set.has(r)) problems.push(`required file missing from package: ${r}`);

  // Entry points declared in package.json must be packed.
  const targets = new Set();
  if (pkg.main) targets.add(pkg.main);
  if (pkg.types) targets.add(pkg.types);
  for (const v of Object.values(pkg.bin ?? {})) targets.add(v);
  for (const e of Object.values(pkg.exports ?? {})) {
    for (const v of typeof e === 'string' ? [e] : Object.values(e)) if (typeof v === 'string') targets.add(v);
  }
  for (const t of targets) {
    const n = t.replace(/^\.\//, '');
    if (!set.has(n)) problems.push(`package.json entry point not in package: ${n}`);
  }

  // UI: index.html must reference only packed assets; no stale bundles may ship.
  const html = readFile('dist/ui/index.html');
  if (html != null) {
    const refs = htmlAssetRefs(html);
    for (const ref of refs) {
      if (!set.has(`dist/ui/${ref}`)) problems.push(`dist/ui/index.html references a file not in package: ${ref}`);
    }
    for (const f of files) {
      if (/^dist\/ui\/assets\/index-[^/]+\.(js|css)$/.test(f) && !refs.has(f.slice('dist/ui/'.length))) {
        problems.push(`stale UI bundle not referenced by index.html: ${f}`);
      }
    }
  }

  // Lightweight secret scan over every packed text file.
  for (const f of files) {
    if (/\.(webp|png|ico|jpg|jpeg|gif|woff2?)$/i.test(f)) continue;
    const text = readFile(f);
    if (text == null) {
      problems.push(`listed in package but missing on disk: ${f}`);
      continue;
    }
    for (const [re, name] of SECRET_PATTERNS) if (re.test(text)) problems.push(`possible ${name} in ${f}`);
  }
  return problems;
}

function main() {
  const root = process.argv[2] ?? process.cwd();
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const [info] = JSON.parse(raw);
  const files = info.files.map((f) => f.path);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const readFile = (p) => {
    const abs = join(root, p);
    return existsSync(abs) ? readFileSync(abs, 'latin1') : null;
  };
  const problems = validatePack({ files, pkg, readFile });
  if (problems.length > 0) {
    console.error(`Package Validation: FAIL — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`Package Validation: PASS — ${info.name}@${info.version}, ${files.length} files, ${info.unpackedSize} bytes unpacked.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
