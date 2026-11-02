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
import { type ProjectFileRead } from '../root/index.js';
import type { TraversalResult } from './traverse.js';
import { type DiscoveryDiagnostic } from './contracts.js';
export declare const DOCUMENTATION_SCHEMA_VERSION = 1;
export type DocumentationObservationKind = 'DOCUMENT_PRESENT' | 'HEADING' | 'SECTION' | 'LINK';
/** How an observation was obtained; a function of the kind, never chosen per observation. */
export declare const DOCUMENTATION_EVIDENCE_BY_KIND: {
    /** The traversal listed a regular file with a supported name. Says nothing about its content being right. */
    readonly DOCUMENT_PRESENT: "OBSERVED_FILE";
    /** The author wrote an ATX heading here. Says nothing about the project. */
    readonly HEADING: "DOCUMENT_TEXT";
    /** Lines between a heading and the next heading of the same or a higher level. A text range, not a component. */
    readonly SECTION: "DOCUMENT_TEXT";
    /** The author wrote an inline link here. Never resolved, never followed, never checked. */
    readonly LINK: "DOCUMENT_TEXT";
};
export type DocumentationEvidence = (typeof DOCUMENTATION_EVIDENCE_BY_KIND)[DocumentationObservationKind];
export type DocumentationSourceKind = 'markdown-file' | 'markdown-atx-heading' | 'markdown-section' | 'markdown-inline-link';
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
export declare const DEFAULT_DOCUMENTATION_LIMITS: Readonly<DocumentationLimits>;
/** Closed list. `true`: something inside the declared scope was not extracted, so the result is `PARTIAL`. */
export declare const DOCUMENTATION_DIAGNOSTIC_AFFECTS_COMPLETENESS: {
    readonly DOC_INPUT_PATH_REJECTED: true;
    readonly DOC_LIMIT_DOCUMENTS: true;
    readonly DOC_LIMIT_TOTAL_BYTES: true;
    readonly DOC_LIMIT_HEADINGS: true;
    readonly DOC_LIMIT_LINKS: true;
    readonly DOC_LIMIT_OBSERVATIONS: true;
    readonly DOC_LIMIT_DIAGNOSTICS: true;
    readonly DOC_READ_FAILED: true;
    readonly DOC_TOO_LARGE: true;
    readonly DOC_INVALID_ENCODING: true;
    readonly DOC_LINE_TOO_LONG: true;
    readonly DOC_TEXT_ADJUSTED: true;
    readonly DOC_LINK_REJECTED: true;
    readonly DOC_EMPTY: false;
    readonly DOC_NOT_REGULAR_FILE: false;
    readonly DOC_FRONT_MATTER_SKIPPED: false;
    readonly DOC_UNCLOSED_FENCE: true;
    readonly DOC_SETEXT_HEADING_UNSUPPORTED: false;
    readonly DOC_SECTIONS_NOT_RECORDED: false;
    readonly DOC_HTML_COMMENT_SKIPPED: false;
    readonly DOC_INDENTED_LINES_SKIPPED: false;
};
export type DocumentationDiagnosticCode = keyof typeof DOCUMENTATION_DIAGNOSTIC_AFFECTS_COMPLETENESS;
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
    traversal: {
        completeness: 'COMPLETE' | 'PARTIAL';
        reproducible: boolean;
    };
    stats: DocumentationStats;
    /** Canonical order: see `compareObservations`. */
    observations: DocumentationObservation[];
    /** Sorted by `compareDocDiagnostics`; a `DOC_LIMIT_DIAGNOSTICS` summary, when present, is first. */
    diagnostics: DiscoveryDiagnostic[];
}
export type DocumentReader = (projectRoot: string, relPath: string, opts: {
    maxBytes: number;
    allowEmpty: boolean;
}) => ProjectFileRead;
export interface AnalyzeDocumentationOptions {
    limits?: Partial<DocumentationLimits>;
    /** @internal Test seam; production uses `readProjectFile`. */
    readDocument?: DocumentReader;
}
export declare function classifyLinkTarget(target: string): LinkType;
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
/** Pure: no I/O. Total over any string. */
export declare function parseMarkdownStructure(content: string, limits: ParseLimits): ParsedMarkdown;
export declare function observationId(o: Omit<DocumentationObservation, 'id'> & {
    id?: string;
}): string;
/** (path, first line, kind rank, ordinal) in UTF-16 / numeric order. */
export declare function compareObservations(a: DocumentationObservation, b: DocumentationObservation): number;
/** Completeness-affecting codes (0), traversal codes (1), the others (2); then code, path, message, count. */
export declare function compareDocDiagnostics(a: DiscoveryDiagnostic, b: DiscoveryDiagnostic): number;
export declare function analyzeDocumentation(projectRoot: string, traversal: TraversalResult, options?: AnalyzeDocumentationOptions): DocumentationResult;
/**
 * Check of a `DocumentationResult` against the schema-1 contract. Returns the violations (empty = valid).
 * Input is `unknown`: a malformed value yields violations, never a `TypeError`. A violation names a
 * location and a rule and never repeats a value from the input. At most 100 are returned. Plain
 * JSON-like data only (no accessors that throw, no `Proxy`).
 */
export declare function validateDocumentationResult(result: unknown): string[];
export {};
//# sourceMappingURL=docs.d.ts.map