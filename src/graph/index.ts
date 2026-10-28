export type {
  GraphNode,
  GraphEdge,
  GraphDiagnostic,
  ExplicitRelationshipGraph,
  UnresolvedReference,
  IdentityConflict,
} from './types.js';
export type { KnowledgeObject, KnowledgeObjectKind, ParsedRef } from './identity.js';
export { makeRef, parseRef, isValidIdentifier } from './identity.js';
export type { Resolution, UnresolvedResolution, ObjectIndex } from './resolver.js';
export { buildObjectIndex, resolveRef } from './resolver.js';
export { buildGraph } from './builder.js';
