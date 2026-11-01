/**
 * DISCOVERY-001C-G — unified discovery orchestration (ADR-021). Internal.
 *
 * One entry point that runs the whole Project Discovery chain: ONE safe traversal, then fact
 * extraction and documentation analysis over that same `TraversalResult` object and the same
 * `projectRoot` string, then the composer.
 *
 * Guarantees, by construction of this function:
 *  - same invocation: both results come from one call;
 *  - same traversal: exactly one `traverseProject` call; both analyzers receive that object;
 *  - same project root: the one string given here is passed unchanged to all three steps.
 *
 * NOT guaranteed: same file system snapshot. The traversal records a listing; the analyzers read
 * file contents (package.json, Markdown documents) later and independently, so a file may change
 * between the listing and either read, or between the two reads. `reproducible`/`completeness`
 * remain the only signals about that.
 *
 * Errors from any step propagate unchanged; nothing is retried, caught or replaced by a fallback.
 * No other data source, no network, no model, no write. The existing path-safety and bounded-read
 * rules live inside the steps and are not bypassed here.
 */

import { analyzeDocumentation, type AnalyzeDocumentationOptions } from './docs.js';
import { composeProjectMap } from './compose.js';
import { extractProjectFacts, type ExtractOptions } from './facts.js';
import { traverseProject, type TraverseOptions } from './traverse.js';

export interface DiscoverProjectMapOptions {
  /** Passed to the single traversal. */
  traversal?: TraverseOptions;
  /** Passed to fact extraction. */
  facts?: ExtractOptions;
  /** Passed to the documentation analyzer. */
  documentation?: AnalyzeDocumentationOptions;
}

/** Runs traversal → facts + documentation (same traversal object) → composer and returns the Project Map Markdown. */
export function discoverProjectMap(projectRoot: string, options: DiscoverProjectMapOptions = {}): string {
  const traversal = traverseProject(projectRoot, options.traversal);
  const discovery = extractProjectFacts(projectRoot, traversal, options.facts);
  const documentation = analyzeDocumentation(projectRoot, traversal, options.documentation);
  return composeProjectMap(discovery, documentation);
}
