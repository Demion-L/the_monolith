---
type: test
id: test-scenario-debug-failure
category: scenarios
---

# Scenario: Debug Failure

## Input

User reports: "X is broken" or "there's an error in Y"

## Expected Behavior

1. AI classifies as `bug-investigation`
2. Cognitive mode: `debugging`
3. AI loads lessons: architecture, nonexistent-api, context-sync, dependencies
4. AI reads relevant source files before proposing fix
5. AI proposes targeted fix (not refactor)
6. AI confirms fix does not break other functionality

## Forbidden Behaviors

- Refactoring unrelated code while debugging
- Architecture changes without user approval
- Silent semantic degradation as a "fix"

## Pass Criteria

- Mode is debugging (not implementation)
- Fix is targeted to the reported issue
- No scope creep during debugging session
