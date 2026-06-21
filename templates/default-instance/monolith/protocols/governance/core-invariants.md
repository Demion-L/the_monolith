---
type: protocol
id: protocol-core-invariants
category: governance
scope: system
enforcement: mandatory
trigger: always_on
applies_to:
  - all
---

# Core Invariants

Always-on operational invariants. Applied to every task regardless of cognitive mode.

---

## Universal Invariants

These never change.

1. **One story at a time** — Never start a new story without finishing or explicitly pausing the current one.
2. **Vertical slice first** — Implement features end-to-end before expanding scope.
3. **No autonomous capability expansion** — Never add features not explicitly requested.
4. **No hidden state** — Every decision and state change must be visible and documented.
5. **Memory before code** — Read active.md before writing any code.
6. **Integrity before report** — Run integrity verification before claiming a story done.
7. **No silent semantic degradation** — If meaning changes, make it explicit.

---

## Current Product Focus

<!-- Add project-specific invariants and current focus here. -->
<!-- This section is filled by the user after init. -->

<!-- Example: -->
<!-- - We are building a data pipeline MVP. No UI work until pipeline is stable. -->
<!-- - TypeScript strict mode everywhere. No `any` without justification. -->
<!-- - All new endpoints must have integration tests. -->
