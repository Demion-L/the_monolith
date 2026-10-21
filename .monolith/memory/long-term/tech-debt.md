---
type: memory
id: memory-long-term-tech-debt
category: long-term
authority: authoritative
---

# Technical Debt Registry

Tracks intentional technical debt to prevent accidental "fixing" of accepted trade-offs.

---

## Open Debt

| ID | Description | Story | Rationale for deferral |
|---|---|---|---|
| TD-001 | Sparse graph: 32 edges / 481 nodes (6.6%) | 1.3 | Corpus has few explicit `[[links]]`; structural edges require richer content |
| TD-002 | Alias brittleness: renaming `id:` in any document silently breaks all edges pointing to that alias | 1.3 | Accepted per ADR-007 (explicit-only); fix requires stable URI scheme (Terra layer) |
| TD-003 | `dist/` committed to git | 1.1 | Simplifies deployment; becomes real debt once CI/CD or publishing is introduced |
| TD-004 | Webway concept extraction is frequency-based (not semantic) | 1.1 | Intentional v0 deterministic prototype; v1 replaces with embeddings |
| TD-005 | No Engineering Gate runtime (ADR-003 formalized, not implemented) | — | Governance formalized but no runtime enforcement; tests pass because they're in vitest, not the gate |
| TD-006 | `state-keeper.ts` is documented as "deliberately ignorant of what a mission is," but mission lifecycle semantics (ID derivation scanning `tactical.missions`, schema shape) are still coupled to the Tactical Coordinatorium domain at the schema level (`CoordinatoriumState.tactical.missions`) — a future Strategic Coordinatorium or a second tactical-style domain would need either a generalized state shape or a second keeper | COORDINATORIUM-001 | Acceptable for a first vertical slice with exactly one domain; assess before adding Mission Checkpoints or Strategic Coordinatorium whether this blocks a clean addition or can be deferred further — see open question in the COORDINATORIUM-002 proposal |
| TD-007 | CLI drift: `monolith init`'s positional directory argument is silently ignored (the handler always calls `runInit({ targetDir: process.cwd(), ... })`); separately, the top-level `monolith` usage text lists `status` and `dry-run` as ordinary commands, but invoking either exits 1 with "not yet implemented (Phase 6)" | COORDINATORIUM-001 (found during finalization smoke test, 2026-10-21; see `LESSON-2026-0006`) | Both predate this story and are unrelated to Coordinatorium; not fixed here per explicit out-of-scope instruction. Left as an open CLI-hygiene item for a future small fix |

---

## Accepted Debt

| ID | Description | Accepted in | Decision |
|---|---|---|---|
| TD-003 | `dist/` committed | Story 1.1 | Pragmatic for this stage; revisit when publishing to npm or setting up CI |
| TD-004 | Frequency-based Webway | Story 1.1 | Explicit design choice; ADR will accompany v1 upgrade |
