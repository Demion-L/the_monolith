---
type: test
id: validator-delegation-semantics
category: validators
---

# Validator: Delegation Semantics

Checks that model delegation semantics are correctly and completely defined.

## Checks

- [ ] model-registry.md defines at least `default` tier
- [ ] model-registry.md defines `local` tier (can be null if not used)
- [ ] routing-map Table 6 assigns a tier to every task type
- [ ] No task type is missing a tier assignment
- [ ] hybrid-execution.md defines fallback behavior for unavailable local model
- [ ] monolith.config.json models section is present and valid

## Pass Criteria

All task types have model tier assignments. Fallback behavior is defined.
