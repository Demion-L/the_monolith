---
type: adr
id: ADR-003
title: Introduce Engineering Gate Foundation
date: 2026-06-26
status: accepted
related_decisions:
  - ADR-001
  - ADR-002
---

# ADR-003 — Introduce Engineering Gate Foundation

## Status

**Accepted** — 2026-06-26

---

## Context

MONOLITH currently governs memory and lifecycle for AI agents. WEBWAY transforms information into structured knowledge. ADR-001 and ADR-002 introduced the Cognitive Loop and Cognitive Core — the layers responsible for identifying what remains unknown and generating learning pressure.

However, none of these layers address the preparation of ambiguous engineering work for execution. The Cognitive Core can identify a gap. It can generate a question. What transforms that question — or any ambiguous engineering task — into something an executor agent can act on without further clarification?

Across multiple projects (myAPT, Second Brain, AgentCollect, Reasoning Projector, MONOLITH), a recurring pattern appeared before each successful implementation phase:

> Task → Scope → Source of Truth → Assumptions → Unknowns → Success Criteria → Implementation Plan → Execution

When this pattern was applied explicitly, implementation quality improved and rework decreased. When it was skipped, execution proceeded on implicit and often incorrect assumptions, requiring correction cycles. The pattern was real, recurring, and consistent across different domains and team compositions. It was never named.

The Engineering Gate names this pattern and establishes it as a first-class conceptual layer in MONOLITH's architecture.

---

## Decision

Introduce **Engineering Gate** as the conceptual name for the task-preparation layer of MONOLITH.

The Engineering Gate:

1. **Transforms ambiguous tasks into Implementation Packages** — structured artifacts that an executor agent can act on without further clarification from the problem originator.

2. **Sits between task identification and execution:**

   ```
   Ambiguous Task
       │
       ▼
   Engineering Gate
       │
       ▼
   Implementation Package
       │
       ▼
   Executor Pool
   ```

3. **Produces a required set of outputs** for every Implementation Package:
   - Scope definition (in-scope and explicitly out-of-scope)
   - Source of Truth (authoritative files, documents, systems)
   - Assumptions (declared, not implicit)
   - Unknowns / open questions (items requiring resolution before or during execution)
   - Success criteria (definition of done)
   - Architectural constraints (what must not be violated)
   - Recommended implementation plan (step-by-step starting point for the executor)

4. **Does not write code.** The Engineering Gate is a preparation layer. All code production belongs to the Executor Pool.

5. **Is separate from the Cognitive Core.** The Cognitive Core generates learning pressure by asking "What remains unknown?" The Engineering Gate asks "What is needed to execute this task?" They are distinct questions, distinct purposes, and distinct layers. The gate may receive inputs that originate from the Cognitive Core, but it does not duplicate the Core's function.

6. **Is a conceptual architecture layer, not a runtime module.** No source code is introduced. Implementation is deferred until the Implementation Package format is validated through use.

---

## Consequences

### Positive

- **Names a pattern that was already working.** The Engineering Gate does not introduce new behavior — it names and formalizes a preparation pattern that was already producing better outcomes across multiple projects.
- **Separates concerns between cognitive layers.** The Cognitive Core holds learning pressure; the Engineering Gate holds execution readiness. Each has a clear, non-overlapping purpose.
- **Reduces implicit decisions during execution.** By requiring scope, assumptions, and unknowns to be declared before execution begins, the gate surfaces decisions that would otherwise be made silently — and incorrectly — by the executor.
- **Provides a defined interface between the Cognitive Core and the Executor Pool.** When a Cognitive Core question is selected for implementation, it passes through the Engineering Gate before reaching the executor. This prevents the executor from receiving a raw gap as a task.
- **Establishes a permanent conceptual home** for all future engineering preparation concerns: scope management, assumption tracking, success criteria design, constraint declaration.

### Negative

- **Adds a preparation step before execution.** The Engineering Gate is not free — it requires time and effort to produce an Implementation Package. For small or well-understood tasks, this overhead may not be warranted. Judgment is required on when to apply the gate formally.
- **Implementation Package format is undefined.** This ADR establishes the outputs required but not the canonical format. Until the format is defined, the gate produces inconsistent artifacts. Format definition is deferred.

### Deferred

- Implementation Package format (YAML, markdown template, typed object — to be decided in a future story)
- Runtime implementation of the Engineering Gate as an executable layer
- Interface definition between Cognitive Core and Engineering Gate
- Interface definition between Engineering Gate and Executor Pool
- Feedback loop: how unknowns discovered during execution return to the Cognitive Core

---

## References

| Artifact | Role |
| -------- | ---- |
| `memory/long-term/engineering-gate.md` | Full definition of the Engineering Gate layer |
| `memory/long-term/cognitive-core.md` | Cognitive Core — the layer that may originate tasks for the gate |
| `adr/ADR-001-cognitive-loop-architecture.md` | Cognitive Loop — establishes the loop the gate supports |
| `adr/ADR-002-cognitive-core-foundation.md` | Cognitive Core Foundation — the preceding layer decision |
