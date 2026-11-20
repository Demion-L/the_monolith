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
| Project Overview | Project name, instance root, `state.json` schema/revision, active and finished mission counts, and the **Current Mission** card: the Current Story section of `active.md` shown as structured fields (story, title, status and other labelled lines when the format is recognised; otherwise a plain source preview), with its classification: no active story, story id(s), or `UNKNOWN` when the section cannot be classified. Active Coordinatorium missions are shown alongside as a separate record. Project Records summarise the other sources |
| Development History | Every mission (active, completed, failed, cancelled) from the operational state with its recorded story id, timeline (started, checkpoints, finished), checkpoints with their remaining steps and the final summary; status filter and search. Bounded (200 missions, 50 checkpoints each; a cut is said so). Nothing is inferred: a mission without checkpoints, story or summary says so. Project Overview also shows **Recent activity** (latest recorded events). The earlier `#checkpoints` link opens this section |
| Roadmap | Structured roadmap: phases from `roadmap-index.md` with their status, goal and details, and the active phase when the document names one explicitly. The original Markdown stays available under "View original Markdown" |
| Execution Graph | Interactive constellation view of execution relationships; unchanged by the Mission Control overview work |
| Knowledge Lab | Two independent sources behind tabs. **Ideas** (`monolith idea add`, `memory/long-term/ideas/IDEA-NNN.md`): id, title, status (`inbox`/`planned`/`archived`), captured date, description, context, tags, source path; search, status filter, details on demand; unreadable idea files are listed as INCOMPLETE; no ideas yet is distinct from a read error. Read-only: no editing and no Idea → Hypothesis lifecycle. **Hypotheses**: from `memory/long-term/hypotheses.md` (headings `## Title {#HYP-NNN}`): id, title, status as declared, short summary and expandable details. A source that cannot be read is shown as NOT AVAILABLE or as an error, never as an empty list; documents that are only partly readable are marked INCOMPLETE |
| Architecture Decisions | ADRs from `docs/adr/ADR-*.md`, from their frontmatter (`id`, `title`, `status`, `supersedes`, `superseded_by`) as declared; ids are case-sensitive and an id that differs from the file name is reported as an issue. Links between ADRs are shown, never derived. `docs/adr/README.md` is not a source |
| Diagnostics | Per-source read status (absent / forbidden / corrupt / unreadable) and notes |

> **Current Story vs. Coordinatorium Missions.** The *Current Mission* card on the
> overview presents the **Current Story** (`active.md`). Coordinatorium missions
> (`state.json`) are a different concept and are listed separately. There is no
> separate "Current Mission" navigation entry any more.

### Structured Roadmap

Phases and statuses are shown as **reported** by the document; Mission Control does not
confirm or derive them. A missing, contradictory or unmatched active-phase pointer is
shown as such. If the roadmap cannot be fully read, the panel shows a partial or error
notice with fixed diagnostic messages and the original Markdown, and the rest of the
interface keeps working. Each phase is a card (objective, stories, expandable details) with a colour-coded
status badge; the colour reflects the reported status text only, and unrecognised
statuses are shown neutral and marked as such. The roadmap cannot be edited from the
UI (see Limitations).

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
