import { describe, it, expect } from 'vitest';
import { analyzeArtifact } from './analyze.js';
import type { Artifact } from './types.js';

function makeArtifact(id: string, content: string): Artifact {
  return { id, content, createdAt: new Date('2026-01-01') };
}

describe('analyzeArtifact', () => {
  it('returns the correct artifactId', () => {
    const result = analyzeArtifact(makeArtifact('art-1', 'knowledge semantic memory concept model'));
    expect(result.artifactId).toBe('art-1');
  });

  it('extracts concepts from content', () => {
    const result = analyzeArtifact(makeArtifact('art-1', 'knowledge semantic memory concept model pattern'));
    expect(result.concepts.length).toBeGreaterThan(0);
    expect(result.concepts.every(c => c.sourceArtifactId === 'art-1')).toBe(true);
  });

  it('assigns deterministic concept IDs', () => {
    const artifact = makeArtifact('art-1', 'knowledge semantic memory concept');
    const r1 = analyzeArtifact(artifact);
    const r2 = analyzeArtifact(artifact);
    expect(r1.concepts.map(c => c.id)).toEqual(r2.concepts.map(c => c.id));
  });

  it('is fully deterministic for identical inputs', () => {
    const artifact = makeArtifact('art-det', 'function module api interface component test');
    const r1 = analyzeArtifact(artifact);
    const r2 = analyzeArtifact(artifact);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('creates semantic links between adjacent concepts', () => {
    const result = analyzeArtifact(makeArtifact('art-1', 'knowledge semantic memory concept model pattern'));
    expect(result.links.length).toBe(result.concepts.length - 1);
    for (const link of result.links) {
      expect(link.fromConceptId).toMatch(/^art-1-concept-\d+$/);
      expect(link.toConceptId).toMatch(/^art-1-concept-\d+$/);
    }
  });

  it('concept weights are normalized between 0 and 1', () => {
    const result = analyzeArtifact(makeArtifact('art-1', 'knowledge knowledge semantic memory concept'));
    for (const concept of result.concepts) {
      expect(concept.weight).toBeGreaterThan(0);
      expect(concept.weight).toBeLessThanOrEqual(1);
    }
    const top = result.concepts[0];
    expect(top.weight).toBe(1);
  });

  it('suggests kr-cognitive-architecture for cognitive content', () => {
    const result = analyzeArtifact(makeArtifact('art-1', 'semantic knowledge memory model cognitive pattern schema'));
    expect(result.suggestedRegion.id).toBe('kr-cognitive-architecture');
    expect(result.suggestedRegion.conceptIds.length).toBeGreaterThan(0);
  });

  it('suggests kr-software-engineering for code-heavy content', () => {
    const result = analyzeArtifact(makeArtifact('art-2', 'function module api interface component service build deploy test class'));
    expect(result.suggestedRegion.id).toBe('kr-software-engineering');
  });

  it('falls back to kr-general for unrecognized content', () => {
    const result = analyzeArtifact(makeArtifact('art-3', 'hello world foo bar baz'));
    expect(result.suggestedRegion.id).toBe('kr-general');
  });

  it('generates a mental model linked to the suggested region', () => {
    const result = analyzeArtifact(makeArtifact('art-1', 'knowledge semantic memory concept'));
    expect(result.mentalModels.length).toBeGreaterThan(0);
    expect(result.mentalModels[0].regionId).toBe(result.suggestedRegion.id);
    expect(result.mentalModels[0].confidence).toBeGreaterThanOrEqual(0);
    expect(result.mentalModels[0].confidence).toBeLessThanOrEqual(1);
  });

  it('includes a semver analysis version', () => {
    const result = analyzeArtifact(makeArtifact('art-1', 'test content'));
    expect(result.analysisVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('handles empty content gracefully', () => {
    const result = analyzeArtifact(makeArtifact('art-empty', ''));
    expect(result.concepts).toHaveLength(0);
    expect(result.links).toHaveLength(0);
    expect(result.suggestedRegion.id).toBe('kr-general');
    expect(result.mentalModels[0].confidence).toBe(0);
  });

  it('handles content with only stopwords', () => {
    const result = analyzeArtifact(makeArtifact('art-stop', 'the a an is are was were be'));
    expect(result.concepts).toHaveLength(0);
    expect(result.links).toHaveLength(0);
  });
});
