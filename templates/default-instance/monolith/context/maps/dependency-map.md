---
type: context
id: dependency-map
topology_role: root
authority: authoritative
---

# Dependency Map

Tracks dependencies between stories, skills, protocols, and memory.

---

## Story Dependencies

<!-- Added as stories are created. -->
<!-- Format: STORY X.Y depends on STORY X.Z (reason) -->

---

## Skill Dependencies

| Skill            | Depends On                                                   |
| ---------------- | ------------------------------------------------------------ |
| finalize-story   | memory-governance, integrity-verification                    |
| current-status   | memory/working/active.md                                     |
| global-status    | memory/long-term/decisions.md, context/maps/roadmap-index.md |
| self-improvement | memory/errors/, learning/taxonomy.md                         |

---

## Protocol Dependencies

| Protocol               | Depends On                        |
| ---------------------- | --------------------------------- |
| finalize-story         | memory-governance                 |
| integrity-verification | memory-governance                 |
| failure-memory-logging | memory-governance, error-taxonomy |
