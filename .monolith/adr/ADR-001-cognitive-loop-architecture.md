---
type: adr
id: ADR-001
title: Introduce Cognitive Loop Architecture
date: 2026-06-24
status: accepted
related_hypotheses:
  - H7
related_regions:
  - KR-7
---

# ADR-001 — Introduce Cognitive Loop Architecture

## Status

**Accepted** — 2026-06-24

---

## Context

WEBWAY was originally modeled as a linear transformation pipeline:

```
Information
  → Concepts
    → Semantic Links
      → Knowledge Regions
        → Mental Models
```

This pipeline is sufficient for knowledge formation from a single artifact. However, it has no feedback mechanism. Once a Mental Model is produced, the system stops. It does not ask what it does not yet know. It does not direct its own next input.

During architectural exploration (H7 — Continuous Question Loop), a missing layer was identified:

```
Mental Models
  → Gap Detection         ← what is absent or weak in the current model?
    → Question Generation  ← what would resolve the gap?
      → Learning            ← acquire artifact that answers the question
        → Mental Models     ← update model with new knowledge
```

This creates a **closed cognitive loop** — the first in the MONOLITH worldview. It transforms WEBWAY from a knowledge formation tool into a self-directed learning system.

The loop is structurally distinct from the linear pipeline. It requires its own knowledge region (KR-7 — Cognitive Processes) to house the concepts: Question Loop, Curiosity, Gap Detection, Learning, Model Reconciliation, Self-Reflection.

Without formalizing this architecture as a first-class decision, the loop risks being treated as a feature addition rather than a foundational shift in the system's cognitive model.

---

## Decision

Introduce **Cognitive Loop Architecture** as the canonical model for WEBWAY's full cognitive cycle.

The complete architecture is:

```
┌─────────────────────────────────────────────────────┐
│                  Cognitive Loop                     │
│                                                     │
│   Observe                                           │
│     → Understand      (concept extraction)          │
│       → Detect Gaps   (missing links, weak models)  │
│         → Generate Questions  (curiosity signal)    │
│           → Learn     (acquire new artifacts)       │
│             → Update Mental Models                  │
│               → Observe       (loop continues)      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

This decision establishes:

1. **Cognitive Processes is a first-class knowledge region** (KR-7). It is not a sub-feature of WEBWAY or Agent Systems. It is a distinct semantic domain with its own concepts and relationships.

2. **The linear pipeline (v0) remains valid** as the Observe → Understand phase of the loop. All existing types and functions are unchanged. The loop extends, not replaces, the pipeline.

3. **Gap Detection is a future module boundary**, not a feature of `analyzeArtifact()`. The loop's closed structure implies a future `detectGaps(result: WebwayAnalysisResult): Gap[]` surface, but this is deferred. This ADR establishes the architecture; implementation stories will follow.

4. **The loop is the long-term product direction** of WEBWAY. Hypotheses H1–H7 are all coherent with this architecture. H7 is the first hypothesis that directly targets the loop's feedback mechanism.

---

## Consequences

### Positive

- **Transforms MONOLITH from knowledge storage toward knowledge formation.** The loop gives the system a mechanism to improve its own knowledge structures without external prompting.
- **Creates foundation for curiosity-driven learning.** Gap Detection + Question Generation operationalizes the cognitive behavior described in H7 and grounded in Loewenstein's information-gap theory.
- **Provides a permanent home for Question Loop systems.** KR-7 (Cognitive Processes) is the canonical region for all future concepts in this domain.
- **Aligns the full artifact suite.** H7 (hypotheses.md), KR-7 (knowledge-regions.md), and this ADR now form a coherent, cross-referenced chain of reasoning.
- **The existing v0 pipeline is subsumed, not broken.** The loop's first two phases (Observe, Understand) are exactly what `analyzeArtifact()` implements today.

### Negative

- **Increases architectural complexity.** A closed loop is harder to reason about than a linear pipeline. Future agents reading this codebase must understand both the pipeline (v0) and the loop (full architecture) without conflating them.
- **Introduces need for gap-detection mechanisms.** Gap Detection is not yet implemented. Until it is, the loop is open at the feedback point — the architecture is aspirational in this phase.
- **Creates risk of noisy question generation.** Not every absent link represents a knowledge gap. A question generator without quality filters will produce false positives. Filtering strategy is an open design problem (documented in H7 Unknowns).

### Deferred

- Implementation of `detectGaps()` — requires a future story
- Implementation of `generateQuestions()` — requires gap detection first
- Integration of the loop into the MONOLITH boot sequence — requires capability registry design (H6 Unknown)

---

## References

| Artifact | Role |
| -------- | ---- |
| `memory/long-term/hypotheses.md` H7 | Origin hypothesis for the Question Loop concept |
| `memory/long-term/knowledge-regions.md` KR-7 | Conceptual home for Cognitive Processes |
| `memory/long-term/knowledge-regions.md` KR-6 | WEBWAY region — the loop's Observe/Understand phase |
| `docs/webway-v0.md` | Current v0 pipeline specification |
| `src/webway/types.ts` | Types implementing the linear pipeline |
