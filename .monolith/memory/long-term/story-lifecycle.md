---
type: memory
id: memory-long-term-story-lifecycle
category: long-term
authority: authoritative
related_protocols:
  - memory-governance
  - work-session
related_decisions:
  - ADR-001
  - ADR-002
related_skills:
  - finalize-story
---

# Story Lifecycle

How a unit of engineering work moves from ambiguous intention to crystallized knowledge.

---

## What Is a Story

A Story is the fundamental unit of engineering evolution in MONOLITH.

Not a task. Not a ticket. Not a feature.

A Story is the complete trajectory of a reasoning process: from an unresolved question or ambiguous intention, through investigation and evidence, to a Decision that permanently updates what MONOLITH knows. When a Story closes, its knowledge becomes part of long-term memory and shapes all future work.

This document defines the structural model of a Story — what it contains, how it progresses, and where it ends.

---

## Story Lifecycle Model

```
Task (ambiguous intention, unresolved question, or observed gap)
  │
  ▼
Investigation (scope, constraints, source of truth)
  │
  ▼
Hypotheses (candidate explanations or design bets)
  │
  ▼
Research (evidence gathering — reading, analysis, experimentation)
  │
  ▼
Experiments (concrete tests of hypotheses — prototypes, dogfood, benchmarks)
  │
  ▼
Evidence (what the experiments produced — facts, not interpretations)
  │
  ▼
Decision (irreversible conclusion drawn from evidence)
  │
  ▼
ADR / Memory Update (Decision written into long-term memory)
  │
  ▼
Story Archived (capsule written; Story becomes historical knowledge)
```

Each stage produces an artifact that the next stage depends on. Investigation without hypotheses is exploration without direction. Experiments without evidence produce no learning. Evidence without Decision produces no permanence.

---

## Decision as Terminal State

Decision is not a parallel process to Story. Decision is the terminal state of Story.

This distinction matters:

| Stage | Reversibility |
| ----- | ------------- |
| Task through Evidence | Reversible — hypotheses can be revised, experiments can be re-run, scope can be narrowed |
| Decision | Irreversible — evidence has crystallized into a position; the system commits |
| ADR / Memory Update | Permanent — Decision is written into long-term memory and shapes future reasoning |
| Story Archived | Historical — the Story no longer changes; it becomes a knowledge artifact |

A Decision is not a summary of what was done. It is the answer to the question the Story was pursuing. If a Story has no Decision, it has not ended — it has stalled.

When a Story reaches Decision, two things happen simultaneously:
1. A forward-facing artifact is written (ADR, memory update, architecture principle) — this updates what the system *does*.
2. A backward-facing capsule is written (story archive) — this records how the system *arrived* at this point.

Both are required. The forward artifact makes the Decision actionable. The backward capsule makes the reasoning inspectable.

---

## Story and Knowledge Formation

The Story Lifecycle and the Knowledge Lifecycle (knowledge-lifecycle.md) are orthogonal processes that converge at the same output: long-term memory artifacts.

| Lifecycle | Unit | Transforms | Into |
| --------- | ---- | ---------- | ---- |
| Knowledge Lifecycle | Artifact | Raw information | Concepts, links, regions, mental models |
| Story Lifecycle | Story | Ambiguous work | Decision + archived reasoning |

Both output to long-term memory. Both feed forward: Knowledge Lifecycle outputs become inputs to future analyzeArtifact() calls; Story Lifecycle outputs become inputs to future Stories.

The difference is time-scale. A Knowledge Lifecycle pass processes a single artifact in one operation. A Story spans multiple sessions, multiple artifacts, and multiple people (or agent instances). The Story is the envelope that gives the Knowledge Lifecycle its direction: Stories generate the artifacts that the Knowledge Lifecycle processes.

---

## Story as the Unit of Corpus Growth

Every archived Story adds to MONOLITH's corpus:
- The story capsule is a new artifact (processable by WEBWAY)
- The ADR is a new artifact
- Any memory updates are new artifacts

Over time, the corpus of archived Stories is the primary evidence base for WEBWAY's cross-artifact analysis. Stories are not overhead — they are the mechanism by which the system's own reasoning becomes processable knowledge.

This is the link between Story Lifecycle and H6 (WEBWAY bridges memory governance and knowledge formation): the artifacts that WEBWAY will eventually reason over are produced by Stories.

---

## Empirical Note — Webway Dogfood Experiment v0

**Observation:** In the first WEBWAY corpus analysis (`.monolith/reports/webway-dogfood-v0.md`, 2026-06-26), `story` emerged as the most frequent concept across 72 analyzed markdown files, appearing in 16 files — tied with `memory` and ahead of `knowledge`, `governance`, and all other domain concepts.

**Interpretation:** The governance layer of MONOLITH is organized around Stories as its primary operational unit. Protocols, skills, boot sequences, routing maps, and memory governance all reference Story structure either directly or through the artifacts Stories produce. `story` appeared frequently not because it was explicitly designed to dominate, but because the operational architecture of the system is built around this unit at every layer.

**Qualification:** This observation comes from a single corpus run using frequency-based extraction (v0 — no embeddings, no semantic links). Frequency is a signal, not a proof. As the corpus grows — particularly as story capsules, ADRs, and experimental reports are added — the concept distribution will shift. `story` may become less dominant in relative terms as domain-specific vocabulary accumulates. The current observation reflects a corpus that is predominantly governance and protocol documentation rather than knowledge artifacts.

**Architectural implication:** The finding confirmed that Decision was not modeled as an explicit stage of Story — it was treated as a separate process. This document is the direct response to that gap. Whether the frequency signal persists at corpus scale is an open empirical question.

---

## Relationship to Other Documents

| Document | Relationship |
| -------- | ------------ |
| `protocols/governance/work-session.md` | Operational rules for managing work sessions within a Story |
| `skills/finalize-story/SKILL.md` | Procedure for closing a Story — writes the capsule and updates memory |
| `memory/long-term/decisions.md` | Index of Decisions produced by completed Stories |
| `adr/*.md` | Full records of Decisions (the terminal artifacts of Architecture Stories) |
| `memory/long-term/knowledge-lifecycle.md` | The parallel lifecycle — how artifacts become knowledge |
| `memory/long-term/cognitive-core.md` | The future layer that will generate new Stories from detected gaps |
| `memory/working/story-index.md` | Navigation index of all completed Stories |
