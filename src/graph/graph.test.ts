import { describe, it, expect } from 'vitest';
import { buildGraph } from './builder.js';
import { buildObjectIndex, resolveRef } from './resolver.js';
import { parseRef, makeRef } from './identity.js';
import { compileMarkdownArtifact } from '../scriptorium/compile.js';
import type { ScriptoriumInput } from '../scriptorium/types.js';
import type { ExplicitRelationshipGraph } from './types.js';

// ---------------------------------------------------------------------------
// Synthetic fixtures — compiled through the real Scriptorium so the
// Scriptorium → ERG boundary is exercised end to end.
// ---------------------------------------------------------------------------

function doc(
  id: string,
  opts: { ns?: string; fm?: string[]; body?: string; path?: string; docId?: string | null } = {},
): ScriptoriumInput {
  const fm: string[] = [];
  if (opts.docId !== null) fm.push(`id: ${opts.docId ?? id}`);
  fm.push(...(opts.fm ?? []));
  const content = `---\n${fm.join('\n')}\n---\n${opts.body ?? ''}`;
  return { id: `art-${id}`, content, namespace: opts.ns ?? 'p', sourcePath: opts.path ?? `docs/${id}.md` };
}

function build(inputs: ScriptoriumInput[]): ExplicitRelationshipGraph {
  return buildGraph(inputs.map(compileMarkdownArtifact));
}

const refs = (g: ExplicitRelationshipGraph) => g.nodes.map(n => n.ref);

// ---------------------------------------------------------------------------
// Identity model
// ---------------------------------------------------------------------------

describe('canonical identity', () => {
  it('ref = namespace:localId and carries kind, title, status, location', () => {
    const g = build([doc('A', { fm: ['title: Alpha', 'status: accepted'], path: 'docs/a.md' })]);
    expect(g.nodes).toEqual([
      {
        ref: 'p:A',
        namespace: 'p',
        localId: 'A',
        kind: 'document',
        title: 'Alpha',
        status: 'accepted',
        location: { artifactId: 'art-A', path: 'docs/a.md', line: 1 },
      },
    ]);
  });

  it('identity does not depend on the title', () => {
    const a = build([doc('A', { fm: ['title: Before'] })]);
    const b = build([doc('A', { fm: ['title: After'] })]);
    expect(refs(a)).toEqual(refs(b));
    expect(a.nodes[0].title).not.toBe(b.nodes[0].title);
  });

  it('identity does not depend on the path (moving a file keeps the ref)', () => {
    const before = build([doc('A', { path: 'docs/old/a.md' })]);
    const after = build([doc('A', { path: 'docs/new/place/a.md' })]);
    expect(refs(before)).toEqual(refs(after));
    expect(before.nodes[0].location.path).not.toBe(after.nodes[0].location.path);
  });

  it('identity does not depend on the H1 heading', () => {
    const a = build([doc('A', { body: '# One name\n' })]);
    const b = build([doc('A', { body: '# Another name\n' })]);
    expect(refs(a)).toEqual(refs(b));
  });

  it('namespace comes from the caller, never from the id or a slug', () => {
    const g = build([doc('a-b', { ns: 'x' }), doc('b', { ns: 'x-a' })]);
    expect(refs(g)).toEqual(['x-a:b', 'x:a-b']);
    expect(g.conflicts).toEqual([]);
  });

  it('same localId in different namespaces are distinct objects, not a conflict', () => {
    const g = build([doc('A', { ns: 'one' }), doc('A', { ns: 'two' })]);
    expect(refs(g)).toEqual(['one:A', 'two:A']);
    expect(g.conflicts).toEqual([]);
  });

  it('artifact without namespace gets no identity and reports an error', () => {
    const input = doc('A');
    delete input.namespace;
    const g = build([input]);
    expect(g.nodes).toEqual([]);
    expect(g.diagnostics.some(d => d.severity === 'error' && /namespace/.test(d.message))).toBe(true);
  });

  it('artifact without frontmatter id declares no document object', () => {
    const g = build([doc('A', { docId: null, body: '# Heading only\n' })]);
    expect(g.nodes).toEqual([]);
  });

  it('invalid local id is rejected with an error and creates no object', () => {
    const g = build([doc('A', { docId: 'a:b' }), doc('B', { docId: 'has space' })]);
    expect(g.nodes).toEqual([]);
    expect(g.diagnostics.filter(d => d.severity === 'error')).toHaveLength(2);
  });

  it('concepts are still extracted by Scriptorium but never become objects', () => {
    const input = doc('A', { body: '# Graph Memex\n\n## Terra\n\n- Webway\n' });
    const result = compileMarkdownArtifact(input);
    expect(result.concepts.map(c => c.label)).toEqual(['Graph Memex', 'Terra', 'Webway']);
    expect(refs(buildGraph([result]))).toEqual(['p:A']);
  });
});

// ---------------------------------------------------------------------------
// Section identity
// ---------------------------------------------------------------------------

describe('section identity', () => {
  const body = '# Doc\n\n## Первая гипотеза {#HYP-001}\n\ntext\n\n## Second one {#HYP-002}\n';

  it('{#ID} marker declares a section object with ref namespace:ID', () => {
    const g = build([doc('D', { body })]);
    const s = g.nodes.filter(n => n.kind === 'section');
    expect(s.map(n => n.ref)).toEqual(['p:HYP-001', 'p:HYP-002']);
    expect(s[0].title).toBe('Первая гипотеза');
    expect(s[0].location.artifactId).toBe('art-D');
    expect(s[0].location.line).toBeDefined();
  });

  it('sections have independent IDs from the document and from each other', () => {
    const g = build([doc('D', { body })]);
    expect(new Set(refs(g)).size).toBe(3);
  });

  it('renaming the heading keeps the ref', () => {
    const a = build([doc('D', { body: '## Old title {#HYP-001}\n' })]);
    const b = build([doc('D', { body: '## Completely new title {#HYP-001}\n' })]);
    expect(refs(a)).toEqual(refs(b));
  });

  it('moving the section to another file or line keeps the ref', () => {
    const a = build([doc('D', { body: '## T {#HYP-001}\n' })]);
    const b = build([doc('E', { body: '\n\n\n\n## T {#HYP-001}\n', path: 'elsewhere/e.md' })]);
    expect(refs(a).filter(r => r === 'p:HYP-001')).toEqual(refs(b).filter(r => r === 'p:HYP-001'));
  });

  it('the marker is not part of the concept label', () => {
    const r = compileMarkdownArtifact(doc('D', { body: '## Name {#HYP-001}\n' }));
    expect(r.concepts.map(c => c.label)).toEqual(['Name']);
  });

  it('a section can be the target of an edge', () => {
    const g = build([
      doc('D', { body: '## S {#HYP-001}\n' }),
      doc('E', { fm: ['related_hypotheses: [HYP-001]'] }),
    ]);
    expect(g.edges.map(e => [e.fromRef, e.toRef])).toEqual([['p:E', 'p:HYP-001']]);
  });
});

// ---------------------------------------------------------------------------
// ERG-000 defects (each failed on the concept-slug model)
// ---------------------------------------------------------------------------

describe('ERG-000 defect regressions', () => {
  it('identical H1 in different documents does not merge them', () => {
    const g = build([doc('A', { body: '# Overview of things\n' }), doc('B', { body: '# Overview of things\n' })]);
    expect(refs(g)).toEqual(['p:A', 'p:B']);
  });

  it('duplicate ids are a conflict, not first-wins; nobody is resolvable', () => {
    const g = build([
      doc('X1', { docId: 'DUP', path: 'a.md' }),
      doc('X2', { docId: 'DUP', path: 'b.md' }),
      doc('S', { fm: ['references: [DUP]'] }),
    ]);
    expect(g.nodes.map(n => n.ref)).toEqual(['p:S']);
    expect(g.conflicts).toHaveLength(1);
    expect(g.conflicts[0].ref).toBe('p:DUP');
    expect(g.conflicts[0].candidates.map(c => c.location.path)).toEqual(['a.md', 'b.md']);
    expect(g.edges).toEqual([]);
    expect(g.unresolved).toHaveLength(1);
    expect(g.unresolved[0].resolution.status).toBe('AMBIGUOUS');
  });

  it('a section id that duplicates a document id is a conflict', () => {
    const g = build([doc('A'), doc('B', { body: '## Sneaky {#A}\n' })]);
    expect(g.conflicts.map(c => c.ref)).toEqual(['p:A']);
    expect(refs(g)).toEqual(['p:B']);
  });

  it('two sections with the same id in one document are a conflict', () => {
    const g = build([doc('A', { body: '## One {#S1}\n## Two {#S1}\n' })]);
    expect(g.conflicts.map(c => c.ref)).toEqual(['p:S1']);
  });

  it("another document's heading cannot shadow a declared id", () => {
    const g = build([
      doc('ADR-004'),
      doc('Other', { body: '# ADR-004\n' }),
      doc('Src', { fm: ['related_adrs: [ADR-004]'] }),
    ]);
    expect(g.edges.map(e => e.toRef)).toEqual(['p:ADR-004']);
    expect(g.edges[0].toRef).not.toBe('p:Other');
  });

  it("a document title equal to another's id does not create an alias", () => {
    const g = build([
      doc('A', { fm: ['title: B'] }),
      doc('B'),
      doc('Src', { fm: ['references: [B]'] }),
    ]);
    expect(g.edges.map(e => e.toRef)).toEqual(['p:B']);
  });

  it('result does not depend on input order (including ambiguity)', () => {
    const inputs = [
      doc('A', { fm: ['references: [DUP, B, ext:Z, bad id]'] }),
      doc('B', { body: '## S {#S1}\n' }),
      doc('X1', { docId: 'DUP', path: 'x1.md' }),
      doc('X2', { docId: 'DUP', path: 'x2.md' }),
    ];
    const forward = JSON.stringify(build(inputs));
    expect(JSON.stringify(build([...inputs].reverse()))).toBe(forward);
    expect(JSON.stringify(build([inputs[2], inputs[0], inputs[3], inputs[1]]))).toBe(forward);
  });

  it('namespace collision: unqualified ids never leak across namespaces', () => {
    const g = build([
      doc('T', { ns: 'one' }),
      doc('Src', { ns: 'two', fm: ['references: [T]'] }),
    ]);
    expect(g.edges).toEqual([]);
    expect(g.unresolved[0].resolution).toEqual({ status: 'MISSING', ref: 'two:T' });
  });

  it('H7: a reference resolves to the declared H7 object only', () => {
    const g = build([
      doc('Hyps', { body: '## Seventh {#H7}\n## Eighth {#H8}\n' }),
      doc('Noise', { body: '# H7 and friends\n\n- H7\n' }),
      doc('Src', { fm: ['related_hypotheses: [H7, h7, H70]'] }),
    ]);
    expect(g.edges.map(e => e.toRef)).toEqual(['p:H7']);
    expect(g.unresolved.map(u => u.resolution.status)).toEqual(['MISSING', 'MISSING']);
    expect(g.unresolved.map(u => u.rawRef)).toEqual(['h7', 'H70']);
  });

  it('malformed qualified ids are INVALID_REF and create no edge', () => {
    const g = build([
      doc('A'),
      doc('Src', { fm: ['references: ["p:", ":A", "p:A:B", "Graph Memex", "p:a b"]'] }),
    ]);
    expect(g.edges).toEqual([]);
    expect(g.unresolved.map(u => u.resolution.status)).toEqual(Array(5).fill('INVALID_REF'));
  });

  it('missing local target is MISSING, not a synthetic node', () => {
    const g = build([doc('Src', { fm: ['references: [Nope]'] })]);
    expect(g.nodes.map(n => n.ref)).toEqual(['p:Src']);
    expect(g.edges).toEqual([]);
    expect(g.unresolved[0].resolution).toEqual({ status: 'MISSING', ref: 'p:Nope' });
  });

  it('unknown external namespace is EXTERNAL_UNAVAILABLE, not a missing local object', () => {
    const g = build([doc('Src', { fm: ['references: [webway:H1]'] })]);
    expect(g.edges).toEqual([]);
    expect(g.unresolved[0].resolution).toEqual({
      status: 'EXTERNAL_UNAVAILABLE',
      ref: 'webway:H1',
      namespace: 'webway',
    });
  });

  it('a qualified ref into a loaded foreign namespace resolves', () => {
    const g = build([doc('T', { ns: 'one' }), doc('Src', { ns: 'two', fm: ['references: [one:T]'] })]);
    expect(g.edges.map(e => [e.fromRef, e.toRef])).toEqual([['two:Src', 'one:T']]);
  });
});

// ---------------------------------------------------------------------------
// No synthetic nodes, edge rules
// ---------------------------------------------------------------------------

describe('edges', () => {
  it('has no synthetic nodes: every edge endpoint is a declared node', () => {
    const g = build([
      doc('A', { fm: ['references: [B, Missing, ext:Q]', 'depends_on: [B]'] }),
      doc('B'),
    ]);
    const nodeRefs = new Set(refs(g));
    for (const e of g.edges) {
      expect(nodeRefs.has(e.fromRef)).toBe(true);
      expect(nodeRefs.has(e.toRef)).toBe(true);
    }
    expect(g.nodes.every(n => !('synthesized' in n))).toBe(true);
    expect(g.edges).toHaveLength(2);
    expect(g.unresolved).toHaveLength(2);
  });

  it('edge carries type, explicit provenance, evidence, artifact and source line', () => {
    const g = build([doc('A', { fm: ['references: [B]'] }), doc('B')]);
    expect(g.edges[0]).toMatchObject({
      id: 'p:A|references|p:B|art-A',
      relationshipType: 'references',
      provenance: 'explicit',
      evidenceIds: ['art-A-rel-0'],
      sourceArtifactId: 'art-A',
      sourceLine: 2,
    });
  });

  it('deduplicates identical (from, type, to, artifact) and merges evidence', () => {
    const g = build([doc('A', { fm: ['references: [B, B]'] }), doc('B')]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].evidenceIds).toHaveLength(2);
  });

  it('keeps separate edges for different relationship types', () => {
    const g = build([doc('A', { fm: ['references: [B]', 'depends_on: [B]'] }), doc('B')]);
    expect(g.edges.map(e => e.relationshipType)).toEqual(['depends_on', 'references']);
  });

  it('relationships from an artifact without a document id create no edges', () => {
    const g = build([doc('A', { docId: null, fm: ['references: [B]'] }), doc('B')]);
    expect(g.edges).toEqual([]);
    expect(g.diagnostics.some(d => d.severity === 'warn')).toBe(true);
  });

  it('relationships from a conflicted document create no edges', () => {
    const g = build([doc('A1', { docId: 'D', fm: ['references: [B]'] }), doc('A2', { docId: 'D' }), doc('B')]);
    expect(g.edges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Graph basics
// ---------------------------------------------------------------------------

describe('buildGraph basics', () => {
  it('returns an empty graph with an info diagnostic for no input', () => {
    const g = buildGraph([]);
    expect(g).toMatchObject({ nodes: [], edges: [], unresolved: [], conflicts: [] });
    expect(g.diagnostics[0].severity).toBe('info');
  });

  it('is deterministic and sorted', () => {
    const inputs = [doc('C'), doc('A', { fm: ['references: [C]'] }), doc('B')];
    expect(JSON.stringify(build(inputs))).toBe(JSON.stringify(build(inputs)));
    expect(refs(build(inputs))).toEqual(['p:A', 'p:B', 'p:C']);
  });

  it('does not mutate its input', () => {
    const results = [doc('A', { fm: ['references: [B]'] }), doc('B')].map(compileMarkdownArtifact);
    const before = JSON.stringify(results);
    buildGraph(results);
    expect(JSON.stringify(results)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Resolver and ref parsing (unit)
// ---------------------------------------------------------------------------

describe('parseRef / resolveRef', () => {
  it('parses qualified and unqualified refs', () => {
    expect(parseRef('ns:ID-1')).toEqual({ ok: true, qualified: true, namespace: 'ns', localId: 'ID-1' });
    expect(parseRef(' ID-1 ')).toEqual({ ok: true, qualified: false, localId: 'ID-1' });
    expect(makeRef('ns', 'ID-1')).toBe('ns:ID-1');
  });

  it('rejects syntactically invalid refs', () => {
    for (const bad of ['', ' ', ':', 'a:', ':a', 'a:b:c', 'a b', '-x', 'x/y', '{#X}']) {
      expect(parseRef(bad).ok).toBe(false);
    }
  });

  it('AMBIGUOUS returns all candidates', () => {
    const mk = (path: string) => ({
      ref: 'n:D',
      namespace: 'n',
      localId: 'D',
      kind: 'document' as const,
      location: { artifactId: path, path },
    });
    const index = buildObjectIndex([mk('b'), mk('a'), mk('c')], ['n']);
    const r = resolveRef('D', 'n', index);
    expect(r.status).toBe('AMBIGUOUS');
    if (r.status === 'AMBIGUOUS') expect(r.candidates.map(c => c.location.path)).toEqual(['a', 'b', 'c']);
  });

  it('unqualified ids use the source namespace even when another namespace has the id', () => {
    const obj = { ref: 'o:X', namespace: 'o', localId: 'X', kind: 'document' as const, location: { artifactId: 'a', path: 'a' } };
    const index = buildObjectIndex([obj], ['o', 'n']);
    expect(resolveRef('X', 'n', index).status).toBe('MISSING');
    expect(resolveRef('o:X', 'n', index).status).toBe('RESOLVED');
  });
});
