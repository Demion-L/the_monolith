---
type: adr
id: ADR-021
title: "Project Discovery: Native-first Evidence-driven Architecture"
status: accepted
date: 2026-10-30
related_adrs:
  - ADR-009
  - ADR-011
  - ADR-012
  - ADR-013
  - ADR-014
  - ADR-020
---

# ADR-021 — Project Discovery: Native-first Evidence-driven Architecture

> **Status: ACCEPTED (2026-10-31)** by the owner's explicit decision. Produced by
> DISCOVERY-001A and revised by DISCOVERY-001A-R (architecture review, 2026-10-31).
> It is an architecture decision: implementation proceeds only through the stories in
> "Implementation Boundaries", each started on the owner's instruction. The number
> ADR-021 was the next free one per `docs/adr/README.md`; DISCOVERY-001A-R re-checked
> every local and remote branch and every worktree and found no other ADR-021 … 029.
> **Owner decisions recorded at acceptance:** create-only publication; the proposal at
> `context/maps/project-map.proposal.md`; `discover` publishes by default and `--dry-run`
> prints to stdout; an initialized instance is required, including for `--dry-run`;
> script **names** only; fact ids of 16 hex; no Knowledge Intent and no template change;
> `<monolithRoot>` excluded; TM-C limitations stated as written.
> Supporting research documents (not in this repository):
> `/home/demion/projects/AI/MONOLITH/experiments/discovery-001a/DISCOVERY-001A/`
> and, for the review, its `review/` subdirectory (`adr-review.md` lists every
> finding behind the changes below).

## Context

`monolith init` scaffolds `.monolith/` and prints a next step asking the developer
to describe the project by hand in `.monolith/context/maps/project-map.md`
(`src/init/index.ts`, `runInit`). In the shipped template that file is governance
navigation plus one empty section, `## Project Structure`
(`templates/default-instance/monolith/context/maps/project-map.md`). Much of what a
developer would write there — directories, declared stack, scripts, where the
documentation is — already exists in the project's files.

Three experiments (GRAPH-001A Python/Graphify baseline, GRAPH-001B Python native
scanner, GRAPH-001C TypeScript/SphynX) found: a native, compiler-grade scanner
resolves substantially more structure than Graphify (TS: 94.6 % vs 56.5 % of
structural claims; calls 100 % vs 73 %); combining them added no claims over
native; **no analyzer determined component roles** ("single runtime assembly
point", "production-truth boundary"). Caveat recorded in those reports: n = 1
project each, ground truth authored by the same author as the scanner.

Constraints established by reading the current tree (see
`architecture-reconnaissance.md`) and re-verified by DISCOVERY-001A-R on
`main@9cd2a45` (`vitest run src/root src/validate src/ideas`: 499 tests passed):

- the package has **zero runtime dependencies**;
- `project-map.md` is `authority: authoritative` and read in every session (Boot Sequence);
- the ERG is explicit-only (ADR-020): a frontmatter `id:` declares a `document`
  object, a `{#ID}` heading marker declares a `section` object; inferred facts do not belong in it;
- `monolith validate` reads every file under `.monolith/` (≤ 1 MiB) and rejects
  `{{INIT_VAR}}` placeholders (`src/validate/index.ts`, matched against the **raw**
  text — a Markdown code span does not protect a value);
- file **content** is read safely (`readBoundedFile`, ADR-014) and one file is written
  safely (`createFile` / `replaceFile`, ADR-012); `replaceFile` does not compare
  contents, there is no lock for an arbitrary file, and `createFile` (`link()`)
  never overwrites;
- there is **no bounded directory-listing primitive**: the two existing walks
  (`src/brief/docs.ts`, `src/validate/index.ts`) use `readdirSync` without limits,
  and `brief` skips symlinks silently (BRIEF-DOCDIR-001, open);
- SEC-001A/B.1/B.1-R/B.2/002 are merged; **SEC-001B.3 is open** and threat model
  TM-C (concurrent adversarial mutation) is **unsupported** (ADR-013, itself still `proposed`).

## Problem

How can MONOLITH familiarize itself with an existing project and propose an
initial architecture map, without executing project code, without presenting
inference as fact, and without overwriting knowledge the developer maintains?

## Decision Drivers

1. Determinism and checkability (no LLM, network, Python or Graphify required).
2. Every claim traceable to evidence; observed facts and rule-based interpretation kept apart.
3. Human governance: Scan → Review → Manual update; discovered and curated knowledge stay separate.
4. Untrusted input: the analyzed project is hostile until proven otherwise.
5. Minimalism: no analysis platform, no ontology, no abstraction without a concrete need.
6. Reuse existing safe-read/safe-write/containment contracts; change no existing component.

## Considered Options

- **O1** Graphify-first (graph.json as the data model).
- **O2** Native-first, evidence-driven, single internal analyzer set (proposed).
- **O3** Independent analyzers behind a public plugin contract from day one.
- **O4** LLM-assisted interpretation of the codebase.
- **O5** Do nothing; keep the manual instruction in `init`.

Project-map strategy options: **A** separate proposal file; **B** managed sections inside `project-map.md`; **C** separate facts store.
Language options: **A** universal discovery without AST; **B** universal + syntactic TypeScript analyzer.
Proposal write options: **W1** create-only; **W2** replace guarded by a content hash.

## Proposed Decision

1. **Native-first; Universal Discovery MVP.** Project Discovery is an internal module
   `src/discovery/`: deterministic, offline, language-agnostic, with no runtime
   dependency, no LLM and no subprocess. **No AST** in the MVP (TypeScript and Python
   analysis are deferred). **Graphify is neither integrated nor a dependency nor an
   adapter target.** No new mandatory dependency of any kind.

2. **Minimal Discovery Contract** (schema version 1): `DiscoveryResult`,
   `DiscoveryFact`, `DiscoverySource`, `DiscoveryDiagnostic`. There is no separate
   `DiscoveryEvidence` (it would duplicate `DiscoverySource`) and no ontology.
   - `DiscoveryFact`: `id`, `kind`, `level`, `subject`, `object?`, `value?`, `rule`, `basis?`, `sources`.
   - `level` is `DETECTED` (the project's bytes state it) or `INTERPRETED` (derived by a
     named `rule` from DETECTED facts via `basis`). It is a **function of `kind`**, never
     chosen per fact, and the validator checks it. Hypotheses are never presented as
     detected facts; the renderer lists INTERPRETED facts separately and calls them
     candidates. A resolved-dependency level and a link `target` are deferred until an
     analyzer produces links. No numeric confidence.
   - `DiscoveryResult`: `schemaVersion`, `limits`, `completeness`, `stats`, `facts`, `diagnostics`.
   - Field-by-field justification and the v0 → v1 differences: `contract-review.md`.

3. **Provenance.** Every fact has ≥ 1 source: a project-relative POSIX `path` (no `..`,
   no absolute path, no host name in any result) and an optional line. An interpreted
   fact additionally names its `rule` and the DETECTED facts it rests on.

4. **Determinism.** Fact identity is `id = H(schema, kind, subject, object, value)`
   (16 hex of sha256); it excludes provenance, positions and level. No random value, clock,
   `readdir` order or locale reaches the canonical result: directories are traversed
   and facts, sources and diagnostics are ordered by UTF-16 code units, never
   `localeCompare`. Conflicting facts are both kept (no first-wins, as ADR-020). **`<monolithRoot>`
   is excluded from the walk and the inventory** (its `state.json` and the proposal itself
   would otherwise change the next scan); names that do not round-trip (U+FFFD, NUL, control
   characters) are excluded with a diagnostic. Repeatability is guaranteed for an unchanged tree
   and an unchanged tool version, except when the time budget fired (the result says so).

5. **Partial-failure diagnostics.** Three outcomes, never conflated:
   `COMPLETE`; `PARTIAL` (a limit fired, a directory or an allow-listed file could not be
   read, an analyzer failed, a directory or file changed during the scan — each with a
   typed diagnostic from a closed list, and the result is labelled so in every output);
   `FAILED` (cannot proceed safely, or the result validator rejected the result: **no
   result is rendered**). Intentional scope policy (symlinks not followed, fixed exclusions)
   is reported but is not a failure. The scope policy is printed with every result.
   Unknown things (component roles, unanalysed languages) are listed explicitly as unknown.

6. **Scan / Publication separation.** Two operations with different security boundaries:
   - **Discovery Scan** — reads the project, produces a `DiscoveryResult`; opens nothing for
     writing, creates nothing, takes no lock. It is also the mode of `--dry-run`.
   - **Proposal Publication** — renders the result and writes it; the only write.

7. **Human-governed project map.** `project-map.md` stays authoritative and is **never
   opened for writing** by Discovery. Discovery produces a separate proposal,
   `<monolithRoot>/context/maps/project-map.proposal.md`, reviewed by a person who moves
   accepted lines into the curated map **by hand**. The proposal is **plain Markdown with
   no front matter**: no `id:` (so no ERG `document` object and no collision with
   `project-map`), no `authority` field, no Knowledge Intent, no template change. The
   path is a proposed location awaiting the owner's decision (Open Question Q-1b).
   It is outside the Boot Sequence and is not shown by `brief`. A managed-block "apply"
   is a later, separately decided, write-enabled operation.

8. **Proposal overwrite protection (create-only).** Publication uses `createFile`
   (`link()`-based, never overwrites, refuses symlink/FIFO/hardlink): file absent →
   create; present and byte-identical to the new rendering → "unchanged", no write;
   present and different (the project changed **or** the person edited it) → **no write**,
   an explanatory message and a non-zero exit distinct from a tool failure. Regeneration
   means the person deletes or renames the old file; `--dry-run` prints the new
   rendering to stdout so it can be diffed. There is no `--force`. A hash-guarded
   `replaceFile` is rejected for the MVP: `replaceFile` has no compare-and-swap and
   MONOLITH has no lock for an arbitrary file, so a hand edit made between the check and the
   `rename` would be lost. Two concurrent runs need no lock: `link()` lets exactly one win.
   Creation must be **atomic and exclusive**: a check-then-write (`existsSync` followed by
   `writeFileSync`) is not atomic and is forbidden. A symlink at the target path is also
   refused (never followed, never replaced). If the guarantees of the file layer are
   insufficient on a platform, publication fails safe (refuses) rather than degrading.

9. **Security boundary.**
   - Content is read only through `readBoundedFile`, only for an allow-list of file names,
     with a cap on the number of reads and a small byte cap for documents; secrets
     (`.env*`, keys) are never read or named; `scripts` are shown by **name** only.
   - Directories are listed only by a new Discovery-internal walker using `opendirSync`
     (never `readdirSync`: it loads a whole directory before any cap can apply), one open
     directory at a time, counting on the fly; a directory over its cap is opaque.
     It does not follow symlinks (each is counted and reported), does not enter
     nested repositories, does not cross file systems, uses an iterative stack with
     explicit limits (entries, depth, entries per directory, content reads, facts, output,
     monotonic wall-clock) that yield `PARTIAL`, never silent truncation, and compares a
     directory's identity before and after listing (a detector, not a defence).
   - The project root is `cwd` only; an initialized instance is required, including for
     `--dry-run`. This is a compatibility/UX rule (the same as `idea`), **not** a security
     control: `init` can be run anywhere, so limits are what bound the scan.
   - Untrusted strings (names, `package.json` fields, README titles) enter Markdown only as
     escaped single-line data in table cells: every `{` and `}` is backslash-escaped
     (verified: `{{PROJECT_NAME}}` raw breaks `monolith validate`, `\{\{PROJECT_NAME\}\}`
     passes; `{#ID}` would declare an ERG section), control and bidirectional characters,
     `|` and backticks are escaped, values are truncated with a marker, and no project
     text is used in a heading or as a statement. The proposal opens with a fixed notice
     that the content is quoted data, not instructions. This lowers prompt-injection
     risk; it does not eliminate it and no detector is claimed.
   - Discovery never runs package scripts, builds, project CLIs or plugins; there is no
     `child_process`, `eval` or dynamic `import()` in `src/discovery/**`.
   - Platform: POSIX guarantees only; without `O_NOFOLLOW`/`O_NONBLOCK` Discovery fails closed.

10. **Security limitations; TM-C.** The supported threat scenarios are:
    (S1) an ordinary local project with no hostile process — supported;
    (S2) an untrusted but **static** project — supported with limitations (TM-B remains
    "partially supported" per ADR-013 §6; Discovery performs no re-evaluation);
    (S3) a tree **concurrently modified by a potentially hostile process** — **not supported
    and excluded from the MVP** (TM-C, ADR-013; SEC-001B.3 is open). A directory swap between
    the check and the open can redirect a read or the single write; nothing in Discovery's
    code, CLI text or documentation may claim otherwise, and the CLI says: do not run
    `monolith discover` on a tree that an untrusted process is modifying. Closing SEC-001B.3
    is **not** required for read-only scan or create-only publication (same risk class as
    `idea add` and `init`); it **blocks** any write into `project-map.md`, any `--force`,
    and any TM-C claim.

11. **Semantic interpretation is deferred.** Component roles, call graphs, imports between
    files, runtime confirmation and architecture descriptions are out of scope; roles remain
    `UNKNOWN`; entrypoints are candidates by manifest fields and file conventions only.

12. **CLI (proposed, not approved):** `monolith discover [--dry-run]`, used after
    `monolith init`; `init` is not made heavier. By default `discover` publishes the
    proposal when the gates above allow it; `--dry-run` writes nothing. Exit codes follow
    the `brief` convention (0 formed, non-zero for refusal/failure) and are fixed in
    DISCOVERY-001D.

## Consequences

- Easier: a first project map is produced without manual typing of structural facts; every line is traceable; rescans are idempotent; the developer's curated map is untouched; the proposal cannot be silently overwritten.
- Harder/costlier: a new bounded directory walker must be built and hostile-tested (not covered by ADR-014); regeneration requires deleting the old proposal; more documents to keep consistent (CLI reference).
- Honest limits: the proposal is a **navigation pointer, not an architecture description** — component roles remain `UNKNOWN`; entrypoints are candidates, never runtime-confirmed; imports/exports between files are not analyzed in the MVP.
- Dogfood obligation: acceptance compares the proposal for MONOLITH itself with its curated `project-map.md`; discrepancies are findings.

## Security Implications

Threat model: TM-A supported with limitations; TM-B partially; **TM-C unsupported** (ADR-013) — see Decision 10. Read-only discovery changes nothing; the single write is a tool-owned file at a fixed path, created exclusively. Per-threat controls (path traversal, symlink escape, directory replacement, recursion, file count, per-directory count, time, unreadable directories, secrets, template injection, identity collision, publication failure and recovery) and the gates G1–G12 that become acceptance criteria of the implementation stories are in `review/security-alignment.md`. Discovery-specific risks beyond the requested list: prompt injection through AI-facing output, hostile file names, output growth, interaction with `validate`. The proposal is deliberately outside the Boot Sequence and outside `brief`. Apply into `project-map.md` is blocked until its own decision and until the SEC-001B.3 position for writes to AI-read documents is stated.

## Compatibility

Additive. No change to existing CLI behavior, `init`, ERG, Scriptorium, Coordinatorium, Durable State, public exports (`src/discovery/` is not exported from `src/index.ts` until the owner decides), `state.json`, `monolith.config.json` or instance templates. `monolith validate` keeps passing (verified on a scratch instance: a front-matter-free file in `context/maps/` passes; escaped braces pass). Platform: POSIX guarantees only. The proposal path adds one file in an existing directory; it adds no directory, registry or template entry (a Knowledge Intent / routing-map entry is not in the MVP).

## Rejected Alternatives

- **O1 Graphify-first:** worst structural coverage on TypeScript, no unresolved-call/external-package/environment data, makes MONOLITH depend on a Python package and its `graph.json` format; no analyzer would be removable.
- **O3 Plugin contract now:** one source, no second consumer; dynamic loading is execution of foreign code.
- **O4 LLM interpretation:** non-deterministic, needs network/API, outside the stated principles; ADR-020 forbids inference in the graph; remains out of scope.
- **O5 Nothing:** leaves the manual step the experiments showed to be largely mechanical.
- **Strategy B in MVP:** the first run would write into an authoritative, AI-read document; error cost too high. **Strategy C in MVP:** a second file with no consumer.
- **W2 hash-guarded replace in MVP:** no compare-and-swap in `replaceFile`, no lock for an arbitrary file; protection would be best-effort with a loss window.
- **Proposal as a full MONOLITH artifact (front matter, `id`, `authority: proposal`):** an `id:` creates an ERG `document` object, `authority: proposal` is recognised by no code, and an artifact status drags in routing-map/template changes (D6).
- **Variant B (typed) in MVP:** first runtime dependency, 0.8 GB memory profile in GRAPH-001C, default compiler host bypasses `readBoundedFile`.
- **Interpreting `.gitignore` / using `git ls-files` in MVP:** semantics are error-prone or require a subprocess on an untrusted repository.
- **Storing facts in the ERG:** violates ADR-020 (explicit-only).

## Open Questions

| # | Question |
|---|---|
| Q-1 | Where do MONOLITH research documents live (KQ-3)? Interim: outside the repository (`experiments/`). |
| Q-1b | **Resolved at acceptance:** one new tool-written file `context/maps/project-map.proposal.md` is accepted. |
| Q-2 | **Resolved at acceptance:** `discover` publishes by default; `--dry-run` prints to stdout. |
| Q-3 | Where does the output escaper live (`src/brief/sanitize.ts` is already imported across modules, TD-009)? Recommended: a small dedicated one inside `src/discovery/`. |
| Q-4 | May `init`'s "Next steps" mention `discover`? (Not in the MVP.) |
| Q-7 | Keep `src/discovery/` out of the public API until accepted? (recommended yes) |
| Q-8 | First runtime dependency for a TypeScript analyzer; `git ls-files` as a file source — separate decisions, not MVP. |
| Q-9 | **Resolved at acceptance:** an initialized instance is required, including for `--dry-run` (compatibility, not security). |
| Q-10 | Approve the initial limits (50 000 entries, 10 000 per directory, depth 32, 30 s, 200 content reads, 256 KiB proposal) as starting values to be validated by the DISCOVERY-001B-1 benchmark? |
| Q-11 | **Resolved at acceptance:** 16 hex. |

Resolved at acceptance: **Q-5** script **names** only; **Q-6** no Knowledge Intent, no template change, no `authority` field. Q-10 limits remain starting values until measured in DISCOVERY-001B-1.

## Implementation Boundaries

Allowed after acceptance, in four stories only, each starting only after the previous one's gates are green: **DISCOVERY-001B-1** safe scan core (walker, inventory, languages, contract and validator; library, no CLI, no writes); **DISCOVERY-001B-2** manifest and documentation analyzers; **DISCOVERY-001C** proposal rendering and create-only publication; **DISCOVERY-001D** `monolith discover` and docs. Not authorized by this ADR: Graphify integration or adapter; a TypeScript/Python analyzer; `--apply`; `--force`; JSON output; any change to `init` behavior, ERG, Scriptorium, the safe-read/safe-write primitives, instance templates or public exports; any subprocess or network use.

## References

ADR-009, ADR-011, ADR-012, ADR-013, ADR-014, ADR-020; `docs/adr/README.md`; `src/init/`, `src/root/`, `src/brief/`, `src/ideas/`, `src/validate/`; tech-debt SEC-001B.3, BRIEF-DOCDIR-001, FS-PLAT-001, FS-CLEAN-001, TD-009; GRAPH-001A/B/C reports in `/home/demion/projects/AI/MONOLITH/experiments/`; DISCOVERY-001A-R reviews (`review/`).
