---
type: context
id: context-boot-handoff
category: boot
stability: volatile
authority: authoritative
---

# Session Handoff

Transfer capsule for the next AI session.

Update this file at the end of each work session before closing.

---

## Active Story

None. COORDINATORIUM-002 was finalized on 2026-10-21.

---

## Objective

COORDINATORIUM-001, COORDINATORIUM-002, and Init Safety are all closed.
No active work. Phase 1 remains IN PROGRESS (no phase-closing mechanism
exists in this project beyond marking individual stories COMPLETE — see
Constraints).

---

## Completed This Session

- Fixed a confirmed Init Safety defect: `createEmptyDirs()`
  (`src/init/scaffold.ts`) wrote 10 `.gitkeep` placeholders
  unconditionally via `writeFileSync(path, '')`, with no existence check,
  and these paths were absent from `planScaffoldConflicts()`'s preflight —
  a pre-existing, possibly non-empty `.gitkeep` was silently truncated on
  init/re-init. Fixed via a single shared `GITKEEP_DIRS` source of truth
  consumed by both the preflight check and the writer; `--yes` does not
  bypass it. Commit `093ea09`.
- Added 5 regression tests for the fix (existing non-empty `.gitkeep`
  refused + byte-for-byte unchanged, no partial scaffold on a
  `.gitkeep`-only conflict, `--yes` does not bypass, clean init still
  creates the placeholders, repeat init refused without touching them).
- Verified, did not re-implement, the already-existing COORDINATORIUM-002
  (Mission Checkpoints) and Schema v2 migration work (commits `aea408f`,
  `b8a320f`): re-ran the full test suite (252/252), the concurrent
  checkpoint creation tests, the v1→v2 migration tests, and the
  old-binary-vs-v2-file safety test; ran a fresh manual CLI smoke test of
  the full checkpoint lifecycle; ran `lock.test.ts` 5× consecutively, no
  flakes.
- Ran a real-PTY interactive `monolith init` test (Python `pty.openpty`,
  in an isolated temp directory) — confirmed the interactive prompt path
  completes successfully end-to-end, not merely an EOF artifact.
- Ran the full Init Safety checklist from this session's task (unknown
  args/flags rejected, `--yes` doesn't authorize overwrite, existing
  AGENTS.md/monolith.config.json/`.monolith/` data preserved,
  `state.json` never overwritten, every scaffold write path now covered
  by preflight, no side files on a rejected init, repeat init safely
  rejected) — all pass, backed by existing + new automated tests.
- Finalized COORDINATORIUM-002 via the `finalize-story` skill: wrote the
  story capsule, extracted and wrote 1 lesson (`LESSON-2026-0007`,
  architecture category — see decision table in this session's record),
  updated `active.md`, `story-index.md`, `execution-history.md`,
  `roadmap-index.md`, `tech-debt.md` (new resolved entry `TD-008`),
  `integrity-result.md`.
- **Added Documentation Synchronization as a new mandatory Step 5.5 of
  the `finalize-story` skill itself** (not just performed once) — every
  future finalize-story must now check and, where needed, update
  README.md, AGENTS.md, CLAUDE.md, package.json, architecture docs,
  governance docs, and CLI docs before a story can be considered closed.
- Performed that audit for this story and found (not merely re-verified)
  real drift, now fixed:
  - README.md's "Implemented today" list and Components/CLI sections
    omitted Coordinatorium/mission entirely, and didn't mention the
    `checkpoint`/`checkpoints` subcommands.
  - AGENTS.md: `scriptorium.test.ts`'s test count was hardcoded and stale
    (138, actual 75); the top-of-file "Current Scope" count was stale
    (138, actual 252 after this session); both COORDINATORIUM-001 and
    -002 Success Criteria headers still said "pending
    review/finalization" despite both being (now) finalized.
  - **The repo's own `CLAUDE.md`, `package.json`'s `description`, and —
    more importantly — all three `monolith init` scaffold instruction
    templates** (`templates/default-instance/instruction/{CLAUDE.md,
    .cursorrules,.windsurfrules}`) still described MONOLITH as "a
    structured cognitive operating system," the framing `AGENTS.md`
    itself records as superseded 2026-10-21 by the toolkit mission
    (`MANIFESTO.md` rewrite). The template copies matter most: every
    future `monolith init` would have propagated the stale framing into
    a brand-new project's instruction file.
  - `docs/architecture/toolkit-pipeline.md` didn't mention the
    `checkpoint`/`checkpoints` CLI subcommands.
  - Verified clean (no change needed): ADR index (`docs/adr/README.md`),
    `docs/architecture/README.md`, governance protocol files.
- Build/test verification: `npm run typecheck`, `npm run build`, full
  `npm test` (252/252), `git diff --check` — all clean, run after every
  substantive change in this session, not only once at the end.
- Committed the `.gitkeep` fix separately from the governance/
  finalization + documentation-sync changes (two distinct logical
  commits, as instructed).

---

## Constraints

- Strategic Coordinatorium (product/subsystem state) remains schema-
  reserved only — no mutation logic exists for it.
- Mission registration is not runtime-enforced — nothing stops an AI
  session from editing code without calling `mission start`/`finish`.
  Same for checkpoints: nothing requires calling `mission checkpoint`.
- `state-keeper.ts` still carries mission/checkpoint-specific schema
  coupling (`TD-006`, re-assessed during COORDINATORIUM-002, still open)
  — re-evaluate if a *third*, differently-shaped top-level state section
  is ever added (most plausibly Strategic Coordinatorium).
- The `.gitkeep` preflight fix, like every other conflict check in
  `planScaffoldConflicts()`, is **not** TOCTOU-safe: nothing locks the
  target directory between the conflict check and the actual write. This
  was true before this session's fix too; it is not a regression, but
  don't claim stronger race-safety than this in future docs.
- `TD-007b` (unrelated, pre-existing, not touched this session): the
  top-level `monolith` usage text lists `status` and `dry-run` as
  ordinary commands; both exit 1 with "not yet implemented."
- This project has no formal "phase closure" mechanism beyond marking
  individual stories COMPLETE in `roadmap-index.md`/`story-index.md` —
  "closing Phase 1" in this session's task was interpreted as closing
  the three named stories (COORDINATORIUM-001, COORDINATORIUM-002, Init
  Safety), not as inventing a new phase-closure ceremony. `roadmap-index.md`
  still shows Phase 1 as IN PROGRESS, which is accurate — Phase 1's own
  goal (corpus-ingestion pipeline validation) was separately closed by
  Story 1.3; Coordinatorium work was added to the same phase bucket
  without its own phase.

---

## Next Step

**MONOLITH Context Gateway** is the next candidate phase. This session
prepared the following handoff only — **nothing was implemented**, per
explicit instruction. No new worktree was created for it either.

### Target first deliverable: `monolith brief`

**User experience:** instead of an AI session being required to read
5–9 governance files at boot (see `AGENTS.md`'s own Boot Sequence, and
this repo's `CLAUDE.md`), it runs `monolith brief` and gets a compact,
deterministic, traceable summary of current project state.

### What already exists and is directly reusable

- **State Keeper (`src/coordinatorium/state-keeper.ts`)** — `readState()`
  already gives a validated, schema-checked, deterministic read of
  `.monolith/state.json`. A brief command's "Coordinatorium" and "Active
  Mission" / "Latest Checkpoint" sources are a thin read-and-format layer
  over this; no new storage or locking needed.
- **`listMissions()` / `getMission()` / `listCheckpoints()`
  (`src/coordinatorium/{mission,checkpoint}.ts`)** — give exactly
  "active mission" and "latest checkpoint" lookups already, with no new
  query logic required beyond picking the most recent `in_progress`
  mission and its highest-ordinal checkpoint.
- **Scriptorium (`compileMarkdownArtifact`) + ERG (`buildGraph`)** —
  already extract structured frontmatter/headings/relationships from
  canonical markdown documents (ADRs, decisions, memory files) with full
  determinism and no LLM calls. A brief command's "canonical project
  documents" and "relevant ADR/Decisions" sources can likely be served by
  querying the already-built graph rather than re-parsing or re-selecting
  documents ad hoc.
- **`memory/long-term/decisions.md`, `memory/working/active.md`** — already
  the canonical, human-and-AI-readable summaries of "what was decided"
  and "what's active"; a brief command could plausibly just read and
  excerpt these directly rather than re-deriving their content from the
  graph, at least for a first MVP.
- **`monolith validate`'s pattern** (`src/validate/index.ts`) — precedent
  for a read-only, deterministic, no-LLM CLI command with structured
  PASS/FAIL-style output; `monolith brief` should likely follow the same
  CLI shape (own subcommand file under `src/`, wired into
  `src/cli/index.ts`'s switch).

### Contracts that will need to be decided before implementation

- **Output contract:** is `monolith brief`'s output meant for an AI
  session to read as-is (structured but prose-like), or a structured
  format (JSON) an AI tool/skill parses and re-presents? This changes
  the entire design — "deterministic" and "traceable sources" both point
  toward structured output with provenance per field, but "minimal
  bootstrap" (replacing prose file reads) points toward human/AI-readable
  text. This needs a decision, not an assumption.
- **Bound definition:** "bounded context" is a stated goal with no
  concrete definition yet (token budget? line count? number of
  documents?). Needs a number or a formula before "bounded" is anything
  but a slogan.
- **Source selection for "canonical project documents" / "relevant
  ADR/Decisions":** the proposal lists these as sources but doesn't yet
  say *which* documents are "canonical" for a given moment, or how
  "relevant" ADRs are selected (all of them? ones referencing the active
  mission's `system`? graph-neighborhood of some seed node?). This is
  the crux of the "no duplicated source of truth" goal and needs its own
  design pass, not a default.
- **Relationship to the existing Boot Sequence:** does `monolith brief`
  *replace* steps 1–9 of `AGENTS.md`'s Boot Sequence, *supplement* them,
  or exist only for a leaner alternate path some sessions opt into? This
  determines whether `AGENTS.md`/`CLAUDE.md` need rewriting as part of
  Context Gateway's own story, which would itself trigger the
  finalize-story Documentation Synchronization step added this session.
- **ERG dependency:** the proposal states "ERG is not a required
  dependency for MVP" — confirm this is still true once source selection
  (above) is designed; if ADR/decision relevance ends up graph-derived,
  ERG becomes load-bearing, not optional.

### Risks found, not yet resolved

- `state-keeper.ts`'s existing domain coupling (`TD-006`) means a brief
  command reading Coordinatorium state is reading through an interface
  that is already a little less generic than its own documentation
  claims — worth a quick look before building on it further, though
  COORDINATORIUM-002 confirmed this coupling didn't need to deepen for a
  same-shaped addition (checkpoints). A brief command is a *read-only*
  consumer, which is lower risk than another state-shape addition, but
  not zero risk if it ends up needing its own derived/cached view.
  - **Consider:** whether `monolith brief` should read `state.json` fresh
    each call (same pattern as `monolith validate`, simplest, always
    correct) rather than caching — caching would reintroduce exactly the
    kind of "two sources of drifting truth" problem this session's
    Documentation Synchronization work was created to prevent.
- No test or prior art in this repo yet establishes what "deterministic"
  means for a command that excerpts markdown prose (as opposed to
  Scriptorium's structural extraction, which is already proven
  deterministic) — if `monolith brief` ends up summarizing or truncating
  prose rather than only re-presenting structured fields, determinism
  needs to be designed in from the start, not assumed to transfer from
  Scriptorium's guarantees.

---

## Files in Flight

None. This session's commits:
- `093ea09` — `fix(init): protect existing gitkeep files`
- (this finalization + documentation-sync commit, created immediately
  after this file is written — see the session's final commit log)

Both are local only. Push to `origin/main` was explicitly authorized for
this session and performed after all checks passed — confirm
`git log -1` / `git status` against this file's claims if anything looks
inconsistent by the time you read this.
