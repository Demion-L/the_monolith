---
type: memory
id: memory-long-term-webway-v1-research-plan
category: long-term
authority: authoritative
related_protocols:
  - memory-governance
related_decisions:
  - ADR-001
related_hypotheses:
  - H3
---

# Webway v1 Research Plan

What must change for WEBWAY to move from deterministic keyword/frequency prototype to semantic meaning-based linking.

v1 scope: **better concept extraction and semantic relationship quality only.**  
v1 does not introduce autonomous discovery, cross-artifact linking, or dynamic regions.

---

## v0 Limitations

### 1. Frequency ≠ Importance

v0 ranks concepts by word frequency. The most repeated word wins, regardless of semantic weight. In a document about "knowledge graph construction", the word "the" would top the list if not stopworded. Even with stopwords, "graph" may win over "construction" simply by appearing more often — not because it is more conceptually central.

**Effect:** Concept extraction is a crude statistical signal. High-frequency words are not necessarily the ideas that matter.

### 2. No Phrase Detection

v0 tokenizes on whitespace and treats every token as an independent candidate. "Mental model", "knowledge graph", "semantic link" — each is split into two unrelated tokens. "Mental" and "model" each become Concept Candidates, but their compound meaning is lost.

**Effect:** Multi-word concepts — the most domain-specific and precise semantic units — are systematically destroyed.

### 3. No Concept Normalization

"Memory", "memories", "memorize" — three tokens, three candidates, three potentially separate Concepts. Synonyms are never merged. Morphological variants compete with each other for top-N slots.

**Effect:** Concept deduplication across inflections is impossible. The concept graph is noisier than the domain actually is.

### 4. Relationship Types Are Rotational Fiction

v0 assigns relationship types by cycling through `['relates-to', 'extends', 'depends-on']` based on index position. Concept 0→1 is always `relates-to`, 1→2 is always `extends`, 2→3 is always `depends-on`. This is a placeholder, not inference.

**Effect:** SemanticLinks carry no real relationship information. The type field is misleading — it looks meaningful but is structurally random.

### 5. Link Strength = Adjacent Concept's Weight

Link strength is set to the weight of the target concept. This is not a relationship confidence score — it's a proxy for "the target concept appears frequently". A link with `strength: 0.3` does not mean a weak relationship; it means the target concept appeared less often than the top concept.

**Effect:** Strength values are not interpretable. They cannot be used for graph traversal filtering or relationship quality comparison.

### 6. Region Scoring by Keyword Substring Match

v0 scores knowledge regions by counting how many extracted concept labels are substrings of (or contain) region keyword strings. "model" matches "mental model" because `"mental model".includes("model")`. This is brittle and noisy.

**Effect:** Region assignment degrades on paraphrase, abstraction, and domain-specific terminology. A document about "schemas" in a cognitive context may score as Data Systems because "schema" is in both region keyword lists.

---

## What "Semantic Linking by Meaning" Must Mean

For v1 to be meaningfully different from v0, the following must hold:

**1. Concept extraction is driven by semantic relevance, not statistical frequency.**  
A concept surfaces because it carries domain-specific meaning, not because it appears often. "Knowledge formation" should rank above "the system" even if both appear the same number of times.

**2. Multi-word concepts are preserved as atomic units.**  
"Semantic link", "knowledge graph", "mental model", "gap detection" must be extractable as single concepts — not decomposed into noise tokens.

**3. Concepts are normalized across morphological variants.**  
"Memory", "memories", and "memorize" should map to the same concept when they refer to the same semantic unit. Deduplication happens before ranking.

**4. Relationship types reflect the actual semantic relationship in the source text.**  
`depends-on` means "A requires B to function". `extends` means "A builds on B". These must be inferred from the context window around the two concepts — not assigned by index position.

**5. Region scoring is based on semantic proximity, not keyword overlap.**  
A concept's region affinity should be computed by comparing its meaning against the region's conceptual center — not by checking if any region keyword is a substring of the concept label.

---

## Required Capabilities for v1

Ordered by dependency — each capability enables the next.

### CAP-1 — Phrase / Keyphrase Detection

Identify multi-word expressions that function as single semantic units. "Mental model" is a concept. "Model" alone is not — or is a different, less precise concept.

**Inputs:** raw artifact content  
**Outputs:** list of candidate keyphrases (single and multi-word)  
**Replaces:** single-token stopword-filtered candidates in v0

---

### CAP-2 — Concept Normalization

Map morphological variants and near-synonyms to canonical forms. "Memorize", "memories", "memory" → `memory`. "Construct", "construction", "constructs" → `construct`.

**Inputs:** candidate keyphrase list  
**Outputs:** deduplicated, lemmatized concept candidates with merged frequency counts  
**Replaces:** raw token list in v0

---

### CAP-3 — Semantic Concept Ranking

Rank concept candidates by semantic relevance to the document, not by raw frequency. A concept that appears once but is highly domain-specific should rank above a generic word that appears ten times.

**Inputs:** normalized concept candidates, artifact content  
**Outputs:** top-N concepts ordered by semantic relevance score  
**Replaces:** frequency ranking in v0

---

### CAP-4 — Relationship Type Inference

Infer the semantic relationship type between two co-occurring concepts from their shared context window in the source text. "A enables B" → `depends-on`. "A is a type of B" → `part-of`. "A builds on B" → `extends`.

**Inputs:** two concepts, source text, shared context window  
**Outputs:** `SemanticRelationshipType`, confidence score  
**Replaces:** rotational assignment in v0

---

### CAP-5 — Semantic Region Scoring

Score a concept's affinity to each knowledge region by comparing concept meaning against the region's semantic centroid — not by keyword substring matching.

**Inputs:** concept embeddings, region centroid embeddings (pre-computed)  
**Outputs:** region scores per concept, best-match region  
**Replaces:** keyword overlap scoring in v0

---

## Possible Approaches

### CAP-1: Phrase Detection

| Approach | Quality | Complexity | Node.js-native |
| -------- | ------- | ---------- | -------------- |
| `compromise.js` noun phrase extraction | Medium | Low | Yes |
| spaCy noun chunks (Python subprocess) | High | Medium | No |
| BERT attention-based (KeyBERT pattern) | High | High | No (requires model) |
| Regex + POS patterns (manual rules) | Low–Medium | Low | Yes |

**Recommended starting point:** `compromise.js` — pure Node.js, no Python, adequate quality for English text. Revisit if precision is insufficient.

---

### CAP-2: Concept Normalization

| Approach | Quality | Complexity | Node.js-native |
| -------- | ------- | ---------- | -------------- |
| `compromise.js` lemmatization | Medium | Low | Yes |
| `natural` library stemmer (Porter/Lancaster) | Low–Medium | Low | Yes |
| spaCy lemmatizer (Python subprocess) | High | Medium | No |
| Dictionary-based synonym mapping (manual) | Low | Very Low | Yes |

**Recommended starting point:** `compromise.js` lemmatization paired with phrase detection (same library). Stemming is a fallback — it conflates too aggressively.

---

### CAP-3: Semantic Concept Ranking

| Approach | Quality | Complexity | Node.js-native |
| -------- | ------- | ---------- | -------------- |
| TF-IDF re-ranking (corpus required) | Medium | Medium | Yes |
| Local embedding model (ONNX/WASM) | High | High | Partial |
| LLM extraction prompt (API call) | Very High | Low (implementation) | Yes (via API) |
| KeyBERT-style cosine re-ranking | High | High | No |

**Tradeoff:** LLM extraction is the highest quality path but introduces API dependency and non-determinism. Local ONNX embedding is the best quality-without-API-calls option but increases package footprint significantly. TF-IDF re-ranking requires a reference corpus to compute IDF weights.

**Recommended path:** LLM extraction with `temperature=0` for reproducibility — but isolate behind an interface so the extraction strategy is swappable. This preserves the ability to move to ONNX later without changing the calling code.

---

### CAP-4: Relationship Type Inference

| Approach | Quality | Complexity | Node.js-native |
| -------- | ------- | ---------- | -------------- |
| Dependency parsing + verb/prep patterns | High | Medium | Partial (`compromise.js`) |
| Template matching ("A enables B", "A is part of B") | Medium | Low | Yes |
| LLM classification of relationship from context | Very High | Low (impl) | Yes (via API) |
| Co-occurrence proximity (position heuristic) | Low | Very Low | Yes |

**Recommended path:** Two-stage: template matching for high-confidence cases (explicit linguistic patterns like "depends on", "is a subset of") + LLM fallback for ambiguous cases.

---

### CAP-5: Semantic Region Scoring

| Approach | Quality | Complexity | Node.js-native |
| -------- | ------- | ---------- | -------------- |
| Pre-computed region centroid embeddings + cosine sim | High | Medium | Partial (needs embeddings) |
| LLM classification: "which region does this concept belong to?" | Very High | Low (impl) | Yes (via API) |
| Expanded keyword lists (improved v0) | Low–Medium | Very Low | Yes |

**Recommended path:** LLM classification — consistent with CAP-3 approach, avoids managing centroid embeddings, highest accuracy for domain-aware assignment.

---

## Risks

### R1 — Non-Determinism

LLM-based extraction and inference are not fully deterministic even at `temperature=0`. The same input may produce different outputs across model versions, API updates, or batch configurations.

**Mitigation:** Pin model version in configuration. Snapshot outputs in test fixtures. Separate deterministic tests (v0 behavior preserved) from probabilistic tests (v1 output evaluated by quality thresholds, not exact match).

---

### R2 — API Dependency

If v1 uses LLM API calls, `analyzeArtifact()` becomes asynchronous and network-dependent. Offline usage, test environments, and latency budgets are all affected.

**Mitigation:** Introduce an `AnalysisStrategy` interface. v0 frequency extractor and v1 LLM extractor are both implementations. Callers can select strategy at construction time. Tests default to v0 strategy.

---

### R3 — Package Footprint Change

Adding `compromise.js`, ONNX runtime, or Python subprocess support changes the dependency profile of `@monolith/core` significantly.

**Mitigation:** Evaluate whether analysis capabilities belong in `@monolith/core` or in a separate `@monolith/webway-v1` package. Core may need to stay lightweight if it is used as a CLI-only tool.

---

### R4 — Type Contract Breakage

If phrase detection changes concept granularity (multi-word labels instead of single tokens), downstream consumers depending on single-word concept labels may break.

**Mitigation:** `WebwayAnalysisResult` shape is unchanged — this is a constraint. Concept `label` type remains `string`. Multi-word labels are valid strings. No interface changes required.

---

### R5 — Phrase Detection Noise

Not every noun phrase is a concept. "The following section", "this document", "each stage" — all are noun phrases but carry no semantic payload.

**Mitigation:** Post-filter noun phrase candidates by: minimum token count for multi-word phrases, exclusion of demonstratives + noun patterns, and optionally score against a generic "non-concept" classifier.

---

## Validation Criteria

v1 is not a success unless the following can be measured and pass:

| Criterion | Method | Threshold |
| --------- | ------ | --------- |
| Concept relevance | Human evaluators rate top-5 concepts per artifact on 1–5 scale | Mean ≥ 4.0 vs v0 mean |
| Phrase preservation | Count multi-word concepts in output vs expected keyphrases | ≥ 60% recall on test set |
| Region assignment accuracy | Compare v1 assignment vs human labels on 30-artifact test set | F1 ≥ 0.75 |
| Relationship type accuracy | Human evaluates sampled links: is the type correct? | ≥ 70% correct |
| Interface stability | v0 test suite passes against v1 output shape | 13/13 tests green |
| Backward compatibility | `WebwayAnalysisResult` type unchanged | Zero type errors |

---

## Non-Goals

The following are explicitly out of scope for v1. Do not implement without a separate ADR:

- **Cross-artifact concept linking.** v1 analyzes one artifact at a time. `analyzeCorpus()` is v2.
- **Dynamic knowledge region inference.** Regions remain predefined in v1. Corpus-inferred regions are v3.
- **Autonomous question generation.** Gap Detection and Question Loops are v3+. (ADR-001, H7)
- **Persistent storage of concepts or links.** All output remains in-memory. Terra module is future.
- **Fine-tuning models on MONOLITH-specific vocabulary.** Use pre-trained models only.
- **Changing the `analyzeArtifact()` function signature.** The public interface is frozen. v1 changes the internals only.
- **Replacing the v0 extractor.** v0 frequency extraction is preserved as a fallback strategy. v1 adds a new strategy; it does not delete the old one.

---

## Suggested Sequencing

```
Step 1 — Phrase Detection (CAP-1) + Normalization (CAP-2)
  Dependencies: none
  Output: improved concept candidates with multi-word support
  Risk: lowest — Node.js-native with compromise.js

Step 2 — Semantic Region Scoring (CAP-5)
  Dependencies: concept candidates from Step 1
  Output: region assignment by meaning, not keyword overlap
  Risk: medium — introduces external dependency (LLM or embeddings)

Step 3 — Semantic Concept Ranking (CAP-3)
  Dependencies: Steps 1 + 2
  Output: top-N by semantic relevance, not frequency
  Risk: medium–high — non-determinism if LLM-based

Step 4 — Relationship Type Inference (CAP-4)
  Dependencies: Step 3 (quality concepts needed before quality relationships)
  Output: relationship types inferred from context
  Risk: high — requires sentence-level parsing or LLM
```

Each step produces a measurable improvement on its own validation criteria. Step 1 and 2 can be shipped independently of Step 3 and 4. Do not block Step 1 on Step 4.
