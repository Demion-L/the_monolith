---
type: memory
id: memory-long-term-hypotheses
category: long-term
authority: authoritative
related_protocols:
  - memory-governance
  - core-invariants
---

# Product & Research Hypotheses

Structured, testable hypotheses whose subject is MONOLITH, or whose owning project is not yet decided (routing-map, KQ-1).

Each hypothesis is a bet. Record evidence and unknowns as work proceeds.  
Update status when evidence changes: `active → validated | rejected | deferred`.

---

## Status Legend

| Status | Meaning |
| ------ | ------- |
| `active` | Being pursued; evidence is accumulating |
| `validated` | Sufficient evidence collected; hypothesis holds |
| `rejected` | Evidence contradicts the hypothesis; record what was learned |
| `deferred` | Relevant but requires a later phase to test |

---

## H2 — Knowledge Emerges from Structure, Not Data

**Status:** `active`

**Statement:**  
Knowledge is not information at rest. It emerges from identifying concepts, forming typed relationships between them, recognizing patterns, and building mental models. Raw text cannot be reliably queried for knowledge without this transformation layer.

**Why it matters:**  
Defines the transformation contract WEBWAY must perform. If information alone were sufficient, WEBWAY would be unnecessary. The pipeline `Artifact → Concepts → Links → Regions → Mental Models → Insights` only makes sense if each step adds epistemic value.

**Current evidence:**
- Human cognition research (Minsky's frames, schema theory, Novak's concept maps) consistently demonstrates that comprehension requires structure — not just storage.
- Expert performance in any domain correlates with richer concept maps, not larger information stores.
- v0 `analyzeArtifact()` demonstrates that even frequency-based structure extraction produces semantically coherent region assignments, suggesting the structural signal is present in text and extractable.
- **Story 1.3 (2026-06-28):** Scriptorium structural extraction applied to MONOLITH's own 481 documents: explicit `id:` / `title:` fields in frontmatter are sufficient to establish deterministic node identity. The absence of structural identity (documents without `id:` frontmatter) produced 0 usable graph nodes — confirming that structure (frontmatter schema) is required before meaning can emerge. Raw text alone produced no identity, no edges.

**Unknowns:**
- Whether machine-generated concept maps can meaningfully approximate human knowledge structures in precision and recall.
- What minimum structural depth is required before knowledge queries become reliable.
- Whether typed relationship labels add measurable value over untyped or unlabeled concept graphs.

**How to validate:**  
Measure whether `WebwayAnalysisResult` structures improve downstream answer quality compared to raw artifact text on a set of multi-hop reasoning tasks. Design tasks that require concept relationship traversal to answer correctly.

---

## H5 — Organizational Memory and Agent Memory Are the Same Problem

**Status:** `active`

**Statement:**  
The challenge of preserving accumulated experience across AI agent session boundaries is structurally identical to the challenge of preserving organizational knowledge across employee transitions. Both require structured knowledge transfer — not raw document retrieval — and both fail in the same way: the new actor must rediscover what the prior actor already knew.

**Why it matters:**  
If true, WEBWAY is not merely a RAG improvement — it is infrastructure for institutional memory at the AI level. The scope of the problem expands from "better search" to "transferable accumulated experience." This dramatically changes the value proposition of MONOLITH as a whole.

**Current evidence:**
- MONOLITH's existing governance layer (active.md, story capsules, HANDOFF.md) already solves the agent session transfer problem structurally — and the design mirrors classic knowledge management patterns (Nonaka's SECI model: socialization → externalization → combination → internalization).
- The failure mode in both cases is identical: context loss on actor transition, rediscovery of previously solved problems, inconsistent application of past decisions.
- MONOLITH's `.monolith/memory/` structure maps directly onto knowledge management categories: working memory (tacit/explicit), long-term memory (explicit/documented), error records (failure memory), lessons (externalized learning).

**Unknowns:**
- Whether agent memory retrieval and organizational memory retrieval have meaningfully different access patterns that require different storage or indexing strategies.
- Whether the same semantic structures that work for technical knowledge (code, architecture) generalize to organizational/procedural knowledge.
- How to represent the provenance of knowledge (who generated it, in what context) in a way that is useful for future actors.

**How to validate:**  
Apply WEBWAY analysis to MONOLITH's own `.monolith/memory/` artifacts (decisions.md, story capsules, architecture-principles.md). Measure whether the generated knowledge graph accurately represents governance relationships that a human analyst would recognize. Compare against a baseline of manual tagging.

---

## H6 — Webway Is the Bridge from Memory Governance to Knowledge Formation

**Status:** `active`

**Statement:**  
MONOLITH currently governs AI memory: what to write, where to write it, when to read it. WEBWAY is the capability that evolves MONOLITH from memory governance — managing information at rest — into knowledge formation — actively building meaning from accumulated information. Without WEBWAY, MONOLITH is a well-organized document system. With WEBWAY, it can reason over its own memory and discover structure it did not explicitly create.

**Why it matters:**  
Defines the long-term product relationship between MONOLITH (the kernel) and WEBWAY (the first cognitive module). Establishes WEBWAY not as a standalone utility but as the semantic engine that enables MONOLITH to upgrade its own capabilities over time.

**Current evidence:**
- v0 `analyzeArtifact()` can already be applied to any MONOLITH memory artifact (active.md, decisions.md, story capsules) and extract concepts, region assignments, and semantic links — without any changes to the kernel.
- The `WebwayAnalysisResult` output shape is structurally compatible with future cross-document graph construction: concepts carry IDs and source references, links carry typed relationship labels.
- The MONOLITH boot sequence already reads memory artifacts in a fixed order — WEBWAY analysis could be inserted as an enrichment step without breaking the existing protocol.
- **Story 1.3 (2026-06-28):** Scriptorium + ERG now process MONOLITH's own documentation corpus deterministically. The complete pipeline from raw `.md` files to a typed graph of real nodes and explicit edges is operational — MONOLITH can now ingest itself. This is the prerequisite infrastructure H6 predicted would be needed. The next step (applying Webway analysis to the resulting graph for semantic enrichment) is now technically unblocked.

**Unknowns:**
- At which point in the MONOLITH boot sequence should WEBWAY analysis be applied (pre-load enrichment vs on-demand query-time analysis).
- Whether semantic analysis of governance artifacts is useful in practice or primarily theoretically interesting.
- Whether the MONOLITH kernel needs a formal interface for cognitive modules (capability registry) or whether direct import is sufficient.

**How to validate:**  
Apply WEBWAY analysis to 10 MONOLITH memory artifacts from a live project. Verify that the extracted knowledge graph reflects governance relationships recognizable to a human analyst. Measure whether concept-region assignments are stable across artifact types (protocol files, memory files, context files).

