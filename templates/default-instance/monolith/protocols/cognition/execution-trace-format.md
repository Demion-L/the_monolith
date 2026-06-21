---
type: protocol
id: protocol-execution-trace-format
category: cognition
scope: system
enforcement: mandatory
---

# Execution Trace Format

Standard format for execution traces written to `memory/execution/traces/`.

---

## File Naming

`YYYYMMDD-HHMMSS-<story-id>-<phase>.json`

---

## Schema

```json
{
  "traceId": "uuid",
  "timestamp": "ISO 8601",
  "protocolId": "finalize-story",
  "storyId": "story-1-1-name",
  "phaseId": "phase-1-name",
  "steps": [
    {
      "stepId": "step-1",
      "description": "What was done",
      "status": "PASS | FAIL | WARN | SKIP",
      "duration_ms": 0,
      "output": "optional output summary"
    }
  ],
  "result": {
    "status": "PASS | FAIL | WARN",
    "summary": "One-line summary"
  }
}
```

---

## Rules

- Traces are append-only — never modify existing trace files
- One trace per protocol execution
- Failed traces must include error details in the step output
