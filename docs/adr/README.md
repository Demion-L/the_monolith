---
type: meta
id: adr-index
authority: authoritative
---

# Architecture Decision Records

Catalog of architectural decisions made in the MONOLITH project.

ADRs answer one question: why was this architectural decision made?
They do not describe how the system works today — that is `docs/architecture/`.
They do not describe what was researched — that is `docs/research/`.

---

## ADR Index

| ID      | Title                          | Status     | Research        | Date       |
| ------- | ------------------------------ | ---------- | --------------- | ---------- |
| ADR-001 | Cognitive Loop Architecture (`.monolith/adr/`) | accepted | — | 2026-06-24 |
| ADR-002 | Cognitive Core Foundation (`.monolith/adr/`) | accepted | — | 2026-06-26 |
| ADR-003 | Engineering Gate Foundation (`.monolith/adr/`) | accepted | — | 2026-06-26 |
| ADR-004 | Terra vs Graph Memex           | accepted   | R-0001, R-0002  | 2026-06-28 |
| ADR-005 | Lexicon Mechanicus             | accepted   | R-0001, R-0003  | 2026-06-28 |
| ADR-006 | Terra Persistence Strategy     | proposed   | R-0001, R-0002  | 2026-06-28 |
| ADR-007 | Explicit-Only Identity Resolution | accepted | —            | 2026-06-28 |

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

**Correction (2026-10-20):** This section previously described ADR-001
through ADR-003 as "reserved" slots for retroactively documenting the
Kernel-Instance split, the file-based memory model, and deterministic
protocol enforcement. That was incorrect — those three IDs were already in
use by `.monolith/adr/ADR-001-cognitive-loop-architecture.md`,
`ADR-002-cognitive-core-foundation.md`, and
`ADR-003-engineering-gate-foundation.md` (all dated 2026-06-24/26, before
this `docs/adr/` index existed). The ADR index above now reflects that.

The three candidate decisions originally meant for this slot are still
undocumented and still worth writing up, but **must use new IDs (ADR-008 or
later)** to avoid colliding with the existing ADR-001/002/003:
- Kernel-Instance split (`templates/` vs operational instance)
- File-based, human-readable memory model
- Deterministic protocol enforcement (no LLM in the governance gate)

Writing those is a separate, future decision — not done as part of this
cleanup.
