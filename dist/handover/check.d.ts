/**
 * `buildHandoverReport(projectRoot)` — read-only autonomous-development handover (ACCOUNTABILITY-001, Phase 5).
 *
 * Everything comes from sources Core already owns; nothing is written, no test is run, no LLM or network is
 * involved. The only subprocess is read-only `git` (HEAD / working-tree state) for evidence freshness.
 * Deterministic: unchanged files, unchanged git state and unchanged evidence give an identical report.
 */
import type { DashboardReadModel } from '../readmodel/index.js';
import type { GitView } from './git.js';
import { type HandoverReport } from './types.js';
export declare const MAX_HANDOVER_STORIES = 200;
export declare const MAX_HANDOVER_ISSUES = 50;
export declare const MAX_HANDOVER_EVIDENCE = 100;
export declare const MAX_HANDOVER_REFS = 20;
export interface HandoverDeps {
    model?: DashboardReadModel;
    git?: GitView;
}
export declare function buildHandoverReport(projectRoot: string, deps?: HandoverDeps): HandoverReport;
//# sourceMappingURL=check.d.ts.map