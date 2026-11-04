---
type: idea
id: "IDEA-003"
title: "Existing Agent Instructions Compatibility"
status: inbox
createdAt: "2026-11-04T19:00:42.485Z"
context: "MONOLITH onboarding into existing projects that already contain AGENTS.md."
---

## Description

Problem: `monolith init` refuses to initialize an existing project when it conflicts with `AGENTS.md`. Refusing to overwrite is correct, but there is no safe mechanism for integrating existing agent instructions.

Proposed capability:
- Conflict detection.
- Preview of changes.
- Preservation of existing instructions.
- Explicit owner approval.
- Safe integration without blind Markdown merging.
- Fail without data loss on ambiguity.

Status: inbox. Future investigation only.
