import type { ScriptoriumResult } from '../scriptorium/types.js';
import type {
  ExplicitRelationshipGraph,
  GraphEdge,
  GraphDiagnostic,
  IdentityConflict,
  UnresolvedReference,
} from './types.js';
import type { KnowledgeObject } from './identity.js';
import { compareObjects, isValidIdentifier, makeRef } from './identity.js';
import { buildObjectIndex, resolveRef } from './resolver.js';

/**
 * Builds the explicit relationship graph.
 *
 * Nodes are KnowledgeObjects declared by Scriptorium (document `id:` and `{#ID}` sections).
 * Concepts are not nodes. An edge exists only when its target resolves (RESOLVED) from a
 * source that itself has a unique canonical identity. Output is independent of input order.
 */
export function buildGraph(results: ScriptoriumResult[]): ExplicitRelationshipGraph {
  if (results.length === 0) {
    return {
      nodes: [],
      edges: [],
      unresolved: [],
      conflicts: [],
      diagnostics: [{ severity: 'info', message: 'No ScriptoriumResult inputs provided — graph is empty.' }],
    };
  }

  const diagnostics: GraphDiagnostic[] = [];
  const ordered = [...results].sort(
    (a, b) => cmp(a.artifactId, b.artifactId) || cmp(a.sourcePath ?? '', b.sourcePath ?? ''),
  );

  // --- Pass 1: validate declarations into KnowledgeObjects ---

  const declared: KnowledgeObject[] = [];
  const documentOf = new Map<ScriptoriumResult, string>(); // result → document ref
  const loadedNamespaces = new Set<string>();

  for (const result of ordered) {
    const { artifactId } = result;
    const namespace = result.namespace;

    if (namespace === undefined || !isValidIdentifier(namespace)) {
      if (result.declarations.length > 0 || result.relationships.length > 0) {
        diagnostics.push({
          severity: 'error',
          message:
            namespace === undefined
              ? 'Artifact has no namespace; its declarations and relationships cannot be given a canonical identity'
              : `Invalid namespace "${namespace}"; its declarations and relationships cannot be given a canonical identity`,
          artifactId,
        });
      }
      continue;
    }
    loadedNamespaces.add(namespace);

    for (const decl of result.declarations) {
      if (!isValidIdentifier(decl.localId)) {
        diagnostics.push({
          severity: 'error',
          message: `Invalid local id "${decl.localId}" in ${decl.kind} declaration; object ignored`,
          artifactId,
        });
        continue;
      }
      const obj: KnowledgeObject = {
        ref: makeRef(namespace, decl.localId),
        namespace,
        localId: decl.localId,
        kind: decl.kind,
        ...(decl.title !== undefined ? { title: decl.title } : {}),
        ...(decl.status !== undefined ? { status: decl.status } : {}),
        location: {
          artifactId,
          path: result.sourcePath ?? artifactId,
          ...(decl.sourceLine !== undefined ? { line: decl.sourceLine } : {}),
        },
      };
      declared.push(obj);
      if (decl.kind === 'document' && !documentOf.has(result)) documentOf.set(result, obj.ref);
    }
  }

  // --- Pass 2: uniqueness. A ref held by more than one object is a conflict, never a node. ---

  const index = buildObjectIndex(declared, loadedNamespaces);
  const nodes: KnowledgeObject[] = [];
  const conflicts: IdentityConflict[] = [];

  for (const [ref, list] of index.byRef) {
    if (list.length === 1) {
      nodes.push(list[0]);
    } else {
      conflicts.push({ ref, candidates: [...list] });
      diagnostics.push({
        severity: 'error',
        message: `Identity conflict: ${list.length} objects declare "${ref}" (${list
          .map(o => `${o.location.artifactId}${o.location.line !== undefined ? `:${o.location.line}` : ''}`)
          .join(', ')}); none is resolvable`,
      });
    }
  }
  nodes.sort(compareObjects);
  conflicts.sort((a, b) => cmp(a.ref, b.ref));

  // --- Pass 3: relationships → edges (RESOLVED only) ---

  const edges: GraphEdge[] = [];
  const edgeDedup = new Map<string, number>();
  const unresolved: UnresolvedReference[] = [];

  for (const result of ordered) {
    if (result.relationships.length === 0) continue;

    const fromRef = documentOf.get(result);
    const fromOk = fromRef !== undefined && index.byRef.get(fromRef)?.length === 1;
    if (!fromOk) {
      if (result.namespace !== undefined && isValidIdentifier(result.namespace)) {
        diagnostics.push({
          severity: 'warn',
          message:
            fromRef === undefined
              ? `Artifact declares no document id; ${result.relationships.length} relationship(s) have no canonical source and create no edges`
              : `Document "${fromRef}" is in an identity conflict; ${result.relationships.length} relationship(s) create no edges`,
          artifactId: result.artifactId,
        });
      }
      continue;
    }

    for (const rel of result.relationships) {
      const resolution = resolveRef(rel.toLabel, result.namespace!, index);

      if (resolution.status !== 'RESOLVED') {
        unresolved.push({
          fromRef,
          rawRef: rel.toLabel,
          relationshipType: rel.relationshipType,
          resolution,
          sourceArtifactId: result.artifactId,
          evidenceId: rel.id,
          ...(rel.sourceLine !== undefined ? { sourceLine: rel.sourceLine } : {}),
        });
        continue;
      }

      const toRef = resolution.object.ref;
      const key = `${fromRef}|${rel.relationshipType}|${toRef}|${result.artifactId}`;
      const existing = edgeDedup.get(key);
      if (existing !== undefined) {
        edges[existing].evidenceIds.push(rel.id);
      } else {
        edgeDedup.set(key, edges.length);
        edges.push({
          id: key,
          fromRef,
          toRef,
          relationshipType: rel.relationshipType,
          provenance: 'explicit',
          evidenceIds: [rel.id],
          sourceArtifactId: result.artifactId,
          ...(rel.sourceLine !== undefined ? { sourceLine: rel.sourceLine } : {}),
        });
      }
    }
  }

  edges.sort((a, b) => cmp(a.id, b.id));
  unresolved.sort(
    (a, b) =>
      cmp(a.sourceArtifactId, b.sourceArtifactId) ||
      cmp(a.evidenceId, b.evidenceId) ||
      cmp(a.rawRef, b.rawRef),
  );

  return { nodes, edges, unresolved, conflicts, diagnostics };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
