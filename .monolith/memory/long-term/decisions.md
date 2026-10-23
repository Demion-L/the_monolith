---
type: memory
id: memory-long-term-decisions
category: long-term
authority: authoritative
related_protocols:
  - memory-governance
---

# Architectural Decisions

Accumulated architectural decisions for this project.

Updated by the finalize-story skill when a story introduces a significant design decision.

---

## Decision Template

```
### DEC-YYYY-XXXX — Decision Title

**Date:** YYYY-MM-DD
**Story:** STORY X.Y — Story Name
**Status:** Active | Superseded | Deprecated

**Context:** Why this decision was needed.
**Decision:** What was decided.
**Consequences:** What changes as a result.
```

---

## Decisions

### ADR-001 — Introduce Cognitive Loop Architecture

**Date:** 2026-06-24  
**Status:** Accepted  
**Full record:** `.monolith/adr/ADR-001-cognitive-loop-architecture.md`

**Decision:** Introduce Cognitive Loop Architecture as the canonical cognitive model for WEBWAY. Observe → Understand → Detect Gaps → Generate Questions → Learn → Update Mental Models → Observe. Cognitive Processes (KR-7) established as a first-class knowledge region. Existing v0 linear pipeline subsumed as the Observe/Understand phase of the loop.

---

### ADR-002 — Introduce Cognitive Core Foundation

**Date:** 2026-06-26  
**Status:** Accepted  
**Full record:** `.monolith/adr/ADR-002-cognitive-core-foundation.md`

**Decision:** Introduce Cognitive Core as the named conceptual layer that drives the Cognitive Loop. The Core holds the central question "What remains unknown?" and applies H8 (Predictive Power) as its epistemic criterion for gap prioritization. No runtime implementation; conceptual layer only. Closes the loop between WEBWAY's linear output and Knowledge Lifecycle Stage 1 re-entry.

---

### ADR-003 — Introduce Engineering Gate Foundation

**Date:** 2026-06-26
**Status:** Accepted
**Full record:** `.monolith/adr/ADR-003-engineering-gate-foundation.md`

**Decision:** Introduce Engineering Gate as the task-preparation layer of MONOLITH. Transforms ambiguous tasks into Implementation Packages (scope, source of truth, assumptions, unknowns, success criteria, constraints, implementation plan) before passing to executor agents. Does not write code. Separate from Cognitive Core: the Core generates learning pressure; the Gate prepares execution readiness. Pattern formalized from recurring use across myAPT, Second Brain, AgentCollect, Reasoning Projector, and MONOLITH.

---

### ADR-007 — Explicit-Only Identity Resolution in the Explicit Relationship Graph

**Date:** 2026-06-28
**Status:** Accepted
**Full record:** `docs/adr/ADR-007-explicit-identity-resolution.md`

**Decision:** Aliases in the Explicit Relationship Graph are registered only from explicit frontmatter metadata (`id:` → `documentId`, `title:` → `documentTitle`). No fuzzy matching, no embeddings, no probabilistic inference. First-document-wins on alias collision. Canonical label remains the H1 heading text.

---

### ADR-008 — Coordinatorium: Tactical Mission Lifecycle (First Vertical Slice)

**Date:** 2026-10-21
**Status:** Accepted
**Full record:** `docs/adr/ADR-008-coordinatorium-tactical-mission-lifecycle.md`

**Decision:** Introduce a deterministic, file-based State Keeper at `.monolith/state.json` and a `monolith mission start|list|show|finish` CLI for registering and closing out development missions. Read-modify-write mutations are serialized by a cross-process file lock (atomic `open(path, 'wx')`, with stale-lock recovery by PID liveness) and persisted via write-temp-then-rename, with a monotonically incrementing `revision`. Strategic Coordinatorium (product/subsystem state) is schema-reserved only — no mutations in this slice. Mission registration is not runtime-enforced: an AI session can still edit code without ever calling `mission start`.

---

### ADR-012 — Safe Writes and Explicit Write Scope (SEC-001B.2)

**Date:** 2026-10-23
**Status:** Accepted
**Full record:** `docs/adr/ADR-012-safe-writes.md`

**Decision:** Every publication (create/replace) of project files goes through one primitive (`src/root/safe-write.ts`; lock release and stale-lock recovery are separate path-based unlinks) against an explicit write boundary: `project` scope (CLI, `init`) or `trusted-directory` scope (the caller asserts the directory and its ancestors are trusted); there is no default and no string overload. Symlinks below the boundary are refused for writes, including in-project ones (W-SYM). New `state.json` and lock files are `0600`, an existing `state.json` keeps its mode, a target with `nlink > 1` is refused, no orphan file is ever deleted automatically (only a temp file this call created, with verified `dev/ino`), publication is reported as NOT_PUBLISHED / PUBLISHED / UNKNOWN, decided from file identity and never from an error code (UNKNOWN is never retried or downgraded), and errors after publication are warnings. Guarantees are POSIX-only; Windows is best-effort and unverified. No defence against concurrent directory swapping is claimed (SEC-001B.3).

**DEC-B2-01..05:** permissions · orphan files · scaffold · hardlinks · platform, as recorded in the ADR.
