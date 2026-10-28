/**
 * Canonical Knowledge Identity.
 *
 * ref = namespace:localId. Neither part is derived from a title, a path or a slug:
 * namespace is supplied by the caller, localId is declared in the artifact
 * (frontmatter `id:` or a `{#ID}` heading marker). Identifiers are case-sensitive.
 */
export type KnowledgeObjectKind = 'document' | 'section';
export interface KnowledgeObject {
    ref: string;
    namespace: string;
    localId: string;
    kind: KnowledgeObjectKind;
    title?: string;
    status?: string;
    location: {
        artifactId: string;
        path: string;
        line?: number;
    };
}
export declare function isValidIdentifier(value: string): boolean;
export declare function makeRef(namespace: string, localId: string): string;
export type ParsedRef = {
    ok: true;
    qualified: boolean;
    namespace?: string;
    localId: string;
} | {
    ok: false;
    reason: string;
};
/** Syntactic parse only; whether the ref resolves is the resolver's concern. */
export declare function parseRef(raw: string): ParsedRef;
/** Total order used for every candidate list, so output never depends on input order. */
export declare function compareObjects(a: KnowledgeObject, b: KnowledgeObject): number;
//# sourceMappingURL=identity.d.ts.map