---
type: report
id: graph-dogfood-v1-2
generated: 2026-06-28
experiment: Story 1.3.3 — Canonical Identity Aliases
supersedes: graph-dogfood-v1-1
---

# Graph Dogfood Report v1.2

**Experiment:** Story 1.3.3 — Canonical Identity Aliases (post-fix rerun)
**Generated:** 2026-06-28 20:21:42 UTC
**Pipeline:** `compileMarkdownArtifact()` → `buildGraph()`
**Changes vs v1.1:** Scriptorium now emits `documentId` and `documentTitle` from frontmatter; graph builder registers both as aliases before relationship resolution — eliminating synthesized placeholders for documents that exist in the corpus.

---

## 1. Summary

| Metric                                   | Value     |
| ---------------------------------------- | --------- |
| Markdown files discovered                | 83        |
| Files compiled                           | 81        |
| Files skipped (too short)                | 2         |
| Total concept candidates                 | 600       |
| Total relationship candidates            | 32        |
| Graph nodes (total)                      | 481       |
| Graph nodes (real — from concepts)       | 481       |
| Graph nodes (synthesized — placeholders) | 0         |
| Graph edges                              | 32        |
| Edges with both nodes real               | 32 (100%) |
| Graph diagnostics (info)                 | 58        |
| Graph diagnostics (warn)                 | 0         |

---

## 2. Concept Source Distribution

| Source      | Count | Share |
| ----------- | ----- | ----- |
| heading     | 527   | 88%   |
| list-item   | 73    | 12%   |
| frontmatter | 0     | 0%    |
| link-label  | 0     | 0%    |

---

## 3. Relationship Type Distribution

| Relationship type | Edge count |
| ----------------- | ---------- |
| related_research  | 14         |
| related_adrs      | 9          |
| follow_up_adrs    | 5          |
| related_protocols | 4          |

---

## 4. Top Connected Nodes

Ranked by total degree (in-edges + out-edges).

| Node                                                   | Canonical label                                          | Degree | Sources | Synthesized? |
| ------------------------------------------------------ | -------------------------------------------------------- | ------ | ------- | ------------ |
| r-0001-lessons-learned-from-iai-personal-memory-engine | R-0001 — Lessons Learned from IAI Personal Memory Engine | 9      | 1       | -            |
| r-0002-oracle-memory-systems                           | R-0002 — Oracle Memory Systems                           | 9      | 1       | -            |
| adr-004-terra-vs-graph-memex                           | ADR-004 — Terra vs Graph Memex                           | 8      | 1       | -            |
| r-0003-cognitive-architecture-notes                    | R-0003 — Cognitive Architecture Notes                    | 7      | 1       | -            |
| adr-005-lexicon-mechanicus                             | ADR-005 — Lexicon Mechanicus                             | 5      | 1       | -            |
| knowledge-pipeline                                     | Knowledge Pipeline                                       | 5      | 1       | -            |
| adr-006-terra-persistence-strategy                     | ADR-006 — Terra Persistence Strategy                     | 4      | 1       | -            |
| memory-architecture                                    | Memory Architecture                                      | 4      | 1       | -            |
| memory-governance                                      | Memory Governance                                        | 4      | 2       | -            |
| long-term-vision                                       | Long-Term Vision                                         | 3      | 1       | -            |
| cognitive-infrastructure                               | Cognitive Infrastructure                                 | 2      | 1       | -            |
| active-working-memory                                  | Active Working Memory                                    | 1      | 1       | -            |
| architectural-decisions                                | Architectural Decisions                                  | 1      | 1       | -            |
| architecture-principles                                | Architecture Principles                                  | 1      | 2       | -            |
| story-index                                            | Story Index                                              | 1      | 1       | -            |

---

## 5. Unresolved Relationship Targets (Synthesized Placeholders)

_No unresolved TO-side targets — all relationship targets found as real concepts._

---

## 6. Merged / Duplicate Labels

Nodes where multiple label variants (different casing, backtick formatting, etc.) were unified.

| Canonical label                      | Aliases                                                           |
| ------------------------------------ | ----------------------------------------------------------------- |
| Active Working Memory                | memory-working-active                                             |
| ADR-004 — Terra vs Graph Memex       | ADR-004, Terra vs Graph Memex                                     |
| ADR-005 — Lexicon Mechanicus         | ADR-005, Lexicon Mechanicus                                       |
| ADR-006 — Terra Persistence Strategy | ADR-006, Terra Persistence Strategy                               |
| AI Assistant Boot Sequence           | protocol-boot-sequence                                            |
| Architectural Decisions              | memory-long-term-decisions                                        |
| Architecture                         | architecture-index                                                |
| Architecture Principles              | Architecture principles, memory-long-term-architecture-principles |
| Cognitive Dry-Run Protocol           | protocol-dry-run                                                  |
| Cognitive Modes Protocol             | protocol-cognitive-modes                                          |
| Command Policy                       | protocol-command-policy                                           |
| Core Invariants                      | protocol-core-invariants                                          |
| Current Focus                        | Current focus                                                     |
| Current State                        | context-execution-current-state                                   |
| Documentation Migration Report       | migration-report                                                  |
| Error Record Schema                  | error-schema                                                      |
| Execution History                    | memory-long-term-execution-history                                |
| Execution Trace Format               | protocol-execution-trace-format                                   |
| Expected Behavior                    | test-expected-behavior                                            |
| Hybrid Execution Protocol            | protocol-hybrid-execution                                         |

… and 31 more merged nodes.

---

## 7. Artifacts Producing Frontmatter Relationships

| File                                                 | Relationship candidates |
| ---------------------------------------------------- | ----------------------- |
| docs/architecture/knowledge-pipeline.md              | 5                       |
| docs/architecture/memory-architecture.md             | 4                       |
| docs/research/R-0001-iai-personal-memory-engine.md   | 4                       |
| docs/research/R-0002-oracle-memory-systems.md        | 4                       |
| docs/research/R-0003-cognitive-architecture-notes.md | 3                       |
| docs/vision/long-term-vision.md                      | 3                       |
| docs/architecture/cognitive-infrastructure.md        | 2                       |
| docs/adr/ADR-004-terra-vs-graph-memex.md             | 1                       |
| docs/adr/ADR-005-lexicon-mechanicus.md               | 1                       |
| docs/adr/ADR-006-terra-persistence-strategy.md       | 1                       |

---

## 8. Good Edge Samples

Edges where both the source and target are real (non-synthesized) nodes.

| From                                 | Type              | To                                   | Source artifact                    |
| ------------------------------------ | ----------------- | ------------------------------------ | ---------------------------------- |
| Active Working Memory                | related_protocols | Memory Governance                    | active                             |
| ADR-004 — Terra vs Graph Memex       | related_adrs      | ADR-006 — Terra Persistence Strategy | ADR-004-terra-vs-graph-memex       |
| ADR-005 — Lexicon Mechanicus         | related_adrs      | ADR-004 — Terra vs Graph Memex       | ADR-005-lexicon-mechanicus         |
| ADR-006 — Terra Persistence Strategy | related_adrs      | ADR-004 — Terra vs Graph Memex       | ADR-006-terra-persistence-strategy |
| Architectural Decisions              | related_protocols | Memory Governance                    | decisions                          |

---

## 9. Noisy Edge Samples

Edges where the target node is a synthesized placeholder — the target concept was referenced but not found in the corpus.

_No noisy edges found._

---

## 10. Findings

### Are headings producing useful concepts?

527 heading concepts extracted across 81 files.
No structurally degenerate heading concepts found. Heading extraction quality is good.

Most MONOLITH docs use headings as section titles rather than concept declarations. The structural noise filter (Story 1.3.2) removes the most common offenders. However, many domain-adjacent headings (e.g., "Decision", "Rationale", "References") are still extracted as concepts. The top-connected real nodes ("Knowledge Pipeline", "Memory Architecture", "Memory Governance") are genuine domain concepts, not noise.

### Are frontmatter relationships producing meaningful edges?

32 relationship candidates extracted from frontmatter.
The richest relationship sources: docs/architecture/knowledge-pipeline.md, docs/architecture/memory-architecture.md, docs/research/R-0001-iai-personal-memory-engine.md.

The Scriptorium now recognizes `related_adrs`, `related_research`, and `follow_up_adrs` in addition to the original field set. The relationship candidates extracted this run reflect the full field coverage of the MONOLITH docs/ corpus.

### Are synthesized placeholder nodes useful or noisy?

0 synthesized nodes out of 481 total.
No synthesized nodes — all targets resolved.

### Are canonical labels readable?

51 nodes had multiple label variants merged.
The `selectCanonicalLabel()` algorithm correctly prefers Title Case over lowercase variants. Examples: "Active Working Memory" (aliases: "memory-working-active"); "ADR-004 — Terra vs Graph Memex" (aliases: "ADR-004", "Terra vs Graph Memex"); "ADR-005 — Lexicon Mechanicus" (aliases: "ADR-005", "Lexicon Mechanicus").

### Are relationship targets resolvable enough for Terra?

Resolved edge rate: **100%** (32 of 32 edges).

The graph has sufficient resolved structure for Terra.

### What breaks on real MONOLITH docs?

1. **Short ID vs long title mismatch (primary remaining issue).** Documents are referenced by their short IDs (e.g., "ADR-004", "R-0001") but compiled with full H1 titles (e.g., "Terra vs Graph Memex"). These produce different normalized slugs, so short-ID references create synthesized placeholder nodes even when the target document is in the corpus. The 6 unresolved targets are all MONOLITH document IDs of this form.

2. **Generic heading saturation — partially fixed.** The Story 1.3.2 noise filter removes the specified structural headers. Remaining noise: section headings like "Decision", "Rationale", "References", "Related", "Follow-up ADRs" that appear in every ADR but are not in the current noise set.

3. **List-item heuristic misses rich concept lists.** The "≤3 words + Title Case" heuristic correctly rejects prose but also rejects multi-word Cognitive Kernel subsystem names used in lowercase (e.g., "- the sleep pipeline" → kept as evidence, not concept).

4. **Zero-concept artifacts.** All compiled files produced at least one concept — no empty artifacts in this corpus.

---

## 11. Recommendations for Story 1.3.3

| Problem                              | Recommended fix                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Short ID vs long title mismatch      | Add frontmatter id: field value as a concept alias during compilation; or register shorthand aliases (ADR-004 → adr-004) before graph build |
| Additional heading noise             | Extend STRUCTURAL_HEADING_NOISE with: Decision, Rationale, References, Related, Follow-up ADRs, See Also                                    |
| List-item heuristic too conservative | Add a domain vocabulary allowlist for known multi-word lowercase MONOLITH concepts (e.g., sleep pipeline)                                   |
| fromLabel title chain incomplete     | Teach compile.ts to extract H1 directly (not just via dogfood loader) so core API benefits from title inference                             |

---

## 12. Verdict

**READY FOR TERRA**

100% of edges connect two real (non-synthesized) nodes. The graph has enough resolved structure to be a useful persistence target.


### Skipped Files

- `templates/default-instance/monolith/memory/working/governance-result.md` — too short (0 chars)
- `templates/default-instance/monolith/memory/working/integrity-result.md` — too short (0 chars)
