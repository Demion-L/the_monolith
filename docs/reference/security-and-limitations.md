---
type: reference
id: reference-security-and-limitations
authority: authoritative
stability: volatile
---

# Security & Limitations

User-facing summary of MONOLITH's security contract and known limits. The
decisions behind it are the ADRs cited below; they take precedence over this
page.

## Mission Control

- Mission Control and its API are read-only and bound to `127.0.0.1`; the
  `Host` header is allow-listed (DNS-rebinding defence), `Origin` is checked,
  no CORS headers are sent, only `GET` is accepted. There is no
  authentication, and loopback is not authentication.
- The UI cannot start `validate`, run project code or choose another project
  root; the root is fixed when the server starts.
- A write-enabled UI remains blocked (ADR-010).

## Threat model

Trusted local project supported with limitations; static adversarial project
partially supported; concurrent adversarial mutation (TM-C) unsupported
([ADR-013](../adr/ADR-013-toctou-threat-model-and-fs-boundary.md)). Not
covered: a write-enabled UI and any TM-C adversary.

## Platform, permissions and shared directories

The write guarantees (ADR-012) are stated for **POSIX** (verified on Linux).
macOS/BSD are expected to behave the same but are not verified; **Windows is
best-effort and unverified** — dangerous objects the checks can still see are
refused, but no guarantee is made, and a `PLATFORM_BEST_EFFORT` warning is
printed once. Network filesystems (NFS/SMB) are outside the guarantees.
Nothing defends against another local process that swaps directories or
symlinks while a command runs (SEC-001B.3, open): concurrent adversarial
mutation is **not supported** (TM-C, ADR-013). A trusted local project is
supported with limitations; a static adversarial project is only **partially**
supported (TM-B, ADR-013 — proposed). Since SEC-001B.1-R
([ADR-014](../adr/ADR-014-unified-safe-read.md)) managed files
are read through one strict contract: a symlink anywhere below an explicit
boundary, a non-regular file and a file with other hard links are refused, so a
hostile repository can no longer make a managed path expose another file through
a link. TM-B is **not** re-stated as supported by that merge: it awaits a recorded
re-evaluation. Known gaps: LOCK-RELEASE-001 and BRIEF-DOCDIR-001
(`.monolith/memory/long-term/tech-debt.md`).

A new `state.json` and the lock file are created `0600`; replacing an existing
`state.json` keeps its mode. In a directory **shared between users or
containers with different uids**, others can then no longer read `state.json`
or inspect the lock: use one uid, or `chmod` the file deliberately.
`mission start|finish|checkpoint` also refuse a symlinked `.monolith` (or any
symlinked component) and a `state.json` that has other hard links; replace the
link with a real directory/file first. A crash can leave `state.json.tmp.*`,
`state.json.lock.creating.*` or `state.json.lock.recovery` files; MONOLITH
never deletes them automatically (FS-CLEAN-001).

## `monolith validate`

`validate` never executes project code and a PASS says nothing about
`project.definition.mjs` content — see
[CLI reference](./cli.md#monolith-validate) and
[ADR-011](../adr/ADR-011-static-validate.md).

## Durable State

Durable State is merged but **not accepted**. Its independent security review is incomplete: the targeted review of
acceptance criterion 23 has not been finished, and no full security acceptance is claimed.

- **Support boundary and deployment probe (owner decision A2-R, Option A).** Durable State is supported only on the
  local Linux filesystem configurations that DESIGN-004 §43 does not exclude (network, caching-FUSE and similar
  filesystems stay unsupported). Before production use, run the filesystem-conformance probe (criterion 70 / AC-A2-1)
  on the target storage root's filesystem and record the filesystem type, kernel version, date, root (or a safe
  identifier) and result. `PASS` means *not refuted*, not proven; `FAIL` or *cannot run* means unsupported. A run on
  `/tmp` does not stand in for the target root. There is no automatic `statfs` gate when a store is opened. See
  DESIGN-004 §48.
- **Review standard.** The current limited feature freeze relies on an independent AI-assisted targeted security
  review. It is not an external human security audit and not formal verification.
- **Known limits recorded by DURABLE-SEC-007A.** A well-formed register file with a very large attempt number
  (`prune-<n>.prepare.json`, up to 9 digits) written into a task directory by someone with write access to the store can
  make the register lookup loop run for a very long time or exhaust memory (denial of service; no deletion was observed);
  this is outside the supported threat model. `DIR_FSYNC_UNSUPPORTED` is emitted only when a directory fsync was
  attempted and failed with one of the "unsupported" errors; a platform that reports no directory fsync capability gets
  no such warning, so do not rely on it as a platform check.
- **Missing required task (ADR-018 D2/C-9; fixed in DURABLE-SEC-007B, reviewed in SEC-007C).** If the directory of a
  task that an active child requires is not there (`MISSING`), the child stays `active`, `claim` refuses with
  `TaskOrphanedError`, no fence is issued and nothing is cancelled; the decision is the operator's. Only a consistent
  `COMMITTED` prune permits the irreversible `task.cancelled`. Integrators: the diagnostic code `REQUIRED_TASK_GONE` is
  reported for both `MISSING` and `COMMITTED`, so it is not evidence of a committed prune and must not on its own
  trigger an irreversible action; `TaskOrphanedError` likewise means "execution refused", not "cancelled". The `detail`
  text is not a stable machine discriminant. Also, `createTask` can return a `ValidationError` after it has published
  the child (the parent vanished meanwhile); the child then exists and stays active, so a caller that sees that error
  must look the child up rather than assume it was not created.
- Closure state: [Criterion 23 closure record](../architecture/DURABLE-CRITERION-23-CLOSURE-RECORD.md) — decisions are
  recorded, criterion 23 stays open pending the owner's decision on the remaining evidence gaps.

- **Threat models** (ADR-013): TM-A (trusted local project) is supported with limitations; TM-B (static hostile content)
  is supported only partially; TM-C (concurrent adversarial mutation of directories, symlinks or file names while a
  command runs) is **not supported**. Roll-forward and residue repair unlink by path after a boundary check, so a
  same-user process that swaps a directory between the check and the `unlink` can redirect it.
- **Findings F-1/F-2** (unchecked public prune; test seams in public constructors) were remediated in `02701d4` and
  confirmed by the independent review DURABLE-SEC-002. Seam hygiene is API hygiene, not a boundary against code in the
  same process.
- **O-1** (a committed prune register forged by hand was rolled forward without the F-1 preconditions) is fixed by
  DURABLE-SEC-003: before the first `unlink`, `prune()` audits the data still on disk against the commit. A register is
  not self-proving (its checksum is unkeyed), so a person who can write into the store directory can still forge a
  register *and* delete the store's own files directly; that is outside the supported models. If the audit refuses, it
  reports `PruneDecisionCorruptError` (`commit-audit`) and this call removes nothing; an operator must decide. The audit
  reads the data first and `tombstone.json` after it, so a concurrent legitimate pruner is not mistaken for damage
  (DURABLE-SEC-004 I-1, fixed by DURABLE-SEC-005), and it lists the loose events before the segments, so a concurrent
  compaction is not mistaken for damage either (DURABLE-SEC-006 F-1, fixed by DURABLE-SEC-006A). The refusal message says
  only what is guaranteed: that the refusing call removed no task data; it does not claim that nothing at all changed.
- **I-2 (known limit): committed + part of the log gone + no `tombstone.json`.** A roll-forward publishes `tombstone.json`
  before its first unlink, so a process crash (SIGKILL) does not produce this state: after a crash the kernel still holds
  every completed call, in order. A power loss (or OS crash) is different: it keeps only what reached the disk, and the
  directory entry of the tombstone may be lost while later unlinks are kept. Whether that can happen depends on what the
  write of the tombstone *confirmed*:
  - `durability: 'full'` (default) and `fsync(file)` **and** `fsync(directory)` both succeeded: the tombstone's content and
    its directory entry were forced to disk before the first unlink. This is the only case in which the state is not
    expected after a power loss.
  - `durability: 'file'` or `'none'`: the directory entry is not forced (`'none'` forces nothing). The state is possible.
  - `durability: 'full'` but `fsync(directory)` did not succeed: the write is still *successful* and the roll-forward
    **continues**; the only signal is the warning `DIR_FSYNC_FAILED` (the write is published, its durability is unknown) or
    `DIR_FSYNC_UNSUPPORTED` (the filesystem cannot fsync a directory; the file is durable, the entry may not be), delivered
    through `onWarning`. Durability is then *not confirmed*, and the state is possible after a power loss exactly as in
    `'file'`. This does not mean that the tombstone *is* lost, only that it is not guaranteed to survive. A caller that needs
    the guarantee must treat these warnings as "not durable" (for example, stop before relying on the prune having completed).

  Do not read "successful" as "durable", and do not read a missing confirmation as "lost": the first is about the call, the
  second about what was proven to the disk, and neither says that the store is damaged. Damage of the storage itself (bit
  rot, files edited or removed by hand) is a different cause with the same symptom, and the store cannot tell them apart.
  The state cannot be told from a forged register over a damaged log (the checksum is unkeyed), so `prune()` refuses it
  (`PruneDecisionCorruptError`, `commit-audit`) and removes no task data; the task stays unreadable/gone. There is no
  recovery command and none is added by this fix.

  *Operator recovery, only if the operator chooses to act.* Before publishing `tombstone.json` by hand (with the store's own
  encoder, `encodeTombstone`) and running `prune()` again, the operator must establish **independently of the store directory
  being repaired** that the commit is genuine: (1) the committed decision is authentic (for example, from a backup or from
  the system that requested the prune), (2) the task was finished, (3) the head named by the commit matches the head of the
  log as it was, (4) the outcome digest matches the outcome of that task, and (5) nothing in the data available contradicts
  the commit. If the available data cannot confirm all of these, the operator must **not** continue the deletion; the
  alternative is to restore the missing events from a backup, after which the whole log passes the audit. A forged commit and
  a genuine one with a lost tombstone look the same to the store, so publishing the tombstone by hand on a guess can destroy
  a live task.
- Not claimed: durability across OS crash or power loss, network filesystems.

See the [DURABLE-SEC-001 remediation report](../architecture/DURABLE-SEC-001-REMEDIATION-REPORT.md),
`AGENTS.md` and
[Durable State Retention Safety](../architecture/DURABLE-STATE-RETENTION-SAFETY.md).

## Coordinatorium

`monolith mission` and `.monolith/state.json` (Coordinatorium, ADR-008) are
**experimental**: the schema and library exports may change, and missions are a
recorded discipline that nothing enforces at runtime.

## Related decisions

[ADR-009](../adr/ADR-009-monolith-root-containment.md) ·
[ADR-010](../adr/ADR-010-mission-control-ui.md) ·
[ADR-011](../adr/ADR-011-static-validate.md) ·
[ADR-012](../adr/ADR-012-safe-writes.md) ·
[ADR-013](../adr/ADR-013-toctou-threat-model-and-fs-boundary.md) ·
[ADR-014](../adr/ADR-014-unified-safe-read.md)
