// Discovery (ADR-021). Internal module: deliberately NOT exported from `src/index.ts`
// until the owner decides (ADR-021 Q-7). DISCOVERY-001B-1 provides only the safe traversal.
export * from './traverse.js';
