/**
 * Finalization proposal (DOCSYNC-001): the typed, strictly validated input an
 * AI assistant or developer prepares. It carries the *content* of the
 * finalization; MONOLITH decides whether and where it may be applied.
 *
 * Validation is structural and syntactic only. Whether the content is *true*
 * (the summary matches the code) is the owner's judgement, taken when they
 * approve the plan digest — never something this module claims to check.
 */
export declare const PROPOSAL_SCHEMA_VERSION = 1;
/**
 * What the Current Story section of active.md must hold before the transition.
 * There is deliberately no "any": a proposal cannot switch the guard off and
 * silently replace somebody else's active story. `contains` must name the
 * story being finalized (checked in `parseProposal`).
 */
export type ExpectedCurrentStory = 'none' | {
    contains: string;
};
export interface FinalizationProposal {
    schemaVersion: 1;
    story: {
        /** Story identifier, e.g. `DOCSYNC-001` or `1.3`. Used as the idempotency key. */
        id: string;
        title: string;
        /** Phase directory name under `memory/working/phases/`, e.g. `phase-1`. */
        phase: string;
        /** Text of the `## ` heading in story-index.md the entry belongs to. */
        phaseHeading: string;
        /** Capsule file base name (without `.md`), e.g. `story-docsync-001-finalization`. */
        slug: string;
        /** `YYYY-MM-DD`. Supplied by the caller: MONOLITH never invents a finalization date. */
        date: string;
    };
    /** What the Current Story section of active.md must look like before the transition. */
    expectedCurrentStory: ExpectedCurrentStory;
    work: {
        objective: string;
        implementationSummary: string;
        filesChanged: string[];
        tests: string;
        keyDecisions: string;
        adrs: string[];
        lessons: string;
    };
    /** One-paragraph summary for story-index.md. */
    summary: string;
    keyOutputs: string[];
    history: {
        phaseName: string;
        decision: string;
        build: string;
    };
    /** Complete replacement of HANDOFF.md. Optional: omitted means HANDOFF.md is not touched. */
    handoff?: {
        content: string;
    };
    /** Extra documentation edits; each path must be allowed by `monolith.config.json` `finalization`. */
    docUpdates?: Array<{
        path: string;
        newContent: string;
        reason: string;
    }>;
}
export type ProposalParse = {
    ok: true;
    proposal: FinalizationProposal;
} | {
    ok: false;
    errors: string[];
};
export declare const LIMITS: {
    readonly idLen: 64;
    readonly titleLen: 200;
    readonly lineLen: 1000;
    readonly blockLen: 20000;
    readonly listItems: 200;
    readonly docUpdates: 20;
    readonly docBytes: number;
};
/** True when `text` has a token that merely CONTAINS `id` (e.g. S-10, XS-1, 1.10 for S-1/1.1): ambiguous. */
export declare function hasLookalikeIdToken(text: string, id: string): boolean;
/**
 * True when `text` holds `id` as a whole Story ID token (case-insensitive).
 * Tokens are maximal runs of the Story ID alphabet [A-Za-z0-9._-]; trailing
 * `.`/`_`/`-` (sentence punctuation) are dropped. So `S-1` is a token of
 * "S-1 in progress" or "(S-1)", but never of "S-10", "XS-1", "1.10" or "11.1".
 */
export declare function hasStoryIdToken(text: string, id: string): boolean;
export declare function validDate(s: string): boolean;
/**
 * Lexical validation of a project-relative document path (R4). Rejects
 * absolute paths, `..`, backslashes, NUL, empty segments and VCS internals.
 * Symlinks are NOT decided here: they are refused by the safe read/write
 * primitives, which look at the real file system.
 */
export declare function validateRelPath(p: unknown): string | null;
export declare function parseProposal(raw: unknown): ProposalParse;
//# sourceMappingURL=proposal.d.ts.map