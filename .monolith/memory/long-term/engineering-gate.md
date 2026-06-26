---
type: memory
id: memory-long-term-engineering-gate
category: long-term
authority: authoritative
related_protocols:
  - memory-governance
related_decisions:
  - ADR-003
---

# Engineering Gate — Conceptual Foundation

The Engineering Gate is the proposed task-preparation layer of MONOLITH.

This document defines its purpose, flow, outputs, origin, and relationships to other layers.  
It is a conceptual artifact. No runtime components exist yet.

---

## Purpose

Ambiguous engineering work fails not because the executors are incapable, but because the task handed to them is insufficiently defined. The executor receives incomplete scope, undeclared assumptions, unknown constraints, and no shared definition of success. The result is iteration on the wrong implementation, rework, and decisions made implicitly during execution that should have been made explicitly before.

The Engineering Gate is the layer that transforms an ambiguous task into an Implementation Package — a structured artifact that an executor agent can act on without further clarification.

The Engineering Gate does **not** write code. It prepares work for those who do.

---

## Flow

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

The Engineering Gate sits between problem identification and implementation. It is a transformation layer, not a decision layer. It does not decide what to build — it makes explicit what has already been decided so that the executor can act on it without ambiguity.

---

## Implementation Package — Required Outputs

An Implementation Package produced by the Engineering Gate must contain:

| Output | Purpose |
| ------ | ------- |
| **Scope definition** | What is in scope and what is explicitly out of scope. Prevents scope creep during execution. |
| **Source of Truth** | Which files, documents, or systems are authoritative for this task. Executors must know where to look, not guess. |
| **Assumptions** | What the gate treats as given. If an assumption is wrong, the implementation plan may be wrong. Declaring assumptions makes them auditable. |
| **Unknowns / Open questions** | What is not yet decided or not yet known. Items here must be resolved before or during execution — not silently assumed away. |
| **Success criteria** | How to determine that the task is complete and correct. Without this, "done" is ambiguous. |
| **Architectural constraints** | What the implementation must not violate. Technology choices, interface contracts, layer boundaries, governance rules. |
| **Recommended implementation plan** | A step-by-step sequence the executor can follow. Not mandatory — executors may diverge if they have sufficient reason — but provides a starting point grounded in the scope and constraints above. |

---

## Why This Exists

The same pre-implementation pattern appeared repeatedly across multiple projects before this was named:

> Task → Scope → Source of Truth → Assumptions → Unknowns → Success Criteria → Implementation Plan → Execution

This pattern was observed in:

- **myAPT** — apartment management tooling
- **Second Brain** — personal knowledge system
- **AgentCollect** — agent data collection infrastructure
- **Reasoning Projector** — structured reasoning over accumulated knowledge
- **MONOLITH** — this system itself

In each case, implementation quality improved when this preparation phase was done explicitly. In each case where it was skipped, implementation required more rework cycles. The Engineering Gate names this recurring pattern and establishes it as a first-class architectural layer, so it is applied consistently rather than informally.

---

## Relationships

### Relationship to Cognitive Core

The Cognitive Core and the Engineering Gate are separate layers with different purposes.

| Layer | Question | Direction |
| ----- | -------- | --------- |
| Cognitive Core | What remains unknown? | Learning pressure — identifies gaps in world model |
| Engineering Gate | What is needed to execute this task? | Execution readiness — prepares work for implementation |

The Cognitive Core generates questions and learning directives. It may produce a candidate question or gap that becomes an engineering task.

The Engineering Gate may receive that question or task and transform it into an Implementation Package — defining scope, assumptions, and success criteria for the executor who will resolve it.

The flow is:

```
Cognitive Core → [gap / question detected]
    │
    ▼ (if task is selected for execution)
Engineering Gate → [Implementation Package]
    │
    ▼
Executor Pool → [implementation]
```

Not every question from the Cognitive Core passes through the Engineering Gate. The gate applies when a gap is selected for active implementation, not for every detected unknown.

### Relationship to Knowledge Lifecycle

The Engineering Gate operates above the Knowledge Lifecycle. It uses knowledge already present in MONOLITH's memory (scope, decisions, principles, hypotheses) to define the Implementation Package. It is a consumer of Knowledge Regions, not a producer.

### Relationship to WEBWAY

WEBWAY's output (concepts, semantic links, knowledge region assignments, mental models) may be consumed by the Engineering Gate as Source of Truth or as context for scope definition. WEBWAY does not interact with the gate directly — they communicate through MONOLITH's memory layer.

---

## Non-Goals

- **The Engineering Gate does not write code.** It prepares the conditions for code to be written correctly.
- **The Engineering Gate does not make architectural decisions.** Those belong to the governance layer (ADRs, principles). It surfaces constraints and references them; it does not create them.
- **The Engineering Gate does not generate learning pressure.** That is the Cognitive Core's role. The gate transforms selected tasks into executable packages, it does not identify what should be learned.
- **Do not implement as a runtime module yet.** The gate exists as a conceptual layer. Implementation stories follow when the interface is validated by use.

---

## Current State

| Component | Status |
| --------- | ------ |
| Pattern identified across projects | Yes — this document |
| Conceptual layer defined | Yes — this document |
| ADR-003 (Engineering Gate Foundation) | Proposed — 2026-06-26 |
| Runtime implementation | Deferred |
| Interface with Cognitive Core | Deferred |
| Interface with Executor Pool | Deferred |

---

## Open Questions

- What is the canonical format for an Implementation Package? A structured YAML block? A markdown template? A typed object?
- Who triggers the Engineering Gate? The Cognitive Core, the human operator, or both?
- How are unknowns tracked across the gate boundary — if an unknown is discovered during execution, does it feed back into the Cognitive Core?
- Should the Engineering Gate validate that the Implementation Package is complete before releasing it to the executor? What are the validation criteria?
