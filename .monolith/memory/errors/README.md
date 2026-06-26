# Error Memory

This directory stores failure records for this project.

## Structure

```
memory/errors/
├── SCHEMA.md       — format for ERR-*.md files
├── TAXONOMY.md     — 8 error categories
└── ERR-*.md        — individual error records (created at runtime)
```

## When to Create a Record

Create an `ERR-*.md` file when:

- A significant error occurred during implementation
- A misunderstanding caused wrong behavior
- A pattern of mistakes was identified

## How to Create

Use the `self-improvement` skill or manually create `ERR-YYYY-XXXX.md` following `SCHEMA.md`.

Lessons extracted from errors live in `learning/mistakes/<category>/`.
