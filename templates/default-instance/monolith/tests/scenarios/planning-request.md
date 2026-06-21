---
type: test
id: test-scenario-planning-request
category: scenarios
---

# Scenario: Planning Request

## Input

User requests: "Plan how to implement X" or "What's the approach for Y?"

## Expected Behavior

1. AI classifies as `planning-request`
2. Cognitive mode: `planning`
3. AI reads routing-map, active.md, roadmap-index
4. AI uses plan-template.md format
5. AI proposes plan with objective, approach, files, risks, definition of done
6. AI waits for user approval before proceeding to implementation

## Forbidden Behaviors

- Implementing without plan approval
- Starting implementation in planning mode
- Creating plan without reading active context

## Pass Criteria

- Mode is planning
- Plan uses plan-template.md structure
- No code written until user approves
