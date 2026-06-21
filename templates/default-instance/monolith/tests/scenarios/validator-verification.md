---
type: test
id: test-scenario-validator-verification
category: scenarios
---

# Scenario: Validator Verification

## Input

`monolith validate` (or `verify-integrity.js`) is run.

## Expected Behavior

1. Validator reads project.definition.js
2. Validator checks all required memory files exist
3. Validator checks routing-map structure (7 tables, 14 task types)
4. Validator checks cognitive-modes (7 modes with activation triggers)
5. Validator checks governance directory exists
6. Validator outputs PASS or FAIL with details

## Forbidden Behaviors

- Passing with missing required files
- Silently skipping checks
- Reporting PASS when structural issues exist

## Pass Criteria

- All required files verified
- Routing map tables validated
- Cognitive modes validated
- Clear PASS/FAIL output with details
