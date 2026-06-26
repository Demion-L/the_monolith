---
type: memory
id: memory-long-term-knowledge-regions
category: long-term
authority: authoritative
related_protocols:
  - memory-governance
---

# Knowledge Regions — WEBWAY Conceptual Map

Canonical knowledge regions in the MONOLITH worldview.

This is a conceptual artifact, not an implementation schema.  
It defines the semantic territory WEBWAY operates within and the relationships between domains.  
Update region maturity and relationships as understanding deepens.

---

## Maturity Legend

| Maturity | Meaning |
| -------- | ------- |
| `seed` | Region identified; core concepts named; relationships emerging |
| `growing` | Concepts actively developing; relationships clarifying; evidence accumulating |
| `mature` | Region well-understood; stable concepts; relationships established |

The maturity axis measures **quantity and stability** of accumulated knowledge.

---

## Epistemic Level — Proposed Second Axis

**Status: proposed — not yet adopted. Do not apply to region entries until validation criteria in H8 are met.**

H8 (Predictive Power as a Measure of Knowledge) identifies that maturity alone does not capture what a Knowledge Region can *do*. A second axis is proposed to track epistemic capability independently of accumulation:

| Epistemic Level | Meaning |
| --------------- | ------- |
| `descriptive` | Region can name and organize what was observed |
| `explanatory` | Region can articulate *why* observed patterns occur |
| `predictive` | Region can generate accurate inferences about unseen information — past, future, or absent |

These axes are **orthogonal**, not sequential:
- A small but tightly structured region may already be `explanatory`.
- A large `mature` region may still be only `descriptive` if its concept graph lacks the density and typed relationships needed for inference.
- The label `predictive` requires a demonstrated prediction task with measured accuracy on holdout data — it cannot be assigned based on region size.

This proposal will remain marked as proposed until at least one region satisfies the validation criteria defined in H8.

---

## Region Map

```
Knowledge Systems ──────────────────────────────┐
     │                                           │
     ├── informs ──► Agent Systems               │
     │                    │                      │
     │                    ├── mirrors ──► Organizational Memory
     │                    │                      │
     │                    └── uses ──► Information Retrieval
     │                                           │
     └── implements ──► WEBWAY ◄── extends ── MONOLITH
                          │
                          ├── transcends ──► Information Retrieval
                          │
                          └──► Cognitive Processes ◄──────────────┐
                                    │                              │
                                    ├──► Knowledge Systems         │
                                    └──► Agent Systems ────────────┘
```

---

## KR-1 — Knowledge Systems

**Maturity:** `growing`

**Purpose:**  
The theoretical and practical study of how knowledge is formed, organized, represented, and transferred. This region is the intellectual foundation for WEBWAY's design philosophy — it explains *why* building knowledge structure matters and *what* valid knowledge representations look like.

**Core Concepts:**

| Concept | Description |
| ------- | ----------- |
| Memex | Vannevar Bush's 1945 vision: associative trails linking related information, mirroring human thought. The original semantic connection metaphor. |
| Knowledge Formation | The process by which raw information is transformed into knowledge through structure, context, and relationship. The core transformation WEBWAY performs. |
| Knowledge Lifecycle | Creation → Organization → Transfer → Application → Decay → Renewal. Knowledge is not static; it requires active maintenance. |
| Mental Models | Cognitive frameworks that allow reasoning over a domain without re-reading all source material. WEBWAY's MentalModel type implements this concept. |
| Expertise | The state of holding rich, deeply interconnected concept maps in a domain, enabling non-obvious pattern recognition. The target state for a mature Knowledge Region. |

**Relationships to other regions:**

| Relationship | Target Region | Description |
| ------------ | ------------- | ----------- |
| `informs` | Agent Systems | Agents depend on knowledge representations to reason and plan |
| `informs` | Organizational Memory | Organizational memory is applied knowledge systems at institutional scale |
| `implements-via` | WEBWAY | WEBWAY is the operational implementation of knowledge formation theory |
| `critiques` | Information Retrieval | Knowledge systems theory explains why retrieval alone is insufficient (H1, H2) |

---

## KR-2 — Agent Systems

**Maturity:** `growing`

**Purpose:**  
Systems and mechanisms by which AI agents reason, plan, use tools, remember context, and coordinate with other agents. This region defines the operational environment that WEBWAY and MONOLITH serve — an AI agent is the primary consumer of the knowledge structures WEBWAY builds.

**Core Concepts:**

| Concept | Description |
| ------- | ----------- |
| Agent Memory | How agents maintain and access context across turns, sessions, and task boundaries. The problem MONOLITH was built to govern. |
| Planning | Decomposing goals into executable steps given available context and tools. Depends on structured knowledge to avoid redundant rediscovery. |
| Reasoning | Inferring conclusions, resolving conflicts, and generating novel connections from accumulated evidence. Improved by rich concept graphs. |
| Tool Use | Extending agent capabilities via external functions, APIs, and services. Defines what agents can do; knowledge structures define what they know. |
| Multi-Agent Systems | Coordination, delegation, and knowledge sharing between multiple independent agents. Requires shared knowledge representations to interoperate. |

**Relationships to other regions:**

| Relationship | Target Region | Description |
| ------------ | ------------- | ----------- |
| `governed-by` | MONOLITH | MONOLITH provides the memory governance kernel for agent operation |
| `enriched-by` | WEBWAY | WEBWAY provides semantic enrichment for agent memory artifacts |
| `mirrors` | Organizational Memory | Agent session transfer and org knowledge transfer are the same structural problem (H5) |
| `depends-on` | Knowledge Systems | Effective agent reasoning requires structured knowledge, not raw retrieval |

---

## KR-3 — Organizational Memory

**Maturity:** `mature`

**Purpose:**  
How human organizations capture, preserve, and transfer accumulated knowledge and experience across time and personnel transitions. This region is mature in research literature but underexplored in AI systems — hypothesis H5 bets that agent memory and organizational memory are the same problem, making this region directly applicable to MONOLITH.

**Core Concepts:**

| Concept | Description |
| ------- | ----------- |
| Onboarding | The process of transferring sufficient knowledge to a new actor (employee or agent) to make them productive. The cold-start problem in agent sessions is identical. |
| Knowledge Transfer | Moving accumulated expertise from one actor to another without loss. Requires externalization of tacit knowledge. |
| Process Documentation | Externalizing tacit procedures into explicit, repeatable structures. MONOLITH's protocols and skills are the AI equivalent. |
| Institutional Knowledge | Domain expertise embedded in people rather than documents — the most fragile form of knowledge, lost on actor departure. WEBWAY aims to externalize this. |
| Tacit vs Explicit Knowledge | Nonaka's distinction: tacit (in-head, hard to articulate) vs explicit (documented, transferable). MONOLITH's story capsules and HANDOFF.md make tacit agent knowledge explicit. |

**Relationships to other regions:**

| Relationship | Target Region | Description |
| ------------ | ------------- | ----------- |
| `mirrors` | Agent Systems | Structurally identical transfer problem at different scale (H5) |
| `grounds` | Knowledge Systems | Organizational memory is the applied instantiation of knowledge systems theory |
| `implemented-by` | MONOLITH | MONOLITH's memory governance layer mirrors organizational knowledge management patterns |

---

## KR-4 — Information Retrieval

**Maturity:** `mature`

**Purpose:**  
Mechanisms for accessing relevant information from large corpora given a query or need. This region represents the dominant current approach to AI knowledge access — and the approach WEBWAY is designed to transcend. Understanding IR deeply clarifies what WEBWAY adds and what it deliberately does not replicate.

**Core Concepts:**

| Concept | Description |
| ------- | ----------- |
| RAG | Retrieval-Augmented Generation: chunk documents, embed chunks, retrieve by similarity, inject into context. Fast to build; brittle on synthesis and relational queries (H1). |
| Vector Search | Similarity search over dense embedding vectors. Captures semantic proximity but not semantic structure — finds "related" not "how related." |
| Knowledge Graphs | Structured graph representation of entities and relationships. The closest existing approach to WEBWAY's model; typically requires manual construction or supervised extraction. |
| Semantic Search | Meaning-based retrieval, overcoming exact keyword matching. Addresses surface-level failure of keyword search but does not build knowledge structure. |
| BM25 / TF-IDF | Statistical keyword-based retrieval. Fast and interpretable. The baseline that semantic approaches aim to surpass. WEBWAY's v0 frequency extraction is closer to this than to embeddings. |

**Relationships to other regions:**

| Relationship | Target Region | Description |
| ------------ | ------------- | ----------- |
| `used-by` | Agent Systems | Agents use IR to access external knowledge at query time |
| `insufficient-for` | Knowledge Systems | IR accesses knowledge but does not form it — the core critique in H1 |
| `transcended-by` | WEBWAY | WEBWAY builds structure that IR cannot produce from chunks alone (H1, H3) |

---

## KR-5 — MONOLITH

**Maturity:** `seed`

**Purpose:**  
The cognitive operating system kernel governing AI agent behavior, memory, and lifecycle within a project. MONOLITH is the operational environment — the OS layer — on which WEBWAY and future cognitive modules run. It currently governs *how agents work*; WEBWAY evolves it toward *what agents know*.

**Core Concepts:**

| Concept | Description |
| ------- | ----------- |
| Governance | Protocols and invariants that constrain agent behavior. Prevents autonomous capability expansion, enforces story discipline, protects memory integrity. |
| Memory | Structured working memory (volatile, per-story) and long-term memory (stable, cross-story). The substrate that WEBWAY semantically enriches. |
| Routing | Declarative mapping from task type to cognitive mode, skill, protocols, and memory regions. The dispatch layer for agent cognition. |
| Lifecycle | Boot → Work → Finalize cycle. Each session must complete boot before acting; each story must pass integrity before closing. |
| Cognitive Modes | Seven named behavioral states (exploration, planning, implementation, debugging, review, finalization, reflection) each with explicit permissions and constraints. |

**Relationships to other regions:**

| Relationship | Target Region | Description |
| ------------ | ------------- | ----------- |
| `governs` | Agent Systems | MONOLITH is the memory and behavior governance kernel for AI agents |
| `mirrors` | Organizational Memory | MONOLITH's governance patterns directly parallel knowledge management in organizations |
| `hosts` | WEBWAY | WEBWAY is MONOLITH's first cognitive capability module (H6) |
| `evolves-via` | WEBWAY | WEBWAY upgrades MONOLITH from memory governance to knowledge formation (H6) |

---

## KR-6 — WEBWAY

**Maturity:** `seed`

**Purpose:**  
The semantic connection layer of MONOLITH. Transforms raw Artifacts into structured knowledge by extracting Concepts, building typed Semantic Links, assigning Knowledge Regions, and generating Mental Models. WEBWAY is the Meaning Linker — it connects information by meaning rather than keywords and grows knowledge structure over time.

**Core Concepts:**

| Concept | Description |
| ------- | ----------- |
| Concepts | Named semantic units extracted from Artifacts, each with a normalized weight. The atomic unit of WEBWAY's knowledge representation. |
| Semantic Links | Directed, typed relationships between Concepts (e.g., `relates-to`, `extends`, `depends-on`). Carry more information than proximity or co-occurrence. |
| Pattern Discovery | Recognizing recurring structures across Concepts and Regions that were not explicitly encoded. The emergent behavior WEBWAY is designed to enable at maturity. |
| Knowledge Regions | Domain clusters that organize related Concepts. Currently 4 predefined static regions (v0); will be dynamically inferred from corpus (H4, v3). |
| Mental Models | Higher-order pattern abstractions over a Knowledge Region. The output that enables reasoning without re-reading source artifacts. |

**Relationships to other regions:**

| Relationship | Target Region | Description |
| ------------ | ------------- | ----------- |
| `implements` | Knowledge Systems | WEBWAY operationalizes knowledge formation theory |
| `enriches` | Agent Systems | WEBWAY adds semantic structure to agent memory artifacts |
| `extends` | MONOLITH | WEBWAY is the first cognitive module extending MONOLITH's capabilities (H6) |
| `transcends` | Information Retrieval | WEBWAY builds structure that IR cannot produce from chunks (H1, H3) |
| `resolves` | Organizational Memory | WEBWAY provides the semantic layer for knowledge transfer across agent sessions (H5) |
| `exposes-gaps-to` | Cognitive Processes | WEBWAY's output (isolated concepts, low-confidence models) surfaces gap signals for Question Loops (H7) |

---

## KR-7 — Cognitive Processes

**Maturity:** `seed`

**Purpose:**  
The internal operations by which a cognitive system monitors its own knowledge state, detects gaps, generates questions, and directs its own learning. This region is the bridge between passive knowledge accumulation (WEBWAY) and active knowledge formation (Question Loop). It is the layer where a system stops being a repository and becomes a learner.

**Core Concepts:**

| Concept | Description |
| ------- | ----------- |
| Question Loop | The continuous cycle of detecting a knowledge gap, generating a question to resolve it, acquiring new information, and updating the world model. The mechanism for self-directed learning (H7). |
| Curiosity | The drive to resolve detected gaps. In cognitive systems, curiosity is the prioritization signal that determines which gaps to pursue — modeled by Loewenstein's information-gap theory. |
| Gap Detection | The operation of identifying absent, weak, or contradictory connections in the current knowledge structure. In WEBWAY terms: isolated concepts, missing links, low-confidence mental models, sparse regions. |
| Learning | The update of the world model in response to resolved gaps. Distinguished from mere information storage — learning changes structure, not just content. |
| Model Reconciliation | The process of integrating new knowledge with existing mental models, resolving conflicts, and updating region assignments when evidence changes. |
| Self-Reflection | The capacity of a system to represent and reason over its own knowledge state — a prerequisite for gap detection and question generation. |

**Relationships to other regions:**

| Relationship | Target Region | Description |
| ------------ | ------------- | ----------- |
| `feeds-on` | WEBWAY | WEBWAY's concept graph and mental models are the substrate on which gap detection operates (H7) |
| `drives` | WEBWAY | Question Loops direct what new artifacts WEBWAY should analyze next |
| `grounds-in` | Knowledge Systems | Curiosity and gap detection are studied phenomena in knowledge formation theory |
| `informs` | Knowledge Systems | Self-reflection produces meta-knowledge about the knowledge system itself |
| `upgrades` | Agent Systems | Agents with Question Loops shift from reactive (answer when asked) to proactive (identify what to learn) |
| `required-by` | Agent Systems | Self-directed learning requires agents to model their own knowledge gaps |
