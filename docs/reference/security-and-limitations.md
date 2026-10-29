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

Durable State is merged but **not accepted**: its independent security review
outcome is unknown and findings F-1/F-2 remain open. See `AGENTS.md` and
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
