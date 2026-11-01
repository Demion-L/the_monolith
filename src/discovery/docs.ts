/**
 * Deterministic Markdown documentation analyzer (DISCOVERY-001B-2D, ADR-021). Internal.
 *
 * Principle: a document is a source of CLAIMS, never proof that the implementation matches them.
 * This module records what a document's text STRUCTURALLY contains (it exists, it has an ATX
 * heading of level N with this raw text on line L, it has an inline link with this raw target) and
 * nothing about what the project is. It never extracts a technology, a component, a dependency, a
 * decision or a runtime statement from prose, and it never checks anything against the code.
 * Every result carries `assertion: 'DOCUMENT_CONTENT_NOT_VERIFIED'`; observations of the kinds
 * HEADING, LINK and SECTION have `evidence: 'DOCUMENT_TEXT'` (what the author wrote), only
 * DOCUMENT_PRESENT has `evidence: 'OBSERVED_FILE'` (the traversal saw the file).
 *
 * Contract: `DiscoveryResult` (schema 1) is closed and has no place for line positions, so it is NOT
 * changed. This module returns its own `DocumentationResult` and reuses the diagnostic shape, the
 * fact-id function, the path and name predicates, the UTF-16 order and the traversal result.
 *
 * Scope: `README.md` at the project root and `*.md` below `docs/`, and only those that the given
 * `TraversalResult` lists as regular files. Nothing is searched for: a document the traversal did
 * not list does not exist for this module.
 *
 * Reading: each document is read through `readProjectFile` (ADR-011/014: every component below the
 * root is `lstat`-checked and none may be a symlink; `O_NOFOLLOW|O_NONBLOCK`; regular single-link
 * file; bounded read), with a per-document and a total byte cap. That the traversal listed a path
 * proves nothing about the next read, so every read is made on its own terms. NOT defended
 * (ADR-013, SEC-001B.3 open; TM-C unsupported): a process that swaps a directory or file between the
 * check and the open. Do not run it on a tree an untrusted process is modifying.
 * The content is only ever split into lines and matched; it is never evaluated, run, fetched, or
 * resolved: no subprocess, no network, no file access through a link target, no model.
 *
 * Supported Markdown subset (everything else is skipped, never guessed):
 *  - ATX headings (`#`..`######`, up to 3 spaces of indentation, optional closing `#` sequence);
 *  - inline links `[text](target)` and `[text](target "title")` on ONE line, text without nested
 *    brackets, target without whitespace (or `<...>`);
 *  - fenced code blocks (``` and ~~~) are skipped whole; so are YAML front matter, HTML comment
 *    lines, indented (4+) lines and over-long lines; inline code spans hide what they contain.
 *  NOT supported (no observation is made for them): setext headings, reference-style links,
 *  autolinks and bare URLs, images, raw HTML, headings/links split over lines, headings inside
 *  block quotes or list items, entity and escape decoding. Heading and link text is the RAW source
 *  text (inline markup is not rendered); a link target is never resolved, normalised or fetched.
 *
 * Invalid UTF-8: the reader decodes leniently (U+FFFD for invalid bytes); the two cannot be told
 * apart, so a document containing U+FFFD or NUL is not analysed at all.
 */

import { isAbsolute } from 'path';
import { readProjectFile, type ProjectFileErrorCode, type ProjectFileRead } from '../root/index.js';
import type { TraversalEntry, TraversalResult } from './traverse.js';
import {
  DiscoveryError,
  compareUtf16,
  computeFactId,
  isKeepableName,
  isSafeRelativePath,
  type DiscoveryDiagnostic,
} from './contracts.js';

export const DOCUMENTATION_SCHEMA_VERSION = 1;

export type DocumentationObservationKind = 'DOCUMENT_PRESENT' | 'HEADING' | 'SECTION' | 'LINK';

/** How an observation was obtained; a function of the kind, never chosen per observation. */
export const DOCUMENTATION_EVIDENCE_BY_KIND = {
  /** The traversal listed a regular file with a supported name. Says nothing about its content being right. */
  DOCUMENT_PRESENT: 'OBSERVED_FILE',
  /** The author wrote an ATX heading here. Says nothing about the project. */
  HEADING: 'DOCUMENT_TEXT',
  /** Lines between a heading and the next heading of the same or a higher level. A text range, not a component. */
  SECTION: 'DOCUMENT_TEXT',
  /** The author wrote an inline link here. Never resolved, never followed, never checked. */
  LINK: 'DOCUMENT_TEXT',
} as const satisfies Record<DocumentationObservationKind, 'OBSERVED_FILE' | 'DOCUMENT_TEXT'>;

export type DocumentationEvidence = (typeof DOCUMENTATION_EVIDENCE_BY_KIND)[DocumentationObservationKind];

export type DocumentationSourceKind = 'markdown-file' | 'markdown-atx-heading' | 'markdown-section' | 'markdown-inline-link';

const SOURCE_BY_KIND: Record<DocumentationObservationKind, DocumentationSourceKind> = {
  DOCUMENT_PRESENT: 'markdown-file',
  HEADING: 'markdown-atx-heading',
  SECTION: 'markdown-section',
  LINK: 'markdown-inline-link',
};

export interface DocumentationSource {
  /** Project-relative, `/`-separated; never absolute, never contains `..`. */
  path: string;
  observation: DocumentationSourceKind;
  /** 1-based, inclusive. Absent for a whole-file source. */
  startLine?: number;
  endLine?: number;
}

/** `FULL`: the raw text as written. `TRUNCATED`: cut to the limit. `WITHHELD`: contains unsafe characters; `text` is empty. */
export type TextStatus = 'FULL' | 'TRUNCATED' | 'WITHHELD';

/**
 * `relative`: no scheme, not `/`-rooted, not `#`. `anchor`: starts with `#`. `external`: `http(s)://` or `//`.
 * `other`: any other scheme (`mailto:`, `javascript:`, `C:`...) or a `/`-rooted path. Nothing is resolved.
 */
export type LinkType = 'relative' | 'anchor' | 'external' | 'other';

interface ObservationBase {
  /** 16 hex of sha256 over (kind, path, position, content); see `observationId`. */
  id: string;
  evidence: DocumentationEvidence;
  source: DocumentationSource;
  /** 0 for a document; otherwise the 1-based order of appearance within the document. */
  ordinal: number;
}

export interface DocumentPresentObservation extends ObservationBase {
  kind: 'DOCUMENT_PRESENT';
  format: 'markdown';
  /** `NOT_ANALYZED`: the file is there but its content was not (or could not be) analysed; see the diagnostics. */
  analysis: 'ANALYZED' | 'NOT_ANALYZED';
  bytes?: number;
  lines?: number;
}

export interface HeadingObservation extends ObservationBase {
  kind: 'HEADING';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** Raw source text of the heading content, whitespace-trimmed, tabs as spaces. */
  text: string;
  textStatus: TextStatus;
}

export interface SectionObservation extends ObservationBase {
  kind: 'SECTION';
  /** Ordinal of the HEADING that opens the section. */
  headingOrdinal: number;
  /** Ordinal of the nearest earlier heading of a lower level, if any. */
  parentHeadingOrdinal?: number;
  /**
   * Groups of consecutive non-blank lines (outside fenced code, comments and front matter) between the
   * heading and the next heading of ANY level. A mechanical count of text blocks: lists, tables and
   * quotes are groups too; it says nothing about content.
   */
  ownTextLineGroups: number;
}

export interface LinkObservation extends ObservationBase {
  kind: 'LINK';
  text: string;
  textStatus: TextStatus;
  /** Raw target as written (no entity or escape decoding, no resolution). */
  target: string;
  linkType: LinkType;
}

export type DocumentationObservation = DocumentPresentObservation | HeadingObservation | SectionObservation | LinkObservation;

export interface DocumentationLimits {
  /** Documents analysed; README.md first, then `docs/` by depth and path. */
  maxDocuments: number;
  /** Size cap of one document, bytes (same figure as `maxManifestBytes`). */
  maxDocumentBytes: number;
  /** Bytes read over all documents. */
  maxTotalBytes: number;
  maxHeadingsPerDocument: number;
  maxLinksPerDocument: number;
  /** Longest heading or link text that is kept whole (UTF-16 units); longer is `TRUNCATED`. */
  maxTextLength: number;
  /**
   * Longest link target that is kept. A longer one is not recorded (a cut URL would be a false
   * observation) and is counted as `DOC_LINK_REJECTED`; it also bounds the work of one link scan.
   */
  maxTargetLength: number;
  /** Lines longer than this are not analysed: bounds the work of the inline scan. */
  maxLineLength: number;
  /** Cap on the whole `observations` array. */
  maxObservations: number;
  maxDiagnostics: number;
}

export const DEFAULT_DOCUMENTATION_LIMITS: Readonly<DocumentationLimits> = Object.freeze({
  maxDocuments: 50,
  maxDocumentBytes: 256 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
  maxHeadingsPerDocument: 500,
  maxLinksPerDocument: 1000,
  maxTextLength: 200,
  maxTargetLength: 2048,
  maxLineLength: 8192,
  maxObservations: 5000,
  maxDiagnostics: 200,
});

const LIMIT_KEYS = Object.keys(DEFAULT_DOCUMENTATION_LIMITS) as (keyof DocumentationLimits)[];

/** Closed list. `true`: something inside the declared scope was not extracted, so the result is `PARTIAL`. */
export const DOCUMENTATION_DIAGNOSTIC_AFFECTS_COMPLETENESS = {
  DOC_INPUT_PATH_REJECTED: true,
  DOC_LIMIT_DOCUMENTS: true,
  DOC_LIMIT_TOTAL_BYTES: true,
  DOC_LIMIT_HEADINGS: true,
  DOC_LIMIT_LINKS: true,
  DOC_LIMIT_OBSERVATIONS: true,
  DOC_LIMIT_DIAGNOSTICS: true,
  DOC_READ_FAILED: true,
  DOC_TOO_LARGE: true,
  DOC_INVALID_ENCODING: true,
  DOC_LINE_TOO_LONG: true,
  DOC_TEXT_ADJUSTED: true,
  DOC_LINK_REJECTED: true,
  DOC_EMPTY: false,
  DOC_NOT_REGULAR_FILE: false,
  DOC_FRONT_MATTER_SKIPPED: false,
  DOC_UNCLOSED_FENCE: true,
  DOC_SETEXT_HEADING_UNSUPPORTED: false,
  DOC_SECTIONS_NOT_RECORDED: false,
  DOC_HTML_COMMENT_SKIPPED: false,
  DOC_INDENTED_LINES_SKIPPED: false,
} as const;

export type DocumentationDiagnosticCode = keyof typeof DOCUMENTATION_DIAGNOSTIC_AFFECTS_COMPLETENESS;

/** Whether a second run on the unchanged tree must return the same diagnostic. */
const DIAGNOSTIC_IS_STABLE: Record<DocumentationDiagnosticCode, boolean> = {
  DOC_INPUT_PATH_REJECTED: true,
  DOC_LIMIT_DOCUMENTS: true,
  DOC_LIMIT_TOTAL_BYTES: true,
  DOC_LIMIT_HEADINGS: true,
  DOC_LIMIT_LINKS: true,
  DOC_LIMIT_OBSERVATIONS: true,
  DOC_LIMIT_DIAGNOSTICS: true,
  // A read can fail because the file changed or the disk misbehaved: not a function of the tree alone.
  DOC_READ_FAILED: false,
  DOC_TOO_LARGE: true,
  DOC_INVALID_ENCODING: true,
  DOC_LINE_TOO_LONG: true,
  DOC_TEXT_ADJUSTED: true,
  DOC_LINK_REJECTED: true,
  DOC_EMPTY: true,
  DOC_NOT_REGULAR_FILE: true,
  DOC_FRONT_MATTER_SKIPPED: true,
  DOC_UNCLOSED_FENCE: true,
  DOC_SETEXT_HEADING_UNSUPPORTED: true,
  DOC_SECTIONS_NOT_RECORDED: true,
  DOC_HTML_COMMENT_SKIPPED: true,
  DOC_INDENTED_LINES_SKIPPED: true,
};

export interface DocumentationStats {
  inputEntries: number;
  /** Regular files the traversal listed under a supported name (before `maxDocuments`). */
  candidateDocuments: number;
  documentsAnalyzed: number;
  /** Listed as present, content not analysed. */
  documentsNotAnalyzed: number;
  /** Bytes actually read, including documents later found not analysable. */
  bytesRead: number;
  observations: number;
}

export interface DocumentationResult {
  schemaVersion: typeof DOCUMENTATION_SCHEMA_VERSION;
  /** Constant: nothing in this result has been compared with the implementation. */
  assertion: 'DOCUMENT_CONTENT_NOT_VERIFIED';
  limits: DocumentationLimits;
  /** `PARTIAL` when the traversal was `PARTIAL` or any completeness-affecting diagnostic exists. */
  completeness: 'COMPLETE' | 'PARTIAL';
  reproducible: boolean;
  traversal: { completeness: 'COMPLETE' | 'PARTIAL'; reproducible: boolean };
  stats: DocumentationStats;
  /** Canonical order: see `compareObservations`. */
  observations: DocumentationObservation[];
  /** Sorted by `compareDocDiagnostics`; a `DOC_LIMIT_DIAGNOSTICS` summary, when present, is first. */
  diagnostics: DiscoveryDiagnostic[];
}

export type DocumentReader = (projectRoot: string, relPath: string, opts: { maxBytes: number; allowEmpty: boolean }) => ProjectFileRead;

export interface AnalyzeDocumentationOptions {
  limits?: Partial<DocumentationLimits>;
  /** @internal Test seam; production uses `readProjectFile`. */
  readDocument?: DocumentReader;
}

// ---------------------------------------------------------------------------
// Link and text helpers
// ---------------------------------------------------------------------------

export function classifyLinkTarget(target: string): LinkType {
  if (target.startsWith('#')) return 'anchor';
  if (/^https?:\/\//i.test(target) || target.startsWith('//')) return 'external';
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/')) return 'other';
  return 'relative';
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** Text as kept in an observation: tabs as spaces, trimmed, bounded; unsafe characters withhold it. */
function fitText(raw: string, max: number): { text: string; textStatus: TextStatus } {
  const text = raw.replace(/\t/g, ' ').trim();
  if (text.length === 0) return { text: '', textStatus: 'FULL' };
  if (!isKeepableName(text, MAX_SAFE)) return { text: '', textStatus: 'WITHHELD' };
  if (text.length <= max) return { text, textStatus: 'FULL' };
  let cut = max;
  const last = text.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut--; // do not split a surrogate pair
  return { text: text.slice(0, cut), textStatus: 'TRUNCATED' };
}

const isAsciiPunct = (c: number): boolean => (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);

function runLength(s: string, i: number, code: number): number {
  let j = i;
  while (j < s.length && s.charCodeAt(j) === code) j++;
  return j - i;
}

/** Index just after the next run of EXACTLY `len` backticks at or after `from`, or -1. */
function findBacktickRun(s: string, from: number, len: number): number {
  let i = from;
  while (i < s.length) {
    const j = s.indexOf('`', i);
    if (j < 0) return -1;
    const n = runLength(s, j, 96);
    if (n === len) return j + n;
    i = j + n;
  }
  return -1;
}

interface RawLink {
  start: number;
  end: number;
  text: string;
  target: string;
  /** The target is longer than the limit: not recorded, but counted, and the scan resumes after it. */
  overflow?: true;
}

const TITLE_SCAN_MAX = 512;

/** `[text](target "title")` starting at the `[` at `i`, on one line, or null. Linear in the construct scanned. */
function parseInlineLink(line: string, i: number, maxTarget: number): RawLink | null {
  const n = line.length;
  let j = i + 1;
  for (; j < n; ) {
    const c = line.charCodeAt(j);
    if (c === 92) j += j + 1 < n && isAsciiPunct(line.charCodeAt(j + 1)) ? 2 : 1;
    else if (c === 96) {
      const len = runLength(line, j, 96);
      const end = findBacktickRun(line, j + len, len);
      j = end < 0 ? j + len : end;
    } else if (c === 91) return null; // nested bracket: not in the supported subset
    else if (c === 93) break;
    else j++;
  }
  if (j >= n || line.charCodeAt(j + 1) !== 40) return null;
  const text = line.slice(i + 1, j);
  let k = j + 2;
  const skipWs = (): void => {
    while (k < n && (line.charCodeAt(k) === 32 || line.charCodeAt(k) === 9)) k++;
  };
  skipWs();
  let target: string;
  if (line.charCodeAt(k) === 60) {
    const start = k + 1;
    let e = start;
    while (e < n && e - start <= maxTarget) {
      const c = line.charCodeAt(e);
      if (c === 62) break;
      if (c === 60 || c < 32) return null;
      e += c === 92 && e + 1 < n && isAsciiPunct(line.charCodeAt(e + 1)) ? 2 : 1;
    }
    if (e - start > maxTarget) return { start: i, end: e, text: '', target: '', overflow: true };
    if (e >= n || line.charCodeAt(e) !== 62) return null;
    target = line.slice(start, e);
    k = e + 1;
  } else {
    const start = k;
    let depth = 0;
    while (k < n && k - start <= maxTarget) {
      const c = line.charCodeAt(k);
      if (c === 32 || c === 9) break;
      if (c < 32) return null;
      if (c === 92 && k + 1 < n && isAsciiPunct(line.charCodeAt(k + 1))) {
        k += 2;
        continue;
      }
      if (c === 40) depth++;
      else if (c === 41) {
        if (depth === 0) break;
        depth--;
      }
      k++;
    }
    if (k - start > maxTarget) return { start: i, end: k, text: '', target: '', overflow: true };
    if (depth !== 0 || k >= n) return null;
    target = line.slice(start, k);
  }
  if (target.length === 0) return null;
  skipWs();
  const q = line.charCodeAt(k);
  if (q === 34 || q === 39 || q === 40) {
    const close = q === 40 ? 41 : q;
    let e = k + 1;
    while (e < n && e - k <= TITLE_SCAN_MAX) {
      const c = line.charCodeAt(e);
      if (c === 92 && e + 1 < n) e += 2;
      else if (c === close) break;
      else e++;
    }
    if (e >= n || line.charCodeAt(e) !== close) return null;
    k = e + 1;
    skipWs();
  }
  if (line.charCodeAt(k) !== 41) return null;
  return { start: i, end: k + 1, text, target };
}

/**
 * Inline scan of one line: finds supported links, skipping escapes, code spans, images and HTML tags.
 * `pending` is the length of a backtick run opened earlier in the same paragraph that has not closed
 * yet; what lies between is not scanned (an omission, never a false link). Returns the new `pending`.
 */
function scanInline(line: string, pending: number | null, maxTarget: number, emit: (l: RawLink) => void): number | null {
  const n = line.length;
  let i = 0;
  if (pending !== null) {
    const end = findBacktickRun(line, 0, pending);
    if (end < 0) return pending;
    i = end;
  }
  let bangAt = -2;
  let noGt = false;
  while (i < n) {
    const c = line.charCodeAt(i);
    if (c === 92) {
      i += i + 1 < n && isAsciiPunct(line.charCodeAt(i + 1)) ? 2 : 1;
    } else if (c === 96) {
      const len = runLength(line, i, 96);
      const end = findBacktickRun(line, i + len, len);
      if (end < 0) return len;
      i = end;
    } else if (c === 33) {
      bangAt = i++;
    } else if (c === 60 && !noGt) {
      const next = line.charCodeAt(i + 1);
      if ((next >= 65 && next <= 90) || (next >= 97 && next <= 122) || next === 47) {
        const gt = line.indexOf('>', i + 1);
        if (gt < 0) noGt = true;
        else {
          i = gt + 1;
          continue;
        }
      }
      i++;
    } else if (c === 91) {
      const link = parseInlineLink(line, i, maxTarget);
      if (link) {
        if (bangAt !== i - 1) emit(link);
        i = link.end;
      } else i++;
    } else i++;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Markdown structure
// ---------------------------------------------------------------------------

export interface ParseLimits {
  maxHeadings: number;
  maxLinks: number;
  maxTextLength: number;
  maxTargetLength: number;
  maxLineLength: number;
}

export interface ParsedHeading {
  ordinal: number;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  line: number;
  text: string;
  textStatus: TextStatus;
}

export interface ParsedLink {
  ordinal: number;
  line: number;
  text: string;
  textStatus: TextStatus;
  target: string;
  linkType: LinkType;
}

export interface ParsedSection {
  headingOrdinal: number;
  startLine: number;
  endLine: number;
  parentHeadingOrdinal?: number;
  ownTextLineGroups: number;
}

/** Counts of what was not extracted, so that omissions are visible. */
export interface ParseNotes {
  frontMatterLines: number;
  htmlCommentLines: number;
  indentedLines: number;
  longLines: number;
  setextLines: number;
  /** Line of a fence that never closed (everything after it is code, as in CommonMark). */
  unclosedFenceLine?: number;
  textAdjusted: number;
  linksRejected: number;
  headingsDropped: number;
  linksDropped: number;
}

export interface ParsedMarkdown {
  lines: number;
  headings: ParsedHeading[];
  links: ParsedLink[];
  /** Empty when `notes.setextLines > 0`: with an unrecognised heading the boundaries would be wrong. */
  sections: ParsedSection[];
  notes: ParseNotes;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`+|~+)[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const BLOCK_MARKER_START = /^[ \t]*(?:[-*+>|]|\d+[.)])/;

function indentWidth(line: string): number {
  let w = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 32) w++;
    else if (c === 9) w += 4 - (w % 4);
    else break;
  }
  return w;
}

function splitLines(content: string): string[] {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Closing sequence stripped per CommonMark: `## Title ##` -> `Title`; `# ###` -> ``. */
function headingContent(body: string): string {
  let text = body.trim();
  let e = text.length;
  while (e > 0 && text.charCodeAt(e - 1) === 35) e--;
  if (e === 0) return '';
  const before = text.charCodeAt(e - 1);
  if (e < text.length && (before === 32 || before === 9)) text = text.slice(0, e).trimEnd();
  return text;
}

/** Pure: no I/O. Total over any string. */
export function parseMarkdownStructure(content: string, limits: ParseLimits): ParsedMarkdown {
  const lines = splitLines(content);
  const notes: ParseNotes = {
    frontMatterLines: 0,
    htmlCommentLines: 0,
    indentedLines: 0,
    longLines: 0,
    setextLines: 0,
    textAdjusted: 0,
    linksRejected: 0,
    headingsDropped: 0,
    linksDropped: 0,
  };
  const allHeadings: { level: number; line: number }[] = [];
  const headings: ParsedHeading[] = [];
  const links: ParsedLink[] = [];
  const groupsByHeading: number[] = [];

  let first = 0;
  if (lines.length > 0 && /^---[ \t]*$/.test(lines[0] as string)) {
    for (let k = 1; k < lines.length; k++) {
      const l = lines[k] as string;
      if (/^(?:---|\.\.\.)[ \t]*$/.test(l)) {
        first = k + 1;
        notes.frontMatterLines = first;
        break;
      }
    }
  }

  let fence: { ch: string; len: number; line: number } | null = null;
  let inComment = false;
  let inGroup = false;
  let afterParagraph = false;
  let pending: number | null = null;
  let linkOrdinal = 0;

  for (let idx = first; idx < lines.length; idx++) {
    const raw = lines[idx] as string;
    const ln = idx + 1;
    if (fence) {
      const m = raw.length <= limits.maxLineLength ? FENCE_CLOSE.exec(raw) : null;
      if (m && (m[1] as string)[0] === fence.ch && (m[1] as string).length >= fence.len) fence = null;
      continue;
    }
    if (inComment) {
      notes.htmlCommentLines++;
      if (raw.includes('-->')) inComment = false;
      inGroup = false;
      continue;
    }
    if (/^[ \t]*$/.test(raw)) {
      inGroup = false;
      afterParagraph = false;
      pending = null;
      continue;
    }
    if (raw.length > limits.maxLineLength) {
      notes.longLines++;
      if (!inGroup && groupsByHeading.length > 0) groupsByHeading[groupsByHeading.length - 1]++;
      inGroup = true;
      afterParagraph = false;
      continue;
    }
    const open = raw.indexOf('<!--');
    if (open >= 0) {
      notes.htmlCommentLines++;
      if (indentWidth(raw) < 4 && /^[ \t]*<!--/.test(raw) && !raw.includes('-->', open + 4)) inComment = true;
      inGroup = false;
      afterParagraph = false;
      continue;
    }
    const fo = FENCE_OPEN.exec(raw);
    if (fo && !((fo[1] as string)[0] === '`' && (fo[2] as string).includes('`'))) {
      fence = { ch: (fo[1] as string)[0] as string, len: (fo[1] as string).length, line: ln };
      inGroup = false;
      afterParagraph = false;
      pending = null;
      continue;
    }
    if (indentWidth(raw) >= 4) {
      notes.indentedLines++;
      if (!inGroup && groupsByHeading.length > 0) groupsByHeading[groupsByHeading.length - 1]++;
      inGroup = true;
      continue;
    }
    const am = ATX.exec(raw);
    if (am) {
      const level = (am[1] as string).length as 1 | 2 | 3 | 4 | 5 | 6;
      allHeadings.push({ level, line: ln });
      groupsByHeading.push(0);
      const ordinal = allHeadings.length;
      if (ordinal <= limits.maxHeadings) {
        const t = fitText(headingContent(am[2] ?? ''), limits.maxTextLength);
        if (t.textStatus !== 'FULL') notes.textAdjusted++;
        headings.push({ ordinal, level, line: ln, text: t.text, textStatus: t.textStatus });
      } else notes.headingsDropped++;
      inGroup = false;
      afterParagraph = false;
      pending = null;
    } else {
      if (afterParagraph && SETEXT_UNDERLINE.test(raw)) {
        notes.setextLines++;
        afterParagraph = false;
        continue;
      }
      if (!inGroup && groupsByHeading.length > 0) groupsByHeading[groupsByHeading.length - 1]++;
      inGroup = true;
      afterParagraph = !BLOCK_MARKER_START.test(raw);
    }
    pending = scanInline(raw, pending, limits.maxTargetLength, (l) => {
      if (l.overflow || !isKeepableName(l.target, limits.maxTargetLength)) {
        notes.linksRejected++;
        return;
      }
      if (links.length >= limits.maxLinks) {
        notes.linksDropped++;
        return;
      }
      const t = fitText(l.text, limits.maxTextLength);
      if (t.textStatus !== 'FULL') notes.textAdjusted++;
      links.push({ ordinal: ++linkOrdinal, line: ln, text: t.text, textStatus: t.textStatus, target: l.target, linkType: classifyLinkTarget(l.target) });
    });
  }
  if (fence) notes.unclosedFenceLine = fence.line;

  const sections: ParsedSection[] = [];
  if (notes.setextLines === 0) {
    const stack: number[] = []; // indexes into allHeadings
    const ends = new Array<number>(allHeadings.length).fill(lines.length);
    const parents = new Array<number>(allHeadings.length).fill(0);
    allHeadings.forEach((h, k) => {
      while (stack.length > 0 && (allHeadings[stack[stack.length - 1] as number] as { level: number }).level >= h.level) {
        ends[stack.pop() as number] = h.line - 1;
      }
      parents[k] = stack.length > 0 ? (stack[stack.length - 1] as number) + 1 : 0;
      stack.push(k);
    });
    for (let k = 0; k < Math.min(allHeadings.length, limits.maxHeadings); k++) {
      const s: ParsedSection = {
        headingOrdinal: k + 1,
        startLine: (allHeadings[k] as { line: number }).line,
        endLine: ends[k] as number,
        ownTextLineGroups: groupsByHeading[k] as number,
      };
      if ((parents[k] as number) > 0) s.parentHeadingOrdinal = parents[k] as number;
      sections.push(s);
    }
  }
  return { lines: lines.length, headings, links, sections, notes };
}

// ---------------------------------------------------------------------------
// Observations: ids, order
// ---------------------------------------------------------------------------

function contentKey(o: DocumentationObservation): string {
  switch (o.kind) {
    case 'DOCUMENT_PRESENT':
      return `${o.analysis}\u0000${o.bytes ?? ''}\u0000${o.lines ?? ''}`;
    case 'HEADING':
      return `${o.level}\u0000${o.textStatus}\u0000${o.text}`;
    case 'SECTION':
      return `${o.source.endLine}\u0000${o.parentHeadingOrdinal ?? ''}\u0000${o.ownTextLineGroups}`;
    case 'LINK':
      return `${o.linkType}\u0000${o.textStatus}\u0000${o.text}\u0000${o.target}`;
  }
}

export function observationId(o: Omit<DocumentationObservation, 'id'> & { id?: string }): string {
  const full = o as DocumentationObservation;
  return computeFactId(`DOC_${full.kind}`, full.source.path, `${full.source.startLine ?? 0}:${full.ordinal}`, contentKey(full));
}

const KIND_RANK: Record<DocumentationObservationKind, number> = { DOCUMENT_PRESENT: 0, HEADING: 1, SECTION: 2, LINK: 3 };

/** (path, first line, kind rank, ordinal) in UTF-16 / numeric order. */
export function compareObservations(a: DocumentationObservation, b: DocumentationObservation): number {
  return (
    compareUtf16(a.source.path, b.source.path) ||
    (a.source.startLine ?? 0) - (b.source.startLine ?? 0) ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    a.ordinal - b.ordinal
  );
}

/** Completeness-affecting codes (0), traversal codes (1), the others (2); then code, path, message, count. */
export function compareDocDiagnostics(a: DiscoveryDiagnostic, b: DiscoveryDiagnostic): number {
  const rank = (d: DiscoveryDiagnostic): number =>
    d.code.startsWith('TRAVERSAL_') ? 1 : DOCUMENTATION_DIAGNOSTIC_AFFECTS_COMPLETENESS[d.code as DocumentationDiagnosticCode] ? 0 : 2;
  return rank(a) - rank(b) || compareUtf16(a.code, b.code) || compareUtf16(a.path ?? '', b.path ?? '') || compareUtf16(a.message, b.message) || (a.count ?? 0) - (b.count ?? 0);
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function resolveLimits(partial: Partial<DocumentationLimits> | undefined): DocumentationLimits {
  const limits: DocumentationLimits = { ...DEFAULT_DOCUMENTATION_LIMITS };
  for (const [key, value] of Object.entries(partial ?? {})) {
    if (!(LIMIT_KEYS as string[]).includes(key)) throw new DiscoveryError('INVALID_LIMITS', `unknown limit "${key}".`);
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw new DiscoveryError('INVALID_LIMITS', `limit "${key}" must be a positive integer.`);
    }
    limits[key as keyof DocumentationLimits] = value;
  }
  return limits;
}

const READ_ERROR_CODES: ReadonlySet<unknown> = new Set(
  Object.keys({
    FILE_MISSING: 0,
    FILE_OUTSIDE_PROJECT: 0,
    FILE_UNRESOLVABLE: 0,
    FILE_NOT_REGULAR: 0,
    FILE_EMPTY: 0,
    FILE_TOO_LARGE: 0,
    FILE_CHANGED: 0,
    FILE_UNREADABLE: 0,
    FILE_SYMLINK: 0,
    FILE_HARDLINKED: 0,
    READ_BOUNDARY_INVALID: 0,
    READ_UNSUPPORTED_PLATFORM: 0,
  } satisfies Record<ProjectFileErrorCode, 0>),
);

const ENTRY_KINDS = new Set(['file', 'directory', 'symlink', 'other']);
const depthOf = (p: string): number => p.split('/').length;
const isDocumentName = (p: string): boolean => p === 'README.md' || (p.startsWith('docs/') && /\.md$/i.test(p));

export function analyzeDocumentation(projectRoot: string, traversal: TraversalResult, options: AnalyzeDocumentationOptions = {}): DocumentationResult {
  if (typeof projectRoot !== 'string' || !isAbsolute(projectRoot)) {
    throw new DiscoveryError('INVALID_INPUT', 'the project root must be an explicit absolute path.');
  }
  if (
    !traversal ||
    !Array.isArray(traversal.entries) ||
    !Array.isArray(traversal.diagnostics) ||
    (traversal.completeness !== 'COMPLETE' && traversal.completeness !== 'PARTIAL') ||
    typeof traversal.reproducible !== 'boolean'
  ) {
    throw new DiscoveryError('INVALID_INPUT', 'the traversal result is malformed.');
  }
  const limits = resolveLimits(options.limits);
  const read: DocumentReader = options.readDocument ?? ((root, rel, o) => readProjectFile(root, rel, o));
  const diags: (DiscoveryDiagnostic & { code: DocumentationDiagnosticCode })[] = [];
  const diag = (code: DocumentationDiagnosticCode, message: string, path?: string, count?: number): void => {
    const d: DiscoveryDiagnostic & { code: DocumentationDiagnosticCode } = { code, message };
    if (path !== undefined) d.path = path;
    if (count !== undefined) d.count = count;
    diags.push(d);
  };

  // 1. Input hygiene, as in fact extraction.
  let rejected = 0;
  const kindByPath = new Map<string, TraversalEntry['kind']>();
  for (const e of traversal.entries) {
    if (!e || !ENTRY_KINDS.has(e.kind) || !isSafeRelativePath(e.path)) {
      rejected++;
      continue;
    }
    const prior = kindByPath.get(e.path);
    if (prior === undefined || compareUtf16(e.kind, prior) < 0) kindByPath.set(e.path, e.kind);
  }
  if (rejected > 0) diag('DOC_INPUT_PATH_REJECTED', 'traversal entries with an unsafe path or an unknown kind were ignored.', undefined, rejected);

  // 2. Candidates: only what the traversal listed. A link or a special file is never opened.
  const found: string[] = [];
  for (const [path, kind] of [...kindByPath].sort((a, b) => compareUtf16(a[0], b[0]))) {
    if (!isDocumentName(path)) continue;
    if (kind === 'file') found.push(path);
    else if (kind === 'symlink' || kind === 'other') diag('DOC_NOT_REGULAR_FILE', `an entry with a documentation name is not a regular file (${kind}); it was not read.`, path);
  }
  found.sort((a, b) => (a === 'README.md' ? -1 : b === 'README.md' ? 1 : depthOf(a) - depthOf(b) || compareUtf16(a, b)));
  const candidates = found.slice(0, limits.maxDocuments);
  if (found.length > candidates.length) diag('DOC_LIMIT_DOCUMENTS', `documents beyond ${limits.maxDocuments} (deepest last) were not analysed.`, undefined, found.length - candidates.length);

  // 3. Read and parse, document by document, inside the byte budgets.
  const documents: DocumentPresentObservation[] = [];
  const headings: HeadingObservation[] = [];
  const sections: SectionObservation[] = [];
  const links: LinkObservation[] = [];
  let remaining = limits.maxTotalBytes;
  let bytesRead = 0;
  let totalLimited = 0;
  const parseLimits: ParseLimits = {
    maxHeadings: limits.maxHeadingsPerDocument,
    maxLinks: limits.maxLinksPerDocument,
    maxTextLength: limits.maxTextLength,
    maxTargetLength: limits.maxTargetLength,
    maxLineLength: limits.maxLineLength,
  };
  const present = (path: string, analysis: 'ANALYZED' | 'NOT_ANALYZED', bytes?: number, lines?: number): void => {
    const o: Omit<DocumentPresentObservation, 'id'> = { kind: 'DOCUMENT_PRESENT', evidence: 'OBSERVED_FILE', source: { path, observation: 'markdown-file' }, ordinal: 0, format: 'markdown', analysis };
    if (bytes !== undefined) (o as DocumentPresentObservation).bytes = bytes;
    if (lines !== undefined) (o as DocumentPresentObservation).lines = lines;
    documents.push({ ...o, id: observationId(o) });
  };

  for (const path of candidates) {
    if (remaining <= 0) {
      totalLimited++;
      present(path, 'NOT_ANALYZED');
      continue;
    }
    const cap = Math.min(limits.maxDocumentBytes, remaining);
    let content: string | undefined;
    let size = 0;
    try {
      // The reader is a seam: whatever it returns or throws is untrusted.
      const r = read(projectRoot, path, { maxBytes: cap, allowEmpty: true });
      if (r.ok) {
        if (typeof r.content !== 'string') throw new TypeError('content');
        size = Buffer.byteLength(r.content, 'utf8');
        if (size > cap) throw new RangeError('size');
        content = r.content;
      } else {
        const code = READ_ERROR_CODES.has(r.code) ? r.code : 'UNKNOWN';
        if (code === 'FILE_TOO_LARGE' && cap < limits.maxDocumentBytes) totalLimited++;
        else if (code === 'FILE_TOO_LARGE') diag('DOC_TOO_LARGE', `the document exceeds ${limits.maxDocumentBytes} bytes and was not read.`, path);
        else diag('DOC_READ_FAILED', `the document was refused or could not be read (${code}).`, path);
      }
    } catch {
      diag('DOC_READ_FAILED', 'the document could not be read (unexpected failure).', path);
    }
    if (content === undefined) {
      present(path, 'NOT_ANALYZED');
      continue;
    }
    bytesRead += size;
    remaining -= size;
    if (content.includes('�') || content.includes('\u0000')) {
      diag('DOC_INVALID_ENCODING', 'the document contains invalid UTF-8 (U+FFFD) or NUL; it was not analysed.', path);
      present(path, 'NOT_ANALYZED', size);
      continue;
    }
    const parsed = parseMarkdownStructure(content, parseLimits);
    const n = parsed.notes;
    if (content.length === 0) diag('DOC_EMPTY', 'the document is empty; nothing was extracted.', path);
    if (n.frontMatterLines > 0) diag('DOC_FRONT_MATTER_SKIPPED', 'leading YAML front matter was skipped; its content is not analysed.', path, n.frontMatterLines);
    if (n.htmlCommentLines > 0) diag('DOC_HTML_COMMENT_SKIPPED', 'lines with or inside HTML comments were not analysed.', path, n.htmlCommentLines);
    if (n.indentedLines > 0) diag('DOC_INDENTED_LINES_SKIPPED', 'lines indented by 4 or more columns were not analysed (indented code or nested content).', path, n.indentedLines);
    if (n.longLines > 0) diag('DOC_LINE_TOO_LONG', `lines longer than ${limits.maxLineLength} characters were not analysed.`, path, n.longLines);
    if (n.setextLines > 0) {
      diag('DOC_SETEXT_HEADING_UNSUPPORTED', 'setext headings (underlined with = or -) are not recognised.', path, n.setextLines);
      diag('DOC_SECTIONS_NOT_RECORDED', 'sections are not recorded for this document: an unrecognised heading would make their boundaries wrong.', path);
    }
    if (n.unclosedFenceLine !== undefined) diag('DOC_UNCLOSED_FENCE', `a fenced code block opened on line ${n.unclosedFenceLine} never closes; the rest of the document is code and was not analysed.`, path);
    if (n.textAdjusted > 0) diag('DOC_TEXT_ADJUSTED', 'heading or link text that was too long or contained unsafe characters was truncated or withheld.', path, n.textAdjusted);
    if (n.linksRejected > 0) diag('DOC_LINK_REJECTED', 'links whose target is too long or contains unsafe characters were not recorded (a construct that merely looks like a link may be counted).', path, n.linksRejected);
    if (n.headingsDropped > 0) diag('DOC_LIMIT_HEADINGS', `headings beyond ${limits.maxHeadingsPerDocument} were not recorded.`, path, n.headingsDropped);
    if (n.linksDropped > 0) diag('DOC_LIMIT_LINKS', `links beyond ${limits.maxLinksPerDocument} were not recorded.`, path, n.linksDropped);
    present(path, 'ANALYZED', size, parsed.lines);

    const at = (observation: DocumentationSourceKind, startLine: number, endLine: number): DocumentationSource => ({ path, observation, startLine, endLine });
    for (const h of parsed.headings) {
      const o: Omit<HeadingObservation, 'id'> = { kind: 'HEADING', evidence: 'DOCUMENT_TEXT', source: at('markdown-atx-heading', h.line, h.line), ordinal: h.ordinal, level: h.level, text: h.text, textStatus: h.textStatus };
      headings.push({ ...o, id: observationId(o) });
    }
    for (const s of parsed.sections) {
      const o: Omit<SectionObservation, 'id'> = { kind: 'SECTION', evidence: 'DOCUMENT_TEXT', source: at('markdown-section', s.startLine, s.endLine), ordinal: s.headingOrdinal, headingOrdinal: s.headingOrdinal, ownTextLineGroups: s.ownTextLineGroups };
      if (s.parentHeadingOrdinal !== undefined) (o as SectionObservation).parentHeadingOrdinal = s.parentHeadingOrdinal;
      sections.push({ ...o, id: observationId(o) });
    }
    for (const l of parsed.links) {
      const o: Omit<LinkObservation, 'id'> = { kind: 'LINK', evidence: 'DOCUMENT_TEXT', source: at('markdown-inline-link', l.line, l.line), ordinal: l.ordinal, text: l.text, textStatus: l.textStatus, target: l.target, linkType: l.linkType };
      links.push({ ...o, id: observationId(o) });
    }
  }
  if (totalLimited > 0) diag('DOC_LIMIT_TOTAL_BYTES', `documents that did not fit in the total of ${limits.maxTotalBytes} bytes were not analysed.`, undefined, totalLimited);

  // 4. Global budget, cutting the bulkiest kind first: links, then sections, then headings.
  //    A section or a link of a dropped heading is dropped with it.
  let budget = limits.maxObservations;
  const take = <T>(list: T[], keep: (x: T) => boolean = () => true): T[] => {
    const out: T[] = [];
    for (const x of list) {
      if (!keep(x)) continue;
      if (budget <= 0) break;
      budget--;
      out.push(x);
    }
    return out;
  };
  const keptDocs = take(documents);
  const keptHeadings = take(headings);
  const headingKeys = new Set(keptHeadings.map((h) => `${h.source.path}\u0000${h.ordinal}`));
  const keptSections = take(sections, (s) => headingKeys.has(`${s.source.path}\u0000${s.ordinal}`));
  const keptLinks = take(links);
  const dropped = documents.length + headings.length + sections.length + links.length - (keptDocs.length + keptHeadings.length + keptSections.length + keptLinks.length);
  if (dropped > 0) diag('DOC_LIMIT_OBSERVATIONS', `observations beyond ${limits.maxObservations} were not recorded (links are cut first).`, undefined, dropped);
  const observations = [...keptDocs, ...keptHeadings, ...keptSections, ...keptLinks].sort(compareObservations);

  // 5. Diagnostics, completeness, reproducibility: separate properties.
  const fromTraversal: DiscoveryDiagnostic[] = traversal.diagnostics.map((d) => {
    const out: DiscoveryDiagnostic = { code: `TRAVERSAL_${String(d.code)}`, message: String(d.message) };
    if (d.path !== undefined && isSafeRelativePath(d.path)) out.path = d.path;
    if (d.count !== undefined) out.count = d.count;
    return out;
  });
  let diagnostics: DiscoveryDiagnostic[] = [...diags, ...fromTraversal].sort(compareDocDiagnostics);
  let diagnosticsDropped = 0;
  if (diagnostics.length > limits.maxDiagnostics) {
    diagnosticsDropped = diagnostics.length - (limits.maxDiagnostics - 1);
    diagnostics = diagnostics.slice(0, limits.maxDiagnostics - 1);
    diagnostics.unshift({ code: 'DOC_LIMIT_DIAGNOSTICS', count: diagnosticsDropped, message: `${diagnosticsDropped} diagnostics beyond the limit of ${limits.maxDiagnostics} were not kept.` });
  }
  const codes: DocumentationDiagnosticCode[] = diags.map((d) => d.code);
  if (diagnosticsDropped > 0) codes.push('DOC_LIMIT_DIAGNOSTICS');
  const partial = traversal.completeness === 'PARTIAL' || codes.some((c) => DOCUMENTATION_DIAGNOSTIC_AFFECTS_COMPLETENESS[c]);
  const reproducible = traversal.reproducible && codes.every((c) => DIAGNOSTIC_IS_STABLE[c]);

  const result: DocumentationResult = {
    schemaVersion: DOCUMENTATION_SCHEMA_VERSION,
    assertion: 'DOCUMENT_CONTENT_NOT_VERIFIED',
    limits,
    completeness: partial ? 'PARTIAL' : 'COMPLETE',
    reproducible,
    traversal: { completeness: traversal.completeness, reproducible: traversal.reproducible },
    stats: {
      inputEntries: traversal.entries.length,
      candidateDocuments: found.length,
      documentsAnalyzed: keptDocs.filter((d) => d.analysis === 'ANALYZED').length,
      documentsNotAnalyzed: keptDocs.filter((d) => d.analysis === 'NOT_ANALYZED').length,
      bytesRead,
      observations: observations.length,
    },
    observations,
    diagnostics,
  };
  const violations = validateDocumentationResult(result);
  if (violations.length > 0) throw new DiscoveryError('RESULT_INVALID', `the documentation result failed validation: ${violations.slice(0, 3).join('; ')}`);
  return result;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

const MAX_VIOLATIONS = 100;
const RESULT_KEYS = ['schemaVersion', 'assertion', 'limits', 'completeness', 'reproducible', 'traversal', 'stats', 'observations', 'diagnostics'];
const STAT_NAMES: readonly (keyof DocumentationStats)[] = ['inputEntries', 'candidateDocuments', 'documentsAnalyzed', 'documentsNotAnalyzed', 'bytesRead', 'observations'];
const OBSERVATION_KEYS: Record<DocumentationObservationKind, readonly string[]> = {
  DOCUMENT_PRESENT: ['id', 'kind', 'evidence', 'source', 'ordinal', 'format', 'analysis', 'bytes', 'lines'],
  HEADING: ['id', 'kind', 'evidence', 'source', 'ordinal', 'level', 'text', 'textStatus'],
  SECTION: ['id', 'kind', 'evidence', 'source', 'ordinal', 'headingOrdinal', 'parentHeadingOrdinal', 'ownTextLineGroups'],
  LINK: ['id', 'kind', 'evidence', 'source', 'ordinal', 'text', 'textStatus', 'target', 'linkType'],
};
const HEX16 = /^[0-9a-f]{16}$/;
const TRAVERSAL_CODE = /^TRAVERSAL_[A-Z][A-Z0-9_]{0,63}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const ABSOLUTE_PATH_IN_TEXT = /(^|[\s"'`(=:])\/[^\s/]|[A-Za-z]:[\\/]|\\\\[^\s\\]/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/**
 * Check of a `DocumentationResult` against the schema-1 contract. Returns the violations (empty = valid).
 * Input is `unknown`: a malformed value yields violations, never a `TypeError`. A violation names a
 * location and a rule and never repeats a value from the input. At most 100 are returned. Plain
 * JSON-like data only (no accessors that throw, no `Proxy`).
 */
export function validateDocumentationResult(result: unknown): string[] {
  const bad: string[] = [];
  const fail = (m: string): void => {
    if (bad.length < MAX_VIOLATIONS) bad.push(m);
  };
  if (!isObject(result)) return ['result: not an object'];
  const keysOk = (o: Record<string, unknown>, allowed: readonly string[], at: string): void => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${at}: unknown property`);
  };
  keysOk(result, RESULT_KEYS, 'result');
  if (result.schemaVersion !== DOCUMENTATION_SCHEMA_VERSION) fail('schemaVersion');
  if (result.assertion !== 'DOCUMENT_CONTENT_NOT_VERIFIED') fail('assertion');

  const limits = {} as Record<keyof DocumentationLimits, number>;
  let limitsOk = false;
  const rawLimits = own(result, 'limits');
  if (!isObject(rawLimits)) fail('limits: not an object');
  else {
    limitsOk = true;
    keysOk(rawLimits, LIMIT_KEYS, 'limits');
    for (const k of LIMIT_KEYS) {
      const v = own(rawLimits, k);
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) {
        fail(`limits.${k}: not a positive integer`);
        limitsOk = false;
      } else limits[k] = v;
    }
  }

  const verdict = (v: unknown): v is 'COMPLETE' | 'PARTIAL' => v === 'COMPLETE' || v === 'PARTIAL';
  const completeness = own(result, 'completeness');
  const reproducible = own(result, 'reproducible');
  if (!verdict(completeness)) fail('completeness: not COMPLETE or PARTIAL');
  if (typeof reproducible !== 'boolean') fail('reproducible: not a boolean');
  const traversal = own(result, 'traversal');
  let traversalPartial = false;
  let traversalUnstable = false;
  if (!isObject(traversal)) fail('traversal: not an object');
  else {
    keysOk(traversal, ['completeness', 'reproducible'], 'traversal');
    if (!verdict(own(traversal, 'completeness'))) fail('traversal.completeness: not COMPLETE or PARTIAL');
    if (typeof own(traversal, 'reproducible') !== 'boolean') fail('traversal.reproducible: not a boolean');
    traversalPartial = own(traversal, 'completeness') === 'PARTIAL';
    traversalUnstable = own(traversal, 'reproducible') === false;
  }

  const stats = own(result, 'stats');
  let statsOk = false;
  if (!isObject(stats)) fail('stats: not an object');
  else {
    statsOk = true;
    keysOk(stats, STAT_NAMES, 'stats');
    for (const k of STAT_NAMES) {
      if (!isCount(own(stats, k))) {
        fail(`stats.${k}: not a non-negative integer`);
        statsOk = false;
      }
    }
  }

  // observations: size first, so an oversized array is refused without walking it
  const observations = own(result, 'observations');
  if (!Array.isArray(observations)) fail('observations: not an array');
  else if (limitsOk && observations.length > limits.maxObservations) fail('observations: more than limits.maxObservations');
  else {
    const docs = new Map<string, DocumentPresentObservation>();
    const seenIds = new Set<string>();
    const perDoc = new Map<string, { headings: Map<number, HeadingObservation>; links: number; lastLink: number }>();
    const valid: DocumentationObservation[] = [];
    let analyzedBytes = 0;
    const textOk = (o: { text: unknown; textStatus: unknown }, at: string): void => {
      const { text, textStatus } = o;
      if (textStatus !== 'FULL' && textStatus !== 'TRUNCATED' && textStatus !== 'WITHHELD') return fail(`${at}: textStatus`);
      if (typeof text !== 'string' || CONTROL.test(text)) return fail(`${at}: text is not plain text`);
      if (limitsOk && text.length > limits.maxTextLength) fail(`${at}: text longer than limits.maxTextLength`);
      if (textStatus === 'WITHHELD' && text !== '') fail(`${at}: withheld text must be empty`);
      if (textStatus === 'TRUNCATED' && limitsOk && text.length < limits.maxTextLength - 1) fail(`${at}: truncated although shorter than the limit`);
    };
    // First pass: shape, ids, documents.
    observations.forEach((raw, i) => {
      const at = `observations[${i}]`;
      if (!isObject(raw)) return fail(`${at}: not an object`);
      const kind = raw.kind;
      if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(DOCUMENTATION_EVIDENCE_BY_KIND, kind)) return fail(`${at}: kind`);
      const k = kind as DocumentationObservationKind;
      keysOk(raw, OBSERVATION_KEYS[k], at);
      if (typeof raw.id !== 'string' || !HEX16.test(raw.id)) return fail(`${at}: id`);
      if (raw.evidence !== DOCUMENTATION_EVIDENCE_BY_KIND[k]) fail(`${at}: evidence does not match the kind`);
      const src = raw.source;
      if (!isObject(src)) return fail(`${at}: source: not an object`);
      keysOk(src, ['path', 'observation', 'startLine', 'endLine'], `${at}.source`);
      if (!isSafeRelativePath(src.path)) return fail(`${at}.source: unsafe path`);
      if (src.observation !== SOURCE_BY_KIND[k]) fail(`${at}.source: observation does not match the kind`);
      const whole = k === 'DOCUMENT_PRESENT';
      if (whole) {
        if (src.startLine !== undefined || src.endLine !== undefined) fail(`${at}.source: a document has no line range`);
      } else if (!isCount(src.startLine) || !isCount(src.endLine) || (src.startLine as number) < 1 || (src.endLine as number) < (src.startLine as number)) {
        return fail(`${at}.source: invalid line range`);
      } else if ((k === 'HEADING' || k === 'LINK') && src.startLine !== src.endLine) fail(`${at}.source: ${k} is a single line`);
      if (!isCount(raw.ordinal) || (whole ? raw.ordinal !== 0 : raw.ordinal < 1)) return fail(`${at}: ordinal`);
      const o = raw as unknown as DocumentationObservation;
      if (o.id !== observationId(o)) fail(`${at}: id does not match its content`);
      if (seenIds.has(o.id)) fail(`${at}: duplicate id`);
      seenIds.add(o.id);
      switch (o.kind) {
        case 'DOCUMENT_PRESENT': {
          if (o.format !== 'markdown') fail(`${at}: format`);
          if (o.analysis !== 'ANALYZED' && o.analysis !== 'NOT_ANALYZED') fail(`${at}: analysis`);
          if (o.analysis === 'ANALYZED') {
            if (!isCount(o.bytes) || !isCount(o.lines)) fail(`${at}: an analysed document needs bytes and lines`);
            else {
              analyzedBytes += o.bytes;
              if (limitsOk && o.bytes > limits.maxDocumentBytes) fail(`${at}: more bytes than limits.maxDocumentBytes`);
            }
          } else if (o.lines !== undefined) fail(`${at}: lines on a document that was not analysed`);
          else if (o.bytes !== undefined && !isCount(o.bytes)) fail(`${at}: bytes`);
          if (docs.has(o.source.path)) fail(`${at}: duplicate document`);
          docs.set(o.source.path, o);
          break;
        }
        case 'HEADING':
          if (![1, 2, 3, 4, 5, 6].includes(o.level as number)) fail(`${at}: level`);
          textOk(o, at);
          break;
        case 'SECTION':
          if (o.headingOrdinal !== o.ordinal) fail(`${at}: headingOrdinal differs from ordinal`);
          if (o.parentHeadingOrdinal !== undefined && !(isCount(o.parentHeadingOrdinal) && o.parentHeadingOrdinal >= 1 && o.parentHeadingOrdinal < o.ordinal)) fail(`${at}: parentHeadingOrdinal`);
          if (!isCount(o.ownTextLineGroups)) fail(`${at}: ownTextLineGroups`);
          break;
        case 'LINK':
          textOk(o, at);
          if (typeof o.target !== 'string' || (limitsOk && !isKeepableName(o.target, limits.maxTargetLength))) fail(`${at}: target is not a keepable string`);
          else if (o.linkType !== classifyLinkTarget(o.target)) fail(`${at}: linkType does not match the target`);
          break;
      }
      valid.push(o);
    });
    // Second pass: relations between observations.
    valid.forEach((o, i) => {
      const at = `observations[${i}]`;
      if (o.kind === 'DOCUMENT_PRESENT') return;
      const doc = docs.get(o.source.path);
      if (!doc) return fail(`${at}: no DOCUMENT_PRESENT for its path`);
      if (doc.analysis !== 'ANALYZED') return fail(`${at}: observation of a document that was not analysed`);
      if ((o.source.endLine as number) > (doc.lines as number)) fail(`${at}: line range beyond the document`);
      const d = perDoc.get(o.source.path) ?? { headings: new Map<number, HeadingObservation>(), links: 0, lastLink: 0 };
      perDoc.set(o.source.path, d);
      if (o.kind === 'HEADING') {
        if (d.headings.has(o.ordinal)) fail(`${at}: duplicate heading ordinal`);
        d.headings.set(o.ordinal, o);
      } else if (o.kind === 'LINK') {
        d.links++;
        if (o.ordinal <= d.lastLink) fail(`${at}: link ordinal order`);
        d.lastLink = o.ordinal;
      }
    });
    valid.forEach((o, i) => {
      if (o.kind !== 'SECTION') return;
      const at = `observations[${i}]`;
      const h = perDoc.get(o.source.path)?.headings;
      const head = h?.get(o.headingOrdinal);
      if (!head) return fail(`${at}: no heading for this section`);
      if (head.source.startLine !== o.source.startLine) fail(`${at}: section does not start at its heading`);
      if (o.parentHeadingOrdinal !== undefined) {
        const parent = h?.get(o.parentHeadingOrdinal);
        if (!parent || parent.level >= head.level) fail(`${at}: parent is not a heading of a lower level`);
      }
    });
    if (limitsOk) {
      if (docs.size > limits.maxDocuments) fail('observations: more documents than limits.maxDocuments');
      if (analyzedBytes > limits.maxTotalBytes) fail('observations: more bytes than limits.maxTotalBytes');
      for (const d of perDoc.values()) {
        if (d.headings.size > limits.maxHeadingsPerDocument) fail('observations: more headings in one document than the limit');
        if (d.links > limits.maxLinksPerDocument) fail('observations: more links in one document than the limit');
      }
    }
    for (let i = 1; i < valid.length; i++) {
      if (compareObservations(valid[i - 1] as DocumentationObservation, valid[i] as DocumentationObservation) > 0) fail(`observations[${i}]: order`);
    }
    if (statsOk) {
      const st = stats as unknown as DocumentationStats;
      const analyzed = [...docs.values()].filter((d) => d.analysis === 'ANALYZED').length;
      if (st.observations !== observations.length) fail('stats.observations: differs from the number of observations');
      if (st.documentsAnalyzed !== analyzed) fail('stats.documentsAnalyzed: differs from the analysed documents');
      if (st.documentsNotAnalyzed !== docs.size - analyzed) fail('stats.documentsNotAnalyzed: differs from the documents not analysed');
      if (st.candidateDocuments < docs.size) fail('stats.candidateDocuments: fewer than the documents');
      if (st.bytesRead < analyzedBytes) fail('stats.bytesRead: fewer than the analysed bytes');
      if (limitsOk && st.bytesRead > limits.maxTotalBytes) fail('stats.bytesRead: more than limits.maxTotalBytes');
    }
  }

  const diagnostics = own(result, 'diagnostics');
  let affecting = false;
  let unstable = false;
  if (!Array.isArray(diagnostics)) fail('diagnostics: not an array');
  else if (limitsOk && diagnostics.length > limits.maxDiagnostics) fail('diagnostics: more than limits.maxDiagnostics');
  else {
    const parsed: DiscoveryDiagnostic[] = [];
    let allOk = true;
    diagnostics.forEach((raw, i) => {
      const at = `diagnostics[${i}]`;
      if (!isObject(raw)) {
        allOk = false;
        return fail(`${at}: not an object`);
      }
      keysOk(raw, ['code', 'path', 'count', 'message'], at);
      const { code, path, count, message } = raw;
      const known = typeof code === 'string' && Object.prototype.hasOwnProperty.call(DOCUMENTATION_DIAGNOSTIC_AFFECTS_COMPLETENESS, code);
      let ok = true;
      if (!known && !(typeof code === 'string' && TRAVERSAL_CODE.test(code))) {
        fail(`${at}: unknown code`);
        ok = false;
      }
      if (path !== undefined && !isSafeRelativePath(path)) {
        fail(`${at}: unsafe path`);
        ok = false;
      }
      if (count !== undefined && !(isCount(count) && count >= 1)) {
        fail(`${at}: count is not a positive integer`);
        ok = false;
      }
      if (typeof message !== 'string' || message.length === 0 || CONTROL.test(message)) {
        fail(`${at}: message is not plain text`);
        ok = false;
      } else if (ABSOLUTE_PATH_IN_TEXT.test(message)) {
        fail(`${at}: message contains an absolute path`);
        ok = false;
      }
      if (!ok) {
        allOk = false;
        return;
      }
      if (known) {
        if (DOCUMENTATION_DIAGNOSTIC_AFFECTS_COMPLETENESS[code as DocumentationDiagnosticCode]) affecting = true;
        if (!DIAGNOSTIC_IS_STABLE[code as DocumentationDiagnosticCode]) unstable = true;
      }
      parsed.push(raw as unknown as DiscoveryDiagnostic);
    });
    if (allOk) {
      parsed.forEach((d, i) => {
        if (d.code === 'DOC_LIMIT_DIAGNOSTICS' && i !== 0) fail(`diagnostics[${i}]: the DOC_LIMIT_DIAGNOSTICS summary must come first`);
        if (i === 0 || (i === 1 && (parsed[0] as DiscoveryDiagnostic).code === 'DOC_LIMIT_DIAGNOSTICS')) return;
        if (compareDocDiagnostics(parsed[i - 1] as DiscoveryDiagnostic, d) > 0) fail(`diagnostics[${i}]: order`);
      });
    }
  }

  if (completeness === 'COMPLETE' && (traversalPartial || affecting)) fail('completeness: COMPLETE although the traversal or a diagnostic says PARTIAL');
  if (reproducible === true && (traversalUnstable || unstable)) fail('reproducible: true although the traversal or a diagnostic says it is not');
  return bad;
}
