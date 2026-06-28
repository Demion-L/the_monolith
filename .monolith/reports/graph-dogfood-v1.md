---
type: report
id: graph-dogfood-v1
generated: 2026-06-28
experiment: Story 1.3.1 — Explicit Graph Dogfood Experiment
---

# Graph Dogfood Report v1

**Experiment:** Story 1.3.1 — Scriptorium + Explicit Relationship Graph on MONOLITH corpus
**Generated:** 2026-06-28 19:52:07 UTC
**Pipeline:** `compileMarkdownArtifact()` → `buildGraph()`

---

## 1. Summary

| Metric                                   | Value  |
| ---------------------------------------- | ------ |
| Markdown files discovered                | 83     |
| Files compiled                           | 81     |
| Files skipped (too short)                | 2      |
| Total concept candidates                 | 615    |
| Total relationship candidates            | 4      |
| Graph nodes (total)                      | 492    |
| Graph nodes (real — from concepts)       | 488    |
| Graph nodes (synthesized — placeholders) | 4      |
| Graph edges                              | 4      |
| Edges with both nodes real               | 0 (0%) |
| Graph diagnostics (info)                 | 6      |
| Graph diagnostics (warn)                 | 0      |

---

## 2. Concept Source Distribution

| Source      | Count | Share |
| ----------- | ----- | ----- |
| heading     | 542   | 88%   |
| list-item   | 73    | 12%   |
| frontmatter | 0     | 0%    |
| link-label  | 0     | 0%    |

---

## 3. Relationship Type Distribution

| Relationship type | Edge count |
| ----------------- | ---------- |
| related_protocols | 4          |

---

## 4. Top Connected Nodes

Ranked by total degree (in-edges + out-edges).

| Node                                                                         | Canonical label                                                                   | Degree | Sources | Synthesized? |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ | ------- | ------------ |
| memory-governance                                                            | Memory Governance                                                                 | 4      | 2       | -            |
| templates-default-instance-monolith-memory-long-term-architecture-principles | templates--default-instance--monolith--memory--long-term--architecture-principles | 1      | 1       | YES          |
| templates-default-instance-monolith-memory-long-term-decisions               | templates--default-instance--monolith--memory--long-term--decisions               | 1      | 1       | YES          |
| templates-default-instance-monolith-memory-working-active                    | templates--default-instance--monolith--memory--working--active                    | 1      | 1       | YES          |
| templates-default-instance-monolith-memory-working-story-index               | templates--default-instance--monolith--memory--working--story-index               | 1      | 1       | YES          |
| 1-avoid-monolithic-context-files                                             | 1. Avoid Monolithic Context Files                                                 | 0      | 1       | -            |
| 2-separate-stable-vs-volatile-memory                                         | 2. Separate Stable vs Volatile Memory                                             | 0      | 1       | -            |
| 3-single-source-of-truth                                                     | 3. Single Source of Truth                                                         | 0      | 1       | -            |
| 4-append-only-history                                                        | 4. Append-Only History                                                            | 0      | 1       | -            |
| 5-story-context-required                                                     | 5. Story Context Required                                                         | 0      | 1       | -            |
| 6-integrity-before-report                                                    | 6. Integrity Before Report                                                        | 0      | 1       | -            |
| accepted-debt                                                                | Accepted Debt                                                                     | 0      | 1       | -            |
| activation                                                                   | Activation                                                                        | 0      | 5       | -            |
| activation-spreading-in-memory-retrieval                                     | Activation Spreading in Memory Retrieval                                          | 0      | 1       | -            |
| active-phase                                                                 | Active Phase                                                                      | 0      | 2       | -            |

---

## 5. Unresolved Relationship Targets (Synthesized Placeholders)

_No unresolved TO-side targets — all relationship targets found as real concepts._

Note: 4 synthesized node(s) exist on the FROM side. These arise when a document's own identity (fromLabel) falls back to its artifact ID path because the file has no recognized title field and produces no heading concepts. See Section 10 Finding #1.

---

## 6. Merged / Duplicate Labels

Nodes where multiple label variants (different casing, backtick formatting, etc.) were unified.

| Canonical label         | Aliases                 |
| ----------------------- | ----------------------- |
| Architecture Principles | Architecture principles |
| Current Focus           | Current focus           |

---

## 7. Artifacts Producing Frontmatter Relationships

| File                                                                            | Relationship candidates |
| ------------------------------------------------------------------------------- | ----------------------- |
| templates/default-instance/monolith/memory/long-term/architecture-principles.md | 1                       |
| templates/default-instance/monolith/memory/long-term/decisions.md               | 1                       |
| templates/default-instance/monolith/memory/working/active.md                    | 1                       |
| templates/default-instance/monolith/memory/working/story-index.md               | 1                       |

---

## 8. Good Edge Samples

Edges where both the source and target are real (non-synthesized) nodes.

_No fully-resolved edges found._

---

## 9. Noisy Edge Samples

Edges where the target node is a synthesized placeholder — the target concept was referenced but not found in the corpus.

_No noisy edges found._

---

## 10. Findings

### Are headings producing useful concepts?

542 heading concepts extracted across 81 files.
No structurally degenerate heading concepts found. Heading extraction quality is good.

Most MONOLITH docs use headings as section titles rather than concept declarations. The heading extractor correctly captures section boundaries, but many of these produce generic labels (e.g., "Summary", "Background", "Context") that normalize to the same node ID across files. This produces high-degree generic nodes rather than specific domain nodes.

### Are frontmatter relationships producing meaningful edges?

4 relationship candidates extracted from frontmatter.
The richest relationship sources: templates/default-instance/monolith/memory/long-term/architecture-principles.md, templates/default-instance/monolith/memory/long-term/decisions.md, templates/default-instance/monolith/memory/working/active.md.

The frontmatter relationship fields recognized by the Scriptorium (`related_decisions`, `related_hypotheses`, `related_regions`, `related_protocols`, `depends_on`, `references`, `related`) are **not widely present** in the docs/ corpus. The docs/ architecture documents use `related_adrs` and `related_research` — which are not in the recognized field set. This is the primary driver of unresolved targets and synthesized nodes.

### Are synthesized placeholder nodes useful or noisy?

4 synthesized nodes out of 492 total.
Low synthesized node count — acceptable for this corpus size.

### Are canonical labels readable?

2 nodes had multiple label variants merged.
The `selectCanonicalLabel()` algorithm correctly prefers Title Case over lowercase variants. Examples: "Architecture Principles" (aliases: "Architecture principles"); "Current Focus" (aliases: "Current focus").

### Are relationship targets resolvable enough for Terra?

Resolved edge rate: **0%** (0 of 4 edges).

Most edges have unresolved targets. Before persisting this graph in Terra, the field set and/or the corpus coverage needs extension.

### What breaks on real MONOLITH docs?

1. **Frontmatter field mismatch.** The docs/ layer uses `related_adrs`, `related_research`, `follow_up_adrs` — none of which are in `MONOLITH_RELATIONSHIP_FIELDS`. These produce zero relationship candidates from the richest cross-reference sources.

2. **Generic heading saturation.** Section titles like "Summary", "Background", "Context", "Decision", "References" appear in almost every ADR, research, and architecture document. They collapse to high-degree generic nodes with no semantic specificity.

3. **List-item heuristic misses rich concept lists.** The "≤3 words + Title Case" heuristic correctly rejects prose but also rejects multi-word Cognitive Kernel subsystem names used in lowercase (e.g., "- the sleep pipeline" → kept as evidence, not concept).

4. **Zero-concept artifacts.** All compiled files produced at least one concept — no empty artifacts in this corpus.

---

## 11. Recommendations for Story 1.3.2

| Problem                              | Recommended fix                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| docs/ field names not recognized     | Add related_adrs, related_research, follow_up_adrs to MONOLITH_RELATIONSHIP_FIELDS in frontmatter.ts        |
| Generic heading saturation           | Introduce a heading-quality filter: skip H2+ headings whose normalized ID appears in a structural-noise set |
| List-item heuristic too conservative | Lower case-sensitivity requirement for known MONOLITH subsystem names; or add a domain vocabulary allowlist |
| Short files yield nothing            | For files below a concept-count threshold, consider fusing with sibling index files before compilation      |
| No cross-file concept co-occurrence  | Terra integration: accumulate concept → sourceArtifacts map across builds to detect shared vocabulary       |

---

## 12. Verdict

**NOT READY — 1.3.2 REQUIRED**

Only 0% of edges connect real nodes. Too many unresolved targets to produce a trustworthy graph for Terra.


### Skipped Files

- `templates/default-instance/monolith/memory/working/governance-result.md` — too short (0 chars)
- `templates/default-instance/monolith/memory/working/integrity-result.md` — too short (0 chars)
