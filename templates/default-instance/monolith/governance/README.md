# Governance

This directory stores active governance rules for this project.

## Structure

```
governance/
├── RULE_SCHEMA.md   — format for GOV-*.md files
├── README.md        — this file
└── GOV-*.md         — active governance rules (created at runtime)
```

## What Are Governance Rules?

Rules created when repeated failure patterns are detected. They encode project-specific behavioral constraints that the AI assistant must follow.

Unlike `protocols/governance/core-invariants.md` (universal rules), GOV-\*.md files are project-specific and evolve with the project.

## Lifecycle

1. A failure pattern is detected (via self-improvement skill or governance evaluation)
2. A `GOV-*.md` file is created following `RULE_SCHEMA.md`
3. The rule is enforced on subsequent sessions via the governance gate
4. Rules can be superseded or archived when no longer relevant

## Governance Evaluation

Run `monolith validate` to check for rule violations.
