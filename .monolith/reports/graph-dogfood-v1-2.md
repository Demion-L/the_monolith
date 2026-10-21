---
type: report
id: graph-dogfood-v1-2
generated: 2026-10-21
experiment: Story 1.3.3 — Canonical Identity Aliases
supersedes: graph-dogfood-v1-1
---

# Graph Dogfood Report v1.2

**Experiment:** Story 1.3.3 — Canonical Identity Aliases (post-fix rerun)
**Generated:** 2026-10-21 11:05:00 UTC
**Pipeline:** `compileMarkdownArtifact()` → `buildGraph()`
**Changes vs v1.1:** Scriptorium now emits `documentId` and `documentTitle` from frontmatter; graph builder registers both as aliases before relationship resolution — eliminating synthesized placeholders for documents that exist in the corpus.

---

## 1. Summary

| Metric                                   | Value    |
| ---------------------------------------- | -------- |
| Markdown files discovered                | 76       |
| Files compiled                           | 74       |
| Files skipped (too short)                | 2        |
| Total concept candidates                 | 485      |
| Total relationship candidates            | 16       |
| Graph nodes (total)                      | 392      |
| Graph nodes (real — from concepts)       | 389      |
| Graph nodes (synthesized — placeholders) | 3        |
| Graph edges                              | 16       |
| Edges with both nodes real               | 13 (81%) |
| Graph diagnostics (info)                 | 49       |
| Graph diagnostics (warn)                 | 3        |

---

## 2. Concept Source Distribution

| Source      | Count | Share |
| ----------- | ----- | ----- |
| heading     | 416   | 86%   |
| list-item   | 69    | 14%   |
| frontmatter | 0     | 0%    |
| link-label  | 0     | 0%    |

---

## 3. Relationship Type Distribution

| Relationship type | Edge count |
| ----------------- | ---------- |
| related_adrs      | 5          |
| related_protocols | 4          |
| protocols         | 4          |
| referenced_by     | 3          |

---

## 4. Top Connected Nodes

Ranked by total degree (in-edges + out-edges).

| Node                                                                         | Canonical label                                                                | Degree | Sources | Synthesized? |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------ | ------- | ------------ |
| memory-governance                                                            | Memory Governance                                                              | 6      | 1       | -            |
| active-working-memory                                                        | Active Working Memory                                                          | 4      | 1       | -            |
| adr-007-explicit-only-identity-resolution-in-the-explicit-relationship-graph | ADR-007 — Explicit-Only Identity Resolution in the Explicit Relationship Graph | 4      | 1       | -            |
| skill-finalize-story                                                         | Skill: Finalize Story                                                          | 3      | 1       | -            |
| adr-008-coordinatorium-tactical-mission-lifecycle-first-vertical-slice       | ADR-008 — Coordinatorium: Tactical Mission Lifecycle (First Vertical Slice)    | 2      | 1       | -            |
| skill-self-improvement                                                       | Skill: Self Improvement                                                        | 2      | 1       | -            |
| toolkit-pipeline                                                             | Toolkit Pipeline                                                               | 2      | 1       | -            |
| adr-004                                                                      | ADR-004                                                                        | 1      | 1       | YES          |
| adr-005                                                                      | ADR-005                                                                        | 1      | 1       | YES          |
| architectural-decisions                                                      | Architectural Decisions                                                        | 1      | 1       | -            |
| architecture-principles                                                      | Architecture Principles                                                        | 1      | 2       | -            |
| failure-memory-logging                                                       | failure-memory-logging                                                         | 1      | 1       | YES          |
| integrity-verification                                                       | Integrity Verification                                                         | 1      | 1       | -            |
| skill-current-status                                                         | Skill: Current Status                                                          | 1      | 1       | -            |
| skill-global-status                                                          | Skill: Global Status                                                           | 1      | 1       | -            |

---

## 5. Unresolved Relationship Targets (Synthesized Placeholders)

3 nodes were synthesized because they appeared as relationship targets (TO side) but were not found as concepts in any artifact.

- `adr-004`
- `adr-005`
- `failure-memory-logging`

---

## 6. Merged / Duplicate Labels

Nodes where multiple label variants (different casing, backtick formatting, etc.) were unified.

| Canonical label                                                                | Aliases                                                                       |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Active Working Memory                                                          | memory-working-active                                                         |
| ADR-007 — Explicit-Only Identity Resolution in the Explicit Relationship Graph | ADR-007, Explicit-Only Identity Resolution in the Explicit Relationship Graph |
| ADR-008 — Coordinatorium: Tactical Mission Lifecycle (First Vertical Slice)    | ADR-008, Coordinatorium — Tactical Mission Lifecycle (First Vertical Slice)   |
| AI Assistant Boot Sequence                                                     | protocol-boot-sequence                                                        |
| Architectural Decisions                                                        | memory-long-term-decisions                                                    |
| Architecture                                                                   | architecture-index                                                            |
| Architecture Principles                                                        | Architecture principles, memory-long-term-architecture-principles             |
| Cognitive Dry-Run Protocol                                                     | protocol-dry-run                                                              |
| Cognitive Modes Protocol                                                       | protocol-cognitive-modes                                                      |
| Command Policy                                                                 | protocol-command-policy                                                       |
| Core Invariants                                                                | protocol-core-invariants                                                      |
| Current Focus                                                                  | Current focus                                                                 |
| Current State                                                                  | context-execution-current-state                                               |
| Documentation Migration Report                                                 | migration-report                                                              |
| Error Record Schema                                                            | error-schema                                                                  |
| Execution History                                                              | memory-long-term-execution-history                                            |
| Execution Trace Format                                                         | protocol-execution-trace-format                                               |
| Expected Behavior                                                              | test-expected-behavior                                                        |
| Hybrid Execution Protocol                                                      | protocol-hybrid-execution                                                     |
| Learning Layer                                                                 | learning-index                                                                |

… and 26 more merged nodes.

---

## 7. Artifacts Producing Frontmatter Relationships

| File                                                                            | Relationship candidates |
| ------------------------------------------------------------------------------- | ----------------------- |
| templates/default-instance/monolith/memory/working/active.md                    | 4                       |
| docs/adr/ADR-007-explicit-identity-resolution.md                                | 2                       |
| docs/architecture/toolkit-pipeline.md                                           | 2                       |
| templates/default-instance/monolith/skills/finalize-story/SKILL.md              | 2                       |
| templates/default-instance/monolith/skills/self-improvement/SKILL.md            | 2                       |
| docs/adr/ADR-008-coordinatorium-tactical-mission-lifecycle.md                   | 1                       |
| templates/default-instance/monolith/memory/long-term/architecture-principles.md | 1                       |
| templates/default-instance/monolith/memory/long-term/decisions.md               | 1                       |
| templates/default-instance/monolith/memory/working/story-index.md               | 1                       |

---

## 8. Good Edge Samples

Edges where both the source and target are real (non-synthesized) nodes.

| From                                                                        | Type              | To                                                                             | Source artifact                                   |
| --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| Active Working Memory                                                       | referenced_by     | Skill: Current Status                                                          | active                                            |
| Active Working Memory                                                       | referenced_by     | Skill: Finalize Story                                                          | active                                            |
| Active Working Memory                                                       | referenced_by     | Skill: Global Status                                                           | active                                            |
| Active Working Memory                                                       | related_protocols | Memory Governance                                                              | active                                            |
| ADR-008 — Coordinatorium: Tactical Mission Lifecycle (First Vertical Slice) | related_adrs      | ADR-007 — Explicit-Only Identity Resolution in the Explicit Relationship Graph | ADR-008-coordinatorium-tactical-mission-lifecycle |

---

## 9. Noisy Edge Samples

Edges where the target node is a synthesized placeholder — the target concept was referenced but not found in the corpus.

| From                                                                           | Type         | To (unresolved)        | Source artifact                      |
| ------------------------------------------------------------------------------ | ------------ | ---------------------- | ------------------------------------ |
| ADR-007 — Explicit-Only Identity Resolution in the Explicit Relationship Graph | related_adrs | ADR-004                | ADR-007-explicit-identity-resolution |
| ADR-007 — Explicit-Only Identity Resolution in the Explicit Relationship Graph | related_adrs | ADR-005                | ADR-007-explicit-identity-resolution |
| Skill: Self Improvement                                                        | protocols    | failure-memory-logging | SKILL                                |

---

## 10. Findings

### Are headings producing useful concepts?

416 heading concepts extracted across 74 files.
No structurally degenerate heading concepts found. Heading extraction quality is good.

Most MONOLITH docs use headings as section titles rather than concept declarations. The structural noise filter (Story 1.3.2) removes the most common offenders. However, many domain-adjacent headings (e.g., "Decision", "Rationale", "References") are still extracted as concepts. The top-connected real nodes ("Knowledge Pipeline", "Memory Architecture", "Memory Governance") are genuine domain concepts, not noise.

### Are frontmatter relationships producing meaningful edges?

16 relationship candidates extracted from frontmatter.
The richest relationship sources: templates/default-instance/monolith/memory/working/active.md, docs/adr/ADR-007-explicit-identity-resolution.md, docs/architecture/toolkit-pipeline.md.

The Scriptorium now recognizes `related_adrs`, `related_research`, and `follow_up_adrs` in addition to the original field set. The relationship candidates extracted this run reflect the full field coverage of the MONOLITH docs/ corpus.

### Are synthesized placeholder nodes useful or noisy?

3 synthesized nodes out of 392 total.
Low synthesized node count — acceptable for this corpus size.

### Are canonical labels readable?

46 nodes had multiple label variants merged.
The `selectCanonicalLabel()` algorithm correctly prefers Title Case over lowercase variants. Examples: "Active Working Memory" (aliases: "memory-working-active"); "ADR-007 — Explicit-Only Identity Resolution in the Explicit Relationship Graph" (aliases: "ADR-007", "Explicit-Only Identity Resolution in the Explicit Relationship Graph"); "ADR-008 — Coordinatorium: Tactical Mission Lifecycle (First Vertical Slice)" (aliases: "ADR-008", "Coordinatorium — Tactical Mission Lifecycle (First Vertical Slice)").

### Are relationship targets resolvable enough for Terra?

Resolved edge rate: **81%** (13 of 16 edges).

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

81% of edges connect two real (non-synthesized) nodes. The graph has enough resolved structure to be a useful persistence target.


### Skipped Files

- `templates/default-instance/monolith/memory/working/governance-result.md` — too short (0 chars)
- `templates/default-instance/monolith/memory/working/integrity-result.md` — too short (0 chars)
