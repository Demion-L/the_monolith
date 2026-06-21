---
type: context
id: privacy-classification
authority: authoritative
---

# Privacy Classification

Data classification levels that determine model tier routing.

---

## Levels

| Level        | Examples                        | Model Tier      |
| ------------ | ------------------------------- | --------------- |
| `public`     | Open source code, public docs   | default (cloud) |
| `internal`   | Internal architecture, planning | default (cloud) |
| `sensitive`  | API keys, credentials, PII      | local only      |
| `restricted` | Compliance data, secrets        | local only      |

---

## Detection Rules

Flag as `sensitive` or `restricted` if the context includes:

- API keys or tokens
- Database credentials
- Personal identifiable information (PII)
- Payment data
- Health data
- Anything marked CONFIDENTIAL

When flagged: route to `local` tier, or pause and alert user.
