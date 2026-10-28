---
type: memory
id: memory-long-term-hypotheses
category: long-term
authority: authoritative
related_protocols:
  - memory-governance
  - core-invariants
---

# Product & Research Hypotheses

Structured, testable hypotheses whose subject is MONOLITH. Hypotheses about Webway's research program live in the Webway repository (`docs/hypotheses.md`).

Each hypothesis is a section with a stable marker in its heading, `## <Title> {#HYP-NNN}`. The marker is the identity of the hypothesis (`monolith:HYP-NNN`); it does not depend on the title or on this file's path. `HYP-005` keeps the number of the original H5. The numbers 001…008 belong to the original sequence and are not issued again: a new hypothesis takes the next number after the highest one used in this file, never lower than 009.

Each hypothesis is a bet. Record evidence and unknowns as work proceeds.  
Update status when evidence changes: `active → validated | rejected | deferred`.

---

## Status Legend

| Status | Meaning |
| ------ | ------- |
| `active` | Being pursued; evidence is accumulating |
| `validated` | Sufficient evidence collected; hypothesis holds |
| `rejected` | Evidence contradicts the hypothesis; record what was learned |
| `deferred` | Relevant but requires a later phase to test |

---

## Organizational Memory and Agent Memory Are the Same Problem {#HYP-005}

**Status:** `active`

**Statement:**  
The challenge of preserving accumulated experience across AI agent session boundaries is structurally identical to the challenge of preserving organizational knowledge across employee transitions. Both require structured knowledge transfer — not raw document retrieval — and both fail in the same way: the new actor must rediscover what the prior actor already knew.

**Why it matters:**  
If true, WEBWAY is not merely a RAG improvement — it is infrastructure for institutional memory at the AI level. The scope of the problem expands from "better search" to "transferable accumulated experience." This dramatically changes the value proposition of MONOLITH as a whole.

**Current evidence:**
- MONOLITH's existing governance layer (active.md, story capsules, HANDOFF.md) already solves the agent session transfer problem structurally — and the design mirrors classic knowledge management patterns (Nonaka's SECI model: socialization → externalization → combination → internalization).
- The failure mode in both cases is identical: context loss on actor transition, rediscovery of previously solved problems, inconsistent application of past decisions.
- MONOLITH's `.monolith/memory/` structure maps directly onto knowledge management categories: working memory (tacit/explicit), long-term memory (explicit/documented), error records (failure memory), lessons (externalized learning).

**Unknowns:**
- Whether agent memory retrieval and organizational memory retrieval have meaningfully different access patterns that require different storage or indexing strategies.
- Whether the same semantic structures that work for technical knowledge (code, architecture) generalize to organizational/procedural knowledge.
- How to represent the provenance of knowledge (who generated it, in what context) in a way that is useful for future actors.

**How to validate:**  
Apply WEBWAY analysis to MONOLITH's own `.monolith/memory/` artifacts (decisions.md, story capsules, architecture-principles.md). Measure whether the generated knowledge graph accurately represents governance relationships that a human analyst would recognize. Compare against a baseline of manual tagging.
