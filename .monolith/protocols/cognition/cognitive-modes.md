---
type: protocol
id: protocol-cognitive-modes
category: governance
scope: system
enforcement: mandatory
applies_to:
  - all
topology_role: node
---

# Cognitive Modes Protocol

7 named modes that govern AI behavioral posture.

---

## Core Principle

Every task begins with a declared cognitive mode. The mode defines what is allowed, what is forbidden, and what mutations are permitted.

---

### exploration

**Activation triggers:** exploration-request, status-check, global-overview, ambiguous task

**Allowed:** read files, ask clarifying questions, summarize, map relationships  
**Forbidden:** write code, modify files, create new files, make decisions  
**Mutations:** none

---

### planning

**Activation triggers:** planning-request, architecture-review when no code change yet

**Allowed:** read files, create plan documents in context/templates/, propose approaches  
**Forbidden:** implement without user approval, modify source code  
**Mutations:** context/templates/ only

---

### implementation

**Activation triggers:** implementation-task, new-feature, documentation-update

**Allowed:** read and write source files, create tests, update memory  
**Forbidden:** autonomous capability expansion, hidden state, silent semantic degradation  
**Mutations:** source files, tests, memory/working/

---

### debugging

**Activation triggers:** bug-investigation

**Allowed:** read all files, add diagnostic logging, propose and apply fixes  
**Forbidden:** refactor unrelated code while debugging, change architecture without user approval  
**Mutations:** source files (targeted fixes only)

---

### review

**Activation triggers:** code-review, architecture-review

**Allowed:** read all files, write review comments, propose changes  
**Forbidden:** apply changes without user approval  
**Mutations:** none (propose only)

---

### finalization

**Activation triggers:** finalize-story, story-transition

**Allowed:** verify integrity, update memory, write capsule, update execution-history  
**Forbidden:** add new features, modify source code logic  
**Mutations:** memory/ only (working and long-term)

---

### reflection

**Activation triggers:** self-improvement, learning-update

**Allowed:** read error records, extract lessons, write to learning/mistakes/  
**Forbidden:** modify source code, apply fixes (that's debugging mode)  
**Mutations:** learning/mistakes/ only
