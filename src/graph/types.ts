export interface GraphNode {
  id: string;
  canonicalLabel: string;
  aliases: string[];
  evidenceIds: string[];
  sourceArtifacts: string[];
  synthesized: boolean;
}

export interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: string;
  provenance: 'explicit';
  evidenceIds: string[];
  sourceArtifactId: string;
}

export interface GraphDiagnostic {
  severity: 'info' | 'warn' | 'error';
  message: string;
  artifactId?: string;
}

export interface ExplicitRelationshipGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  diagnostics: GraphDiagnostic[];
}
