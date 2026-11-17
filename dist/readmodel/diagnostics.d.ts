/**
 * On-demand diagnostics for Mission Control (BETA-020 Phase 3, "Observe. Inspect. Act.").
 *
 * `runValidation` and `runReconciliation` call the existing Core functions —
 * `validateProject` (static, ADR-011: project code is never executed) and
 * `collect` + `reconcile` (read-only Git evidence) — and project their result
 * into a DTO. No rule is re-implemented here, no subprocess or shell is
 * started, and nothing is written. The project root is fixed by the embedding
 * process and never taken from a request.
 *
 * Messages are scrubbed: the absolute project root becomes `<project>`, control
 * characters are escaped, and every free-text field is clipped.
 */
import type { ReconciliationResultDto, ValidationResultDto } from './diagnostics-types.js';
export declare function runValidation(projectRoot: string): ValidationResultDto;
export declare function runReconciliation(projectRoot: string): Promise<ReconciliationResultDto>;
//# sourceMappingURL=diagnostics.d.ts.map