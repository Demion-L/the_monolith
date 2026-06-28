---
type: research
id: R-0003
title: Cognitive Architecture Notes
status: complete
date: 2026-06-28
follow_up_adrs:
  - ADR-005
related_research:
  - R-0001
  - R-0002
---

# R-0003 — Cognitive Architecture Notes

---

## Executive Summary

This document collects architectural concepts drawn from cognitive science, neuroscience, and prior AI cognitive architecture work (ACT-R, SOAR, Global Workspace Theory, predictive coding frameworks). These concepts are treated as a lens for evaluating and extending MONOLITH's design — not as prescriptions. The most applicable findings concern the distinction between working memory and long-term memory, the role of attention in managing cognitive load, the mechanics of memory consolidation (REM/NREM sleep cycle analogues), and the concept of a global workspace as the medium through which memory regions communicate. These findings informed the Lexicon Mechanicus design and the future attention system.

---

## Background

**Concepts analyzed:** Classical and contemporary cognitive architecture literature, including:
- ACT-R (Anderson) — declarative/procedural memory split, activation spreading
- SOAR (Laird) — unified cognitive architecture, working memory, long-term memory
- Global Workspace Theory (Baars) — a central workspace where independent processors compete for attention
- Predictive Coding (Friston) — the brain as a prediction machine, updating beliefs on prediction error
- Biological Memory Consolidation — REM/NREM sleep cycles and their role in memory stabilization

**Why analyzed:** MONOLITH's cognitive layer (protocols, skills, modes) was designed pragmatically. Understanding the formal cognitive architecture literature provides validation for design choices already made and identifies concepts that could strengthen future evolution.

---

## Key Ideas

### From ACT-R

1. **Declarative vs Procedural Memory** — Declarative memory stores facts; procedural memory stores rules for action. These are distinct stores with different retrieval mechanics.
2. **Activation Spreading** — Retrieval of one memory activates related memories, increasing their retrieval likelihood. Relevance is computed from associative links, not explicit tags.
3. **Base-Level Learning** — Memory activation decays with time and is restored by use. Frequently used memories remain more accessible.
4. **Production Rules** — Procedural knowledge is stored as condition-action pairs: "if condition then action". These are the AI equivalent of skill protocols.

### From SOAR

5. **Working Memory Limitation** — Working memory is a small, fast-access store. Long-term memory is large but slower. Efficient architectures minimize what must be in working memory at any time.
6. **Chunking** — When a problem is solved repeatedly, the solution sequence is compiled into a single chunk — a more efficient unit of knowledge. Analogous to the finalize-story skill writing a compact capsule.
7. **Impasse and Sub-goaling** — When the main task cannot proceed, the system creates a sub-goal. Sub-goals are resolved before returning to the main task. Maps to MONOLITH's "one story at a time" invariant.

### From Global Workspace Theory

8. **Global Workspace** — A shared broadcast medium where specialized cognitive modules post results for other modules to consume. The workspace is attention's stage.
9. **Competition for Attention** — Multiple memory regions compete to broadcast into the workspace. The winner is the most contextually relevant signal.
10. **Ignition** — When a signal crosses a threshold, it "ignites" into the global workspace and becomes consciously available for processing.

### From Predictive Coding

11. **Prediction Error** — The primary signal is the difference between what was expected and what was observed. Memory is updated in response to prediction error, not in response to inputs per se.
12. **Hierarchical Abstraction** — Higher levels of the hierarchy encode more abstract predictions; lower levels encode more specific sensory-level predictions.
13. **Active Inference** — The system acts to minimize prediction error, not just to achieve goals. The architecture selects actions that confirm its predictions.

### From Biological Memory Consolidation

14. **REM Sleep** — Rapid-eye-movement sleep is associated with emotional memory processing and associative linking. Memories formed during the day are replayed and consolidated.
15. **NREM Sleep** — Non-REM sleep is associated with factual memory consolidation. Hippocampal replay transfers memories to cortical long-term storage.
16. **Sleep Spindles** — Bursts of neural activity during NREM that are correlated with memory consolidation success. A potential analogue: a compression pass during MONOLITH's sleep pipeline.
17. **Memory Reactivation** — During sleep, the brain selectively reactivates memories that need consolidation, not all memories equally. Priority is determined by relevance and emotional salience.

---

## Confirmed Ideas

### Declarative / Procedural Split

MONOLITH's memory split between `memory/` (declarative: facts, decisions, history) and `protocols/` + `skills/` (procedural: how-to rules and skill scripts) directly mirrors the ACT-R declarative/procedural distinction. This is a structurally sound design choice, confirmed by formal cognitive architecture.

**Status:** Implemented. `memory/` is declarative; `protocols/` and `skills/` are procedural.

### Working Memory Limitation (Boot Sequence)

The MONOLITH boot sequence is designed to load minimal context — only what is needed for the current task type. This mirrors SOAR's working memory limitation principle: load only what fits efficiently.

**Status:** Implemented via routing-map Table 4 (memory regions per task type).

### Chunking (Story Capsule)

The finalize-story skill's story capsule is a direct implementation of chunking: the sequence of steps taken during a story is compiled into a single compressed record that can be loaded efficiently in future sessions.

**Status:** Implemented in the finalize-story skill.

### One-Story-at-a-Time (Impasse Resolution)

The universal invariant "one story at a time, never start a new story without finishing the current one" maps to SOAR's impasse/sub-goaling principle: the system resolves the current goal before accepting a new one.

**Status:** Implemented as core invariant.

### Global Workspace (Routing Map)

The routing-map functions as MONOLITH's global workspace: it broadcasts what is relevant to the current task to all cognitive components (which cognitive mode to use, which skills to activate, which memory regions to load, which learning to inject). Different task types "compete" via the routing table to determine what gets loaded.

**Status:** Implemented as routing-map.

---

## New Ideas Worth Exploring

### Activation Spreading in Memory Retrieval

MONOLITH currently loads memory regions by explicit table lookup (routing-map Table 4). Activation spreading would allow loading a seed memory and then automatically including closely linked memories based on relationship edges. This is relevant once the Explicit Relationship Graph is the primary navigation structure.

**Prerequisite:** Explicit Relationship Graph must be the canonical navigation layer.

### REM/NREM Analogue in Sleep Pipeline

The biological distinction between REM (associative linking) and NREM (factual consolidation) suggests that MONOLITH's future sleep pipeline should have two passes:
- **NREM pass:** Promote working memory facts to long-term storage (already partially implemented via finalize-story)
- **REM pass:** Identify associative links between memories across different Knowledge Regions and write those links to the Explicit Relationship Graph

This would transform the Explicit Relationship Graph from a manually maintained artifact to a partially auto-generated one.

**Dependency:** Sleep pipeline implementation (see R-0001 outcomes).

### Attention System

Global Workspace Theory motivates a formal attention mechanism for MONOLITH: a layer that determines which Knowledge Regions are most relevant to the current task and broadcasts only those regions to the active working set. This would replace the static routing-map table with a dynamic attention function.

**Status:** Captured as vision. See `docs/vision/long-term-vision.md`.

### Prediction Error as Memory Update Signal

Rather than updating memory on every story completion (regardless of whether anything was surprising), MONOLITH could update memory only when the story outcome differed from what the plan predicted. This would reduce memory noise and focus long-term memory on genuinely informative events.

**Potential implementation:** A `prediction_error:` field in the story capsule, rated high/medium/low, used to gate long-term memory updates.

### Hierarchical Knowledge Abstraction

The predictive coding hierarchy suggests that MONOLITH's memory should be structured in levels of abstraction: concrete facts at the bottom, patterns at the middle, principles at the top. The current `memory/working/` vs `memory/long-term/` split is a two-level hierarchy. A three-level hierarchy would add a "principles" level above long-term memory.

**Relationship:** Connects to architecture-principles.md and core-invariants.md, which already encode the principles level informally.

---

## Ideas Rejected

### Full Predictive Coding Architecture

Implementing active inference (acting to minimize prediction error) would require MONOLITH to have a generative model of task outcomes. This is well beyond the current scope and would introduce non-determinism into the governance model.

**Reason rejected:** Requires generative model; introduces non-determinism; far beyond current scope.

### Neural Network Memory (Connectionist Approach)

Some cognitive architectures store memories as distributed activation patterns in a neural network rather than as discrete documents. This is incompatible with MONOLITH's file-based, human-readable memory design.

**Reason rejected:** Incompatible with file-based, inspectable, human-readable memory model.

### Emotional Salience as Memory Priority

Biological memory systems use emotional salience as a key priority signal. AI assistants do not have emotions, and simulating emotional salience would be an arbitrary heuristic with no grounding in the system's actual experience.

**Reason rejected:** Not applicable to AI assistants. No grounded signal to replace emotional salience.

---

## Research Outcomes

### Lexicon Mechanicus Design Validation

The cognitive architecture literature confirmed that a formal, stable vocabulary is a prerequisite for a well-functioning cognitive system. ACT-R and SOAR both define precise vocabularies for their memory types. This validated MONOLITH's decision to implement the Lexicon Mechanicus as the canonical terminology source before expanding memory architecture.

See `ADR-005`.

### Two-Level Memory Architecture Confirmed

The working/long-term split is validated by both ACT-R (declarative memory with different accessibility levels) and SOAR (working memory + long-term memory). The current MONOLITH structure is architecturally sound.

### Routing Map as Global Workspace

The analysis provided a formal frame for understanding why the routing-map is the most important structural element in MONOLITH's cognitive layer: it is the global workspace that integrates signals from memory, protocols, skills, and learning into a coherent response for each task type.

### Three-Pass Boot Sequence Rationale

The cognitive architecture literature confirms that working memory should be loaded incrementally and only with what is necessary. The MONOLITH boot sequence (fast recovery vs full recovery) mirrors the efficient working memory loading principles from SOAR and ACT-R.

---

## Follow-up ADRs

| ADR       | Title                        | Relationship                                                 |
| --------- | ---------------------------- | ------------------------------------------------------------ |
| ADR-005   | Lexicon Mechanicus           | Formal vocabulary confirmed as architectural prerequisite    |

---

## Open Questions

1. Is there a formal metric for "cognitive load" in MONOLITH's boot sequence? Can we measure how much working memory context is loaded per task type?
2. Should the boot sequence distinguish between a warm start (recent session, memory still valid) and a cold start (new session, memory may be stale)?
3. Would a three-level memory hierarchy (working / long-term / principles) provide enough benefit to justify the added complexity?
4. Can the Explicit Relationship Graph implement activation spreading without becoming a performance bottleneck?
5. What is the correct analogue for "prediction error" in a text-based AI system — plan deviation, integrity failure, or something else?
