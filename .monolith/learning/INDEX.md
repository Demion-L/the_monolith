---
type: reference
id: learning-index
authority: authoritative
---

# Learning Layer

Overview of the MONOLITH learning system for this project.

---

## Purpose

Capture lessons from mistakes and inject them into future tasks to prevent repetition.

---

## Structure

```
learning/
├── INDEX.md            — this file (navigation overview)
├── taxonomy.md         — 8 error categories
├── injection-map.md    — task type → lesson categories
└── mistakes/
    ├── architecture/         — architectural mistakes
    ├── dependencies/         — dependency/import errors
    ├── nonexistent-api/      — calling nonexistent methods/APIs
    ├── context-sync/         — memory/state sync errors
    ├── workflow/             — protocol violations
    ├── typescript/           — TypeScript errors
    └── documentation/        — missing or incorrect docs
```

---

## How Lessons Are Injected

At boot step 8, the AI reads `learning/injection-map.md` to determine which lesson categories to load based on the current task type.

Lessons are searched by filename, tags, and keywords. Matching lessons are prepended to the task context to prevent known mistakes.

---

## How to Add a Lesson

Use the `self-improvement` skill. Or manually create `LESSON-YYYY-XXXX.md` in the appropriate category directory.
