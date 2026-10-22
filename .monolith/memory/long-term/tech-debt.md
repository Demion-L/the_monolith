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
| SEC-001 | Project Root Trust Boundary: `monolithRoot` from `monolith.config.json` is joined onto the project directory with no containment check, so `..` segments let it point outside the project root; the check exists only in `brief`'s document discovery (protocols/ADR). Details below. | CONTEXT-001A (found in review, 2026-10-22) | Cross-subsystem contract (`validate`, `mission`, `init`/scaffold, `brief`); changing it unilaterally in one subsystem would desynchronize them. Needs one shared decision — see "SEC-001 detail". Status: OPEN, not started |
| TD-009 | `src/brief/` imports `../scriptorium/frontmatter.js` (runtime) and the `../coordinatorium` barrel directly instead of going through `src/index.ts`, contrary to the literal wording of AGENTS.md Architecture Principle 4; `brief` is also not re-exported from `src/index.ts`. `src/graph/builder.ts` already imports `../scriptorium/types.js` the same way, so the principle is not strictly followed today | CONTEXT-001A | Reusing the existing parser and State Keeper validation avoided duplicating them; whether to relax Principle 4 or add narrow public re-exports is an architectural decision, not made here. Status: OPEN |

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
