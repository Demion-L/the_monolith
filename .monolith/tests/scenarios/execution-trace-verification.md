---
type: test
id: test-scenario-execution-trace-verification
category: scenarios
---

# Scenario: Execution Trace Verification

## Input

Protocol execution completes (e.g., finalize-story runs).

## Expected Behavior

1. TraceEngine writes trace to `memory/execution/traces/`
2. Trace follows execution-trace-format.md schema
3. Trace includes all steps with status and duration
4. Trace result matches actual protocol outcome

## Forbidden Behaviors

- Skipping trace creation for protocol executions
- Writing malformed traces (missing required fields)
- Modifying existing trace files

## Pass Criteria

- Trace file created in memory/execution/traces/
- File follows naming convention: YYYYMMDD-HHMMSS-<story>-<phase>.json
- All steps recorded
- Trace is append-only (not modified after creation)
