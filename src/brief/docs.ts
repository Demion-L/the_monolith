/**
 * Generic, deterministic markdown-frontmatter discovery used for both
 * Mandatory Protocols (section 7) and ADR Discovery (section 8). Reuses
 * Scriptorium's existing frontmatter parser (per the brief contract) — does
 * NOT use `compileMarkdownArtifact()` or the ERG graph builder, both of
 * which are explicitly out of scope here.
 *
 * Resilience (review findings F-2/F-3): a single unreadable directory,
 * unreadable file, dangling symlink, symlink cycle, or a configured
 * directory that escapes the project root must never crash the whole brief
 * or silently disappear. Each failure is caught, reported as a diagnostic
 * (forcing Completeness: INCOMPLETE), and discovery continues with
 * whatever else is readable.
 *
 * Symlinks (file or directory entries) are never followed while walking —
 * this is what makes a symlink cycle (ELOOP) impossible by construction,
 * and is also the first line of defense against using a nested symlink to
 * tunnel outside a configured directory. The *top-level* directories named
 * in `dirs` (i.e. `contextGateway.adrDirs` and the standard protocols/ADR
 * dirs) get an explicit containment check in addition: both a string-level
 * check (rejects `..` segments in the configured path itself) and a
 * real-path check after resolving symlinks (rejects a configured directory
 * that is itself a symlink escaping the project root). Neither check alone
 * is treated as sufficient — path.join()/path.relative() string comparison
 * alone does not account for symlinks on disk.
 *
 * `monolithRoot` itself, and the fixed files below it (state.json,
 * active.md), are vetted separately by the shared resolver in src/root
 * (SEC-001A); this check covers document directories only.
 */

import { readdirSync, readFileSync, existsSync, realpathSync, type Dirent } from 'fs';
import { join, relative, isAbsolute, resolve } from 'path';
import { parseFrontmatter } from '../scriptorium/frontmatter.js';
import { compareStrings } from './selectors.js';
import type { BriefDiagnostic, DocRef } from './types.js';

const H1_RE = /^#\s+(.+?)\s*$/;

export interface ParsedDoc {
  /** Relative to targetDir. */
  relPath: string;
  id: string | undefined;
  /** frontmatter `title:`, or (only when no frontmatter title exists) the first H1 — resolved once, at parse time. */
  resolvedTitle: string | undefined;
  /** All frontmatter fields (first value per key), for filter predicates. */
  fields: Map<string, string>;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** True if `candidateAbs` is `baseAbs` itself or strictly inside it. */
function isContained(baseAbs: string, candidateAbs: string): boolean {
  const rel = relative(baseAbs, candidateAbs);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Resolves `relDir` (relative to targetDir) to an absolute path, rejecting
 * it — with a diagnostic, never silently — if it is not contained within
 * targetDir. See the module doc comment for why both a string-level and a
 * real-path (symlink-resolved) check are performed.
 */
function resolveContainedDir(targetDir: string, relDir: string, diagnostics: BriefDiagnostic[]): string | null {
  const targetAbs = resolve(targetDir);
  const requestedAbs = resolve(join(targetDir, relDir));

  if (!isContained(targetAbs, requestedAbs)) {
    diagnostics.push({
      code: 'DOC_DIR_OUTSIDE_PROJECT',
      severity: 'error',
      message: `Configured directory "${relDir}" resolves outside the project root and was skipped.`,
    });
    return null;
  }

  if (!existsSync(requestedAbs)) {
    // Not an error: an ADR/protocol directory that hasn't been created yet is routine.
    return requestedAbs;
  }

  let realRequested: string;
  try {
    realRequested = realpathSync(requestedAbs);
  } catch (err) {
    diagnostics.push({
      code: 'DOC_DIR_UNREADABLE',
      severity: 'error',
      message: `"${relDir}" could not be resolved: ${errMsg(err)}`,
    });
    return null;
  }

  let realTarget: string;
  try {
    realTarget = realpathSync(targetAbs);
  } catch {
    realTarget = targetAbs;
  }

  if (!isContained(realTarget, realRequested)) {
    diagnostics.push({
      code: 'DOC_DIR_OUTSIDE_PROJECT',
      severity: 'error',
      message: `Configured directory "${relDir}" escapes the project root via a symlink and was skipped.`,
    });
    return null;
  }

  return requestedAbs;
}

/**
 * All `.md` files under `dir`, sorted deterministically (not FS traversal
 * order). Never follows symlinks — a symlinked file or directory entry is
 * skipped outright, which also makes a symlink cycle harmless (it is never
 * entered to begin with). Directory read failures (EACCES, ELOOP from a
 * symlink that isn't itself recognized as one by readdir's dirent type,
 * etc.) are reported and that subtree is skipped; sibling subtrees are
 * still walked.
 */
function walkMarkdownFilesSorted(dir: string, targetDir: string, diagnostics: BriefDiagnostic[]): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  function walk(d: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch (err) {
      diagnostics.push({
        code: 'DOC_DIR_UNREADABLE',
        severity: 'error',
        message: `"${relative(targetDir, d)}" could not be read: ${errMsg(err)}`,
      });
      return;
    }

    const sorted = entries.slice().sort((a, b) => compareStrings(a.name, b.name));
    for (const entry of sorted) {
      if (entry.isSymbolicLink()) continue; // never follow symlinks — files or directories
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results.sort(compareStrings);
}

function firstH1(bodyLines: string[]): string | undefined {
  for (const line of bodyLines) {
    const match = H1_RE.exec(line.trim());
    if (match) return match[1];
  }
  return undefined;
}

function parseDoc(absPath: string, targetDir: string, diagnostics: BriefDiagnostic[]): ParsedDoc | null {
  let content: string;
  try {
    content = readFileSync(absPath, 'utf8');
  } catch (err) {
    diagnostics.push({
      code: 'DOC_FILE_UNREADABLE',
      severity: 'error',
      message: `"${relative(targetDir, absPath)}" could not be read: ${errMsg(err)}`,
    });
    return null;
  }

  const lines = content.split('\n');
  const fm = parseFrontmatter(lines);
  if (!fm) return null;

  const fields = new Map<string, string>();
  let frontmatterTitle: string | undefined;
  let id: string | undefined;
  for (const field of fm.fields) {
    if (field.values[0] !== undefined) fields.set(field.key, field.values[0]);
    if (field.key === 'title' && field.values[0]) frontmatterTitle = field.values[0];
    if (field.key === 'id' && field.values[0]) id = field.values[0];
  }

  const resolvedTitle = frontmatterTitle ?? firstH1(lines.slice(fm.bodyStartLine));

  return {
    relPath: relative(targetDir, absPath).split('\\').join('/'),
    id,
    resolvedTitle,
    fields,
  };
}

function resolveTitle(doc: ParsedDoc): string {
  return doc.resolvedTitle ?? doc.id ?? doc.relPath;
}

/**
 * Discover documents under `dirs` (relative to targetDir, deduplicated,
 * each walked recursively) whose frontmatter matches `predicate`. Only
 * documents with a usable frontmatter `id:` are included — a markdown file
 * without one isn't a candidate ADR/protocol record, it's silently excluded
 * from this listing (not an error). `diagnostics` collects every resilience
 * finding described in the module doc comment; callers that don't care can
 * omit it.
 */
export function discoverDocs(
  targetDir: string,
  dirs: string[],
  predicate: (fields: Map<string, string>) => boolean,
  diagnostics: BriefDiagnostic[] = [],
): DocRef[] {
  const seenAbsDirs = new Set<string>();
  const refs: DocRef[] = [];

  for (const relDir of dirs) {
    const absDir = resolveContainedDir(targetDir, relDir, diagnostics);
    if (!absDir) continue;
    if (seenAbsDirs.has(absDir)) continue;
    seenAbsDirs.add(absDir);

    for (const absPath of walkMarkdownFilesSorted(absDir, targetDir, diagnostics)) {
      const doc = parseDoc(absPath, targetDir, diagnostics);
      if (!doc || !doc.id) continue;
      if (!predicate(doc.fields)) continue;
      refs.push({ id: doc.id, title: resolveTitle(doc), path: doc.relPath });
    }
  }

  return refs.sort((a, b) => compareStrings(a.id, b.id) || compareStrings(a.path, b.path));
}
