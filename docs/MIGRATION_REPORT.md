---
type: meta
id: migration-report
date: 2026-06-28
---

# Documentation Migration Report

Knowledge base reorganization for MONOLITH. Completed 2026-06-28.

---

## Summary

The MONOLITH documentation was reorganized from a single mixed structure into four distinct knowledge categories: Research, Architecture Decision Records, Architecture, and Vision.

A new `docs/` directory was created at the project root. The operational template (`templates/`) was not moved — it remains the deployment artifact for MONOLITH instances. The `docs/` directory is the project's own long-term knowledge base.

---

## Documents Created

### Meta

| File                                  | Purpose                                       |
| ------------------------------------- | --------------------------------------------- |
| `docs/README.md`                      | Knowledge base navigation index               |
| `docs/DOCUMENTATION_PRINCIPLES.md`   | Documentation rules, layer hierarchy, update policy |
| `docs/MIGRATION_REPORT.md`           | This file                                     |

### Research (`docs/research/`)

| File                                          | Contents                                          |
| --------------------------------------------- | ------------------------------------------------- |
| `docs/research/README.md`                     | Research index, document structure template       |
| `docs/research/R-0001-iai-personal-memory-engine.md` | Full research document: IAI PME analysis   |
| `docs/research/R-0002-oracle-memory-systems.md`      | Oracle memory pattern analysis             |
| `docs/research/R-0003-cognitive-architecture-notes.md` | ACT-R, SOAR, GWT, predictive coding     |

### ADR (`docs/adr/`)

| File                                              | Contents                                      |
| ------------------------------------------------- | --------------------------------------------- |
| `docs/adr/README.md`                              | ADR index, template, ADR status definitions   |
| `docs/adr/ADR-004-terra-vs-graph-memex.md`        | Terra chosen over Graph Memex as substrate    |
| `docs/adr/ADR-005-lexicon-mechanicus.md`          | Lexicon Mechanicus as canonical vocabulary    |
| `docs/adr/ADR-006-terra-persistence-strategy.md`  | Terra implementation strategy (proposed)      |

### Architecture (`docs/architecture/`)

| File                                          | Contents                                              |
| --------------------------------------------- | ----------------------------------------------------- |
| `docs/architecture/README.md`                 | Architecture index, update policy                     |
| `docs/architecture/cognitive-infrastructure.md` | System layers, components, Lexicon Mechanicus vocabulary |
| `docs/architecture/memory-architecture.md`    | Memory tiers, knowledge regions, governance, current state |
| `docs/architecture/knowledge-pipeline.md`     | Ingestion → working memory → consolidation → learning |

### Vision (`docs/vision/`)

| File                                   | Contents                                                  |
| -------------------------------------- | --------------------------------------------------------- |
| `docs/vision/README.md`               | Vision index, update policy                               |
| `docs/vision/long-term-vision.md`     | Cognitive loop, attention, world model, REM/NREM, etc.    |

---

## Documents Moved

None. No existing documents were moved. The `templates/` directory remains intact.

**Rationale:** The `templates/` directory contains the operational instance template — the artifact that is deployed into user projects via `monolith init`. This is distinct from the MONOLITH project's own knowledge base. Merging them would confuse the deployment artifact with the project's internal documentation.

---

## Documents Split

No documents were split. The migration created new documents from knowledge that previously existed only in conversation context, research discussions, and architectural analysis sessions — not in any existing file.

---

## Documents Deprecated

None. No existing template documents were deprecated.

---

## Documents Updated

| File                                                                        | Change                                        |
| --------------------------------------------------------------------------- | --------------------------------------------- |
| `templates/default-instance/monolith/context/maps/project-map.md`          | Added `## Knowledge Base` section pointing to `docs/` |

---

## Cross-References Added

### Research → ADR

| From               | References                 |
| ------------------ | -------------------------- |
| R-0001             | ADR-004, ADR-005, ADR-006  |
| R-0002             | ADR-004, ADR-006           |
| R-0003             | ADR-005                    |

### ADR → Research

| From     | References         |
| -------- | ------------------ |
| ADR-004  | R-0001, R-0002     |
| ADR-005  | R-0001, R-0003     |
| ADR-006  | R-0001, R-0002     |

### ADR → ADR

| From     | References  |
| -------- | ----------- |
| ADR-004  | ADR-006     |
| ADR-005  | ADR-004     |
| ADR-006  | ADR-004     |

### Architecture → ADR and Research

| From                       | References                           |
| -------------------------- | ------------------------------------ |
| cognitive-infrastructure   | ADR-004, ADR-005                     |
| memory-architecture        | ADR-004, ADR-006, R-0001, R-0002     |
| knowledge-pipeline         | ADR-004, ADR-005, R-0001, R-0002, R-0003 |

### Vision → Research

| From               | References             |
| ------------------ | ---------------------- |
| long-term-vision   | R-0001, R-0002, R-0003 |

### Architecture → Template

| From                       | References                                    |
| -------------------------- | --------------------------------------------- |
| cognitive-infrastructure   | `protocols/governance/core-invariants.md`     |
| cognitive-infrastructure   | `context/maps/routing-map.md`                 |
| cognitive-infrastructure   | `context/maps/semantic-map.md`                |
| memory-architecture        | `protocols/governance/memory-governance.md`   |
| memory-architecture        | `context/maps/routing-map.md` (Table 4)       |

---

## Future Work

### ADR-001 through ADR-003 (retroactive)

Three ADR slots are reserved for early architectural decisions made before the formal ADR system was established. These should be written retroactively:

- **ADR-001 (candidate):** Kernel-Instance split — the decision to separate the generic enforcement Kernel from project-specific Instance configuration
- **ADR-002 (candidate):** File-based, human-readable memory model — the decision to use markdown files with YAML frontmatter rather than a database
- **ADR-003 (candidate):** Deterministic protocol enforcement — the decision to exclude LLM inference from the governance gate

### Lexicon Mechanicus document

ADR-005 establishes the Lexicon Mechanicus as the canonical vocabulary source. The vocabulary itself is currently embedded in `docs/architecture/cognitive-infrastructure.md`. A dedicated `docs/architecture/lexicon-mechanicus.md` document should be created as the vocabulary grows.

### Research pipeline tooling

The `docs/vision/long-term-vision.md` describes a Research Pipeline as a future vision. Initial tooling could be as simple as:
- A required "Open Questions" section in every research document (already included)
- A tracking table in `docs/research/README.md` mapping open questions to the research documents that raised them
- A governance rule enforcing that new terms appear in the Lexicon Mechanicus before appearing in other documents

### Cross-reference validation

A future governance validator (`monolith validate`) extension should verify:
- Every ADR references at least one research document
- Every research document's "Follow-up ADRs" section lists valid ADR IDs
- Every architecture document's `related_adrs` frontmatter lists accepted ADRs

### Staleness monitoring

A governance rule or validator that flags architecture documents not updated within N stories, prompting review to confirm they still reflect current system state.
