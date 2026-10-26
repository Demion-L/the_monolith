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
| `DURABLE-STATE-RETENTION-SAFETY.md` | Durable State & Retention: safety invariants (INV-001…INV-012), failure model, verification matrix — a specification for independent audit, not approved; describes behavior of branch `feat/durable-state-001`, which is not merged |
| `DURABLE-PRUNE-PROTOCOL-DESIGN-004.md` | Durable State Design A: atomic prune protocol (persisted prepare/decision register); `ARCHITECTURE_FROZEN` per §46 — design only, no implementation (FIX-004A…E not started) |
| `DURABLE-PRUNE-PROTOCOL-DESIGN-004-APPENDIX-A.md` | Appendix A to Design A: state tables and crash-recovery matrix |
| `DUREX-PROTOCOL-CONCEPT.md` | MONOLITH DurEx Protocol — `PROPOSED CONCEPT` only; no implementation obligations, does not change Design A |

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
