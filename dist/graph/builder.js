import { normalizeLabel, selectCanonicalLabel } from './normalize.js';
export function buildGraph(results) {
    const diagnostics = [];
    if (results.length === 0) {
        return {
            nodes: [],
            edges: [],
            diagnostics: [{ severity: 'info', message: 'No ScriptoriumResult inputs provided — graph is empty.' }],
        };
    }
    // --- Pass 1: accumulate concept labels grouped by normalized ID ---
    const nodeAccum = new Map();
    for (const result of results) {
        for (const concept of result.concepts) {
            const id = normalizeLabel(concept.label);
            if (!id)
                continue;
            let acc = nodeAccum.get(id);
            if (!acc) {
                acc = { labels: [], evidenceIds: [], sourceArtifacts: [] };
                nodeAccum.set(id, acc);
            }
            if (!acc.labels.includes(concept.label))
                acc.labels.push(concept.label);
            acc.evidenceIds.push(concept.id);
            if (!acc.sourceArtifacts.includes(result.artifactId))
                acc.sourceArtifacts.push(result.artifactId);
        }
    }
    // --- Pass 2: build node map from accumulators ---
    const nodeMap = new Map();
    for (const [id, acc] of nodeAccum) {
        const canonical = selectCanonicalLabel(acc.labels);
        const aliases = acc.labels.filter(l => l !== canonical);
        if (acc.labels.length > 1) {
            diagnostics.push({
                severity: 'info',
                message: `Merged ${acc.labels.length} label variants into node "${id}": ${acc.labels.map(l => `"${l}"`).join(', ')}`,
            });
        }
        nodeMap.set(id, {
            id,
            canonicalLabel: canonical,
            aliases,
            evidenceIds: acc.evidenceIds,
            sourceArtifacts: acc.sourceArtifacts,
            synthesized: false,
        });
    }
    // --- Pass 2.5: build alias map from document metadata ---
    // Maps normalizeLabel(documentId|documentTitle) → primaryNodeId for alias lookup in Pass 3.
    // Aliases originate only from explicit frontmatter metadata (id:, title:). No fuzzy matching.
    const aliasMap = new Map();
    for (const result of results) {
        // Find the primary node for this document: prefer the first H1 heading concept.
        const h1Concept = result.concepts.find(c => c.source === 'heading' && c.headingLevel === 1);
        const fallbackConcept = result.concepts[0];
        const primaryLabel = h1Concept?.label ?? fallbackConcept?.label;
        if (!primaryLabel)
            continue;
        const primaryNodeId = normalizeLabel(primaryLabel);
        if (!primaryNodeId || !nodeMap.has(primaryNodeId))
            continue;
        const candidates = [];
        if (result.documentId) {
            candidates.push({ label: result.documentId, origin: `documentId "${result.documentId}"` });
        }
        if (result.documentTitle) {
            candidates.push({ label: result.documentTitle, origin: `documentTitle "${result.documentTitle}"` });
        }
        for (const { label, origin } of candidates) {
            const aliasId = normalizeLabel(label);
            if (!aliasId || aliasId === primaryNodeId)
                continue; // same slug — no alias needed
            if (nodeMap.has(aliasId))
                continue; // a real concept node already has this ID
            if (aliasMap.has(aliasId)) { // collision: two docs claim the same alias
                diagnostics.push({
                    severity: 'info',
                    message: `Alias collision: "${aliasId}" (from ${origin}) already mapped; first document wins`,
                    artifactId: result.artifactId,
                });
                continue;
            }
            aliasMap.set(aliasId, primaryNodeId);
            const node = nodeMap.get(primaryNodeId);
            if (!node.aliases.includes(label))
                node.aliases.push(label);
            diagnostics.push({
                severity: 'info',
                message: `Registered alias "${aliasId}" → "${primaryNodeId}" from ${origin}`,
                artifactId: result.artifactId,
            });
        }
    }
    // --- Pass 3: process relationships → edges ---
    const edges = [];
    // Dedup key → index in edges[] — prevents identical (from|type|to|artifact) pairs
    const edgeDedup = new Map();
    for (const result of results) {
        for (const rel of result.relationships) {
            const rawFromId = normalizeLabel(rel.fromLabel);
            const rawToId = normalizeLabel(rel.toLabel);
            if (!rawFromId || !rawToId)
                continue;
            // Resolve through alias map before synthesizing
            const fromId = aliasMap.get(rawFromId) ?? rawFromId;
            const toId = aliasMap.get(rawToId) ?? rawToId;
            // Synthesize fromNode when the artifact's own identity is not in its concepts
            if (!nodeMap.has(fromId)) {
                nodeMap.set(fromId, {
                    id: fromId,
                    canonicalLabel: rel.fromLabel,
                    aliases: [],
                    evidenceIds: [],
                    sourceArtifacts: [result.artifactId],
                    synthesized: true,
                });
                diagnostics.push({
                    severity: 'info',
                    message: `Synthesized node "${fromId}" from relationship fromLabel "${rel.fromLabel}"`,
                    artifactId: result.artifactId,
                });
            }
            // Synthesize toNode when target concept does not appear in any concept list or alias map
            if (!nodeMap.has(toId)) {
                nodeMap.set(toId, {
                    id: toId,
                    canonicalLabel: rel.toLabel,
                    aliases: [],
                    evidenceIds: [],
                    sourceArtifacts: [result.artifactId],
                    synthesized: true,
                });
                diagnostics.push({
                    severity: 'warn',
                    message: `Synthesized placeholder node "${toId}" — referenced by "${rel.relationshipType}" from "${rel.fromLabel}" but no matching concept found in corpus`,
                    artifactId: result.artifactId,
                });
            }
            // Deduplicate same (from, type, to, artifact) within one build
            const dedupKey = `${fromId}|${rel.relationshipType}|${toId}|${result.artifactId}`;
            const existingIdx = edgeDedup.get(dedupKey);
            if (existingIdx !== undefined) {
                edges[existingIdx].evidenceIds.push(rel.id);
            }
            else {
                edgeDedup.set(dedupKey, edges.length);
                edges.push({
                    id: dedupKey,
                    fromNodeId: fromId,
                    toNodeId: toId,
                    relationshipType: rel.relationshipType,
                    provenance: 'explicit',
                    evidenceIds: [rel.id],
                    sourceArtifactId: result.artifactId,
                });
            }
        }
    }
    // --- Pass 4: sort deterministically by ID ---
    const sortedNodes = [...nodeMap.values()].sort((a, b) => a.id.localeCompare(b.id));
    const sortedEdges = [...edges].sort((a, b) => a.id.localeCompare(b.id));
    return { nodes: sortedNodes, edges: sortedEdges, diagnostics };
}
