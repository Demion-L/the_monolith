---
type: meta
id: architecture-index
authority: authoritative
---

# Architecture

Current system description for MONOLITH.

These documents describe what the system is today.
Not future vision. Not historical research.

For the reasoning behind each design choice, see `docs/adr/`.
For the research that motivated those choices, see `docs/research/`.
For where the system is going, see `docs/vision/`.

---

## Documents

| Document                      | Describes                                                    |
| ----------------------------- | ------------------------------------------------------------ |
| `cognitive-infrastructure.md` | Overall structure of the Cognitive Operating System          |
| `memory-architecture.md`      | Memory layers, lifecycle, governance, and knowledge regions  |
| `knowledge-pipeline.md`       | How knowledge enters, flows through, and is consolidated     |

---

## Canonical Vocabulary

All terminology in architecture documents follows the Lexicon Mechanicus.
See `ADR-005` for the decision; the vocabulary is built incrementally in `cognitive-infrastructure.md`.

---

## Update Policy

Architecture documents are updated when the system changes.
An architecture document that describes something not yet implemented is wrong.
Move forward-looking content to `docs/vision/`.
