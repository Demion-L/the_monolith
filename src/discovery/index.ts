// Discovery (ADR-021). Internal module: deliberately NOT exported from `src/index.ts`
// until the owner decides (ADR-021 Q-7). DISCOVERY-001B-1: safe traversal; 001B-2: fact extraction.
export * from './traverse.js';
export * from './contracts.js';
export * from './facts.js';
