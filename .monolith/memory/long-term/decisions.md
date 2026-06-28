---
type: memory
id: memory-long-term-decisions
category: long-term
authority: authoritative
related_protocols:
  - memory-governance
---

# Architectural Decisions

Accumulated architectural decisions for this project.

Updated by the finalize-story skill when a story introduces a significant design decision.

---

## Decision Template

```
### DEC-YYYY-XXXX — Decision Title

**Date:** YYYY-MM-DD
**Story:** STORY X.Y — Story Name
**Status:** Active | Superseded | Deprecated

**Context:** Why this decision was needed.
**Decision:** What was decided.
**Consequences:** What changes as a result.
```

---

## Decisions

### ADR-001 — Introduce Cognitive Loop Architecture

**Date:** 2026-06-24  
**Status:** Accepted  
**Full record:** `.monolith/adr/ADR-001-cognitive-loop-architecture.md`

**Decision:** Introduce Cognitive Loop Architecture as the canonical cognitive model for WEBWAY. Observe → Understand → Detect Gaps → Generate Questions → Learn → Update Mental Models → Observe. Cognitive Processes (KR-7) established as a first-class knowledge region. Existing v0 linear pipeline subsumed as the Observe/Understand phase of the loop.

---

### ADR-002 — Introduce Cognitive Core Foundation

**Date:** 2026-06-26  
**Status:** Accepted  
**Full record:** `.monolith/adr/ADR-002-cognitive-core-foundation.md`

**Decision:** Introduce Cognitive Core as the named conceptual layer that drives the Cognitive Loop. The Core holds the central question "What remains unknown?" and applies H8 (Predictive Power) as its epistemic criterion for gap prioritization. No runtime implementation; conceptual layer only. Closes the loop between WEBWAY's linear output and Knowledge Lifecycle Stage 1 re-entry.

---

### ADR-003 — Introduce Engineering Gate Foundation

**Date:** 2026-06-26
**Status:** Accepted
**Full record:** `.monolith/adr/ADR-003-engineering-gate-foundation.md`

**Decision:** Introduce Engineering Gate as the task-preparation layer of MONOLITH. Transforms ambiguous tasks into Implementation Packages (scope, source of truth, assumptions, unknowns, success criteria, constraints, implementation plan) before passing to executor agents. Does not write code. Separate from Cognitive Core: the Core generates learning pressure; the Gate prepares execution readiness. Pattern formalized from recurring use across myAPT, Second Brain, AgentCollect, Reasoning Projector, and MONOLITH.

---

### ADR-007 — Explicit-Only Identity Resolution in the Explicit Relationship Graph

**Date:** 2026-06-28
**Status:** Accepted
**Full record:** `docs/adr/ADR-007-explicit-identity-resolution.md`

**Decision:** Aliases in the Explicit Relationship Graph are registered only from explicit frontmatter metadata (`id:` → `documentId`, `title:` → `documentTitle`). No fuzzy matching, no embeddings, no probabilistic inference. First-document-wins on alias collision. Canonical label remains the H1 heading text.
