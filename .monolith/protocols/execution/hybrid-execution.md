---
type: protocol
id: protocol-hybrid-execution
category: execution
scope: system
enforcement: mandatory
---

# Hybrid Execution Protocol

Governance for hybrid local/cloud AI execution model.

---

## Model Tiers

| Tier            | When                                | Model                    |
| --------------- | ----------------------------------- | ------------------------ |
| cloud (default) | Public/internal data, general tasks | Default AI tool          |
| local           | Sensitive/restricted data           | Local LLM (if available) |

---

## Routing Decision

1. Classify context data using `context/models/privacy-classification.md`
2. If any data is `sensitive` or `restricted` → switch to local tier
3. If local model unavailable → pause and alert user
4. If data is `public` or `internal` → use default cloud model

---

## Rules

- Never send `sensitive` or `restricted` data to cloud models
- Always check privacy classification before starting a task with external data
- If in doubt, ask user to classify before proceeding
