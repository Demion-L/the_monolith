---
type: reference
id: learning-injection-map
authority: authoritative
---

# Learning Injection Map

Maps task types to lesson categories that should be loaded at boot step 8.

---

## Injection Rules

| Task Type              | Load Lesson Categories                                    |
| ---------------------- | --------------------------------------------------------- |
| `implementation-task`  | architecture, typescript, dependencies                    |
| `new-feature`          | architecture, dependencies                                |
| `bug-investigation`    | architecture, nonexistent-api, context-sync, dependencies |
| `code-review`          | architecture, typescript                                  |
| `finalize-story`       | workflow, architecture                                    |
| `architecture-review`  | architecture                                              |
| `planning-request`     | architecture                                              |
| `documentation-update` | documentation                                             |
| `self-improvement`     | all categories                                            |
| `learning-update`      | all categories                                            |
| `status-check`         | context-sync                                              |
| `global-overview`      | context-sync                                              |
| `story-transition`     | workflow                                                  |
| `exploration-request`  | context-sync                                              |

---

## Injection Threshold

Load lessons if they contain at least one of:

- A keyword matching the current task description
- A tag matching the current task type or cognitive mode
- A protocol name referenced in the current context

---

## Custom Injections

Add project-specific injection rules at the bottom of this file.

<!-- Example: -->
<!-- | `database-migration` | architecture, context-sync, workflow | -->
