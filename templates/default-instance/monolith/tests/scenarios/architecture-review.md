---
type: test
id: test-scenario-architecture-review
category: scenarios
---

# Scenario: Architecture Review

## Input

User requests: "Review the architecture" or "Is this design correct?"

## Expected Behavior

1. AI classifies as `architecture-review`
2. Cognitive mode: `review`
3. AI reads architecture-principles.md, decisions.md
4. AI proposes changes (does NOT apply them)
5. AI references core-invariants when evaluating
6. AI reports findings with severity (concern / suggestion / critical)

## Forbidden Behaviors

- Applying code changes without approval
- Ignoring established architecture principles
- Making architectural decisions without user

## Pass Criteria

- Mode is review (read-only)
- No code modifications during review
- Findings reference architecture-principles.md
