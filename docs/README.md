---
type: meta
id: docs-index
authority: authoritative
---

# MONOLITH Knowledge Base

Navigation index for the MONOLITH research and architecture documentation.

This directory is the project's long-term knowledge base.
It is separate from the operational template (`templates/`), which is what instances deploy.

---

## Structure

```
docs/
├── README.md                        — this file
├── DOCUMENTATION_PRINCIPLES.md      — rules governing this knowledge base
│
├── research/                        — discoveries from external analysis
│   ├── README.md
│   ├── R-0001-iai-personal-memory-engine.md
│   ├── R-0002-oracle-memory-systems.md
│   └── R-0003-cognitive-architecture-notes.md
│
├── adr/                             — architectural decision records
│   ├── README.md
│   ├── ADR-004-terra-vs-graph-memex.md
│   ├── ADR-005-lexicon-mechanicus.md
│   └── ADR-006-terra-persistence-strategy.md
│
├── architecture/                    — current system description
│   ├── README.md
│   ├── cognitive-infrastructure.md
│   ├── memory-architecture.md
│   └── knowledge-pipeline.md
│
└── vision/                          — long-term direction
    ├── README.md
    └── long-term-vision.md
```

---

## Navigation by Question

| Question                                         | Go to                                                    |
| ------------------------------------------------ | -------------------------------------------------------- |
| Why does this project exist?                     | `../MANIFESTO.md`                                        |
| What external systems did we analyze?            | `research/`                                              |
| Why was this design choice made?                 | `adr/`                                                   |
| What does the system look like today?            | `architecture/`                                          |
| Where is the system going?                       | `vision/`                                                |
| What do these terms mean?                        | `architecture/cognitive-infrastructure.md` (Terminology) |
| What changed because of a research finding?      | Each `R-XXXX` document's **Research Outcomes** section   |

---

## Knowledge Flow

Research discovers → ADRs decide → Architecture reflects → Vision guides

See `DOCUMENTATION_PRINCIPLES.md` for the full hierarchy and cross-reference rules.
