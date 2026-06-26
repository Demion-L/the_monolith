---
type: test
id: test-expected-behavior
category: validation
authority: authoritative
---

# Expected Behavior

Global cognitive behavior expectations for a MONOLITH instance.

---

## Boot Behavior

Every session MUST begin by reading:

1. AGENTS.md
2. project-map.md
3. routing-map.md
4. active.md
5. roadmap-index.md

Any deviation from boot sequence is a protocol violation.

---

## Task Classification

Every task MUST be classified into a task type before execution begins.

If classification is ambiguous: use `exploration-request` and ask for clarification.

---

## Memory Updates

Memory files (memory/working/) MUST be updated:

- After every story finalization
- When active story or phase changes
- When a significant architectural decision is made

---

## Protocol Compliance

- Core invariants apply to EVERY task, no exceptions
- Memory governance applies to EVERY memory operation
- Command policy applies to EVERY command execution

---

## Integrity Verification

- Integrity MUST be verified before reporting a story as done
- Governance MUST be evaluated before finalizing
- Traces MUST be written for all protocol executions

---

## Forbidden Patterns

| Pattern                         | Why Forbidden                                   |
| ------------------------------- | ----------------------------------------------- |
| Report-only completion          | Skips memory updates, leaves state inconsistent |
| Autonomous capability expansion | Violates scope and user trust                   |
| Hidden state                    | Prevents session recovery                       |
| Silent semantic degradation     | Corrupts understanding without warning          |
| Protocol bypass                 | Undermines enforcement guarantees               |
