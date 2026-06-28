---
type: architecture
id: cognitive-infrastructure
authority: authoritative
stability: stable
last_updated: 2026-06-28
related_adrs:
  - ADR-004
  - ADR-005
---

# Cognitive Infrastructure

The structural description of MONOLITH and the Cognitive Kernel it is developing.

---

## Two Concurrent Projects

There are two distinct projects in this repository. They are related but not the same thing.

**MONOLITH** is a research platform. Its responsibilities are architectural research, experimentation, dogfooding, documentation, ADRs, RFCs, implementation, validation, and the evolution of cognitive architectures. MONOLITH answers the question: *How do we build cognitive systems?*

**Cognitive Kernel** (working name) is the cognitive architecture being born inside MONOLITH. It is the product of the research platform — not the platform itself. It is the collection of cognitive subsystems responsible for knowledge processing, memory, reasoning, and future autonomous cognition.

The relationship:

```
MONOLITH (Research Platform)

     │ develops
     ▼

Cognitive Kernel

     │ contains
     ▼

Scriptorium · Terra · Graph Memex · Document Store · WEBWAY
(future) Attention · Working Memory · Critic · Research · World Model
```

This separation is intentional. Keeping research and cognition distinct preserves clear responsibilities and allows each to evolve independently.

---

## Enforcement Model (MONOLITH Platform)

```
Enforcement Kernel knows HOW.
Instance knows WHAT.
```

The Enforcement Kernel contains generic enforcement mechanics, protocol routing, integrity validation, and drift detection.
An Instance provides project-specific configuration: which protocols exist, where files are, which validators are active.

Note: "Enforcement Kernel" refers to the `@monolith/core` package — the governance engine. This is distinct from "Cognitive Kernel," which is the cognitive architecture under development. See the Lexicon Mechanicus for the precise definition of both terms.

---

## System Layers

The layers below describe the Cognitive Kernel's internal architecture — the cognitive subsystems that MONOLITH is building. The research, ADR, and vision documentation layers above them belong to MONOLITH-the-platform and govern how the Cognitive Kernel evolves.

```
╔══════════════════════════════════════════════════════════════╗
║  MONOLITH — Research Platform                                ║
║                                                              ║
║  Vision Layer          (docs/vision/)                        ║
║  Long-term direction. Informs future research and ADRs.      ║
║                              ↕                               ║
║  Documentation Layer   (docs/)                               ║
║  Research → ADRs → Architecture                              ║
╚══════════════════════════════════════════════════════════════╝
                              │ develops
                              ▼
╔══════════════════════════════════════════════════════════════╗
║  COGNITIVE KERNEL                                            ║
║                                                              ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │  Cognitive Layer       (protocols/ + skills/)         │   ║
║  │  Behavioral modes, enforcement, skills, boot sequence │   ║
║  └──────────────────────────────────────────────────────┘   ║
║                              ↕                               ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │  Memory Layer          (memory/ + governance/)        │   ║
║  │  Working, long-term, error memory. Governance rules.  │   ║
║  └──────────────────────────────────────────────────────┘   ║
║                              ↕                               ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │  Context Layer         (context/)                     │   ║
║  │  Maps, routing, models. Navigation infrastructure.    │   ║
║  └──────────────────────────────────────────────────────┘   ║
║                              ↕                               ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │  Learning Layer        (learning/)                    │   ║
║  │  Error taxonomy, injection map, mistake records.      │   ║
║  └──────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════╝
```

---

## Core Components (Current)

The components below are all parts of the Cognitive Kernel. They are built and researched by MONOLITH. Each component listed under a layer is a Cognitive Kernel subsystem.

### Cognitive Layer

**Cognitive Modes** (`protocols/cognition/cognitive-modes.md`)
Seven named modes that govern AI behavioral posture for each task type: exploration, planning, implementation, debugging, review, finalization, reflection. Each mode defines what is allowed, what is forbidden, and what mutations are permitted.

**Routing Map** (`context/maps/routing-map.md`)
The global workspace of the cognitive layer. Declares which mode, skill, protocols, memory regions, learning hooks, and model tier are active for each task type. This is the primary dispatching mechanism.

**Skills** (`skills/`)
Procedural knowledge encoded as step-by-step protocols. Skills are activated by the routing-map and executed by the AI assistant. Current skills: finalize-story, current-status, global-status, self-improvement.

**Boot Sequence** (`protocols/boot/boot-sequence.md`)
Deterministic session initialization. Defines the exact order in which context is loaded before any task begins. Two modes: fast recovery (minimal context), full recovery (complete context reload).

### Memory Layer

**Working Memory** (`memory/working/`)
Volatile, per-story state. Contains: active story pointer, story index, integrity results, governance results. Cleared or archived on story finalization.

**Long-Term Memory** (`memory/long-term/`)
Stable, cross-story knowledge. Contains: architectural decisions, architecture principles, tech debt registry, execution history log. Execution history is append-only.

**Error Memory** (`memory/errors/`)
Records of failures and their structured classifications. Source material for the learning layer.

### Context Layer

**Semantic Map** (`context/maps/semantic-map.md`)
Declares where authoritative truth lives for each semantic domain. Functions as a lightweight oracle: given a question domain, it resolves the authoritative source document.

**Project Map** (`context/maps/project-map.md`)
Navigation guide for the full cognitive architecture of a project instance. Top-level document after AGENTS.md.

**Dependency Map** (`context/maps/dependency-map.md`)
Tracks dependencies between stories, skills, protocols, and memory artifacts.

### Learning Layer

**Taxonomy** (`learning/taxonomy.md`)
Seven error categories: architecture, dependencies, nonexistent-api, context-sync, workflow, typescript, documentation.

**Injection Map** (`learning/injection-map.md`)
Maps task types to the lesson categories that should be preloaded at boot step 8. Prevents known mistakes from recurring.

**Governance Rules** (`governance/GOV-*.md`)
Project-specific behavioral constraints created when repeated failure patterns are detected. Unlike core invariants (universal), governance rules are project-specific.

---

## Terminology (Lexicon Mechanicus)

The following terms have precise meanings in MONOLITH documentation. Using synonyms is not permitted.

See `ADR-005` for the decision to establish this vocabulary.

### Project-Level Terms

| Term                    | Definition                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| **MONOLITH**            | The research platform. Responsible for architectural research, experimentation, ADRs, RFCs, implementation, validation, and documentation. MONOLITH answers: *How do we build cognitive systems?* |
| **Cognitive Kernel**    | The cognitive architecture being developed inside MONOLITH. The product of the research platform. Contains cognitive subsystems responsible for knowledge processing, memory, reasoning, and future autonomous cognition. Working name — final canonical name may change as the architecture matures. |
| **Enforcement Kernel**  | The generic governance engine inside `@monolith/core`. Contains enforcement mechanics, protocol routing, integrity validation, and drift detection. Independent of any specific project. Not to be confused with Cognitive Kernel. |
| **Instance**            | A project-specific MONOLITH deployment with its own `project.definition.mjs`. |
| **COS**                 | Cognitive Operating System — the combined system (MONOLITH platform + Cognitive Kernel). Used when referring to the whole. |

### Cognitive Kernel Subsystems (Current)

| Term                    | Definition                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| **Scriptorium**         | The structured document ingestion subsystem of the Cognitive Kernel.                         |
| **Terra**               | The proposed structured persistence substrate for the Cognitive Kernel's memory layer (see ADR-004, ADR-006). |
| **Graph Memex**         | The graph-based associative memory exploration layer. Complementary to Terra, not a replacement. Also called the Explicit Relationship Graph. |
| **Document Store**      | The Cognitive Kernel's primary document persistence layer (current form: file-based markdown with frontmatter). |
| **WEBWAY**              | A Cognitive Kernel subsystem. (Definition to be added as architecture matures.)              |
| **Explicit Relationship Graph** | The graph layer of typed edges between memory artifacts, enabling associative navigation. Phase 1 deliverable. |
| **Sleep Pipeline**      | The consolidation pass that runs on story finalization, promoting, pruning, and linking memories. |

### Operational Terms

| Term                | Definition                                                                              |
| ------------------- | --------------------------------------------------------------------------------------- |
| **Cognitive Mode**  | A named behavioral posture governing what an AI assistant may do during a task.         |
| **Protocol**        | A deterministic, file-encoded behavioral rule enforced on the AI assistant.             |
| **Skill**           | A step-by-step procedural script for a specific recurring task type.                    |
| **Working Memory**  | Volatile, per-story memory. Cleared or archived on story finalization.                  |
| **Long-Term Memory**| Stable, cross-story memory. Updated on significant decisions.                           |
| **Story**           | The atomic unit of work. One story is in progress at a time.                            |
| **Phase**           | A named collection of related stories forming a milestone.                              |
| **Knowledge Region**| A scoped partition of the memory corpus, routed to by the routing-map.                  |
| **Routing Map**     | The global dispatching declaration mapping task types to all cognitive resources.       |
| **Semantic Map**    | The oracle-style declaration of where authoritative truth lives per semantic domain.    |
| **Lexicon Mechanicus** | This vocabulary — the canonical terminology source for all MONOLITH documentation. |

---

## Invariants

The following invariants are always active, regardless of cognitive mode or task type. They may not be relaxed without an ADR.

1. One story at a time.
2. Vertical slice first.
3. No autonomous capability expansion.
4. No hidden state.
5. Memory before code.
6. Integrity before report.
7. No silent semantic degradation.
8. **MONOLITH is the research platform. The Cognitive Kernel is the evolving cognitive architecture developed inside MONOLITH. Research and cognition are intentionally separated to preserve clear responsibilities and independent evolution.**

Source: `templates/default-instance/monolith/protocols/governance/core-invariants.md`

---

## Source of Truth by Domain

| Domain                        | Authoritative Source                                         |
| ----------------------------- | ------------------------------------------------------------ |
| Terminology                   | This document (Lexicon Mechanicus section) + ADR-005         |
| MONOLITH / Cognitive Kernel boundary | This document (Two Concurrent Projects section)       |
| Memory rules (Cognitive Kernel) | `protocols/governance/memory-governance.md`               |
| Behavioral rules (Cognitive Kernel) | `protocols/governance/core-invariants.md`             |
| Task routing (Cognitive Kernel) | `context/maps/routing-map.md`                             |
| Memory location (Cognitive Kernel) | `context/maps/semantic-map.md`                         |
| ADR decisions (MONOLITH platform) | `docs/adr/`                                              |
| Research findings (MONOLITH platform) | `docs/research/`                                     |
| Long-term direction (both)    | `docs/vision/`                                               |
