---
type: reference
id: reference-cli
authority: authoritative
stability: volatile
---

# CLI Reference

Commands of the `monolith` CLI (`src/cli/index.ts`). MONOLITH `0.2.0-beta.2` is a
pre-release, published under the `beta` dist-tag
(`npm install -g @latysh-development/monolith@beta`; the previous alpha is
`@alpha`, see the
[README](../../README.md#quick-start)). From a clone, run `monolith` after
`npm link`, or `node dist/cli/index.js`. The examples below use `monolith`.

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
monolith governance # read-only governance integrity check: governance check [--json] [--strict] (implemented; see below)
monolith handover   # read-only autonomous-development handover: handover check [--json] [--strict] (implemented; see below)
monolith evidence   # verification evidence: run|report|list (implemented; see below)
monolith hook       # opt-in Claude Code hooks: session-start|stop|pre-compact|print-config (implemented; see below)
monolith ui         # Mission Control, read-only web dashboard [--port N] (implemented); first stdout line: `MONOLITH Mission Control: <url>`
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
monolith mission enroll [--agent <name>] [--session <id>] [--story <ID>] [--json]   # register or reuse this worktree's Mission (idempotent)
monolith mission current [--json]                      # this worktree's Mission; other contexts' active Missions
monolith mission handoff <id> --reason "..."            # explicit takeover of another context's Mission
```

Records missions and checkpoints in the operational state: by default one `state.json` shared by all Git worktrees in the Git common directory (`<git-common-dir>/monolith/state.json`); `.monolith/state.json` only outside Git or in isolated mode. `monolith brief` reports the location. Not runtime-enforced:
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
Boot Sequence in `AGENTS.md`. Its freshness check runs read-only, local, offline git
commands only: lazy fetch is disabled, so in a partial clone a missing object leaves
`UNKNOWN` instead of being downloaded. A shallow clone and git output that cannot be
parsed unambiguously are `UNKNOWN` too (details: `AGENTS.md` → Freshness). `--reconcile` prints a read-only report of the
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
monolith idea add --title "..." (--description "..." | --description-stdin) [--context "..."] [--path <document file> ...]
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
- **Independent knowledge (`--path`, alpha.4, KA-001; narrowed by A4-SEC-03):** `--path`
  (repeatable, at most 20) registers the **exact document files** of a knowledge artifact
  that belongs to no work item (e.g. a strategy paper). A registered path must be one
  file with a document extension (`.md .mdx .markdown .adoc`) and must lie
  **outside** the MONOLITH root. Well-known agent-instruction file names (`AGENTS.md`, `CLAUDE.md`, `SKILL.md`, ...),
  any path under a hidden (dot) directory and `node_modules` are refused too;
  this is a best-effort deny-list (other instruction files may exist), not a proof that a document is harmless. Directory prefixes (`src/`, `docs/`, `./`), source or
  configuration files (`src/pay.ts`, `package.json`) and anything under the MONOLITH root
  are refused by `idea add`; absolute paths, `..`, `.` or empty segments, quotes,
  backslashes and glob characters are refused as before. The field is stored as
  `paths: [...]` in the frontmatter (older readers ignore it, older files have none and
  are never rewritten).
  `monolith brief` then treats a commit as *explained* (not `UNATTRIBUTED_ACTIVITY`) only when
  **all** of these hold: its subject names no work item and at most 8 ideas; every idea it
  names is a valid idea **with `paths` in that commit's own tree**, whose paths all pass the
  rule above (registering later never legalises older commits; a commit that registers or
  edits the idea is not explained by it; a hand-edited idea with a broad path attributes
  nothing); **every** file the commit changes (state documents excepted) is exactly one of
  those paths; and none of them is inside the MONOLITH root. Such commits can support
  `Freshness: FRESH` but never touch the active story, a mission, the roadmap or any
  Definition of Done, and `brief --reconcile` lists them under "Attributed to registered
  independent knowledge" **together with the declared paths the attribution rests on**, and
  states why a commit that named an idea was *not* attributed. An idea without `paths`, an
  unknown id, an idea blob that is not available locally, or one extra file outside the paths
  leaves the previous behaviour untouched (`UNKNOWN`). **Attribution is not approval:** it only
  says a registered document explains the commit; it does not say the change was reviewed or
  permitted. Registering the idea is itself a commit inside the MONOLITH root, so it counts as
  ordinary activity until the next state-document commit; commit the registration together with
  a state-document update (e.g. HANDOFF) to avoid an `UNKNOWN` in between. At most 64 idea
  registrations are read per `brief` run (each is a git subprocess); beyond that commits stay
  unattributed.
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

`story.phase` is the phase directory name under `memory/working/phases/`: `[a-z0-9][a-z0-9-]{0,63}` (at most 64 characters, the same ceiling as story ids). It is used exactly as given in every step (`plan`, `apply`, the capsule path); it is never shortened or aliased, and a longer value is rejected.

Targets, in write order: story capsule (created, never overwritten),
`execution-history.md` (append), `story-index.md` (insert), optional
`docUpdates`, optional `HANDOFF.md`, and `active.md` last. Missing canonical
files are reported, never created. There is no rollback: an interrupted run is
reported as partial by `plan`, and `plan` + `apply` rolls it forward.

One story id is finalized once. History and index entries are recognised by the
heading `## <id> — …` / `### <id> — …` (id compared case-insensitively), and a
capsule by its `id: story-<id>` frontmatter in any phase; a repeat with other
title, slug or date is a `conflict` (nothing is written), an identical repeat is
`ALREADY_FINALIZED`. `expectedCurrentStory` is `"none"` or `{"contains": "…"}`
naming the story id; `"any"` is not accepted, so a proposal cannot replace an
unrelated active story. With `{"contains"}`, the active story is identified only by
the structural field: exactly one line `**Story:** <id> — <title>` (at line start, outside
code fences and `<!-- -->` comments) in `## Current Story`; its first token must equal the
proposal's story id, compared exactly (case-sensitive; `s-1` does not match `S-1`; the id is `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`,
text after it is free). The line must start at column 0 (no indent, list marker or quote). The
section runs from the `## Current Story` heading to the next heading or `---` line, so the
field must come before either. `monolith brief` only shows this section as an excerpt; it does
not validate the field. Ids in free text never count; a missing, duplicate, conflicting or
malformed field makes `expected-state` FAIL (plan `NOT_READY`, apply `REFUSED`) and
active.md is never rewritten automatically. An `active.md` that predates this field needs
that one line added by the owner before it can be finalized.

**Capsule formatting (alpha.4).** MONOLITH renders the Story Capsule in a layout that
Prettier's Markdown formatter leaves unchanged (a blank line after every heading); the
text you put into the proposal is passed through as-is, so a proposal whose own text
Prettier would rewrite (e.g. `*` bullets) is not covered. A capsule is created once and never
overwritten. An existing capsule counts as "already present" when it is byte-identical
**or** differs from the rendered form only in line endings (CRLF), trailing whitespace on a
line, a single blank line directly after a heading, or trailing blank lines at the end of the
file. Anything else (a changed word, a removed or merged paragraph break, a changed status,
appended text) stays a `conflict`. This is deliberately not a general whitespace-insensitive
comparison, and capsules written by earlier versions are recognised but never rewritten.
No formatter is run or required by MONOLITH.

**Capsule frontmatter (FIN-003).** The capsule's YAML frontmatter is a flat `key: value` list.
A formatter (e.g. Prettier with `singleQuote`) may rewrite `title: "X"` as `title: 'X'`; that is
the same string, so the capsule is still "already present". Frontmatter is compared by decoded
value, and the **only** representation difference ignored is the quoting style of a quoted
scalar (`"x"` vs `'x'`, with escapes decoded). Everything else is still a `conflict`: a changed
value (title, Story id, status, date), a missing, added, unknown or reordered field, a duplicate
key, a type change (`"1"` vs `1`, a quoted vs a plain scalar), a changed body, and any
frontmatter that is not a plain flat mapping (comments, trailing whitespace, block or flow
values, unterminated or malformed quoting), which is compared verbatim. This changes only how
an *existing* capsule is recognised: the approval digest, the plan/apply preconditions and the
create-only rule are unchanged, and MONOLITH never rewrites the capsule.

**State consistency (alpha.4).** `finalize` writes only the capsule, `execution-history.md`,
`story-index.md`, `active.md`, HANDOFF and the documents you list in `docUpdates`. It does not
own `roadmap-index.md`, so a roadmap row that still says `IN PROGRESS` for the story you just
finalized used to go unnoticed. `plan` and `apply` now report a `consistency` block
(also in `--json`): `CONSISTENT`, `INCONSISTENT` (each finding names the documents and, for
documents this finalization does not write, a remediation that is advice only) or
`NOT_VERIFIED` (a state document is missing or unreadable, or the active story cannot be
read). In `plan` it is projected from the text the plan would write; in `apply` it is read
from disk after the write. It uses the same rules as `monolith brief` (one shared
`findContradictions`), covers only active.md, roadmap-index.md and story-index.md, and never
changes the plan/apply status, the digest or the exit code, and never edits a document. A
roadmap row `IN PROGRESS` while no story is active is **not** reported: nothing defines
`IN PROGRESS` as "the active story", so that needs a human decision. To fix a drifting
external document within finalization, list it in `finalization.allowedDocs` and pass a
`docUpdates` entry.

A capsule left with two hard links by a process killed between `link()` and the
removal of its staging name is reported by `plan` as `FILE_HARDLINKED`. When the
second name is exactly that staging residue (same file, identical content, no
other links) `plan` names it and the command to remove it; MONOLITH never
deletes it itself, because the origin of a hard link cannot be proven. Remove
only that name, then run `plan` again. Any other hard link is reported as
untrusted and nothing is advised.

Integrity and governance preconditions are read from
`memory/working/integrity-result.md` and `governance-result.md`, and count only
when each has exactly one `**Status:** PASS`, exactly one `**Story:**` line
starting with the same story id and exactly one valid `**Date:**` (not after the
finalization date, at most 7 days before). Repeated or contradictory fields are
`NOT_VERIFIED`. It is the assistant's own report. MONOLITH does not run the
build or tests itself. The digest shows that the approved plan is unchanged; it
does not prove who approved it. Paths under `docUpdates` / `allowedDocs` may not
contain a `.git` component at any depth, in any letter case. Documents that must exist, and extra documents the
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
| `ADD` | A MONOLITH-owned file is missing (`AGENT.md`, `skills/idea-capture/SKILL.md`, `skills/finalize-story/SKILL.md`); created exclusively. |
| `UPDATE` | A managed block is appended to your file (every existing byte stays in place) or an **unedited** block is refreshed in place. The same verdict replaces a `finalize-story` skill that is **byte-identical** to a known older MONOLITH template (see below). Verified before writing; the file is re-checked just before the atomic replace. |
| `UNCHANGED` | Already installed and current (an older unmanaged routing/index entry also counts). |
| `CONFLICT` | Nothing is written to that file; the plan says how to resolve it and prints the block to add by hand. Causes: a block edited by you; malformed or duplicated managed markers (a damaged block); managed markers inside an HTML comment (the block would not be active); your own `AGENT.md` without markers; your own `Table 8` without `CAPTURE_IDEA`; a missing user file; a file that cannot be read safely; a file that is not valid UTF-8 (no encoding is converted; UTF-16 and binary files are refused too); a file that ends inside an unclosed ``` / ~~~ Markdown fence; or a file that ends inside an unclosed HTML comment (`<!--`), either of which would hide the new block; any `finalize-story` skill that is neither the current template nor a known older one (an edited one, or the current text in different bytes: CRLF, BOM, missing trailing newline), whatever it mentions: its compatibility with the Finalization Contract is **not verified** (DOGFOOD-005). |
| `SKIP` | Left alone on purpose (an existing differing `idea-capture` skill; the optional semantic-map rows). Never used for `finalize-story`. |

**`finalize-story` skill (contract drift).** `monolith finalize plan` / `apply` is the only supported
way to finalize a story, and the current skill says so and forbids finalizing by hand. An instance
created before that carries a skill that describes manual Markdown steps, which an assistant may
keep following. `update` classifies the installed skill by exact content, never by a phrase it
contains:

| Installed `skills/finalize-story/SKILL.md` | Verdict |
| --- | --- |
| missing | `ADD` (current template) |
| identical to the current template | `UNCHANGED` |
| byte-identical to a known older MONOLITH template (`0.1.0-alpha.0` … `alpha.2`; list in `src/update/legacy-skills.ts`) | `UPDATE`, replaced by the current template on `--apply` (nothing of yours is in it) |
| anything else: edited by you (whether or not it mentions `monolith finalize plan` / `apply`), or the current text in different bytes (CRLF, BOM, no trailing newline) | `CONFLICT`: kept byte-for-byte; compatibility with the Finalization Contract is **not verified**; the plan says to merge the template's "Deterministic Execution" section or to rename your file and re-run |

Since DOGFOOD-005 (`0.1.0-alpha.3`) a customized `finalize-story` skill is never `SKIP`: naming the two
CLI commands does not prove the rest of the file forbids manual finalization or an approval bypass, so
the integration is reported `INCOMPLETE` and `--apply` exits `2` until the file equals the current
template (or you rename it and let `update` install the current one). Earlier releases reported such a
file as `SKIP` and the integration as `COMPLETE`. A deliberately customized skill therefore keeps the
instance at `INCOMPLETE`; there is no acknowledgement mechanism (by design: no heuristic can vouch for it).

The skill text is only classified: it is not executed and not trusted as authority. This is an
instruction-level control: nothing technically prevents an assistant from editing Markdown directly.
When a later release changes this skill, the then-current text is added to that list so an
unedited copy keeps updating. `monolith validate` does not look at skill content.

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

## `monolith governance`

```bash
monolith governance check [--json] [--strict]
```

Read-only report on the quality of the governance documents. It writes nothing, creates no
state file, needs no LLM and gives the same output for unchanged files. It reuses Core's own
readers (roadmap, story index, story state, ADR, hypotheses, ideas, missions) and
`monolith validate`'s scaffold checks, plus a minimal structural check of story capsules
(frontmatter `type/id/phase/title/date/status`, the seven sections `finalize` writes, leftover
placeholders, literal `\n`). Areas: Instance structure, Roadmap, Active Story, Story Index,
Story Capsules, ADR, Hypotheses, Missions, Ideas — each `PASS`, `EMPTY`, `AVAILABLE`, `ABSENT`,
`ISSUES` or `NOT CHECKED`. Findings are `INFO`, `WARNING` or `ERROR`; an empty story index, no
capsule, no ideas or no ADR directory are `INFO`, never problems. The format of each document is
described in `.monolith/protocols/governance/document-formats.md`.

| Exit | Meaning |
|---|---|
| 0 | the check ran (findings are printed; they do not change the code) |
| 1 | usage error |
| 2 | `--strict` and at least one `WARNING` or `ERROR` (opt-in; `INFO` never counts) |
| 3 | the check itself could not be executed |

`monolith validate` is unchanged: it checks the installed scaffold and still passes when document
contents are malformed. `governance check` is never a precondition of `monolith finalize`.

**Workflow integrity (Mission → Story).** The *Missions* area also checks the story link a mission
records (`monolith mission start --story <ID>`), against the Story State Resolver's facts only:

| Code | Severity | Meaning |
|---|---|---|
| `MISSION_STORY_UNKNOWN` | WARNING | the mission's story is listed by none of the roadmap, `active.md` and `story-index.md`, **and all three were read**. An unreadable document produces no finding (the fact is UNKNOWN, not "absent") |
| `MISSION_ACTIVE_ON_FINALIZED_STORY` | WARNING | a mission is `in_progress` on a story `story-index.md` reports finalized |

Not errors, on purpose: a mission without a story link (exploratory work), a finished mission whose story
is not finalized (finalization is a separate, owner-approved step), and a story whose index entry says
`READY FOR REVIEW`. Stories do not point to missions in this model, so there is no "story names a missing
mission" check. The link is recorded, never verified; the exit codes above are unchanged.

## `monolith handover`

```bash
monolith handover check [--json] [--strict]
```

Read-only report of what autonomous work left behind, built only from sources Core already owns:
the roadmap, `story-index.md`, `active.md` (through the Story State Resolver), Development History
(missions and checkpoints), ADR frontmatter, `monolith governance check`, recorded verification
evidence and read-only `git` (HEAD and working tree). It writes nothing, **runs no test**, makes no
network or LLM call and is reproducible: unchanged files, git state and evidence give the same output.
It never finalizes a story, closes a mission, creates an approval or commits.

Sections: Project (name, active phase, current story, governance result) · Development progress
(planned / active / finalized / listed-not-final kept apart; "awaiting review" only when `story-index.md`
itself says `READY FOR REVIEW`) · Mission history (completed / failed / cancelled / active, checkpoints,
missions without a story link, active missions without a checkpoint) · Architecture decisions (accepted,
proposed, other statuses verbatim, unrecognised files, missing metadata) · Verification evidence ·
Outstanding issues (`conflict`, `unverified`, `attention`) · Owner decisions required (a story with completed
missions that is not finalized; ADRs declared `proposed`; contradicting documents) · what the report does not establish.

| Status | Meaning |
|---|---|
| `READY FOR REVIEW` | every core source was readable and nothing needs attention before a human reviews |
| `REVIEW WITH ISSUES` | reviewable, but issues are listed (governance findings, failed or stale evidence, completed work without VERIFIED evidence, failed or unfinished missions, a dirty working tree) |
| `INCOMPLETE` | a core source (state, roadmap, story index, active story, ADRs) is missing or unreadable, or no story is known — an empty instance is INCOMPLETE |
| `UNKNOWN` | the instance could not be established (corrupt or unsafe configuration) |

The status is about reviewability. It is never "correct" or "production ready", and `READY FOR REVIEW` with no
issues listed does not mean the project is correct. A completed mission does not mean a finalized story; a
reported PASS is not verification.

`--json` prints the stable `HandoverReport` (`schema: 1`; fields are only ever added): `status`, `statusReasons`,
`project`, `progress` (with per-story `planned` / `active` / `finalization` kept as separate facts), `missions`,
`architecture`, `verification` (counts per level, items, git view), `outstanding`, `sources`, `limitations`.

| Exit | Meaning |
|---|---|
| 0 | the check ran |
| 1 | usage error |
| 2 | `--strict` and the status is not `READY FOR REVIEW` (opt-in; no global gate) |
| 3 | the check itself could not be executed |

## `monolith evidence`

```bash
monolith evidence run [--story <STORY-ID>] [--timeout-sec N] -- <command> [args...]
monolith evidence report --command "<text>" --result pass|fail [--story <STORY-ID>] [--note "..."]
monolith evidence list [--json]
```

Verification evidence is a small JSON file per check, `<monolithRoot>/memory/long-term/verification/EVD-NNNN.json`
(git-tracked project knowledge, like ideas; **not** part of Durable State or `finalize`, whose contracts are unchanged).
Fields: story id, command, result, exit code, provenance, recorded time, git HEAD, dirty-tree flag, source, an optional
note. Nothing else is stored — **no command output** — and obvious secrets in the command line or note (tokens,
`KEY=…`, bearer values, URL passwords, long opaque strings) are redacted on a best-effort basis.

- `run` executes the command itself (argv, **no shell**, inherited stdio, default timeout 30 min) and records its exit
  status as **OBSERVED**; its own exit code is the command's, so it can gate a script. A command that cannot start
  records nothing. If HEAD changed while the command ran, no revision is recorded (freshness UNKNOWN).
- `report` records a statement as **REPORTED**. It carries no exit code and is never verification.
- **VERIFIED** is never stored; it is the level `handover check` computes: an OBSERVED pass whose recorded revision
  still equals HEAD (or differs only by evidence files) on a clean working tree, clean also when recorded.

| Level | Rule |
|---|---|
| `VERIFIED` | OBSERVED, passed, revision still current, clean tree then and now |
| `REPORTED` | a statement (an agent said so); MONOLITH did not observe it |
| `STALE` | HEAD moved with non-evidence changes since the check ran — potentially stale |
| `UNKNOWN` | no git, no recorded revision, unreachable revision, or a dirty tree (then or now) |
| `FAILED` | the check failed |

Freshness limits: a matching revision shows only that the committed files are the same, not that the command is an
adequate check; a dirty tree is never ignored (evidence files themselves are excluded from "dirty" and from "changed");
without git every record is UNKNOWN; evidence recorded on another clone whose commit is unknown here is UNKNOWN, not stale.

Records are only ever added by the CLI (no edit or delete command), but the store is **not tamper-evident**: editing or
removing a file by hand is not detected by `handover check`. See `docs/reference/security-and-limitations.md`.

## `monolith hook`

```bash
monolith hook session-start   # SessionStart: prints additionalContext JSON
monolith hook stop            # Stop: diagnostic systemMessage only, never blocks
monolith hook pre-compact     # PreCompact: plain-text instructions for the compaction summary; never blocks
monolith hook print-config    # prints an opt-in settings snippet; writes nothing
monolith hook print-config --managed   # + fail-closed PreToolUse hook for Managed Execution
monolith hook pre-tool-use    # PreToolUse (Managed Execution only; no-op in unmanaged projects)
monolith hook status          # honest report: execution mode + whether the hook is installed (exit 2 if unconfirmed)
```

Managed Execution (`"execution": {"mode": "managed"}`), Mission enrollment, ownership, handoff and their limits are
described in [Managed Execution](./managed-execution.md). In an unmanaged project nothing in this section writes anything.

Hooks are **opt-in**; MONOLITH never edits Claude Code settings. Copy the snippet from
`monolith hook print-config` into the project's `.claude/settings.json` (or your own settings)
yourself and merge it with hooks you already have. Verified against Claude Code 2.1.329
(events `SessionStart`, `Stop`, `PreToolUse`, `PostToolUse`; JSON on stdin; `hookSpecificOutput.additionalContext`
and `systemMessage` on stdout; `PreCompact`: its plain stdout is added to the compaction instructions, while
`systemMessage` is discarded). Only `SessionStart`, `Stop` and `PreCompact` are used: no per-tool-call work.
Existing installations of the two-hook snippet keep working unchanged; `PreCompact` is added by merging the new snippet.

- *session-start* injects a compact **recovery packet** computed by Core (`src/handover/recovery.ts`; the hook is only an
  adapter): project, active story, active mission(s), the last relevant checkpoint (of an active mission, else the newest
  of any mission, flagged as such) with its remaining steps *labelled historical, not the current plan*, git HEAD and
  working-tree state, evidence counts, governance findings and ADRs declared `proposed`. Each line names its source; a
  missing source is `UNKNOWN`, never a guess. Bounded: at most 3 missions, 5 steps, 6 findings, 160 characters per text and
  3500 characters in total. Nothing is written.
- *pre-compact* prints what must survive compaction (active story and mission, last checkpoint) and reminds the agent to
  record progress made since the last checkpoint with `monolith mission checkpoint` — only facts. It records nothing
  itself, prints nothing when there is nothing to preserve, never exits with 2 and never returns `decision`; it is not
  a guarantee of saved state if the agent is terminated abruptly.
- *stop* mentions an unfinished mission, a dirty working tree while a mission is open, a mission without any checkpoint,
  or governance issues, and points to `monolith handover check`. It never returns `decision`,
  `continue: false` or exit code 2, and does nothing when `stop_hook_active` is true (no loop).
- Fail-safe: a missing CLI (the snippet guards with `command -v … || true`), a fault or a
  hook started by a hook (`MONOLITH_HOOK_ACTIVE=1`) ends silently or with a short message;
  nothing is written and the session is never stopped. The only blocking hook is `pre-tool-use` in a project that opted into Managed Execution.

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
Once listening it prints a launch block. Its **first stdout line is unchanged from
alpha.3**, `MONOLITH Mission Control: http://127.0.0.1:<port>` (`ui dev`:
`MONOLITH Mission Control (dev, HMR): <url>`), so scripts that parse it keep working;
`Status: READY`, the URL on its own line, the project and how to stop follow. Later
lines are for people and may change; failures go to stderr with a non-zero exit code.

`monolith ui dev` is for working on the interface: it starts the same API on
a free loopback port and a Vite dev server (hot module reload) that proxies
`/api/dashboard` to it. It needs a source checkout with devDependencies
installed and exits with an error otherwise. `--port` sets the Vite port.

- `--host` is deliberately **not** supported (the server is loopback-only).
- Errors (not a MONOLITH project, bad or busy port, unknown argument, missing UI build) print one line and exit `1`.
- A browser is never opened automatically.

Interface description: [Mission Control](./mission-control.md).
