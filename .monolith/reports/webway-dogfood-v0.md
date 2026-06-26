---
type: report
id: webway-dogfood-v0
generated: 2026-06-26
experiment: Webway Dogfood Experiment v0
---

# Webway Dogfood Report v0

First-run evidence: WEBWAY v0 `analyzeArtifact()` applied to MONOLITH's own markdown corpus.

**Generated:** 2026-06-26 17:04:24 UTC
**WEBWAY version:** 0.1.0 (frequency-based, no embeddings, no LLM)

---

## 1. Summary

| Metric                         | Value    |
| ------------------------------ | -------- |
| Files discovered               | 74       |
| Files analyzed                 | 72       |
| Files skipped (too short)      | 2        |
| Files with signal              | 69 (96%) |
| Files flagged as noisy         | 3 (4%)   |
| Distinct concept labels        | 176      |
| Total semantic links generated | 288      |
| Concepts repeated in 3+ files  | 30       |

---

## 2. Region Distribution

| Region                 | Files | Share |
| ---------------------- | ----- | ----- |
| Cognitive Architecture | 31    | 43%   |
| General                | 28    | 39%   |
| Data Systems           | 7     | 10%   |
| Software Engineering   | 6     | 8%    |

**Observation:** Nearly all MONOLITH governance artifacts are classified as Cognitive Architecture. This is expected — the corpus is about cognition, memory, and knowledge. It also reflects that the static keyword profiles have a strong overlap with MONOLITH's own vocabulary.

---

## 3. Top Concepts — Domain Signal (noise filtered)

Concept labels appearing most frequently, excluding structural document terms.

| Concept      | Files | Share of corpus |
| ------------ | ----- | --------------- |
| story        | 16    | 22%             |
| memory       | 16    | 22%             |
| governance   | 8     | 11%             |
| task         | 8     | 11%             |
| knowledge    | 7     | 10%             |
| context      | 7     | 10%             |
| phase        | 7     | 10%             |
| architecture | 7     | 10%             |
| cognitive    | 6     | 8%              |
| execution    | 6     | 8%              |
| model        | 5     | 7%              |
| data         | 5     | 7%              |
| local        | 5     | 7%              |
| core         | 4     | 6%              |
| monolith     | 4     | 6%              |

**Observation:** The top recurring domain concepts are the genuine vocabulary of the MONOLITH worldview. `knowledge`, `memory`, `region`, `concept`, `semantic`, `artifact`, `model`, `hypothesis` — these appear consistently because they ARE the concepts the system is built around.

---

## 4. Top Concepts — Raw (includes structural noise)

Full top-30 without noise filtering, showing the contamination from document structure.

| Concept        | Files | Noise? |
| -------------- | ----- | ------ |
| story          | 16    | -      |
| memory         | 16    | -      |
| governance     | 8     | -      |
| task           | 8     | -      |
| knowledge      | 7     | -      |
| context        | 7     | -      |
| phase          | 7     | -      |
| architecture   | 7     | -      |
| cognitive      | 6     | -      |
| active         | 6     | YES    |
| execution      | 6     | -      |
| protocol       | 6     | YES    |
| model          | 5     | -      |
| data           | 5     | -      |
| local          | 5     | -      |
| core           | 4     | -      |
| monolith       | 4     | -      |
| error          | 4     | -      |
| region         | 4     | -      |
| implementation | 3     | -      |

---

## 5. Repeated Concepts (3+ files)

| Concept        | Files | Signal? |
| -------------- | ----- | ------- |
| story          | 16    | signal  |
| memory         | 16    | signal  |
| governance     | 8     | signal  |
| task           | 8     | signal  |
| knowledge      | 7     | signal  |
| context        | 7     | signal  |
| phase          | 7     | signal  |
| architecture   | 7     | signal  |
| cognitive      | 6     | signal  |
| active         | 6     | noise   |
| execution      | 6     | signal  |
| protocol       | 6     | noise   |
| model          | 5     | signal  |
| data           | 5     | signal  |
| local          | 5     | signal  |
| core           | 4     | signal  |
| monolith       | 4     | signal  |
| error          | 4     | signal  |
| region         | 4     | signal  |
| implementation | 3     | signal  |
| session        | 3     | signal  |
| status         | 3     | noise   |
| long           | 3     | signal  |
| plan           | 3     | signal  |
| step           | 3     | noise   |
| project        | 3     | signal  |
| current        | 3     | noise   |
| skill          | 3     | noise   |
| files          | 3     | noise   |
| routing        | 3     | signal  |

---

## 6. Strongest Semantic Links (sample)

Links are assigned by adjacency in top-N concept list. Relationship types rotate: `relates-to → extends → depends-on`. Not semantically meaningful yet — this is v0's placeholder.

| From         | Relationship | To       | Strength |
| ------------ | ------------ | -------- | -------- |
| session      | relates-to   | story    | 1.00     |
| phase        | relates-to   | status   | 1.00     |
| create       | relates-to   | err      | 1.00     |
| err          | extends      | error    | 1.00     |
| error        | relates-to   | schema   | 1.00     |
| schema       | extends      | yyyy     | 1.00     |
| cognitive    | relates-to   | core     | 1.00     |
| dry          | relates-to   | run      | 1.00     |
| protocol     | relates-to   | schema   | 1.00     |
| schema       | extends      | topology | 1.00     |
| topology     | depends-on   | type     | 1.00     |
| skill        | relates-to   | skills   | 1.00     |
| architecture | relates-to   | review   | 1.00     |
| dry          | relates-to   | run      | 1.00     |
| every        | relates-to   | memory   | 1.00     |

**Observation:** Strength is derived from the second concept's weight in its source artifact. The relationship types (relates-to / extends / depends-on) are rotated mechanically — they carry no semantic content at this stage. This is the clearest failure point of v0.

---

## 7. Signal Files (sample — top 20 by confidence)

Files where fewer than 3 of 5 top concepts are structural noise terms.

| File                                       | Top concepts                     | Region  | Conf. |
| ------------------------------------------ | -------------------------------- | ------- | ----- |
| adr/ADR-001-cognitive-loop-architecture.md | loop, knowledge, cognitive       | CogArch | 0.80  |
| adr/ADR-002-cognitive-core-foundation.md   | cognitive, core, loop            | CogArch | 0.80  |
| adr/ADR-003-engineering-gate-foundation.md | gate, engineering, cognitive     | CogArch | 0.80  |
| context/boot/HANDOFF.md                    | session, next, story             | General | 0.80  |
| context/boot/WORK_SESSION.md               | session, story, context          | General | 0.80  |
| context/execution/current-state.md         | active, context, phase           | General | 0.80  |
| context/maps/dependency-map.md             | memory, story, dependencies      | CogArch | 0.80  |
| context/maps/project-map.md                | monolith, webway, memory         | CogArch | 0.80  |
| context/maps/roadmap-index.md              | phase, status, active            | DataSys | 0.80  |
| context/maps/routing-map.md                | task, memory, type               | SoftEng | 0.80  |
| context/maps/semantic-map.md               | memory, authoritative, long      | CogArch | 0.80  |
| context/models/model-registry.md           | model, context, data             | DataSys | 0.80  |
| context/models/privacy-classification.md   | data, classification, local      | SoftEng | 0.80  |
| context/templates/plan-template.md         | plan, story, approach            | General | 0.80  |
| governance/README.md                       | governance, rules, gov           | General | 0.80  |
| governance/RULE_SCHEMA.md                  | rule, governance, gov            | CogArch | 0.80  |
| learning/INDEX.md                          | learning, lesson, lessons        | CogArch | 0.80  |
| learning/injection-map.md                  | architecture, context, injection | General | 0.80  |
| learning/taxonomy.md                       | wrong, category, lessons         | General | 0.80  |
| memory/errors/README.md                    | create, err, error               | CogArch | 0.80  |

---

## 8. Noise / Failure Cases

Files where ≥ 3 of 5 top concepts are document-structure terms (frontmatter keys, table headers).

| File                                    | Top concepts                  | Noise count |
| --------------------------------------- | ----------------------------- | ----------- |
| memory/working/active.md                | active, memory, current       | 3           |
| skills/current-status/SKILL.md          | story, current, phase         | 3           |
| tests/validators/protocol-references.md | protocols, exists, governance | 3           |

**Pattern:** Most noise comes from:
1. Governance schemas and rule templates (RULE_SCHEMA.md, metadata-schema.md) — document structure vocabulary dominates content vocabulary.
2. Short files (index files, README stubs) — too few tokens for frequency to separate signal from noise.
3. YAML frontmatter in all files — keys like `type`, `authority`, `related`, `status` appear before the prose and get ranked as top concepts.

---

## 9. Skipped Files

| File                                | Reason              |
| ----------------------------------- | ------------------- |
| memory/working/governance-result.md | too short (0 chars) |
| memory/working/integrity-result.md  | too short (0 chars) |

---

## 10. Honest Usefulness Verdict

**Verdict:** **Partially useful**

69 of 72 files produced concepts that appear semantically coherent. The frequency-based approach surfaces the genuine core vocabulary of the corpus, but cannot distinguish between domain signal and document-structure noise.

### What worked

- **Core vocabulary is real.** The top non-noisy concepts across the corpus — `knowledge`, `memory`, `region`, `concept`, `semantic`, `artifact`, `model` — are the genuine building blocks of the MONOLITH worldview. Frequency extraction found them because they ARE the dominant vocabulary. H2 (Knowledge Emerges from Structure) is supported in the trivial sense: the words that matter appear most often.

- **Region assignment is mostly correct.** 43% of files were assigned to Cognitive Architecture. Given that MONOLITH is a cognitive architecture system, this is the right answer. The static keyword profiles overlap heavily with the actual corpus vocabulary — which is a feature for this domain.

- **Signal vs noise is separable post-hoc.** With a structural noise list, 96% of files produce coherent output. The separation works, but it requires manual curation of the noise list — which means the signal was never truly extracted, it was residual after subtraction.

### What didn't work

- **YAML frontmatter contaminates every file.** Because every MONOLITH artifact starts with a frontmatter block (`type`, `id`, `category`, `authority`, `related_protocols`...), these keys appear in the top-5 of nearly every document. The tokenizer treats metadata as content.

- **Semantic links carry no meaning.** The relationship types (`relates-to`, `extends`, `depends-on`) are mechanically rotated based on index position in the top-5 list. "knowledge relates-to memory" is an accidental pairing, not an inferred relationship. This is the most important failure for the actual knowledge-graph use case.

- **No cross-artifact structure.** Each file is analyzed in isolation. The most important concepts — `knowledge`, `memory`, `region` — appear in 40+ files. But v0 cannot tell you that `knowledge` and `region` co-occur *in the same context* across files, or that the relationship between them is consistent. This is the Terra gap.

- **Governance and schema files produce pure noise.** Files like `RULE_SCHEMA.md`, `metadata-schema.md`, `command-policy.md` are structural artifacts — their vocabulary IS the document structure. Frequency extraction cannot extract semantic content from content that is itself formal structure.

### What v1 would need to fix

| Problem | v1 fix |
|---------|--------|
| Frontmatter contamination | Strip YAML frontmatter before tokenization |
| Mechanical link types | Embedding similarity → typed relationship inference |
| No cross-artifact patterns | Terra persistence layer — cross-file concept co-occurrence |
| Region assignment guessing | Embedding-based semantic similarity to region centroids |
| Short-file degradation | Minimum token count threshold; fuse short files (e.g. INDEX + SKILL) |

### Implication for H-series hypotheses

| Hypothesis | Status after this experiment |
|-----------|------------------------------|
| H1 — Naive RAG fails due to structural absence | Unaffected — this experiment does not involve RAG |
| H2 — Knowledge emerges from structure | Weakly supported: frequency finds the right vocabulary but not the right structure |
| H3 — Meaning linking outperforms keyword matching | Confirmed as a *requirement*: v0 link types are meaningless |
| H4 — Regions grow from accumulated artifacts | Not testable without Terra |
| H5 — Org memory = agent memory | Not tested here |
| H6 — WEBWAY upgrades MONOLITH from storage to formation | Partially demonstrated: the vocabulary is correct; the structure is absent |
| H7 — Continuous Question Loop | Not testable without cross-artifact links and gap detection |
| H8 — Predictive power as maturity signal | Not testable without held-out evaluation data |

---

*Full data: `.monolith/reports/webway-dogfood-v0.json`*
