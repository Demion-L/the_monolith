---
type: reference
id: reference-mission-control
authority: authoritative
stability: volatile
---

# Mission Control

Mission Control is a local, **read-only** web interface over a MONOLITH
project. It answers "where is this project right now?" without reading
`state.json` or governance files by hand. It never changes the project:
there is no write endpoint, it does not run `monolith validate`, and it does
not execute `project.definition.mjs` (ADR-010).

Start it with `monolith ui` — see the [CLI reference](./cli.md#monolith-ui).

## Sections

The active section is kept in the URL hash, e.g. `#roadmap`.

| Section | Shows |
|---|---|
| Project Overview | Project name, instance root, `state.json` schema/revision, mission counts |
| Current Mission | Active missions |
| Checkpoints | Latest checkpoints per active mission |
| Roadmap | Roadmap index of the instance |
| Diagnostics | Per-source read status (absent / forbidden / corrupt / unreadable) and notes |

## LIVE and DEMO

LIVE is the default: the page loads `GET /api/dashboard` from the server that
launched it, and a failed load is shown as an error — it never silently falls
back to sample data. DEMO (`?mode=demo`) shows built-in fixture data and is
only entered explicitly; it is marked `DEMO DATA`.

## Skins

*Classic* (default) and *Cosmic Glass* are two visual skins of the same
interface; the choice is stored in the browser (`localStorage`) and changes
nothing about the data.

## Limitations

Read-only; no authentication (loopback is not treated as authentication);
listens on `127.0.0.1` only and has no option to change that; one project per
server, fixed at start. See
[ADR-010](../adr/ADR-010-mission-control-ui.md) and
[Security & Limitations](./security-and-limitations.md).
