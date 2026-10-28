#!/usr/bin/env node
/**
 * ERG identity dogfood: compiles a markdown corpus through Scriptorium and prints
 * identity / resolution statistics to stdout. Read-only: writes no files.
 *
 * Run: node dist/scripts/dogfood-graph.js [dir ...] [--namespace NS]   (default dirs: docs templates)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { compileMarkdownArtifact } from '../scriptorium/index.js';
import { buildGraph } from '../graph/index.js';
function findMdFiles(dir) {
    const out = [];
    let entries;
    try {
        entries = readdirSync(dir);
    }
    catch {
        return out;
    }
    for (const entry of entries) {
        if (entry.startsWith('.git') || entry === 'node_modules' || entry === 'dist')
            continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory())
            out.push(...findMdFiles(full));
        else if (extname(entry) === '.md')
            out.push(full);
    }
    return out.sort();
}
const args = process.argv.slice(2);
const nsIdx = args.indexOf('--namespace');
const namespace = nsIdx >= 0 ? args[nsIdx + 1] : 'corpus';
const dirs = args.filter((a, i) => a !== '--namespace' && i !== nsIdx + 1);
const roots = dirs.length > 0 ? dirs : ['docs', 'templates'];
const ROOT = process.cwd();
const results = roots
    .flatMap(d => findMdFiles(join(ROOT, d)))
    .map(file => {
    const relPath = relative(ROOT, file);
    const artifactId = relPath.replace(/[/\\]/g, '--').replace(/\.md$/, '');
    return compileMarkdownArtifact({
        id: artifactId,
        content: readFileSync(file, 'utf-8'),
        sourcePath: relPath,
        namespace,
    });
});
const graph = buildGraph(results);
const byStatus = new Map();
for (const u of graph.unresolved)
    byStatus.set(u.resolution.status, (byStatus.get(u.resolution.status) ?? 0) + 1);
console.log(`Namespace:        ${namespace}`);
console.log(`Artifacts:        ${results.length}`);
console.log(`Objects (nodes):  ${graph.nodes.length} (${graph.nodes.filter(n => n.kind === 'section').length} sections)`);
console.log(`Edges (RESOLVED): ${graph.edges.length}`);
console.log(`Unresolved:       ${graph.unresolved.length}`);
for (const [status, n] of [...byStatus].sort())
    console.log(`  ${status}: ${n}`);
console.log(`Conflicts:        ${graph.conflicts.length}`);
for (const c of graph.conflicts) {
    console.log(`  ${c.ref}: ${c.candidates.map(o => o.location.path).join(', ')}`);
}
console.log(`Diagnostics:      ${graph.diagnostics.filter(d => d.severity !== 'info').length} warn/error`);
