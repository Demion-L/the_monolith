---
type: context
id: routing-map
topology_role: root
---

# Routing Map

## Purpose

Declarative activation map. Given a task type, resolves:

- which cognitive mode to apply
- which skill to activate
- which protocols to enforce
- which memory regions to load
- which learning categories to inject
- what model tier to use

---

## Table 1 — Task Type → Cognitive Mode

| Task Type            | Cognitive Mode |
| -------------------- | -------------- |
| finalize-story       | finalization   |
| implementation-task  | implementation |
| new-feature          | implementation |
| bug-investigation    | debugging      |
| architecture-review  | review         |
| code-review          | review         |
| planning-request     | planning       |
| exploration-request  | exploration    |
| status-check         | exploration    |
| global-overview      | exploration    |
| learning-update      | reflection     |
| self-improvement     | reflection     |
| story-transition     | finalization   |
| documentation-update | implementation |

Reference: `{{MONOLITH_ROOT}}/protocols/cognition/cognitive-modes.md`

---

## Table 2 — Task Type → Skills

| Task Type            | Primary Skill        |
| -------------------- | -------------------- |
| finalize-story       | finalize-story       |
| status-check         | current-status       |
| global-overview      | global-status        |
| self-improvement     | self-improvement     |
| implementation-task  | (no dedicated skill) |
| new-feature          | (no dedicated skill) |
| bug-investigation    | (no dedicated skill) |
| architecture-review  | (no dedicated skill) |
| code-review          | (no dedicated skill) |
| planning-request     | (no dedicated skill) |
| exploration-request  | (no dedicated skill) |
| learning-update      | self-improvement     |
| story-transition     | finalize-story       |
| documentation-update | (no dedicated skill) |

Skill files: `{{MONOLITH_ROOT}}/skills/`

---

## Table 3 — Task Type → Protocols

| Task Type            | Protocols                                                 |
| -------------------- | --------------------------------------------------------- |
| finalize-story       | finalize-story, memory-governance, integrity-verification |
| implementation-task  | memory-governance, command-policy                         |
| new-feature          | memory-governance, command-policy                         |
| bug-investigation    | memory-governance, command-policy                         |
| architecture-review  | memory-governance, core-invariants                        |
| code-review          | memory-governance, command-policy                         |
| planning-request     | memory-governance, semantic-planning                      |
| exploration-request  | memory-governance                                         |
| status-check         | memory-governance                                         |
| global-overview      | memory-governance                                         |
| learning-update      | memory-governance, failure-memory-logging                 |
| self-improvement     | memory-governance, failure-memory-logging                 |
| story-transition     | memory-governance, finalize-story                         |
| documentation-update | memory-governance                                         |

---

## Table 4 — Task Type → Memory Regions

| Task Type           | Memory Regions                                                         |
| ------------------- | ---------------------------------------------------------------------- |
| finalize-story      | working/active, working/story-index, long-term/execution-history       |
| implementation-task | working/active, long-term/architecture-principles                      |
| new-feature         | working/active, long-term/decisions, long-term/architecture-principles |
| bug-investigation   | working/active, long-term/tech-debt                                    |
| architecture-review | working/active, long-term/decisions, long-term/architecture-principles |
| planning-request    | working/active, context/maps/roadmap-index                             |
| status-check        | working/active, context/maps/roadmap-index                             |
| global-overview     | working/active, long-term/decisions, context/maps/roadmap-index        |
| self-improvement    | learning/mistakes, memory/errors                                       |

---

## Table 5 — Task Type → Learning Hooks

| Task Type           | Learning Categories                         |
| ------------------- | ------------------------------------------- |
| finalize-story      | workflow, architecture                      |
| implementation-task | architecture, typescript, dependencies      |
| new-feature         | architecture, dependencies                  |
| bug-investigation   | architecture, nonexistent-api, context-sync |
| code-review         | architecture, typescript                    |
| self-improvement    | all categories                              |

---

## Table 6 — Task Type → Model Tier

| Task Type            | Model Tier |
| -------------------- | ---------- |
| implementation-task  | default    |
| new-feature          | default    |
| architecture-review  | default    |
| planning-request     | default    |
| finalize-story       | default    |
| bug-investigation    | default    |
| code-review          | default    |
| exploration-request  | default    |
| status-check         | default    |
| global-overview      | default    |
| self-improvement     | default    |
| documentation-update | default    |

Model registry: `{{MONOLITH_ROOT}}/context/models/model-registry.md`
Privacy rules: `{{MONOLITH_ROOT}}/context/models/privacy-classification.md`

---

## Table 7 — Fallback Routing Rules

| Condition                      | Resolution                                    |
| ------------------------------ | --------------------------------------------- |
| Task type unclear              | Use exploration mode. Ask for clarification.  |
| Multiple task types applicable | Use the most restrictive cognitive mode.      |
| No matching skill              | Execute task inline without a skill template. |
| Sensitive data in context      | Override to local model tier.                 |
