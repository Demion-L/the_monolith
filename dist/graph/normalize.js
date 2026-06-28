/**
 * Converts an arbitrary label string to a stable, lowercase slug used as a node ID.
 *
 * "Graph Memex", "graph memex", and "GRAPH MEMEX" all produce "graph-memex".
 */
export function normalizeLabel(label) {
    return label
        .replace(/`([^`]*)`/g, '$1') // `code` → code
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [label](url) → label
        .replace(/[*_~]+/g, '') // **bold**, _italic_ → plain
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-') // spaces → dashes
        .replace(/[^a-z0-9-]/g, '-') // non-alphanumeric → dash
        .replace(/-{2,}/g, '-') // collapse multiple dashes
        .replace(/^-+|-+$/g, ''); // strip leading/trailing dashes
}
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
export function selectCanonicalLabel(variants) {
    if (variants.length === 0)
        return '';
    if (variants.length === 1)
        return variants[0];
    function titleCaseScore(label) {
        const words = label.split(/\s+/).filter(Boolean);
        if (words.length === 0)
            return 0;
        return words.filter(w => /^[A-Z]/.test(w)).length / words.length;
    }
    return [...variants].sort((a, b) => {
        const aScore = titleCaseScore(a);
        const bScore = titleCaseScore(b);
        if (aScore !== bScore)
            return bScore - aScore;
        if (a.length !== b.length)
            return a.length - b.length;
        const aUpper = (a.match(/[A-Z]/g) ?? []).length;
        const bUpper = (b.match(/[A-Z]/g) ?? []).length;
        if (aUpper !== bUpper)
            return aUpper - bUpper; // fewer raw uppercase = more mixed-case = more readable
        return a.localeCompare(b);
    })[0];
}
