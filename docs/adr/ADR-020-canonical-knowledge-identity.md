---
type: adr
id: ADR-020
title: Canonical Knowledge Identity and Deterministic Reference Resolution in the ERG
status: accepted
date: 2026-10-28
supersedes: ADR-007
related_adrs:
  - ADR-007
  - ADR-011
---

# ADR-020 — Canonical Knowledge Identity and Deterministic Reference Resolution in the ERG

> **Supersedes [ADR-007](ADR-007-explicit-identity-resolution.md)** (concept-slug
> identity, `id:`/`title:` aliases, first-document-wins, synthesized nodes).
> ADR-007 is kept unchanged as the record of what was decided in 2026-06 and why;
> its status is `superseded` and points here.
>
> **Acceptance basis.** The model below was implemented and merged by ERG-001A
> (`d3bfc3e`, `93ca3b4`; integrated by `08a2f98`). This ADR records it; it does not
> introduce behavior. No independent review of the ADR text has been recorded.

---

## Context

ADR-007 solved a real mismatch (documents referenced as `ADR-004` produced nodes named by
their H1 text) by registering `id:` and `title:` as **aliases** of a concept-slug node,
letting the first document win a collision and synthesizing placeholder nodes for
references that did not resolve. ERG-001A removed all four mechanisms:

- *Identity came from a title.* A node's name was the slug of a heading, so renaming a
  heading changed identity, and two unrelated headings with the same words were one node.
- *Aliases made one object answer to several names.* `title:` aliases in particular tied
  resolution to prose.
- *First-wins hid errors.* A duplicate `id` silently made one document unreachable
  (ADR-013 had to add a grep check for it).
- *Synthesized nodes made a missing target look like a node.* A relationship to a document
  that does not exist produced an edge to an invented node.

What ADR-007 got right — resolution is explicit-only, with no fuzzy matching, no
embeddings, no filename or similarity heuristics — is kept.

---

## Decision

### 1. The node is a `KnowledgeObject`

A graph node is a `KnowledgeObject` (`src/graph/identity.ts`):
`{ ref, namespace, localId, kind: 'document' | 'section', title?, status?, location }`.
There are no concept nodes, alias nodes or synthesized nodes. Concepts extracted by
Scriptorium remain Scriptorium output; they are not graph identity.

### 2. Identity is `namespace:localId`

`ref = namespace:localId`. Neither part is derived from a title, a path or a slug.

- `namespace` is **supplied by the caller** for a whole artifact (`ScriptoriumInput.namespace`).
  It is never inferred from content or location.
- `localId` is **declared in the artifact** (section 3).
- Both parts match `[A-Za-z0-9][A-Za-z0-9._-]*`: no `:`, whitespace or braces. A
  declaration with an invalid `localId`, or an artifact with a missing or invalid
  `namespace`, gets an `error` diagnostic and creates no object (the artifact's
  relationships create no edges).
- Identifiers are **case-sensitive**: `ADR-007` and `adr-007` are different ids.

### 3. Document and section identity

- **Document:** the frontmatter `id:` declares a `document` object. An artifact without
  `id:` declares none.
- **Section:** a heading with a trailing `{#ID}` marker declares a `section` object. The
  marker is removed from the heading text; the text becomes the object's `title`.
- A section ref is `namespace:ID`, flat in the same namespace as documents — a section id
  and a document id that are equal are an identity conflict (section 5). `title:` is
  metadata; it is never matched.

### 4. One deterministic resolver

`resolveRef(raw, sourceNamespace, index)` returns exactly one of:

| Status | Meaning |
| ------ | ------- |
| `RESOLVED` | Exactly one object holds the ref |
| `MISSING` | The namespace is loaded and no object holds the ref |
| `AMBIGUOUS` | More than one object holds the ref; all candidates are returned, none chosen |
| `EXTERNAL_UNAVAILABLE` | The reference names a namespace for which no artifact was loaded |
| `INVALID_REF` | The text is not a syntactically valid reference |

An edge exists **only** for `RESOLVED`. Every other result is recorded as an
`UnresolvedReference` with its status, the raw text, the source and the evidence id.
Output is a function of the set of inputs, not of their order (a total order over
candidates, nodes, edges and unresolved references).

### 5. Conflicts

Two or more declarations of the same `ref` are an **identity conflict**. None of them
becomes a node; the conflict is reported (`conflicts`, an `error` diagnostic naming every
location); a reference to that ref resolves to `AMBIGUOUS`; and relationships *from* a
document in conflict create no edges. There is no first-wins and no tie-break rule.

### 6. Cross-namespace references

- A **qualified** reference `ns:id` is looked up in `ns`.
- An **unqualified** reference `id` is looked up **only in the source artifact's own
  namespace**. There is no search across namespaces.
- A namespace that was not loaded is `EXTERNAL_UNAVAILABLE`, which is not the same as
  `MISSING`: the first says "this corpus was not given", the second "the corpus was given
  and does not contain it". Neither is turned into a node or an edge.

### 7. What does not exist, and must not be added without a new ADR

No synthetic nodes; no aliases (neither from `id:` nor `title:`); no first-wins; no fuzzy,
edit-distance, substring, filename, embedding or LLM matching; no cross-namespace search;
no auto-creation of a `{#ID}` or an alias to make a `MISSING` go away.

---

## Rationale

- Identity that is **declared** can be audited and survives a heading rewrite; identity
  derived from prose cannot.
- A missing target is information. Reporting it as `MISSING` / `EXTERNAL_UNAVAILABLE`
  keeps the graph's edges true and the gaps visible; synthesizing or aliasing it hides them.
- A duplicate declaration is an authoring error with no correct automatic answer. Making
  both unresolvable and listing both is the only outcome that does not pick a side.
- Namespaces let two corpora with colliding local ids coexist without a global rule.

## Alternatives considered

- **Keep ADR-007 and patch collisions** — still derives identity from titles, still hides
  duplicates. Rejected.
- **Global ids, no namespace** — one corpus collision breaks everything. Rejected.
- **Warn and pick the first on conflict** — reintroduces silent loss. Rejected.
- **Search all namespaces for an unqualified id** — makes a reference's meaning depend on
  what else was loaded. Rejected.

## Consequences

- Becomes easier: every edge and every non-edge has a cause; results are reproducible.
- Becomes harder: a corpus must declare ids (and `{#ID}` for sections) and the caller must
  choose a namespace; references to documents without them stay unresolved.
- Renaming an `id:` still breaks references to it — but now as a visible `MISSING`, not a
  silent alias loss (TD-002 described it as silent breakage).

## Not decided here

KNOWLEDGE-003 did not touch the corpus. As recorded by the owner on 2026-10-28 and **not
re-measured here**, these stay separate technical tasks: the production namespace
configuration; 28 `MISSING`; 59 conflicts between mirrored corpora; the YAML parser; the
absence of `{#ID}` in the current corpus.

## References

- [ADR-007](ADR-007-explicit-identity-resolution.md) — superseded.
- `src/graph/identity.ts`, `src/graph/resolver.ts`, `src/graph/builder.ts`, `src/graph/types.ts`.
- `src/scriptorium/compile.ts`, `src/scriptorium/markdown.ts` — declarations, `{#ID}` markers.
- `src/scripts/dogfood-graph.ts` — read-only identity statistics on stdout.
- `webway:ADR-004`, `webway:ADR-005` — provenance model and naming conventions cited by ADR-007.
