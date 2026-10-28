---
type: adr
id: ADR-002
title: Cognitive Core Foundation — Cognitive Infrastructure (execution and integration)
date: 2026-06-26
status: accepted
related_decisions:
  - webway:ADR-001
  - webway:ADR-002
  - ADR-003
related_hypotheses:
  - webway:HYP-007
  - webway:HYP-008
---

# ADR-002 — Cognitive Core Foundation — Cognitive Infrastructure (execution and integration)

## Status

**Accepted** — 2026-06-26. **Scope narrowed 2026-10-28** (KNOWLEDGE-003, see "Split of responsibility").

**Implementation status (2026-10-28):** Not implemented. This ADR is a
decision-level record; no code in `src/` corresponds to a Cognitive Core.
Nothing here authorizes building one.

---

## Split of responsibility

The original ADR-002 introduced one concept, the **Cognitive Core**, which holds
two responsibilities. By the owner's decision of 2026-10-28:

| Responsibility | Owner | Record |
| -------------- | ----- | ------ |
| **Semantic Knowledge** — the central question "What remains unknown?", its three sub-questions, the HYP-008 epistemic criterion for gap prioritization, the closing of the Cognitive Loop in knowledge terms | Webway | `webway:ADR-002` (Webway repository, `docs/adr/ADR-002-cognitive-core-foundation.md`) |
| **Cognitive Infrastructure** — how such a capability would be executed, governed and integrated into a MONOLITH instance | MONOLITH | this ADR |

"Cognitive Infrastructure" here names that responsibility only. It is **not** the
Webway vision document `docs/architecture/cognitive-infrastructure.md`, which
describes the Cognitive Kernel research program.

The cognitive loop itself (`webway:ADR-001`) is Webway's, and was moved there whole.
The original text of this ADR (as accepted on 2026-06-26) is in git history of
`.monolith/adr/`; the semantic text was moved to Webway, not rewritten.

Below are only the passages of the original ADR-002 and of the concept document
`cognitive-core.md` that concern execution and integration (items 1–3), plus the
Gap → Story link stated in `knowledge-lifecycle.md` and `story-lifecycle.md`
("questions become new Stories"). Item 3's wording that the capability opens no
Story by itself is the application of item 2, not a new rule.

---

## Context

A capability that detects knowledge gaps and generates questions needs a host that
runs it, bounds what it may do and connects its output to the work a project
actually does. MONOLITH is that host: it governs how AI agents work in a project
(memory, stories, protocols). It does not decide what the capability concludes —
that is the semantic responsibility of Webway.

---

## Decision

MONOLITH is responsible for the **execution and integration** of a Cognitive Core,
and for nothing in its semantics.

1. **Conceptual only.** The Cognitive Core is a conceptual architecture layer, not a
   runtime module. No source code is introduced. Implementation of its semantic side
   is gated by Webway (`webway:ADR-002`: HYP-008 validation and a formal gap
   representation). MONOLITH adds its own gate below.

2. **Suggest-only, inside governance.** When implemented, the Cognitive Core will
   suggest gaps and candidate questions. It will not autonomously acquire artifacts,
   modify protocols, or act outside the governance constraints of the instance.
   Autonomy requires explicit capability expansion through the governance layer
   (core invariants: no autonomous capability expansion).

3. **Integration points are decided later, by story.** Two are named and both are
   open:
   - *Placement.* Where the capability runs in MONOLITH — post-processing step,
     on-demand module, boot-sequence integration — requires capability-registry
     design (open Unknown of `webway:HYP-006`).
   - *Gap → Story.* A detected gap becomes a question; a question that is worth
     pursuing becomes a Story. Creating that Story stays under story discipline
     (`story-lifecycle.md`, `finalize-story`); the capability does not open Stories
     by itself.

4. **MONOLITH does not own the semantics.** The central question, the supporting
   questions, the epistemic criterion, gap prioritization, the Knowledge Lifecycle
   and Knowledge Regions belong to Webway. MONOLITH documents do not restate them;
   they link to Webway.

---

## Consequences

### Positive

- One owner per responsibility; no document restates the other repository's content.
- The governance boundary (suggest-only) is recorded in the repository that enforces
  governance, not in a research document.

### Negative

- The decision is thin by construction: execution and integration have no
  implementation, interface or capability registry yet. It records a boundary, not a
  design.
- A reader needs two repositories to see the whole concept.

### Deferred

- Capability-registry design and the placement decision (open Unknown of `webway:HYP-006`).
- The interface between the Cognitive Core and the Engineering Gate, and the feedback
  loop from execution back to the Core (see ADR-003, "Deferred").
- Any implementation of `detectGaps()` / `generateQuestions()` — gated by Webway first.

---

## References

| Artifact | Role |
| -------- | ---- |
| `webway:ADR-002` | Semantic Knowledge half of the original ADR-002 (Webway) |
| `webway:ADR-001` | Cognitive Loop Architecture (Webway) |
| Webway `docs/architecture/cognitive-core.md` | Definition of the Cognitive Core's semantic side |
| `webway:HYP-006` | Origin of the capability-registry / placement Unknown |
| ADR-003 | Engineering Gate — the layer between a selected question and the executor |
| `.monolith/memory/long-term/story-lifecycle.md` | Story discipline that governs what becomes a Story |
