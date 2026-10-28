import type { ScriptoriumResult } from '../scriptorium/types.js';
import type { ExplicitRelationshipGraph } from './types.js';
/**
 * Builds the explicit relationship graph.
 *
 * Nodes are KnowledgeObjects declared by Scriptorium (document `id:` and `{#ID}` sections).
 * Concepts are not nodes. An edge exists only when its target resolves (RESOLVED) from a
 * source that itself has a unique canonical identity. Output is independent of input order.
 */
export declare function buildGraph(results: ScriptoriumResult[]): ExplicitRelationshipGraph;
//# sourceMappingURL=builder.d.ts.map