/**
 * Converts an arbitrary label string to a stable, lowercase slug used as a node ID.
 *
 * "Graph Memex", "graph memex", and "GRAPH MEMEX" all produce "graph-memex".
 */
export declare function normalizeLabel(label: string): string;
/**
 * Given multiple label strings that all normalize to the same ID, selects the most
 * readable one as canonical.
 *
 * Priority:
 * 1. Title-case proportion — words starting with uppercase / total words.
 *    "Graph Memex" (2/2 = 1.0) beats "graph memex" (0/2 = 0.0).
 *    "Terra" (1/1 = 1.0) ties "Terra Platform" (2/2 = 1.0) → shorter wins.
 * 2. Shorter label — "Terra" over "Terra Platform".
 * 3. Fewer raw uppercase letters — "Terra" over "TERRA" (mixed case is more readable).
 * 4. Alphabetical as final tiebreaker.
 */
export declare function selectCanonicalLabel(variants: string[]): string;
//# sourceMappingURL=normalize.d.ts.map