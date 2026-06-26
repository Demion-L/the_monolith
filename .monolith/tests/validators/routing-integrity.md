---
type: test
id: validator-routing-integrity
category: validators
---

# Validator: Routing Integrity

Checks that routing-map.md is complete and internally consistent.

## Checks

- [ ] routing-map.md exists at `context/maps/routing-map.md`
- [ ] Has YAML frontmatter with `id: routing-map`
- [ ] Table 1 exists and has all 14 task types
- [ ] Table 2 exists and maps all task types to skills or "(no dedicated skill)"
- [ ] Table 3 exists and maps protocols to task types
- [ ] Table 4 exists and maps memory regions to task types
- [ ] Table 5 exists and maps learning categories to task types
- [ ] Table 6 exists and maps model tiers to task types
- [ ] Table 7 exists with fallback rules
- [ ] All skill references in Table 2 have corresponding SKILL.md files

## Pass Criteria

All 10 checks PASS.

## Failure Action

If any check fails: report missing/incomplete section, do not proceed with task until resolved.
