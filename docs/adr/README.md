---
type: meta
id: adr-index
authority: authoritative
---

# Architecture Decision Records

Catalog of architectural decisions made in the MONOLITH project. **This file is the only index of MONOLITH's ADRs.** All records are in this directory; MONOLITH has no other ADR directory (`monolith init` creates none).

ADRs answer one question: why was this architectural decision made?
They do not describe how the system works today — that is `docs/architecture/`.
MONOLITH has no research layer; research of Webway's program is owned by Webway.

---

## ADR Index

| ID      | Title                          | Status     | Research        | Date       |
| ------- | ------------------------------ | ---------- | --------------- | ---------- |
| [ADR-002](ADR-002-cognitive-core-foundation.md) | Cognitive Core Foundation — Cognitive Infrastructure (execution and integration); the Semantic Knowledge half is `webway:ADR-002`; scope narrowed 2026-10-28 | accepted | — | 2026-06-26 |
| [ADR-003](ADR-003-engineering-gate-foundation.md) | Engineering Gate Foundation | accepted | — | 2026-06-26 |
| [ADR-007](ADR-007-explicit-identity-resolution.md) | Explicit-Only Identity Resolution — superseded by ADR-020 | superseded | —            | 2026-06-28 |
| ADR-008 | Coordinatorium — Tactical Mission Lifecycle | accepted | — | 2026-10-21 |
| ADR-009 | monolithRoot Containment (SEC-001A) | accepted | — | 2026-10-22 |
| ADR-010 | Mission Control UI — Read-Only Local Interface over Core | accepted | — | 2026-10-22 |
| ADR-011 | Static `monolith validate` — No Execution of Project Code (SEC-002); ADR-010 is reserved for UI | accepted | — | 2026-10-22 |
| ADR-012 | Safe Writes and Explicit Write Scope (SEC-001B.2) | accepted | — | 2026-10-23 |
| ADR-013 | Filesystem Threat Model and Dynamic TOCTOU (SEC-001B.3) — documentation only; native layer deferred; pending independent architectural review | proposed | — | 2026-10-23 |
| ADR-014 | Unified Safe Read Contract (SEC-001B.1-R) — accepted as the implementation record of the merged read contract; basis of acceptance in the ADR itself; related to ADR-013 | accepted | — | 2026-10-23 |
| [ADR-015](ADR-015-lock-owner-identity-and-crash-recovery.md) | Lock Owner Identity & Crash Recovery (SEC-RECOVERY-001) — owner identity, alive/dead/unknown liveness, deadline/backoff, hardlink recovery; H1 and M1 addressed in `main` by LOCK-FIX-001/002, H2/M2 and LOCK-RELEASE-001 open; owner questions Q1–Q4 open | proposed | — | 2026-10-23 |
| [ADR-016](ADR-016-bounded-state-and-checkpoint-history.md) | Bounded State & Checkpoint History (STATE-003) — implementation not authorized; gated by G-LOCK (not passed) | proposed | — | 2026-10-23 |
| [ADR-017](ADR-017-durable-execution-state.md) | Durable Execution State (DURABLE-001) — domain-neutral event log for long-running agentic tasks; implemented on branch `feat/durable-state-001`, not merged; pending owner review | proposed | — | 2026-10-24 |
| [ADR-018](ADR-018-durable-state-failure-model.md) | Durable State Mode A Failure Model and Missing-State Semantics (DURABLE-001) — failure model, fail-closed `MISSING`, compatibility; accepted 2026-10-26; partially supersedes ADR-017 §2.4a–§2.4c once ADR-017 is accepted (see ADR-018 "Соотношение с ADR-017") | accepted | — | 2026-10-26 |
| [ADR-019](ADR-019-persisted-prune-decision-register.md) | Persisted Prune Decision Register (DURABLE-001, Design A) — immutable per-attempt prepare/decision register; accepted 2026-10-26; implementation (FIX-004) not started | accepted | — | 2026-10-26 |
| [ADR-020](ADR-020-canonical-knowledge-identity.md) | Canonical Knowledge Identity and Deterministic Reference Resolution in the ERG (`KnowledgeObject`, `namespace:localId`, `{#ID}`, resolver, conflicts); supersedes ADR-007 | accepted | — | 2026-10-28 |

**ADR-015 / ADR-016:** `proposed` ADRs on the lock foundation and bounded state. Neither is accepted; ADR-016 implementation is gated on ADR-015 (G-LOCK), which is not passed.

**ADR-001:** moved to Webway whole as `webway:ADR-001` (Cognitive Loop Architecture — part of Webway's epistemic architecture). The number is retired in MONOLITH, not reused. **ADR-002** was split: its Semantic Knowledge half is `webway:ADR-002`, the Cognitive Infrastructure half stays here as ADR-002 (see the record).

**ADR-004 … 006:** these numbers are not used in MONOLITH. The decisions belong to
Webway's cognitive-architecture research program and are owned there as
`webway:ADR-004`, `webway:ADR-005`, `webway:ADR-006`. The numbers are retired,
not reused, per the numbering rule below.

---

## ADR Statuses

| Status      | Meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| `proposed`  | Decision drafted but not yet approved                          |
| `accepted`  | Decision made and in effect                                    |
| `superseded`| Decision replaced by a newer ADR (link to replacement)        |
| `deprecated`| Decision no longer applies; system has moved on               |

---

## ADR Template

```markdown
---
type: adr
id: ADR-XXX
title: Decision Title
status: proposed | accepted | superseded | deprecated
date: YYYY-MM-DD
research:
  - R-XXXX
superseded_by: ADR-XXX (if applicable)
---

## Context

Why this decision was needed. What problem it solves.

## Decision

What was decided. One clear statement.

## Rationale

Why this option was chosen over alternatives.

## Alternatives Considered

What else was evaluated and why it was rejected.

## Consequences

What changes as a result. What becomes easier. What becomes harder.

## References

Cross-references to research, architecture documents, and related ADRs.
```

---

## Notes on ADR-001 through ADR-003

**Update (2026-10-28, KNOWLEDGE-003):** the paragraph below describes where these records were on 2026-10-20. They are no longer in `.monolith/adr/` (that directory no longer exists): ADR-002 and ADR-003 are in this directory, ADR-001 moved to Webway as `webway:ADR-001`. The "ADR-011 or later" rule below is long past: ADR-007 … 020 are in use, ADR-001, 004 … 006 are retired, and the next free number is ADR-021.

**Correction (2026-10-20):** This section previously described ADR-001
through ADR-003 as "reserved" slots for retroactively documenting the
Kernel-Instance split, the file-based memory model, and deterministic
protocol enforcement. That was incorrect — those three IDs were already in
use by `.monolith/adr/ADR-001-cognitive-loop-architecture.md`,
`ADR-002-cognitive-core-foundation.md`, and
`ADR-003-engineering-gate-foundation.md` (all dated 2026-06-24/26, before
this `docs/adr/` index existed). The ADR index above now reflects that.

The three candidate decisions originally meant for this slot are still
undocumented and still worth writing up, but **must use new IDs (ADR-011 or
later)** — ADR-008 is taken by Coordinatorium's Tactical Mission
Lifecycle (2026-10-21), ADR-009 by monolithRoot Containment (2026-10-22) and ADR-010 by the Mission Control UI (2026-10-22) — to avoid colliding with the existing ADR-001/002/003:
- Kernel-Instance split (`templates/` vs operational instance)
- File-based, human-readable memory model
- Deterministic protocol enforcement (no LLM in the governance gate)

Writing those is a separate, future decision — not done as part of this
cleanup.
