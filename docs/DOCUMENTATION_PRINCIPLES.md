---
type: meta
id: documentation-principles
authority: authoritative
stability: stable
---

# Documentation Principles

Rules for the MONOLITH knowledge base.

---

## Foundational Document

`MANIFESTO.md` (project root) sits outside the knowledge hierarchy. It is the philosophical and engineering foundation of the project — the answer to why MONOLITH exists and what principles govern it. All other documentation is subordinate to it in spirit, though not in the reference hierarchy below.

---

## Knowledge Hierarchy

```
Architecture Decisions (ADR)
  ↓  encode why a decision was made
Architecture
  ↓  describes what the system is today
Implementation
     source code and operational templates
```

Each document belongs to exactly one layer.
Arrows show the direction of reference: lower layers may reference higher layers, not the reverse.

**2026-10-21:** This hierarchy previously included a `Research` layer
(`docs/research/`) above ADRs and a `Vision` layer (`docs/vision/`) below
Implementation. Both described Webway's cognitive-architecture research
program, not MONOLITH's own toolkit, and moved to
[the Webway repository](https://github.com/Demion-L/webway) along with
ADR-004/005/006. Re-add these layers here if MONOLITH's own toolkit ever
needs them — see `docs/MIGRATION_REPORT.md`.

---

## Category Rules

### Architecture Decision Records (`docs/adr/`)

- Documents why an architectural decision was made.
- One decision per file.
- Status: `proposed | accepted | superseded | deprecated`.
- Must reference architecture documents that reflect the decision.

### Architecture (`docs/architecture/`)

- Describes the current system only.
- No future vision. No historical research narrative.
- References ADRs for justification.
- Updated when the system changes, not when plans change.

---

## Document Identity Rules

- Every document has a stable ID in its frontmatter (`id:`).
- ADRs are numbered: `ADR-XXX`.
- Architecture documents are named by domain.
- Numbering is permanent. Deprecated documents are marked deprecated, never renumbered.

---

## Cross-Reference Rules

- ADRs reference the architecture documents they inform.
- Architecture documents reference the ADRs that justify them.
- Terminology follows plain usage — see `AGENTS.md` → Glossary. The
  "Lexicon Mechanicus" (ADR-005) is Webway's own formal vocabulary system,
  not MONOLITH's.

---

## What Belongs Here vs the Template

| Content                              | Location              |
| ------------------------------------ | --------------------- |
| MONOLITH architectural decisions     | `docs/adr/`           |
| MONOLITH system description (today)  | `docs/architecture/`  |
| Operational template for instances   | `templates/`          |
| AI session protocols and skills      | `templates/...`       |

---

## Revision Policy

- ADRs are immutable once `accepted`. Supersession creates a new ADR.
- Architecture documents are updated continuously to reflect current state.
