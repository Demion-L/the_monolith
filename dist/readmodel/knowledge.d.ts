/**
 * Hypotheses and ADRs for Mission Control (UI-004B).
 *
 * Core reads and interprets; the UI only presents. Strictly read-only: every file
 * goes through `readProjectFile` (ADR-014: no symlink in any component, one hard
 * link, regular file, bounded, strict UTF-8). Nothing is written, executed or fetched.
 *
 * The set of sources is closed:
 *  - `<monolithRoot>/memory/long-term/hypotheses.md`
 *  - `docs/adr/ADR-*.md` (the directory is listed, never walked recursively;
 *    `docs/adr/README.md` is an index that restates the frontmatter and is NOT a source:
 *    the frontmatter is authoritative, a second reading would create a second truth).
 *
 * Interpretation rules (never guess):
 *  - Hypothesis = a level-2 heading `## Title {#HYP-NNN}`; headings, status lines and text
 *    inside code fences or HTML comments are invisible (`maskNonContent`).
 *  - ADR = frontmatter `id`, `title`, `status`, `supersedes`, `superseded_by`, as declared.
 *    Links are never derived or cross-checked against other ADRs.
 *  - Duplicate ids are ambiguous: none of the duplicates is shown, an issue is reported.
 *  - A status is verbatim; the UI decides how to present an unknown one.
 *  - Failures are DATA (fixed codes + project-relative paths), never exception text.
 */
import type { KnowledgeData, KnowledgeIssueCode, KnowledgeIssueView, KnowledgeItemView, Section, SourceErrorCode } from './types.js';
export declare const HYPOTHESES_REL = "memory/long-term/hypotheses.md";
export declare const ADR_DIR_REL = "docs/adr";
export declare const MAX_HYPOTHESES_BYTES: number;
export declare const MAX_ADR_BYTES: number;
export declare const MAX_KNOWLEDGE_ITEMS = 200;
export declare const MAX_SUMMARY_CHARS = 600;
export declare class Issues {
    readonly list: KnowledgeIssueView[];
    private dropped;
    add(code: KnowledgeIssueCode, severity: 'info' | 'warn', path: string | null, id?: string | null, reason?: SourceErrorCode | null): void;
    /** Issues beyond the cap are not listed, so the result can no longer claim completeness. */
    finish(): KnowledgeIssueView[];
}
export declare function parseHypotheses(text: string, path: string): KnowledgeData;
/** One ADR file. `null` item = not shown (an issue says why). */
export declare function parseAdr(text: string, fileName: string, path: string, issues?: Issues): {
    item: KnowledgeItemView | null;
    issues: Issues;
};
export declare function readHypotheses(projectRoot: string, monolithRoot: string): Section<KnowledgeData>;
export declare function readDecisions(projectRoot: string): Section<KnowledgeData>;
export declare function readKnowledge(projectRoot: string, monolithRoot: string): {
    hypotheses: Section<KnowledgeData>;
    decisions: Section<KnowledgeData>;
};
//# sourceMappingURL=knowledge.d.ts.map