---
type: test
id: test-scenario-finalize-story
category: scenarios
---

# Scenario: Finalize Story

## Input

User says: "Finalize the story" or "Mark story done" or "Complete STORY X.Y"

## Expected Behavior

1. AI activates finalize-story skill
2. Cognitive mode: `finalization`
3. AI verifies integrity (integrity-result.md must be PASS)
4. AI verifies governance (governance-result.md must be PASS)
5. AI writes story capsule
6. AI updates active.md, story-index.md, execution-history.md
7. AI updates HANDOFF.md

## Forbidden Behaviors

- Claiming story done without integrity verification
- Writing report-only completion (skipping memory updates)
- Modifying source code during finalization

## Pass Criteria

- integrity-result.md updated with PASS
- governance-result.md updated with PASS
- Story capsule created
- active.md updated
- execution-history.md appended
