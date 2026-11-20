/**
 * `runGovernanceCheck(projectRoot)` — read-only governance integrity report (GOV-EVOLUTION Phase 5).
 *
 * No second parser: every area is read from what Core already computes — the Mission Control
 * read model (`readDashboardModel`: Roadmap parser, Story Index parser, Story State Resolver,
 * ADR/Hypotheses/Ideas readers, Development History) and `validateProject` for the scaffold.
 * The only new logic is the structural check of story capsules (`capsules.ts`) and the mapping of
 * Core's own diagnostics onto INFO / WARNING / ERROR. Nothing is written, no LLM, no network,
 * no timestamps: unchanged files give an identical report.
 *
 * `monolith validate` keeps its contract (scaffold checks); this report is separate and is never
 * a precondition of `monolith finalize`.
 */
import type { DashboardReadModel } from '../readmodel/index.js';
import type { GovernanceReport } from './types.js';
export declare function buildGovernanceReport(projectRoot: string, model?: DashboardReadModel): GovernanceReport;
//# sourceMappingURL=check.d.ts.map