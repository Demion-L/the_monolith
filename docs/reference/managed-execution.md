---
type: reference
id: managed-execution
title: Managed Execution, Mission Enrollment and Ownership
authority: authoritative
---

# Managed Execution, Mission Enrollment and Ownership

**No autonomous implementation without a traceable Mission.** MONOLITH can now make that technically checkable for the
tools a host routes through a hook. This page states what is guaranteed and what is not.

Reading, discussion and exploration never create a Mission. Manual `mission start | checkpoint | finish` keeps working
unchanged, and a project that does nothing keeps behaving exactly as before: Managed Execution is **explicit opt-in**.

## Who defines what

| Layer | Responsibility |
|---|---|
| **Core** (`src/coordinatorium`) | enrollment semantics, Mission identity, idempotency, ownership, lifecycle, conflicts |
| **Host adapter** (Claude Code hooks, `src/hooks`) | detect that implementation began, build an `ExecutionContext`, call Core, translate the result into the host's allow/deny protocol |

The adapter holds no business logic. There is no second Mission registry: the existing Durable State (`state.json`, shared
across linked worktrees in the git common directory) stays the one authority. Operational state is not evidence that code
changed; use Git and `monolith evidence` for that.

## Mission enrollment (Core)

`enrollMission(target, context)` returns one of:

| Status | Meaning |
|---|---|
| `CREATED` | the first implementation action of this execution context registered a new Mission |
| `REUSED` | the context's active Mission is used; nothing new is recorded (a restarted session updates `owner.sessionId` only) |
| `SKIPPED` | the observed action is not implementation (`intent: "read"`); state untouched |
| `CONFLICT` | ownership is ambiguous (several candidates, or a different Story was requested); an explicit choice is required |
| `UNAVAILABLE` | enrollment could not be performed (state unreadable, lock, write failure); nothing is assumed |

- **Execution context** = `{ agent, worktree (real path), sessionId?, branch?, storyId?, source }`. The worktree is the
  identity; a branch is informational (several agents may share one). A Story is linked only when given explicitly.
- **Idempotency.** Lookup and creation happen inside one `mutateState` critical section (the existing cross-process lock):
  N concurrent callers with the same identity produce exactly one Mission; different contexts never collide on an ID.
- **No captured Missions.** Only a Mission owned by the same `(agent, worktree)` is reused. A manual Mission, or one owned by
  another worktree, is never joined — even when active on the same branch.
- **No invented history.** The auto-created Mission has a factual title (`Managed implementation (claude-code, worktree X,
  branch Y)`), no summary and no checkpoint.

CLI for any host: `monolith mission enroll [--agent <name>] [--session <id>] [--story <ID>] [--json]` (exit 0 created/reused,
3 conflict, 4 unavailable) and `monolith mission current`.

## Ownership

`Mission.owner` (optional, so Durable State stays schema v3 and old files remain valid and are never re-interpreted):
`agent`, `worktree`, `sessionId`, `branch`, `source`, `enrolledAt`, `previous[]` (explicit handoffs).

- An **owned** Mission can be checkpointed or finished only from its owner's worktree; from another worktree the CLI refuses
  and changes nothing (`MissionOwnershipError`). A Mission without an owner (every manual/legacy Mission) is unrestricted.
- **Handoff** is the only way across: `monolith mission handoff <id> --reason "..."` (reason required; the previous owner
  is recorded; nothing else is written — no checkpoint, no summary).
- Ownership is **coordination, not authentication.** A session id or path proves nothing about who is calling; it prevents
  accidents between cooperating agents. It is not a security boundary.
- An older MONOLITH binary that rewrites `state.json` drops `owner`; it cannot corrupt the file.

### Crash recovery and liveness

A crash never closes anything and there is no age/timeout rule. The Mission stays `in_progress`; the next session in the same
worktree reuses it (`REUSED`, with a note naming the previous session) and the SessionStart packet lists it. Whether another
context's owner is still working is **UNKNOWN** — absence of activity proves nothing. The single conclusive fact is
`confirmed-orphaned`: the owner's worktree no longer exists. Either way, continuing another context's Mission requires an
explicit `mission handoff`.

## Managed Execution mode (Claude Code adapter)

Enable per project, in `monolith.config.json`:

```json
{ "execution": { "mode": "managed", "onEnrollmentFailure": "deny" } }
```

and install the hooks yourself (MONOLITH never edits Claude Code settings, project or global):

```bash
monolith hook print-config --managed   # merge into .claude/settings.json yourself
monolith hook status                   # honest status: mode + whether the project's settings contain the hook
```

`PreToolUse` (matcher `Write|Edit|MultiEdit|NotebookEdit|Bash`) behaves as follows in a managed project:

| Observed call | Result |
|---|---|
| `Read`, `Grep`, `Glob`, web tools, planning/agent tools | nothing; never a Mission |
| `Write`/`Edit`/`MultiEdit`/`NotebookEdit` **outside** the worktree | nothing (not a project modification) |
| `Bash` that is a single allowlisted read-only command or a plain `\|` pipeline of them (`git status`, `ls`, `grep …`) | nothing |
| `monolith …` (single command) | nothing (governed by its own contracts: evidence, finalize approvals) |
| file write inside the worktree, or any other `Bash` | **Core enrollment**; the agent is told the Mission ID on `CREATED` |
| tools the layer does not understand (e.g. MCP tools) | nothing — *not controlled*, not claimed to be covered |

`CONFLICT` or `UNAVAILABLE` → the call is **denied** (`permissionDecision: "deny"`, verified against Claude Code 2.1.330)
unless `onEnrollmentFailure` is `"allow"` (then it proceeds with a visible "NOT tracked" warning — not enforcement). The
hook never answers `allow`, so it cannot override the user's own permission rules. There is no regex shell parser: a command
that is not a recognisable simple read-only command is conservatively treated as implementation.

`--managed` snippet fails closed: if the `monolith` CLI is missing or the hook crashes, the command exits 2 and the call is
blocked, instead of silently passing.

Other hooks in a managed project: `SessionStart` reports the mode, your Mission, and other contexts' active Missions (and
creates nothing); `PreCompact` lists the Missions owned by this worktree and reminds the agent to checkpoint real facts;
`Stop` stays non-blocking — stopping is not finishing, nothing is closed — and notes "untracked implementation" when the
tree is dirty with no owned Mission.

### What it guarantees

- A write made through a hook-routed file tool, or a Bash call the hook cannot show to be read-only, is not allowed to
  proceed in a managed project unless the work is enrolled in a Mission of that worktree (or the operator chose `allow`).
- Repeated calls, restarted sessions and eight concurrent callers produce one Mission per execution context.
- A managed Mission is not finished or checkpointed by another worktree without an explicit handoff.

### What it does not guarantee

- It is not a filesystem protection. A process the agent starts (a build, a test run, an editor, a script) can write files
  without passing through a hook; so can any tool the host does not route through `PreToolUse`, a user in a terminal, or an
  agent whose hook is not installed. `Bash` calls that run such programs are only *enrolled*, not contained.
- It does not verify that a Mission describes the work, that a checkpoint is true, or that tests passed — use
  `monolith evidence run` and `monolith handover check`.
- A completed Mission is not a finalized Story; Finalize and its approval digest are unchanged.
- User-level (global) Claude Code settings are not inspected by `hook status`; a missing project hook is reported as
  "not found in project settings", and an agent (or user) with write access can edit the config or the settings. Since a
  managed project's own config can be edited by an enrolled agent, it is a coordination guard against accidents.
- If `monolith.config.json` cannot be read, the mode is unknowable: the hook warns loudly and does **not** govern the write.

### Disabling safely

Set `"execution": { "mode": "off" }` (or remove the key) — the hook becomes a silent no-op — and/or remove the PreToolUse
entry from your Claude Code settings. Nothing in the Mission record needs cleaning up; existing Missions remain.

## Contract for future host adapters

A host adapter (Codex, a custom integration) must: (1) build an `ExecutionContext` from its own session facts —
`deriveExecutionContext(dir, { agent, source, sessionId })`; (2) call `enrollMission` (or `monolith mission enroll --json`)
before it allows a write it can observe, never for reads; (3) apply the explicit failure policy to `CONFLICT`/`UNAVAILABLE`
instead of falling back silently; (4) never close a Mission on session end; (5) never claim coverage of operations the host
does not route through it. Core, Handover and Governance Check know no host.

## Updating older projects

`monolith update` delivers the governance format contract (`protocols/governance/document-formats.md`, only when absent) and
refreshes the managed `AGENT.md` block — which now carries the Mission and Reporting Discipline text — only while that block is
unedited; edits are kept and reported as a CONFLICT. Root `CLAUDE.md` is never rewritten; it points to `AGENT.md`.
