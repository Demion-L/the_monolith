/**
 * `monolith handover check` — report contract (ACCOUNTABILITY-001, Phase 5).
 *
 * A projection of facts Core already owns (read model, governance check, Story State Resolver, Development
 * History, ADR reader) plus verification evidence. It stores nothing and defines no new document. The JSON
 * form of this interface is the stable contract: fields are only ever added.
 *
 * Reading rules the report never breaks:
 *  - a finished mission does not mean a finalized story;
 *  - REPORTED evidence is not VERIFIED;
 *  - no finding does not mean the project is correct;
 *  - the status is about reviewability, never "production ready".
 */
export const HANDOVER_SCHEMA = 1;
