/**
 * Context passed to every integrity validator.
 */
export interface VerificationContext {
  projectRoot: string;
  monolithRoot: string;
  phaseId: string;
  storyId: string;
  metadata: Record<string, unknown>;
}

export type VerificationStatus = 'PASS' | 'FAIL' | 'WARN';

export interface VerificationCheck {
  checkId: string;
  description: string;
  status: VerificationStatus;
  message: string;
}

/**
 * Aggregate result produced by the verification engine.
 */
export interface VerificationReport {
  protocolId: string;
  context: VerificationContext;
  checks: VerificationCheck[];
  result: {
    status: VerificationStatus;
    passed: number;
    failed: number;
    warnings: number;
  };
  summary: string;
}
