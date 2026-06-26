---
type: protocol
id: protocol-semantic-planning
category: cognition
scope: planning
enforcement: mandatory
applies_to:
  - planning-request
  - architecture-review
---

# Semantic Planning Protocol

How to conduct planning tasks in MONOLITH.

---

## When to Activate

- Task type is `planning-request`
- A new story requires upfront design
- Architecture review before implementation

---

## Steps

1. **Read context** — Read routing-map, active.md, roadmap-index
2. **Clarify objective** — One sentence: what does this plan achieve?
3. **Identify constraints** — What must NOT change?
4. **Propose approach** — 3-5 numbered steps, each actionable
5. **List affected files** — Specific paths, not "the codebase"
6. **Surface risks** — What could go wrong?
7. **Define done** — Measurable completion criteria
8. **Get user approval** — Do NOT implement without explicit "proceed"

---

## Output

Use `context/templates/plan-template.md` as the document format.

Store plan in `context/templates/` with a descriptive filename.

---

## Rules

- No implementation during planning mode
- Plans must be approved before any file is modified
- If scope changes during planning, restart from step 2
