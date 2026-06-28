export type ConceptSource = 'heading' | 'frontmatter' | 'list-item' | 'link-label';
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export interface ConceptCandidate {
    id: string;
    label: string;
    source: ConceptSource;
    headingLevel?: HeadingLevel;
    sourceLine?: number;
}
export interface RelationshipCandidate {
    id: string;
    fromLabel: string;
    toLabel: string;
    relationshipType: string;
    provenance: 'explicit';
    sourceField?: string;
    sourceLine?: number;
}
export type EvidenceSource = 'frontmatter' | 'list-item' | 'code-block';
export interface Evidence {
    id: string;
    content: string;
    source: EvidenceSource;
    language?: string;
    key?: string;
    sourceLine?: number;
}
export interface SourceReference {
    id: string;
    label: string;
    target: string;
    sourceLine?: number;
}
export interface ScriptoriumDiagnostic {
    severity: 'info' | 'warn' | 'error';
    message: string;
    sourceLine?: number;
}
export interface ScriptoriumResult {
    artifactId: string;
    /** Canonical short-form identifier from frontmatter `id:` (e.g. "ADR-004", "R-0001"). */
    documentId?: string;
    /** Resolved display title used as fromLabel in relationships (frontmatter title → H1 → artifactId). */
    documentTitle?: string;
    concepts: ConceptCandidate[];
    relationships: RelationshipCandidate[];
    evidence: Evidence[];
    sourceReferences: SourceReference[];
    diagnostics: ScriptoriumDiagnostic[];
}
export interface ScriptoriumInput {
    id: string;
    title?: string;
    content: string;
    sourcePath?: string;
}
//# sourceMappingURL=types.d.ts.map