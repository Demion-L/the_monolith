import type { Artifact, WebwayAnalysisResult } from './types.js';
/**
 * Deterministic prototype: extracts concepts and semantic links from a single Artifact.
 * No LLM calls, no external storage. Pure signal extraction via frequency analysis.
 */
export declare function analyzeArtifact(artifact: Artifact): WebwayAnalysisResult;
//# sourceMappingURL=analyze.d.ts.map