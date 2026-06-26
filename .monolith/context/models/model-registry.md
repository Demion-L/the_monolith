---
type: context
id: model-registry
authority: authoritative
---

# Model Registry

Available AI models and their capability tiers for this project.

Reference: `context/models/privacy-classification.md`

---

## Tiers

| Tier      | Description                    | Use When                            |
| --------- | ------------------------------ | ----------------------------------- |
| `default` | Cloud model (e.g. Claude Opus) | General tasks, public/internal data |
| `local`   | Local LLM (e.g. Ollama)        | Sensitive/restricted data           |

---

## Default Model

**Tool:** claude  
**Default tier:** cloud

---

## Privacy Override

When context contains `sensitive` or `restricted` data:
→ Switch to `local` tier if available
→ Otherwise: proceed with caution and flag to user

See: `protocols/execution/hybrid-execution.md`
