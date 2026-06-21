---
type: context
id: project-map
topology_role: root
authority: authoritative
---

# Project Map — {{PROJECT_NAME}}

Navigation guide for the cognitive architecture of this project.

---

## Memory

| Location                                                        | Purpose                 |
| --------------------------------------------------------------- | ----------------------- |
| `{{MONOLITH_ROOT}}/memory/working/active.md`                    | Active phase and story  |
| `{{MONOLITH_ROOT}}/memory/working/story-index.md`               | Implementation history  |
| `{{MONOLITH_ROOT}}/memory/long-term/decisions.md`               | Architectural decisions |
| `{{MONOLITH_ROOT}}/memory/long-term/architecture-principles.md` | Core principles         |
| `{{MONOLITH_ROOT}}/memory/long-term/tech-debt.md`               | Tech debt registry      |
| `{{MONOLITH_ROOT}}/memory/long-term/execution-history.md`       | Finalization log        |

---

## Context

| Location                                           | Purpose                |
| -------------------------------------------------- | ---------------------- |
| `{{MONOLITH_ROOT}}/context/maps/routing-map.md`    | Task type → activation |
| `{{MONOLITH_ROOT}}/context/maps/roadmap-index.md`  | Phases and progress    |
| `{{MONOLITH_ROOT}}/context/maps/semantic-map.md`   | Where truth lives      |
| `{{MONOLITH_ROOT}}/context/maps/dependency-map.md` | Artifact dependencies  |
| `{{MONOLITH_ROOT}}/context/boot/HANDOFF.md`        | Session transfer       |

---

## Skills

| Skill                                                | Trigger          |
| ---------------------------------------------------- | ---------------- |
| `{{MONOLITH_ROOT}}/skills/finalize-story/SKILL.md`   | finalize story   |
| `{{MONOLITH_ROOT}}/skills/current-status/SKILL.md`   | status check     |
| `{{MONOLITH_ROOT}}/skills/global-status/SKILL.md`    | global overview  |
| `{{MONOLITH_ROOT}}/skills/self-improvement/SKILL.md` | self improvement |

---

## Protocols

| Protocol                                                      | Purpose               |
| ------------------------------------------------------------- | --------------------- |
| `{{MONOLITH_ROOT}}/protocols/boot/boot-sequence.md`           | Session startup order |
| `{{MONOLITH_ROOT}}/protocols/cognition/cognitive-modes.md`    | Behavioral modes      |
| `{{MONOLITH_ROOT}}/protocols/governance/memory-governance.md` | Memory rules          |
| `{{MONOLITH_ROOT}}/protocols/governance/core-invariants.md`   | Always-on rules       |

---

## Project Structure

<!-- Describe your project's source code structure here. -->
<!-- Example: -->
<!-- | Directory | Purpose | -->
<!-- |-----------|---------|  -->
<!-- | `src/` | Application source code | -->
<!-- | `packages/` | Shared packages | -->
<!-- | `apps/` | Application entry points | -->
