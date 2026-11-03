---
type: idea
id: "IDEA-002"
title: "Decision Lineage & Supersession Tracking"
status: inbox
createdAt: "2026-11-03T13:14:41.683Z"
context: "LinkedIn community feedback (Blossom Iwunna) after the MONOLITH publication. Category: Cognitive Infrastructure / Knowledge Graph / Decision Management."
---

## Description

Origin: LinkedIn community feedback (Blossom Iwunna). The comment: "Decisions get buried in conversations" is the exact pain of building with AI across weeks. Curious how MONOLITH handles a decision that later gets reversed: does the graph keep the history, or only the current state?

Category: Cognitive Infrastructure / Knowledge Graph / Decision Management.

Problem: AI agents work with architectural and operational decisions that can change after new evidence, requirements or constraints appear. If the system stores only the latest decision, the history of reasoning is lost. If it stores all decisions without marking which are current, an agent risks using an outdated decision as the active one.

Hypothesis: MONOLITH can support an explicit history of decision evolution, keeping the original decisions, the reasons they were made, later changes, and the links between them.

Potential capabilities:
- Keep original decisions without overwriting their historical content.
- Support explicit SUPERSEDES / SUPERSEDED_BY relations.
- Distinguish active, revoked and superseded decisions.
- Keep the reasons for a change and the related evidence.
- Support querying the current active decision.
- Support reconstructing the history of changes.
- Let an agent explain why a previous decision no longer applies.
- Detect contradictory or ambiguous decision chains.

Example:
  D-001 "Use PostgreSQL", status: superseded
    -- SUPERSEDED_BY --> D-002 "Use alternative storage strategy", status: active, reason: new requirements
  What is the current decision? -> D-002. What was the previous decision? -> D-001. Why was D-001 replaced? -> New requirements.

Open architectural questions for future research (not to be solved now):
1. Where should the canonical decision model live?
2. Should the history be append-only?
3. How to represent REVOKED, SUPERSEDED, REINSTATED?
4. How to handle several competing decisions?
5. How to prevent cyclic supersession links?
6. How to build the current-state projection?
7. How to account for provenance and trust in evidence?
8. How to connect this to existing Mission, Story and Durable State?

Constraints: this is NOT an implemented MONOLITH capability. Existing execution history is not a decision-evolution model and must not be confused with one.

Status: inbox.

