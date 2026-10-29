---
type: memory
id: memory-long-term-architecture-principles
category: long-term
authority: authoritative
related_protocols:
  - memory-governance
---

# Architecture Principles

Stable architectural principles for this project. Read before every implementation task.

---

## Principles

1. **Determinism first** — every capability must be testable before probabilistic layers are added. Frequency counting before embeddings.
2. **Typed contracts** — TypeScript interfaces are the API. Shape matters more than implementation detail.
3. **No premature persistence** — in-memory structures first. Storage is a future story.
4. **Module isolation** — each subsystem (`scriptorium`, `graph`, `webway`) is self-contained. Cross-module imports only through `src/index.ts`.
5. **Additive evolution** — existing outputs remain structurally valid when later stories enrich them. No breaking shape changes without a Decision record.
6. **Vertical slice first** — a working end-to-end flow is more valuable than a partially built abstraction.
7. **Explicit-only identity** — ADR-020 (supersedes ADR-007): identity is a declared `namespace:localId`; references resolve deterministically or stay unresolved; no aliases, no synthetic nodes, no first-wins, no fuzzy matching. Provenance must be traceable.
8. **Knowledge belongs to its responsible system** — a document, ADR or hypothesis lives once, in the repository of the system it describes. Webway owns semantic knowledge; MONOLITH owns the toolkit and the execution and integration of cognitive capabilities (`monolith:ADR-002`). No duplicated canonical documents and no redirect files.

---

## Stack Decisions

| Decision | Choice | Reason |
|---|---|---|
| Language | TypeScript strict | Type safety as first-class invariant; interfaces are the API contract |
| Module system | ESM (`"type": "module"`) | Node.js native ESM; `.js` extensions required on all imports |
| Package manager | pnpm | Symlink-based node_modules (important: pnpm symlinks can block git stash — see execution-history.md) |
| Test framework | Vitest | ESM-native; no transform config needed; fast |
| Build | tsc (`outDir: dist/`) | Plain TS compilation, no bundler; dist/ is committed |
| Node.js | >= 20 | ESM stability; native test runner available as fallback |

---

## Invariants

Things that must never change without an explicit ADR:

- `ScriptoriumResult.documentId` comes only from frontmatter `id:` — never inferred
- `ScriptoriumResult.documentTitle` comes only from frontmatter `title:` — never inferred, and never used as identity
- A graph node is a `KnowledgeObject` with a declared `namespace:localId`; a ref declared twice is an identity conflict, never resolved by order (ADR-020)
- No aliases, no synthesized nodes, no first-wins in the ERG (ADR-020)
- No fuzzy matching anywhere in the identity resolution pipeline (ADR-007 principle, kept by ADR-020)
- No LLM or embedding calls in any module currently in scope (Scriptorium, ERG, Webway v0)
- `src/index.ts` is the only cross-module import boundary
