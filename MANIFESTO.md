# MONOLITH — Engineering Manifesto

---

## Why MONOLITH Exists

AI-assisted development produces knowledge fast and loses it just as fast.
Decisions get made in a conversation and forgotten by the next session.
Architecture drifts from what the docs say. A new AI session has no way to
know what was already tried, decided, or rejected.

MONOLITH exists to keep that knowledge structured, consistent, and
traceable: an open-source project knowledge and governance toolkit for
AI-assisted development. It helps developers organize ideas, track
progress, preserve architectural decisions, and maintain project context
across AI sessions, keeping complex AI-driven projects structured,
consistent, and understandable.

---

## Engineering Before Hype

An idea that sounds convincing is not a contribution. In MONOLITH, ideas
enter the engineering lifecycle or they do not enter the project:

```
Idea → ADR → Story → Implementation → Dogfood → Validation
```

Each step is a gate. ADRs record what was decided and why. Stories
implement the decision as a vertical slice. Dogfooding runs it against
MONOLITH's own corpus. Validation measures whether it did what it claimed.

Nothing skips steps.

---

## Architecture Over Technology

Memory is not a database. A relationship is not a database row.

These are architectural concepts. The technology chosen to implement them
is a secondary decision — one that can change without altering the
underlying architecture. The Explicit Relationship Graph is a navigation
model (typed edges resolved from explicit frontmatter), not a graph-library
choice. Decisions made at the architectural level should remain valid when
technology choices are revisited.

Architecture should endure. Technologies may not.

---

## Separation of Responsibilities

Every subsystem in MONOLITH answers exactly one question:

| Subsystem                    | Question                                         |
| ----------------------------- | ------------------------------------------------- |
| Scriptorium                  | What did this markdown artifact actually say?    |
| Explicit Relationship Graph  | How is this document connected to others — explicitly, not inferred? |
| Coordinatorium               | What missions are in flight, and who holds the lock? |

No subsystem owns multiple responsibilities. A system that conflates
ingestion with navigation, or state with locking, produces architecture
that cannot evolve independently. This principle governs every subsystem
before it is added.

---

## Determinism Over Inference

Scriptorium and the Explicit Relationship Graph are deterministic by
design: the same input always produces the same output, and every
relationship edge traces back to an explicit frontmatter field — no fuzzy
matching, no aliases, no LLM call in the governance path (ADR-020, which supersedes ADR-007).
An AI assistant reading MONOLITH's own memory should be able to trust it
without re-verifying it.

---

## Evolution

The project has evolved, and that evolution was not planned in advance.

**Second Brain** revealed that AI assistants needed structured memory and
persistent context to be genuinely useful across sessions. It was not a
governance toolkit — it was the problem that motivated one.

**MONOLITH** emerged from the need to govern AI behavior with deterministic
enforcement, not just suggestion: protocols, skills, cognitive modes, and
file-based memory governance, built around Scriptorium and the Explicit
Relationship Graph.

Along the way, an orthogonal, much larger research question — how a
cognitive system might discover non-obvious semantic relationships across
knowledge domains, not just the explicit ones a document declares — grew
inside the same repository under the name Webway. That research direction
deserved its own project, with its own pace and its own scope, rather than
remaining a vision tangled into MONOLITH's own mission statement. It now
continues independently as [Webway](https://github.com/Demion-L/webway).
The original framing of that ambition is preserved there, not erased:
see Webway's `docs/vision/cognitive-kernel-origin.md`.

---

## Long-Term Goal

The objective is not to build another AI assistant, and it is not to
discover a general theory of cognition.

The objective is to keep AI-assisted projects — their knowledge,
decisions, and progress — structured, consistent, and understandable
across sessions, through deterministic, composable engineering rather than
an AI assistant's unaided memory.

Progress is measured by what has been validated, not by what has been
claimed.

---

## Closing

We are not building a mind.

We are building a record that an AI assistant — and the people working
with it — can actually trust.
