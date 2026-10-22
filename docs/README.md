---
type: meta
id: docs-index
authority: authoritative
---

# MONOLITH Knowledge Base

Navigation index for MONOLITH's own architecture documentation.

This directory is the project's long-term knowledge base.
It is separate from the operational template (`templates/`), which is what instances deploy.

**2026-10-21:** The `research/` and `vision/` layers below, and ADR-004/005/006,
described Webway's cognitive-architecture research program rather than
MONOLITH's own toolkit, and were physically moved to
[the Webway repository](https://github.com/Demion-L/webway). See
`MIGRATION_REPORT.md` for the original (2026-06-28) reorganization and
`adr/README.md` for the move. This directory currently has no `research/`
or `vision/` layer of its own — add them back if MONOLITH's own toolkit
ever needs them.

---

## Structure

```
docs/
├── README.md                        — this file
├── DOCUMENTATION_PRINCIPLES.md      — rules governing this knowledge base
├── MIGRATION_REPORT.md              — 2026-06-28 docs/ reorganization record
├── webway-v0.md                     — historical pointer to Webway (extracted)
│
├── adr/                             — architectural decision records
│   ├── README.md
│   ├── ADR-007-explicit-identity-resolution.md
│   ├── ADR-008-coordinatorium-tactical-mission-lifecycle.md
│   ├── ADR-009-monolith-root-containment.md — accepted (SEC-001A)
│   └── ADR-010-mission-control-ui.md        — accepted (not implemented)
│
└── architecture/                    — current system description
    ├── README.md
    └── toolkit-pipeline.md
```

---

## Navigation by Question

| Question                                         | Go to                                                    |
| ------------------------------------------------ | -------------------------------------------------------- |
| Why does this project exist?                     | `../MANIFESTO.md`                                        |
| Why was this design choice made?                 | `adr/`                                                   |
| What does the system look like today?            | `architecture/`                                          |
| What do these terms mean?                        | `../AGENTS.md` (Glossary)                                |
| What was Webway, and why isn't it here anymore?  | `webway-v0.md`, `adr/README.md`                          |

---

## Knowledge Flow

ADRs decide → Architecture reflects.

See `DOCUMENTATION_PRINCIPLES.md` for the full hierarchy and cross-reference rules.
