---
type: context
id: agents-root
topology_role: root
authority: authoritative
---

# MONOLITH — AI Assistant Guide

This is the primary entry point for AI assistants working in this project.  
Read this file first on every session start. Do not start any task before completing the Boot Sequence.

---

## Project

**Package:** `@monolith/core`  
**Version:** `0.1.0-alpha.0`  
**Language:** TypeScript (strict, ESM)  
**Runtime:** Node.js >= 20  
**Package Manager:** pnpm  
**MONOLITH Root:** `.monolith/`

---

## Mission

**Portable Project Knowledge & Governance Toolkit for AI-Assisted Development.**

MONOLITH helps a human and an AI assistant preserve a shared understanding of a
project — its knowledge, architectural decisions, and progress — across
sessions, by structurally extracting and linking the project's own markdown
artifacts rather than relying on an AI's unaided memory.

Its core consists of two subsystems now active in this repository:
**Scriptorium** (deterministic structural extraction) and **ERG**
(explicit relationship graph). **Webway** (frequency-based semantic
concept-linking) was an earlier, orthogonal research track with no runtime
coupling to Scriptorium/ERG; it was extracted into its own repository — see
`Current Scope`.

> **Note on framing (resolved 2026-10-21):** `MANIFESTO.md` previously
> described MONOLITH as a *research platform* studying cognitive
> architecture, with Scriptorium/ERG framed as an emerging "Cognitive
> Kernel" product alongside Terra, Graph Memex, and WEBWAY. That framing
> and this toolkit-oriented mission statement were in tension. `MANIFESTO.md`
> was rewritten to the toolkit mission above; the cognitive-architecture
> research program (Terra, Graph Memex, the Cognitive Kernel vision, and
> `docs/architecture/cognitive-infrastructure.md`) moved to
> [Webway](https://github.com/Demion-L/webway) — see `docs/adr/README.md`.

---

## Vision

```
Markdown artifact
  → Scriptorium (structural extraction)
    → ERG (explicit relationship graph)
      → governed project memory (working/long-term, ADRs, roadmap)
```

The objective is not similarity-based retrieval. It is an explicit,
inspectable graph of what a project decided and why — every edge traceable
to a declared frontmatter field, never inferred (ADR-007).

Webway, developed separately ([github.com/Demion-L/webway](https://github.com/Demion-L/webway)),
pursues a related but distinct goal: discovering non-obvious semantic
relationships across knowledge domains via a frequency/embedding-based
"Meaning Linker." It is not part of MONOLITH's own roadmap.

---

## Boot Sequence

On every session start, read in this order:

1. This file (`AGENTS.md`)
2. `.monolith/context/maps/project-map.md`
3. `.monolith/context/maps/routing-map.md` — classify task type
4. `.monolith/memory/working/active.md` — current phase and story
5. `.monolith/context/maps/roadmap-index.md`
6. `.monolith/protocols/governance/memory-governance.md`
7. Relevant skill from `.monolith/skills/` (resolved via routing-map Table 2)
8. `.monolith/learning/injection-map.md` — load relevant lessons
9. `.monolith/protocols/cognition/cognitive-modes.md` — apply behavioral constraints

Full sequence: `.monolith/protocols/boot/boot-sequence.md`

---

## Navigation

| What                | Where                                                    |
| ------------------- | -------------------------------------------------------- |
| Active story        | `.monolith/memory/working/active.md`                     |
| Project map         | `.monolith/context/maps/project-map.md`                  |
| Routing decisions   | `.monolith/context/maps/routing-map.md`                  |
| Roadmap             | `.monolith/context/maps/roadmap-index.md`                |
| Skills              | `.monolith/skills/INDEX.md`                              |
| Protocols           | `.monolith/protocols/boot/boot-sequence.md`              |
| Lessons             | `.monolith/learning/INDEX.md`                            |
| Governance rules    | `.monolith/governance/`                                  |
| Architecture principles | `.monolith/memory/long-term/architecture-principles.md` |
| Architectural decisions | `.monolith/memory/long-term/decisions.md`           |

---

## Source Structure

| Path                              | Purpose                                                              |
| --------------------------------- | -------------------------------------------------------------------- |
| `src/scriptorium/types.ts`        | ScriptoriumInput, ScriptoriumResult, ConceptCandidate, Evidence, ... |
| `src/scriptorium/compile.ts`      | `compileMarkdownArtifact()` — structural extraction pipeline         |
| `src/scriptorium/frontmatter.ts`  | YAML frontmatter parser                                              |
| `src/scriptorium/markdown.ts`     | Heading/content extraction                                           |
| `src/scriptorium/index.ts`        | Module barrel export                                                 |
| `src/scriptorium/scriptorium.test.ts` | Vitest test suite (see integrity-result.md for count)            |
| `src/graph/types.ts`              | GraphNode, GraphEdge, ExplicitRelationshipGraph, ...                 |
| `src/graph/builder.ts`            | `buildGraph()` — Pass 1 (nodes) + Pass 2 (edges) + Pass 2.5 (aliases) |
| `src/graph/normalize.ts`          | `normalizeLabel()`, `selectCanonicalLabel()`                         |
| `src/graph/index.ts`              | Module barrel export                                                 |
| `src/graph/graph.test.ts`         | Vitest test suite (see integrity-result.md for count)                |
| `src/coordinatorium/types.ts`     | `CoordinatoriumState`, `Mission`, `Checkpoint`, schema version        |
| `src/coordinatorium/state-keeper.ts` | `readState()`, `mutateState()` — lock + atomic write + validation |
| `src/coordinatorium/lock.ts`      | Cross-process file lock with stale-lock recovery                     |
| `src/coordinatorium/mission.ts`   | `startMission()`, `listMissions()`, `getMission()`, `finishMission()` |
| `src/coordinatorium/checkpoint.ts` | `createCheckpoint()`, `listCheckpoints()`, `getCheckpoint()` — append-only |
| `src/coordinatorium/cli.ts`       | `monolith mission` command handlers (incl. `checkpoint`/`checkpoints`) |
| `src/coordinatorium/*.test.ts`    | Vitest test suite (93 tests, incl. real multi-process concurrency and a real-historical-code compat test) |
| `src/brief/collect.ts`            | `collect()` — read-only gathering for `monolith brief` (state.json read once) |
| `src/brief/render.ts`             | `render(model, maxChars)` — deterministic, budgeted, sanitized text output |
| `src/brief/{docs,config,story,selectors,sanitize,types,cli}.ts` | Protocol/ADR discovery, `contextGateway` config, Story excerpt, selectors, sanitizer, types, CLI handler |
| `src/brief/*.test.ts`             | Vitest test suite (122 tests, incl. end-to-end CLI runs on real directories) |
| `src/root/index.ts`               | `resolveMonolithRoot()` containment (ADR-009) + the unified safe reader `readBoundedFile()` and its wrappers `checkProjectFile()`/`readProjectFile()` (ADR-011, ADR-014) |
| `src/root/write-artifacts.ts`     | Read-only listing of leftover write files (`state.json.tmp.*`, `*.creating.*`, `*.recovery`); used by `brief` and `validate` as a warning, never deletes (DEC-B2-02) |
| `src/root/safe-write.ts`          | The safe-write primitive (SEC-001B.2, ADR-012): write boundary, `createFile`/`replaceFile` (publication of files), publication states, identity-checked cleanup of its own temp files. Lock release and stale-lock recovery (`lock.ts`) are separate, path-based `unlink`s |
| `src/validate/index.ts`           | `monolith validate` — static instance checks, never executes project code |
| `src/index.ts`                    | Package entrypoint — re-exports Scriptorium, Graph, Coordinatorium   |

---

## Current Scope

What MONOLITH does today (865 tests passing, typecheck clean):

**Scriptorium** (`compileMarkdownArtifact`):
- Parses YAML frontmatter → extracts `id`, `title`, `type` fields
- Extracts structural headings, content sections, concept candidates, relationship candidates
- Produces `ScriptoriumResult` with `documentId` (from `id:`), `documentTitle` (from `title:`)
- Full determinism — same input always produces identical output

**ERG** (`buildGraph`):
- Pass 1: builds `GraphNode` per compiled document (explicit `id:` required)
- Pass 2: resolves relationship candidates to real node edges (explicit-only, no fuzzy matching)
- Pass 2.5: registers aliases — `id:` → documentId, `title:` → documentTitle; first-document-wins on collision
- Validation: 481 real nodes, 0 synthesized nodes, 32 explicit edges from MONOLITH corpus
- ADR-007: explicit-only identity resolution (no fuzzy matching, no inferred aliases)

**Webway** (`analyzeArtifact`) — extracted to its own repository:
- Originally Story 1.1's deterministic frequency-based concept extraction / semantic linking prototype
- Had zero runtime coupling to Scriptorium/ERG; now developed independently at https://github.com/Demion-L/webway
- Historical record: `docs/webway-v0.md`

**Coordinatorium — Tactical Mission Lifecycle** (first vertical slice, ADR-008):
- `.monolith/state.json` — canonical, schema-versioned project state (`schemaVersion: 2`, `revision`, `strategic.systems` reserved, `tactical.missions`, `tactical.checkpoints`)
- `monolith mission start|list|show|finish` — register and close out missions; see Mission Lifecycle section below
- `monolith mission checkpoint|checkpoints` (COORDINATORIUM-002) — durable, append-only progress checkpoints for an `in_progress` mission; `schemaVersion` bumped to 2 (a v1 file is migrated in-memory on read, see ADR-008's compatibility-fix addendum — a pre-002 binary refuses to touch a v2 file instead of silently dropping checkpoints)
- Deterministic State Keeper: cross-process file lock + atomic write, no lost updates, no LLM/database/background service involved
- Strategic Coordinatorium (product/subsystem state) is **not implemented** — schema-reserved only

**Context Gateway — `monolith brief`** (CONTEXT-001A):
- `monolith brief [--max-chars N] [--strict]` — deterministic, read-only, character-budgeted summary of project state; see Project Brief section below
- Reads `.monolith/state.json` once and never writes; no LLM, network, or ERG involved
- `monolith context <topic>` (CONTEXT-001B) is **not implemented**

---

## Mission Lifecycle (Coordinatorium v0.1)

```
monolith mission start --title "..." --system "..."
monolith mission list
monolith mission show <id>
monolith mission finish <id> --result completed|failed|cancelled [--summary "..."]
monolith mission checkpoint <missionId> --summary "..." [--remaining "..." ...] [--context "..."]
monolith mission checkpoints <missionId>
```

This records development missions in `.monolith/state.json`, independent of
any single AI session's memory. **This is not runtime-enforced in v0.1:**
nothing prevents an AI session from editing code without ever calling
`mission start`/`finish`. It is a recommended discipline, not a gate. Full
rationale: ADR-008 (`docs/adr/ADR-008-coordinatorium-tactical-mission-lifecycle.md`).

**Mission Checkpoints (COORDINATORIUM-002):** an `in_progress` mission can
accumulate durable, append-only checkpoints — `summary` (required),
`remainingSteps` (0+ repeated `--remaining` flags), `context` (optional) —
recording progress between AI sessions. Checkpoints are immutable once
created: there is no update or delete command. `mission checkpoint` is
rejected for a mission that is not `in_progress` (completed/failed/
cancelled); `mission checkpoints` keeps listing a finished mission's
history regardless. IDs are `<missionId>-CKPT-NNNN` (e.g.
`MIS-0002-CKPT-0001`), per-mission, derived the same way mission IDs are —
no separate counter. Same non-enforcement caveat as mission start/finish:
nothing requires an AI session to call this.

---

## Project Brief (CONTEXT-001A)

```
monolith brief [--max-chars N] [--strict]
```

Prints a compact summary of current project state so a session need not
read many governance files to orient itself. It **supplements** the Boot
Sequence above; it does not replace it. Sections, in priority order:
identity, State Keeper status, Diagnostics, Active Missions, Mandatory
Protocols (frontmatter `enforcement: mandatory` under `<monolithRoot>/protocols`),
Active Mission Checkpoints (latest per active mission, with "Next steps"),
Current Story (verbatim excerpt of `## Current Story` in `active.md`),
Accepted ADR Index (frontmatter `status: accepted`), Recently Finished
Missions, and a pointer block. Every section names its source.

- **Budget:** `--max-chars` (default 6000). Mandatory content is never
  truncated; if it alone exceeds the budget it is shown in full and the
  result is flagged `BUDGET_EXCEEDED_BY_REQUIRED`. Truncation and omission are
  always explicit markers.
- **`Completeness: COMPLETE | INCOMPLETE`** is the first line. COMPLETE means
  no substantive data was lost; empty optional sections may be omitted for
  budget. Any error diagnostic (unreadable/empty `state.json`, corrupted
  `monolith.config.json`, unreadable or out-of-project document directory) or
  any dropped data-bearing section makes it INCOMPLETE.
- **Exit codes:** 0 brief formed (COMPLETE or INCOMPLETE), 1 usage error,
  2 `--strict` and INCOMPLETE.
- **Absent `state.json`** is reported as `status: absent` (no missions ever
  recorded); it is never read as an active mission.
- **ADR directories:** `<monolithRoot>/adr` plus any `contextGateway.adrDirs`
  entries in `monolith.config.json` (this repository sets `["docs/adr"]`).
  Configured directories must stay inside the project root.
- **Sanitization:** all project-controlled strings are escaped so project
  data cannot forge brief structure; the Story excerpt is the only
  multi-line field.

**File read contract (SEC-001B.1):** `state.json`, the lock record,
`active.md` and the Markdown documents `brief` scans are read through the
shared bounded reader in `src/root/` — non-blocking open (a FIFO cannot hang
the process), `fstat` regular-file check, size checked before and during the
read, descriptor always closed. Limits are protective ceilings, not policy:

| File | Limit | On violation |
|---|---:|---|
| lock record | 256 B | `LockUnsafeError` (`mission` exits non-zero); lock not acquired, file untouched |
| `active.md` | 256 KiB | `ACTIVE_MD_UNREADABLE` error naming `FILE_TOO_LARGE` → `INCOMPLETE`; a policy refusal (`FILE_NOT_REGULAR`, symlink, …) is `ACTIVE_MD_REJECTED` |
| Markdown documents (protocols, ADRs) | 1 MiB | `DOC_FILE_UNREADABLE` error → `INCOMPLETE` |
| `state.json` | 16 MiB | read: `StateFileError` / `STATE_UNREADABLE`; write: refused before the temp file is created |

Over-limit is fail-closed — never truncated, compacted or auto-cleaned
(growth policy: STATE-001, not started).

**Unified safe read contract (SEC-001B.1-R, ADR-014).** One strict policy for
every MONOLITH-managed file (`monolith.config.json`, `state.json`, `active.md`,
the lock record, brief's protocol/ADR documents and everything `validate`
reads); no permissive mode. It is the one `readBoundedFile` in `src/root/`: an
explicit absolute boundary (never the cwd; `''`/relative refused —
`READ_BOUNDARY_INVALID`); no symlink in any component below the boundary, inside
the project or not, dangling or not (`FILE_SYMLINK`); regular file only, refused
before `open` (`FILE_NOT_REGULAR`); `nlink == 1` (`FILE_HARDLINKED`);
`O_NOFOLLOW|O_NONBLOCK`; `dev/ino` of the descriptor equals the checked one
(`FILE_CHANGED`); fail closed without those flags (`READ_UNSUPPORTED_PLATFORM`).
`readState` and the mission/checkpoint readers take a `StateReadTarget`
(`project` | `trusted-directory`); a plain path is refused. Symlinks elsewhere in
the user's project are not inspected. The check is a path walk followed by an
`open`: a concurrent directory swap is NOT defended against (SEC-001B.3).

*Missing, refused and unreadable are three different things* (corrective pass
SEC-001B.1-R, M-1). `brief` diagnostics that come from a read carry the typed
`readCode` of the reader and are never told apart by message text. `active.md`:
`ACTIVE_MD_MISSING` (warn, `FILE_MISSING` only — the brief stays `COMPLETE`),
`ACTIVE_MD_REJECTED` (error, a `READ_SECURITY_CODES` refusal — the file exists
and was not shown) and `ACTIVE_MD_UNREADABLE` (error, any other read failure);
the last two make the brief `INCOMPLETE` and `--strict` exit 2. A refused file's
content never appears in a diagnostic (label and code only). `state.json`
(`STATE_NOT_INITIALIZED` info vs `STATE_UNREADABLE` error) and documents
(`DOC_FILE_UNREADABLE` error) keep the same separation; a configured document
directory that is a dangling symlink is `DOC_DIR_UNREADABLE`, not "not created
yet". `StateReadTarget` paths are validated before any filesystem call: a
relative or empty `stateDir`/`projectRoot` is `READ_BOUNDARY_INVALID`; in
`trusted-directory` scope only `ENOENT` on the path itself means "no state yet"
(a dangling link, a loop or a non-directory is refused). Ancestors of a
trusted directory are, by that scope's definition, not inspected.

`brief` adds a `WRITE_ARTIFACTS_PRESENT` **warning** when leftover write files
are present in the instance directory (and `validate` prints a `Warning:` line);
neither changes `Completeness` or an exit code, and nothing is deleted — a
matching name does not prove a file is an orphan (FS-CLEAN-001).

**File write contract (SEC-001B.2, ADR-012).** Every *publication* (creation or
replacement) of `state.json`, the lock files and the `init` scaffold goes through
`src/root/safe-write.ts`. Not everything that touches a file does: lock release
and stale-lock recovery `unlink` the lock path directly, `trusted-directory`
scope creates its directory with `mkdirSync`, and `src/scripts/dogfood-*.ts`
write reports on their own:

| Property | Contract |
|---|---|
| Scope | Explicit, no default: `project` (CLI, `init`; the project root is the boundary) or `trusted-directory` (the caller asserts the directory **and its ancestors** are trusted; they are not inspected). `mutateState` / `startMission` / `finishMission` take a `StateWriteTarget`; a plain string throws `WRITE_SCOPE_REQUIRED` |
| Symlinks (W-SYM) | Refused for writes anywhere below the boundary — in the target or in a parent, dangling or not, **including links that stay inside the project**. Reads keep the ADR-009 policy |
| Destination | Replaced only if absent or a regular file with one link; FIFO/special file, directory, symlink and `nlink > 1` (`WRITE_TARGET_HARDLINKED`) are refused |
| Temp file | `O_CREAT\|O_EXCL\|O_NOFOLLOW`; `rename()` over the state file, `link()` for create-only files |
| Modes | New `state.json` / lock: `0600`; an existing `state.json` keeps its mode; scaffold documents follow the umask |
| Durability | create → write → `fchmod` → `fstat` verify → `fsync(file)` → `close` → publish → `fsync(directory)`; state uses all of it, scaffold fsyncs files only, lock fsync stays opt-in |
| Publication | `NOT_PUBLISHED` / `PUBLISHED` / `UNKNOWN`, decided from the identity (`dev/ino`) of the destination and of the temp name after a failed `rename`/`link` — never from the error code, and for `link`+`EEXIST` never from a link count. `UNKNOWN` is never retried, never downgraded and nothing is deleted; the CLI asks the user to check the missions (state) or to inspect the lock and its staging files (lock). Failures after publication are warnings; `onWarning` runs after the lock is released |
| Cleanup | The primitive removes only a temp file created by the current call, and only while its `dev/ino` still matches. Lock release removes only a lock holding this process's own record; stale recovery removes a confirmed-dead owner's lock under the recovery mutex. No cleanup by age, PID or name; leftovers are not deleted (FS-CLEAN-001) |
| Lock | Ownership, backoff, liveness, stale recovery and record format unchanged; only staging creation uses the primitive |
| Platform | Guarantees: POSIX. Windows best-effort and **unverified** (warning `PLATFORM_BEST_EFFORT`); macOS/BSD unverified; NFS/SMB outside |

This does **not** defend against a local actor changing directories or
symlinks concurrently with a command (SEC-001B.3): the parent-directory
re-check is a tripwire, not protection, and removing the owned temp file is not
conditional on the identity check. `init` is neither atomic nor coordinated
between processes.

Known limitations: `monolithRoot` is contained (ADR-009, SEC-001A) and
file reads/writes are bounded and checked (SEC-001B.1 / .1-R / .2), but
check-then-use races remain (SEC-001B.3, OPEN — see
`.monolith/memory/long-term/tech-debt.md`);
`monolith context <topic>` and JSON output do not exist.

---

## Instance Validation (`monolith validate`)

`monolith validate [--quiet]` is **static** (SEC-002, ADR-011): it never imports
or executes `project.definition.mjs`. That file is checked only as a file —
present, inside the project, regular, non-empty, at most 1 MiB. A PASS does
not verify JS syntax, the `PROJECT_DEFINITION` export (decision D-1: that
check was removed), content safety, or executability. `monolith.config.json`,
`project.definition.mjs` and `AGENTS.md` are read through the unified safe reader
in `src/root/` (ADR-014: no symlink, single link, regular file, non-blocking open,
fstat identity/size check, capped read); a symlinked one is `FILE_SYMLINK`.
Check-then-use races remain open (SEC-001B.3).

---

## Out of Scope (current)

The following are explicitly deferred. Do not implement without a finalized story:

- LLM or embedding API calls
- Vector database integration
- Graph database (Neo4j, etc.)
- Corpus-level pattern learning
- Real semantic similarity (cosine, dot product, etc.)
- UI or API layer
- Engineering Gate runtime (ADR-003 formalized, not implemented)

---

## Architecture Principles

1. **Determinism first** — every capability must be testable before probabilistic layers are added. Frequency extraction before embeddings.
2. **Typed contracts** — TypeScript interfaces are the API. Shape matters more than implementation.
3. **No premature persistence** — in-memory structures first. Storage is a future story.
4. **Module isolation** — each subsystem (`scriptorium`, `graph`, `webway`) is self-contained. Cross-module imports only through `src/index.ts`.
5. **Additive evolution** — existing outputs remain structurally valid when later stories enrich them. No breaking shape changes without a Decision record.
6. **Vertical slice first** — a working end-to-end flow is more valuable than a partially built abstraction.
7. **Explicit-only identity** — ADR-007: aliases only from frontmatter `id:` and `title:`; no fuzzy matching; no inferred aliases. Provenance must be traceable.
8. **TypeScript strict + ESM** — `"type": "module"` in package.json; `strict: true`; no `any`; all imports use `.js` extensions.

---

## Development Philosophy

- One story at a time. No parallel active work.
- Tests before integration. `vitest` is the contract.
- No feature added without a story. No story without a task in `active.md`.
- If the type is wrong, fix the type. Don't work around it.
- Meaning over performance at this stage. Optimize only when the semantics are correct.

---

## Glossary

| Term | Definition |
| ---- | ---------- |
| **MONOLITH** | Portable project knowledge and governance toolkit for AI-assisted development. |
| **Scriptorium** | Deterministic structural extraction from a markdown artifact: `ScriptoriumInput` → `ScriptoriumResult` (`ConceptCandidate`, `RelationshipCandidate`, `Evidence`, `SourceReference`). |
| **Explicit Relationship Graph (ERG)** | The typed graph (`GraphNode`, `GraphEdge`) built from compiled documents; edges resolve only from explicit frontmatter fields — no fuzzy matching (ADR-007). |
| **Coordinatorium** | Tactical mission lifecycle: `Mission`, `CoordinatoriumState`, backed by `.monolith/state.json` (ADR-008). |
| **Instance** | A project-specific MONOLITH deployment with its own `project.definition.mjs`. |
| **Webway** | A separate, independently developed project (not part of MONOLITH) pursuing semantic/associative knowledge linking. See `docs/webway-v0.md` and [github.com/Demion-L/webway](https://github.com/Demion-L/webway). |

---

## Success Criteria

### Phase 1 — Cognitive Core & First Evidence (IN PROGRESS)

**Story 1.1 — Cognitive Core Foundation + Webway Dogfood v0** ✅ 2026-06-26
- [x] Webway types + `analyzeArtifact()` implemented and deterministic
- [x] 13 Webway tests passing
- [x] MONOLITH corpus ingested as dogfood

**Story 1.3 — Scriptorium, ERG, and Canonical Identity Resolution** ✅ 2026-06-28
- [x] `compileMarkdownArtifact()` — structural extraction pipeline, 138 tests
- [x] `buildGraph()` — Pass 1 + 2 + 2.5 alias system, explicit-only
- [x] ADR-007: explicit-only identity resolution

**COORDINATORIUM-001 — Tactical Mission Lifecycle (First Vertical Slice)** ✅ finalized 2026-10-21
- [x] Deterministic State Keeper (`.monolith/state.json`) — lock + atomic write, no lost updates
- [x] `monolith mission start|list|show|finish` CLI
- [x] ADR-008: Coordinatorium — Tactical Mission Lifecycle
- [x] 31 tests (incl. real multi-process concurrency), 169 total passing
- [ ] Strategic Coordinatorium — not in scope for this slice
- [x] 481 real nodes, 0 synthesized nodes on MONOLITH corpus
- [x] 151 total tests passing, typecheck clean

**COORDINATORIUM-002 — Mission Checkpoints** ✅ finalized 2026-10-21
- [x] `Checkpoint` domain entity, `tactical.checkpoints` sibling map
- [x] `createCheckpoint`/`listCheckpoints`/`getCheckpoint` (append-only — no update/delete path)
- [x] `monolith mission checkpoint|checkpoints` CLI
- [x] `MissionNotActiveError`/`CheckpointNotFoundError` added to the Coordinatorium error taxonomy
- [x] `schemaVersion` bumped to 2 with a deterministic v1→v2 migration on read (compatibility-fix addendum, same day: the first cut kept `schemaVersion` at 1, which an independent review confirmed would let a pre-002 binary silently drop checkpoints on write — fixed before integration)
- [x] ADR-008 amended with two dated addenda (same convention as the 2026-10-21 lock.ts hardening passes)
- [x] Init safety: `createEmptyDirs()` no longer truncates a pre-existing `.gitkeep` — the affected paths are now covered by `planScaffoldConflicts()`'s preflight, closing the gap found during this finalization's review
- [x] 252 total tests passing (checkpoint 40, state-keeper 21, init-safety 12, mission 17, init 3, init-args 6, lock 15, scriptorium 75, graph 63), typecheck and build clean

**CONTEXT-001A — Context Gateway: `monolith brief`** ✅ finalized 2026-10-22
- [x] `monolith brief [--max-chars N] [--strict]` — deterministic, read-only, budgeted, provenance per section
- [x] Explicit `Completeness: COMPLETE|INCOMPLETE`, explicit truncation/omission markers, exit codes 0/1/2
- [x] Resilient document discovery (unreadable dirs/files, dangling symlinks, symlink cycles), protocol/ADR directory containment
- [x] Sanitization of all project-controlled strings; corrupted config reported, not masked
- [x] `contextGateway.adrDirs` config field; ADR-007/008 visible via `docs/adr`
- [x] 374 total tests passing (brief 122), typecheck and build clean
- [ ] `monolith context <topic>` (CONTEXT-001B) — not implemented
- [x] SEC-001A (`monolithRoot` containment, corrupted config fails closed) — IMPLEMENTED on branch, ADR-009
- [ ] SEC-001B (TOCTOU / filesystem boundary) — OPEN; SEC-001B.1 (bounded reads) IMPLEMENTED / MERGED (`d006562`), SEC-001B.1-R (unified safe read, ADR-014) IMPLEMENTED on `fix/sec-001b1r-unified-safe-read`, NOT merged, SEC-001B.2 (safe writes, ADR-012) IMPLEMENTED on `fix/sec-001b2-safe-writes`, NOT merged; SEC-001B.3 OPEN

**Candidate next stories (not decisions):**
- CONTEXT-001B — `monolith context <topic>`
- SEC-001 — Project Root Trust Boundary
- Corpus relationship density (32 edges / 481 nodes — too sparse)
- Engineering Gate runtime (ADR-003 formalized, not implemented)
- Webway v1 (embedding-based concept extraction, semantic similarity)

### Phase 2+ — NOT DEFINED

---

## Core Rule

One story at a time. Vertical slice first. No autonomous capability expansion.

Read `.monolith/protocols/governance/core-invariants.md` before starting any task.
