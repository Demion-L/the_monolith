import { describe, it, expect } from 'vitest';
import { compileMarkdownArtifact, isStructuralHeadingNoise } from './compile.js';
import type { ScriptoriumInput } from './types.js';

function make(content: string, overrides?: Partial<ScriptoriumInput>): ScriptoriumInput {
  return { id: 'test-artifact', content, ...overrides };
}

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

describe('headings', () => {
  it('extracts H1 heading as concept candidate', () => {
    const result = compileMarkdownArtifact(make('# Knowledge Graph\n'));
    expect(result.concepts).toHaveLength(1);
    expect(result.concepts[0].label).toBe('Knowledge Graph');
    expect(result.concepts[0].source).toBe('heading');
    expect(result.concepts[0].headingLevel).toBe(1);
  });

  it('extracts H2 and H3 headings with correct levels', () => {
    const result = compileMarkdownArtifact(make('## Section\n### Subsection\n'));
    expect(result.concepts[0].headingLevel).toBe(2);
    expect(result.concepts[1].headingLevel).toBe(3);
  });

  it('extracts multiple headings in document order', () => {
    const result = compileMarkdownArtifact(make('# Alpha\n## Beta\n### Gamma\n'));
    expect(result.concepts.map(c => c.label)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('records source line number on heading concepts', () => {
    const result = compileMarkdownArtifact(make('# Title\n\n## Section\n'));
    expect(result.concepts[0].sourceLine).toBe(0);
    expect(result.concepts[1].sourceLine).toBe(2);
  });

  it('strips inline markdown from heading labels', () => {
    const result = compileMarkdownArtifact(make('## `compileMarkdownArtifact`\n'));
    expect(result.concepts[0].label).toBe('compileMarkdownArtifact');
  });

  it('strips link syntax from heading labels', () => {
    const result = compileMarkdownArtifact(make('## [ADR-004](../adr/ADR-004.md)\n'));
    expect(result.concepts[0].label).toBe('ADR-004');
  });
});

// ---------------------------------------------------------------------------
// Frontmatter — stripping
// ---------------------------------------------------------------------------

describe('frontmatter stripping', () => {
  it('does not parse YAML keys as heading concepts', () => {
    const input = make('---\ntype: memory\nid: doc-001\n---\n# Real Heading\n');
    const result = compileMarkdownArtifact(input);
    const labels = result.concepts.map(c => c.label);
    expect(labels).not.toContain('type');
    expect(labels).not.toContain('memory');
    expect(labels).toContain('Real Heading');
  });

  it('does not parse frontmatter dashes as list items', () => {
    const input = make('---\ntype: memory\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.evidence.filter(e => e.source === 'list-item')).toHaveLength(0);
  });

  it('handles document with only frontmatter gracefully', () => {
    const input = make('---\ntype: memory\nid: doc-001\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.concepts).toHaveLength(0);
    expect(result.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
  });

  it('offsets source lines to account for frontmatter', () => {
    // frontmatter is 4 lines (0: ---, 1: type: memory, 2: ---, 3: blank), body starts at line 3
    const input = make('---\ntype: memory\n---\n# Heading\n');
    const result = compileMarkdownArtifact(input);
    // Heading is on line 3 of the original document
    expect(result.concepts[0].sourceLine).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Frontmatter — MONOLITH-aware relationship fields
// ---------------------------------------------------------------------------

describe('frontmatter — MONOLITH relationship fields', () => {
  it('maps related_decisions block sequence to relationship candidates', () => {
    const input = make('---\nrelated_decisions:\n  - ADR-001\n  - ADR-004\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.relationships).toHaveLength(2);
    expect(result.relationships[0].toLabel).toBe('ADR-001');
    expect(result.relationships[1].toLabel).toBe('ADR-004');
  });

  it('maps related_protocols inline array to relationship candidates', () => {
    const input = make('---\nrelated_protocols: [memory-governance, boot-sequence]\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.relationships).toHaveLength(2);
    expect(result.relationships.map(r => r.toLabel)).toContain('memory-governance');
  });

  it('all relationship candidates carry provenance explicit', () => {
    const input = make('---\ndepends_on:\n  - ADR-002\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.relationships.every(r => r.provenance === 'explicit')).toBe(true);
  });

  it('relationship candidate carries the source field name', () => {
    const input = make('---\nreferences:\n  - webway-v0.md\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.relationships[0].sourceField).toBe('references');
    expect(result.relationships[0].relationshipType).toBe('references');
  });

  it('uses document id as fromLabel when no title is present', () => {
    const input = make('---\nrelated:\n  - other-doc\n---\n', { id: 'my-doc' });
    const result = compileMarkdownArtifact(input);
    expect(result.relationships[0].fromLabel).toBe('my-doc');
  });

  it('uses explicit title as fromLabel when provided in input', () => {
    const input = make('---\nrelated:\n  - other-doc\n---\n', { id: 'my-doc', title: 'My Document' });
    const result = compileMarkdownArtifact(input);
    expect(result.relationships[0].fromLabel).toBe('My Document');
  });

  it('uses frontmatter title field as fromLabel', () => {
    const input = make('---\ntitle: Lexicon Mechanicus\nrelated:\n  - other-doc\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.relationships[0].fromLabel).toBe('Lexicon Mechanicus');
  });

  it('does not create relationship candidates from unknown fields', () => {
    const input = make('---\ncategory: long-term\nauthor: demion\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.relationships).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Frontmatter — generic fields become evidence
// ---------------------------------------------------------------------------

describe('frontmatter — generic fields', () => {
  it('maps generic frontmatter key-value to evidence', () => {
    const input = make('---\ntype: memory\ncategory: long-term\n---\n');
    const result = compileMarkdownArtifact(input);
    const fmEvidence = result.evidence.filter(e => e.source === 'frontmatter');
    expect(fmEvidence.length).toBeGreaterThanOrEqual(2);
    expect(fmEvidence.map(e => e.key)).toContain('type');
    expect(fmEvidence.map(e => e.key)).toContain('category');
  });

  it('evidence carries the original key name', () => {
    const input = make('---\nauthority: authoritative\n---\n');
    const result = compileMarkdownArtifact(input);
    const ev = result.evidence.find(e => e.key === 'authority');
    expect(ev).toBeDefined();
    expect(ev!.content).toBe('authoritative');
  });

  it('does not promote generic frontmatter values to relationship candidates', () => {
    const input = make('---\ncategory: long-term\nstatus: active\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.relationships).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Markdown links → source references
// ---------------------------------------------------------------------------

describe('markdown links', () => {
  it('extracts inline links as source references', () => {
    const input = make('[ADR-004](../adr/ADR-004.md)\n');
    const result = compileMarkdownArtifact(input);
    expect(result.sourceReferences).toHaveLength(1);
    expect(result.sourceReferences[0].label).toBe('ADR-004');
    expect(result.sourceReferences[0].target).toBe('../adr/ADR-004.md');
  });

  it('extracts multiple links from a single line', () => {
    const input = make('[Alpha](a.md) and [Beta](b.md)\n');
    const result = compileMarkdownArtifact(input);
    expect(result.sourceReferences.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts links from inside headings', () => {
    const input = make('## See [ADR-004](../adr/ADR-004.md)\n');
    const result = compileMarkdownArtifact(input);
    const ref = result.sourceReferences.find(r => r.target === '../adr/ADR-004.md');
    expect(ref).toBeDefined();
  });

  it('records source line on source references', () => {
    const input = make('\n[Link](target.md)\n');
    const result = compileMarkdownArtifact(input);
    expect(result.sourceReferences[0].sourceLine).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Code blocks → evidence, not concept candidates
// ---------------------------------------------------------------------------

describe('code blocks', () => {
  it('extracts fenced code block as evidence', () => {
    const input = make('```ts\nconst x = 1;\n```\n');
    const result = compileMarkdownArtifact(input);
    const codeEvidence = result.evidence.filter(e => e.source === 'code-block');
    expect(codeEvidence).toHaveLength(1);
    expect(codeEvidence[0].content).toContain('const x = 1;');
  });

  it('preserves code block language tag', () => {
    const input = make('```typescript\ninterface Foo {}\n```\n');
    const result = compileMarkdownArtifact(input);
    const ev = result.evidence.find(e => e.source === 'code-block');
    expect(ev?.language).toBe('typescript');
  });

  it('does not create concept candidates from code block content', () => {
    const input = make('```ts\nconst Scriptorium = new Map();\n```\n');
    const result = compileMarkdownArtifact(input);
    expect(result.concepts.filter(c => c.source !== 'heading')).toHaveLength(0);
  });

  it('handles code block without language tag', () => {
    const input = make('```\nsome code\n```\n');
    const result = compileMarkdownArtifact(input);
    const ev = result.evidence.find(e => e.source === 'code-block');
    expect(ev).toBeDefined();
    expect(ev?.language).toBeUndefined();
  });

  it('does not confuse code block content with list items or headings', () => {
    const input = make('```\n# not a heading\n- not a list\n```\n');
    const result = compileMarkdownArtifact(input);
    expect(result.concepts).toHaveLength(0);
    expect(result.evidence.filter(e => e.source === 'list-item')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// List items — concept promotion heuristic
// ---------------------------------------------------------------------------

describe('list item concept promotion', () => {
  it('promotes short title-case list items to concept candidates', () => {
    const input = make('- Graph Memex\n- Terra\n- WEBWAY\n');
    const result = compileMarkdownArtifact(input);
    const listConcepts = result.concepts.filter(c => c.source === 'list-item');
    expect(listConcepts.length).toBeGreaterThanOrEqual(3);
    expect(listConcepts.map(c => c.label)).toContain('Graph Memex');
    expect(listConcepts.map(c => c.label)).toContain('Terra');
    expect(listConcepts.map(c => c.label)).toContain('WEBWAY');
  });

  it('promotes backtick-wrapped list items to concept candidates', () => {
    const input = make('- `ConceptCandidate`\n- `analyzeArtifact()`\n');
    const result = compileMarkdownArtifact(input);
    const listConcepts = result.concepts.filter(c => c.source === 'list-item');
    expect(listConcepts.map(c => c.label)).toContain('ConceptCandidate');
    expect(listConcepts.map(c => c.label)).toContain('analyzeArtifact()');
  });

  it('keeps long prose list items as evidence', () => {
    const input = make('- Extracts concept candidates from headings and frontmatter\n');
    const result = compileMarkdownArtifact(input);
    expect(result.concepts.filter(c => c.source === 'list-item')).toHaveLength(0);
    expect(result.evidence.filter(e => e.source === 'list-item')).toHaveLength(1);
  });

  it('keeps sentence-ending list items as evidence', () => {
    const input = make('- This ends with a period.\n');
    const result = compileMarkdownArtifact(input);
    expect(result.concepts.filter(c => c.source === 'list-item')).toHaveLength(0);
  });

  it('keeps lowercase single-word list items as evidence', () => {
    const input = make('- knowledge\n- memory\n');
    const result = compileMarkdownArtifact(input);
    expect(result.concepts.filter(c => c.source === 'list-item')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces identical output for identical input', () => {
    const input = make('---\nrelated_decisions:\n  - ADR-001\n---\n# Heading\n- Terra\n[link](target.md)\n```ts\nconst x = 1;\n```\n');
    const r1 = compileMarkdownArtifact(input);
    const r2 = compileMarkdownArtifact(input);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('concept IDs are stable for identical content', () => {
    const input = make('# Alpha\n## Beta\n');
    const r1 = compileMarkdownArtifact(input);
    const r2 = compileMarkdownArtifact(input);
    expect(r1.concepts.map(c => c.id)).toEqual(r2.concepts.map(c => c.id));
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles empty content without throwing', () => {
    const result = compileMarkdownArtifact(make(''));
    expect(result.artifactId).toBe('test-artifact');
    expect(result.concepts).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
    expect(result.evidence).toHaveLength(0);
    expect(result.sourceReferences).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('handles content with only whitespace without throwing', () => {
    const result = compileMarkdownArtifact(make('   \n\n\n   '));
    expect(result.concepts).toHaveLength(0);
  });

  it('handles unclosed frontmatter as plain body content', () => {
    // Missing closing --- — no frontmatter parsed, content treated as body
    const input = make('---\ntype: memory\n# Heading Without Close\n');
    const result = compileMarkdownArtifact(input);
    // No frontmatter extracted, but heading still found in body
    expect(result.relationships).toHaveLength(0);
    expect(result.concepts.some(c => c.label === 'Heading Without Close')).toBe(true);
  });

  it('handles unclosed code fence without throwing', () => {
    const input = make('```ts\nconst x = 1;\n');
    const result = compileMarkdownArtifact(input);
    expect(result.evidence.filter(e => e.source === 'code-block')).toHaveLength(1);
  });

  it('assigns correct artifactId from input', () => {
    const result = compileMarkdownArtifact(make('# Test', { id: 'custom-id-42' }));
    expect(result.artifactId).toBe('custom-id-42');
  });

  it('concept IDs are namespaced by artifactId', () => {
    const result = compileMarkdownArtifact(make('# Title', { id: 'doc-abc' }));
    expect(result.concepts[0].id).toMatch(/^doc-abc-concept-/);
  });
});

// ---------------------------------------------------------------------------
// Full document — integration
// ---------------------------------------------------------------------------

describe('integration', () => {
  const fullDoc = `---
type: memory
id: memory-long-term-test
category: long-term
authority: authoritative
related_decisions:
  - ADR-001
  - ADR-004
related_protocols:
  - memory-governance
---

# Test Document

Overview paragraph with a [link to ADR](../adr/ADR-001.md).

## Core Concepts

- Graph Memex
- Terra
- Extracts explicit knowledge from authored documents.

## Code Example

\`\`\`typescript
const result = compileMarkdownArtifact(input);
\`\`\`
`;

  it('extracts headings from all levels', () => {
    const result = compileMarkdownArtifact(make(fullDoc));
    const headingLabels = result.concepts.filter(c => c.source === 'heading').map(c => c.label);
    expect(headingLabels).toContain('Test Document');
    expect(headingLabels).toContain('Core Concepts');
    expect(headingLabels).toContain('Code Example');
  });

  it('extracts MONOLITH relationship fields', () => {
    const result = compileMarkdownArtifact(make(fullDoc));
    expect(result.relationships.map(r => r.toLabel)).toContain('ADR-001');
    expect(result.relationships.map(r => r.toLabel)).toContain('ADR-004');
    expect(result.relationships.map(r => r.toLabel)).toContain('memory-governance');
  });

  it('extracts generic fields as frontmatter evidence', () => {
    const result = compileMarkdownArtifact(make(fullDoc));
    const keys = result.evidence.filter(e => e.source === 'frontmatter').map(e => e.key);
    expect(keys).toContain('type');
    expect(keys).toContain('category');
    expect(keys).toContain('authority');
  });

  it('extracts inline links as source references', () => {
    const result = compileMarkdownArtifact(make(fullDoc));
    expect(result.sourceReferences.some(r => r.target === '../adr/ADR-001.md')).toBe(true);
  });

  it('promotes title-case list items to concepts', () => {
    const result = compileMarkdownArtifact(make(fullDoc));
    const listConcepts = result.concepts.filter(c => c.source === 'list-item').map(c => c.label);
    expect(listConcepts).toContain('Graph Memex');
    expect(listConcepts).toContain('Terra');
  });

  it('keeps prose list items as evidence', () => {
    const result = compileMarkdownArtifact(make(fullDoc));
    const listEvidence = result.evidence.filter(e => e.source === 'list-item');
    expect(listEvidence.some(e => e.content.includes('explicit knowledge'))).toBe(true);
  });

  it('extracts code block as evidence, not concept', () => {
    const result = compileMarkdownArtifact(make(fullDoc));
    const codeEv = result.evidence.filter(e => e.source === 'code-block');
    expect(codeEv).toHaveLength(1);
    expect(codeEv[0].language).toBe('typescript');
    expect(result.concepts.every(c => c.source !== 'code-block' as never)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Story 1.3.2 — new MONOLITH corpus relationship fields
// ---------------------------------------------------------------------------

describe('frontmatter — corpus relationship fields (Story 1.3.2)', () => {
  it('follow_up_adrs block sequence produces relationship candidates', () => {
    const input = make('---\nfollow_up_adrs:\n  - ADR-004\n  - ADR-005\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.relationships).toHaveLength(2);
    expect(result.relationships.map(r => r.toLabel)).toContain('ADR-004');
    expect(result.relationships.map(r => r.toLabel)).toContain('ADR-005');
  });

  it('follow_up_adrs inline array produces relationship candidates', () => {
    const input = make('---\nfollow_up_adrs: [ADR-004, ADR-005]\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.relationships).toHaveLength(2);
    expect(result.relationships.map(r => r.toLabel)).toContain('ADR-004');
  });

  it('related_adrs produces relationship candidates with provenance explicit', () => {
    const input = make('---\nrelated_adrs:\n  - ADR-001\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].toLabel).toBe('ADR-001');
    expect(result.relationships[0].provenance).toBe('explicit');
    expect(result.relationships[0].sourceField).toBe('related_adrs');
    expect(result.relationships[0].relationshipType).toBe('related_adrs');
  });

  it('related_research produces relationship candidates with provenance explicit', () => {
    const input = make('---\nrelated_research:\n  - R-0001\n  - R-0002\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.relationships).toHaveLength(2);
    expect(result.relationships[0].provenance).toBe('explicit');
    expect(result.relationships.map(r => r.toLabel)).toContain('R-0001');
    expect(result.relationships.map(r => r.toLabel)).toContain('R-0002');
  });

  it('all three new fields work together in the same document', () => {
    const input = make('---\nfollow_up_adrs:\n  - ADR-006\nrelated_adrs:\n  - ADR-004\nrelated_research:\n  - R-0001\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.relationships).toHaveLength(3);
    const types = result.relationships.map(r => r.relationshipType);
    expect(types).toContain('follow_up_adrs');
    expect(types).toContain('related_adrs');
    expect(types).toContain('related_research');
  });

  it('new fields are not treated as generic evidence', () => {
    const input = make('---\nfollow_up_adrs:\n  - ADR-001\n---\n');
    const result = compileMarkdownArtifact(input);
    const fmEvidence = result.evidence.filter(e => e.source === 'frontmatter');
    expect(fmEvidence.map(e => e.key)).not.toContain('follow_up_adrs');
  });
});

// ---------------------------------------------------------------------------
// Story 1.3.2 — structural heading noise filter
// ---------------------------------------------------------------------------

describe('isStructuralHeadingNoise', () => {
  it('identifies all specified structural headings as noise', () => {
    const noiseSet = [
      'Overview', 'Summary', 'Notes', 'Background', 'Context',
      'Status', 'Implementation', 'Tests', 'Next Steps', 'Open Questions', 'Conclusion',
    ];
    for (const label of noiseSet) {
      expect(isStructuralHeadingNoise(label)).toBe(true);
    }
  });

  it('matches case-insensitively', () => {
    expect(isStructuralHeadingNoise('overview')).toBe(true);
    expect(isStructuralHeadingNoise('SUMMARY')).toBe(true);
    expect(isStructuralHeadingNoise('Background')).toBe(true);
  });

  it('does not filter domain-specific concepts', () => {
    expect(isStructuralHeadingNoise('Terra')).toBe(false);
    expect(isStructuralHeadingNoise('Graph Memex')).toBe(false);
    expect(isStructuralHeadingNoise('Scriptorium')).toBe(false);
    expect(isStructuralHeadingNoise('Cognitive Kernel')).toBe(false);
    expect(isStructuralHeadingNoise('WEBWAY')).toBe(false);
    expect(isStructuralHeadingNoise('ADR-004')).toBe(false);
  });

  it('does not filter empty string', () => {
    expect(isStructuralHeadingNoise('')).toBe(false);
  });
});

describe('heading noise filter — integration with compileMarkdownArtifact', () => {
  it('suppresses structural heading noise from concept candidates', () => {
    const input = make('# Overview\n## Summary\n### Background\n');
    const result = compileMarkdownArtifact(input);
    const headingLabels = result.concepts.filter(c => c.source === 'heading').map(c => c.label);
    expect(headingLabels).not.toContain('Overview');
    expect(headingLabels).not.toContain('Summary');
    expect(headingLabels).not.toContain('Background');
  });

  it('preserves domain-specific headings alongside noise headings', () => {
    const input = make('# Overview\n## Terra\n### Summary\n#### Graph Memex\n');
    const result = compileMarkdownArtifact(input);
    const headingLabels = result.concepts.filter(c => c.source === 'heading').map(c => c.label);
    expect(headingLabels).toContain('Terra');
    expect(headingLabels).toContain('Graph Memex');
    expect(headingLabels).not.toContain('Overview');
    expect(headingLabels).not.toContain('Summary');
  });

  it('all-noise document produces zero heading concepts', () => {
    const input = make('# Overview\n## Background\n### Context\n#### Status\n');
    const result = compileMarkdownArtifact(input);
    expect(result.concepts.filter(c => c.source === 'heading')).toHaveLength(0);
  });

  it('noise filter does not affect list-item concepts', () => {
    const input = make('- Overview\n- Terra\n- Summary\n');
    const result = compileMarkdownArtifact(input);
    const listConcepts = result.concepts.filter(c => c.source === 'list-item').map(c => c.label);
    // "Overview" and "Summary" as list items are short Title-Case words — promoted
    // (noise filter is heading-only, not list-item)
    expect(listConcepts).toContain('Overview');
    expect(listConcepts).toContain('Terra');
    expect(listConcepts).toContain('Summary');
  });

  it('Next Steps heading is filtered (two-word match)', () => {
    const input = make('## Next Steps\n');
    const result = compileMarkdownArtifact(input);
    expect(result.concepts.filter(c => c.source === 'heading')).toHaveLength(0);
  });

  it('Open Questions heading is filtered', () => {
    const input = make('## Open Questions\n');
    const result = compileMarkdownArtifact(input);
    expect(result.concepts.filter(c => c.source === 'heading')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Story 1.3.3 — documentId and documentTitle extraction
// ---------------------------------------------------------------------------

describe('documentId and documentTitle (Story 1.3.3)', () => {
  it('extracts documentId from frontmatter id: field', () => {
    const input = make('---\nid: ADR-004\ntitle: Terra vs Graph Memex\n---\n# ADR-004 — Terra vs Graph Memex\n');
    const result = compileMarkdownArtifact(input);
    expect(result.documentId).toBe('ADR-004');
  });

  it('extracts documentId from frontmatter id: for research documents', () => {
    const input = make('---\nid: R-0001\ntitle: Lessons Learned\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.documentId).toBe('R-0001');
  });

  it('documentId is undefined when frontmatter has no id: field', () => {
    const input = make('---\ntype: memory\nauthority: authoritative\n---\n# My Document\n');
    const result = compileMarkdownArtifact(input);
    expect(result.documentId).toBeUndefined();
  });

  it('documentId is undefined when there is no frontmatter', () => {
    const input = make('# Just a Heading\n');
    const result = compileMarkdownArtifact(input);
    expect(result.documentId).toBeUndefined();
  });

  it('documentTitle reflects frontmatter title: field when present', () => {
    const input = make('---\nid: ADR-004\ntitle: Terra vs Graph Memex\n---\n', { title: 'ADR-004 — Terra vs Graph Memex' });
    const result = compileMarkdownArtifact(input);
    expect(result.documentTitle).toBe('Terra vs Graph Memex');
  });

  it('documentTitle reflects input.title (H1) when no frontmatter title', () => {
    const input = make('---\nid: ADR-004\ntype: adr\n---\n# ADR-004 — Terra\n', { title: 'ADR-004 — Terra' });
    const result = compileMarkdownArtifact(input);
    expect(result.documentTitle).toBe('ADR-004 — Terra');
  });

  it('documentTitle falls back to artifact id when no title source exists', () => {
    const input = make('---\ntype: memory\n---\n');
    const result = compileMarkdownArtifact(input);
    expect(result.documentTitle).toBe('test-artifact');
  });

  it('documentId does NOT create an additional concept', () => {
    const input = make('---\nid: ADR-004\n---\n# ADR-004 — Terra vs Graph Memex\n');
    const result = compileMarkdownArtifact(input);
    const conceptLabels = result.concepts.map(c => c.label);
    // Only the heading is a concept; the id: value should not create a second one
    expect(conceptLabels).not.toContain('ADR-004');
    expect(conceptLabels).toHaveLength(1); // only the H1 heading
  });

  it('id: value still appears in frontmatter evidence', () => {
    const input = make('---\nid: ADR-004\n---\n');
    const result = compileMarkdownArtifact(input);
    const idEvidence = result.evidence.find(e => e.key === 'id');
    expect(idEvidence).toBeDefined();
    expect(idEvidence!.content).toBe('ADR-004');
  });
});
