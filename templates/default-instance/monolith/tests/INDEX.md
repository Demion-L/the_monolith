---
type: reference
id: tests-index
authority: authoritative
---

# Tests Index

Declarative scenario tests and validator specifications for MONOLITH cognitive verification.

---

## Scenario Tests

Declarative expectations about cognitive system behavior for standard task types.

| Scenario                     | File                                              |
| ---------------------------- | ------------------------------------------------- |
| Implement Feature            | `tests/scenarios/implement-feature.md`            |
| Debug Failure                | `tests/scenarios/debug-failure.md`                |
| Architecture Review          | `tests/scenarios/architecture-review.md`          |
| Planning Request             | `tests/scenarios/planning-request.md`             |
| Finalize Story               | `tests/scenarios/finalize-story.md`               |
| Local LLM Delegation         | `tests/scenarios/local-llm-delegation.md`         |
| Sensitive Context Task       | `tests/scenarios/sensitive-context-task.md`       |
| Dry Run Activation           | `tests/scenarios/dry-run-activation.md`           |
| Execution Trace Verification | `tests/scenarios/execution-trace-verification.md` |
| Validator Verification       | `tests/scenarios/validator-verification.md`       |

---

## Validator Specs

Cognitive integrity validators that check consistency of the instance.

| Validator            | File                                       |
| -------------------- | ------------------------------------------ |
| Index                | `tests/validators/INDEX.md`                |
| Routing Integrity    | `tests/validators/routing-integrity.md`    |
| Protocol References  | `tests/validators/protocol-references.md`  |
| Mode Consistency     | `tests/validators/mode-consistency.md`     |
| Privacy Routing      | `tests/validators/privacy-routing.md`      |
| Delegation Semantics | `tests/validators/delegation-semantics.md` |

---

## Global Expectations

`tests/validation/expected-behavior.md` — overall cognitive behavior expectations.

---

## How to Use

These tests are declarative specifications, not runnable test suites.  
When validating MONOLITH behavior, an AI reviewer checks the system against these expectations.  
Future: `monolith validate` will run automated checks against these specs.
