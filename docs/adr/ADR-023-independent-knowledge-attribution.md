---
type: adr
id: ADR-023
status: accepted
date: 2026-11-11
authority: authoritative
---

# ADR-023 — Independent Knowledge Attribution (KA-001)

## Context

In a consumer project (STC) a strategy paper that belongs to no story was
committed. `monolith brief` could only call that commit `UNATTRIBUTED_ACTIVITY`
(Freshness `UNKNOWN`), or — if it carried an unknown work-item id — `STALE`;
naming the active story's id would have been a false attribution. `IDEA-NNN` is
deliberately excluded from work-item extraction (`src/brief/freshness.ts`), so
the Idea Store cannot explain a commit today.

## Options

| | A. Extend the Idea Store | B. Non-active work items | C. New knowledge registry |
|---|---|---|---|
| New files / abstractions | none: one optional frontmatter field (`paths`) + one pure module | roadmap rows for non-stories | new directory, format, CLI, store |
| Touches roadmap / story lifecycle | no | **yes** (roadmap, Definition of Done, `IN PROGRESS` semantics) | no |
| Backward compatibility | old files parse; old readers ignore the field | existing id grammar and states change meaning | new, absent in old projects |
| Historical validity | read the idea file *in the commit's tree* | roadmap history is not a registration record | would need the same |
| Public API / CLI | `idea add --path` (optional) | none new, but semantic breakage | new commands |
| Security surface | one read-only `git cat-file blob` | writes roadmap | new write path |

## Decision

Option A. B contaminates the Operational State the task must keep clean; C is a
new subsystem to solve a case A covers. See `docs/reference/cli.md` (`monolith idea`)
for the exact rules. The decisive properties:

1. Registration = a committed idea file with `paths`. The idea is read **as of the
   commit being judged** (`git cat-file blob <sha>:<path>`), so a later
   registration — or a commit that registers/edits the idea itself — never
   legalises anything.
2. Attribution requires full coverage: every changed non-state file must be under
   the declared paths; one foreign file leaves the commit unattributed.
3. A subject with a work-item id keeps work-item semantics (no knowledge shortcut).
4. Files inside the MONOLITH root are never coverable.
5. The attribution only decides that a commit is *explained*; it does not change
   the active story, missions, roadmap or any status.

## Consequences

- No migration. Projects without `paths` behave exactly as before.
- `brief --reconcile` lists attributed commits and the reason a commit that named
  an idea was not attributed.
- Known limit: the commit that registers the idea is ordinary activity until the
  next state-document commit. A broad `paths` entry is an owner decision.
- Not covered: files whose names git quotes (non-ASCII with default `core.quotepath`)
  are never matched, i.e. fail closed to "unattributed".
