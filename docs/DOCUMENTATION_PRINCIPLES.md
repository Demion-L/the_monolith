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
Research
  ↓  discovers facts, concepts, and patterns
Architecture Decisions (ADR)
  ↓  encode why a decision was made
Architecture
  ↓  describes what the system is today
Implementation
  ↓  source code and operational templates
Vision
     describes where the system is going
```

Each document belongs to exactly one layer.
Arrows show the direction of reference: lower layers may reference higher layers, not the reverse.

---

## Category Rules

### Research (`docs/research/`)

- Documents discoveries from external analysis, literature, or prototypes.
- Does NOT define architecture. Never describes the current system as a consequence of the research.
- Findings feed into ADRs. ADRs carry the architectural consequence.

### Architecture Decision Records (`docs/adr/`)

- Documents why an architectural decision was made.
- One decision per file.
- Status: `proposed | accepted | superseded | deprecated`.
- Must reference the research that motivated the decision.
- Must reference architecture documents that reflect the decision.

### Architecture (`docs/architecture/`)

- Describes the current system only.
- No future vision. No historical research narrative.
- References ADRs for justification.
- Updated when the system changes, not when plans change.

### Vision (`docs/vision/`)

- Describes direction, not implementation.
- No timelines. No committed deliverables.
- Informs future research and future ADRs.

---

## Document Identity Rules

- Every document has a stable ID in its frontmatter (`id:`).
- Research documents are numbered: `R-XXXX`.
- ADRs are numbered: `ADR-XXX`.
- Architecture and vision documents are named by domain.
- Numbering is permanent. Deprecated documents are marked deprecated, never renumbered.

---

## Cross-Reference Rules

- Research documents reference the ADRs they motivated.
- ADRs reference the research that informed them.
- Architecture documents reference both.
- The Lexicon Mechanicus is the canonical source for all terminology.
  Reference: `templates/default-instance/monolith/learning/taxonomy.md` (current) and future `docs/architecture/lexicon-mechanicus.md`.

---

## What Belongs Here vs the Template

| Content                              | Location              |
| ------------------------------------ | --------------------- |
| MONOLITH project research            | `docs/research/`      |
| MONOLITH architectural decisions     | `docs/adr/`           |
| MONOLITH system description (today)  | `docs/architecture/`  |
| MONOLITH long-term direction         | `docs/vision/`        |
| Operational template for instances   | `templates/`          |
| AI session protocols and skills      | `templates/...`       |

---

## Revision Policy

- Research documents are append-only after publication (add to "Open Questions" or create a follow-up document).
- ADRs are immutable once `accepted`. Supersession creates a new ADR.
- Architecture documents are updated continuously to reflect current state.
- Vision documents are revised when direction changes.
