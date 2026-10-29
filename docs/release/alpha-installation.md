---
type: release
id: release-alpha-installation
title: MONOLITH 0.1.0-alpha.0 — Installation and Verified Commands
authority: draft
status: pre-publication
---

# MONOLITH `0.1.0-alpha.0` — Installation and Verified Commands

Canonical source for **installation** and the **release procedure**. Written by
DIST-002, reconciled by RELEASE-001. **The package is not published yet**; every
command below is marked with how it was verified.

| Topic | Canonical source (not repeated here) |
| ----- | ------------------------------------ |
| CLI commands and flags | [`../reference/cli.md`](../reference/cli.md) |
| Security, platforms, threat model | [`../reference/security-and-limitations.md`](../reference/security-and-limitations.md) |
| Programmatic API | [`../reference/write-scope-api.md`](../reference/write-scope-api.md) |
| Installation, publication gate | this file |

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

Implemented, experimental and not-implemented commands (`status`, `dry-run`,
`context`, `ui dev`) are listed in the [CLI reference](../reference/cli.md).

---

## Quickstart (all Verified (tarball))

```sh
mkdir my-project && cd my-project && git init
monolith init --yes
monolith validate                    # Result: PASS
monolith brief                       # Completeness: COMPLETE (Freshness is UNKNOWN until the instance is committed)
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

Pre-1.0, `alpha` tag: the public API, file formats and CLI output may change in
any alpha release. **Durable State** and the **Coordinatorium** are experimental,
Durable State's security acceptance is pending, Mission Control is read-only and
unauthenticated, and Windows is unverified. Details:
[Security & Limitations](../reference/security-and-limitations.md).

---

## Conditions for publication

Not yet satisfied or not verifiable from the repository alone:

1. npm authentication on the publishing machine (`npm whoami` fails here: not logged in).
2. Ownership of the npm scope `@latysh-development` (existence and membership could not be checked without authentication).
3. Owner decisions listed in the DIST-002 report (author spelling, deprecated-name handling, `prepare` script).
4. Owner review of the integrated `feat/release-001-alpha-integration` branch and its merge to `main`.

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
npm pack --dry-run                   # 291 files; no tests, no dist/scripts, no ui/images, no .monolith state
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
