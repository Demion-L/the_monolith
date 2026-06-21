---
type: test
id: validator-protocol-references
category: validators
---

# Validator: Protocol References

Checks that all protocols referenced in routing-map exist as files.

## Checks

- [ ] `protocols/boot/boot-sequence.md` exists
- [ ] `protocols/cognition/cognitive-modes.md` exists
- [ ] `protocols/governance/memory-governance.md` exists
- [ ] `protocols/governance/command-policy.md` exists
- [ ] `protocols/governance/core-invariants.md` exists
- [ ] `protocols/governance/metadata-schema.md` exists
- [ ] All protocols referenced in routing-map Table 3 have corresponding files

## Pass Criteria

All referenced protocol files exist.

## Failure Action

Report missing protocols with their expected paths.
