export type SemanticRelationshipType = 'relates-to' | 'part-of' | 'depends-on' | 'contrasts-with' | 'exemplifies' | 'extends';
/** Raw information input — the unit of ingestion. */
export interface Artifact {
    id: string;
    content: string;
    source?: string;
    createdAt: Date;
    tags?: string[];
}
/** A named semantic unit extracted from an Artifact. */
export interface Concept {
    id: string;
    label: string;
    /** Relative importance within this artifact (0–1). */
    weight: number;
    sourceArtifactId: string;
}
/** A directed semantic relationship between two Concepts. */
export interface SemanticLink {
    id: string;
    fromConceptId: string;
    toConceptId: string;
    relationshipType: SemanticRelationshipType;
    /** Confidence in the relationship (0–1). */
    strength: number;
}
/** A domain cluster grouping related Concepts. */
export interface KnowledgeRegion {
    id: string;
    name: string;
    description: string;
    conceptIds: string[];
}
/** A higher-order abstraction over a KnowledgeRegion. */
export interface MentalModel {
    id: string;
    name: string;
    regionId: string;
    /** Textual description of the inferred pattern. */
    pattern: string;
    /** Confidence in this model (0–1). */
    confidence: number;
}
/** Full output produced by analyzeArtifact(). */
export interface WebwayAnalysisResult {
    artifactId: string;
    concepts: Concept[];
    links: SemanticLink[];
    suggestedRegion: KnowledgeRegion;
    mentalModels: MentalModel[];
    analysisVersion: string;
}
//# sourceMappingURL=types.d.ts.map