---
type: adr
id: ADR-005
title: Lexicon Mechanicus
status: accepted
date: 2026-06-28
research:
  - R-0001
  - R-0003
related_adrs:
  - ADR-004
---

# ADR-005 — Lexicon Mechanicus

---

## Context

As MONOLITH's architecture expanded through Phase 1 (Scriptorium, Explicit Relationship Graph) and the parallel research program (R-0001, R-0002, R-0003), a terminology proliferation problem emerged.

Multiple overlapping terms were in use for related concepts:
- "memory" was used to mean both the file-based artifact store and the abstract cognitive concept
- "working memory" referred both to `memory/working/` (the directory) and to the cognitive science concept (small, fast-access active context)
- "knowledge" and "memory" were used interchangeably in some documents
- "region", "shard", "domain", and "area" all described the same concept (a scoped partition of the memory corpus)
- "protocol" referred both to MONOLITH's behavioral enforcement files and to informal behavioral contracts

Terminology ambiguity creates documentation entropy: two documents can appear to contradict each other because they use different terms for the same concept. It creates onboarding friction for new collaborators. And it creates precision failures in AI assistant behavior, because the AI must interpret ambiguous terms under uncertainty.

R-0003 (Cognitive Architecture Notes) confirmed that formal cognitive architectures (ACT-R, SOAR) establish precise vocabularies as a prerequisite to building reliable cognitive systems. MONOLITH requires the same.

---

## Decision

**The Lexicon Mechanicus is established as the canonical terminology source for all MONOLITH documentation.**

All documentation within the MONOLITH project — research documents, ADRs, architecture documents, vision documents, operational templates, and protocol files — must use the terms defined in the Lexicon Mechanicus.

When a term is not in the Lexicon Mechanicus, it must be added there before it is used in any other document.

---

## Rationale

1. **Single source of terminology truth** — Every architectural principle, pattern, and concept has exactly one canonical name. Synonyms are not permitted in formal documentation.

2. **AI assistant disambiguation** — When an AI assistant reads MONOLITH documents, it encounters terms. If those terms have precise, declared meanings, the assistant can apply them correctly. If terms are ambiguous or inconsistently used, the assistant must infer meaning from context, introducing error.

3. **Documentation auditability** — With a formal vocabulary, it becomes possible to audit documentation for terminology violations. A document that uses an unlisted synonym can be flagged automatically.

4. **Research → Architecture traceability** — When research documents introduce new concepts (e.g., "Essential Variables" from R-0001, "Knowledge Regions" from R-0002), those concepts enter the Lexicon Mechanicus before they appear in architecture documents. This enforces a clear research-to-architecture pipeline.

5. **Cognitive architecture precedent** — ACT-R and SOAR both define precise vocabularies. MONOLITH's approach follows this established practice (R-0003).

---

## Alternatives Considered

### Informal vocabulary (status quo)

**Rejected.** The status quo has already produced terminology ambiguity across documents. The problem will worsen as the documentation corpus grows.

### Terminology per document section

Each document defines its own terms in a local glossary.

**Rejected.** Local glossaries create divergence: two documents can define the same term differently. The same failure mode as the status quo, but more formalized.

### Centralized wiki

A wiki page (external to the repository) as the canonical vocabulary source.

**Rejected.** The vocabulary must be version-controlled alongside the codebase and documentation. An external wiki creates a synchronization problem.

---

## Consequences

**Becomes easier:**
- Documentation review (check all terms against the Lexicon)
- AI assistant onboarding (single vocabulary reference)
- Research-to-architecture traceability (new terms declared before use)
- Terminology-aware documentation search and audit

**Becomes harder:**
- Initial term selection (requires deliberate vocabulary design decisions)
- Term additions (must go through Lexicon Mechanicus before appearing in other documents)

**Immediate actions required:**
1. Establish the Lexicon Mechanicus as a document in `docs/architecture/` or a dedicated top-level file.
2. Audit existing template documents for terminology inconsistencies.
3. Update the boot sequence to include Lexicon Mechanicus as a reference during architecture review tasks.

---

## Current State

The Lexicon Mechanicus is established as an architectural decision (this ADR). The canonical vocabulary document is defined as the authoritative source of all MONOLITH terminology. The specific vocabulary content is built incrementally as terms are used and formalized.

The existing `templates/default-instance/monolith/learning/taxonomy.md` contains the taxonomy of error categories and serves as a precursor to the full Lexicon Mechanicus.

---

## References

- Research: `docs/research/R-0001-iai-personal-memory-engine.md` — pattern separation motivation
- Research: `docs/research/R-0003-cognitive-architecture-notes.md` — cognitive architecture vocabulary precedent
- Architecture: `docs/architecture/cognitive-infrastructure.md` — uses Lexicon Mechanicus terminology
- Template: `templates/default-instance/monolith/learning/taxonomy.md` — error taxonomy (precursor)
