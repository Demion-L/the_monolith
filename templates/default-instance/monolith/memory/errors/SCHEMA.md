---
type: schema
id: error-schema
category: errors
authority: authoritative
---

# Error Record Schema

Schema for error records in `memory/errors/`.

## Format

Filename: `ERR-YYYY-XXXX.md` where YYYY = year, XXXX = sequential ID.

## Fields

```yaml
---
id: ERR-YYYY-XXXX
date: YYYY-MM-DD
category: architecture | dependencies | nonexistent-api | context-sync | workflow | typescript | documentation | other
severity: critical | high | medium | low
story: STORY X.Y — Story Name (optional)
resolved: true | false
---
```

## Body

```markdown
## Error Description

What went wrong.

## Root Cause

Why it happened.

## Resolution

How it was fixed.

## Prevention

How to avoid in future (becomes a lesson in learning/mistakes/).
```
