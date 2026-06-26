---
type: memory
id: memory-long-term-hypotheses
category: long-term
authority: authoritative
related_protocols:
  - memory-governance
  - core-invariants
---

# Product & Research Hypotheses — WEBWAY

Structured, testable hypotheses underlying WEBWAY and MONOLITH.

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

## H1 — Naive RAG Fails Due to Structural Absence

**Status:** `active`

**Statement:**  
Naive RAG fails not because of poor retrieval algorithms, but because it never builds knowledge structures. Storing chunks and querying by similarity substitutes retrieval for comprehension. The output degrades on any question that requires synthesis, inference, or relational reasoning across documents.

**Why it matters:**  
This is the foundational critique that justifies building WEBWAY. If retrieval-augmented generation were sufficient for knowledge tasks, there would be no need for a semantic connection layer.

**Current evidence:**
- RAG systems hallucinate on synthesis questions ("what is the relationship between X and Y?") even when both X and Y appear in retrieved chunks.
- The "lost in the middle" problem shows that chunk position matters more than content relevance — a structural failure, not a retrieval failure.
- Retrieval quality degrades on abstract or relational queries where meaning is distributed across documents rather than localized in a single chunk.

**Unknowns:**
- Whether the failure mode is primarily retrieval (wrong chunks surface) or comprehension (inability to synthesize correct chunks).
- Whether sufficiently large context windows (1M+ tokens) might defer but not eliminate this failure mode.

**How to validate:**  
Compare WEBWAY-enriched retrieval vs naive RAG on a curated test set of relational queries ("how does X relate to Y?", "what changed between version A and B?"). Measure answer accuracy and hallucination rate.

---

## H2 — Knowledge Emerges from Structure, Not Data

**Status:** `active`

**Statement:**  
Knowledge is not information at rest. It emerges from identifying concepts, forming typed relationships between them, recognizing patterns, and building mental models. Raw text cannot be reliably queried for knowledge without this transformation layer.

**Why it matters:**  
Defines the transformation contract WEBWAY must perform. If information alone were sufficient, WEBWAY would be unnecessary. The pipeline `Artifact → Concepts → Links → Regions → Mental Models → Insights` only makes sense if each step adds epistemic value.

**Current evidence:**
- Human cognition research (Minsky's frames, schema theory, Novak's concept maps) consistently demonstrates that comprehension requires structure — not just storage.
- Expert performance in any domain correlates with richer concept maps, not larger information stores.
- v0 `analyzeArtifact()` demonstrates that even frequency-based structure extraction produces semantically coherent region assignments, suggesting the structural signal is present in text and extractable.

**Unknowns:**
- Whether machine-generated concept maps can meaningfully approximate human knowledge structures in precision and recall.
- What minimum structural depth is required before knowledge queries become reliable.
- Whether typed relationship labels add measurable value over untyped or unlabeled concept graphs.

**How to validate:**  
Measure whether `WebwayAnalysisResult` structures improve downstream answer quality compared to raw artifact text on a set of multi-hop reasoning tasks. Design tasks that require concept relationship traversal to answer correctly.

---

## H3 — Meaning Linking Outperforms Keyword Matching

**Status:** `active`

**Statement:**  
Semantic connections between concepts — linked by meaning and relationship type — yield more accurate and transferable knowledge representations than keyword co-occurrence or TF-IDF weighting. The typed edge (`depends-on`, `extends`, `contrasts-with`) carries information that keyword proximity cannot.

**Why it matters:**  
This is the core technical bet of WEBWAY. v0 uses frequency extraction as a deterministic foundation. The hypothesis is that this is a prototype, not a ceiling — and that embedding-based semantic linking (v1) will produce measurably better knowledge representations.

**Current evidence:**
- v0 prototype shows that frequency-based extraction already produces region assignments that align with human intuition (manually verified on software engineering and cognitive architecture artifacts).
- Embedding-based semantic similarity in published systems consistently outperforms keyword matching on paraphrase, abstraction, and cross-document tasks.
- Typed relationship graphs (knowledge graphs) have demonstrated improvements in question-answering accuracy over flat document retrieval in multiple published benchmarks.

**Unknowns:**
- Magnitude of improvement that embedding-based extraction (v1) will provide over v0 frequency extraction in practice.
- Whether relationship type labels add measurable downstream value, or whether the graph topology alone is sufficient.
- Optimal embedding model for concept-level (not sentence-level) representation.

**How to validate:**  
A/B test v0 (frequency-based) vs v1 (embedding-based) on knowledge region assignment accuracy against a human-labeled test set of 50+ artifacts. Measure precision, recall, and F1 per region.

---

## H4 — Knowledge Regions Can Grow from Accumulated Artifacts

**Status:** `deferred` *(requires v2 corpus analysis)*

**Statement:**  
As more artifacts are analyzed, emergent clusters of related concepts will form natural Knowledge Regions — boundaries that are inferred from corpus structure, not predefined by static keyword lists. The four hardcoded regions in v0 are a bootstrap, not a final architecture.

**Why it matters:**  
v0 uses 4 static regions with manually curated keywords. This hypothesis is the bet that the system can evolve beyond hardcoded categories into a self-organizing knowledge topology where regions emerge from evidence rather than assumption.

**Current evidence:**
- Topic modeling approaches (LDA, BERTopic, Top2Vec) demonstrate that corpus-level clustering produces coherent domain regions without predefined labels, across many domains.
- v0 region scoring is structurally corpus-agnostic — it uses static keywords, but the scoring function itself is replaceable with any signal.
- MONOLITH's own memory artifacts (decisions, story capsules, architecture-principles) already cluster naturally into identifiable knowledge regions when analyzed manually.

**Unknowns:**
- Minimum corpus size before induced regions stabilize and generalize.
- Whether induced regions will match domain expert expectations at useful granularity.
- How to handle artifacts that span multiple regions without forcing arbitrary assignment.
- Whether regions should be hierarchical (sub-regions within regions).

**How to validate:**  
Run `analyzeCorpus()` (v2+) on 100+ artifacts. Compare induced regions against human expert domain labels. Measure region stability as corpus grows (add 10 artifacts at a time, track region boundary drift).

---

## H5 — Organizational Memory and Agent Memory Are the Same Problem

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

---

## H6 — Webway Is the Bridge from Memory Governance to Knowledge Formation

**Status:** `active`

**Statement:**  
MONOLITH currently governs AI memory: what to write, where to write it, when to read it. WEBWAY is the capability that evolves MONOLITH from memory governance — managing information at rest — into knowledge formation — actively building meaning from accumulated information. Without WEBWAY, MONOLITH is a well-organized document system. With WEBWAY, it can reason over its own memory and discover structure it did not explicitly create.

**Why it matters:**  
Defines the long-term product relationship between MONOLITH (the kernel) and WEBWAY (the first cognitive module). Establishes WEBWAY not as a standalone utility but as the semantic engine that enables MONOLITH to upgrade its own capabilities over time.

**Current evidence:**
- v0 `analyzeArtifact()` can already be applied to any MONOLITH memory artifact (active.md, decisions.md, story capsules) and extract concepts, region assignments, and semantic links — without any changes to the kernel.
- The `WebwayAnalysisResult` output shape is structurally compatible with future cross-document graph construction: concepts carry IDs and source references, links carry typed relationship labels.
- The MONOLITH boot sequence already reads memory artifacts in a fixed order — WEBWAY analysis could be inserted as an enrichment step without breaking the existing protocol.

**Unknowns:**
- At which point in the MONOLITH boot sequence should WEBWAY analysis be applied (pre-load enrichment vs on-demand query-time analysis).
- Whether semantic analysis of governance artifacts is useful in practice or primarily theoretically interesting.
- Whether the MONOLITH kernel needs a formal interface for cognitive modules (capability registry) or whether direct import is sufficient.

**How to validate:**  
Apply WEBWAY analysis to 10 MONOLITH memory artifacts from a live project. Verify that the extracted knowledge graph reflects governance relationships recognizable to a human analyst. Measure whether concept-region assignments are stable across artifact types (protocol files, memory files, context files).

---

## H7 — Continuous Question Loop

**Status:** `active`

**Statement:**  
A cognitive system becomes capable of self-directed learning when it can continuously identify gaps in its own world model and generate questions to resolve them. Memory stores information. WEBWAY creates meaning. Question Loops create curiosity and directed learning.

**Why it matters:**  
This hypothesis defines the next evolutionary step beyond WEBWAY's knowledge formation. A system that only accumulates knowledge passively will stagnate. A system that detects what it does not know — and asks — grows. The Question Loop is the difference between a knowledge archive and a learning agent. It closes the loop between knowledge structure and knowledge acquisition.

**Current evidence:**
- Human learning appears driven by unresolved questions rather than passive information accumulation. Curiosity research (Loewenstein's information-gap theory) frames curiosity as the detection of a gap between what is known and what is desired to be known.
- RLM-style (Reasoning Language Model) architectures demonstrate that focusing on model gaps rather than answer generation improves reasoning quality — gap detection is a learnable and productive cognitive operation.
- WEBWAY's v0 output naturally exposes opportunities for gap detection: missing links between extracted concepts, concepts without region assignment, mental models with low confidence scores, and regions with sparse conceptIds are all observable gap signals.

**Unknowns:**
- How should gaps be formally represented — as absent edges in the concept graph, as low-confidence region assignments, as concepts without outbound links, or as a separate gap type?
- How should generated questions be prioritized — by gap severity, by region relevance to the active story, or by potential knowledge gain?
- How can false-positive gaps be filtered — not every missing link represents missing knowledge; some gaps are intentional boundaries between domains.

**How to validate:**  
Implement gap detection over `WebwayAnalysisResult` structures (missing links, isolated concepts, low-confidence mental models). Generate candidate questions from detected gaps. Measure whether resolving those questions — by ingesting new artifacts — reduces gap count and increases knowledge region coherence over time.

---

## H8 — Predictive Power as a Measure of Knowledge

**Status:** `active`

**Statement:**  
Knowledge becomes valuable when it enables inference of unknown information. Information describes observations. Knowledge explains observations. Mature knowledge predicts — meaning it generates accurate expectations about information that is absent, hidden, or not yet observed, regardless of whether that information lies in the future, the past, or an unexamined region of the present.

Prediction is not exclusively temporal. A domain expert who infers an unknown past fact from surviving evidence is exercising the same epistemic capability as one who forecasts a future event. Both require a knowledge structure dense enough to constrain what is possible and point toward what is probable.

A Knowledge Region should not be evaluated solely by the number of concepts, relationships, or artifacts it contains, but by its ability to generate accurate inferences about unseen information.

**Why it matters:**  
MONOLITH currently models knowledge formation through:

```
Information → Concepts → Semantic Links → Knowledge Regions → Mental Models
```

There is not yet a clear criterion for determining whether a Knowledge Region represents genuine understanding or merely a collection of related information. Predictive power — understood as inference capability over unknown information — may become the primary maturity signal for knowledge.

A region that can explain the past but cannot generate accurate inferences about unseen information may still be informational rather than truly knowledgeable.

**Current evidence:**
- Scientific theories are valued primarily by explanatory and predictive power (Popper's falsifiability criterion; a theory that cannot predict is not distinguishable from post-hoc description).
- Human expertise is recognized through successful prediction rather than fact recall — a chess master predicts position consequences, a diagnosis expert predicts patient outcomes.
- **Schliemann / Troy:** Heinrich Schliemann did not observe the Trojan War. He inferred the location of Troy from Homer's descriptions and regional geography. His knowledge structure — an integrated model of the text, topography, and archaeological evidence available to him — was dense enough to point at a specific location before excavation confirmed it. This is predictive inference directed at an unknown past fact, not a future event. The mechanism is identical to forecasting: knowledge constrains possibility and identifies the most probable unknown.
- Mature domains allow practitioners to infer outcomes from incomplete information — a sign that concept relationships have become reliable enough to generalize.
- Mental models become useful when they support forecasting and decision making; a mental model that only describes what already happened adds no leverage.
- Knowledge emerges when sufficient connectedness between concepts allows inference beyond explicitly stored information — this is the network effect of structured knowledge vs. flat retrieval.

**Unknowns:**
- What qualifies as a prediction inside MONOLITH? (Inferred missing concepts? Anticipated relationship types? Forecasted region assignments for unseen artifacts?)
- Can predictive power be measured without access to external reality? (Holdout test sets, cross-validation on known artifacts, or adversarial evaluation?)
- Are all mature Knowledge Regions necessarily predictive, or are some domains inherently descriptive (e.g., historical records)?
- How should cross-domain predictions be represented — an inference that bridges two regions may require a meta-model above the region level?
- Can prediction quality become a formal maturity metric for Knowledge Regions alongside concept count and link density?

**How to validate:**  
Investigate whether Knowledge Regions can be evaluated by their ability to:
- infer missing concepts given a partial artifact
- infer missing relationships given a partial concept graph
- generate useful hypotheses about unseen artifacts in the same domain
- forecast future observations (e.g., which concepts will appear in a new artifact about X?)
- explain unexpected outcomes (why did a concept receive an unexpected region assignment?)

Compare highly connected regions against descriptive-only regions on inference tasks. A region should score higher on prediction if it has denser concept graphs, typed relationships, and cross-validated mental models.

---

### Analysis: Should Region Maturity Evolve to Descriptive → Explanatory → Predictive?

**The proposal:**  
Replace or extend the current three-level maturity model (`seed → growing → mature`) with an epistemic capability model: `Descriptive → Explanatory → Predictive`.

**Current model (knowledge-regions.md):**

| Maturity | Meaning |
| -------- | ------- |
| `seed` | Region identified; core concepts named; relationships emerging |
| `growing` | Concepts actively developing; relationships clarifying; evidence accumulating |
| `mature` | Region well-understood; stable concepts; relationships established |

The current model measures **quantity and stability** — how many concepts exist, how settled the relationships are. It says nothing about what the region can *do*.

**H8's implied model:**

| Level | Epistemic Capability |
| ----- | -------------------- |
| `descriptive` | Region can name and organize what was observed |
| `explanatory` | Region can articulate *why* observed patterns occur |
| `predictive` | Region can anticipate patterns in unseen information |

This model measures **epistemic power** — what the knowledge structure enables. It is a capability axis, not a size axis.

**Does H8 support the proposed model?**  
Yes, with one important qualification: the two axes are orthogonal, not equivalent. A region can be large and stable (`mature` by current definition) and still only descriptive. A small but tightly structured region might already be explanatory. The proposed model implies a new axis that the current model does not capture — it does not simply rename the existing levels.

**What evidence would be required before adopting it?**

1. **A working definition of each epistemic level inside MONOLITH.** Currently undefined. Before renaming maturity levels, we need formal criteria: what distinguishes a descriptive region from an explanatory one in terms of measurable concept graph properties (edge density, typed relationships, cross-artifact coverage)?

2. **At least one example of an explanatory region in the current corpus.** KR-3 (Organizational Memory) is marked `mature` and carries rich relationship types — does it support explanation? Does it enable inferences beyond what is explicitly recorded? This needs to be tested, not assumed.

3. **A prediction task with measurable accuracy.** Before labeling any region `predictive`, we need a task: given a new artifact about domain X, can the region for X correctly anticipate the artifact's top concepts? Predictive label requires demonstrated predictive performance on holdout data.

4. **A clear decision on whether to replace or extend the current model.** The current maturity labels are used in knowledge-regions.md across 7 regions. Replacing them would require updating all regions simultaneously. Extending (adding `epistemic_level` as a second dimension alongside `maturity`) is lower risk and more expressive.

**Recommendation:**  
Do not modify knowledge-regions.md or knowledge-lifecycle.md until validation criterion (3) can be met. H8 is the hypothesis; the maturity model revision is the consequence if it validates. The right artifact to update first is this hypotheses file — recording the proposal and its preconditions — not the region definitions themselves.

**Blocking condition:**  
This cannot be adopted without a concrete prediction task and measured accuracy on at least one region. Without that, "predictive" becomes a label applied to regions that are merely large — which is exactly the failure mode H8 is trying to avoid.
