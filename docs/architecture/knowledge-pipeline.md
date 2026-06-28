---
type: architecture
id: knowledge-pipeline
authority: authoritative
stability: stable
last_updated: 2026-06-28
related_adrs:
  - ADR-004
  - ADR-005
related_research:
  - R-0001
  - R-0002
  - R-0003
---

# Knowledge Pipeline

How knowledge enters the Cognitive Kernel, moves through it, and is consolidated over time.

The pipeline described here is a Cognitive Kernel architecture — the flow of knowledge through the cognitive subsystems (Scriptorium, Terra, Graph Memex, Learning Layer) that MONOLITH is building. MONOLITH-the-platform feeds the pipeline at Stage 1 (research findings, architectural analyses, design documents) but is not itself part of the pipeline.

---

## Pipeline Overview

```
External Input
     │
     ↓
  Scriptorium (ingestion)
     │
     ↓
  Working Memory (active session)
     │
     ↓  on story finalization
  Consolidation (finalize-story skill)
     │
     ├──→  Long-Term Memory (decisions, principles, history)
     │
     ├──→  Explicit Relationship Graph (typed edges)
     │
     └──→  Learning Layer (if errors occurred)
                │
                ↓
           Lessons (mistake records → injection-map)
```

---

## Stage 1 — Ingestion (Scriptorium)

**What enters:** External knowledge — research findings, architectural analyses, design documents, conversation outcomes.

**How it enters:** The Scriptorium provides structured ingestion. Incoming documents are validated against the schema (frontmatter type, required fields, vocabulary compliance with Lexicon Mechanicus), then routed to the appropriate memory tier.

**Current state:** The Scriptorium is a Phase 1 deliverable. It provides the structured document ingestion layer. Full schema enforcement at write time is planned in Terra (ADR-006).

**What the Scriptorium does NOT do:**
- It does not infer structure using an LLM (rejected in R-0001 as non-deterministic)
- It does not route to an external database (current model is file-based)
- It does not modify incoming content

---

## Stage 2 — Active Working Memory

**What happens:** During a story, the AI assistant reads and writes working memory to track current state. All reads are mediated through the routing-map (which Knowledge Regions to load for this task type) and the semantic-map (which file is authoritative for a given query).

**The cognitive loop during a story:**

```
Boot sequence → load working memory → classify task type
→ activate cognitive mode → load relevant protocols + skills
→ load relevant memory regions → inject relevant lessons
→ execute task → update working memory → repeat
```

**Integrity gate:** Before any story is reported as complete, the integrity verification pass runs. This checks:
- All required artifacts are present and valid
- No unreplaced template placeholders exist
- Memory governance rules are satisfied

Source: `protocols/boot/boot-sequence.md` and `skills/finalize-story/SKILL.md`

---

## Stage 3 — Consolidation (finalize-story)

**What triggers it:** Explicit story finalization via the finalize-story skill.

**What it does:**

| Action                              | Target                               |
| ----------------------------------- | ------------------------------------ |
| Write story capsule                 | `memory/working/phases/<id>/stories/` |
| Update active story pointer         | `memory/working/active.md`           |
| Append to execution history         | `memory/long-term/execution-history.md` |
| Record significant decisions        | `memory/long-term/decisions.md`      |
| Update story index                  | `memory/working/story-index.md`      |
| Write session handoff               | `context/boot/HANDOFF.md`            |

**What it does NOT do (yet):**
- No automated promotion based on access count or staleness
- No automated pruning or forgetting
- No sleep pipeline consolidation passes

These are planned in Terra (ADR-006). The current consolidation is manual and skill-driven.

---

## Stage 4 — Long-Term Memory

**What is stored:** Decisions, principles, execution history, tech debt. These are the artifacts that survive story finalization and inform future stories.

**Access pattern:** Read during boot (memory regions loaded per routing-map Table 4). Written during finalization (finalize-story skill).

**Governance:** Long-term memory is authoritative. It must not be written except by the finalize-story skill. It must not be modified after being written (execution history is append-only; decisions may be superseded by new entries, but old entries are never deleted).

---

## Stage 5 — Explicit Relationship Graph

**What is stored:** Typed edges between memory artifacts, connecting decisions to research, stories to artifacts, concepts to related concepts.

**Access pattern:** Used for associative navigation — "what is related to this?" — not for authoritative lookup (which uses the semantic-map oracle).

**Current state:** Phase 1 deliverable. The graph is maintained manually or through the Scriptorium's ingestion process.

---

## Stage 6 — Learning Layer

**What triggers it:** A failure occurs during a story (integrity failure, governance violation, repeated mistake).

**What happens:**
1. Error record written to `memory/errors/`
2. self-improvement skill activated (manually or on next session)
3. Error record is analyzed and classified per the taxonomy
4. A lesson is written to `learning/mistakes/<category>/LESSON-YYYY-XXXX.md`
5. The injection-map is updated if the lesson applies to a common task type

**Effect on future sessions:** At boot step 8, the injection-map routes relevant lessons into the session context. The AI assistant reads the lesson before starting the task, applying the learning proactively.

---

## Cross-Pipeline Invariants

These hold throughout the entire pipeline:

1. **Determinism** — Every pipeline step produces the same output given the same input. No LLM inference in the routing, governance, or consolidation steps.
2. **Inspectability** — Every artifact at every stage is a human-readable file. No opaque state.
3. **Single Source of Truth** — Each fact has exactly one authoritative location in the pipeline. Information is referenced, not duplicated.
4. **Append-Only History** — The execution history log grows; it never shrinks or is rewritten.
5. **Vocabulary Compliance** — All artifacts use terms from the Lexicon Mechanicus (ADR-005).

---

## Pipeline Gaps (Current Limitations)

The following gaps exist in the current pipeline. They represent planned work, not failures.

| Gap                        | Impact                                     | Resolution direction  |
| -------------------------- | ------------------------------------------ | --------------------- |
| No schema validation at write | Invalid artifacts can enter the store   | Terra (ADR-006)       |
| No automated consolidation | Consolidation depends on skill execution   | Sleep pipeline (ADR-006) |
| No automated pruning       | Memory grows without bounds over time      | Forgetting (ADR-006)  |
| No provenance tracking     | Cannot audit where a memory came from      | Terra provenance fields (ADR-006) |
| No confidence / freshness  | Stale memories appear authoritative        | R-0001 Honest Degradation (future) |
