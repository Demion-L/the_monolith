---
type: meta
id: architecture-index
authority: authoritative
---

# Architecture

Current system description for MONOLITH — the toolkit, as implemented.

These documents describe what the system is today.
Not future vision. Not historical research.

For the reasoning behind each design choice, see `docs/adr/`.

MONOLITH currently has no active `docs/research/` or `docs/vision/`
directory of its own — that cognitive-architecture research and vision
program moved to [Webway](https://github.com/Demion-L/webway) on
2026-10-21, along with ADR-004/005/006 and this directory's former
`cognitive-infrastructure.md` and `memory-architecture.md`. See
`docs/adr/README.md` and `docs/MIGRATION_REPORT.md`.

---

## Documents

| Document              | Describes                                                           |
| ---------------------- | -------------------------------------------------------------------- |
| `toolkit-pipeline.md` | How a markdown artifact becomes structured, governed memory: Scriptorium → Explicit Relationship Graph → working memory → finalize-story consolidation |

---

## Canonical Vocabulary

Terminology follows plain usage — see `AGENTS.md` → Glossary. The "Lexicon
Mechanicus" (ADR-005) is Webway's formal vocabulary system for its own,
larger research program, not MONOLITH's.

---

## Update Policy

Architecture documents are updated when the system changes.
An architecture document that describes something not yet implemented is wrong.
Move forward-looking content to `docs/vision/`.
