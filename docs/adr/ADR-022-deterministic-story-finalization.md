---
type: adr
id: adr-022
status: accepted
date: 2026-11-02
authority: authoritative
---

# ADR-022 — Deterministic Story Finalization (DOCSYNC-001)

## Context

`finalize-story` was only an instruction for an AI assistant. Nothing in MONOLITH
checked its preconditions, `requiredFinalizationDocs` was declared but read by no
code, the memory files were edited one by one with no protection against a stale
view or an interruption, and no test showed that the next session (`monolith
brief`) saw the result. Verified against `main` at `d9ece4c`: all of this was
true there too (no `finalize` code, `project.definition.mjs` never loaded).

## Decision

1. **A new CLI command is justified** because no existing command owns a
   multi-file documentation transition: `mission` is the tactical lifecycle in
   `state.json`; `update` is template refresh; `durable` is task logs. Story and
   Mission lifecycles stay separate: finalization touches only story memory and
   never `state.json`.
2. **Split of responsibility.** The assistant supplies a typed JSON proposal
   (`src/finalize/proposal.ts`, strict, no unknown fields). MONOLITH validates,
   plans, applies and re-verifies. The owner approves by passing the `plan`
   digest to `apply`; the digest covers the proposal, the bytes of every target
   and the evidence inspected, so approval cannot be reused after anything moved.
3. **Preconditions are three-valued** (`PASS` / `FAIL` / `NOT_VERIFIED`); only
   all-`PASS` is `READY`. Integrity and governance are *attested evidence*
   (`integrity-result.md`, `governance-result.md`) accepted only if `Status: PASS`
   and the `Story:` line names this story id. MONOLITH does not run the build; it
   never writes these files.
4. **`requiredFinalizationDocs` in `project.definition.mjs` is not consumed.**
   That file is JavaScript; executing it would break ADR-011's rule that project
   code is never run, and its default names files (`ROADMAP.md`) most instances
   lack, so enforcing it would block every existing instance. The executable
   equivalent is `finalization.requiredDocs` / `allowedDocs` in
   `monolith.config.json` (data only, optional, absent = nothing required).
5. **Reuse, no second engine.** Reads: `readProjectFile` (ADR-014). Writes:
   `createFile` / `replaceFile` with a project boundary (ADR-012). Mutual
   exclusion: `acquireLock` (ADR-015). Current Story parsing: `brief/story.ts`.
6. **Failure model: roll-forward, not atomic.** Several files cannot be changed
   atomically. Each write is atomic per file; targets are written in a fixed
   order with `active.md` last; each target has an exact "already done"
   predicate, so a re-run writes only what is missing and never duplicates. An
   interrupted run is reported as `INCOMPLETE`, and `plan` reports it as
   `partial`. Success (`FINALIZED`) is claimed only after every target is re-read
   in its final state. There is no rollback and no journal.

## Consequences

- A document edited by someone else between `plan` and `apply` makes `apply`
  refuse; between the last re-check and the rename there remains the TOCTOU
  window described in ADR-013 (not closed here).
- The honesty of integrity/governance rests on the attesting assistant and the
  owner's review of the plan; MONOLITH only guarantees they are not silently
  treated as verified.
- Existing instances keep their own `finalize-story` skill (the updater never
  overwrites an existing skill); `monolith finalize` works on them regardless.
