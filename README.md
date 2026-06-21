# @monolith/core

**MONOLITH** is a Cognitive Operating System (COS) for AI-native projects.

It provides deterministic governance, protocol enforcement, context management, execution validation, and cognitive infrastructure for AI-assisted development workflows.

---

## Core Design Principle

```text
Kernel knows HOW.
Instance knows WHAT.
```

The Kernel contains generic cognition infrastructure.

An Instance contains project-specific knowledge.

This separation allows the same cognitive system to be reused across multiple projects without embedding project knowledge into the core runtime.

---

## Why MONOLITH Exists

Most AI-assisted projects eventually encounter the same problems:

* Context becomes fragmented
* Memory becomes inconsistent
* Agent behavior becomes unpredictable
* Project conventions drift over time
* Decisions become difficult to trace
* Governance exists only in prompts

MONOLITH was created to solve these problems through deterministic, filesystem-native cognition.

Rather than relying on increasingly large prompts, MONOLITH externalizes cognition into inspectable artifacts, protocols, validators, and governance mechanisms.

---

## Architecture

MONOLITH separates cognition into two layers:

```text
@monolith/core
        │
        ▼
+------------------+
|      Kernel      |
+------------------+
| Routing          |
| Enforcement      |
| Integrity        |
| Validators       |
| CLI              |
+------------------+

        │

        ▼

+------------------+
|    Instance      |
+------------------+
| Protocols        |
| Memory           |
| Governance       |
| Context          |
| Skills           |
| Project Config   |
+------------------+
```

---

## Kernel

The Kernel contains generic cognition infrastructure and has zero knowledge of any specific project.

Responsibilities:

* Enforcement gate engine
* Integrity verification
* Protocol drift detection
* Semantic routing
* Context loading
* Validator execution
* CLI tooling

The Kernel answers:

```text
HOW should cognition work?
```

---

## Instance

An Instance contains project-specific knowledge.

Responsibilities:

* Protocol definitions
* Governance rules
* Memory structures
* Context maps
* Skills
* Project metadata

The Instance answers:

```text
WHAT exists in this project?
```

---

## Project Definition

Every instance contains a project definition.

```text
project.definition.js
```

This file acts as the contract between Kernel and Instance.

The Kernel never assumes:

* protocol names
* validator names
* artifact names
* directory layouts
* governance structures

All project-specific knowledge is supplied through the project definition.

---

## CLI

MONOLITH provides a CLI interface.

### Initialize a new instance

```bash
npx monolith init
```

Creates a new project instance from templates.

### Validate cognition infrastructure

```bash
npx monolith validate
```

Runs:

* configuration validation
* topology validation
* integrity validation
* governance validation

### Inspect system state

```bash
npx monolith status
```

Displays:

* active protocol
* current phase
* integrity status
* drift status
* validator status

### Simulate execution

```bash
npx monolith dry-run
```

Shows what MONOLITH would do before execution occurs.

---

## Current Status

Current Version:

```text
v0.1.0-alpha
```

Implemented:

* Productization Foundation
* Kernel / Instance Boundary
* Project Knowledge Extraction
* Instance Template System
* CLI Foundation
* Init Prototype

In Progress:

* Kernel Extraction
* Validate Prototype
* Standalone Runtime
* Repository Separation

Planned:

* Status Engine
* Dry-Run Engine
* Upgrade System
* Package Publishing

---

## Relationship to AI Second Brain

MONOLITH originated inside the AI Second Brain project.

It began as an attempt to improve project memory and context management.

Over time, the system evolved into a standalone Cognitive Operating System and was extracted into its own repository.

The original AI Second Brain instance continues to serve as the primary dogfood environment for MONOLITH development.

---

## Philosophy

MONOLITH is built around a small set of invariants:

```text
governance > capability

local models may suggest
primary cognition approves

critic challenges
primary cognition decides

Kernel knows HOW
Instance knows WHAT
```

The goal is not autonomous intelligence.

The goal is reliable, inspectable, governed cognition.

---

## Roadmap

Near-term:

* Complete Kernel extraction
* Implement validate
* Implement status
* Implement dry-run
* Publish first alpha release

Mid-term:

* Multi-project support
* Upgrade framework
* Instance migration tooling
* Cognitive observability

Long-term:

* Federated cognitive ecosystems
* Servitor architecture
* Organization-scale cognition layers

---

## License

MIT

---

## Project Status

```text
Birth Date:
21 June 2026
08:12 EEST (Helsinki)

Status:
ALIVE
```

MONOLITH became an independent repository on June 21, 2026 after evolving from the cognitive infrastructure of AI Second Brain into a standalone Cognitive Operating System.
