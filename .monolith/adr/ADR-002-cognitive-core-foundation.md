---
type: adr
id: ADR-002
title: Introduce Cognitive Core Foundation
date: 2026-06-26
status: accepted
related_hypotheses:
  - H7
  - H8
related_regions:
  - KR-6
  - KR-7
related_decisions:
  - ADR-001
---

# ADR-002 — Introduce Cognitive Core Foundation

## Status

**Accepted** — 2026-06-26

---

## Context

ADR-001 introduced the Cognitive Loop Architecture and established Cognitive Processes (KR-7) as a first-class knowledge region. That decision formalized the gap detection and question generation loop as the long-term direction for WEBWAY.

However, ADR-001 did not name the architectural layer responsible for executing that loop. The concepts lived in H7 and KR-7, but the layer itself — the thing that holds the central question "What remains unknown?" and drives the loop — was not defined as a first-class architectural concept.

Separately, H8 (Predictive Power as a Measure of Knowledge) proposed that knowledge maturity should be measured not only by quantity and stability, but by the ability to generate accurate inferences about unseen information. H8 implies that gap detection must be guided by an epistemic criterion: not all absent links are gaps worth pursuing; gaps that would increase a region's predictive capability are prioritized.

Without a named concept for the layer that holds both the central question and the H8 epistemic criterion, the architecture remained incomplete. The Cognitive Loop Architecture described the loop but not the agent that runs it.

---

## Decision

Introduce **Cognitive Core** as the conceptual name for the future self-directed learning layer of MONOLITH.

The Cognitive Core:

1. **Holds the central question: "What remains unknown?"** — supported by three operational sub-questions:
   - What contradiction has not been resolved?
   - What missing link would make this region more predictive?
   - What question should be asked next?

2. **Closes the Cognitive Loop** defined in ADR-001 by connecting WEBWAY's linear output (Mental Models) back to Information acquisition (Stage 1 of the Knowledge Lifecycle):

   ```
   Mental Models
     → Cognitive Core: What remains unknown?
       → Gap Detection
         → Question Generation
           → Learning (new artifact acquisition)
             → Information (Stage 1 — loop re-enters)
   ```

3. **Applies H8 as its epistemic criterion** for gap prioritization. The Cognitive Core does not detect all absent links; it detects gaps whose resolution would increase a Knowledge Region's capacity for inference over unseen information.

4. **Is a conceptual architecture layer, not a runtime module.** No source code is introduced. Implementation is deferred until: (a) H8 validation criteria are met on at least one Knowledge Region, and (b) gap representation is formally defined.

---

## Consequences

### Positive

- **Names the missing layer** in the ADR-001 cognitive loop. The loop now has a named driver, not just named phases.
- **Links H7 and H8 into a single architectural concept.** The Cognitive Core is the layer where H7 (gap detection and question generation) and H8 (epistemic criterion for gap prioritization) converge.
- **Extends the Knowledge Lifecycle from linear to circular.** Stage 7 (Knowledge Region) is no longer a terminal stage — it is the input to the Cognitive Core, which generates Stage 1 targets.
- **Establishes non-goals explicitly.** The Cognitive Core concept document (cognitive-core.md) formally excludes claims of consciousness, autonomous agency, and premature runtime implementation. This prevents scope creep and mystical framing.
- **Provides a named anchor for future implementation stories.** `detectGaps()`, `generateQuestions()`, and predictive region evaluation now have a clear conceptual home.

### Negative

- **Increases conceptual scope before implementation.** Adding a named architectural layer that does not yet exist in code creates a gap between the documented architecture and the actual system. Future agents must distinguish between what is implemented and what is conceptual.
- **H8 is a dependency.** The Cognitive Core's epistemic criterion (predictive gap prioritization) cannot be applied until H8 is validated. Until then, gap prioritization must remain undefined or use a simpler heuristic.

### Deferred

- Implementation of `detectGaps()` — requires formal gap representation design
- Implementation of `generateQuestions()` — requires gap detection first
- Predictive region evaluation — blocked on H8 validation (holdout task with measured accuracy)
- Integration into MONOLITH boot sequence — requires capability registry design (H6 Unknown)

---

## References

| Artifact | Role |
| -------- | ---- |
| `memory/long-term/cognitive-core.md` | Full definition of the Cognitive Core layer |
| `memory/long-term/hypotheses.md` H7 | Continuous Question Loop — the loop the Cognitive Core drives |
| `memory/long-term/hypotheses.md` H8 | Predictive Power — the epistemic criterion the Cognitive Core applies |
| `memory/long-term/knowledge-lifecycle.md` | Knowledge Lifecycle — made circular by the Cognitive Core |
| `memory/long-term/knowledge-regions.md` | Epistemic level axis (proposed) — the second axis the Cognitive Core uses for gap prioritization |
| `adr/ADR-001-cognitive-loop-architecture.md` | Cognitive Loop Architecture — the loop this decision names the driver of |
