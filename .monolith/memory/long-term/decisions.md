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

---

### ADR-013 — Filesystem Threat Model and Dynamic TOCTOU (SEC-001B.3)

**Date:** 2026-10-23
**Status:** Proposed (documentation only; no source or test change). Not accepted until an independent architectural review; an earlier revision said `accepted` before any independent review.
**Full record:** `docs/adr/ADR-013-toctou-threat-model-and-fs-boundary.md`

**Decision:** Three threat models. TM-A (trusted local project) is supported with limitations; TM-B (static adversarial project, nothing mutates the tree during a command) is **PARTIALLY supported** (the internal-symlink read gap is closed for managed files by the merged SEC-001B.1-R, but TM-B is not re-stated as supported by the merge) and is re-evaluated only by a separate recorded re-evaluation (SEC-001B.1-R is merged, which does not by itself change it); **TM-C (concurrent adversarial mutation) is NOT supported**, and no document, comment or review may claim it. Dynamic TOCTOU, directory-swap, the limits of `O_NOFOLLOW` (final component only), path-based lock release / stale recovery (LOCK-RELEASE-001), NFS/SMB and the same-UID adversary are recorded as outside the guarantees. **DEC-READ-UNIFIED-001** (policy of SEC-001B.1-R; **implemented and merged**, ADR-014; independent review APPROVED WITH NOTES, corrective pass `b6d0eed`): one strict read contract for managed files — symlinks and `nlink > 1` forbidden, explicit project root, fail-closed, no Legacy/Strict modes, no permissive fallback (a future `openat2` implementation must use `RESOLVE_NO_SYMLINKS`); it amends the read clauses of ADR-009/011. Future direction: descriptor-relative I/O (Linux `openat2`; stepwise `/proc/self/fd` as the researched alternative; native addon as the delivery vehicle). **Native filesystem layer: DEFERRED**; revisit if MONOLITH runs with untrusted concurrent processes, the product promises TM-C, or a client architecture requires directory-swap resistance. Not tied to SphynX. **Governance:** the decision to revisit the native layer belongs to MONOLITH Core Architecture — the repository maintainer(s) holding ADR acceptance authority (ADR-013 §7); Mission Control is a consumer, not a decision body; a consumer may initiate a review through a story or ADR but may not declare TM-C supported, lift the ADR-010 restriction or change the filesystem security policy on its own; each new consumer of the filesystem API states its trust boundary, threat model, read/write capabilities, concurrent-modification assumption and residual risks, and a write-enabled UI needs its own architectural decision (ADR-013 does not say whether it requires TM-C). **Evidence (2026-10-23):** one research stand (Linux 7.0, Node.js 24.19.0, tmpfs), not re-run in this repository; as reported by the research (harness not in the repository, nothing reproduced here or in review): a directory-swap read row 17,347/300,000 (mechanism `not reported`), a pure Node.js row 64,181/200,000 (scenario and operation `not reported`), a path-based write row 1,655 (no denominator), stepwise `/proc/self/fd` 0/200,000, `openat2` 0/200,000, descriptor-relative write 0/50,000 (primitive `not reported`) — not an exploitation probability, zero is not proof of safety, rows are not comparable, and unreported load conditions are not assumed equal. The evidence table marks every parameter the research summary does not state as `not reported`. **TM-C / same-UID (§7):** TM-C is defined by capability, not UID; sub-cases other-principal and same-UID are both unsupported; tampering with MONOLITH's own files by the same user is not a TM-C case and is outside every filesystem guarantee. **Residual-risk acceptance (§7):** valid only as a record with risk, consumer/trust boundary, rationale, acceptor (the decision owner), date/reopen trigger and tech-debt/decisions entries; it never changes a TM status. **Numbering:** ADR-013 is this decision; ADR-014 is the Unified Safe Read Contract (merged). **ADR-010:** ADR-013 does not lift ADR-010's blocker for a write-enabled UI and does not claim TM-C; the blocker stays until a separate architectural decision states the threat model a write-enabled UI requires. Classifying ADR-010's same-UID residual risk as TM-C is ADR-013's interpretation, not ADR-010's statement.

---

### ADR-014 — Unified Safe Read Contract (SEC-001B.1-R)

**Date:** 2026-10-23
**Status:** Accepted
**Full record:** `docs/adr/ADR-014-unified-safe-read.md`

**Decision:** One strict read policy for every MONOLITH-managed file, in the one existing reader (`readBoundedFile`, `src/root/`): explicit absolute boundary, no symlink in any component below it (inside the project or not), regular file only, `nlink == 1`, `O_NOFOLLOW|O_NONBLOCK`, descriptor identity, bounded, typed codes, fail closed without the platform flags; no Legacy/Strict modes. `readState` and the mission/checkpoint readers take an explicit `StateReadTarget`. Amends the read clauses of ADR-009 and ADR-011; realizes DEC-READ-UNIFIED-001 of ADR-013 (the two ADRs reference each other). **Basis of acceptance (recorded in the ADR):** implemented and merged code with passing tests, an independent review with verdict APPROVED WITH NOTES (M-1, L-2, B-1 fixed in `b6d0eed`; L-1 registered as LOCK-RELEASE-001), and integration authorization by the project owner; the review report is not in the repository. **Limits:** it is an implementation record; it does not re-state TM-B as supported and does not touch TM-C (unsupported). **Open residuals:** LOCK-RELEASE-001, BRIEF-DOCDIR-001 (symlinked entries in `brief`'s document directories are skipped without a diagnostic). Does not close dynamic TOCTOU (SEC-001B.3).
