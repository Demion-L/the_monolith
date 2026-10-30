---
type: context
id: semantic-map
topology_role: root
authority: authoritative
---

# Semantic Map

Where authoritative truth lives for each semantic domain.

---

## Memory Domain

| What                   | Authoritative Source                    |
| ---------------------- | --------------------------------------- |
| Active story           | `memory/working/active.md`              |
| Story history          | `memory/working/story-index.md`         |
| ADR index              | `docs/adr/README.md` (repo-relative, outside `.monolith/`) |
| Non-ADR decisions (`DEC-…`) | `memory/long-term/decisions.md`    |
| MONOLITH hypotheses    | `memory/long-term/hypotheses.md`        |
| Webway hypotheses and research | Not stored here — Webway repository (`docs/hypotheses.md`, `docs/research/`) |
| Knowledge regions map, Knowledge lifecycle | Not stored here — Webway repository (`docs/architecture/knowledge-regions.md`, `docs/architecture/knowledge-lifecycle.md`) |
| Story lifecycle        | `memory/long-term/story-lifecycle.md`     |
| Webway v1 research plan | Not stored here — Webway repository (`docs/webway-v1-research-plan.md`) — https://github.com/Demion-L/webway |
| Cognitive Core — semantic definition | Not stored here — Webway repository (`docs/architecture/cognitive-core.md`, `webway:ADR-002`) |
| Cognitive Core — execution and integration | `docs/adr/ADR-002-cognitive-core-foundation.md` (`monolith:ADR-002`) |
| Engineering Gate definition | `memory/long-term/engineering-gate.md` |
| Execution log          | `memory/long-term/execution-history.md` |
| Ideas (deferred thoughts) | `monolith idea list` / `show` — the CLI owns the files; nothing else reads or writes them |
| Error records          | `memory/errors/ERR-*.md`                |
| Captured ideas (`IDEA-NNN`) | `memory/long-term/ideas/IDEA-*.md`, written only by `monolith idea add` |

---

## Context Domain

| What               | Authoritative Source            |
| ------------------ | ------------------------------- |
| Task routing       | `context/maps/routing-map.md`   |
| Project navigation | `context/maps/project-map.md`   |
| Roadmap            | `context/maps/roadmap-index.md` |
| Session state      | `context/boot/HANDOFF.md`       |

---

## Skills Domain

| What             | Authoritative Source     |
| ---------------- | ------------------------ |
| Available skills | `skills/INDEX.md`        |
| Skill procedures | `skills/<name>/SKILL.md` |

---

## Protocols Domain

| What             | Authoritative Source                        |
| ---------------- | ------------------------------------------- |
| Boot order       | `protocols/boot/boot-sequence.md`           |
| Behavioral modes | `protocols/cognition/cognitive-modes.md`    |
| Memory rules     | `protocols/governance/memory-governance.md` |
| Core invariants  | `protocols/governance/core-invariants.md`   |

---

## Learning Domain

| What            | Authoritative Source            |
| --------------- | ------------------------------- |
| Error lessons   | `learning/mistakes/<category>/` |
| Injection rules | `learning/injection-map.md`     |
| Taxonomy        | `learning/taxonomy.md`          |

---

## Architecture Decisions Domain

| What                         | Authoritative Source                   |
| ---------------------------- | -------------------------------------- |
| ADR index                    | `docs/adr/README.md` (repo-relative, outside `.monolith/`) |
| Full ADR records             | `docs/adr/ADR-*.md` (the only location; ADR-001 and ADR-004 … 006 are Webway's) |

---

## Governance Domain

| What             | Authoritative Source        |
| ---------------- | --------------------------- |
| Governance rules | `governance/GOV-*.md`       |
| Rule schema      | `governance/RULE_SCHEMA.md` |
