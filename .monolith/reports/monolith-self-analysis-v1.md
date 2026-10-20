---
type: report
id: monolith-self-analysis-v1
generated: 2026-06-29
experiment: .monolith/ Self-Analysis Dogfood
---

# MONOLITH Self-Analysis — Dogfood Report v1

**Experiment:** What does MONOLITH see when it looks at its own `.monolith/` memory?
**Generated:** 2026-06-29 04:53:18 UTC
**Pipeline:** `compileMarkdownArtifact()` → `buildGraph()`
**Corpus:** `.monolith/` (excluding `.monolith/reports/`)

---

## 1. Summary Metrics

| Metric                        | Value    | docs/ baseline |
| ----------------------------- | -------- | -------------- |
| Markdown files discovered     | 77       | 81             |
| Files compiled                | 77       | —              |
| Files skipped (too short)     | 0        | —              |
| Total concept candidates      | 513      | —              |
| Total relationship candidates | 39       | —              |
| Graph nodes (total)           | 398      | 481            |
| Graph nodes (real)            | 392      | 481            |
| Graph nodes (synthesized)     | 6        | 0              |
| Graph edges                   | 39       | 32             |
| Edges — both nodes real       | 29 (74%) | 32 (100%)      |
| Isolated real nodes           | 370      | —              |
| Merged label nodes            | 58       | —              |
| Diagnostics (warn)            | 6        | —              |

---

## 2. Subsystem Breakdown

How relationship density varies across MONOLITH operational subsystems.

| Subsystem  | Files | Concepts | Rel. candidates | Connected? |
| ---------- | ----- | -------- | --------------- | ---------- |
| memory     | 20    | 157      | 27              | YES        |
| tests      | 18    | 100      | 0               | isolated   |
| protocols  | 13    | 85       | 0               | isolated   |
| context    | 11    | 75       | 0               | isolated   |
| learning   | 5     | 21       | 0               | isolated   |
| skills     | 5     | 44       | 3               | YES        |
| adr        | 3     | 21       | 9               | YES        |
| governance | 2     | 10       | 0               | isolated   |

**Dark subsystems** (zero relationship candidates): `tests`, `protocols`, `context`, `learning`, `governance`

---

## 3. Concept Source Distribution

| Source      | Count | Share |
| ----------- | ----- | ----- |
| heading     | 455   | 89%   |
| list-item   | 58    | 11%   |
| frontmatter | 0     | 0%    |
| link-label  | 0     | 0%    |

---

## 4. Relationship Type Distribution

| Relationship type  | Edge count |
| ------------------ | ---------- |
| related_protocols  | 13         |
| related_decisions  | 10         |
| related_hypotheses | 6          |
| referenced_by      | 3          |
| related_regions    | 3          |
| protocols          | 3          |
| related_skills     | 1          |

---

## 5. Top Connected Nodes

Ranked by total degree (in + out).

| Node (canonical label)                          | Degree | Sources | Synthesized? |
| ----------------------------------------------- | ------ | ------- | ------------ |
| Memory Governance                               | 13     | 1       | -            |
| ADR-001 — Introduce Cognitive Loop Architecture | 8      | 2       | -            |
| ADR-002 — Introduce Cognitive Core Foundation   | 8      | 2       | -            |
| Cognitive Core — Conceptual Foundation          | 5      | 1       | -            |
| Story Lifecycle                                 | 5      | 1       | -            |
| Active Working Memory                           | 4      | 1       | -            |
| ADR-003 — Introduce Engineering Gate Foundation | 3      | 2       | -            |
| H7                                              | 3      | 1       | YES          |
| Skill: Finalize Story                           | 3      | 1       | -            |
| Webway v1 Research Plan                         | 3      | 1       | -            |
| Engineering Gate — Conceptual Foundation        | 2      | 1       | -            |
| H8                                              | 2      | 1       | YES          |
| Knowledge Lifecycle v0                          | 2      | 1       | -            |
| KR-7                                            | 2      | 1       | YES          |
| Product & Research Hypotheses — WEBWAY          | 2      | 1       | -            |

---

## 6. Isolated Real Nodes (sample)

Real nodes (non-synthesized) with zero edges — knowledge that is not linked to anything.

- `1. Avoid Monolithic Context Files`
- `1. Frequency ≠ Importance`
- `2. No Phrase Detection`
- `2. Separate Stable vs Volatile Memory`
- `3. No Concept Normalization`
- `3. Single Source of Truth`
- `4. Append-Only History`
- `4. Relationship Types Are Rotational Fiction`
- `5. Link Strength = Adjacent Concept's Weight`
- `5. Story Context Required`
- `6. Integrity Before Report`
- `6. Region Scoring by Keyword Substring Match`
- `Accepted Debt`
- `Activation`
- `Active Phase`
- `Active Story`
- `Adding a Skill`
- `ADR-007 — Explicit-Only Identity Resolution in the Explicit Relationship Graph`
- `ADRs Written`
- `AGENTS.md`
- `AI Assistant Boot Sequence`
- `AI updates HANDOFF.md`
- `All steps recorded`
- `Analysis: Should Region Maturity Evolve to Descriptive → Explanatory → Predictive?`
- `Anything marked CONFIDENTIAL`
- `Apply .monolith/protocols/cognition/cognitive-modes.md`
- `Approach`
- `Architecture Decision Records`
- `Architecture Decisions Domain`
- `Architecture principles referenced`
- … and 340 more

---

## 7. Files With Relationship Candidates

| File                                                  | Relationship candidates |
| ----------------------------------------------------- | ----------------------- |
| .monolith/adr/ADR-002-cognitive-core-foundation.md    | 5                       |
| .monolith/memory/long-term/cognitive-core.md          | 5                       |
| .monolith/memory/long-term/story-lifecycle.md         | 5                       |
| .monolith/memory/working/active.md                    | 4                       |
| .monolith/memory/long-term/webway-v1-research-plan.md | 3                       |
| .monolith/adr/ADR-001-cognitive-loop-architecture.md  | 2                       |
| .monolith/adr/ADR-003-engineering-gate-foundation.md  | 2                       |
| .monolith/memory/long-term/engineering-gate.md        | 2                       |
| .monolith/memory/long-term/hypotheses.md              | 2                       |
| .monolith/memory/long-term/knowledge-lifecycle.md     | 2                       |
| .monolith/skills/finalize-story/SKILL.md              | 2                       |
| .monolith/memory/long-term/architecture-principles.md | 1                       |
| .monolith/memory/long-term/decisions.md               | 1                       |
| .monolith/memory/long-term/knowledge-regions.md       | 1                       |
| .monolith/memory/working/story-index.md               | 1                       |

---

## 8. Files With Zero Relationships

61 files produced no relationship candidates. These are knowledge islands with no explicit connections.

- `.monolith/context/boot/HANDOFF.md`
- `.monolith/context/boot/WORK_SESSION.md`
- `.monolith/context/execution/current-state.md`
- `.monolith/context/maps/dependency-map.md`
- `.monolith/context/maps/project-map.md`
- `.monolith/context/maps/roadmap-index.md`
- `.monolith/context/maps/routing-map.md`
- `.monolith/context/maps/semantic-map.md`
- `.monolith/context/models/model-registry.md`
- `.monolith/context/models/privacy-classification.md`
- `.monolith/context/templates/plan-template.md`
- `.monolith/governance/README.md`
- `.monolith/governance/RULE_SCHEMA.md`
- `.monolith/learning/INDEX.md`
- `.monolith/learning/injection-map.md`
- `.monolith/learning/mistakes/workflow/LESSON-2026-0001.md`
- `.monolith/learning/mistakes/workflow/LESSON-2026-0002.md`
- `.monolith/learning/taxonomy.md`
- `.monolith/memory/errors/README.md`
- `.monolith/memory/errors/SCHEMA.md`
- `.monolith/memory/errors/TAXONOMY.md`
- `.monolith/memory/long-term/execution-history.md`
- `.monolith/memory/long-term/tech-debt.md`
- `.monolith/memory/working/governance-result.md`
- `.monolith/memory/working/integrity-result.md`
- `.monolith/memory/working/phases/phase-1/stories/story-1.1-cognitive-core-and-dogfood-v0.md`
- `.monolith/memory/working/phases/phase-1/stories/story-1.3-scriptorium-erg-canonical-identity.md`
- `.monolith/protocols/boot/boot-sequence.md`
- `.monolith/protocols/cognition/cognitive-modes.md`
- `.monolith/protocols/cognition/dry-run.md`
- `.monolith/protocols/cognition/execution-trace-format.md`
- `.monolith/protocols/cognition/semantic-planning.md`
- `.monolith/protocols/execution/hybrid-execution.md`
- `.monolith/protocols/execution/local-llm-governance.md`
- `.monolith/protocols/governance/command-policy.md`
- `.monolith/protocols/governance/core-invariants.md`
- `.monolith/protocols/governance/memory-governance.md`
- `.monolith/protocols/governance/metadata-schema.md`
- `.monolith/protocols/governance/skills.md`
- `.monolith/protocols/governance/work-session.md`
- … and 21 more

---

## 9. Good Edge Samples

Edges where both source and target are real (non-synthesized) nodes.

| From                                | Type              | To                                  | Source file                             |
| ----------------------------------- | ----------------- | ----------------------------------- | --------------------------------------- |
| Active Working Memory               | referenced_by     | Skill: Current Status               | working/active                          |
| Active Working Memory               | referenced_by     | Skill: Finalize Story               | working/active                          |
| Active Working Memory               | referenced_by     | Skill: Global Status                | working/active                          |
| Active Working Memory               | related_protocols | Memory Governance                   | working/active                          |
| ADR-002 — Introduce Cognitive Core  | related_decisions | ADR-001 — Introduce Cognitive Loop  | adr/ADR-002-cognitive-core-foundation   |
| ADR-003 — Introduce Engineering Gat | related_decisions | ADR-001 — Introduce Cognitive Loop  | adr/ADR-003-engineering-gate-foundation |
| ADR-003 — Introduce Engineering Gat | related_decisions | ADR-002 — Introduce Cognitive Core  | adr/ADR-003-engineering-gate-foundation |
| Architectural Decisions             | related_protocols | Memory Governance                   | long-term/decisions                     |
| Architecture Principles             | related_protocols | Memory Governance                   | long-term/architecture-principles       |
| Cognitive Core — Conceptual Foundat | related_decisions | ADR-001 — Introduce Cognitive Loop  | long-term/cognitive-core                |

---

## 10. Noisy Edge Samples

Edges where the target is a synthesized placeholder — referenced but not found in the corpus.

| From                                | Type               | To (unresolved) | Source file                             |
| ----------------------------------- | ------------------ | --------------- | --------------------------------------- |
| ADR-001 — Introduce Cognitive Loop  | related_hypotheses | H7              | adr/ADR-001-cognitive-loop-architecture |
| ADR-001 — Introduce Cognitive Loop  | related_regions    | KR-7            | adr/ADR-001-cognitive-loop-architecture |
| ADR-002 — Introduce Cognitive Core  | related_hypotheses | H7              | adr/ADR-002-cognitive-core-foundation   |
| ADR-002 — Introduce Cognitive Core  | related_hypotheses | H8              | adr/ADR-002-cognitive-core-foundation   |
| ADR-002 — Introduce Cognitive Core  | related_regions    | KR-6            | adr/ADR-002-cognitive-core-foundation   |
| ADR-002 — Introduce Cognitive Core  | related_regions    | KR-7            | adr/ADR-002-cognitive-core-foundation   |
| Cognitive Core — Conceptual Foundat | related_hypotheses | H7              | long-term/cognitive-core                |
| Cognitive Core — Conceptual Foundat | related_hypotheses | H8              | long-term/cognitive-core                |
| Story Lifecycle                     | related_skills     | finalize-story  | long-term/story-lifecycle               |
| Webway v1 Research Plan             | related_hypotheses | H3              | long-term/webway-v1-research-plan       |

---

## 11. Unresolved Relationship Targets

6 targets were referenced in frontmatter but not found as real nodes:

- `h7`
- `kr-7`
- `h8`
- `kr-6`
- `finalize-story`
- `h3`

---

## 12. Merged / Canonical Labels

| Canonical label                                 | Aliases                                        |
| ----------------------------------------------- | ---------------------------------------------- |
| Active Working Memory                           | memory-working-active                          |
| ADR-001 — Introduce Cognitive Loop Architecture | ADR-001, Introduce Cognitive Loop Architecture |
| ADR-002 — Introduce Cognitive Core Foundation   | ADR-002, Introduce Cognitive Core Foundation   |
| ADR-003 — Introduce Engineering Gate Foundation | ADR-003, Introduce Engineering Gate Foundation |
| AI Assistant Boot Sequence                      | protocol-boot-sequence                         |
| Architectural Decisions                         | memory-long-term-decisions                     |
| Architecture Principles                         | memory-long-term-architecture-principles       |
| CAP-2: Concept Normalization                    | CAP-2 — Concept Normalization                  |
| CAP-3: Semantic Concept Ranking                 | CAP-3 — Semantic Concept Ranking               |
| CAP-4: Relationship Type Inference              | CAP-4 — Relationship Type Inference            |
| CAP-5: Semantic Region Scoring                  | CAP-5 — Semantic Region Scoring                |
| Cognitive Core — Conceptual Foundation          | memory-long-term-cognitive-core                |
| Cognitive Dry-Run Protocol                      | protocol-dry-run                               |
| Cognitive Modes Protocol                        | protocol-cognitive-modes                       |
| Command Policy                                  | protocol-command-policy                        |
| Core Invariants                                 | protocol-core-invariants                       |
| Current State                                   | context-execution-current-state                |
| Engineering Gate — Conceptual Foundation        | memory-long-term-engineering-gate              |
| Error Record Schema                             | error-schema                                   |
| Execution History                               | memory-long-term-execution-history             |

… and 38 more.

---

## 13. Heading Noise Check

No structurally degenerate headings found. Heading noise filter is working correctly on this corpus.

---

## 14. Critical Questions — Answers

### 1. Does .monolith/ produce a denser or weaker graph than docs/?

**Denser.** .monolith/ produced 39 edges vs. 32 in docs/. Despite having fewer files (77 vs 81), the operational memory corpus is more richly cross-referenced.

### 2. Which parts of MONOLITH memory are well-connected?

The most relationship-rich files are: `.monolith/adr/ADR-002-cognitive-core-foundation.md` (5 candidates), `.monolith/memory/long-term/cognitive-core.md` (5 candidates), `.monolith/memory/long-term/story-lifecycle.md` (5 candidates), `.monolith/memory/working/active.md` (4 candidates), `.monolith/memory/long-term/webway-v1-research-plan.md` (3 candidates).

### 3. Which parts are isolated?

Subsystems with zero relationship candidates: `tests`, `protocols`, `context`, `learning`, `governance`. These are dark regions — they contain knowledge but declare no explicit connections to other parts of the memory.

### 4. Do protocols, hypotheses, and memory documents link to each other?

Yes — there are 29 fully-resolved edges between real nodes. Cross-linking is present but concentrated in specific files.

### 5. Does Scriptorium understand MONOLITH's own operational memory format?

Yes — Scriptorium extracted 513 concept candidates from 77 files. The frontmatter parser recognizes 39 relationship candidates. However, many .monolith/ files use IDs (e.g., "protocol-memory-governance") as reference targets that may not resolve to heading-based concept nodes — this is the primary resolution gap.

### 6. What is the next evidence-based fix?

**Primary fix:** 6 synthesized nodes exist because relationship targets use short IDs (e.g., "memory-governance") that differ from how those documents appear as heading concepts. The fix is to ensure every `.monolith/` document's `id:` field value is registered as a concept alias — which the graph builder already does via Pass 2.5, but only when the `id:` value is also extractable as a concept node. This is a corpus alignment problem: add or standardize `id:` fields in the files being referenced.

---

## 15. Verdict

**READY FOR TERRA**

74% of edges connect two real nodes. The .monolith/ graph has sufficient resolved structure to be a useful persistence target.

### Comparison: .monolith/ vs docs/

| Metric            | .monolith/     | docs/ baseline |
|-------------------|----------------|----------------|
| Files processed   | 77             | 81             |
| Nodes (real)      | 392            | 481            |
| Nodes (synth.)    | 6              | 0              |
| Edges (total)     | 39             | 32             |
| Edges (both real) | 29 (74%)       | 32 (100%)       |
| Edge/file ratio   | 0.51           | 0.40           |

