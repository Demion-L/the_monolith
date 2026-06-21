---
type: protocol
id: protocol-local-llm-governance
category: execution
scope: system
enforcement: conditional
---

# Local LLM Governance

Rules for AI operations using local LLM models.

---

## When Local Model is Required

- Context contains `sensitive` or `restricted` data (per privacy-classification.md)
- User explicitly requests local execution
- Compliance requirements mandate on-premise processing

---

## Rules

1. **Capability check** — Verify local model is available before routing
2. **Fallback** — If local model unavailable: pause task, alert user, do not fall back to cloud for sensitive data
3. **Quality gate** — Local models may have lower capability; flag to user if confidence is low
4. **Audit** — Log all local model executions in execution traces

---

## Local Model Setup

Configure local model path in `monolith.config.json`:

```json
{
  "models": {
    "local": "ollama://llama3.2"
  }
}
```
