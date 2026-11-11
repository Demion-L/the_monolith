/**
 * Independent knowledge attribution (KA-001).
 *
 * A project may keep knowledge that belongs to no work item — a strategy
 * paper, a vision note — without that being "unattributed activity" and
 * without pretending it is part of the active story. The registration is an
 * idea of the Idea Store (`IDEA-NNN`) that declares the artifact's `paths`.
 *
 * A commit is attributed to independent knowledge only when ALL hold:
 *   1. its subject names no work item (a work item keeps its own semantics);
 *   2. it names at least one `IDEA-NNN` that is a valid idea file **in the
 *      tree of that very commit** (so registering an idea later never
 *      legalises older commits, and a commit that registers or edits the idea
 *      is itself never attributed — its own files are not covered);
 *   3. the ideas it names declare `paths`, every declared path passes the
 *      attribution policy (exact document files only — no directory prefixes, no
 *      source code, nothing inside the MONOLITH root; `attributionPathProblem`),
 *      and EVERY file the commit changed (other than state documents) is covered
 *      by those paths;
 *   4. no changed file lies inside the MONOLITH root;
 *   5. it names at most MAX_IDEA_IDS_PER_COMMIT ideas, and the run stays inside a
 *      fixed budget of blob reads (each read is a git subprocess).
 * Attribution only EXPLAINS a commit. It is not approval: a registered, correctly
 * attributed change may still be wrong or unreviewed.
 * Anything else stays exactly what it was: unattributed activity. Nothing here
 * activates a story, touches the roadmap or marks anything done; it only
 * decides whether a commit is *explained*. No LLM, no network, read-only git.
 */
import type { GitSignals } from './freshness.js';
export interface KnowledgeAttribution {
    /** Idea ids named in the subject that were valid in the commit's tree. */
    ideaIds: string[];
    /** The paths those ideas declared (what the attribution rests on), in declaration order, without repeats. */
    paths: string[];
}
export interface KnowledgeRejection {
    /** One short reason a person can check. */
    reason: string;
}
export interface KnowledgeEvidence {
    /** Commit sha → attribution. Only commits that satisfied every rule. */
    attributed: ReadonlyMap<string, KnowledgeAttribution>;
    /** Commit sha → why a commit that NAMED an idea was not attributed. */
    rejected: ReadonlyMap<string, KnowledgeRejection>;
}
export declare const EMPTY_KNOWLEDGE: KnowledgeEvidence;
/** Upper bound of commits examined; beyond it the rest simply stay unattributed. */
export declare const MAX_KNOWLEDGE_COMMITS = 200;
/** A subject naming more ideas than this is refused without any git call (A4-SEC-05). */
export declare const MAX_IDEA_IDS_PER_COMMIT = 8;
/** Total blob reads (git subprocesses) per run; beyond it commits stay unattributed. */
export declare const MAX_KNOWLEDGE_BLOB_READS = 64;
export declare function ideaIdsInSubject(subject: string): string[];
/** Reads `relPath` as of commit `sha`; null when it does not exist there (or cannot be read). */
export type BlobReader = (sha: string, relPath: string) => string | null;
export declare function attributeKnowledge(git: GitSignals, opts: {
    monolithRoot: string;
    stateFiles: ReadonlySet<string>;
    readBlob: BlobReader;
    hasWorkItem: (subject: string) => boolean;
}): KnowledgeEvidence;
//# sourceMappingURL=knowledge.d.ts.map