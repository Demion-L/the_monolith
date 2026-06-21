---
type: skill
id: skill-self-improvement
trigger: self-improvement
protocols:
  - failure-memory-logging
  - memory-governance
---

# Skill: Self Improvement

Analyze mistakes and extract reusable lessons into learning/mistakes/.

---

## Activation

Triggered by: "analyze mistake", "learn from error", "self improvement", "extract lesson"

---

## Steps

### Step 1 — Identify the error

Read error records from:

- `memory/errors/ERR-*.md` (if exists)
- Current conversation context
- User description of what went wrong

### Step 2 — Classify the error

Map to one of 8 categories from `learning/taxonomy.md`:
`architecture | dependencies | nonexistent-api | context-sync | workflow | typescript | documentation | other`

### Step 3 — Extract the lesson

Write a lesson file: `learning/mistakes/<category>/LESSON-YYYY-XXXX.md`

Format:

```markdown
# Lesson: What was learned

## Mistake

What went wrong.

## Root Cause

Why it happened.

## Prevention

What to check / do differently next time.

## Tags

comma, separated, searchable, terms
```

### Step 4 — Create error record (if not exists)

Create `memory/errors/ERR-YYYY-XXXX.md` following `memory/errors/SCHEMA.md`.

### Step 5 — Update learning index

If this opens a new category or pattern, note it in `learning/INDEX.md`.

---

## Post-conditions

- [ ] Lesson file created in `learning/mistakes/<category>/`
- [ ] Error record created or referenced
- [ ] Lesson is searchable (tags included)
