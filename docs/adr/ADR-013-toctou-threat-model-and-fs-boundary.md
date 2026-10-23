---
type: adr
id: ADR-013
title: Filesystem Threat Model and Dynamic TOCTOU (SEC-001B.3)
status: proposed
date: 2026-10-23
related_adrs:
  - ADR-009
  - ADR-010
  - ADR-011
  - ADR-012
  - ADR-014
---

# ADR-013 — Filesystem Threat Model and Dynamic TOCTOU (SEC-001B.3)

> **Status: PROPOSED.** An earlier revision of this record carried
> `status: accepted`. It has had only the author's preliminary audit, which is not
> an independent review. It becomes `accepted` only after an independent
> architectural review, as ADR-010 did (UI-000E). Until then it must not be cited
> as an accepted decision. (Integrated into `main` on 2026-10-23 with this
> status unchanged; see section 7.)

Documentation-only decision. It changes no source, no test and no behaviour. It
states which adversary the current implementation does and does not withstand,
records the direction of a future fix, and defers the fix.

## Context

SEC-001A (ADR-009) contained `monolithRoot`, SEC-002 (ADR-011) made `validate`
static, SEC-001B.1 bounded every read and SEC-001B.2 (ADR-012) made writes
explicit-scope, exclusive and atomic per file. Each of them checks a path and
then uses the path in a separate syscall. SEC-001B.3 asked whether that gap can
be closed with what Node.js offers, and what closing it would cost.

The SEC-001B.3 feasibility research **reported** the following (one research
stand; figures in "Feasibility evidence"). The PoC harness is not part of this
repository, the experiment was not repeated for this decision, and none of the
statements below has been independently confirmed:

- The research **observed** the dynamic TOCTOU on its stand: a directory or
  symlink swapped concurrently with an operation redirected the operation that
  followed the check.
- Pure Node.js path-based operations cannot provide TM-C. This follows from the
  API, not from the PoC: `fs` has no descriptor-relative (`openat`-style) API,
  so every call re-resolves the whole path.
- For stepwise descriptor-relative resolution through `/proc/self/fd` and Linux
  `openat2` the research **reported no boundary escape** in its runs. That is an
  observation under conditions that are not fully reported, not evidence of
  safety.
- A native filesystem layer was **not built** and is deferred (below).

The evidence and its limits are recorded in "Feasibility evidence".

## Decision

### 1. Threat models

| | Model | Adversary | Status |
|---|---|---|---|
| **TM-A** | Trusted Local Project | none: the project directory and everything that can write to it are trusted; the risk is accident (a mistyped config, a stray file) | **Supported with limitations** (the limits in "Security boundary" apply: platforms, network filesystems, operational robustness, multi-process coordination) |
| **TM-B** | Static Adversarial Project | the project content is hostile (a cloned repository or an unpacked archive) but **at rest**: nothing changes it while a MONOLITH command runs | **PARTIALLY SUPPORTED**: the read gap below is closed for managed files by the merged SEC-001B.1-R, but TM-B is not re-stated as supported until a recorded re-evaluation (see below and section 6) |
| **TM-C** | Concurrent Adversarial Mutation | any actor — a differently-privileged process or the same user, see "Same-UID adversary" and section 7 — changes directories, symlinks or file names on a path **while** a MONOLITH command runs | **NOT supported** by the current implementation |

The residual risks in section 2 fall into four categories: **TM-B** (static
hostile content), **TM-C** (concurrent hostile mutation), **operational
robustness** and **multi-process coordination**. They have different causes and
different fixes and are kept apart on purpose; only the TM-C category is about
the adversary that section 4 addresses.

**TM-B problem (found before SEC-001B.1-R; closed for managed files by its merge).** Reads of MONOLITH-managed paths followed symlinks that stay
inside the project (ADR-009, ADR-011). In a hostile repository a managed path
(for example `active.md`, or a Markdown document `brief` scans) can therefore be
an internal symlink to another private file **inside the project root**, and its
contents are read although the file is not a managed one (for `active.md`,
`brief` prints an excerpt of what it reads). Escaping, dangling and looping links
are refused; internal ones are not. Reads also accept a file with `nlink > 1`;
that variant needs a hardlink inside the project, which a git clone cannot carry
(git stores no hardlinks) but an unpacked archive can. ADR-014 now refuses both
for managed reads. TM-B is nevertheless **not** declared fully supported (see
below). Writes were not affected (W-SYM, ADR-012).

TM-B is **not declared fully supported by the integration.** Its status is
re-evaluated on the basis of an independent security review of the integrated
contract; implementation and merge alone do not change it.

**State of SEC-001B.1-R (updated at integration, 2026-10-23).**

- Implementation: **complete and merged into `main`** (integration merge
  `c3a428b`; branch `fix/sec-001b1r-unified-safe-read`, tip `b6d0eed`).
- Independent review: **APPROVED WITH NOTES** (reported to the integrator; the
  review report is not in this repository). Notes M-1, L-2, B-1 were fixed in the
  corrective pass `b6d0eed`; L-1 was characterized and registered as
  LOCK-RELEASE-001.
- The repository holds **no evidence of a separate re-review of the corrective
  pass** that the earlier revision of this section required before TM-B could be
  re-stated.
- The Unified Safe Read Contract is therefore **integrated**, and TM-B **stays
  PARTIALLY SUPPORTED**: re-stating it is a separate, recorded re-evaluation
  (section 6), not a side effect of the merge. Merging does not change TM-C.

The current implementation does not provide TM-C and must not be described as
doing so, in code comments, documentation, CLI output or reviews.

### 2. Security boundary

**What is provided (TM-A, and the parts of TM-B that are in place).** Everything
below is evaluated at the moment of each operation, on a quiescent tree. The
static-read gap described above was an exception to it until SEC-001B.1-R:

- `monolithRoot` containment: relative, no `..`, every existing component
  `realpath`ed and kept inside the project root (ADR-009).
- Bounded reads: non-blocking open, `fstat` regular-file check, size ceiling
  checked before and during the read, descriptor always closed (SEC-001B.1).
  This bounds hangs and memory use; it does not close any race.
- `validate` never executes project code (ADR-011).
- Writes: explicit scope, symlinks refused anywhere below the write boundary,
  a temp file created with `O_CREAT|O_EXCL` and, where the platform has it,
  `O_NOFOLLOW`; `nlink > 1` refused, exclusive and atomic per-file publication,
  identity-based publication states, cleanup of the call's own temp file only
  (ADR-012).

**What is not provided or not covered.** Four categories; an item belongs to one
of them.

*(a) TM-C — concurrent hostile mutation. Not supported.*

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
- **Path-based `unlink` steps.** Lock release and stale-lock recovery `unlink` by
  path, outside the safe-write primitive: the "is this still our lock" read-back
  and the `unlink` are two steps, so a name swapped between them can make the
  `unlink` remove something that is not ours. Cleanup of the call's own temp file
  is identity-checked by `lstat` and then removed by name in the same way. POSIX
  `unlink`/`unlinkat` take a name and cannot be made conditional on identity; a
  directory descriptor would only confine the removal to the verified directory
  (section 4).

*(b) TM-B — static hostile content. Partially supported.*

- Managed reads follow in-project symlinks and accept `nlink > 1` (the gap
  above); target policy DEC-READ-UNIFIED-001 (section 3).
- **Symlinks inside an existing instance tree** are read under the ADR-009 policy
  (in-project links allowed) and are not vetted by scaffold.

*(c) Operational robustness. Not a threat-model item.*

- **Invisible release failure.** `releaseIfOwned` swallows errors, so a failed
  release of our own lock leaves it behind with no signal (LOCK-RELEASE-001,
  backlog).
- **Leftover write files** (`state.json.tmp.*`, `*.creating.*`, `*.recovery`) are
  never deleted automatically; a stuck `.recovery` mutex blocks automatic
  stale-lock recovery until a human removes it (FS-CLEAN-001).

*(d) Multi-process coordination. Honest processes, no adversary.*

- **`init`** is neither atomic as a whole nor coordinated between two processes.
- Lock liveness uses PID checks, which are unreliable across PID namespaces that
  share a filesystem (FS-PLAT-001).

Fixing (b), (c) or (d) does not provide TM-C, and none of them is evidence for or
against it.

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
no such claim is made for any current or future design in this ADR. TM-C is
therefore about an actor that can mutate a directory on the path without being
able to rewrite MONOLITH's own files or control its process (for example a
differently-privileged or sandboxed process with write access to that
directory); for an actor that is the same user, directory-swap adds only the
confused-deputy case.

**Platforms.** POSIX (verified on Linux) per ADR-012 DEC-B2-05; macOS/BSD
unverified; Windows best-effort and unverified. SEC-001B.1-R
(ADR-014, merged) refuses managed reads where `O_NOFOLLOW` or `O_NONBLOCK` is
unavailable, so on Windows managed files cannot be read at all (FS-PLAT-001).

### 3. DEC-READ-UNIFIED-001 — Single Strict Managed Read Contract

**Policy of SEC-001B.1-R. Implemented and merged into `main` (ADR-014; independent
review APPROVED WITH NOTES, corrective pass `b6d0eed`); in force for managed
reads.** This ADR is the decision input; ADR-014 is the implementation record and
describes the code. The guarantee it gives is the one listed below and in
ADR-014 — it does not close dynamic TOCTOU.

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
well. A future `openat2` implementation must pass `RESOLVE_NO_SYMLINKS` (which
implies `RESOLVE_NO_MAGICLINKS`; stating the latter as well is harmless) so that
it enforces this contract rather than only staying beneath the root.
SEC-001B.1-R is where the ADR-009 / ADR-011 amendments are made.

The implementation record of this contract is the "Unified Safe Read Contract"
ADR, **ADR-014** (`docs/adr/ADR-014-unified-safe-read.md`, accepted, on `main`).
This section states the policy as a decision input of the threat model; ADR-014
records how SEC-001B.1-R implements it. ADR-014 is more specific in places: it
names `monolith.config.json` among the managed files, makes the boundary an
explicit absolute path, adds a descriptor identity check, and refuses reads where
`O_NOFOLLOW`/`O_NONBLOCK` is unavailable. The two must agree; where they differ,
the integration review resolves it and ADR-014 describes the code.

### 4. Future architecture (direction, not a commitment)

Closing TM-C requires that, once the boundary directory is opened and verified,
**every later step is relative to a held directory descriptor**, never to a
re-resolved path string. Nothing in this section is implemented or scheduled.

- **Boundary anchoring.** The first step cannot itself be descriptor-relative:
  the boundary directory is opened **by path**, once. That open is the trust
  anchor. Either the boundary and all its ancestors are trusted (the
  `trusted-directory` assertion of ADR-012 already says so), or the anchor is
  reached by a component-by-component `O_NOFOLLOW|O_DIRECTORY` walk from a
  trusted starting descriptor. A descriptor-relative layer protects everything
  **after** the anchor and says nothing about the anchor's own path.
- **Descriptor-relative I/O** is the principle: hold the boundary descriptor,
  then open, create, `rename`, `link` and `unlink` relative to descriptors
  (`openat`, `renameat`, `linkat`, `unlinkat`), including lock release and
  stale-lock recovery. Node.js `fs` does not expose these calls.
- **Single-component operations.** `renameat`, `linkat` and `unlinkat` take **no**
  `RESOLVE_*` flags. They are safe only when called with a **single path
  component** (no `/`) relative to a **held, verified parent descriptor**; a
  multi-component name would be resolved by the ordinary path walk again, and
  their directory arguments would reintroduce the problem. Limits that remain
  even then: they operate **by name** inside that directory, so a name swapped
  inside the held directory between a check and the call still takes effect;
  `unlinkat` removes whatever is at the name and has no "only if this inode"
  form; `linkat` does not follow a symlink source unless `AT_SYMLINK_FOLLOW` is
  passed, and it should not be; `renameat2` with `RENAME_NOREPLACE` is the
  create-only counterpart of `link`. The held descriptor confines the effect to
  the verified directory; it does not make identity-conditional removal
  possible.
- **Linux `openat2`** (kernel 5.6 or newer) is the preferred primitive on Linux:
  a single call resolves the remainder relative to a dirfd with
  `RESOLVE_BENEATH`, which prevents escape from the boundary. A future
  implementation **must pass `RESOLVE_NO_SYMLINKS`** so that it enforces the
  DEC-READ-UNIFIED-001 (section 3) rather than merely staying beneath the root.
  `RESOLVE_NO_XDEV` is a separate decision.
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
- **Platform limits.** `openat2` and `/proc/self/fd` are Linux-specific. Other
  platforms were **not researched or verified** for this decision; the following
  are pointers for a future study, not claims: FreeBSD has `O_RESOLVE_BENEATH`;
  macOS has `O_NOFOLLOW_ANY`; Windows has handle-relative opens in the native NT
  API (`NtCreateFile` with a root directory handle) that Node.js `fs` does not
  reach. A descriptor-relative layer would therefore be an **opt-in,
  per-platform capability**; where it is absent MONOLITH stays at TM-A/TM-B and
  must say so rather than silently degrade.
- **Future migration boundary.** `src/root/` already concentrates the bounded
  reader and the safe-write primitive, and ADR-012 gives it a write-boundary
  type. A later change should replace the **internals behind that boundary**
  (path resolution and the `unlink`/`rename`/`link` steps) without changing
  caller-visible contracts (publication states, error codes, limits). The read
  contract change (DEC-READ-UNIFIED-001, section 3) is SEC-001B.1-R and precedes
  any native layer. Path-based operations that are **outside** `src/root/` today
  and would have to be brought behind the same boundary, or explicitly assessed
  and left out, as part of that change:
  - lock release and stale-lock recovery (`src/coordinatorium/lock.ts`);
  - `trusted-directory` directory creation (`mkdirSync` in
    `src/coordinatorium/state-keeper.ts`);
  - **directory traversal** that resolves paths itself: `readdirSync` /
    `realpathSync` in `src/brief/docs.ts`, `readdirSync` in
    `src/validate/index.ts`, and `readFileSync` / `readdirSync` / `statSync` in
    `src/init/scaffold.ts`.

  `src/scripts/dogfood-*.ts` write reports on their own and are not part of the
  product boundary.

### 5. Product decision

**Native filesystem layer: DEFERRED.**

The decision is a product decision, not a claim of technical impossibility: the
reported PoC observations (one stand, not reproduced here) and the kernel's
resolution semantics make a descriptor-relative design plausible, not proven for
MONOLITH. The cost (native build and distribution, platform matrix,
a new class of failure) is not justified while MONOLITH is a TM-A/TM-B tool.

Revisit when **any** of these holds:

1. MONOLITH is run in an environment with **untrusted concurrent processes**
   able to mutate the project tree while it runs;
2. the product **promises TM-C** (or a documented equivalent) to its users;
3. a client architecture **requires resistance to directory-swap**.

The decision is **not** tied to any particular consumer, including the launch of
SphynX or of the Mission Control UI: the existence of such a consumer does not
trigger a review, a condition arising there does. A proposal for a
**write-enabled** Mission Control UI must have **all applicable revisit
conditions** assessed (see "Compatibility with ADR-010"); this ADR does not
presume that any particular condition, in particular TM-C, is or is not required
for it. A story or ADR that introduces a consumer which could satisfy any of the
three conditions cites this section and either opens the review or records why
the condition does not hold.

**Who decides.** The decision to revisit the native filesystem layer belongs to
**MONOLITH Core Architecture** (defined in section 7, "Decision owner"). A consumer may *initiate* a
review through a story or an ADR. A consumer may **not**, on its own authority,
declare TM-C supported, lift the ADR-010 restriction, or change the declared
filesystem security policy; each of those needs a Core Architecture decision
(a new or amended ADR). This clarifies the section above and creates no new
decision.

**Every new consumer of the filesystem API** (a CLI command, a UI, an
integration) states, in its own story or ADR: its trust boundary; its threat
model (TM-A/B/C); its read and write capabilities; whether the filesystem can be
modified concurrently while it runs; and the residual risks that apply. This is
a requirement on the new consumer's own record, not a matrix of existing
commands. A **write-enabled UI** additionally needs an architectural decision
about its specific API; this ADR does not say which threat model that decision
must select.

#### Compatibility with ADR-010

ADR-010 (Mission Control UI, accepted) is a read-only interface. It excludes
write operations from the MVP and states "Никаких write operations". In its
dependency table it lists **SEC-001B** (TOCTOU, additional protection of file
operations) with status OPEN and the entry "Блокер для **write-enabled** UI". For
a read-only UI it records a residual risk (a local process with the project
owner's rights can swap a path for a symlink between check and read) whose
acceptance is left to UI-001 before real data is connected. ADR-010 does **not**
say what "closing SEC-001B" means and does not mention TM-C.

This ADR therefore records:

- **ADR-013 does not lift any restriction of ADR-010.** The blocker "SEC-001B is
  a blocker for write-enabled UI" is **preserved**. SEC-001B stays OPEN, and
  SEC-001B.3 is documented, not implemented.
- **TM-C is not claimed**, and nothing in this ADR may be read as
  evidence that a write-enabled UI is safe against concurrent mutation.
- Read together with this ADR, the blocker stays in force until a **separate
  architectural decision** states which threat model a write-enabled UI requires
  and how it is met. If that decision requires TM-C, the native layer deferred in
  this section has to be reopened first; if it does not, the decision must say
  why the residual risk is acceptable. This ADR makes neither decision.
- The residual risk ADR-010 records for the read-only UI (a local process with
  the owner's rights swapping a path for a symlink) is classified here as the
  TM-C / same-UID case of section 2. That classification is **ADR-013's
  architectural interpretation**, not a statement made by ADR-010, which does not
  mention TM-C. This ADR does not accept the risk on the UI's behalf; the
  acceptance stays a UI-001 decision.
- A write-enabled UI is assessed against **all** revisit conditions of section 5
  (untrusted concurrent processes, a TM-C promise, a directory-swap-resistance
  requirement), not by assuming that TM-C is, or is not, mandatory for it. The
  blocker stays in force meanwhile.
- ADR-010 is **not modified** by this ADR.

### 6. ADR numbering, status transitions and integration dependencies

**Numbering (fixed).**

| ID | Subject | State |
|---|---|---|
| ADR-013 | Filesystem Threat Model and Dynamic TOCTOU (SEC-001B.3) — this document | **proposed**; documentation only |
| ADR-014 | Unified Safe Read Contract (SEC-001B.1-R) | **accepted**; the document is `docs/adr/ADR-014-unified-safe-read.md`; the basis of its acceptance is recorded in it |

The SEC-001B.1-R branch renumbered its ADR to ADR-014 in its corrective pass and
reserved ADR-013 for this document; the two branches were integrated together
(2026-10-23) with the numbering above and each ADR lists the other in
`related_adrs`. ADR-014 carries `status: accepted`; the rule that an ADR is
`proposed` until an independent review was applied to it by recording the basis
of acceptance in ADR-014 ("Acceptance basis"). ADR-013 itself has **not** had an
independent architectural review and stays `proposed`.

**Checks at integration.** Instead of counting references (a count drifts with
the corrective pass), run these on the merged tree:

- `grep -h '^id:' docs/adr/*.md | sort | uniq -d` must print nothing (explicit
  identity resolution is first-document-wins, ADR-007; a duplicate `id` silently
  hides one document).
- `git grep -n 'ADR-013'` — every hit must mean the TOCTOU decision;
  `git grep -n 'ADR-014'` — every hit must mean the read contract.
- `git grep -n -i 'not implemented\|not merged\|not integrated'` over
  `AGENTS.md`, `README.md`, `docs/adr/`, `tech-debt.md` and `decisions.md`: each
  statement about SEC-001B.1-R is re-read against the table below.

**Status transitions.** Nothing below, except the first row, has happened.

| Event | Documented consequence |
|---|---|
| Now (after integration, 2026-10-23) | TM-A supported with limitations; TM-B **PARTIALLY SUPPORTED**; TM-C **UNSUPPORTED**. SEC-001B.1-R: implemented, **merged**, first review APPROVED WITH NOTES, corrective pass `b6d0eed`; no separate re-review recorded. ADR-010's write-enabled-UI blocker preserved |
| A recorded re-evaluation of TM-B (an independent security review of the integrated contract, recorded in an ADR or review record) | TM-B is re-evaluated. If the review supports it, TM-B is re-stated as supported **within the guarantees of section 2**, and only the TM-B row changes. The "integrated" wording of the read contract, the pointer to ADR-014 in `decisions.md` and the amendments of ADR-009 / ADR-011 / `AGENTS.md` / `README.md` / `tech-debt.md` were made at integration. A review with open findings does not change the status |
| In every case | TM-C stays **UNSUPPORTED**. The unified read contract does not close dynamic TOCTOU; TM-C changes only through section 5's revisit conditions and a new decision. ADR-010's blocker is not affected |

**Merge-time conflicts (resolved at integration, 2026-10-23).** Both branches edited `AGENTS.md`,
`tech-debt.md` (the SEC-001B.1-R and SEC-001B.3 rows) and `docs/adr/README.md`
(the ADR-013 / ADR-014 rows). Keep both changes: the ADR-013 row and document
from this branch, the ADR-014 row and document from the other, status wording from
the table above. Statements that merge cleanly but become stale (ADR-009,
ADR-011, root `README.md`, `decisions.md`, sections 2 and 3 of this ADR) are
covered by the checks above.

### 7. Decision owner, residual-risk acceptance and TM-C scope (integration addendum, 2026-10-23)

This section resolves findings F-01 to F-04 of the independent review of this ADR.
It clarifies roles and procedure; it adds **no** security guarantee, changes no
threat-model status and lifts no restriction.

**Decision owner (F-01).** "MONOLITH Core Architecture" in this ADR means the
**repository maintainer(s) who hold ADR acceptance authority for this repository**
(an ADR is `accepted` only by them; ADR-010 was accepted that way in UI-000E).
It is a role, not a subsystem. **Mission Control is a consumer** of the core
(ADR-010) and is **not** a decision body: it can initiate a review through a story
or an ADR, it cannot decide one. The earlier wording "Core Architecture / Mission
Control" is withdrawn. The owner defined here is an interpretation made at
integration; the independent architectural review that moves this ADR to
`accepted` confirms or amends it.

**Residual-risk acceptance — minimal procedure (F-02).** A residual risk named in
this ADR, ADR-010 or `tech-debt.md` counts as *accepted* only if a record in a
story or an ADR contains all of:

1. the risk (a `tech-debt.md` ID or an ADR section) and its class (TM-B, TM-C
   with sub-case, operational, coordination);
2. the consumer, its trust boundary and its concurrent-modification assumption;
3. why the risk is acceptable for that consumer, and any compensating measure;
4. the acceptor: the decision owner above (a consumer proposes; it does not accept
   on its own authority);
5. the date and the trigger that reopens it (at least the revisit conditions of
   section 5);
6. an entry in `tech-debt.md` and `decisions.md` that points to the record.

An acceptance covers only the named consumer and risk. It does not change a
threat-model status, does not support TM-C and does not lift ADR-010's blocker.
The read-only UI's acceptance that section 5 leaves to UI-001 follows this
procedure; no acceptance has been recorded yet.

**TM-C and the same-UID adversary (F-03).** TM-C is defined by **capability**,
not by user ID: an actor that can change a directory, symlink or file name on a
path component while a MONOLITH command runs. It has two sub-cases, both
**unsupported**:

- *TM-C / other principal* — a differently-privileged or sandboxed process with
  write access to a directory on the path. This is the case a descriptor-relative
  layer (section 4) is designed for.
- *TM-C / same-UID* — a process running as the same user. It can already rewrite
  `state.json`, the lock record and the binary, so for it directory swap adds only
  the confused-deputy redirect described in section 2. The residual risk ADR-010
  records for the read-only UI is this sub-case.

What a same-UID actor can do by rewriting MONOLITH's own files is **not a TM-C
case** and is outside every filesystem guarantee; no design in this ADR claims to
defend it.

**Basis of ADR-014's acceptance (F-04).** Recorded in ADR-014 ("Acceptance
basis"). In short: an implemented and merged contract, an independent review with
verdict APPROVED WITH NOTES, the notes dispositioned in the corrective pass, and
the integrator's authorization. It does not rest on this ADR and does not make
this ADR accepted.

**Other findings (F-05 to F-12).** The text of these findings is not in this
repository and was not available at integration. They are not claimed to be
resolved by this section; they remain for the independent architectural review of
this ADR.

## Feasibility evidence

Recorded so that a later review knows what was and was not shown. **The PoC
sources are not in this repository** and were deliberately not copied into Core;
no production-ready native implementation exists.

- **Provenance.** The figures below are taken from the SEC-001B.3 research
  report. **They were not reproduced in this branch:** no experiment was run
  while preparing this revision, nor in any review of it, and the PoC harness is
  not in the repository. They are recorded as reported, not as independently
  verified here, and nothing in this ADR relies on them as proof of safety.
- **Stand.** One research stand: Linux 7.0, Node.js 24.19.0, `tmpfs`.
- **Method (directory-swap PoC).** A reader or writer operated on a path under a
  boundary directory while a concurrent actor replaced a directory component with
  a symlink to a location outside the boundary. The summary supplied for this
  record does not define "boundary escape" more precisely; here it means an
  operation that ended up outside the boundary directory.
- **Convention.** `not reported` means the research summary available to this
  record does not state the value. No value has been inferred.

| # | Scenario | Mechanism | Operation | Attempts | Boundary escapes | Limitations |
|---|---|---|---|---:|---:|---|
| 1 | Directory-swap | not reported | read | 300,000 | 17,347 | mechanism not reported |
| 2 | not reported | Pure Node.js | not reported | 200,000 | 64,181 | scenario and operation not reported; relation to row 1 not reported |
| 3 | not reported | Stepwise `/proc/self/fd` | not reported | 200,000 | 0 | scenario and operation not reported |
| 4 | not reported | Native `openat2` | not reported | 200,000 | 0 | scenario and operation not reported |
| 5 | not reported | Path-based | write | not reported | 1,655 | no denominator: the count cannot be interpreted |
| 6 | not reported | Descriptor-relative | write | 50,000 | 0 | which primitive (`/proc/self/fd`, `openat2`, other) not reported |

Parameters not reported for **any** row: the harness code, the cadence and
mechanism of the swapper, whether the swapper load was the same in every row, CPU
count and scheduling, run duration, and run-to-run variance.

How to read the table:

- **One stand, one harness.** Every count depends on how aggressively the swapper
  was driven and on that machine's scheduling. They are **not** an exploitation
  probability and not a rate to expect in practice; no percentage is derived
  from them, and rows 1 and 2, whose relation is not reported, are not comparable
  with each other or with row 5.
- **What the non-zero rows show:** the research **reported** boundary escapes
  for path-based operations on this stand (rows 1, 2, 5); row 1's mechanism is
  not reported. They illustrate the TOCTOU the API structure predicts; the basis
  for "pure Node.js path-based calls cannot provide TM-C" is that structure (no
  descriptor-relative API in `fs`), not these counts.
- **What the zero rows do not show.** "0 of N" is consistent with the design
  and does not prove it safe. A race that did not occur in N runs is not a proof
  of absence, and a zero row is informative only if its swapper load matched the
  non-zero rows, which is not reported; unreported load conditions must not be
  assumed equal across rows. The supporting argument for `openat2` and
  descriptor-relative resolution is the kernel's resolution semantics, not the
  absence of failures.
- **Coverage.** Linux, Node.js `fs` versus the researched alternatives, `tmpfs`.
  Not covered: other filesystems, NFS/SMB, macOS/BSD, Windows.
- **Not shown:** behaviour under production error paths, performance, packaging
  of a native addon, and behaviour in containers without `procfs`.

## Consequences

- ADR-013 is **proposed**. TM-A (with limitations) and TM-B (partially) are the
  documented envelope. Reviews and docs may assert TM-B guarantees only as listed
  in section 2, must not call TM-B fully supported before a recorded re-evaluation (section 6),
  and may not assert TM-C.
- SEC-001B.3 remains **OPEN**: it is documented and its direction is chosen, not
  implemented. Registered residuals stay registered: LOCK-RELEASE-001,
  FS-CLEAN-001, FS-PLAT-001.
- Users who need TM-C today have no mitigation inside MONOLITH; the practical
  mitigation is operational: run it on a local filesystem on a tree that no
  untrusted process can write to.
- ADR numbers are fixed: ADR-013 is this document, ADR-014 is the Unified Safe
  Read Contract.
- ADR-009 / ADR-011 read policy is **unchanged by this ADR**; SEC-001B.1-R is the
  story that changed it (DEC-READ-UNIFIED-001, ADR-014), now merged. ADR-012's write contract is
  unchanged. ADR-012's "SEC-001B.2 / SEC-001B.3 boundary" section remains
  accurate and now points here.
- ADR-010's blocker for a write-enabled UI is **not lifted** (section 5).

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
- ADR-010 — Mission Control UI (read-only; SEC-001B as blocker for write-enabled
  UI; section 5 "Compatibility with ADR-010")
- ADR-011 — static `validate`
- ADR-012 — safe writes (publication, W-SYM, `ParentRef` tripwire,
  "SEC-001B.2 / SEC-001B.3 boundary")
- `.monolith/memory/long-term/tech-debt.md` — SEC-001B.3, LOCK-RELEASE-001,
  FS-CLEAN-001, FS-PLAT-001
- `AGENTS.md` — "File read contract (SEC-001B.1)", "File write contract
  (SEC-001B.2, ADR-012)"
- ADR-014 — Unified Safe Read Contract (SEC-001B.1-R),
  `docs/adr/ADR-014-unified-safe-read.md` (accepted)
