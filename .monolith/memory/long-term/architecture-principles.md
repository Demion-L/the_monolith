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
3. **No premature persistence** — in-memory structures first. Storage is a future story (ADR-006: Terra).
4. **Module isolation** — each subsystem (`scriptorium`, `graph`, `webway`) is self-contained. Cross-module imports only through `src/index.ts`.
5. **Additive evolution** — existing outputs remain structurally valid when later stories enrich them. No breaking shape changes without a Decision record.
6. **Vertical slice first** — a working end-to-end flow is more valuable than a partially built abstraction.
7. **Explicit-only identity** — ADR-007: aliases registered only from frontmatter `id:` and `title:`; no fuzzy matching; no inferred aliases. Provenance must be traceable.

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
- `ScriptoriumResult.documentTitle` comes only from frontmatter `title:` — never inferred
- `buildGraph()` Pass 2.5: aliases registered first-document-wins; collision logged, not silenced
- No fuzzy matching anywhere in the identity resolution pipeline (ADR-007)
- No LLM or embedding calls in any module currently in scope (Scriptorium, ERG, Webway v0)
- `src/index.ts` is the only cross-module import boundary
