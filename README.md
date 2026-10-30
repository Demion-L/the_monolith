<p align="center">
  <img src="./assets/branding/monolith-banner.png" alt="MONOLITH — Cognitive Infrastructure for AI" width="100%">
</p>

<h1 align="center">MONOLITH</h1>

<p align="center">
  <strong>Cognitive Infrastructure for AI</strong><br>
  Observable · Structured · Governed
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/node-%3E%3D20-339933.svg" alt="Node.js >= 20"></a>
  <img src="https://img.shields.io/badge/status-alpha-orange.svg" alt="Status: alpha">
  <a href="https://hub.xerj.org/contributors/Demion-L"><img src="https://hub.xerj.org/contributors/Demion-L/badge.svg" alt="XERJ Corpus Hub contributor"></a>
</p>

---

MONOLITH is an open-source toolkit for observable project state, structured
knowledge, and explicit execution governance. It gives a
human and an AI assistant a shared, inspectable record of a project —
structured knowledge, explicit read and write boundaries, and traceable
decisions — instead of relying on an assistant's unaided memory.

> **[MANIFESTO.md](./MANIFESTO.md)** — why this project exists and the engineering principles that govern it.
> **[AGENTS.md](./AGENTS.md)** — current scope, source structure, and the authoritative entry point for AI assistants working in this repository.

## Why MONOLITH?

You are deep in a task when a good idea arrives — one that has nothing to do
with what you are doing right now. Switching to it would break your focus, so
you postpone it. A few hours later it is buried in a long chat, or simply gone.

A conversation history is a poor place to keep it. It is tied to one session,
it is hard to search, and an AI assistant that starts a new session does not
carry it over. A thought that only lives in a chat lasts as long as the chat.

MONOLITH keeps that knowledge in the project itself: ideas, structured project
context and recorded decisions, as plain Markdown that both a person and an
assistant can read, check and commit. You save the idea, and keep working.

> **Your AI assistant may forget the conversation. Your project shouldn't forget the ideas.**

Ideas are where MONOLITH started, not where it ends: the same approach — durable,
inspectable, deterministic — also covers project state and execution governance.

## What MONOLITH Does

- **Idea Capture** — save a thought that is unrelated to the current task, without losing focus. You decide what to save; ideas are stored as one Markdown file each in `.monolith/memory/long-term/ideas/`, independent of the active story, and are managed with `monolith idea add|list|show` or by an assistant that follows your project's instructions.
- **Observable** — `monolith brief` summarizes project state in the terminal, including whether it looks stale; Mission Control shows it in a local, read-only web interface.
- **Structured** — structure is extracted from a project's own markdown (frontmatter, headings, explicit links) into an explicit relationship graph. No embeddings, no LLM, no fuzzy matching.
- **Governed** — protocols, skills and cognitive modes describe how an assistant reads and updates project memory; missions and checkpoints record progress. This is a recorded discipline, not a runtime gate.
- **Reproducible** — same input, same output. State lives in a schema-versioned file written with a lock and atomic replace; Durable State adds a hash-chained event log.
- **Bounded** — managed files are read and written through strict primitives that refuse symlinks; `monolith validate` never executes project code; Mission Control has no write endpoint.

## Idea Capture Example

```bash
monolith idea add \
  --title 'Automatic Tool Tests' \
  --description 'Generate tests from business tool contracts'

monolith idea list
monolith idea show IDEA-001
```

`IDEA-001` is a demonstration ID; the real ID is printed by `idea add`, and
`idea list` shows every saved idea.

With an AI assistant, you can simply say: *"Save this idea for later."* The
assistant then saves it by running `monolith idea add` — it does not edit idea
files itself. This works because `monolith init` installs instructions and an
`idea-capture` skill for the assistant; it is not guaranteed for an arbitrary
model without that setup. Details and limits: [`monolith idea` in the CLI reference](./docs/reference/cli.md#monolith-idea).

Ideas are saved and recalled **manually**. There is no automatic idea detection,
no automatic recall or reminders, no idea status management and no idea UI yet.

## Quick Start

Requires Node.js >= 20. Install the published alpha package from npm:

```bash
npm install -g @latysh-development/monolith@alpha
```

To build from source instead, see the [installation and release guide](./docs/release/alpha-installation.md).

Then, in a project directory:

```bash
monolith init        # scaffold a MONOLITH instance (refuses to overwrite existing files)
monolith validate    # static integrity check of the instance
monolith brief       # bounded, read-only summary of project state
monolith ui          # Mission Control at http://127.0.0.1:4173 ; Ctrl+C to stop
```

`monolith ui` must be run inside a directory that contains a MONOLITH
instance, and it does not open a browser — open the printed address yourself.
All commands: [CLI reference](./docs/reference/cli.md).

## Architecture

```text
Markdown artifact → Scriptorium (extraction) → ERG (relationship graph) → governed project memory

MONOLITH Kernel (src/)  ──►  Project Instance (.monolith/, monolith.config.json)
                                   │  safe, bounded reads
                                   ▼
                    Read model ──► loopback HTTP API ──► Mission Control UI
```

> **Kernel knows HOW. Instance knows WHAT.** The Kernel holds generic
> mechanics and has no hardcoded knowledge of any project; an Instance — the
> `.monolith/` directory of a project using MONOLITH, this repository
> included — supplies the project's own knowledge. Details:
> [`docs/architecture/`](./docs/architecture/README.md).

## Ecosystem

- **[Latysh Development](https://github.com/Demion-L)** — developer of MONOLITH.
- **[Webway](https://github.com/Demion-L/webway)** — a separate, independently developed project on semantic and associative knowledge linking. It was extracted from MONOLITH and has no runtime coupling to it.
- **SphynX** — a related application. MONOLITH does not depend on it, and this repository does not document it as a current consumer of MONOLITH.

## Community & Recognition

MONOLITH is listed as a contributor project on
[XERJ Corpus Hub](https://hub.xerj.org/contributors/Demion-L). At the time of
writing, the contributor page exists, a MONOLITH commit is selected, the corpus
status is `candidate` and the manifest is `draft`. This is a contribution
listing — not an official partnership, endorsement or certification.

## Documentation

- [CLI reference](./docs/reference/cli.md) — every command, `init`, `validate`, `brief`, `idea`, `mission`, `durable`, `ui`
- [Mission Control](./docs/reference/mission-control.md) — sections, LIVE/DEMO, skins, limitations
- [Security & Limitations](./docs/reference/security-and-limitations.md) — threat model, platform and filesystem caveats
- [Programmatic API](./docs/reference/write-scope-api.md) · [Development](./docs/reference/development.md)
- [Architecture](./docs/architecture/README.md) · [ADRs](./docs/adr/README.md) · [Knowledge-base index](./docs/README.md)
- [`AGENTS.md`](./AGENTS.md) — scope and entry point for AI assistants · [`MANIFESTO.md`](./MANIFESTO.md) — principles

## Project Status

**Alpha** (`0.1.0-alpha.0`). The API and CLI are experimental and may change
without notice. Published to npm under the alpha dist-tag. Durable State and the Coordinatorium
(`monolith durable`, `monolith mission`) are experimental and are not part of
the Quick Start.

**Security:** Mission Control is read-only, listens on `127.0.0.1` only and has
no authentication. Concurrent adversarial mutation of a project is unsupported;
Windows is unverified. Durable State is merged but its security acceptance is
still open. See [Security & Limitations](./docs/reference/security-and-limitations.md).

**Not yet implemented:** a write-enabled UI, authentication for Mission
Control, `monolith context <topic>`, `monolith status`, `monolith dry-run`, the
enforcement gate engine and integrity validators (type declarations only), and
protocol drift detection. `AGENTS.md` is the authoritative status record.

## License

[MIT](./LICENSE) © 2026 Dmytro Latysh
