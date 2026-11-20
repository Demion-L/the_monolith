/**
 * Structural check of story capsules (GOV-EVOLUTION Phase 5).
 *
 * A capsule is created by `monolith finalize apply` from `renderCapsule` (src/finalize/core.ts):
 * frontmatter `type, id, phase, title, date, status`, an H1, then seven H2 sections. This module
 * checks an existing capsule against exactly that shape — nothing more. It is NOT a Markdown
 * validation framework and does not judge the quality of the content.
 *
 * Read-only. Files are read through the unified safe reader (ADR-014); directories are listed
 * without following symlinks. Bounded: at most MAX_CAPSULES files, each at most MAX_CAPSULE_BYTES.
 */

import { lstatSync, readdirSync } from 'fs';
import { join } from 'path';
import { maskNonContent } from '../brief/markdown-context.js';
import { readProjectFile } from '../root/index.js';
import { parseFrontmatter } from '../scriptorium/frontmatter.js';
import type { GovernanceFinding } from './types.js';

export const CAPSULE_DIR_REL = 'memory/working/phases';
export const MAX_CAPSULES = 500;
export const MAX_CAPSULE_BYTES = 256 * 1024;

/** The sections `renderCapsule` writes, in order. */
export const CAPSULE_SECTIONS = [
  'Objective',
  'Implementation Summary',
  'Files Changed',
  'Tests',
  'Key Decisions',
  'ADRs Written',
  'Lessons Learned',
] as const;
const REQUIRED_FIELDS = ['type', 'id', 'phase', 'title', 'date', 'status'] as const;
const FIELD_LABEL_RE = /^\*\*(Status|Date|Phase|Id|Title):\*\*/i;
const PLACEHOLDER_RE = /\b(?:TODO|TBD|FIXME)\b|\(Add [^)]*\)|\{\{[^}]*\}\}|<story title>|<what [^>]*>|<list of [^>]*>|<test counts[^>]*>|<architectural choices[^>]*>|<links to [^>]*>|<what worked[^>]*>/;

export interface CapsuleScan {
  /** Number of capsule files examined. */
  examined: number;
  /** True when the directory does not exist (no story was ever finalized with a capsule). */
  absent: boolean;
  /** True when more than MAX_CAPSULES files exist and the rest were not examined. */
  truncated: boolean;
  findings: GovernanceFinding[];
}

function f(severity: GovernanceFinding['severity'], code: string, message: string, path: string | null): GovernanceFinding {
  return { area: 'capsules', severity, code, message, path };
}

/** Lists `<monolithRoot>/memory/working/phases/<phase>/stories/*.md` without following symlinks. */
function listCapsules(projectRoot: string, monolithRoot: string): { ok: true; files: string[]; truncated: boolean } | { ok: false; absent: boolean } {
  const base = `${monolithRoot}/${CAPSULE_DIR_REL}`;
  const files: string[] = [];
  let truncated = false;
  try {
    let cur = projectRoot;
    for (const seg of base.split('/')) {
      cur = join(cur, seg);
      const st = lstatSync(cur);
      if (st.isSymbolicLink() || !st.isDirectory()) return { ok: false, absent: false };
    }
    const phases = readdirSync(cur, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    for (const ph of phases) {
      const dir = join(cur, ph, 'stories');
      let st;
      try {
        st = lstatSync(dir);
      } catch {
        continue;
      }
      if (st.isSymbolicLink() || !st.isDirectory()) continue;
      for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        if (!e.name.endsWith('.md') || e.isDirectory()) continue;
        if (files.length >= MAX_CAPSULES) {
          truncated = true;
          break;
        }
        files.push(`${base}/${ph}/stories/${e.name}`);
      }
    }
    return { ok: true, files, truncated };
  } catch (err) {
    return { ok: false, absent: (err as NodeJS.ErrnoException).code === 'ENOENT' };
  }
}

export function checkCapsuleText(text: string, path: string): GovernanceFinding[] {
  const out: GovernanceFinding[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const fm = parseFrontmatter(lines);
  if (fm === null) {
    out.push(f('ERROR', 'CAPSULE_FRONTMATTER_MISSING', 'The capsule has no YAML frontmatter (expected type, id, phase, title, date, status between --- lines at the top).', path));
  } else {
    const keys = new Map<string, string>();
    for (const fld of fm.fields) if (!keys.has(fld.key)) keys.set(fld.key, fld.values[0] ?? '');
    for (const k of REQUIRED_FIELDS) {
      if (!keys.has(k)) out.push(f('ERROR', 'CAPSULE_FIELD_MISSING', `Frontmatter field "${k}" is missing.`, path));
    }
    if (keys.has('type') && keys.get('type') !== 'story-capsule') {
      out.push(f('ERROR', 'CAPSULE_TYPE_INVALID', 'Frontmatter "type" must be story-capsule.', path));
    }
    const status = keys.get('status');
    if (status !== undefined && status !== 'COMPLETED') {
      out.push(f('WARNING', 'CAPSULE_STATUS_UNEXPECTED', `Capsule status is "${status.slice(0, 40)}"; finalized capsules carry COMPLETED.`, path));
    }
  }

  const bodyStart = fm === null ? 0 : fm.bodyStartLine;
  const masked = maskNonContent(lines.join('\n')).split('\n');
  const body = masked.slice(bodyStart);

  if (!body.some((l) => /^#[ \t]+\S/.test(l))) out.push(f('ERROR', 'CAPSULE_TITLE_MISSING', 'The capsule has no level-1 heading.', path));

  // Fields that belong in the frontmatter, written as body lines instead.
  if (body.some((l) => FIELD_LABEL_RE.test(l.trim()))) {
    out.push(f('WARNING', 'CAPSULE_FIELD_OUTSIDE_FRONTMATTER', 'Status/Date/Phase/Id/Title are written as body lines; they belong in the frontmatter.', path));
  }

  // Sections: required, not repeated, not empty.
  const sections: { name: string; start: number }[] = [];
  body.forEach((l, i) => {
    const m = /^##[ \t]+(.*?)[ \t]*$/.exec(l);
    if (m) sections.push({ name: m[1], start: i + 1 });
  });
  for (const name of CAPSULE_SECTIONS) {
    const hits = sections.filter((s) => s.name === name);
    if (hits.length === 0) {
      out.push(f('ERROR', 'CAPSULE_SECTION_MISSING', `Required section "## ${name}" is missing.`, path));
      continue;
    }
    if (hits.length > 1) out.push(f('WARNING', 'CAPSULE_SECTION_DUPLICATED', `Section "## ${name}" appears ${hits.length} times.`, path));
    const idx = sections.indexOf(hits[0]);
    const end = idx + 1 < sections.length ? sections[idx + 1].start - 1 : body.length;
    if (body.slice(hits[0].start, end).every((l) => l.trim() === '')) {
      out.push(f('WARNING', 'CAPSULE_SECTION_EMPTY', `Section "## ${name}" is empty.`, path));
    }
  }

  // Leftover template text and literal escape sequences, outside code and comments.
  const prose = body.map((l) => l.replace(/`[^`]*`/g, ''));
  if (prose.some((l) => PLACEHOLDER_RE.test(l))) {
    out.push(f('WARNING', 'CAPSULE_PLACEHOLDER', 'Placeholder text (TODO/TBD/FIXME, "(Add ...)", unreplaced <...> or {{...}} markers) remains.', path));
  }
  if (prose.some((l) => /\\n/.test(l))) {
    out.push(f('WARNING', 'CAPSULE_LITERAL_ESCAPE', 'A literal "\\n" sequence appears in the text; it was probably meant to be a line break.', path));
  }
  return out;
}

export function scanCapsules(projectRoot: string, monolithRoot: string): CapsuleScan {
  const listing = listCapsules(projectRoot, monolithRoot);
  if (!listing.ok) {
    return listing.absent
      ? { examined: 0, absent: true, truncated: false, findings: [] }
      : { examined: 0, absent: false, truncated: false, findings: [f('ERROR', 'CAPSULE_DIR_UNSAFE', 'The capsule directory is not a plain directory (symlink or not a directory) and was not read.', `${monolithRoot}/${CAPSULE_DIR_REL}`)] };
  }
  const findings: GovernanceFinding[] = [];
  for (const path of listing.files) {
    let read;
    try {
      read = readProjectFile(projectRoot, path, { maxBytes: MAX_CAPSULE_BYTES, allowEmpty: true, strictUtf8: true });
    } catch {
      findings.push(f('ERROR', 'CAPSULE_UNREADABLE', 'The capsule could not be read.', path));
      continue;
    }
    if (!read.ok) {
      findings.push(f('ERROR', 'CAPSULE_UNREADABLE', `The capsule could not be read (${read.code}).`, path));
      continue;
    }
    findings.push(...checkCapsuleText(read.content, path));
  }
  if (listing.truncated) findings.push(f('WARNING', 'CAPSULES_TRUNCATED', `More than ${MAX_CAPSULES} capsules exist; the rest were not examined.`, `${monolithRoot}/${CAPSULE_DIR_REL}`));
  return { examined: listing.files.length, absent: false, truncated: listing.truncated, findings };
}
