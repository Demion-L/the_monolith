---
type: idea
id: "IDEA-004"
title: "SPEC-001 Interactive Specification Gateway"
status: inbox
createdAt: "2026-11-18T16:43:19.254Z"
context: "Owner concept for archival only; research backlog, deferred."
---

## Description

Status: PROPOSED / RESEARCH BACKLOG. Implementation: NOT STARTED. Priority: DEFERRED. Owner approval: concept approved for archival only. This is NOT an approved MONOLITH architecture.

Problem: MONOLITH assumes structured project requirements, but a user often cannot prepare a full technical specification. Without a requirements-clarification step, AI developers may make unapproved product and architectural decisions on their own.

Proposed capability: an interactive layer that turns user intent into a formalized specification usable by the existing MONOLITH workflow, before planning and execution.

Mode A - Discovery: the user describes an idea in free language. The gateway extracts functional and non-functional requirements, detects uncertainties and contradictions, asks necessary clarifying questions, proposes solution options, explicitly separates user requirements from its own assumptions, and produces a draft specification. The dialogue is adaptive: do not ask what is already known, do not turn project setup into an endless interview.

Mode B - Specification Import: the user uploads an existing specification (Markdown, plain text, PDF, DOCX, other formats where a text-extraction mechanism exists). The gateway finds gaps and converts it into a structured MONOLITH specification. Format support is a future requirement, not a claim about existing Core capabilities.

Mode C - Specification Refinement (perspective): after requirements change, potentially compute diffs between specification versions, find related requirements, analyze impact, show affected Stories/ADRs/components where confirmed links exist, produce a Change Proposal and request an owner decision. Investigate reuse of Dependency Impact Analysis principles from DISCOVERY-TS-IMPACT-001; code dependencies and requirement dependencies are not equivalent.

Proposed MVP: (1) enter an idea or upload a text specification, (2) requirements analysis, (3) dialogue resolving material uncertainties, (4) structured Markdown generation, (5) review and editing, (6) explicit owner approval, (7) hand-off of the approved specification to the existing MONOLITH workflow. No separate storage system, no complex multi-agent orchestration, no new infrastructure if existing mechanisms suffice.

Architecture principles: Git remains the authoritative source of truth; the gateway is not an independent normative store. Keep Draft, Approved Specification and Change Proposal separate. AI may propose requirements and decisions but must not present its assumptions as confirmed user wishes. An approved specification is never changed automatically; every change passes an explicit Approval Gate. Preserve requirement provenance where technically possible.

Possible future integration to investigate: MONOLITH Discovery, Project Execution Graph, Requirements Traceability, Dependency Impact Analysis, existing Read Model, Mission Control UI. Target chain (a target concept, not implemented): Requirement -> Story -> Implementation -> Test -> Evidence.

Non-goals for now: implementing the gateway, a new backend, UI, changes to Core, Durable State, Coordinatorium, dependencies, Roadmap, ADRs, or the current Project Execution Graph scope.

