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

---

## Accepted Debt

| ID | Description | Accepted in | Decision |
|---|---|---|---|
| TD-003 | `dist/` committed | Story 1.1 | Pragmatic for this stage; revisit when publishing to npm or setting up CI |
| TD-004 | Frequency-based Webway | Story 1.1 | Explicit design choice; ADR will accompany v1 upgrade |
