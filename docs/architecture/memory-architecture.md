---
type: architecture
id: memory-architecture
authority: authoritative
stability: stable
last_updated: 2026-06-28
related_adrs:
  - ADR-004
  - ADR-006
related_research:
  - R-0001
  - R-0002
---

# Memory Architecture

Description of the Cognitive Kernel's current memory system.

The memory layer described here is a Cognitive Kernel subsystem — developed and researched by MONOLITH. It is not a description of MONOLITH-the-platform itself.

For the decision to use Terra as the persistence substrate, see `ADR-004`.
For the proposed Terra implementation strategy, see `ADR-006`.
For the research that motivated this design, see `R-0001` and `R-0002`.

---

## Memory Tiers

MONOLITH's memory is organized into three tiers based on stability and lifecycle:

```
┌──────────────────────────────────────────┐
│  Working Memory     memory/working/       │
│  Volatile. Per-story. Cleared on finalize.│
└──────────────────────────────────────────┘
                      ↓ on finalization
┌──────────────────────────────────────────┐
│  Long-Term Memory   memory/long-term/     │
│  Stable. Cross-story. Append-only log.   │
└──────────────────────────────────────────┘
                      ↓ on failure
┌──────────────────────────────────────────┐
│  Error Memory       memory/errors/        │
│  Failure records. Source for learning.   │
└──────────────────────────────────────────┘
```

---

## Working Memory

**Location:** `memory/working/`
**Stability:** volatile
**Lifecycle:** Created at story start. Updated throughout the story. Promoted or cleared at story finalization.

| Artifact                  | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `active.md`               | Current phase, current story, last finalization  |
| `story-index.md`          | Navigable index of all completed stories         |
| `integrity-result.md`     | Last integrity verification result               |
| `governance-result.md`    | Last governance evaluation result                |

Working memory is intentionally small. It contains only what is needed to understand the current session's state.

---

## Long-Term Memory

**Location:** `memory/long-term/`
**Stability:** stable
**Lifecycle:** Updated on story finalization when significant decisions are made. Execution history is append-only.

| Artifact                   | Purpose                                           |
| -------------------------- | ------------------------------------------------- |
| `decisions.md`             | Accumulated architectural decisions               |
| `architecture-principles.md` | Core architectural principles for the project   |
| `tech-debt.md`             | Registry of known technical debt                  |
| `execution-history.md`     | Append-only log of story finalizations            |

Long-term memory is authoritative. It must not be modified except through the finalize-story skill.

---

## Error Memory

**Location:** `memory/errors/`
**Stability:** stable
**Lifecycle:** Written when a failure occurs. Never deleted. Processed by the self-improvement skill into lessons.

Error records are the input to the learning layer. They are not a failure log — they are the raw material for improving future behavior.

Schema: `memory/errors/SCHEMA.md`
Taxonomy: `memory/errors/TAXONOMY.md`

---

## Knowledge Regions

Knowledge Regions are named partitions of the memory corpus. The routing-map's Table 4 declares which regions to load for each task type. This ensures the AI assistant loads exactly the memory it needs, no more.

Current regions:

| Region Name                  | Contents                                        | Load trigger (examples)            |
| ---------------------------- | ----------------------------------------------- | ---------------------------------- |
| `working/active`             | Current phase, story, focus                     | All task types                     |
| `working/story-index`        | Completed story history                         | finalize-story, global-overview    |
| `long-term/decisions`        | Architectural decision log                      | new-feature, architecture-review   |
| `long-term/architecture-principles` | Core principles                        | implementation-task, new-feature   |
| `long-term/tech-debt`        | Known tech debt                                 | bug-investigation                  |
| `long-term/execution-history`| Story finalization log                          | finalize-story                     |
| `context/maps/roadmap-index` | Phase and story roadmap                         | planning-request, status-check     |
| `learning/mistakes`          | Lesson files from past mistakes                 | self-improvement                   |
| `memory/errors`              | Raw error records                               | self-improvement                   |

Source: `context/maps/routing-map.md` Table 4

---

## Memory Governance

Memory is governed by six rules. These are always active.

1. **Avoid Monolithic Context Files** — No single large file that grows indefinitely. Prefer phase capsules, story capsules, indexed references.
2. **Separate Stable vs Volatile Memory** — Working memory is volatile. Long-term memory is stable. Never mix them.
3. **Single Source of Truth** — Each fact has exactly one authoritative location. Reference, don't duplicate.
4. **Append-Only History** — `memory/long-term/execution-history.md` is append-only. Past entries must never be edited.
5. **Story Context Required** — All working memory updates must reference the active story ID.
6. **Integrity Before Report** — `memory/working/integrity-result.md` must pass before a story is finalized.

Source: `protocols/governance/memory-governance.md`

---

## Consolidation (Current State)

Memory consolidation is currently manual, executed by the finalize-story skill:

1. Story completes
2. finalize-story skill runs
3. Significant decisions are written to `long-term/decisions.md`
4. Story entry is appended to `long-term/execution-history.md`
5. Working memory is updated to reflect story completion

This is adequate for current scale. A formal consolidation pipeline (Terra's sleep pipeline) is planned. See `ADR-006`.

---

## Memory Frontmatter Schema

All memory artifacts carry YAML frontmatter:

```yaml
---
type: memory
id: <unique-id>
category: working | long-term | error
stability: volatile | stable | authoritative
authority: authoritative | informational
related_protocols:
  - <protocol-id>
---
```

The `authority: authoritative` field is the current implementation of the oracle-style authority declaration described in R-0002.

---

## Explicit Relationship Graph

A complementary layer to the flat file memory store. The Explicit Relationship Graph encodes typed edges between memory artifacts, enabling associative navigation.

The graph is a Phase 1 deliverable. It is a layer above the file-based store, not a replacement for it.

This separates two kinds of navigation:
- **Direct lookup** — "What is the authoritative source for architectural decisions?" → semantic-map → `long-term/decisions.md`
- **Associative navigation** — "What is related to this story?" → Explicit Relationship Graph → traversal result

For the decision to maintain Terra as the primary substrate (not the graph), see `ADR-004`.
