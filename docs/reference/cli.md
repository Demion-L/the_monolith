---
type: reference
id: reference-cli
authority: authoritative
stability: volatile
---

# CLI Reference

Commands of the `monolith` CLI (`src/cli/index.ts`). MONOLITH is an alpha
package and is **not published to npm**; build it from a clone (see the
[README](../../README.md#quick-start)) and run `monolith` after `npm link`, or
`node dist/cli/index.js`. The examples below use `monolith`.

`monolith --help` is the authoritative usage text; `AGENTS.md` records scope.

## Command status

```bash
monolith init       # scaffold a new instance from templates/ (implemented)
monolith validate   # check instance integrity (implemented, see below)
monolith mission    # Tactical Coordinatorium: start|list|show|finish|checkpoint|checkpoints (implemented, experimental, ADR-008)
monolith brief      # deterministic, read-only project-state summary [--max-chars N] [--strict] [--reconcile] (implemented)
monolith idea       # capture and recall deferred ideas: add|list|show (implemented, IDEA-001A)
monolith update     # bring an existing instance up to the agent entry point + Idea Capture [--apply] (implemented, DX-UPDATE-001/003)
monolith durable    # Durable State: list|show|assess|packet|verify|retention (implemented; see below)
monolith ui         # Mission Control, read-only web dashboard [--port N] (implemented)
monolith ui dev     # Mission Control with Vite hot reload [--port N] (implemented, source checkout only)
monolith status     # active protocol, phase, story, drift summary (NOT implemented)
monolith dry-run    # simulate finalization gate without writes (NOT implemented)
```

`status` and `dry-run` currently print `not yet implemented` and exit 1.

## `monolith init`

Scaffolds a new MONOLITH instance into `process.cwd()`. There is no
positional target-directory argument — `cd` into the directory you want to
scaffold first. Any positional argument or unrecognized flag is a hard
error (non-zero exit), never silently ignored.

`init` refuses to run — before writing anything — if any file it would
write already exists (`AGENTS.md`, `monolith.config.json`, any file under
the target `.monolith/`, the AI-tool instruction file, etc.), listing the
conflicting paths. `--yes` only skips the interactive prompts for project
metadata on an otherwise-clean directory; it does not authorize overwriting
existing data, and re-running `init` against an already-initialized project
is refused rather than treated as an upgrade. The one exception is
`.monolith/state.json` (Coordinatorium runtime data, ADR-008), which is
never written to if it already exists and is not treated as a conflict.

Writes are safe against pre-existing links (SEC-001B.2, ADR-012): `init`
refuses a symlink — including a dangling one — at a target or in any parent
directory (even one that stays inside the project), a FIFO or other special
file, and a file that appears after the preflight; files are created without
overwriting and each becomes visible only once completely written. `init` as a
whole is **not** atomic and does not coordinate two concurrent runs: files
published before a failure stay.

## `monolith validate`

Checks that the current directory contains a valid MONOLITH instance. Three
checks run in sequence:

| Check | What it verifies |
|---|---|
| Configuration | `monolith.config.json` present, valid JSON, a valid contained `monolithRoot`; `project.definition.mjs` present as a file (see below) |
| Instance | All required directories exist under `monolithRoot` |
| Templates | No unreplaced init-time placeholders (`{{VAR}}`) left in generated files |

**Filesystem contract: read-only.** `validate` only opens files for reading and
lists directories (confirmed with `strace`: no write-mode `open`, no `mkdir`,
`unlink` or `rename`). It creates no directories or temporary files, never
modifies project state, and cannot be redirected to another directory (it always
uses the current working directory). The only output is on stdout. When it sees
leftovers of an interrupted write in `monolithRoot` (`state.json.tmp.*`,
lock staging files) it prints a warning but never deletes them.

Exit codes: `0` = PASS, `1` = FAIL. Use `--quiet` for CI (prints nothing on PASS, errors only on FAIL).

**`validate` never executes project code (SEC-002, ADR-011).** `project.definition.mjs`
is checked **as a file only**: it exists, stays inside the project (any symlink in
its path is a FAIL, ADR-014), is a regular file (a FIFO or device is a FAIL and is
never opened for reading), is non-empty, and is at most 1 MiB. It is not
imported, evaluated or parsed as JavaScript, so a PASS says **nothing** about
its syntax, whether it exports `PROJECT_DEFINITION` (that check was removed),
whether its content is safe, or whether it could be executed. A successful
non-quiet run prints a note saying exactly this. `monolith.config.json` and
`AGENTS.md` are read through the same bounded, strict reader
(1 MiB cap, no blocking on FIFOs, no symlinks — ADR-014). Residual risk: path checks and `open()` are
separate syscalls, so a local attacker racing a path swap is not stopped
(SEC-001B, open).

```
MONOLITH validate

Configuration   PASS
Instance        PASS
Templates       PASS

Result: PASS
```

**What `monolith validate` does _not_ check yet:** `project.definition.mjs`
declares several fields — `requiredFinalizationDocs` (superseded by `monolith.config.json` `finalization.requiredDocs`, see `monolith finalize`), `requiredRootArtifacts`,
`driftLogPath`, `forcedInjectionTerms`, `mistakeRoots` — that describe a
richer integrity contract (required finalization documents, required root
artifact IDs, a drift log). None of these are currently read or enforced by
`src/validate/index.ts`; they are a declared-but-unconsumed contract reserved
for a future enforcement engine. See `project.definition.mjs` for inline
notes on which of its own fields are currently unenforced.

## `monolith mission`

```
monolith mission start --title "..." --system "..."
monolith mission list
monolith mission show <id>
monolith mission finish <id> --result completed|failed|cancelled [--summary "..."]
monolith mission checkpoint <missionId> --summary "..." [--remaining "..." ...] [--context "..."]
monolith mission checkpoints <missionId>
```

Records missions and checkpoints in `.monolith/state.json`. Not runtime-enforced:
it is a recommended discipline, not a gate. Rationale and checkpoint semantics:
[ADR-008](../adr/ADR-008-coordinatorium-tactical-mission-lifecycle.md) and
`AGENTS.md` → Mission Lifecycle.

`mission start|finish|checkpoint` refuse a symlinked `.monolith` (or any
symlinked component) and a `state.json` that has other hard links; replace the
link with a real directory/file first. If `monolith.config.json` exists but is
corrupted, `mission *` refuses (fail closed) rather than writing to the default
`.monolith`.

## `monolith brief`

```bash
monolith brief [--max-chars N] [--strict]
monolith brief --reconcile [--max-chars N]
```

Prints a compact, deterministic summary of current project state: State
Keeper status, active missions and their latest checkpoints (with next
steps), mandatory protocols, the current story excerpt from
`.monolith/memory/working/active.md`, and accepted ADRs. Each section names
its source. It is strictly read-only (no files created, `state.json` read
once, no LLM or network), and it supplements — does not replace — the
Boot Sequence in `AGENTS.md`. `--reconcile` prints a read-only report of the
evidence behind the Freshness verdict. Full specification: `AGENTS.md` → Project Brief.

- The first line is `Completeness: COMPLETE` or `INCOMPLETE`. INCOMPLETE
  means information was lost or could not be read (corrupted/empty
  `state.json`, corrupted `monolith.config.json`, an unreadable or
  out-of-project document directory, or content that did not fit the
  budget); the Diagnostics section says why.
- `--max-chars N` sets the budget (default 6000). Mandatory content is never
  truncated; if it alone exceeds the budget it is shown in full and flagged.
- **Parked Ideas:** when the instance has ideas with `status: inbox`, the brief
  ends with a `Parked Ideas (N)` section: the three newest (highest numeric id
  first; never by file time) as `IDEA-NNN  title`, `+K more ideas` for the rest,
  and the pointer `monolith idea list`. `planned` and `archived` ideas are not
  shown (`idea list` / `idea show` still cover every status). Only ids and titles
  are shown, never descriptions; titles are escaped and cut to 80 characters. It
  is the lowest-priority section: under a small `--max-chars` it lists fewer
  ideas, then only the count, then a one-line marker, then nothing. Unlike every
  other section this degradation does **not** make the brief INCOMPLETE, so saving
  an idea cannot break `--strict` checks of the project context; it never
  displaces another section. An instance
  without `inbox` ideas renders exactly as before. The brief reads ideas through
  the Idea Capture reader (bounded; symlinks, hardlinks and special files are
  refused) and writes nothing — no directory, no `.ids` marker, no status change.
  An idea file that cannot be read is skipped and reported as an
  `IDEAS_UNREADABLE` warning (it does not by itself make the brief INCOMPLETE).
  Idea text is untrusted data: escaping keeps it from forging brief structure, it
  does not make it safe to obey. Nothing reminds you of ideas anywhere else.
- Exit codes: `0` brief formed, `1` usage error, `2` `--strict` and INCOMPLETE.
- Extra ADR directories can be listed in `monolith.config.json` under
  `contextGateway.adrDirs` (relative to the project root; this repository
  uses `["docs/adr"]`).
- `monolithRoot` must be a relative path inside the project root (ADR-009,
  SEC-001A; TOCTOU tracked as SEC-001B, open). An absent `monolith.config.json`
  means the default `.monolith`.
- `monolith context <topic>` is not implemented.

## `monolith idea`

```
monolith idea add --title "..." (--description "..." | --description-stdin) [--context "..."]
monolith idea list
monolith idea show <id>
```

*Capture now. Continue working. Recall later.* Saves a thought that came up
while working on something else, without changing the current task. An idea is
not a task, not a hypothesis and not a Durable State record; it need not ever
become anything.

- **Storage:** one Markdown file per idea, `<monolithRoot>/memory/long-term/ideas/IDEA-NNN.md`
  (`monolith init` creates the directory; `idea add` creates it in an existing
  instance that predates it). Frontmatter (`type: idea`, `id`, `title`, `status`,
  `createdAt`, optional `context` and `tags`) followed by `## Description` and
  the text exactly as given. Strings are JSON-quoted, so quotes, newlines and
  non-ASCII survive; a person can edit a file by hand (a plain unquoted value is
  accepted). Files are meant to be committed.
- **Status:** `inbox` (set on creation), `planned`, `archived`. There is no
  status command yet and nothing changes status automatically (follow-up
  `IDEA-STATUS-001`, `tech-debt.md`). Until then a *person* may change the
  `status:` line by hand; an AI assistant must not edit idea files, it only uses
  `monolith idea add|list|show` (routing intent `CAPTURE_IDEA`, `routing-map.md`
  Table 8). Prefer `archived` to deleting a file.
- **Ids:** `IDEA-001`, `IDEA-002`, … (three digits, more when needed). The next
  number is only a candidate: the file is created exclusively (`link()`), and if
  another process took the number first, the next one is tried, so two
  concurrent `idea add` runs never publish the same id and never overwrite each
  other. Ids are **permanently reserved**: before the idea file is written, an
  exclusive marker `ideas/.ids/IDEA-NNN` is created and the next id is
  `max(idea files, markers) + 1`. Deleting an idea file therefore never frees its
  id; a crash between marker and file leaves an orphaned marker, i.e. a gap in the
  numbering, never a reused id. Ideas created before reservations existed get their
  marker on the next `add`. There is no shared counter file and no lock. Deleting the
  `.ids` directory by hand forgets the reservations of already-deleted ideas.
- **Description from stdin:** `monolith idea add --title "..." --description-stdin`
  reads the description from standard input instead of the command line, so it
  never passes through the shell's argument parsing. The text is stored byte for
  byte (UTF-8; no trimming, BOM and CRLF kept). Refused, with nothing written:
  more than 400 000 bytes (reading stops there), invalid UTF-8, a read error,
  empty or whitespace-only input, a terminal as stdin, and combining it with
  `--description`. The text is never interpreted by MONOLITH; whether the *caller's*
  shell is safe is the caller's concern (an assistant uses the `idea-capture` skill).
- **Input:** `--title` is one line (at most 300 characters, no control
  characters); `--description` at most 100 000 and `--context` at most 20 000
  characters. The stored file (frontmatter and body, in UTF-8, after escaping) is
  also capped at 262 144 bytes, the same cap the reader applies, so an idea that
  was saved can always be read back; text that fits the character limits but not
  the byte cap (for example about 87 000 or more CJK characters) is refused with
  `IDEA_INVALID_INPUT` before an id is reserved. Empty or whitespace-only values,
  unknown or repeated flags and stray arguments are refused before anything is written.
- **`list`:** ordered by number; shows id, status, title. Prints `No ideas.` when
  empty. A file that cannot be read as an idea is listed as `[unreadable]` with
  the reason, left untouched, and makes the command exit 2.
- **`show <id>`:** prints the full content. Unknown id: `No idea IDEA-NNN.`;
  malformed id: error; unreadable file: error naming the reason. Exit 1.
- **Writes:** `add` creates exactly one new file. `list` and `show` write nothing.
  Neither touches `active.md`, `state.json` or any mission.
- **Safety:** reads and writes use the same safe-file primitives as `state.json`
  (`src/root/`): the instance root is contained in the project, a symlink in any
  component of the path is refused (also one that stays inside the project), an
  existing file is never overwritten, a hard-linked or special file is not read.
  A concurrent swap of directories by another local actor is **not** defended
  against (SEC-001B.3; threat model TM-C is unsupported).
- No LLM, network, search, reminders or automatic idea detection. Library entry:
  `import { ideas } from '@latysh-development/monolith'`.

## `monolith finalize`

```
monolith finalize plan  --proposal <file|-> [--json]
monolith finalize apply --proposal <file|-> --approve <digest> [--json]
```

Closes a story through a checked, owner-approved transition (DOCSYNC-001,
[ADR-022](../adr/ADR-022-deterministic-story-finalization.md)). The assistant
writes a JSON proposal; MONOLITH decides whether and where it can be applied.

- `plan` is read-only. It reports each precondition as `PASS`, `FAIL` or
  `NOT_VERIFIED` (an unverified check is never a pass), each write target
  (`pending` / `done` / `conflict` / `missing` / `unreadable`) and a **digest**
  that fingerprints the proposal, every target's current bytes and the evidence
  inspected. Exit 0 when `READY` or `ALREADY_FINALIZED`, 2 when `NOT_READY`.
- `apply` re-plans under a cross-process lock and writes only if the digest
  still matches (`--approve` is the owner's approval of exactly that plan).
  Exit 0 `FINALIZED` / `ALREADY_FINALIZED`; 2 `REFUSED` (nothing written);
  3 `INCOMPLETE` (partially applied: the story is **not** finalized).

Targets, in write order: story capsule (created, never overwritten),
`execution-history.md` (append), `story-index.md` (insert), optional
`docUpdates`, optional `HANDOFF.md`, and `active.md` last. Missing canonical
files are reported, never created. There is no rollback: an interrupted run is
reported as partial by `plan`, and `plan` + `apply` rolls it forward.

Integrity and governance preconditions are read from
`memory/working/integrity-result.md` and `governance-result.md`, and count only
when they say `**Status:** PASS` for the same story id. MONOLITH does not run
the build or tests itself. Documents that must exist, and extra documents the
proposal may edit, are declared in `monolith.config.json`:

```json
{ "finalization": { "requiredDocs": [{ "path": "docs/current-state.md", "label": "Current state" }],
                    "allowedDocs": ["README.md"] } }
```

`requiredFinalizationDocs` in `project.definition.mjs` is **not** read (that
file is JavaScript and is never executed); use `finalization.requiredDocs`.

## `monolith update`

```
monolith update            # preview: shows the plan, writes nothing
monolith update --apply    # performs the ADD / UPDATE items
monolith update --help
```

Brings an **existing** instance up to the current agent integration (DX-UPDATE-001/003). It does
not initialise a project (`monolith init` does) and is not a migration system.

**Architecture.** `CLAUDE.md` / `AGENTS.md` (and `.cursorrules` / `.windsurfrules` when present)
carry one managed pointer to `<root>/AGENT.md`; `AGENT.md` tells the assistant to open
`skills/INDEX.md`, read the matching `SKILL.md`, and holds the Idea Capture rules. A new skill
changes `INDEX.md` / `AGENT.md`, never the root files again. `monolith init` writes the same
managed blocks. Behavior verified with Claude Code (it reads `AGENT.md`, then the skill, then runs
`monolith idea add`); other assistants rely on the vendor's documented instruction files
(`AGENTS.md` for Codex, `.cursorrules`, `.windsurfrules`) and are not verified here.

**Managed blocks.** MONOLITH text lives only between
`<!-- monolith:begin <id> sha256=<16 hex> -->` and `<!-- monolith:end <id> -->`. The checksum of
the body is how an unedited block is told from an edited one without any stored template
version. Markers inside fenced code are examples, not blocks.

| Verdict | Meaning |
| --- | --- |
| `ADD` | A MONOLITH-owned file is missing (`AGENT.md`, `skills/idea-capture/SKILL.md`); created exclusively. |
| `UPDATE` | A managed block is appended to your file (every existing byte stays in place) or an **unedited** block is refreshed in place. Verified before writing; the file is re-checked just before the atomic replace. |
| `UNCHANGED` | Already installed and current (an older unmanaged routing/index entry also counts). |
| `CONFLICT` | Nothing is written to that file; the plan says how to resolve it and prints the block to add by hand. Causes: a block edited by you; malformed or duplicated managed markers (a damaged block); managed markers inside an HTML comment (the block would not be active); your own `AGENT.md` without markers; your own `Table 8` without `CAPTURE_IDEA`; a missing user file; a file that cannot be read safely; a file that is not valid UTF-8 (no encoding is converted; UTF-16 and binary files are refused too); a file that ends inside an unclosed ``` / ~~~ Markdown fence; or a file that ends inside an unclosed HTML comment (`<!--`), either of which would hide the new block. |
| `SKIP` | Left alone on purpose (an existing differing `idea-capture` skill; the optional semantic-map rows). |

`COMPLETE` is a structural statement, not a promise about an AI model: it is reported only when
nothing is left to add, change or resolve **and** the static consistency check passes: instructions → `AGENT.md` → skills index → routing → skill → CLI call →
ideas store. Nothing is executed, and what an assistant does with the text is not verified. Older unmanaged
routing/index entries count as installed only when they are the known historic table rows, not a
mere mention of `CAPTURE_IDEA`. `--apply` exits `0` when complete, `2` when it is not
(conflicts, or a change skipped because its file changed after planning), `1` on an error.

Apply order: skill and `AGENT.md` first, the pointer in root instruction files last, so an
interrupted run never points at something missing; a re-run finishes it. It re-plans before
writing and skips any item whose file differs from what was previewed.

Known limitations (documented, not fixed here):
- Instances created at `6bb4045` carry an older Table 8 `CAPTURE_IDEA` row whose `|` inside the
  command is not escaped (`\|`), so GitHub-flavored Markdown renders it with extra cells. Current
  templates (and new instances) escape it. `update` recognises the old row as installed and does not
  rewrite it, because it lies outside a managed block; fix it by hand by writing `\|`.
- Unmanaged text is matched structurally (the known table rows), not by meaning. A file that
  contradicts the managed text elsewhere (for example another rule for saving ideas) is not detected.
- Only strict UTF-8 is supported for files `update` may write; no encoding is detected or converted. A leading UTF-8 BOM is accepted and ignored when scanning the first line (fences, comments, markers); only the first line is treated this way.
- Fences are recognised for ``` and ~~~ (up to 3 spaces of indent); fences nested in lists or
  block quotes are not tracked, and the post-write check refuses any result it cannot read back.

What it will not do: overwrite your files or skills, edit text outside a managed block, touch
`active.md`, `decisions.md`, `state.json`, roadmap, stories, idea files or `ideas/.ids/`, follow
symlinks or hardlinked files, or write outside the project root. It is not transactional and not
coordinated between simultaneous runs (SEC-001B.3; concurrent runs converge on the same result in
testing); TM-C is not claimed.

## `monolith durable`

```
monolith durable list [--status active|completed|failed|cancelled]
monolith durable show|assess|packet <taskId>
monolith durable verify [taskId]            # exit 2 if a log fails verification
monolith durable retention --retain-days N [--compact-after N] [--apply]
```

Inspects and maintains Durable State task logs (hash-chained, crash-safe).
Durable State is merged but its security acceptance is still open; see
`AGENTS.md`, [ADR-017](../adr/ADR-017-durable-execution-state.md),
[ADR-018](../adr/ADR-018-durable-state-failure-model.md) and
[Durable State Retention Safety](../architecture/DURABLE-STATE-RETENTION-SAFETY.md).

## `monolith ui`

```bash
monolith ui [--port N]       # default port 4173
monolith ui dev [--port N]   # default port 5173 (Vite)
monolith ui --help
monolith ui dev --help
```

`monolith ui` serves the prebuilt Mission Control (`dist/ui`) and the
read-only `GET /api/dashboard` API from one server on `127.0.0.1`, for the
project in the current directory. It needs neither Vite nor any
devDependency (`dist/ui` is tracked in Git and listed in the package `files`).
Ctrl+C or SIGTERM stops it and frees the port.

`monolith ui dev` is for working on the interface: it starts the same API on
a free loopback port and a Vite dev server (hot module reload) that proxies
`/api/dashboard` to it. It needs a source checkout with devDependencies
installed and exits with an error otherwise. `--port` sets the Vite port.

- `--host` is deliberately **not** supported (the server is loopback-only).
- Errors (not a MONOLITH project, bad or busy port, unknown argument, missing UI build) print one line and exit `1`.
- A browser is never opened automatically.

Interface description: [Mission Control](./mission-control.md).
