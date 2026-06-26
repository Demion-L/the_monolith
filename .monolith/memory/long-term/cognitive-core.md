---
type: memory
id: memory-long-term-cognitive-core
category: long-term
authority: authoritative
related_protocols:
  - memory-governance
related_decisions:
  - ADR-001
  - ADR-002
related_hypotheses:
  - H7
  - H8
---

# Cognitive Core — Conceptual Foundation

The Cognitive Core is the proposed future self-directed learning layer of MONOLITH.

This document defines its purpose, core questions, relationships, and explicit non-goals.  
It is a conceptual artifact. No runtime components exist yet.

---

## Purpose

WEBWAY transforms information into knowledge by extracting concepts, building semantic links, assigning knowledge regions, and generating mental models. This is a reactive capability: it processes what it is given.

The Cognitive Core is the layer that would make this process self-directed.

Where WEBWAY asks: *"What does this artifact mean?"*  
The Cognitive Core asks: *"What remains unknown?"*

The Cognitive Core is not a separate runtime module. It is the conceptual name for the layer of MONOLITH that, once implemented, would close the loop between knowledge formation and knowledge acquisition — directing what to learn next, not just how to process what arrives.

---

## Core Question

> **What remains unknown?**

This is the question the Cognitive Core is designed to pursue. It is not a question the system answers once; it is the question the system holds continuously as its world model grows.

It is operationalized through three supporting questions:

| Supporting Question | Role |
| ------------------- | ---- |
| What contradiction has not been resolved? | Identifies internal inconsistencies between mental models or across knowledge regions that signal incomplete understanding |
| What missing link would make this region more predictive? | Identifies structural gaps in the concept graph — absent edges whose presence would enable inference over currently unknown information |
| What question should be asked next? | Converts detected gaps into actionable learning directives — the output of gap detection feeding into question generation |

These questions are not yet implemented. They define the behavioral contract of the Cognitive Core layer.

---

## Relationships

### Relationship to H7 — Continuous Question Loop

H7 proposes that a cognitive system becomes capable of self-directed learning when it can continuously identify gaps and generate questions to resolve them. The Cognitive Core is the architectural concept that would house this capability.

H7 describes the *what*: a loop of gap detection, question generation, learning, and model update.  
The Cognitive Core names the *where*: the layer of MONOLITH responsible for executing that loop.

The supporting questions above (contradiction detection, missing link identification, next question generation) are the operationalized form of H7's gap detection and question generation phases.

### Relationship to H8 — Predictive Power

H8 proposes that the maturity of a Knowledge Region should be measured by its ability to generate accurate inferences about unseen information, not only by the quantity and stability of its accumulated concepts.

The Cognitive Core depends on H8: the question "What missing link would make this region more predictive?" presupposes that predictive capability is a meaningful and measurable property of a region. Without H8, there is no criterion for distinguishing a gap that matters from one that does not.

H8 is the epistemic standard the Cognitive Core would apply when prioritizing which gaps to pursue.

### Relationship to WEBWAY

WEBWAY is the substrate the Cognitive Core would operate on. WEBWAY's output — extracted concepts, semantic links, knowledge region assignments, mental models — is the world model the Cognitive Core would inspect for gaps.

The Cognitive Core does not replace WEBWAY. It extends the cognitive loop that WEBWAY's linear pipeline cannot close by itself:

```
WEBWAY (linear)
  Information → Concepts → Semantic Links → Knowledge Regions → Mental Models

Cognitive Core (closes the loop)
  Mental Models → [What remains unknown?] → Gap Detection
                                           → Question Generation
                                           → Learning (new Information)
                                           → Mental Models (updated)
```

### Relationship to Knowledge Lifecycle

The Knowledge Lifecycle (knowledge-lifecycle.md) defines the transformation from raw information to a stable Knowledge Region. It is a linear process.

The Cognitive Core would make it circular. Stage 7 (Knowledge Region) would no longer be an endpoint — it would be the input to the Cognitive Core's gap detection, which generates Stage 1 (Information) targets for the next lifecycle pass.

Additionally, the Cognitive Core relies on the proposed epistemic_level axis (descriptive → explanatory → predictive) to determine *which* gaps are worth pursuing: gaps whose resolution would increase a region's predictive capability are prioritized over gaps that would only add descriptive coverage.

---

## Non-Goals

The following are explicitly out of scope for this conceptual layer:

- **Do not claim consciousness.** The Cognitive Core is a set of operations over a structured knowledge graph. It does not perceive, feel, or have subjective experience. "Self-directed" means the system selects its next learning target from its own knowledge state — not that it has intentions or desires.

- **Do not implement autonomous agency yet.** The Cognitive Core, when implemented, will suggest gaps and candidate questions. It will not autonomously acquire artifacts, modify its own protocols, or act outside the current governance constraints. Autonomy requires explicit capability expansion via the governance layer.

- **Do not create runtime loops yet.** No source code changes accompany this document. The Cognitive Core exists as an architectural concept pending implementation stories. Premature implementation risks building the wrong interface before the epistemic model (H8) is validated.

---

## Current State

| Component | Status |
| --------- | ------ |
| Core question defined | Yes — this document |
| H7 (gap detection, question loop) | Hypothesis — active |
| H8 (predictive power as maturity signal) | Hypothesis — active |
| ADR-001 (Cognitive Loop Architecture) | Accepted — 2026-06-24 |
| ADR-002 (Cognitive Core Foundation) | Proposed — 2026-06-26 |
| `detectGaps()` implementation | Deferred |
| `generateQuestions()` implementation | Deferred |
| Predictive region evaluation | Blocked on H8 validation |

---

## Open Questions

- What is the minimum viable gap representation inside MONOLITH? An absent edge in the concept graph? A low-confidence mental model? A region without typed outbound relationships?
- Should the Cognitive Core generate questions as strings (human-readable) or as structured objects with source region, gap type, and priority score?
- How will false-positive gaps be suppressed? Not every absent link represents missing knowledge — some are domain boundaries, not gaps. Filtering strategy is an open design problem.
- At which point in the MONOLITH boot sequence would the Cognitive Core operate? As a post-WEBWAY enrichment step, or as an on-demand query-time module?
