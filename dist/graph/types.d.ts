import type { KnowledgeObject } from './identity.js';
import type { UnresolvedResolution } from './resolver.js';
/** A graph node is a canonical KnowledgeObject. There are no concept, alias or synthesized nodes. */
export type GraphNode = KnowledgeObject;
export interface GraphEdge {
    id: string;
    fromRef: string;
    toRef: string;
    relationshipType: string;
    provenance: 'explicit';
    evidenceIds: string[];
    sourceArtifactId: string;
    sourceLine?: number;
}
/** A relationship whose target did not resolve to exactly one object. No edge exists for it. */
export interface UnresolvedReference {
    fromRef: string;
    rawRef: string;
    relationshipType: string;
    resolution: UnresolvedResolution;
    sourceArtifactId: string;
    evidenceId: string;
    sourceLine?: number;
}
/** Two or more declarations claim the same `ref`. None of them becomes a node. */
export interface IdentityConflict {
    ref: string;
    candidates: KnowledgeObject[];
}
export interface GraphDiagnostic {
    severity: 'info' | 'warn' | 'error';
    message: string;
    artifactId?: string;
}
export interface ExplicitRelationshipGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
    unresolved: UnresolvedReference[];
    conflicts: IdentityConflict[];
    diagnostics: GraphDiagnostic[];
}
//# sourceMappingURL=types.d.ts.map