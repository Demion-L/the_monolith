---
type: release
id: release-alpha-installation
title: MONOLITH 0.1.0-alpha.0 — Installation and Verified Commands
authority: draft
status: pre-publication
---

# MONOLITH `0.1.0-alpha.0` — Installation and Verified Commands

Source of verified commands for the README rewrite (BRAND-002). Written by
DIST-002. **The package is not published yet**; every command below is marked
with how it was verified.

| Mark | Meaning |
| ---- | ------- |
| **Verified (tarball)** | Run against the tarball produced by `npm pack` from this branch, in a clean temporary project |
| **Verified (source)** | Run from a source checkout |
| **Unverified until publish** | Requires the package to exist on the npm registry |

---

## Package

| Field | Value |
| ----- | ----- |
| Name | `@latysh-development/monolith` |
| Version | `0.1.0-alpha.0` |
| Dist-tag | `alpha` (there is deliberately no `latest`-tag release) |
| Binary | `monolith` |
| Runtime | Node.js >= 20 |
| Module system | ESM only (`import`; no `require` entry) |

The old name `@monolith/core` is not used anywhere in the public contract and
does not resolve to this package.

---

## Install

```sh
# global CLI                                           — Unverified until publish
npm install -g @latysh-development/monolith@alpha

# as a project dependency (library use)                — Unverified until publish
npm install @latysh-development/monolith@alpha
```

Verified (tarball): `npm install -g <tarball>` and `npm install <tarball>`
both succeed and link the `monolith` binary. `npx @latysh-development/monolith@alpha`
was not verified (it depends on registry resolution of the single `bin`).

Until the first publish, install from a clone:

```sh
git clone https://github.com/Demion-L/the_monolith.git
cd the_monolith
pnpm install            # also runs the build           — Verified (source)
npm pack                # produces the installable tarball
npm install -g ./latysh-development-monolith-0.1.0-alpha.0.tgz
```

---

## Run the CLI

```sh
monolith --version      # 0.1.0-alpha.0                 — Verified (tarball)
monolith --help         #                               — Verified (tarball)
```

### Implemented commands

| Command | What it does | Notes |
| ------- | ------------ | ----- |
| `monolith init [--yes]` | Scaffolds a MONOLITH instance into the **current directory** from `templates/` | Refuses to overwrite existing files; `--yes` only skips prompts. Not atomic and not coordinated between processes |
| `monolith validate [--quiet]` | **Static** checks of the instance files (config, `project.definition.mjs` as a file, `AGENTS.md`, templates) | Never imports or executes project code. A PASS does **not** verify JS syntax, content safety or executability. **Not a security enforcement gate** |
| `monolith brief [--max-chars N] [--strict]`, `brief --reconcile` | Deterministic, read-only, character-budgeted summary of project state | Reads files; runs read-only `git log`/`git rev-parse` for the Freshness signal. No LLM, no network |
| `monolith mission start\|list\|show\|finish\|checkpoint\|checkpoints` | Mission lifecycle in `.monolith/state.json` | **Experimental** (Coordinatorium). Writes `state.json`. Recommended discipline, not runtime-enforced |
| `monolith durable list\|show\|assess\|packet\|verify\|retention` | Inspect and maintain Durable State task logs | **Experimental. Security acceptance pending.** `retention` is dry-run unless `--apply` |
| `monolith ui [--port N]` | Mission Control: read-only dashboard + API | Listens on `127.0.0.1` only (default port 4173); no authentication; does not open a browser, write to the project or run project code |

### Not implemented

`monolith status`, `monolith dry-run` and `monolith context` do **not**
work. `status` and `dry-run` print "not yet implemented" and exit 1 (the
help says so); `context` is an unknown command. `monolith ui dev` needs a
source checkout with devDependencies and is not usable from the npm package.

---

## Quickstart (all Verified (tarball))

```sh
mkdir my-project && cd my-project && git init
monolith init --yes
monolith validate                    # Result: PASS
monolith brief                       # Completeness: COMPLETE (Freshness is UNKNOWN until the instance is committed)
monolith mission start --title "First task" --system "my-project"
monolith mission list
monolith ui                          # http://127.0.0.1:4173 (Ctrl+C to stop)
```

Use `monolith ui --port 4199` if 4173 is taken. Read-only behaviour observed
on a running `monolith ui`: `GET /` 200, `POST /api/dashboard` 405, a request
with a foreign `Host` header 403.

---

## Library use

```js
// ESM only                                           — Verified (tarball)
import { compileMarkdownArtifact, buildGraph, MONOLITH_VERSION } from '@latysh-development/monolith';
import { durable } from '@latysh-development/monolith';   // Experimental
```

TypeScript types ship with the package (`dist/index.d.ts`) and resolve under
`moduleResolution: nodenext`. Consumers need `@types/node` for the declaration
files to type-check without `skipLibCheck`.

---

## Alpha limitations

- **Pre-1.0, `alpha` tag.** Public API, file formats and CLI output may change in any alpha release.
- **Experimental: Durable State** (`durable` export, `monolith durable`) — **Experimental. Security acceptance pending.** The independent security review outcome is not recorded; findings F-1/F-2 are tracked as open. Do not rely on it for untrusted data or multi-user hosts.
- **Experimental: Coordinatorium** (`monolith mission`, `.monolith/state.json`, `schemaVersion: 2`) — the schema and library exports may change. Missions are not enforced; nothing stops an AI session from ignoring them.
- **Threat model.** Supported: a trusted local project (TM-A, with limitations). Hostile content at rest (TM-B): partially supported. Concurrent adversarial mutation (TM-C): **unsupported** (check-then-use races remain open, SEC-001B.3). POSIX local filesystem only; Windows best-effort and unverified; NFS/SMB outside. See ADR-013.
- **`validate` is not security enforcement** (see above).
- **`brief` starts a `git` subprocess** (`git log`, `git rev-parse`; helper-launching config such as `core.fsmonitor`/`diff.external` is disabled, no shell). It does not execute project code, but it does read the project's git repository; run it only in projects you trust.
- **Mission Control is read-only and unauthenticated**, loopback only. A write-capable UI is blocked by ADR-010.
- **Not implemented:** `status`, `dry-run`, `context`, Strategic Coordinatorium, Engineering Gate runtime.

---

## Conditions for publication

Not yet satisfied or not verifiable from the repository alone:

1. npm authentication on the publishing machine (`npm whoami` fails here: not logged in).
2. Ownership of the npm scope `@latysh-development` (existence and membership could not be checked without authentication).
3. Owner decisions listed in the DIST-002 report (author spelling, deprecated-name handling, `prepare` script).
4. README replaced by BRAND-002 (the current README in the tarball still uses the old name).

Publication procedure: see **Publication plan** below.

---

## Publication plan (not executed)

Run on a machine that is logged in as a member of the `@latysh-development` scope, from a clean checkout of the reviewed commit.

```sh
# 0. Use the real registry, not a mirror (the default here is registry.npmmirror.com)
export NPM_CONFIG_REGISTRY=https://registry.npmjs.org

# 1. Authentication and scope ownership
npm login
npm whoami
npm org ls latysh-development        # or: npm access list packages @latysh-development

# 2. The version must not exist yet (expect E404 for the package or the version)
npm view @latysh-development/monolith versions

# 3. Clean build and the checks that gate a release
pnpm install --frozen-lockfile
pnpm run typecheck && pnpm run build && pnpm test && pnpm run test:ui
git status --short                   # dist/ must show no diff after the build

# 4. Inspect the tarball
npm pack --dry-run                   # 300 files, no tests, no ui/images, no .monolith state
npm pack                             # note the shasum; install it in a clean directory and run the Quickstart

# 5. Publish — the --tag is mandatory; without it npm would also set `latest`
npm publish --tag alpha --access public

# 6. Verify what was published
npm view @latysh-development/monolith dist-tags     # { alpha: '0.1.0-alpha.0' }
mkdir /tmp/verify && cd /tmp/verify && npm init -y
npm install @latysh-development/monolith@alpha
npx monolith --version                              # 0.1.0-alpha.0
```

If step 5 sets `latest` by accident, correct it with
`npm dist-tag rm @latysh-development/monolith latest`. A published version
cannot be re-published; fix forward with `0.1.0-alpha.1`.
