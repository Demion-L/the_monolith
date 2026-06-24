# Webway v0 — The Meaning Linker

## Purpose

Webway is the semantic connection layer of MONOLITH.

Its job is to turn isolated information artifacts into connected knowledge structures — not by keyword matching, but by meaning.

Naive RAG pipelines chunk text and expect embedding similarity to do the heavy lifting. MONOLITH is building something different: a knowledge graph of concepts, relationships, and mental models that can be reasoned over, traversed, and evolved.

Webway is the module responsible for that transformation.

## What it does (v0)

**Input:** an `Artifact` — any unit of raw information with an id, content string, and metadata.

**Output:** a `WebwayAnalysisResult` containing:

- **Concepts** — the top semantic units extracted from the artifact content, ranked by frequency, each with a normalized weight.
- **SemanticLinks** — directed relationships between concepts (e.g. `relates-to`, `extends`, `depends-on`), forming a small local graph.
- **KnowledgeRegion** — the suggested domain cluster this artifact belongs to (`Software Engineering`, `Cognitive Architecture`, `Data Systems`, or `General`).
- **MentalModels** — a higher-order pattern description over the region, expressing the artifact's primary theme.

The v0 extraction is deterministic and purely frequency-based. Same input always produces the same output. No randomness, no external calls.

## What it explicitly does NOT do yet

- **No LLM calls.** Concept extraction is statistical, not semantic. A future version will use embeddings or language models to understand meaning beyond frequency.
- **No vector database.** Concepts are not embedded. There is no similarity search yet.
- **No graph database.** Semantic links are not persisted to a graph store. The output is an in-memory structure.
- **No cross-artifact linking.** v0 analyzes one artifact at a time. A future version will build edges between artifacts that share concepts.
- **No pattern learning.** Mental models are templates, not learned structures. A future version will infer patterns from corpus-wide analysis.

## Future direction

```
v0 (now)    → single artifact, deterministic frequency extraction
v1          → embedding-based concept extraction (real semantic understanding)
v2          → cross-artifact link building (shared concept graph)
v3          → knowledge region inference from corpus patterns
v4          → emergent mental model synthesis from graph topology
```

The goal is that by v3+, MONOLITH can answer questions like:

> "What is the relationship between this PR and the architecture decision made last quarter?"

That requires real knowledge regions, not keyword buckets.

## Types reference

```typescript
Artifact            // raw information input
Concept             // named semantic unit with weight
SemanticLink        // directed relationship between two concepts
KnowledgeRegion     // domain cluster grouping concepts
MentalModel         // higher-order pattern over a region
WebwayAnalysisResult // full output of analyzeArtifact()
```

## Usage

```typescript
import { analyzeArtifact } from '@monolith/core';

const result = analyzeArtifact({
  id: 'doc-001',
  content: 'The knowledge graph connects semantic concepts through typed relationships...',
  createdAt: new Date(),
});

console.log(result.concepts);       // top concepts from the text
console.log(result.suggestedRegion); // e.g. "Cognitive Architecture"
console.log(result.mentalModels);   // the primary pattern
```
