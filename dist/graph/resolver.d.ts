import type { KnowledgeObject } from './identity.js';
/**
 * Deterministic reference resolution. No fuzzy matching, no title matching,
 * no LLM, no first-wins: a ref resolves only when exactly one object holds it.
 */
export interface ObjectIndex {
    /** Every declared object by ref. More than one entry means an identity conflict. */
    byRef: ReadonlyMap<string, readonly KnowledgeObject[]>;
    /** Namespaces for which at least one artifact was provided as input. */
    loadedNamespaces: ReadonlySet<string>;
}
export type Resolution = {
    status: 'RESOLVED';
    ref: string;
    object: KnowledgeObject;
} | {
    status: 'MISSING';
    ref: string;
} | {
    status: 'AMBIGUOUS';
    ref: string;
    candidates: KnowledgeObject[];
} | {
    status: 'EXTERNAL_UNAVAILABLE';
    ref: string;
    namespace: string;
} | {
    status: 'INVALID_REF';
    raw: string;
    reason: string;
};
export type UnresolvedResolution = Exclude<Resolution, {
    status: 'RESOLVED';
}>;
export declare function buildObjectIndex(objects: readonly KnowledgeObject[], loadedNamespaces: Iterable<string>): ObjectIndex;
/**
 * @param raw             reference text as written in the source artifact
 * @param sourceNamespace namespace of the artifact containing the reference
 */
export declare function resolveRef(raw: string, sourceNamespace: string, index: ObjectIndex): Resolution;
//# sourceMappingURL=resolver.d.ts.map