---
type: skill
id: skill-self-improvement
trigger: self-improvement
protocols:
  - memory-governance
---

# Skill: Self Improvement

Analyze mistakes, decide which are worth capturing, and extract reusable lessons.

---

## Activation

Triggered by:
- "analyze mistake", "learn from error", "self improvement", "extract lesson"
- As a sub-step of `finalize-story` (Step 2.5)

---

## Write Criteria

A lesson is written **only when all three conditions are true:**

| # | Criterion | Question to ask |
|---|---|---|
| 1 | **Recurrence risk** | Could this same mistake happen in a different story with different content? |
| 2 | **Non-obvious cause** | Is the prevention something other than "just do the task correctly"? |
| 3 | **Concrete prevention** | Is there a specific, actionable check to perform before/during next time? |

If any criterion is false → **SKIP**. Do not write a lesson file.

---

## Steps

### Step 1 — Collect candidates

Sources (use whichever are available):
- "Lessons Learned" section of the story capsule
- `memory/errors/ERR-*.md` records
- Current conversation context
- User description

### Step 2 — Decision table (mandatory output)

For every candidate, output a table **before writing any files:**

```
| Lesson (short) | Category | Recurs? | Non-obvious? | Concrete prevention? | Verdict |
|---|---|---|---|---|---|
| <lesson A>     | workflow  | yes     | yes          | yes                  | WRITE   |
| <lesson B>     | arch      | no      | yes          | yes                  | SKIP — one-time situational |
| <lesson C>     | workflow  | yes     | no           | no                   | SKIP — "do it right" |
```

This table is shown to the user. Only proceed to Step 3 after it is output.

### Step 3 — Write lesson files (WRITE verdicts only)

For each WRITE verdict, create `learning/mistakes/<category>/LESSON-YYYY-XXXX.md`:

```markdown
---
id: LESSON-YYYY-XXXX
date: YYYY-MM-DD
category: <category>
story: STORY X.Y — <title>
tags: comma, separated, terms
---

# Lesson: <what was learned — one line>

## Mistake

What went wrong, with enough context to recognize it next time.

## Root Cause

Why it happened. The structural reason, not the surface symptom.

## Prevention

**Before starting:** <specific check to perform>
**During execution:** <specific signal to watch for>

## Criteria check

- Recurs in other stories: yes — <why>
- Non-obvious cause: yes — <why>
- Concrete prevention: yes — <what exactly>
```

### Step 4 — Create error record (if a real failure occurred)

If the mistake caused actual damage (wrong output, broken code, lost work) — create `memory/errors/ERR-YYYY-XXXX.md` following `memory/errors/SCHEMA.md`.

If the mistake was caught before damage (process violation, skipped step) — skip this step.

### Step 5 — Report

Output summary:
- N candidates evaluated
- N lessons written (list filenames)
- N skipped (with one-line reason each)

---

## Post-conditions

- [ ] Decision table was output before writing any files
- [ ] Lesson files created for all WRITE verdicts
- [ ] Error record created only if actual damage occurred
- [ ] SKIP reasons recorded in the decision table (not in files)
