---
type: story-capsule
id: story-1.1
phase: phase-1
title: Cognitive Core Foundation + Webway Dogfood v0
date: 2026-06-26
status: COMPLETED
---

# STORY 1.1 — Cognitive Core Foundation + Webway Dogfood v0

## Objective

Two related goals executed in sequence:

1. Capture the conceptual evolution from H8 toward a self-directed learning layer (Cognitive Core) and formalize the Engineering Gate pattern — architecture documentation only, no runtime.
2. Run WEBWAY v0 against MONOLITH's own markdown corpus and produce the first evidence report (dogfood experiment).
3. Derive and record an architectural insight from the dogfood findings: Story as the unit of engineering evolution; Decision as its terminal state.

---

## Implementation Summary

### Part 1 — Cognitive Core Foundation

Formalized two conceptual layers that were previously unnamed:

**Cognitive Core** — the future self-directed learning layer of MONOLITH. Holds the central question "What remains unknown?" and operationalizes it through three sub-questions: What contradiction is unresolved? What missing link would make this region more predictive? What question should be asked next? Closes the loop between WEBWAY's linear pipeline and the Knowledge Lifecycle's Stage 1. Explicitly non-goals: no claims of consciousness, no autonomous agency, no runtime loops yet.

**Engineering Gate** — the task-preparation layer. Transforms ambiguous engineering work into Implementation Packages (scope, source of truth, assumptions, unknowns, success criteria, constraints, recommended plan) before passing to executor agents. Formalized from a recurring pattern observed across five projects: myAPT, Second Brain, AgentCollect, Reasoning Projector, MONOLITH. Does not write code. Separate from Cognitive Core.

H8 was also refined: prediction reframed as *inference of unknown information* (not exclusively future events). The Schliemann/Troy example added as evidence — expertise can infer unknown past facts from present evidence, using the same epistemic mechanism as forecasting.

### Part 2 — Webway Dogfood Experiment v0

Created `src/scripts/dogfood.ts` — a TypeScript script that:
- Scans `.monolith/**/*.md`, `docs/**/*.md`, `README.md`
- Calls `analyzeArtifact()` on each file
- Aggregates concepts, links, region distribution, noise classification
- Writes `.monolith/reports/webway-dogfood-v0.json` and `.monolith/reports/webway-dogfood-v0.md`

**First run results (72 files analyzed):**
- Signal files: 69 (96%)
- Noisy files: 3 (4%)
- Distinct concepts: 176
- Concepts repeated in 3+ files: 30
- Region distribution: Cognitive Architecture 43%, General 39%, Data Systems 10%, Software Engineering 8%
- Top concepts: `story` (16 files), `memory` (16 files), `governance` (8), `knowledge` (7)

**Verdict: Partially useful.** Core vocabulary is real. Region assignment is mostly correct. Semantic links carry no meaning (rotation-based). 39% General reflects a gap in the region model, not in the extractor. Frontmatter contamination is the main noise source.

### Part 3 — Story Lifecycle Insight

The dogfood run surfaced `story` as the most frequent concept — not by design. This led to formalizing Story as the first-class unit of engineering evolution in MONOLITH.

Created `story-lifecycle.md` defining:
- Story as the complete trajectory from ambiguous task to crystallized knowledge
- The lifecycle: Task → Investigation → Hypotheses → Research → Experiments → Evidence → Decision → ADR/Memory Update → Archive
- Decision as the terminal state of Story (not a parallel process)
- Decision can be affirmative, negative, or epistemic — all are valid terminal states
- A Story without a Decision remains open; it does not archive
- Story splitting: each sub-Story carries its own independent Decision arc
- Story as the source of artifacts that feed the Knowledge Lifecycle

---

## Files Created

| File | Purpose |
| ---- | ------- |
| `.monolith/memory/long-term/cognitive-core.md` | Cognitive Core conceptual definition |
| `.monolith/memory/long-term/engineering-gate.md` | Engineering Gate conceptual definition |
| `.monolith/memory/long-term/story-lifecycle.md` | Story Lifecycle — Story as unit of engineering evolution |
| `.monolith/adr/ADR-002-cognitive-core-foundation.md` | ADR: Cognitive Core Foundation — Accepted |
| `.monolith/adr/ADR-003-engineering-gate-foundation.md` | ADR: Engineering Gate Foundation — Accepted |
| `.monolith/reports/webway-dogfood-v0.json` | Dogfood experiment full data (5 802 lines) |
| `.monolith/reports/webway-dogfood-v0.md` | Dogfood evidence report |
| `src/scripts/dogfood.ts` | Experiment script (compiles to dist/scripts/dogfood.js) |

## Files Updated

| File | Change |
| ---- | ------ |
| `.monolith/memory/long-term/hypotheses.md` | H8 refined: prediction = inference over unknown information; Schliemann/Troy added |
| `.monolith/memory/long-term/knowledge-lifecycle.md` | Stage 7 note (epistemic_level axis proposed); "Story as Source of Artifacts" section |
| `.monolith/memory/long-term/knowledge-regions.md` | Epistemic Level second axis added (proposed, not adopted) |
| `.monolith/memory/long-term/decisions.md` | ADR-002 and ADR-003 pointers |
| `.monolith/context/maps/semantic-map.md` | cognitive-core, engineering-gate, story-lifecycle, report pointers |
| `.monolith/context/maps/project-map.md` | ADR-002, ADR-003, new memory files |
| `package.json` | `"dogfood"` script added |

---

## Key Decisions

| Decision | Rationale |
| -------- | --------- |
| Cognitive Core named as a conceptual layer | The ADR-001 loop had no named driver; naming it creates a home for future implementation stories |
| Engineering Gate formalized from pattern | Five-project recurring observation; naming it makes it intentional |
| Decision = terminal state of Story | Dogfood finding + architectural reflection; resolves ambiguity in prior governance model |
| Prediction = inference over unknown information | H8 refinement — Schliemann/Troy shows prediction is not exclusively temporal |
| Epistemic level axis marked as proposed | Cannot adopt without a concrete prediction task with measured accuracy (H8 blocking condition) |
| Dogfood verdict: Partially useful | Honest assessment: vocabulary correct, structure absent, semantic links meaningless |

---

## Lessons Learned

1. **Dogfood surfaces what design documents cannot.** The `story` frequency finding emerged from data, not intent. Frequency extraction, for all its limitations, is sufficient to reveal dominant vocabulary — and dominant vocabulary reveals dominant concerns.

2. **Naming patterns that already work is architectural work.** Engineering Gate was already happening; naming it is the decision. The same is true of Story-as-unit — it was implicit in every protocol and skill; making it explicit removes ambiguity.

3. **Negative Decisions are complete Decisions.** A Decision that says "hypothesis rejected" or "we do not build this" is as final and as valuable as an affirmative Decision. Both archive the Story. The lifecycle model must not be read as a success-only path.

4. **39% General region = gap in region model, not extractor failure.** Governance and protocol documents have real vocabulary (`task`, `governance`, `execution`, `context`, `phase`) that doesn't match any keyword profile. A "Systems Governance" region is a candidate for the region map — but requires corpus evidence, not just intuition.

5. **Frontmatter is the primary noise source for v0.** Stripping YAML frontmatter before tokenization is the single highest-value fix for a v0.1 improvement, before embeddings or any other v1 work.
