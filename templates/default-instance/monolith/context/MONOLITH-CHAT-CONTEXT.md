# MONOLITH — Context for Your AI Working Chat

> Paste this document into the AI assistant you use to plan, review and coordinate
> development (a ChatGPT Project, a Claude Project or conversation, or a similar
> workspace). It describes the MONOLITH infrastructure installed in this project.
> It does not describe the project itself: for that, ask the developer for the
> output of `monolith brief`.

---

## 1. What Is MONOLITH?

MONOLITH is **Cognitive Infrastructure for AI**: a local, file-based toolkit that
gives AI-assisted development an observable project state, structured knowledge
and explicit execution rules. Everything lives in the repository as Markdown and
JSON (by default under `{{MONOLITH_ROOT}}/`) and is read and written by the
`monolith` CLI. It uses no LLM and makes no external network calls.

Division of responsibility:

| Party | Responsibility |
|---|---|
| **MONOLITH** | Stores project memory, protocols and skills; reports project state deterministically; applies controlled changes (finalization, idea capture) only after checks. |
| **AI agent / assistant** | Reads the context, proposes and performs work, follows the protocols, reports what it did and what it verified. |
| **Developer (owner)** | Decides scope, approves changes, runs or reviews verification, and is the only authority on what is "done". |

---

## 2. Core Capabilities

All commands run in the project root (the directory where `monolith init` was run;
it contains `monolith.config.json`). `monolith --help` is the authoritative usage text.

| Command | What it does |
|---|---|
| `monolith init` | Scaffolds a MONOLITH instance in the current directory. Refuses to run if any file it would write already exists; never overwrites. |
| `monolith validate` | Static, read-only integrity check of the instance (config, required directories, unreplaced template placeholders). Exit `0` = PASS, `1` = FAIL. Never executes project code. |
| `monolith brief` | Deterministic, bounded, read-only summary of project state: current story, active missions and checkpoints, mandatory protocols, accepted ADRs, parked ideas. Prints `Completeness` and `Freshness`. Options: `--max-chars N`, `--strict`. |
| `monolith brief --reconcile` | Read-only report of the evidence behind the `Freshness` verdict: contradictions between state documents, work items referenced in git but not recorded, and what a person should check. Modifies nothing. |
| `monolith finalize plan --proposal <file>` | Read-only. Checks a JSON finalization proposal against preconditions (`PASS` / `FAIL` / `NOT_VERIFIED`), lists every write target and prints a digest of the exact plan. |
| `monolith finalize apply --proposal <file> --approve <digest>` | Applies a finalization only if the plan still matches the digest the owner approved. Writes story records in a fixed order; nothing is written if the plan changed. |
| `monolith mission start\|list\|show\|finish\|checkpoint\|checkpoints` | Records missions and checkpoints in `{{MONOLITH_ROOT}}/state.json`. Experimental; a recommended discipline, not an enforced gate. |
| `monolith idea add\|list\|show` | Captures a deferred idea without changing the current task, and recalls it later. One Markdown file per idea; ids are not reused (reservations are kept in `ideas/.ids/`). |
| `monolith update` | For instances created by an older release: previews (and with `--apply` installs) the current agent entry point, the Idea Capture integration and the current `finalize-story` skill. Never overwrites user edits; conflicts are reported, not resolved. Does not add other new template files. |
| `monolith ui` | Mission Control: a read-only web dashboard on `127.0.0.1` (default port 4173). Does not open a browser. |

`monolith status` and `monolith dry-run` exist as names but are **not implemented**.

---

## 3. Project Memory

Key files (paths relative to the project root):

| File | Role |
|---|---|
| `{{MONOLITH_ROOT}}/memory/working/active.md` | The current phase and story. "No active story recorded" means nothing is registered, **not** that the project is complete. |
| `{{MONOLITH_ROOT}}/memory/working/story-index.md` | Index of finalized stories. |
| `{{MONOLITH_ROOT}}/context/maps/project-map.md` | Where each kind of knowledge lives in this instance. |
| `{{MONOLITH_ROOT}}/context/maps/roadmap-index.md` | Phases, stories and their status. |
| `{{MONOLITH_ROOT}}/context/maps/routing-map.md` | Classifies a request into a task type, and (Table 8) maps each kind of long-term knowledge to its one canonical destination. |
| `{{MONOLITH_ROOT}}/memory/long-term/` | Decisions, tech debt, architecture principles, execution history. |
| `{{MONOLITH_ROOT}}/memory/long-term/ideas/` | The Idea Store. Managed only through `monolith idea`; assistants never edit these files. |
| `{{MONOLITH_ROOT}}/skills/` | Step-by-step procedures (finalize story, current status, idea capture, …) indexed in `skills/INDEX.md`. |
| `{{MONOLITH_ROOT}}/protocols/` | Rules for boot, cognition modes, governance and execution. |
| `AGENTS.md` and the AI-tool instruction file (e.g. `CLAUDE.md`) | Instructions for coding agents working inside the repository. |

Rule of thumb: knowledge has **one canonical place**. Do not suggest creating new
directories, registries or templates for something that already has a destination.

---

## 4. Recommended Development Workflow

1. **Restore context.** The developer runs `monolith brief` (and, if `Freshness`
   is not `FRESH`, `monolith brief --reconcile`) and shares the output. Treat it
   as the starting point, not as a complete picture.
2. **Plan the task.** Agree on the goal, scope, out-of-scope items and acceptance
   criteria before implementation starts.
3. **Implement.** The coding agent works in the repository, following `AGENTS.md`,
   the routing map and the relevant skill. Prefer an isolated branch.
4. **Test.** Run the project's own typecheck, build and tests. MONOLITH does not
   run them for you.
5. **Review.** Review the diff and the test output, not the agent's summary of them.
6. **Update project state.** Keep `active.md`, `roadmap-index.md` and related
   documents in line with what actually happened; use `monolith brief` to spot drift.
7. **Controlled finalization.** Close a story only with
   `monolith finalize plan` → owner reviews the plan and digest →
   `monolith finalize apply --proposal <file> --approve <digest>`. Never finalize by editing the
   Markdown by hand.

Ideas that come up along the way are saved with `monolith idea add` and the
current task continues unchanged.

---

## 5. Working With AI Assistants

**In ChatGPT:** put this document into the Project instructions (or the first
message of a conversation). Share `monolith brief` output, diffs and test
results as the work progresses. The chat cannot see the repository; it only
knows what you paste.

**In Claude:** add this document to a Claude Project's knowledge or paste it at
the start of a conversation. The same rule applies: it sees only what you share.

**Working chat vs. coding agent:**

| | Working chat (this context) | Coding agent (Claude Code, Codex, Cursor, …) |
|---|---|---|
| Sees | Only what you paste | The repository itself |
| Instructions | This document | `AGENTS.md`, `CLAUDE.md`, `{{MONOLITH_ROOT}}/AGENT.md`, skills, protocols |
| Role | Architect, consultant, reviewer: plans, questions, reviews, drafts task specifications | Executes: edits files, runs commands and tests |
| Can change the project | No | Yes, within the scope it is given |

A good pattern: the working chat writes a precise task for the coding agent; the
agent executes it; the developer brings the agent's report and real command output
back to the chat for review.

---

## 6. Important Guarantees and Limitations

**What the runtime guarantees**

- `brief`, `brief --reconcile`, `validate`, `finalize plan`, `idea list|show`,
  `ui` and `update` (without `--apply`) are read-only.
- Diagnostics are deterministic: the same files and git history produce the same
  output. No LLM and no external network calls (`monolith ui` listens only on
  `127.0.0.1`).
- User data is protected: `init` never overwrites an existing file;
  `idea add` never overwrites an idea; `update --apply` never changes text you
  edited: it creates missing MONOLITH-owned files, refreshes unedited
  MONOLITH-managed sections and replaces only an unmodified older
  `finalize-story` skill; `finalize apply` writes only
  the exact plan the owner approved by digest. It is not atomic: an interrupted
  run (exit `3`, `INCOMPLETE`) leaves the story not finalized and is completed by
  running `plan` and `apply` again; there is no rollback. Symlinked paths are refused.

**What remains a recommendation**

- Protocols, skills, cognitive modes and missions are instructions for the AI and
  the developer. Nothing technically stops an assistant from ignoring them or from
  editing Markdown directly.
- Integrity and governance results used by `finalize` are reports written by the
  assistant. MONOLITH does not run the build or tests; a digest proves the plan did
  not change, not who approved it.

**`validate PASS` does not mean the application is correct.** It checks only the
structure of the MONOLITH instance (configuration, directories, placeholders). It
does not compile, test, run or analyze your code, and it does not check skill
content or project state.

**`Freshness: UNKNOWN` is not `STALE`.**

- `STALE` requires a concrete, named discrepancy: state documents contradict each
  other, or git history references work items no state document mentions.
- `FRESH` requires positive evidence that nothing changed after the last state update.
- `UNKNOWN` means there is not enough evidence either way (no git, state never
  committed, commits that name no work item). It is "unverified", not "outdated".

`Completeness` is separate: it says whether the brief itself lost information
while being rendered.

---

## 7. Working Agreement

When assisting with a project that uses MONOLITH:

1. **Do not invent project state.** If you have not been shown `brief` output,
   a file or a command result, say that you do not know.
2. **An AI's claim is not evidence.** "Tests pass" or "done" from any assistant
   (including you) counts only with the actual command output or diff.
3. **No dangerous Git operations without explicit permission:** no force push,
   reset, rebase of shared branches, branch or worktree deletion, tag, publish or
   merge into the main branch unless the developer asks for it.
4. **Do not declare work complete without verification:** typecheck, build, tests
   and review, then controlled finalization.
5. **Do not expand scope on your own.** Propose additional work separately (or as
   an idea via `monolith idea add`); do not fold it into the current task.
6. **Respect the project's existing instructions.** `AGENTS.md`, the AI-tool
   instruction file, protocols and skills take precedence over general advice.
