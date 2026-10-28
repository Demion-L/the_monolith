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
| TD-002 | Alias brittleness: renaming `id:` in any document silently breaks all edges pointing to that alias | 1.3 | **Superseded by ADR-020 (2026-10-28):** aliases no longer exist; a renamed `id:` leaves the reference `MISSING`, reported and never silent. Original entry: accepted per ADR-007 (explicit-only); fix required a stable URI scheme (Terra layer) |
| TD-003 | `dist/` committed to git | 1.1 | Simplifies deployment; becomes real debt once CI/CD or publishing is introduced |
| TD-004 | Webway concept extraction is frequency-based (not semantic) | 1.1 | Intentional v0 deterministic prototype; v1 replaces with embeddings |
| TD-005 | No Engineering Gate runtime (ADR-003 formalized, not implemented) | — | Governance formalized but no runtime enforcement; tests pass because they're in vitest, not the gate |
| TD-006 | `state-keeper.ts` is documented as "deliberately ignorant of what a mission is," but mission lifecycle semantics (ID derivation scanning `tactical.missions`, schema shape) are still coupled to the Tactical Coordinatorium domain at the schema level (`CoordinatoriumState.tactical.missions`, now also `tactical.checkpoints`) — a future Strategic Coordinatorium or a second tactical-style domain would need either a generalized state shape or a second keeper | COORDINATORIUM-001 | Re-assessed during COORDINATORIUM-002 (2026-10-21): adding `tactical.checkpoints` as a sibling top-level section (`Record<id, record>`, scan-derived IDs, a dedicated `validateCheckpoint`) extended the existing pattern by direct analogy — it did not deepen the coupling or require a refactor first. Still open; re-evaluate specifically if a *third*, differently-shaped top-level section (most plausibly Strategic Coordinatorium) is ever added — see ADR-008's COORDINATORIUM-002 addendum |
| TD-007b | CLI drift (remaining half of TD-007): the top-level `monolith` usage text lists `status` and `dry-run` as ordinary commands, but invoking either exits 1 with "not yet implemented (Phase 6)" | COORDINATORIUM-001 (found during finalization smoke test, 2026-10-21; see `LESSON-2026-0006`) | Predates this story and is unrelated to Coordinatorium or to the init-safety fix; left as an open CLI-hygiene item for a future small fix |
| SEC-001 | Project Root Trust Boundary: `monolithRoot` from `monolith.config.json` is joined onto the project directory with no containment check, so `..` segments let it point outside the project root; the check exists only in `brief`'s document discovery (protocols/ADR). Details below. | CONTEXT-001A (found in review, 2026-10-22) | Cross-subsystem contract (`validate`, `mission`, `init`/scaffold, `brief`); changing it unilaterally in one subsystem would desynchronize them. Needs one shared decision — see "SEC-001 detail". **SEC-001A: IMPLEMENTED / MERGED (2026-10-22, branch `fix/sec-001a-root-containment`, ADR-009; on `main` via `4a58dae`)** — shared resolver `src/root`, lexical + realpath containment, fail closed in mission/brief/validate/scaffold API; a corrupted `monolith.config.json` makes `mission *` fail closed (review fix, ADR-009 addendum). **SEC-001B: OPEN** — TOCTOU, filesystem boundary abstraction, `.tmp` files, symlinks inside an existing instance tree. Status of SEC-001 overall: OPEN |
| SEC-002 | `monolith validate` executed `project.definition.mjs` via dynamic `import()` (arbitrary code execution on an untrusted repository) and read root files without bounds (FIFO hang, device/huge reads, symlink escape). **IMPLEMENTED / MERGED (2026-10-22, branch `fix/sec-002-static-validate`, ADR-011; merge `4a58dae`):** validate is static (file-only check, 1 MiB cap), bounded contained reader in `src/root/`. **Decision D-1:** the `PROJECT_DEFINITION` export check is removed (not performable without executing). The instance-tree placeholder scan (`<monolithRoot>/**`) uses the same bounded reader (review fix: a FIFO inside the instance used to hang `validate`, a huge file was read unbounded). **Remaining:** TOCTOU not closed (SEC-001B). Status: FIXED / MERGED; residuals tracked under SEC-001B | SEC-001A review (2026-10-22) | Cross-cutting follow-up to SEC-001A; no `--trusted` mode, no SEC-001B work |
| SEC-001B.1 | Bounded & safe filesystem reads for `state.json` (state-keeper, `brief`), the lock record, `brief`'s `active.md` and Markdown documents. **IMPLEMENTED / MERGED (branch `fix/sec-001b1-safe-reads`, merged into `main` as `d006562`):** all five reads go through the shared bounded reader in `src/root/` (`readBoundedFile` / `readBoundedFileStable`, extracted from the SEC-002 reader): non-blocking open, `fstat` type/size, capped read, descriptor always closed. Limits: lock 256 B, `active.md` 256 KiB, Markdown 1 MiB, `state.json` 16 MiB; over-limit → `FILE_TOO_LARGE`, FIFO/special → `FILE_NOT_REGULAR`. `atomicWriteState` refuses to write a `state.json` over 16 MiB before creating the temp file. Lock inspection is `absent \| valid \| unsafe`; ownership, backoff, stale recovery and the lock format are unchanged. Does NOT close TOCTOU, safe writes or scaffold hardening. | SEC-001B audit (2026-10-22) | SEC-001B stays OPEN: **SEC-001B.2** (safe writes: `state.json.tmp.*`, lock staging files, atomic-write target checks) and **SEC-001B.3** (scaffold / instance-tree hardening, TOCTOU) are not started. |
| SEC-001B.2 | Safe writes: `monolith init` followed a pre-existing symlink (including a dangling one, invisible to `existsSync`) and wrote outside the project; `state.json.tmp.*` was opened without `O_EXCL`; atomic replace silently changed mode, replaced FIFOs/symlinks and detached hardlinks; no fsync; no publication-state reporting. **IMPLEMENTED / MERGED (branch `fix/sec-001b2-safe-writes`, merge `4bc7b9d`; ADR-012):** one publication primitive `src/root/safe-write.ts` (lock release / stale recovery stay path-based unlinks), explicit write scope (`project` / `trusted-directory`, no default), W-SYM (symlinks refused for writes), `0600` for new state/lock files, mode preserved on replace, `nlink > 1` refused, NOT_PUBLISHED / PUBLISHED / UNKNOWN, identity-checked cleanup of own temp files only, POSIX guarantees (Windows best-effort, unverified). Public API break: `mutateState` / `startMission` / `finishMission` take a `StateWriteTarget` (no string overload). | SEC-001B.1 / SEC-001B.2 preflight (2026-10-23) | Does NOT close TOCTOU: concurrent directory/symlink swaps are not defended against (SEC-001B.3). Status: FIXED / MERGED; residuals tracked under SEC-001B.3, FS-CLEAN-001, FS-PLAT-001 |
| SEC-001B.3 | TOCTOU and instance-tree hardening, explicitly NOT covered by SEC-001B.2: dynamic swap of a directory or symlink between a check and the operation; replacing the path-based `ParentRef` with a directory-descriptor (`openat`-style) design; transactionality / rollback of `init`; coordination of two concurrent `init` runs; symlinks inside an existing instance tree; `unlink` of an identity-verified temp file is not conditional (name can change between `lstat` and `unlink`). **DOCUMENTED (2026-10-23, ADR-013, docs only):** the feasibility research reported observing the dynamic TOCTOU on its stand; pure Node.js path-based calls cannot provide TM-C (an API-structure argument, not a PoC result); for stepwise `/proc/self/fd` and Linux `openat2` the research reported no escape in its runs, which is not evidence of safety. Evidence is from one research stand (Linux 7.0, Node.js 24.19.0, tmpfs); the harness is not in this repository and nothing was re-run here or in review; figures are in ADR-013 "Feasibility evidence", unreported parameters stay `not reported`, and they are not an exploitation probability. Threat models fixed: TM-A supported with limitations, TM-B **PARTIALLY supported**, **TM-C NOT supported**. Target read policy DEC-READ-UNIFIED-001 (symlinks and `nlink > 1` forbidden for managed reads; `RESOLVE_NO_SYMLINKS` for any `openat2` implementation) is implemented and merged as SEC-001B.1-R (ADR-014) and amends the ADR-009/011 read clauses; TM-B remains PARTIALLY supported until a recorded re-evaluation (ADR-013 §6). | SEC-001B.2 contract (2026-10-23) | **Native filesystem layer: DEFERRED** (not implemented; no source change). Revisit if MONOLITH runs with untrusted concurrent processes, the product promises TM-C, or a client architecture requires directory-swap resistance; not tied to SphynX. The revisit decision belongs to MONOLITH Core Architecture (the ADR owner, ADR-013 §7; Mission Control is a consumer and cannot decide it); consumers may initiate it via a story or ADR but cannot declare TM-C supported, lift ADR-010's restriction or change the filesystem security policy themselves; each new filesystem consumer states its trust boundary, threat model, capabilities, concurrent-modification assumption and residual risks. ADR-013 is PROPOSED (pending independent review). ADR-010's blocker for a write-enabled UI is **preserved**: ADR-013 does not lift it and does not claim TM-C. Status: OPEN (documented, unimplemented) |
| SEC-001B.1-R | Unified Safe Read Contract: SEC-001B.1 still allowed in-project symlinks for reads, so a symlink such as `roadmap-index.md -> ../../../.env` (found in the UI-001B.1 security review) was read and shown as project context. **IMPLEMENTED / MERGED (branch `fix/sec-001b1r-unified-safe-read`, integration merge `c3a428b`; implementation record ADR-014, policy DEC-READ-UNIFIED-001 of ADR-013):** one strict policy in the existing `readBoundedFile` for all managed sources — explicit absolute boundary (no implicit cwd), no symlink in any component, regular file only, `nlink == 1`, `O_NOFOLLOW`, descriptor identity, bounded, typed codes, fail closed without the platform flags. `readState`/mission/checkpoint readers take an explicit `StateReadTarget`. No Legacy/Strict modes. | UI-001B.1 security review (2026-10-23), ADR-013 (2026-10-23) | Does NOT close dynamic TOCTOU (SEC-001B.3). Residuals: Windows cannot read managed files (FS-PLAT-001); a link()-published lock whose outcome is UNKNOWN stays UNKNOWN; a symlinked `monolithRoot` passes ADR-009 but every read below it is refused. Status: FIXED / MERGED. Threat-model effect: TM-B stays **PARTIALLY SUPPORTED** (ADR-013 §6) — merging does not re-state it; re-evaluation is a separate, recorded decision. TM-C stays UNSUPPORTED. Open residuals: LOCK-RELEASE-001, BRIEF-DOCDIR-001 |
| FS-CLEAN-001 | Safe orphan cleanup: crashes leave unowned `state.json.tmp.*`, `<lock>.creating.*` and `<lock>.recovery` files that nothing removes (a stuck `.recovery` mutex blocks automatic stale-lock recovery until a human deletes it). SEC-001B.2 forbids deleting them by age, PID or name pattern (live writers use the same names) and only adds read-only diagnostics (`WRITE_ARTIFACTS_PRESENT` warning in `brief`, `Warning:` line in `validate`; they list names only and never affect completeness or exit codes). | SEC-001B.2 decision DEC-B2-02 (2026-10-23) | **PROPOSED / BACKLOG — registration only, no decision, no implementation.** A design must define a verifiable owner/liveness criterion and human confirmation first. Status: OPEN The crash-held `.recovery` mutex is tracked as residual risk F-2 in `LOCK-RESIDUAL-001`. |
| FS-PLAT-001 | Platform coverage of write protections: guarantees are POSIX-only; Windows (no `O_NOFOLLOW`, no directory fsync, junction behaviour of `lstat`, `rename` over open files) is best-effort and was not run on a Windows host; macOS/BSD are not verified; network filesystems (NFS/SMB) are outside the guarantees. Also related: lock liveness uses PID checks, which are unreliable across PID namespaces sharing a filesystem. | SEC-001B.2 (2026-10-23) | Needs a Windows/macOS test run and a decision on supported platforms. Status: OPEN |
| LOCK-RELEASE-001 | Observable Lock Release Failure: `releaseIfOwned` (`src/coordinatorium/lock.ts`) wraps `unlinkSync` in an empty `catch` ("already gone — fine"), so a failed release of our own lock (e.g. `EACCES`, `EROFS`, `EIO`) is invisible. After a successful publication of `state.json` the lock file can therefore stay behind, and later commands wait for it until stale recovery (or a human) deals with it. The caller cannot tell "written and lock released" from "written, lock still held"; and if `release()` ever did throw from the `finally` in `mutateState`, a successful write would surface as a failure and `onWarning` would be skipped. Needed: tell `ENOENT` (already gone, fine) from other errors, report the latter as a warning distinct from the write outcome (never as a write failure, never retried), without ever hiding or deleting anything automatically. Release and stale recovery are path-based unlinks outside the safe-write primitive, so the fix should be designed together with SEC-001B.3. | SEC-001B.2 re-review, note N-3 (2026-10-23) | **BACKLOG — registration only, not implemented.** SEC-001B.1-R review L-1 (2026-10-23) adds a second silent path: a lock with a second link (e.g. a staging name whose removal failed after `link()`) is refused by the safe read as `FILE_HARDLINKED`, so `release()` leaves it in place without telling anyone. Behaviour is pinned by `src/coordinatorium/lock-release.test.ts` (fail-closed holds; silence is the open part). Engineering proposal: see `LOCK-RELEASE-001 detail` below. Status: OPEN Hidden release errors are residual risk F-4 in `LOCK-RESIDUAL-001` (accepted for the LOCK-FIX-002 merge only; not fixed). |
| LOCK-RESIDUAL-001 | Lock residual risks left open by LOCK-FIX-002 (merge `2529964`, 2026-10-28): F-2 crash-held recovery mutex, F-3 zombie owner, F-4 release errors, H2 orphaned hardlink, M2 transient hardlink rejection. H1 (identity-based liveness) and M1 (bounded recovery loop) are fixed. Details and per-risk status: `LOCK-RESIDUAL-001 detail` below. | LOCK-FIX-002; ADR-015 (`proposed`), ADR-016 gate G-LOCK | **OPEN — documented, not fixed.** The risks were accepted for the integration of LOCK-FIX-002 only. Acceptance of a merge is not a finding that the behaviour is safe, and it does not pass G-LOCK of ADR-016. Fixes belong to ADR-015 stages 001C/001D after owner decisions Q1–Q4. Status: OPEN |
| BRIEF-DOCDIR-001 | Silent omission of symlinked entries in `brief`'s document directories: `walkMarkdownFilesSorted` (`src/brief/docs.ts`) skips every symlink entry (`entry.isSymbolicLink()` → `continue`) **without a diagnostic**, so the strict read policy of ADR-014 (which would report `FILE_SYMLINK`) is never reached for those entries. Verified 2026-10-23 on the integrated tree: a symlinked `.md` file in `.monolith/protocols/` with `enforcement: mandatory` is absent from the Mandatory Protocols section and `brief` still prints `Completeness: COMPLETE` — a mandatory protocol or an ADR can vanish from the brief with no signal. A symlinked document *directory* is NOT affected: it is reported (`DOC_FILE_UNREADABLE` / `FILE_SYMLINK`, `INCOMPLETE`). Fail-closed holds (nothing outside the project is read); the defect is the missing signal, i.e. an integrity-of-the-brief gap, not a disclosure. Not a TM-C issue. | Independent review of SEC-001B.1-R; characterized during SEC-001B integration (2026-10-23; the reviewer's original wording is not in this repository — scope here is what was verified) | **Registered only; no source change in the integration.** Candidate resolution (needs a decision): report skipped symlink entries as a diagnostic (e.g. `DOC_ENTRY_SYMLINK`, severity error → `INCOMPLETE`) so a skipped document is never silent; amends ADR-014's consequences. Status: OPEN |
| TD-009 | `src/brief/` imports `../scriptorium/frontmatter.js` (runtime) and the `../coordinatorium` barrel directly instead of going through `src/index.ts`, contrary to the literal wording of AGENTS.md Architecture Principle 4; `brief` is also not re-exported from `src/index.ts`. `src/graph/builder.ts` already imports `../scriptorium/types.js` the same way, so the principle is not strictly followed today | CONTEXT-001A | Reusing the existing parser and State Keeper validation avoided duplicating them; whether to relax Principle 4 or add narrow public re-exports is an architectural decision, not made here. Status: OPEN |
| STATE-001 | State Retention & Compaction: `state.json` accumulates checkpoint records (`tactical.checkpoints`) with no retention or compaction, so its size is potentially unbounded. The 16 MiB limit is implemented (SEC-001B.1, `MAX_STATE_BYTES`): it is a protective ceiling, not a growth solution. Once reached, `state.json` reads and writes are refused with `FILE_TOO_LARGE` (a write is rejected before the temp file is created, `state.json` untouched), so `mission` mutations fail closed and no further missions/checkpoints can be recorded until a human intervenes. **Automatic deletion of history is forbidden until an architectural decision is made;** do not implement compaction as part of any SEC story. Details below. | Registered 2026-10-22 (follow-up to SEC-001B.1 planning) | **PROPOSED / BACKLOG — registration only, no decision, no implementation.** Next step is an inventory (AUDIT ONLY); no storage design before it. Related: MEM-001 (separate initiative, see below). Status: OPEN |
| MEM-001 | Memory Lifecycle: long-running development accumulates working context, history, decisions and knowledge; there is no managed lifecycle (retention, archival, consolidation, controlled forgetting) that keeps context current without losing important knowledge or evidence. Details below. | Registered 2026-10-22 | **PROPOSED / BACKLOG — registration only, no decision, no implementation.** Next step is an inventory of existing memory mechanisms (AUDIT ONLY). Related: STATE-001 (may become one technical foundation, not merged automatically). Status: OPEN |
| DURABLE-001 | Durable Execution State (`src/durable/`, ADR-017, ADR-018, ADR-019): domain-neutral event-log layer for long-running agentic tasks. **MERGED to `main`** (merge `828ddf4`, 2026-10-27; FIX-004A–F implementation, tests and documentation in `e9f1ab7`, `3a375c7`, `a5c01c4`). **Security acceptance is NOT recorded:** an independent security review exists as a separate worktree (`review/durable-security-001`) and its outcome is not in the project documents — UNKNOWN. Open acceptance item 23 (`DURABLE-PRUNE-PROTOCOL-DESIGN-004.md`, open list): A2-R (§43) is not proven; whether a filesystem-conformance check becomes a release step is an owner decision — **OPEN**. Status words: `implemented` yes; `merged` yes; `accepted` NO (ADR-017 is still `proposed`; ADR-018/019 are `accepted`). Follow-ups deliberately left open: (a) Coordinatorium is not a client of it and ADR-016's bounded-state design is undecided; (b) no secondary index — `listTasks`/`findResumable`/`planRetention` read every task log (O(tasks × events)); (c) payloads > 256 KiB must be stored outside the log; (d) lease/deadline use process clocks (skew between hosts); (e) POSIX local FS only, Windows/macOS/NFS unverified; (f) no Reasoning Projector, scheduler or transport. | Durable State challenge (2026-10-24); merge status corrected by SELF-AWARENESS-002 against `git log` | Scope of the experiment: a reusable foundation, not a platform. Status: IMPLEMENTED / MERGED / NOT ACCEPTED (security acceptance open; criterion 23 OPEN) |
| STATE-DRIFT-001 | Story-system drift: after CONTEXT-001A was finalized (2026-10-22) about 60 commits landed on `main` (SEC-001A/B, SEC-002, UI-000…UI-002D, Durable State design docs) with no story, capsule, story-index or execution-history record; `active.md`, `HANDOFF.md`, `roadmap-index.md` and the `AGENTS.md` counts went stale, `.monolith/state.json` was never created (no missions were ever registered for MONOLITH's own work), and `monolith brief` reported `Completeness: COMPLETE`, "No active story" with no hint of it. The git-derived list is in `roadmap-index.md` (updated through `main` at `5010d42`); finalization status of that work is UNKNOWN. | SELF-AWARENESS-001 (independent audit, verified against `main` 2026-10-27) | **Mitigated, not solved:** `monolith brief` prints `Freshness` (SELF-AWARENESS-001, merged `fe6661a`) and `monolith brief --reconcile` (SELF-AWARENESS-002, merged by MONOLITH-INTEGRATION-002) explains the verdict as evidence plus suggested human actions; neither edits any document. Not decided: whether to register the unrecorded work as stories, enforce story registration, or accept git as the record. Related: mission use is not runtime-enforced (ADR-008). Status: OPEN |

### SEC-001 detail — Project Root Trust Boundary

**Observed behavior (verified 2026-10-22, `monolith brief`):** with `"monolithRoot": "../secret"` in `monolith.config.json`, `brief` reads `../secret/state.json` and `../secret/memory/working/active.md` and prints the Current Story excerpt of the latter. Document discovery (protocols, ADRs) rejects the same root via `DOC_DIR_OUTSIDE_PROJECT`, so the boundary is enforced for some reads and not others. An absolute `monolithRoot` does not escape (`path.join` nests it under the project dir); only `..` does. Symlinked `monolithRoot`, `state.json` and `active.md` are followed on read.

**Affected subsystems:**
- `src/coordinatorium/cli.ts` — `mission start|finish|checkpoint` derive the `state.json` path (and its lock file) from `monolithRoot`; this is the main *write* path, so the risk there is a state/lock write outside the project, not only a read. Verified 2026-10-22: with `"monolithRoot": "../outside"`, `monolith mission start` created `../outside/state.json`.
- `src/brief/collect.ts` — state.json and active.md reads (documents are already contained).
- `src/validate/index.ts` — existence checks under `monolithRoot`.
- `src/init/scaffold.ts` — scaffold writes under `config.monolithRoot` (the interactive prompt hardcodes `.monolith`, but `ProjectConfig` allows any string).
- Three duplicated `readMonolithRoot()` readers (coordinatorium, validate, brief) — no single choke point exists today.

**Risks:** a hostile or accidentally mis-edited `monolith.config.json` in a repository an AI assistant is pointed at can make MONOLITH read (brief) or write (mission commands, scaffold) files outside the project; brief output is AI-facing, so a read outside the root also feeds that content to the model. Impact is bounded by fixed filename suffixes on reads, but not on the mission-command write path.

**Impact on a future UI:** a UI/API layer would take the project directory as input and run these same code paths on behalf of a user; without one resolved, contained root, any server-side or multi-project deployment turns this into a path-traversal primitive. It must be closed before any such layer exists.

**Architectural decisions needed:**
1. Where the root is resolved once (a single shared `resolveProjectRoot(targetDir)` replacing the three duplicated readers) and what it returns (an absolute, realpath-checked directory).
2. Policy: reject `..`/escaping/symlink-escaping roots outright (fail closed, new error + exit code), versus allow with an explicit opt-in flag; and whether a symlinked `monolithRoot` that stays inside the project is allowed.
3. Whether file reads *within* the root (state.json, active.md) also refuse symlinks that leave it.
4. Migration: existing projects with an out-of-tree root (none known) and ADR-008 / `validate` messaging.

**Acceptance criteria:**
- One shared root resolver used by `brief`, `mission`, `validate` and `init`; the duplicated readers are removed.
- A `monolithRoot` that resolves (string-level and realpath-level) outside the project directory is rejected before any read or write, by every command, with a clear diagnostic and a defined non-zero exit code; no file outside the project is created, modified, locked or read.
- Regression tests per subsystem: `..` root, symlinked root escaping the project, symlinked `state.json`/`active.md` escaping the project, absolute root, and a normal nested root that keeps working.
- `monolith brief` output for a rejected root is INCOMPLETE and never prints content from outside the project.
- ADR-008 (or a new ADR) records the decision; AGENTS.md / README describe the contract.

**Status:** OPEN. Not implemented; do not represent as done. Out of scope for CONTEXT-001A/B.

_Update (2026-10-22): SEC-001A and SEC-002 address parts of this; see their entries above and ADR-009/ADR-011. SEC-001B remains open (SEC-001B.1 safe reads merged, `d006562`; .2 safe writes merged, `4bc7b9d`; .1-R unified safe read merged, `c3a428b`; .3 documented in ADR-013 (proposed), not implemented)._

### STATE-001 detail — State Retention & Compaction

**Status:** PROPOSED / BACKLOG. A registration of future work, not an authorization to implement. No ADR exists and none is `accepted`: no architectural decision has been made.

**Problem:** `state.json` holds an accumulating set of checkpoint records. Without retention or compaction its size can grow without bound. The 16 MiB limit introduced by SEC-001B.1 is implemented (read and write sides, `FILE_TOO_LARGE`, fail closed, no truncation or compaction); it is a defensive cap and does not address long-term growth of the operational state. Once the cap is reached, further writes are refused until a human intervenes.

**Goal:** keep MONOLITH workable over the long term without unbounded growth of the operational state and without losing the engineering history that is needed.

**Research directions:**
1. Separating current state from historical checkpoint records.
2. Retention policy.
3. Deterministic compaction.
4. Archiving history.
5. State recovery.
6. Crash safety.
7. Preserving provenance.
8. Compatibility with the existing state v2 schema.

**Invariants:**
- No automatic loss of confirmed data.
- No LLM dependency for the correctness of compaction.
- No change to history without an explicit contract.
- Recoverability is preserved.
- Existing projects keep working, or a separate migration decision is made.

**First next step:** AUDIT ONLY — inventory the structure of `state.json`, the checkpoint lifecycle and the actual sources of growth. Do not design a new storage scheme until the inventory is complete.

### MEM-001 detail — Memory Lifecycle

**Status:** PROPOSED / BACKLOG. A registration of future work, not an authorization to implement. No ADR exists and none is `accepted`.

**Problem:** over long development MONOLITH accumulates working context, historical records, architectural decisions and engineering knowledge. A mechanism is needed to keep context current without losing important knowledge or evidence.

**Goal:** a managed lifecycle for project memory.

**Preliminary logical model** (logical categories, not an approved physical architecture):
- **Working Memory** — the current working state.
- **Project Knowledge** — durable knowledge, architectural decisions and constraints.
- **Historical Archive** — history of completed actions and outdated context.

**Research directions:**
1. Memory inventory.
2. Classifying data by lifecycle.
3. Retention.
4. Archival.
5. Knowledge consolidation.
6. Controlled forgetting.
7. Provenance and traceability.
8. Recovering archived context.
9. Possible integration with WEBWAY, only if that architecture is separately approved.

**Principles:**
- Archive first; deletion only possibly afterwards.
- Architectural decisions and evidence are protected from automatic deletion.
- Automatic forgetting is allowed only for data explicitly classified as temporary.
- An LLM may propose knowledge consolidation but must not make irreversible deletion decisions on its own.
- Correctness of storage and recovery is provided by deterministic mechanisms.

**First next step:** AUDIT ONLY — inventory the existing memory, context and long-term-knowledge mechanisms of MONOLITH. WEBWAY design is out of scope here.

### Relationship between STATE-001 and MEM-001

- **STATE-001** concerns the size and lifecycle of the *operational state* (`state.json`).
- **MEM-001** concerns the currency, preservation and controlled forgetting of *engineering context*.
- STATE-001 may become one of the technical foundations of MEM-001, but the initiatives are not merged automatically; merging them would need its own explicit decision.
- MONOLITH is a tool for organizing and developing software projects; it is not a runtime component of the applications built with it. Neither initiative changes that.

### LOCK-RESIDUAL-001 detail — residual lock risks accepted for the LOCK-FIX-002 merge

All five stay open. "Accepted" below means only: they did not block the merge of LOCK-FIX-002 (`2529964`, 2026-10-28). It does not mean the behaviour is safe, and none of them is fixed. All are availability risks (a lock that is not released or recovered automatically); none was found to allow two writers into the critical section.

| ID | Description | Impact | Status | Related item | Accepted for LOCK-FIX-002 merge |
|---|---|---|---|---|---|
| F-2 | Crash-held recovery mutex: a process that dies while holding `<lock>.recovery` leaves the mutex behind; the next recoverer sees `mutex-busy` and automatic recovery of a dead owner's lock stays blocked. | Every `mutateState` waits and then fails with `LockTimeoutError` until a human removes the file. No automatic cleanup (nothing is deleted by age, PID or name). | OPEN | FS-CLEAN-001; ADR-015 §5.3, R2, Q3 | Yes |
| F-3 | Zombie owner: a lock whose owner is a zombie (`/proc` state `Z`) is judged `unknown` (reason `zombie`), by design conservative, so it is waited on and not recovered. | The lock is not freed until the zombie is reaped by its parent; contenders time out meanwhile. | OPEN (conservative by design) | ADR-015 §4 L12, R5 | Yes |
| F-4 | Release errors: `releaseIfOwned` swallows unlink and read errors (including a `FILE_HARDLINKED` refusal), so a lock can stay behind after a successful write without any signal. | Later commands wait for the stale lock; the caller cannot tell "written and released" from "written, lock still held". | OPEN | LOCK-RELEASE-001; ADR-015 stage 001D | Yes |
| H2 | Orphaned hardlink: a crash between `link()` and removal of the staging name leaves the lock with `nlink=2`; the safe read refuses it (`FILE_HARDLINKED`) and `acquireLock` throws `LockUnsafeError`. | Permanent wedge: every `mutateState` fails until a human removes the extra link. | OPEN | ADR-015 §5, stage 001C; ADR-016 R-LOCK-3 | Yes |
| M2 | Transient hardlink rejection: the normal `nlink=2` window after `link()` can exceed the safe reader's retry budget, so a reader can raise a false `LockUnsafeError` while the owner is alive. | Spurious failure under contention; a failed staging removal can also make the owner's own `release()` leave its lock in place. | OPEN | ADR-015 §5, stage 001C; ADR-016 R-LOCK-4 | Yes |

Fixed and not part of this entry: H1 (identity-based owner liveness) and M1 (bounded recovery loop), plus the `acquireLock` option validation (LOCK-FIX-002 F-1). Not in scope here: the unconditional `unlink` TOCTOU (ADR-015 §11, ADR-013).

Gate: ADR-016 (`proposed`) may not start implementation until G-LOCK passes, which requires H2 and M2 fixed in `main`. Accepting these risks for the LOCK-FIX-002 merge does not replace that gate.

---

## Accepted Debt

| ID | Description | Accepted in | Decision |
|---|---|---|---|
| TD-003 | `dist/` committed | Story 1.1 | Pragmatic for this stage; revisit when publishing to npm or setting up CI |
| TD-004 | Frequency-based Webway | Story 1.1 | Explicit design choice; ADR will accompany v1 upgrade |

---

## Resolved Debt

| ID | Description | Resolved in | Resolution |
|---|---|---|---|
| TD-007a | Half of former TD-007: `monolith init`'s positional directory argument was silently ignored (`runInit({ targetDir: process.cwd(), ... })` always ran regardless of any trailing arg), which let `--yes` scaffold-overwrite ~20 tracked governance/memory files during the LESSON-2026-0006 near-miss | fix/init-safety, 2026-10-21 | `monolith init` now rejects any positional argument or unknown flag with a non-zero exit (`src/cli/init-args.ts`), and separately runs a preflight conflict check before any write — refusing to run (also non-zero exit, `InitConflictError`) if any target file already exists, `--yes` included (`src/init/scaffold.ts#planScaffoldConflicts`, `src/init/index.ts`). The CLI contract itself (cwd-only, no target-dir support) was intentionally kept, not changed — see `LESSON-2026-0006` |
| TD-008 | `createEmptyDirs()` (10 `.gitkeep` placeholder paths) wrote unconditionally via `writeFileSync(path, '')` and was absent from `planScaffoldConflicts()`'s preflight — a pre-existing, possibly non-empty `.gitkeep` could be silently truncated on init/re-init, the same class of bug TD-007a closed for every other tracked file | COORDINATORIUM-002, 2026-10-21 (found during this finalization's mandatory Init Safety review) | The 10 paths are now a single `GITKEEP_DIRS` source of truth consumed by both `planScaffoldConflicts()` (flags an existing `.gitkeep` as a conflict, same `InitConflictError` contract) and `createEmptyDirs()` (also skips the write if the file already exists). See `LESSON-2026-0007` |

### LOCK-RELEASE-001 detail — engineering proposal (from SEC-001B.1-R, L-1)

**Verified behaviour of `releaseIfOwned`** (characterized, not changed; `lock-release.test.ts`):
ownership is confirmed by a safe read of the record against this process's own `pid:nonce`, then the
path is unlinked. Second link (`FILE_HARDLINKED`, also the leftover of a failed staging removal after
`link()`), another owner's record, a symlink, an empty/malformed record and a failed `unlink`
(`EACCES`) all leave the lock untouched — fail-closed holds — and all are invisible to the caller,
because `release` is `() => void` and the `unlink` error is swallowed. Consequence: a held lock can
stay behind after a published write; later commands wait on it, and once its owner is dead stale
recovery refuses a hardlinked lock (`LockUnsafeError`) until a human intervenes.

**Why it was not fixed in the corrective pass:** the fix changes the public `acquireLock` release
contract and the `mutateState` critical section; it must not weaken fail-closed or add a path-based
recovery.

**Proposal (needs a decision):**
1. `acquireLock` returns `release(): ReleaseOutcome` instead of `void`, with
   `'released' | 'already-absent' | 'not-owner' | 'refused' | 'failed'` and a typed reason
   (`FILE_HARDLINKED`, `FILE_CHANGED`, `EACCES`, …). Never throws.
2. `mutateState` maps any outcome other than `released`/`already-absent` to a `WriteWarning`
   (`LOCK_RELEASE_FAILED`, with the lock path and the reason) delivered through the existing
   `onWarning` after the lock section — never a write failure, never retried, nothing deleted.
3. The CLI prints the warning and names the leftover lock/staging files for manual inspection.
4. A failed staging removal after `link()` is reported by `createAndPublish` as a warning at
   acquisition time instead of being discovered at release.
5. Design together with SEC-001B.3 (descriptor-based unlink) and FS-CLEAN-001; amend ADR-012.
