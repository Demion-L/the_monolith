---
type: memory
id: memory-long-term-knowledge-lifecycle
category: long-term
authority: authoritative
related_protocols:
  - memory-governance
related_decisions:
  - ADR-001
---

# Knowledge Lifecycle v0

How information evolves into knowledge inside MONOLITH.

This document defines the canonical transformation stages from raw information to a stable Knowledge Region. Each stage has a purpose, entry criteria, exit criteria, and concrete examples.

---

## Overview

```
Information
  │
  ▼  [ingestion — analyzeArtifact()]
Concept Candidate
  │
  ▼  [extraction — frequency ranking, top-N]
Concept
  │
  ▼  [linking — SemanticLink assigned]
Connected Concept
  │
  ▼  [recurrence — same concepts across artifacts]  ← v2+
Pattern
  │
  ▼  [abstraction — named, confidence scored]
Mental Model
  │
  ▼  [consolidation — stable cross-artifact evidence]  ← v3+
Knowledge Region
```

### Implementation coverage

| Stage | v0 Status |
| ----- | --------- |
| Information | Implemented — `Artifact` type |
| Concept Candidate | Implemented — tokenizer + stopword filter |
| Concept | Implemented — `Concept` type, top-N ranking |
| Connected Concept | Implemented — `SemanticLink` type |
| Pattern | Partial — single-artifact approximation via `MentalModel` |
| Mental Model | Partial — generated per artifact, not cross-validated |
| Knowledge Region | Partial — predefined static regions, not corpus-inferred |

---

## Stage 1 — Information

**Purpose:**  
The raw, unprocessed input. The starting material before any transformation. Information exists in any medium — text, code, documentation, conversation, decision records. At this stage, nothing is known about its meaning, relevance, or relationship to existing knowledge.

**Entry criteria:**
- Any content submitted to the system as an `Artifact`
- Must have an `id`, `content` string, and `createdAt` timestamp
- No minimum length or quality requirement

**Exit criteria:**
- `Artifact` is passed to `analyzeArtifact()` — tokenization begins
- Content is non-empty and produces at least one token after stopword filtering

**Examples:**
- A paragraph from a research paper on knowledge graphs
- A story capsule written during `finalize-story`
- A code comment explaining a design decision
- A `decisions.md` entry after an architectural review
- This document itself

---

## Stage 2 — Concept Candidate

**Purpose:**  
A token that has been identified as potentially meaningful by the extraction process. Not yet confirmed — it is a statistical signal, not a validated semantic unit. The system suspects this word carries meaning but has not yet committed to it.

**Entry criteria:**
- Token produced by lowercasing and stripping punctuation from Artifact content
- Token length > 2 characters
- Token is NOT in the stopword list
- Token appears at least once in the artifact

**Exit criteria:**
- Token survives the frequency-ranking step and appears in the top-N candidates (currently top-5)
- If ranked out: token is discarded and does not advance

**Examples:**
- `"memory"` — appears 3 times in a governance protocol → advances
- `"semantic"` — appears twice in a design doc → advances
- `"the"` — filtered by stopword list → discarded
- `"a"` — too short → discarded
- `"xyz"` — appears once, ranked below top-N → discarded

---

## Stage 3 — Concept

**Purpose:**  
A confirmed semantic unit extracted from a specific Artifact. Has a stable identity, a human-readable label, a normalized weight (0–1), and a reference to its source artifact. A Concept is the atomic unit of the WEBWAY knowledge representation — the smallest thing that can carry meaning.

**Entry criteria:**
- Concept Candidate ranked in top-N by frequency (ties broken alphabetically for determinism)
- Assigned a stable ID: `{artifactId}-concept-{index}`
- Weight assigned: `frequency / max_frequency` within this artifact

**Exit criteria:**
- Concept is connected to at least one other Concept via a `SemanticLink`
- Advances to Connected Concept stage

**Examples:**
- `{ id: "art-001-concept-0", label: "knowledge", weight: 1.0, sourceArtifactId: "art-001" }`
- `{ id: "art-001-concept-1", label: "semantic", weight: 0.8, sourceArtifactId: "art-001" }`
- `{ id: "art-002-concept-0", label: "function", weight: 1.0, sourceArtifactId: "art-002" }`

---

## Stage 4 — Connected Concept

**Purpose:**  
A Concept that participates in at least one `SemanticLink`. No longer isolated — it exists in relationship to other Concepts. Connected Concepts form the edges of the local knowledge graph for an artifact. Relationship type carries additional meaning beyond co-occurrence: `relates-to`, `extends`, `depends-on`, `contrasts-with`, `exemplifies`, `part-of`.

**Entry criteria:**
- Concept has ≥ 1 outbound `SemanticLink` to an adjacent Concept
- Link carries: `id`, `fromConceptId`, `toConceptId`, `relationshipType`, `strength`

**Exit criteria:**
- Same or semantically equivalent Concept labels appear across ≥ 2 artifacts AND form consistent relationship types → advances to Pattern *(v2+)*
- In v0: all Connected Concepts remain at this stage — cross-artifact linking is not yet implemented

**Examples:**
- `"knowledge" relates-to "semantic"` (strength: 0.8)
- `"semantic" extends "memory"` (strength: 0.7)
- `"function" depends-on "module"` (strength: 0.9)
- `"model" relates-to "pattern"` (strength: 1.0)

---

## Stage 5 — Pattern

**Purpose:**  
A recurring structural relationship between Concepts observed across multiple artifacts or within a dense concept cluster. A Pattern is not a single connection — it is a regularity. It signals that a concept cluster deserves a named abstraction. Patterns are the evidence base from which Mental Models are built.

**Entry criteria** *(v2+)*:
- Same concept labels (or semantically equivalent labels) appear in ≥ 2 analyzed artifacts
- Relationship types between those concepts are consistent across artifacts
- Cluster has sufficient density (concept count and link count above threshold)

**Exit criteria:**
- Pattern has enough cross-artifact evidence and internal coherence to warrant a named abstraction → advances to Mental Model

**Examples:**
- `"knowledge → structure → memory"` appearing consistently across cognitive architecture articles
- `"function → test → module"` appearing in software engineering story capsules
- `"gap → question → learning"` appearing in learning-focused artifacts *(H7 pattern)*
- `"artifact → concept → region"` — the WEBWAY pipeline itself, if analyzed as a corpus

**v0 note:** In v0, `analyzeArtifact()` generates a single-artifact approximation of a pattern inside the `MentalModel` output field. This is a placeholder, not a true cross-artifact pattern. Real patterns require corpus-level analysis (v2+).

---

## Stage 6 — Mental Model

**Purpose:**  
A named abstraction over a Pattern. A Mental Model is interpretable — it has a human-readable `pattern` description, a `regionId`, and a `confidence` score. It represents what the system *infers* about a domain based on accumulated evidence. Mental Models are the units that enable reasoning without re-reading source artifacts.

**Entry criteria:**
- Pattern is named with a `label` (e.g., `"knowledge cluster"`)
- Pattern is attributed to a `KnowledgeRegion` via `regionId`
- Confidence score is computed from concept weights and region match strength

**Exit criteria:**
- Multiple Mental Models in the same region accumulate overlapping concept evidence
- Region assignment is stable across new artifacts → advances to Knowledge Region *(v3+)*
- In v0: Mental Models remain single-artifact and are not cross-validated

**Examples:**
- `{ id: "art-001-model-0", name: "knowledge cluster", regionId: "kr-cognitive-architecture", pattern: "Primary concept \"knowledge\" with 5 related concepts in the Cognitive Architecture region.", confidence: 0.80 }`
- `{ name: "function cluster", regionId: "kr-software-engineering", pattern: "Primary concept \"function\" with 4 related concepts in the Software Engineering region.", confidence: 0.72 }`

---

## Stage 7 — Knowledge Region

**Purpose:**  
A stable, named domain cluster that organizes multiple related Concepts, Patterns, and Mental Models into a coherent semantic territory. A Knowledge Region is the highest-resolution epistemic unit in WEBWAY. It defines an area of the knowledge graph that the system can reason over as a unit and that future modules (Terra, Corpus) can query as a boundary.

**Note on mature knowledge capability (see H8):**  
Maturity in the current model measures quantity and stability — how many concepts exist and how settled their relationships are. This is necessary but not sufficient. A mature Knowledge Region is not only accumulated and stable; it is capable of supporting inference, explanation, and prediction over unseen information. A region that can name its concepts but cannot generate accurate inferences about absent facts is still primarily descriptive. The progression from descriptive → explanatory → predictive is a proposed second axis, separate from the seed → growing → mature axis. These axes are orthogonal: a small but tightly structured region may already be explanatory, while a large region may remain descriptive. This axis is proposed; do not replace the existing maturity levels until validation criteria are met (see H8 — Analysis section).

**Entry criteria** *(v3+)*:
- ≥ N Mental Models with consistent `regionId` assignment across diverse artifacts
- Concept clusters within the region show stable co-occurrence
- Region boundary is distinguishable from adjacent regions (low cross-region concept overlap)

**Exit criteria:**
- Region spawns sub-regions due to internal concept divergence → hierarchical Knowledge Region *(v4+)*
- In v0: Knowledge Regions are predefined static profiles; there is no dynamic entry or exit

**Examples:**
- `kr-cognitive-architecture` — stabilized by consistent co-occurrence of: knowledge, memory, model, semantic, schema, cognitive, mental across research artifacts
- `kr-software-engineering` — stabilized by: function, module, api, component, test, interface, service across code and documentation artifacts
- `kr-data-systems` — stabilized by: data, query, schema, index, store, pipeline, graph across data architecture artifacts
- `kr-general` — fallback; no stable region assignment (low concept-to-keyword match across all profiles)

---

## Lifecycle in the Cognitive Loop

The Knowledge Lifecycle feeds directly into the Cognitive Loop Architecture (ADR-001):

```
Knowledge Region (Stage 7)
  │
  ▼  [Gap Detection — what concepts are absent or weakly connected?]
Question Generation  (KR-7 — Cognitive Processes)
  │
  ▼  [Learning — acquire artifact that answers the question]
Information  (Stage 1 — loop re-enters)
  │
  ▼  [Lifecycle advances again...]
```

The Lifecycle is linear. The Cognitive Loop is what makes it circular. Together they define the full architecture of self-directed knowledge formation in MONOLITH.

---

## Story as the Source of Artifacts

The Knowledge Lifecycle processes artifacts. Stories produce them.

A Story is the unit of engineering evolution in MONOLITH: it begins with an ambiguous task, moves through investigation, hypotheses, experiments, and evidence, and terminates in a Decision. At the moment of Decision, the Story produces its permanent outputs: an ADR, a memory update, and an archived capsule. These outputs are artifacts — processable by Stage 1 of this lifecycle.

Decision is the terminal state of Story, not a parallel process. Evidence gathered during a Story crystallizes into a Decision. After the Decision is committed to long-term memory, the Story is archived. The archived Story becomes historical knowledge — available for future WEBWAY analysis, future gap detection, and future Story reasoning.

This means the two lifecycles are complementary, not redundant:

| Lifecycle | Processes | Produces |
| --------- | --------- | -------- |
| Knowledge Lifecycle | One artifact at a time | Concepts, links, regions, mental models |
| Story Lifecycle | One engineering trajectory | Decision + archived reasoning (new artifacts) |

Stories supply the Knowledge Lifecycle with artifacts to process. The Knowledge Lifecycle supplies the Cognitive Core with structured knowledge to detect gaps in. Detected gaps generate questions. Questions become new Stories.

See `memory/long-term/story-lifecycle.md` for the full Story model.
