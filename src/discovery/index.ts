// Discovery (ADR-021). Internal module: deliberately NOT exported from `src/index.ts`
// until the owner decides (ADR-021 Q-7). DISCOVERY-001B-1: safe traversal; 001B-2: fact extraction; 001B-3: Markdown renderer; 001B-2D: documentation analyzer; 001C: unified project map composer.
export * from './traverse.js';
export * from './contracts.js';
export * from './facts.js';
export * from './render.js';
export * from './docs.js';
export * from './compose.js';
