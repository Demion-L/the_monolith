---
type: test
id: validator-privacy-routing
category: validators
---

# Validator: Privacy Routing

Checks that privacy classification and model routing are correctly defined.

## Checks

- [ ] `context/models/privacy-classification.md` exists with 4 levels
- [ ] `context/models/model-registry.md` exists with tier definitions
- [ ] routing-map Table 6 references model-registry.md
- [ ] `protocols/execution/hybrid-execution.md` exists
- [ ] hybrid-execution.md references privacy-classification.md
- [ ] `sensitive` level routes to local tier (not default cloud)
- [ ] `restricted` level routes to local tier (not default cloud)

## Pass Criteria

All checks PASS. Privacy routing chain is complete.
