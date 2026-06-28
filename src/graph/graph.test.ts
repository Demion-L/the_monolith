import { describe, it, expect } from 'vitest';
import { buildGraph } from './builder.js';
import { normalizeLabel, selectCanonicalLabel } from './normalize.js';
import type { ScriptoriumResult, ConceptCandidate, RelationshipCandidate } from '../scriptorium/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConcept(id: string, label: string): ConceptCandidate {
  return { id, label, source: 'heading' };
}

function makeRel(id: string, fromLabel: string, toLabel: string, type = 'related'): RelationshipCandidate {
  return { id, fromLabel, toLabel, relationshipType: type, provenance: 'explicit' };
}

function makeResult(
  artifactId: string,
  concepts: ConceptCandidate[] = [],
  relationships: RelationshipCandidate[] = [],
  overrides: Partial<Pick<ScriptoriumResult, 'documentId' | 'documentTitle'>> = {},
): ScriptoriumResult {
  return { artifactId, concepts, relationships, evidence: [], sourceReferences: [], diagnostics: [], ...overrides };
}

function makeH1Concept(id: string, label: string): ConceptCandidate {
  return { id, label, source: 'heading', headingLevel: 1 };
}

// ---------------------------------------------------------------------------
// normalizeLabel
// ---------------------------------------------------------------------------

describe('normalizeLabel', () => {
  it('lowercases and trims', () => {
    expect(normalizeLabel('  Terra  ')).toBe('terra');
  });

  it('converts spaces to dashes', () => {
    expect(normalizeLabel('Graph Memex')).toBe('graph-memex');
  });

  it('collapses multiple spaces to a single dash', () => {
    expect(normalizeLabel('Graph  Memex')).toBe('graph-memex');
  });

  it('strips backtick formatting', () => {
    expect(normalizeLabel('`Terra`')).toBe('terra');
    expect(normalizeLabel('`ConceptCandidate`')).toBe('conceptcandidate');
  });

  it('strips link syntax and keeps label', () => {
    expect(normalizeLabel('[ADR-004](../adr/ADR-004.md)')).toBe('adr-004');
  });

  it('strips bold and italic markers', () => {
    expect(normalizeLabel('**Terra**')).toBe('terra');
    expect(normalizeLabel('_WEBWAY_')).toBe('webway');
  });

  it('collapses em-dash and special punctuation to single dash', () => {
    expect(normalizeLabel('ADR-004 — Scriptorium')).toBe('adr-004-scriptorium');
  });

  it('returns empty string for blank or formatting-only input', () => {
    expect(normalizeLabel('')).toBe('');
    expect(normalizeLabel('   ')).toBe('');
    expect(normalizeLabel('---')).toBe('');
  });

  it('produces the same slug for casing variants', () => {
    expect(normalizeLabel('Graph Memex')).toBe(normalizeLabel('graph memex'));
    expect(normalizeLabel('Graph Memex')).toBe(normalizeLabel('GRAPH MEMEX'));
  });
});

// ---------------------------------------------------------------------------
// selectCanonicalLabel
// ---------------------------------------------------------------------------

describe('selectCanonicalLabel', () => {
  it('returns the sole variant when only one', () => {
    expect(selectCanonicalLabel(['Terra'])).toBe('Terra');
  });

  it('prefers uppercase variant over lowercase', () => {
    expect(selectCanonicalLabel(['terra', 'Terra'])).toBe('Terra');
  });

  it('prefers title-case over all-lowercase', () => {
    expect(selectCanonicalLabel(['graph memex', 'Graph Memex'])).toBe('Graph Memex');
  });

  it('breaks ties by shorter label when title-case score is equal', () => {
    // Both are 100% title-cased words; shorter wins
    expect(selectCanonicalLabel(['Terra Platform', 'Terra'])).toBe('Terra');
  });

  it('breaks final ties alphabetically', () => {
    expect(selectCanonicalLabel(['Terra', 'Trunk'])).toBe('Terra');
  });

  it('returns empty string for empty array', () => {
    expect(selectCanonicalLabel([])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Empty / trivial input
// ---------------------------------------------------------------------------

describe('buildGraph — empty input', () => {
  it('returns empty graph with info diagnostic for empty array', () => {
    const graph = buildGraph([]);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.diagnostics.some(d => d.severity === 'info')).toBe(true);
  });

  it('returns empty graph for result with no concepts or relationships', () => {
    const graph = buildGraph([makeResult('art-1')]);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Node creation from concepts
// ---------------------------------------------------------------------------

describe('buildGraph — node creation', () => {
  it('creates one node per unique normalized label', () => {
    const result = makeResult('art-1', [
      makeConcept('c1', 'Terra'),
      makeConcept('c2', 'Graph Memex'),
    ]);
    const graph = buildGraph([result]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.map(n => n.id)).toContain('terra');
    expect(graph.nodes.map(n => n.id)).toContain('graph-memex');
  });

  it('node id is the normalized slug', () => {
    const result = makeResult('art-1', [makeConcept('c1', 'Graph Memex')]);
    const graph = buildGraph([result]);
    expect(graph.nodes[0].id).toBe('graph-memex');
  });

  it('node canonicalLabel preserves the original label', () => {
    const result = makeResult('art-1', [makeConcept('c1', 'Graph Memex')]);
    const graph = buildGraph([result]);
    expect(graph.nodes[0].canonicalLabel).toBe('Graph Memex');
  });

  it('node evidenceIds contains the concept candidate id', () => {
    const result = makeResult('art-1', [makeConcept('cid-42', 'Terra')]);
    const graph = buildGraph([result]);
    const terra = graph.nodes.find(n => n.id === 'terra');
    expect(terra?.evidenceIds).toContain('cid-42');
  });

  it('node sourceArtifacts contains the artifact id', () => {
    const result = makeResult('my-artifact', [makeConcept('c1', 'Terra')]);
    const graph = buildGraph([result]);
    expect(graph.nodes[0].sourceArtifacts).toContain('my-artifact');
  });

  it('synthesized is false for concept-derived nodes', () => {
    const result = makeResult('art-1', [makeConcept('c1', 'Terra')]);
    const graph = buildGraph([result]);
    expect(graph.nodes[0].synthesized).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Identity resolution — merging
// ---------------------------------------------------------------------------

describe('buildGraph — identity resolution', () => {
  it('merges identical labels from the same artifact into one node', () => {
    const result = makeResult('art-1', [
      makeConcept('c1', 'Terra'),
      makeConcept('c2', 'Terra'),
    ]);
    const graph = buildGraph([result]);
    expect(graph.nodes.filter(n => n.id === 'terra')).toHaveLength(1);
  });

  it('merged node collects all evidenceIds from duplicates', () => {
    const result = makeResult('art-1', [
      makeConcept('c1', 'Terra'),
      makeConcept('c2', 'Terra'),
    ]);
    const graph = buildGraph([result]);
    const terra = graph.nodes.find(n => n.id === 'terra')!;
    expect(terra.evidenceIds).toContain('c1');
    expect(terra.evidenceIds).toContain('c2');
  });

  it('merges case-insensitive label variants', () => {
    const result = makeResult('art-1', [
      makeConcept('c1', 'Terra'),
      makeConcept('c2', 'terra'),
    ]);
    const graph = buildGraph([result]);
    expect(graph.nodes.filter(n => n.id === 'terra')).toHaveLength(1);
    const terra = graph.nodes.find(n => n.id === 'terra')!;
    expect(terra.aliases.length).toBeGreaterThanOrEqual(1);
  });

  it('canonical label is the title-case variant when merging', () => {
    const result = makeResult('art-1', [
      makeConcept('c1', 'terra'),
      makeConcept('c2', 'Terra'),
    ]);
    const graph = buildGraph([result]);
    const terra = graph.nodes.find(n => n.id === 'terra')!;
    expect(terra.canonicalLabel).toBe('Terra');
  });

  it('merges whitespace-normalized variants', () => {
    const result = makeResult('art-1', [
      makeConcept('c1', 'Graph Memex'),
      makeConcept('c2', 'Graph  Memex'),
    ]);
    const graph = buildGraph([result]);
    expect(graph.nodes.filter(n => n.id === 'graph-memex')).toHaveLength(1);
  });

  it('merges markdown-stripped variants (backticks)', () => {
    const result = makeResult('art-1', [
      makeConcept('c1', 'Terra'),
      makeConcept('c2', '`Terra`'),
    ]);
    const graph = buildGraph([result]);
    expect(graph.nodes.filter(n => n.id === 'terra')).toHaveLength(1);
  });

  it('aliases contains non-canonical label variants', () => {
    const result = makeResult('art-1', [
      makeConcept('c1', 'graph memex'),
      makeConcept('c2', 'Graph Memex'),
    ]);
    const graph = buildGraph([result]);
    const node = graph.nodes.find(n => n.id === 'graph-memex')!;
    expect(node.canonicalLabel).toBe('Graph Memex');
    expect(node.aliases).toContain('graph memex');
  });

  it('emits info diagnostic when merging variants', () => {
    const result = makeResult('art-1', [
      makeConcept('c1', 'Terra'),
      makeConcept('c2', 'terra'),
    ]);
    const graph = buildGraph([result]);
    const mergeInfo = graph.diagnostics.find(d => d.message.includes('Merged'));
    expect(mergeInfo).toBeDefined();
    expect(mergeInfo?.severity).toBe('info');
  });
});

// ---------------------------------------------------------------------------
// Edges from relationships
// ---------------------------------------------------------------------------

describe('buildGraph — edges', () => {
  it('creates a graph edge for each relationship candidate', () => {
    const result = makeResult(
      'art-1',
      [makeConcept('c1', 'Terra'), makeConcept('c2', 'Graph Memex')],
      [makeRel('r1', 'Terra', 'Graph Memex', 'depends_on')],
    );
    const graph = buildGraph([result]);
    expect(graph.edges).toHaveLength(1);
  });

  it('edge provenance is always explicit', () => {
    const result = makeResult(
      'art-1',
      [makeConcept('c1', 'Terra'), makeConcept('c2', 'Graph Memex')],
      [makeRel('r1', 'Terra', 'Graph Memex')],
    );
    const graph = buildGraph([result]);
    expect(graph.edges[0].provenance).toBe('explicit');
  });

  it('edge fromNodeId and toNodeId are normalized slugs', () => {
    const result = makeResult(
      'art-1',
      [makeConcept('c1', 'Terra'), makeConcept('c2', 'Graph Memex')],
      [makeRel('r1', 'Terra', 'Graph Memex', 'depends_on')],
    );
    const graph = buildGraph([result]);
    expect(graph.edges[0].fromNodeId).toBe('terra');
    expect(graph.edges[0].toNodeId).toBe('graph-memex');
  });

  it('edge relationshipType is preserved from candidate', () => {
    const result = makeResult(
      'art-1',
      [makeConcept('c1', 'A'), makeConcept('c2', 'B')],
      [makeRel('r1', 'A', 'B', 'related_decisions')],
    );
    const graph = buildGraph([result]);
    expect(graph.edges[0].relationshipType).toBe('related_decisions');
  });

  it('edge evidenceIds contains the relationship candidate id', () => {
    const result = makeResult(
      'art-1',
      [makeConcept('c1', 'Terra'), makeConcept('c2', 'Graph Memex')],
      [makeRel('r-42', 'Terra', 'Graph Memex')],
    );
    const graph = buildGraph([result]);
    expect(graph.edges[0].evidenceIds).toContain('r-42');
  });

  it('edge sourceArtifactId is the artifact id', () => {
    const result = makeResult(
      'my-doc',
      [makeConcept('c1', 'A'), makeConcept('c2', 'B')],
      [makeRel('r1', 'A', 'B')],
    );
    const graph = buildGraph([result]);
    expect(graph.edges[0].sourceArtifactId).toBe('my-doc');
  });

  it('deduplicates identical (from, type, to, artifact) relationship pairs', () => {
    const result = makeResult(
      'art-1',
      [makeConcept('c1', 'A'), makeConcept('c2', 'B')],
      [makeRel('r1', 'A', 'B', 'related'), makeRel('r2', 'A', 'B', 'related')],
    );
    const graph = buildGraph([result]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].evidenceIds).toContain('r1');
    expect(graph.edges[0].evidenceIds).toContain('r2');
  });

  it('keeps separate edges for different relationship types between same nodes', () => {
    const result = makeResult(
      'art-1',
      [makeConcept('c1', 'A'), makeConcept('c2', 'B')],
      [makeRel('r1', 'A', 'B', 'related'), makeRel('r2', 'A', 'B', 'depends_on')],
    );
    const graph = buildGraph([result]);
    expect(graph.edges).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Placeholder (synthesized) nodes
// ---------------------------------------------------------------------------

describe('buildGraph — synthesized nodes', () => {
  it('creates a synthesized node when relationship target is not in any concept list', () => {
    const result = makeResult(
      'art-1',
      [makeConcept('c1', 'Terra')],
      [makeRel('r1', 'Terra', 'ADR-999', 'related_decisions')],
    );
    const graph = buildGraph([result]);
    const placeholder = graph.nodes.find(n => n.id === 'adr-999');
    expect(placeholder).toBeDefined();
    expect(placeholder?.synthesized).toBe(true);
  });

  it('synthesized node preserves the original toLabel as canonicalLabel', () => {
    const result = makeResult(
      'art-1',
      [makeConcept('c1', 'Terra')],
      [makeRel('r1', 'Terra', 'ADR-999', 'related')],
    );
    const graph = buildGraph([result]);
    const placeholder = graph.nodes.find(n => n.id === 'adr-999')!;
    expect(placeholder.canonicalLabel).toBe('ADR-999');
  });

  it('emits a warn diagnostic for unresolved relationship target', () => {
    const result = makeResult(
      'art-1',
      [makeConcept('c1', 'Terra')],
      [makeRel('r1', 'Terra', 'Missing-Concept')],
    );
    const graph = buildGraph([result]);
    const warnDiag = graph.diagnostics.find(d =>
      d.severity === 'warn' && d.message.includes('missing-concept'),
    );
    expect(warnDiag).toBeDefined();
  });

  it('creates a synthesized node for fromLabel not present in concepts', () => {
    const result = makeResult(
      'art-1',
      [],
      [makeRel('r1', 'My Doc Title', 'Terra', 'related')],
    );
    const graph = buildGraph([result]);
    const docNode = graph.nodes.find(n => n.id === 'my-doc-title');
    expect(docNode).toBeDefined();
    expect(docNode?.synthesized).toBe(true);
  });

  it('does not lose the edge when target node is synthesized', () => {
    const result = makeResult(
      'art-1',
      [makeConcept('c1', 'Terra')],
      [makeRel('r1', 'Terra', 'Unknown-Target')],
    );
    const graph = buildGraph([result]);
    const edge = graph.edges.find(e => e.toNodeId === 'unknown-target');
    expect(edge).toBeDefined();
    expect(edge?.evidenceIds).toContain('r1');
  });
});

// ---------------------------------------------------------------------------
// Multi-artifact graph
// ---------------------------------------------------------------------------

describe('buildGraph — multiple artifacts', () => {
  it('accumulates nodes from multiple artifacts', () => {
    const r1 = makeResult('art-1', [makeConcept('c1', 'Terra')]);
    const r2 = makeResult('art-2', [makeConcept('c2', 'Graph Memex')]);
    const graph = buildGraph([r1, r2]);
    expect(graph.nodes.map(n => n.id)).toContain('terra');
    expect(graph.nodes.map(n => n.id)).toContain('graph-memex');
  });

  it('accumulates edges from multiple artifacts', () => {
    const r1 = makeResult(
      'art-1',
      [makeConcept('c1', 'Terra'), makeConcept('c2', 'WEBWAY')],
      [makeRel('r1', 'Terra', 'WEBWAY')],
    );
    const r2 = makeResult(
      'art-2',
      [makeConcept('c3', 'Scriptorium'), makeConcept('c4', 'Terra')],
      [makeRel('r2', 'Scriptorium', 'Terra')],
    );
    const graph = buildGraph([r1, r2]);
    expect(graph.edges).toHaveLength(2);
  });

  it('node shared across artifacts collects all sourceArtifacts', () => {
    const r1 = makeResult('art-1', [makeConcept('c1', 'Terra')]);
    const r2 = makeResult('art-2', [makeConcept('c2', 'Terra')]);
    const graph = buildGraph([r1, r2]);
    const terra = graph.nodes.find(n => n.id === 'terra')!;
    expect(terra.sourceArtifacts).toContain('art-1');
    expect(terra.sourceArtifacts).toContain('art-2');
  });

  it('node shared across artifacts collects all evidenceIds', () => {
    const r1 = makeResult('art-1', [makeConcept('c-from-1', 'Terra')]);
    const r2 = makeResult('art-2', [makeConcept('c-from-2', 'Terra')]);
    const graph = buildGraph([r1, r2]);
    const terra = graph.nodes.find(n => n.id === 'terra')!;
    expect(terra.evidenceIds).toContain('c-from-1');
    expect(terra.evidenceIds).toContain('c-from-2');
  });

  it('same relationship from two different artifacts produces two edges', () => {
    const r1 = makeResult(
      'art-1',
      [makeConcept('c1', 'A'), makeConcept('c2', 'B')],
      [makeRel('r1', 'A', 'B', 'related')],
    );
    const r2 = makeResult(
      'art-2',
      [makeConcept('c3', 'A'), makeConcept('c4', 'B')],
      [makeRel('r2', 'A', 'B', 'related')],
    );
    const graph = buildGraph([r1, r2]);
    // Same from/type/to but different artifacts → two edges
    expect(graph.edges).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('buildGraph — determinism', () => {
  const fixture = [
    makeResult(
      'art-1',
      [makeConcept('c1', 'Terra'), makeConcept('c2', 'Graph Memex'), makeConcept('c3', 'terra')],
      [makeRel('r1', 'Terra', 'Graph Memex', 'depends_on')],
    ),
    makeResult(
      'art-2',
      [makeConcept('c4', 'WEBWAY'), makeConcept('c5', 'Terra')],
      [makeRel('r2', 'WEBWAY', 'Terra', 'related'), makeRel('r3', 'WEBWAY', 'Unknown', 'related')],
    ),
  ];

  it('produces identical JSON output for the same input', () => {
    const g1 = buildGraph(fixture);
    const g2 = buildGraph(fixture);
    expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
  });

  it('nodes are sorted by id', () => {
    const graph = buildGraph(fixture);
    const ids = graph.nodes.map(n => n.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it('edges are sorted by id', () => {
    const graph = buildGraph(fixture);
    const ids = graph.edges.map(e => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it('does not mutate input ScriptoriumResult objects', () => {
    const input = makeResult(
      'art-1',
      [makeConcept('c1', 'Terra')],
      [makeRel('r1', 'Terra', 'ADR-001')],
    );
    const original = JSON.stringify(input);
    buildGraph([input]);
    expect(JSON.stringify(input)).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Story 1.3.3 — canonical identity aliases
// ---------------------------------------------------------------------------

describe('buildGraph — canonical identity aliases (Story 1.3.3)', () => {
  it('registers documentId as an alias on the primary node', () => {
    const result = makeResult(
      'adr-004',
      [makeH1Concept('c1', 'ADR-004 — Terra vs Graph Memex')],
      [],
      { documentId: 'ADR-004', documentTitle: 'Terra vs Graph Memex' },
    );
    const graph = buildGraph([result]);
    const primaryNode = graph.nodes.find(n => n.id === 'adr-004-terra-vs-graph-memex');
    expect(primaryNode).toBeDefined();
    expect(primaryNode!.aliases).toContain('ADR-004');
  });

  it('registers documentTitle as an alias when it differs from the H1', () => {
    const result = makeResult(
      'adr-004',
      [makeH1Concept('c1', 'ADR-004 — Terra vs Graph Memex')],
      [],
      { documentId: 'ADR-004', documentTitle: 'Terra vs Graph Memex' },
    );
    const graph = buildGraph([result]);
    const primaryNode = graph.nodes.find(n => n.id === 'adr-004-terra-vs-graph-memex');
    expect(primaryNode!.aliases).toContain('Terra vs Graph Memex');
  });

  it('canonical label remains the H1 title, not the alias', () => {
    const result = makeResult(
      'adr-004',
      [makeH1Concept('c1', 'ADR-004 — Terra vs Graph Memex')],
      [],
      { documentId: 'ADR-004', documentTitle: 'Terra vs Graph Memex' },
    );
    const graph = buildGraph([result]);
    const primaryNode = graph.nodes.find(n => n.id === 'adr-004-terra-vs-graph-memex')!;
    expect(primaryNode.canonicalLabel).toBe('ADR-004 — Terra vs Graph Memex');
    expect(primaryNode.synthesized).toBe(false);
  });

  it('edge targeting documentId resolves to real node, not synthesized', () => {
    const adrResult = makeResult(
      'adr-004',
      [makeH1Concept('c1', 'ADR-004 — Terra vs Graph Memex')],
      [],
      { documentId: 'ADR-004', documentTitle: 'Terra vs Graph Memex' },
    );
    const refResult = makeResult(
      'other-doc',
      [makeH1Concept('c2', 'Other Document')],
      [makeRel('r1', 'Other Document', 'ADR-004', 'follow_up_adrs')],
    );
    const graph = buildGraph([adrResult, refResult]);

    const edge = graph.edges.find(e => e.toNodeId === 'adr-004-terra-vs-graph-memex');
    expect(edge).toBeDefined();

    const toNode = graph.nodes.find(n => n.id === 'adr-004-terra-vs-graph-memex')!;
    expect(toNode.synthesized).toBe(false);

    // No synthesized node should be created for 'adr-004'
    expect(graph.nodes.find(n => n.id === 'adr-004')).toBeUndefined();
  });

  it('edge fromLabel resolving via documentTitle uses real node', () => {
    // When docLabel (= documentTitle) differs from H1, fromLabel in relationships
    // resolves to the H1-based real node via alias, not a synthesized node.
    const adrResult = makeResult(
      'adr-004',
      [makeH1Concept('c1', 'ADR-004 — Terra vs Graph Memex')],
      [makeRel('r1', 'Terra vs Graph Memex', 'Other Concept', 'related_adrs')],
      { documentId: 'ADR-004', documentTitle: 'Terra vs Graph Memex' },
    );
    const targetResult = makeResult(
      'other',
      [makeH1Concept('c2', 'Other Concept')],
    );
    const graph = buildGraph([adrResult, targetResult]);

    const fromNode = graph.nodes.find(n => n.id === 'adr-004-terra-vs-graph-memex')!;
    expect(fromNode.synthesized).toBe(false);

    const edge = graph.edges.find(e => e.fromNodeId === 'adr-004-terra-vs-graph-memex');
    expect(edge).toBeDefined();
  });

  it('alias does not create an additional node', () => {
    const result = makeResult(
      'adr-004',
      [makeH1Concept('c1', 'ADR-004 — Terra vs Graph Memex')],
      [],
      { documentId: 'ADR-004', documentTitle: 'Terra vs Graph Memex' },
    );
    const graph = buildGraph([result]);
    // Only the primary node should exist; no separate nodes for the aliases
    expect(graph.nodes.filter(n => n.id === 'adr-004')).toHaveLength(0);
    expect(graph.nodes.filter(n => n.id === 'terra-vs-graph-memex')).toHaveLength(0);
    expect(graph.nodes.filter(n => n.id === 'adr-004-terra-vs-graph-memex')).toHaveLength(1);
  });

  it('alias is skipped when it is the same slug as the primary node', () => {
    // If documentTitle === H1 label (no frontmatter title override), no alias needed
    const result = makeResult(
      'adr-001',
      [makeH1Concept('c1', 'Memory Governance')],
      [],
      { documentId: 'memory-gov', documentTitle: 'Memory Governance' },
    );
    const graph = buildGraph([result]);
    const node = graph.nodes.find(n => n.id === 'memory-governance')!;
    // 'memory-gov' is a real alias (different slug), 'Memory Governance' is NOT added (same slug)
    expect(node.aliases).toContain('memory-gov');
    expect(node.aliases).not.toContain('Memory Governance');
  });

  it('alias collision: second document claiming same alias ID emits info and uses first', () => {
    const r1 = makeResult(
      'doc-a',
      [makeH1Concept('c1', 'Document A Long Title')],
      [],
      { documentId: 'ADR-004' },
    );
    const r2 = makeResult(
      'doc-b',
      [makeH1Concept('c2', 'Document B Long Title')],
      [],
      { documentId: 'ADR-004' },
    );
    const graph = buildGraph([r1, r2]);
    // Only one mapping for 'adr-004' alias — first document wins
    const collisionDiag = graph.diagnostics.find(d =>
      d.severity === 'info' && d.message.includes('collision'),
    );
    expect(collisionDiag).toBeDefined();
  });

  it('alias is skipped when the alias slug already exists as a real concept node', () => {
    // If some document creates a concept "ADR-004" as a heading, no alias override
    const headingResult = makeResult(
      'some-doc',
      [makeH1Concept('c-h', 'ADR-004')],
    );
    const adrResult = makeResult(
      'adr-doc',
      [makeH1Concept('c1', 'ADR-004 — Terra vs Graph Memex')],
      [],
      { documentId: 'ADR-004' },
    );
    const graph = buildGraph([headingResult, adrResult]);
    // 'adr-004' is a real node from the heading — alias registration skips it
    const adrNode = graph.nodes.find(n => n.id === 'adr-004')!;
    expect(adrNode).toBeDefined();
    expect(adrNode.synthesized).toBe(false);
    // The alias entry is not added to the primary node since real node took precedence
    const primaryNode = graph.nodes.find(n => n.id === 'adr-004-terra-vs-graph-memex')!;
    expect(primaryNode.aliases).not.toContain('ADR-004');
  });

  it('graph remains deterministic with aliases present', () => {
    const result = makeResult(
      'adr-004',
      [makeH1Concept('c1', 'ADR-004 — Terra vs Graph Memex')],
      [makeRel('r1', 'Terra vs Graph Memex', 'Terra', 'related_adrs')],
      { documentId: 'ADR-004', documentTitle: 'Terra vs Graph Memex' },
    );
    const g1 = buildGraph([result]);
    const g2 = buildGraph([result]);
    expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
  });
});
