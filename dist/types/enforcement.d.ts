/**
 * Result returned by every enforcement gate check.
 */
export interface GateCheckResult {
    passed: boolean;
    reason: string;
    blockedActions: string[];
    requiredSteps: string[];
}
export type GateStatus = 'PASS' | 'BLOCK' | 'WARN';
//# sourceMappingURL=enforcement.d.ts.map