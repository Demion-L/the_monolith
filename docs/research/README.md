---
type: meta
id: research-index
authority: authoritative
---

# Research Index

Catalog of external system analyses and literature reviews that informed MONOLITH architecture.

---

## Published Research

| ID      | Title                                    | Status    | Key ADRs          |
| ------- | ---------------------------------------- | --------- | ----------------- |
| R-0001  | Lessons Learned from IAI Personal Memory Engine | Complete | ADR-004, ADR-005 |
| R-0002  | Oracle Memory Systems                    | Complete  | ADR-004, ADR-006  |
| R-0003  | Cognitive Architecture Notes             | Complete  | ADR-005           |

---

## Research Document Structure

Each research document contains:

- **Executive Summary** — one paragraph distilling the most important finding
- **Background** — what system or concept was analyzed and why
- **Key Ideas** — the full set of ideas encountered
- **Confirmed Ideas** — ideas that align with MONOLITH's direction and were adopted
- **New Ideas** — ideas worth exploring that were not yet implemented
- **Rejected Ideas** — ideas that were explicitly rejected and why
- **Research Outcomes** — what actually changed inside MONOLITH because of this research
- **Follow-up ADRs** — decisions that emerged from this research
- **Open Questions** — unresolved questions for future research

---

## Research Principles

Research documents describe discoveries.
They do NOT define architecture.

The architectural consequence of a discovery lives in an ADR.
The current architectural state lives in `docs/architecture/`.
