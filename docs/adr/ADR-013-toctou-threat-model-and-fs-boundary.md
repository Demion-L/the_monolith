---
type: adr
id: ADR-013
title: Filesystem Threat Model and Dynamic TOCTOU (SEC-001B.3)
status: accepted
date: 2026-10-23
related_adrs:
  - ADR-009
  - ADR-011
  - ADR-012
---

# ADR-013 — Filesystem Threat Model and Dynamic TOCTOU (SEC-001B.3)

Documentation-only decision. It changes no source, no test and no behaviour. It
states which adversary the current implementation does and does not withstand,
records the direction of a future fix, and defers the fix.

## Context

SEC-001A (ADR-009) contained `monolithRoot`, SEC-002 (ADR-011) made `validate`
static, SEC-001B.1 bounded every read and SEC-001B.2 (ADR-012) made writes
explicit-scope, exclusive and atomic per file. Each of them checks a path and
then uses the path in a separate syscall. SEC-001B.3 asked whether that gap can
be closed with what Node.js offers, and what closing it would cost.

The SEC-001B.3 feasibility research concluded (one research stand, figures in
"Feasibility evidence"; the PoC sources are not part of this repository and the
experiment was not repeated for this decision):

- The dynamic TOCTOU was **reproduced**: a directory or symlink swapped
  concurrently with a command redirects the operation that follows the check.
- Pure Node.js path-based operations cannot provide TM-C. `fs` has no
  descriptor-relative (`openat`-style) API, so every call re-resolves the whole
  path.
- Stepwise descriptor-relative resolution through `/proc/self/fd` and Linux
  `openat2` both **held up in the PoC**.
- A native filesystem layer was **not built** and is deferred (below).

The evidence and its limits are recorded in "Feasibility evidence".

## Decision

### 1. Threat models

| | Model | Adversary | Status |
|---|---|---|---|
| **TM-A** | Trusted Local Project | none: the project directory and everything that can write to it are trusted; the risk is accident (a mistyped config, a stray file) | **Supported with limitations** (the limits in "Security boundary" apply: platforms, network filesystems, lock release) |
| **TM-B** | Static Adversarial Project | the project content is hostile (a cloned repository) but **at rest**: nothing changes it while a MONOLITH command runs | **PARTIALLY SUPPORTED** until SEC-001B.1-R is integrated (see below) |
| **TM-C** | Concurrent Adversarial Mutation | another process changes directories, symlinks or file names **while** a MONOLITH command runs | **NOT supported** by the current implementation |

**TM-B known problem.** Reads of MONOLITH-managed paths follow symlinks that stay
inside the project (ADR-009, ADR-011). In a hostile repository a managed path
(for example `active.md`, or a Markdown document `brief` scans) can therefore be
an internal symlink to another private file **inside the project root**, and its
contents are read although the file is not a managed one (for `active.md`,
`brief` prints an excerpt of what it reads). Escaping, dangling and looping links are refused; internal ones are
not. TM-B is therefore not fully supported today. Writes are not affected (W-SYM,
ADR-012).

TM-B is **not declared fully supported in advance.** Its status is to be
re-evaluated after SEC-001B.1-R is integrated, on the basis of an independent
security review; implementation alone does not change it.

**State of SEC-001B.1-R at this revision (2026-10-23).** It is **implemented on a
separate branch** (`fix/sec-001b1r-unified-safe-read`, `c520eb9`), has **not**
passed an independent security review and is **not merged**. Neither this
branch nor `main` contains it. Until both the review and the merge have happened,
the Unified Safe Read Contract must not be described as integrated and TM-B
stays PARTIALLY SUPPORTED. The expected change of status is recorded in
section 6; it is an expectation, not a status.

The current implementation does not provide TM-C and must not be described as
doing so, in code comments, documentation, CLI output or reviews.

### 2. Security boundary

**What is provided (TM-A, and the parts of TM-B that are in place).** Everything
below is evaluated at the moment of each operation, on a quiescent tree. The
TM-B read gap above is an exception to it:

- `monolithRoot` containment: relative, no `..`, every existing component
  `realpath`ed and kept inside the project root (ADR-009).
- Bounded reads: non-blocking open, `fstat` regular-file check, size ceiling
  checked before and during the read, descriptor always closed (SEC-001B.1).
  This bounds hangs and memory use; it does not close any race.
- `validate` never executes project code (ADR-011).
- Writes: explicit scope, symlinks refused anywhere below the write boundary,
  `O_CREAT|O_EXCL|O_NOFOLLOW` temp file, `nlink > 1` refused, exclusive and
  atomic per-file publication, identity-based publication states, cleanup of
  the call's own temp file only (ADR-012).

**What is not provided (TM-C).**

- **Dynamic TOCTOU.** Between the check and the use a local actor can change
  what the path means. Reads: a path verified to lie inside the project can be
  re-pointed outside it before `open`. Writes: the same for the directory that
  receives the temp file and the publish.
- **Directory-swap.** Renaming a verified directory away and putting a symlink
  (or another directory) at its name makes every later path-based call resolve
  through the substitute. Per-component `lstat` checks, and the `ParentRef`
  (`dev/ino` snapshot) re-check of ADR-012, are **tripwires** that narrow the
  window; the operation that follows still resolves the path again. They are not
  protection.
- **`O_NOFOLLOW` is not a boundary.** It refuses a symlink only in the **final**
  path component of that one `open`. Intermediate components are still followed,
  and it says nothing about the directory the name was looked up in. It is a
  defence against a pre-planted link at the leaf, which is a TM-B property.
- **Lock release and stale-lock recovery** are path-based `unlink`s outside the
  safe-write primitive. The "is this still our lock" read-back and the `unlink`
  are two steps, so a name swapped between them can make the `unlink` remove
  something that is not ours. The release failure is also invisible
  (`releaseIfOwned` swallows errors; LOCK-RELEASE-001, backlog). Cleanup of an
  owned temp file is identity-checked by `lstat` and then removed by name; that
  `unlink` cannot be made conditional without a directory descriptor.
- **`init`** is neither atomic as a whole nor coordinated between two processes.
- **Symlinks inside an existing instance tree** are read under the ADR-009
  policy (in-project links allowed) and are not vetted by scaffold.

**NFS / SMB and other network filesystems are outside every guarantee**, in both
TM-B and TM-C. Lost replies make a completed `link`/`rename` look failed,
`dev/ino` need not be stable or unique, and `O_EXCL` and `link` semantics depend
on server and mount options. ADR-012's identity-based classification is a
best effort there, and ADR-012 already records a case it cannot separate. The
descriptor-relative designs below do not repair this; they assume a local POSIX
filesystem.

**Same-UID adversary.** A process running as the same user can do anything this
process can: rewrite `state.json` and the lock record directly, signal or
`ptrace` MONOLITH, replace the binary. No filesystem layer defends the content
of files that adversary owns. The value of a descriptor-relative layer is
narrower: it would stop a process that can mutate the **directory tree** from
**redirecting** a MONOLITH operation outside the boundary (the confused-deputy
case). It would not make `state.json` tamper-proof against its own owner, and
no such claim is made for any current or future design in this ADR.

**Platforms.** POSIX (verified on Linux) per ADR-012 DEC-B2-05; macOS/BSD
unverified; Windows best-effort and unverified.

### 3. DEC-READ-UNIFIED-001 — Single Strict Managed Read Contract

**Target policy of SEC-001B.1-R. Implemented on a separate branch; not reviewed,
not integrated, not in force.** Nothing in this ADR is evidence that it holds
today; the code on this branch and on `main` still follows ADR-009 / ADR-011 for
reads.

For every MONOLITH-managed file read (`state.json`, the lock record, `active.md`,
the Markdown documents under `monolithRoot` that `brief` scans, and the root
files `validate` checks) there is **one** read contract:

- **Symlinks are forbidden**: a symlink at any component below the boundary is
  refused, including one that stays inside the project, for the same reason
  W-SYM refuses it for writes.
- **Hardlinks are forbidden**: a file with `nlink > 1` is refused.
- Bounded and regular-file only (unchanged, SEC-001B.1).
- The project root is **explicit**: it is passed by the caller; it is not
  discovered, inferred or defaulted inside the reader.
- **Fail-closed**: any violation is an error; nothing is read, truncated, or
  repaired.
- **One mode only.** There is no Legacy/Strict switch, no flag, environment
  variable or config key that re-enables the permissive behaviour, and no
  permissive fallback when a check cannot be completed.

Consequences to be handled by SEC-001B.1-R, not here: this supersedes the
"internal symlinks allowed" read clause of ADR-009 and ADR-011 and is a
user-visible behaviour change (a project that symlinks a managed file or its
directory must replace the link). Hardlink refusal on reads is new behaviour as
well. A future `openat2` implementation must pass `RESOLVE_NO_SYMLINKS` (and
should pass `RESOLVE_NO_MAGICLINKS`) so that it enforces this contract rather
than only staying beneath the root. SEC-001B.1-R is where the ADR-009 / ADR-011
amendments are made.

The implementation record of this contract is the "Unified Safe Read Contract"
ADR, **ADR-014** (section 6). This section states the policy as a decision input
of the threat model; ADR-014 records how SEC-001B.1-R implements it. The two
must agree; if they differ, the integration review resolves it and ADR-014
describes the code.

### 4. Future architecture (direction, not a commitment)

Closing TM-C requires that, once the boundary directory is opened and verified,
**every later step is relative to a held directory descriptor**, never to a
re-resolved path string.

- **Descriptor-relative I/O** is the principle: open the boundary directory once,
  then open, create, `rename`, `link` and `unlink` relative to descriptors
  (`openat`, `renameat`, `linkat`, `unlinkat`), including lock release and
  stale-lock recovery. Node.js `fs` does not expose these calls.
- **Linux `openat2`** (kernel 5.6 or newer) is the preferred primitive on Linux:
  a single call resolves the remainder relative to a dirfd with
  `RESOLVE_BENEATH`, which prevents escape from the boundary. A future
  implementation **must pass `RESOLVE_NO_SYMLINKS`** so that it enforces the
  DEC-READ-UNIFIED-001 (section 3) rather than merely staying beneath the root;
  it should also set `RESOLVE_NO_MAGICLINKS`. `RESOLVE_NO_XDEV` is a separate
  decision.
- **Stepwise `/proc/self/fd`** is the researched alternative: open each
  component with `O_NOFOLLOW|O_DIRECTORY` through `/proc/self/fd/<parentfd>/<name>`,
  holding the descriptors. It needs only Node's own `fs`, but is Linux-only,
  requires `procfs` to be mounted and visible (not guaranteed in every container
  or sandbox), and gives the call a larger number of syscalls. It is a fallback
  candidate, not a design.
- **Native addon** is the way to reach `openat2` and the `*at` family from
  Node.js. It brings a build and distribution cost (prebuilt binaries per
  platform and libc, or a compiler on the user's machine) that is out of
  proportion to the TM-A/TM-B product today.
- **Platform limits.** `openat2` is Linux-specific; `/proc/self/fd` is
  Linux-specific; macOS/BSD would need `O_NOFOLLOW_ANY`/`openat` with a different
  strategy, and Windows has no equivalent dirfd model. A descriptor-relative
  layer would therefore be an **opt-in, per-platform capability**; where it is
  absent MONOLITH stays at TM-A/TM-B and must say so rather than silently
  degrade.
- **Future migration boundary.** `src/root/` already concentrates the bounded
  reader and the safe-write primitive, and ADR-012 gives it a write-boundary
  type. A later change should replace the **internals behind that boundary**
  (path resolution and the `unlink`/`rename`/`link` steps) without changing
  caller-visible contracts (publication states, error codes, limits). Lock
  release, stale-lock recovery and `trusted-directory` directory creation must
  be brought behind the same boundary as part of that change; they are outside
  it today. The read-contract change (DEC-READ-UNIFIED-001, section 3)
  is SEC-001B.1-R and precedes any native layer.

### 5. Product decision

**Native filesystem layer: DEFERRED.**

The decision is a product decision, not a technical impossibility: the PoC shows
the mechanism works. The cost (native build and distribution, platform matrix,
a new class of failure) is not justified while MONOLITH is a TM-A/TM-B tool.

Revisit when **any** of these holds:

1. MONOLITH is run in an environment with **untrusted concurrent processes**
   able to mutate the project tree while it runs;
2. the product **promises TM-C** (or a documented equivalent) to its users;
3. a client architecture **requires resistance to directory-swap**.

The decision is **not** tied to any particular consumer, including the
launch of SphynX or of the Mission Control UI (ADR-010). Any of the three
conditions arising there triggers a review; their existence alone does not.

### 6. ADR numbering, status transitions and integration dependencies

**Numbering (fixed).**

| ID | Subject | State |
|---|---|---|
| ADR-013 | Filesystem Threat Model and Dynamic TOCTOU (SEC-001B.3) — this document | accepted; documentation only |
| ADR-014 | Unified Safe Read Contract (SEC-001B.1-R) | **reserved** for it; the document exists only on the SEC-001B.1-R branch, not reviewed, not merged |

**Collision to resolve before integration.** The SEC-001B.1-R branch
(`fix/sec-001b1r-unified-safe-read`) was written in parallel and currently names
its document `docs/adr/ADR-013-unified-safe-read.md` with `id: ADR-013`. That
branch was **not** changed by this revision (it is a separate worktree under
independent review). The Core ADR must be renumbered to ADR-014 **before** it is
integrated, otherwise two documents carry `id: ADR-013` (explicit identity
resolution is first-document-wins, ADR-007) and the ADR index has two ADR-013
rows. The renumbering is part of that branch's integration and covers, as counted
by `git grep` at `c520eb9`, 13 lines in 7 files:

- the file name, its frontmatter `id`, its title and its own text (2 lines);
- `docs/adr/README.md` (1 line), `AGENTS.md` (4), `tech-debt.md` (1);
- two code comments in `src/root/index.ts` (2);
- `dist/root/index.js` and `dist/root/index.d.ts` (3, generated: rebuild, do not
  hand-edit).

Only the references that mean the **read contract** change; references that mean
the TOCTOU decision (this ADR) stay ADR-013.

**Status transitions.** Nothing below has happened.

| Event | Documented consequence |
|---|---|
| Now | TM-A supported with limitations; TM-B **PARTIALLY SUPPORTED**; TM-C **UNSUPPORTED**. Unified Safe Reads: implemented on a branch, not reviewed, not integrated |
| SEC-001B.1-R passes an independent security review **and** is merged (renumbered to ADR-014) | TM-B is re-evaluated. If the review supports it, TM-B is re-stated as supported **within the guarantees of section 2**, and Unified Safe Reads are described as integrated. Section 3 changes from "target" to "in force", and ADR-009 / ADR-011 / `AGENTS.md` / `README.md` / `tech-debt.md` / `decisions.md` lose their "not implemented" wording. Merge alone, or review with open findings, does not change the status |
| In every case | TM-C stays **UNSUPPORTED**. The unified read contract does not close dynamic TOCTOU; TM-C changes only through section 5's revisit conditions and a new decision |

**Merge-time conflicts to expect.** This branch and the SEC-001B.1-R branch both
edit `AGENTS.md`, `tech-debt.md` (the SEC-001B.1-R row) and `docs/adr/README.md`.
Resolve by keeping both changes and using the status wording of the table above.

## Feasibility evidence

Recorded so that a later review knows what was and was not shown. **The PoC
sources are not in this repository** and were deliberately not copied into Core;
no production-ready native implementation exists.

- **Provenance.** The figures below are taken from the SEC-001B.3 research
  report. **They were not reproduced in this branch:** no experiment was run
  while preparing this revision, and the PoC sources are not in the repository.
  They are recorded as reported, not as independently verified here.
- **Stand.** One research stand: Linux 7.0, Node.js 24.19.0, `tmpfs`.
- **Method (directory-swap PoC).** A reader or writer operated on a path under a
  boundary directory while a concurrent actor replaced a directory component with
  a symlink to a location outside the boundary. A "boundary escape" is an
  operation that ended up outside the boundary directory.
- **Not recorded in the repository:** the harness code, the cadence and
  mechanism of the swapper, CPU count and scheduling, run duration, and how the
  "Directory-swap" and "Pure Node" harnesses differ.

| Experiment (as named in the report) | Boundary escapes | Operations |
|---|---:|---:|
| Directory-swap, path-based reads | 17,347 | 300,000 reads |
| Pure Node.js | 64,181 | 200,000 |
| Stepwise `/proc/self/fd` | 0 | 200,000 |
| Native `openat2` | 0 | 200,000 |
| Path-based write | 1,655 | not reported |
| Descriptor-relative write | 0 | 50,000 |

How to read the table:

- **One stand, one harness.** Every count depends on how aggressively the swapper
  was driven and on that machine's scheduling. They are **not** an exploitation
  probability and not a rate to expect in practice; no percentage is derived
  from them, and the rows of different harnesses are not comparable with each
  other.
- **What the non-zero rows show:** the dynamic TOCTOU against path-based
  operations is real and reproducible on this stand. That is the basis for
  "pure Node.js path-based calls cannot provide TM-C".
- **What the zero rows do not show.** "0 of N" is consistent with the design
  and does not prove it safe. A race that did not occur in N runs is not a proof
  of absence. The supporting argument for `openat2` and descriptor-relative
  resolution is the kernel's resolution semantics, not the absence of failures.
- **Coverage.** Linux, Node.js `fs` versus the researched alternatives, `tmpfs`.
  Not covered: other filesystems, NFS/SMB, macOS/BSD, Windows.
- **Not shown:** behaviour under production error paths, performance, packaging
  of a native addon, and behaviour in containers without `procfs`.

## Consequences

- TM-A (with limitations) and TM-B (partially) are the documented envelope.
  Reviews and docs may assert TM-B guarantees only as listed in section 2, must
  not call TM-B fully supported before the independent review that follows
  SEC-001B.1-R, and may not assert TM-C.
- SEC-001B.3 remains **OPEN**: it is documented and its direction is chosen, not
  implemented. Registered residuals stay registered: LOCK-RELEASE-001,
  FS-CLEAN-001, FS-PLAT-001.
- Users who need TM-C today have no mitigation inside MONOLITH; the practical
  mitigation is operational: run it on a local filesystem on a tree that no
  untrusted process can write to.
- ADR numbers are fixed: ADR-013 is this document, ADR-014 is reserved for the
  Unified Safe Read Contract. The SEC-001B.1-R branch must renumber its ADR
  before integration (section 6).
- ADR-009 / ADR-011 read policy is **unchanged by this ADR**; SEC-001B.1-R is the
  story that changes it (DEC-READ-UNIFIED-001), and it is implemented on a
  branch but neither reviewed nor merged. ADR-012's write contract is
  unchanged. ADR-012's
  "SEC-001B.2 / SEC-001B.3 boundary" section remains accurate and now points
  here.

## Alternatives considered

- *Claim best-effort TM-C from the existing re-checks.* Rejected: tripwires
  narrow the window but do not remove it, and a false security claim is worse
  than a stated limit.
- *Implement the `/proc/self/fd` walk in pure Node.js now.* Not decided: it
  works in the PoC but is Linux-only, depends on `procfs`, and would split the
  layer by platform without a product requirement to justify it.
- *Build the native addon now.* Rejected for now (deferred, section 5).
- *Drop the problem by documenting TM-C as out of scope forever.* Rejected: the
  three revisit conditions are real; the decision is "not yet", with a recorded
  direction.

## References

- ADR-009 — `monolithRoot` containment (read policy; residual-risk list)
- ADR-011 — static `validate`
- ADR-012 — safe writes (publication, W-SYM, `ParentRef` tripwire,
  "SEC-001B.2 / SEC-001B.3 boundary")
- `.monolith/memory/long-term/tech-debt.md` — SEC-001B.3, LOCK-RELEASE-001,
  FS-CLEAN-001, FS-PLAT-001
- `AGENTS.md` — "File read contract (SEC-001B.1)", "File write contract
  (SEC-001B.2, ADR-012)"
- ADR-014 (reserved) — Unified Safe Read Contract (SEC-001B.1-R); exists only on
  branch `fix/sec-001b1r-unified-safe-read` under the provisional name
  `ADR-013-unified-safe-read.md`
