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
| TD-006 | `state-keeper.ts` is documented as "deliberately ignorant of what a mission is," but mission lifecycle semantics (ID derivation scanning `tactical.missions`, schema shape) are still coupled to the Tactical Coordinatorium domain at the schema level (`CoordinatoriumState.tactical.missions`, now also `tactical.checkpoints`) — a future Strategic Coordinatorium or a second tactical-style domain would need either a generalized state shape or a second keeper | COORDINATORIUM-001 | Re-assessed during COORDINATORIUM-002 (2026-10-21): adding `tactical.checkpoints` as a sibling top-level section (`Record<id, record>`, scan-derived IDs, a dedicated `validateCheckpoint`) extended the existing pattern by direct analogy — it did not deepen the coupling or require a refactor first. Still open; re-evaluate specifically if a *third*, differently-shaped top-level section (most plausibly Strategic Coordinatorium) is ever added — see ADR-008's COORDINATORIUM-002 addendum |
| TD-007b | CLI drift (remaining half of TD-007): the top-level `monolith` usage text lists `status` and `dry-run` as ordinary commands, but invoking either exits 1 with "not yet implemented (Phase 6)" | COORDINATORIUM-001 (found during finalization smoke test, 2026-10-21; see `LESSON-2026-0006`) | Predates this story and is unrelated to Coordinatorium or to the init-safety fix; left as an open CLI-hygiene item for a future small fix |
| SEC-001 | Project Root Trust Boundary: `monolithRoot` from `monolith.config.json` is joined onto the project directory with no containment check, so `..` segments let it point outside the project root; the check exists only in `brief`'s document discovery (protocols/ADR). Details below. | CONTEXT-001A (found in review, 2026-10-22) | Cross-subsystem contract (`validate`, `mission`, `init`/scaffold, `brief`); changing it unilaterally in one subsystem would desynchronize them. Needs one shared decision — see "SEC-001 detail". **SEC-001A: IMPLEMENTED (2026-10-22, branch `fix/sec-001a-root-containment`, ADR-009, not merged)** — shared resolver `src/root`, lexical + realpath containment, fail closed in mission/brief/validate/scaffold API; a corrupted `monolith.config.json` makes `mission *` fail closed (review fix, ADR-009 addendum). **SEC-001B: OPEN** — TOCTOU, filesystem boundary abstraction, `.tmp` files, symlinks inside an existing instance tree. Status of SEC-001 overall: OPEN |
| SEC-002 | `monolith validate` executed `project.definition.mjs` via dynamic `import()` (arbitrary code execution on an untrusted repository) and read root files without bounds (FIFO hang, device/huge reads, symlink escape). **IMPLEMENTED (2026-10-22, branch `fix/sec-002-static-validate`, ADR-011, not merged):** validate is static (file-only check, 1 MiB cap), bounded contained reader in `src/root/`. **Decision D-1:** the `PROJECT_DEFINITION` export check is removed (not performable without executing). The instance-tree placeholder scan (`<monolithRoot>/**`) uses the same bounded reader (review fix: a FIFO inside the instance used to hang `validate`, a huge file was read unbounded). **Remaining:** TOCTOU not closed (SEC-001B). Status: FIXED on branch; residuals tracked under SEC-001B | SEC-001A review (2026-10-22) | Cross-cutting follow-up to SEC-001A; no `--trusted` mode, no SEC-001B work |
| SEC-001B.1 | Bounded & safe filesystem reads for `state.json` (state-keeper, `brief`), the lock record, `brief`'s `active.md` and Markdown documents. **IMPLEMENTED / MERGED (branch `fix/sec-001b1-safe-reads`, merged into `main` as `d006562`):** all five reads go through the shared bounded reader in `src/root/` (`readBoundedFile` / `readBoundedFileStable`, extracted from the SEC-002 reader): non-blocking open, `fstat` type/size, capped read, descriptor always closed. Limits: lock 256 B, `active.md` 256 KiB, Markdown 1 MiB, `state.json` 16 MiB; over-limit → `FILE_TOO_LARGE`, FIFO/special → `FILE_NOT_REGULAR`. `atomicWriteState` refuses to write a `state.json` over 16 MiB before creating the temp file. Lock inspection is `absent \| valid \| unsafe`; ownership, backoff, stale recovery and the lock format are unchanged. Does NOT close TOCTOU, safe writes or scaffold hardening. | SEC-001B audit (2026-10-22) | SEC-001B stays OPEN: **SEC-001B.2** (safe writes: `state.json.tmp.*`, lock staging files, atomic-write target checks) and **SEC-001B.3** (scaffold / instance-tree hardening, TOCTOU) are not started. |
| SEC-001B.2 | Safe writes: `monolith init` followed a pre-existing symlink (including a dangling one, invisible to `existsSync`) and wrote outside the project; `state.json.tmp.*` was opened without `O_EXCL`; atomic replace silently changed mode, replaced FIFOs/symlinks and detached hardlinks; no fsync; no publication-state reporting. **IMPLEMENTED on branch `fix/sec-001b2-safe-writes` (ADR-012), NOT merged:** one publication primitive `src/root/safe-write.ts` (lock release / stale recovery stay path-based unlinks), explicit write scope (`project` / `trusted-directory`, no default), W-SYM (symlinks refused for writes), `0600` for new state/lock files, mode preserved on replace, `nlink > 1` refused, NOT_PUBLISHED / PUBLISHED / UNKNOWN, identity-checked cleanup of own temp files only, POSIX guarantees (Windows best-effort, unverified). Public API break: `mutateState` / `startMission` / `finishMission` take a `StateWriteTarget` (no string overload). | SEC-001B.1 / SEC-001B.2 preflight (2026-10-23) | Does NOT close TOCTOU: concurrent directory/symlink swaps are not defended against (SEC-001B.3). Status: FIXED on branch; residuals tracked under SEC-001B.3, FS-CLEAN-001, FS-PLAT-001 |
| SEC-001B.3 | TOCTOU and instance-tree hardening, explicitly NOT covered by SEC-001B.2: dynamic swap of a directory or symlink between a check and the operation; replacing the path-based `ParentRef` with a directory-descriptor (`openat`-style) design; transactionality / rollback of `init`; coordination of two concurrent `init` runs; symlinks inside an existing instance tree; `unlink` of an identity-verified temp file is not conditional (name can change between `lstat` and `unlink`). **DOCUMENTED (2026-10-23, ADR-013, docs only):** the feasibility research reported observing the dynamic TOCTOU on its stand; pure Node.js path-based calls cannot provide TM-C (an API-structure argument, not a PoC result); for stepwise `/proc/self/fd` and Linux `openat2` the research reported no escape in its runs, which is not evidence of safety. Evidence is from one research stand (Linux 7.0, Node.js 24.19.0, tmpfs); the harness is not in this repository and nothing was re-run here or in review; figures are in ADR-013 "Feasibility evidence", unreported parameters stay `not reported`, and they are not an exploitation probability. Threat models fixed: TM-A supported with limitations, TM-B **PARTIALLY supported**, **TM-C NOT supported**. Target read policy DEC-READ-UNIFIED-001 (symlinks and `nlink > 1` forbidden for managed reads; `RESOLVE_NO_SYMLINKS` for any `openat2` implementation) differs from the current ADR-009 read policy and is tracked as SEC-001B.1-R. TM-B is only PARTIALLY supported until then. | SEC-001B.2 contract (2026-10-23) | **Native filesystem layer: DEFERRED** (not implemented; no source change). Revisit if MONOLITH runs with untrusted concurrent processes, the product promises TM-C, or a client architecture requires directory-swap resistance; not tied to SphynX. The revisit decision belongs to MONOLITH Core Architecture / Mission Control; consumers may initiate it via a story or ADR but cannot declare TM-C supported, lift ADR-010's restriction or change the filesystem security policy themselves; each new filesystem consumer states its trust boundary, threat model, capabilities, concurrent-modification assumption and residual risks. ADR-013 is PROPOSED (pending independent review). ADR-010's blocker for a write-enabled UI is **preserved**: ADR-013 does not lift it and does not claim TM-C. Status: OPEN (documented, unimplemented) |
| SEC-001B.1-R | Single Strict Managed Read Contract (DEC-READ-UNIFIED-001, ADR-013): managed reads (`state.json`, lock record, `active.md`, `brief` Markdown documents, `validate` root files) currently follow in-project symlinks (ADR-009/011) and accept `nlink > 1`, so in a hostile repository a managed path can expose another private file inside the project root. Target: symlinks and `nlink > 1` forbidden, explicit project root, fail-closed, no Legacy/Strict modes, no permissive fallback; amends the ADR-009/011 read clauses. | ADR-013 (2026-10-23) | **IMPLEMENTED on branch `fix/sec-001b1r-unified-safe-read`; NOT merged.** First independent review: APPROVED WITH NOTES; corrective pass committed (`b6d0eed`); independent re-review PENDING; merge PENDING. Its ADR is **ADR-014** (ADR-013 is the TOCTOU decision, see ADR-013 §6). TM-B stays PARTIALLY supported until the re-review passes and the branch is merged; it is then re-evaluated, not declared fully supported in advance. Does not change TM-C (UNSUPPORTED). Status: OPEN |
| FS-CLEAN-001 | Safe orphan cleanup: crashes leave unowned `state.json.tmp.*`, `<lock>.creating.*` and `<lock>.recovery` files that nothing removes (a stuck `.recovery` mutex blocks automatic stale-lock recovery until a human deletes it). SEC-001B.2 forbids deleting them by age, PID or name pattern (live writers use the same names) and only adds read-only diagnostics (`WRITE_ARTIFACTS_PRESENT` warning in `brief`, `Warning:` line in `validate`; they list names only and never affect completeness or exit codes). | SEC-001B.2 decision DEC-B2-02 (2026-10-23) | **PROPOSED / BACKLOG — registration only, no decision, no implementation.** A design must define a verifiable owner/liveness criterion and human confirmation first. Status: OPEN |
| FS-PLAT-001 | Platform coverage of write protections: guarantees are POSIX-only; Windows (no `O_NOFOLLOW`, no directory fsync, junction behaviour of `lstat`, `rename` over open files) is best-effort and was not run on a Windows host; macOS/BSD are not verified; network filesystems (NFS/SMB) are outside the guarantees. Also related: lock liveness uses PID checks, which are unreliable across PID namespaces sharing a filesystem. | SEC-001B.2 (2026-10-23) | Needs a Windows/macOS test run and a decision on supported platforms. Status: OPEN |
| LOCK-RELEASE-001 | Observable Lock Release Failure: `releaseIfOwned` (`src/coordinatorium/lock.ts`) wraps `unlinkSync` in an empty `catch` ("already gone — fine"), so a failed release of our own lock (e.g. `EACCES`, `EROFS`, `EIO`) is invisible. After a successful publication of `state.json` the lock file can therefore stay behind, and later commands wait for it until stale recovery (or a human) deals with it. The caller cannot tell "written and lock released" from "written, lock still held"; and if `release()` ever did throw from the `finally` in `mutateState`, a successful write would surface as a failure and `onWarning` would be skipped. Needed: tell `ENOENT` (already gone, fine) from other errors, report the latter as a warning distinct from the write outcome (never as a write failure, never retried), without ever hiding or deleting anything automatically. Release and stale recovery are path-based unlinks outside the safe-write primitive, so the fix should be designed together with SEC-001B.3. | SEC-001B.2 re-review, note N-3 (2026-10-23) | **BACKLOG — registration only, not implemented.** Status: OPEN |
| TD-009 | `src/brief/` imports `../scriptorium/frontmatter.js` (runtime) and the `../coordinatorium` barrel directly instead of going through `src/index.ts`, contrary to the literal wording of AGENTS.md Architecture Principle 4; `brief` is also not re-exported from `src/index.ts`. `src/graph/builder.ts` already imports `../scriptorium/types.js` the same way, so the principle is not strictly followed today | CONTEXT-001A | Reusing the existing parser and State Keeper validation avoided duplicating them; whether to relax Principle 4 or add narrow public re-exports is an architectural decision, not made here. Status: OPEN |
| STATE-001 | State Retention & Compaction: `state.json` accumulates checkpoint records (`tactical.checkpoints`) with no retention or compaction, so its size is potentially unbounded. The 16 MiB limit is implemented (SEC-001B.1, `MAX_STATE_BYTES`): it is a protective ceiling, not a growth solution. Once reached, `state.json` reads and writes are refused with `FILE_TOO_LARGE` (a write is rejected before the temp file is created, `state.json` untouched), so `mission` mutations fail closed and no further missions/checkpoints can be recorded until a human intervenes. **Automatic deletion of history is forbidden until an architectural decision is made;** do not implement compaction as part of any SEC story. Details below. | Registered 2026-10-22 (follow-up to SEC-001B.1 planning) | **PROPOSED / BACKLOG — registration only, no decision, no implementation.** Next step is an inventory (AUDIT ONLY); no storage design before it. Related: MEM-001 (separate initiative, see below). Status: OPEN |
| MEM-001 | Memory Lifecycle: long-running development accumulates working context, history, decisions and knowledge; there is no managed lifecycle (retention, archival, consolidation, controlled forgetting) that keeps context current without losing important knowledge or evidence. Details below. | Registered 2026-10-22 | **PROPOSED / BACKLOG — registration only, no decision, no implementation.** Next step is an inventory of existing memory mechanisms (AUDIT ONLY). Related: STATE-001 (may become one technical foundation, not merged automatically). Status: OPEN |

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

_Update (2026-10-22): SEC-001A and SEC-002 address parts of this; see their entries above and ADR-009/ADR-011. SEC-001B remains open (SEC-001B.1 safe reads implemented and merged, `d006562`; .2 implemented on `fix/sec-001b2-safe-writes` (not merged), .3 open)._

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
