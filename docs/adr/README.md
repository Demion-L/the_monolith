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
| ADR-001 | (reserved — early decisions)   | —          | —               | —          |
| ADR-002 | (reserved — early decisions)   | —          | —               | —          |
| ADR-003 | (reserved — early decisions)   | —          | —               | —          |
| ADR-004 | Terra vs Graph Memex           | accepted   | R-0001, R-0002  | 2026-06-28 |
| ADR-005 | Lexicon Mechanicus             | accepted   | R-0001, R-0003  | 2026-06-28 |
| ADR-006 | Terra Persistence Strategy     | proposed   | R-0001, R-0002  | 2026-06-28 |

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

ADR-001 through ADR-003 are reserved for early architectural decisions made before the formal ADR system was established. These should be documented retroactively as time permits.

Candidates:
- ADR-001: Kernel-Instance split (`templates/` vs operational instance)
- ADR-002: File-based, human-readable memory model
- ADR-003: Deterministic protocol enforcement (no LLM in the governance gate)
