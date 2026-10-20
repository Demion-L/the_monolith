#!/usr/bin/env node
/**
 * .monolith/ Self-Analysis Dogfood Experiment
 *
 * Runs compileMarkdownArtifact() + buildGraph() over MONOLITH's own operational
 * memory (.monolith/) and writes a self-analysis report.
 *
 * Run: node dist/scripts/dogfood-monolith.js  (from project root)
 * Or:  pnpm dogfood-monolith
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { compileMarkdownArtifact } from '../scriptorium/index.js';
import { buildGraph } from '../graph/index.js';
import type { ScriptoriumResult } from '../scriptorium/index.js';
import type { GraphNode, GraphEdge, ExplicitRelationshipGraph } from '../graph/index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const REPORT_DIR = join(ROOT, '.monolith', 'reports');
const MD_OUT = join(REPORT_DIR, 'monolith-self-analysis-v1.md');

const MIN_CONTENT_CHARS = 30;

// docs/ dogfood baseline for comparison (from graph-dogfood-v1-2.md)
const DOCS_BASELINE = { files: 81, nodes: 481, synthesized: 0, edges: 32 };

// ---------------------------------------------------------------------------
// File discovery — .monolith/ excluding .monolith/reports/
// ---------------------------------------------------------------------------

function findMdFiles(dir: string, excludeDirs: Set<string> = new Set()): string[] {
  const results: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (excludeDirs.has(full)) continue;
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) {
      results.push(...findMdFiles(full, excludeDirs));
    } else if (extname(entry) === '.md') {
      results.push(full);
    }
  }
  return results;
}

const monolithDir = join(ROOT, '.monolith');
const reportsDir = join(ROOT, '.monolith', 'reports');
const targets = findMdFiles(monolithDir, new Set([reportsDir]));

// ---------------------------------------------------------------------------
// Title extraction helper
// ---------------------------------------------------------------------------

function extractH1(content: string): string | undefined {
  for (const line of content.split('\n')) {
    const m = line.match(/^#\s+(.+)$/);
    if (m) {
      return m[1]
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/[*_~]+/g, '')
        .trim();
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Compile each file through Scriptorium
// ---------------------------------------------------------------------------

interface FileEntry {
  relPath: string;
  artifactId: string;
  result: ScriptoriumResult;
}

const compiled: FileEntry[] = [];
const skipped: { file: string; reason: string }[] = [];

for (const filePath of targets) {
  const relPath = relative(ROOT, filePath);
  const artifactId = relPath.replace(/[/\\]/g, '--').replace(/\.md$/, '');
  let content: string;
  try { content = readFileSync(filePath, 'utf-8'); } catch { continue; }
  if (content.trim().length < MIN_CONTENT_CHARS) {
    skipped.push({ file: relPath, reason: `too short (${content.trim().length} chars)` });
    continue;
  }
  const title = extractH1(content);
  compiled.push({
    relPath,
    artifactId,
    result: compileMarkdownArtifact({ id: artifactId, content, sourcePath: relPath, title }),
  });
}

// ---------------------------------------------------------------------------
// Build graph
// ---------------------------------------------------------------------------

const graph: ExplicitRelationshipGraph = buildGraph(compiled.map(e => e.result));

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------

const synthesizedNodes = graph.nodes.filter(n => n.synthesized);
const realNodes = graph.nodes.filter(n => !n.synthesized);

// Degree per node (in + out)
const degree = new Map<string, number>();
for (const node of graph.nodes) degree.set(node.id, 0);
for (const edge of graph.edges) {
  degree.set(edge.fromNodeId, (degree.get(edge.fromNodeId) ?? 0) + 1);
  degree.set(edge.toNodeId, (degree.get(edge.toNodeId) ?? 0) + 1);
}

const topConnected = [...graph.nodes]
  .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
  .slice(0, 15);

// Relationship type distribution
const relTypeDist = new Map<string, number>();
for (const edge of graph.edges) {
  relTypeDist.set(edge.relationshipType, (relTypeDist.get(edge.relationshipType) ?? 0) + 1);
}
const relTypeRows = [...relTypeDist.entries()].sort(([, a], [, b]) => b - a);

// Edges where both nodes are real
function isGoodEdge(e: GraphEdge): boolean {
  const from = graph.nodes.find(n => n.id === e.fromNodeId);
  const to = graph.nodes.find(n => n.id === e.toNodeId);
  return !!from && !from.synthesized && !!to && !to.synthesized;
}
function isNoisyEdge(e: GraphEdge): boolean {
  const to = graph.nodes.find(n => n.id === e.toNodeId);
  return !!to && to.synthesized;
}

const goodEdges = graph.edges.filter(isGoodEdge);
const noisyEdges = graph.edges.filter(isNoisyEdge);
const resolvedEdgePct = graph.edges.length === 0 ? 0 : goodEdges.length / graph.edges.length;

// Nodes with zero edges (isolated)
const isolatedNodes = graph.nodes.filter(n => (degree.get(n.id) ?? 0) === 0 && !n.synthesized);

// Files producing zero relationship candidates
const noRelFiles = compiled.filter(e => e.result.relationships.length === 0);

// Files with most relationship candidates
const richRelFiles = compiled
  .map(e => ({ relPath: e.relPath, relCount: e.result.relationships.length }))
  .filter(e => e.relCount > 0)
  .sort((a, b) => b.relCount - a.relCount)
  .slice(0, 15);

// Concept source distribution
const sourceCount = { heading: 0, frontmatter: 0, 'list-item': 0, 'link-label': 0 };
for (const { result } of compiled) {
  for (const c of result.concepts) {
    if (c.source in sourceCount) sourceCount[c.source as keyof typeof sourceCount]++;
  }
}
const totalConcepts = Object.values(sourceCount).reduce((a, b) => a + b, 0);

// Group files by .monolith/ subsystem
function subsystem(relPath: string): string {
  const after = relPath.replace(/^\.monolith\//, '');
  const first = after.split('/')[0];
  return first ?? 'root';
}

const subsystemMap = new Map<string, { files: number; relCandidates: number; concepts: number }>();
for (const { relPath, result } of compiled) {
  const sub = subsystem(relPath);
  const cur = subsystemMap.get(sub) ?? { files: 0, relCandidates: 0, concepts: 0 };
  subsystemMap.set(sub, {
    files: cur.files + 1,
    relCandidates: cur.relCandidates + result.relationships.length,
    concepts: cur.concepts + result.concepts.length,
  });
}
const subsystemRows = [...subsystemMap.entries()].sort(([, a], [, b]) => b.files - a.files);

// Subsystems with zero relationships
const darkSubsystems = subsystemRows.filter(([, v]) => v.relCandidates === 0).map(([k]) => k);

// Unresolved synthesized placeholder targets
const unresolvedTargets = graph.diagnostics
  .filter(d => d.severity === 'warn' && d.message.includes('Synthesized placeholder'))
  .map(d => {
    const m = d.message.match(/Synthesized placeholder node "([^"]+)"/);
    return m ? m[1] : '';
  })
  .filter(Boolean);

// Merged nodes (aliases)
const mergedNodes = graph.nodes.filter(n => n.aliases.length > 0);

// Low-quality headings (noise check)
const lowQualityHeadings = compiled
  .flatMap(({ result }) => result.concepts.filter(c => c.source === 'heading'))
  .filter(c => c.label.length <= 2 || /^[-─═]+$/.test(c.label) || /^\|/.test(c.label));

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

let verdict: string;
let verdictDetail: string;

if (resolvedEdgePct >= 0.7) {
  verdict = 'READY FOR TERRA';
  verdictDetail = `${Math.round(resolvedEdgePct * 100)}% of edges connect two real nodes. The .monolith/ graph has sufficient resolved structure to be a useful persistence target.`;
} else if (resolvedEdgePct >= 0.4) {
  verdict = 'NEEDS TARGETED FIX BEFORE TERRA';
  verdictDetail = `${Math.round(resolvedEdgePct * 100)}% of edges connect real nodes. Unresolved targets should be addressed before Terra integration.`;
} else if (graph.edges.length === 0) {
  verdict = 'OPEN NEW DOGFOOD FOLLOW-UP';
  verdictDetail = `No edges extracted. The .monolith/ corpus relationship fields are not producing edges — investigate whether relationship candidates are resolving against existing concept nodes.`;
} else {
  verdict = 'NEEDS TARGETED FIX BEFORE TERRA';
  verdictDetail = `Only ${Math.round(resolvedEdgePct * 100)}% of edges connect real nodes. The short-ID vs node-label mismatch is likely the primary cause.`;
}

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

function nodeLabel(id: string): string {
  return graph.nodes.find(n => n.id === id)?.canonicalLabel ?? id;
}

function mdTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length), 3));
  const header = `| ${headers.map((h, i) => h.padEnd(widths[i])).join(' | ')} |`;
  const sep = `| ${widths.map(w => '-'.repeat(w)).join(' | ')} |`;
  const body = rows.map(r => `| ${r.map((c, i) => (c ?? '').padEnd(widths[i])).join(' | ')} |`).join('\n');
  return [header, sep, body].join('\n');
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

const report = `---
type: report
id: monolith-self-analysis-v1
generated: ${new Date().toISOString().slice(0, 10)}
experiment: .monolith/ Self-Analysis Dogfood
---

# MONOLITH Self-Analysis — Dogfood Report v1

**Experiment:** What does MONOLITH see when it looks at its own \`.monolith/\` memory?
**Generated:** ${generatedAt}
**Pipeline:** \`compileMarkdownArtifact()\` → \`buildGraph()\`
**Corpus:** \`.monolith/\` (excluding \`.monolith/reports/\`)

---

## 1. Summary Metrics

${mdTable(
  ['Metric', 'Value', 'docs/ baseline'],
  [
    ['Markdown files discovered', String(targets.length), String(DOCS_BASELINE.files)],
    ['Files compiled', String(compiled.length), '—'],
    ['Files skipped (too short)', String(skipped.length), '—'],
    ['Total concept candidates', String(totalConcepts), '—'],
    ['Total relationship candidates', String(compiled.reduce((n, e) => n + e.result.relationships.length, 0)), '—'],
    ['Graph nodes (total)', String(graph.nodes.length), String(DOCS_BASELINE.nodes)],
    ['Graph nodes (real)', String(realNodes.length), String(DOCS_BASELINE.nodes - DOCS_BASELINE.synthesized)],
    ['Graph nodes (synthesized)', String(synthesizedNodes.length), String(DOCS_BASELINE.synthesized)],
    ['Graph edges', String(graph.edges.length), String(DOCS_BASELINE.edges)],
    ['Edges — both nodes real', `${goodEdges.length} (${Math.round(resolvedEdgePct * 100)}%)`, '32 (100%)'],
    ['Isolated real nodes', String(isolatedNodes.length), '—'],
    ['Merged label nodes', String(mergedNodes.length), '—'],
    ['Diagnostics (warn)', String(graph.diagnostics.filter(d => d.severity === 'warn').length), '—'],
  ]
)}

---

## 2. Subsystem Breakdown

How relationship density varies across MONOLITH operational subsystems.

${mdTable(
  ['Subsystem', 'Files', 'Concepts', 'Rel. candidates', 'Connected?'],
  subsystemRows.map(([sub, v]) => [
    sub,
    String(v.files),
    String(v.concepts),
    String(v.relCandidates),
    v.relCandidates > 0 ? 'YES' : 'isolated',
  ])
)}

**Dark subsystems** (zero relationship candidates): ${darkSubsystems.length === 0 ? '_none_' : darkSubsystems.map(s => `\`${s}\``).join(', ')}

---

## 3. Concept Source Distribution

${mdTable(
  ['Source', 'Count', 'Share'],
  [
    ['heading', String(sourceCount.heading), totalConcepts ? `${Math.round(sourceCount.heading / totalConcepts * 100)}%` : '—'],
    ['list-item', String(sourceCount['list-item']), totalConcepts ? `${Math.round(sourceCount['list-item'] / totalConcepts * 100)}%` : '—'],
    ['frontmatter', String(sourceCount.frontmatter), totalConcepts ? `${Math.round(sourceCount.frontmatter / totalConcepts * 100)}%` : '—'],
    ['link-label', String(sourceCount['link-label']), totalConcepts ? `${Math.round(sourceCount['link-label'] / totalConcepts * 100)}%` : '—'],
  ]
)}

---

## 4. Relationship Type Distribution

${relTypeRows.length > 0
  ? mdTable(
      ['Relationship type', 'Edge count'],
      relTypeRows.map(([type, count]) => [type, String(count)])
    )
  : '_No edges extracted._'
}

---

## 5. Top Connected Nodes

Ranked by total degree (in + out).

${topConnected.filter(n => (degree.get(n.id) ?? 0) > 0).length > 0
  ? mdTable(
      ['Node (canonical label)', 'Degree', 'Sources', 'Synthesized?'],
      topConnected
        .filter(n => (degree.get(n.id) ?? 0) > 0)
        .map(n => [
          n.canonicalLabel,
          String(degree.get(n.id) ?? 0),
          String(n.sourceArtifacts.length),
          n.synthesized ? 'YES' : '-',
        ])
    )
  : '_No connected nodes._'
}

---

## 6. Isolated Real Nodes (sample)

Real nodes (non-synthesized) with zero edges — knowledge that is not linked to anything.

${isolatedNodes.length === 0
  ? '_No isolated real nodes._'
  : isolatedNodes.length <= 30
    ? isolatedNodes.map(n => `- \`${n.canonicalLabel}\` (sources: ${n.sourceArtifacts.length})`).join('\n')
    : isolatedNodes.slice(0, 30).map(n => `- \`${n.canonicalLabel}\``).join('\n') + `\n- … and ${isolatedNodes.length - 30} more`
}

---

## 7. Files With Relationship Candidates

${richRelFiles.length > 0
  ? mdTable(
      ['File', 'Relationship candidates'],
      richRelFiles.map(e => [e.relPath, String(e.relCount)])
    )
  : '_No files produced relationship candidates._'
}

---

## 8. Files With Zero Relationships

${noRelFiles.length > 0
  ? `${noRelFiles.length} files produced no relationship candidates. These are knowledge islands with no explicit connections.\n\n` +
    (noRelFiles.length <= 40
      ? noRelFiles.map(e => `- \`${e.relPath}\``).join('\n')
      : noRelFiles.slice(0, 40).map(e => `- \`${e.relPath}\``).join('\n') + `\n- … and ${noRelFiles.length - 40} more`)
  : '_All files produced at least one relationship candidate._'
}

---

## 9. Good Edge Samples

Edges where both source and target are real (non-synthesized) nodes.

${goodEdges.length > 0
  ? mdTable(
      ['From', 'Type', 'To', 'Source file'],
      goodEdges.slice(0, 10).map(e => [
        nodeLabel(e.fromNodeId).slice(0, 35),
        e.relationshipType,
        nodeLabel(e.toNodeId).slice(0, 35),
        e.sourceArtifactId.split('--').slice(-2).join('/') ?? e.sourceArtifactId,
      ])
    )
  : '_No fully-resolved edges found._'
}

---

## 10. Noisy Edge Samples

Edges where the target is a synthesized placeholder — referenced but not found in the corpus.

${noisyEdges.length > 0
  ? mdTable(
      ['From', 'Type', 'To (unresolved)', 'Source file'],
      noisyEdges.slice(0, 10).map(e => [
        nodeLabel(e.fromNodeId).slice(0, 35),
        e.relationshipType,
        nodeLabel(e.toNodeId).slice(0, 35),
        e.sourceArtifactId.split('--').slice(-2).join('/') ?? e.sourceArtifactId,
      ])
    )
  : '_No noisy edges found._'
}

---

## 11. Unresolved Relationship Targets

${unresolvedTargets.length > 0
  ? `${unresolvedTargets.length} targets were referenced in frontmatter but not found as real nodes:\n\n` +
    (unresolvedTargets.length <= 40
      ? unresolvedTargets.map(t => `- \`${t}\``).join('\n')
      : unresolvedTargets.slice(0, 40).map(t => `- \`${t}\``).join('\n') + `\n- … and ${unresolvedTargets.length - 40} more`)
  : '_All relationship targets resolved to real nodes._'
}

---

## 12. Merged / Canonical Labels

${mergedNodes.length > 0
  ? mdTable(
      ['Canonical label', 'Aliases'],
      mergedNodes.slice(0, 20).map(n => [n.canonicalLabel, n.aliases.join(', ')])
    ) + (mergedNodes.length > 20 ? `\n\n… and ${mergedNodes.length - 20} more.` : '')
  : '_No merged labels — all labels resolved without collision._'
}

---

## 13. Heading Noise Check

${lowQualityHeadings.length > 0
  ? `**${lowQualityHeadings.length} low-quality heading concepts** detected (≤2 chars or pure punctuation):\n\n` +
    lowQualityHeadings.slice(0, 10).map(c => `- \`${c.label}\``).join('\n')
  : 'No structurally degenerate headings found. Heading noise filter is working correctly on this corpus.'
}

---

## 14. Critical Questions — Answers

### 1. Does .monolith/ produce a denser or weaker graph than docs/?

${graph.edges.length > DOCS_BASELINE.edges
  ? `**Denser.** .monolith/ produced ${graph.edges.length} edges vs. ${DOCS_BASELINE.edges} in docs/. Despite having fewer files (${compiled.length} vs ${DOCS_BASELINE.files}), the operational memory corpus is more richly cross-referenced.`
  : graph.edges.length === DOCS_BASELINE.edges
  ? `**Equal density.** Both corpora produced ${DOCS_BASELINE.edges} edges.`
  : `**Weaker.** .monolith/ produced ${graph.edges.length} edges vs. ${DOCS_BASELINE.edges} in docs/. With ${compiled.length} files vs ${DOCS_BASELINE.files}, the edge-per-file ratio is ${graph.edges.length === 0 ? '0' : (graph.edges.length / compiled.length).toFixed(2)} vs ${(DOCS_BASELINE.edges / DOCS_BASELINE.files).toFixed(2)}.`
}

### 2. Which parts of MONOLITH memory are well-connected?

${richRelFiles.length > 0
  ? `The most relationship-rich files are: ${richRelFiles.slice(0, 5).map(e => `\`${e.relPath}\` (${e.relCount} candidates)`).join(', ')}.`
  : 'No files with explicit relationship fields found — the corpus may need frontmatter relationship fields added.'
}

### 3. Which parts are isolated?

${darkSubsystems.length > 0
  ? `Subsystems with zero relationship candidates: ${darkSubsystems.map(s => `\`${s}\``).join(', ')}. These are dark regions — they contain knowledge but declare no explicit connections to other parts of the memory.`
  : 'All subsystems produced at least one relationship candidate.'
}

### 4. Do protocols, hypotheses, and memory documents link to each other?

${graph.edges.length > 0
  ? `Yes — there are ${goodEdges.length} fully-resolved edges between real nodes. ` +
    (richRelFiles.some(e => e.relPath.includes('protocols/')) && richRelFiles.some(e => e.relPath.includes('memory/'))
      ? 'Both protocols and memory documents contribute relationship candidates, indicating cross-subsystem linking.'
      : 'Cross-linking is present but concentrated in specific files.')
  : 'No edges extracted — protocol-memory cross-links are not yet visible to the pipeline.'
}

### 5. Does Scriptorium understand MONOLITH's own operational memory format?

${totalConcepts > 0
  ? `Yes — Scriptorium extracted ${totalConcepts} concept candidates from ${compiled.length} files. ` +
    `The frontmatter parser recognizes ${compiled.reduce((n, e) => n + e.result.relationships.length, 0)} relationship candidates. ` +
    `However, many .monolith/ files use IDs (e.g., "protocol-memory-governance") as reference targets that may not resolve to heading-based concept nodes — this is the primary resolution gap.`
  : 'No concepts extracted — Scriptorium may not be parsing .monolith/ file format correctly.'
}

### 6. What is the next evidence-based fix?

${synthesizedNodes.length > 0
  ? `**Primary fix:** ${synthesizedNodes.length} synthesized nodes exist because relationship targets use short IDs (e.g., "memory-governance") that differ from how those documents appear as heading concepts. The fix is to ensure every \`.monolith/\` document's \`id:\` field value is registered as a concept alias — which the graph builder already does via Pass 2.5, but only when the \`id:\` value is also extractable as a concept node. This is a corpus alignment problem: add or standardize \`id:\` fields in the files being referenced.`
  : synthesizedNodes.length === 0 && graph.edges.length === 0
  ? `**Primary fix:** No edges were extracted despite relationship candidates existing. Verify that the target IDs in frontmatter (\`related_protocols:\`, \`protocols:\`, etc.) match the \`id:\` frontmatter field values of the corresponding documents. If they match, Pass 2.5 should resolve them.`
  : `**Good state:** All edges resolved. The next fix is increasing edge density — more frontmatter \`related_*\` fields in the files that currently have zero relationship candidates.`
}

---

## 15. Verdict

**${verdict}**

${verdictDetail}

### Comparison: .monolith/ vs docs/

| Metric            | .monolith/     | docs/ baseline |
|-------------------|----------------|----------------|
| Files processed   | ${String(compiled.length).padEnd(14)} | ${String(DOCS_BASELINE.files).padEnd(14)} |
| Nodes (real)      | ${String(realNodes.length).padEnd(14)} | ${String(DOCS_BASELINE.nodes).padEnd(14)} |
| Nodes (synth.)    | ${String(synthesizedNodes.length).padEnd(14)} | ${String(DOCS_BASELINE.synthesized).padEnd(14)} |
| Edges (total)     | ${String(graph.edges.length).padEnd(14)} | ${String(DOCS_BASELINE.edges).padEnd(14)} |
| Edges (both real) | ${`${goodEdges.length} (${Math.round(resolvedEdgePct * 100)}%)`.padEnd(14)} | 32 (100%)       |
| Edge/file ratio   | ${(compiled.length === 0 ? '0' : (graph.edges.length / compiled.length).toFixed(2)).padEnd(14)} | ${(DOCS_BASELINE.edges / DOCS_BASELINE.files).toFixed(2).padEnd(14)} |
${skipped.length > 0 ? `\n### Skipped Files\n\n${skipped.map(s => `- \`${s.file}\` — ${s.reason}`).join('\n')}` : ''}
`;

mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(MD_OUT, report, 'utf-8');

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

const bar = '─'.repeat(52);
console.log('\nMONOLITH Self-Analysis Dogfood v1');
console.log(bar);
console.log(`Corpus:               .monolith/ (excl. reports/)`);
console.log(`Files discovered:     ${targets.length}`);
console.log(`Files compiled:       ${compiled.length}`);
console.log(`Files skipped:        ${skipped.length}`);
console.log('');
console.log(`Graph nodes (total):  ${graph.nodes.length}`);
console.log(`  real:               ${realNodes.length}`);
console.log(`  synthesized:        ${synthesizedNodes.length}`);
console.log(`Graph edges:          ${graph.edges.length}`);
console.log(`  both-real:          ${goodEdges.length} (${Math.round(resolvedEdgePct * 100)}%)`);
console.log(`  unresolved:         ${noisyEdges.length}`);
console.log(`Isolated real nodes:  ${isolatedNodes.length}`);
console.log('');
console.log(`Subsystem breakdown:`);
for (const [sub, v] of subsystemRows) {
  const linked = v.relCandidates > 0 ? `${v.relCandidates} rel candidates` : 'ISOLATED';
  console.log(`  ${sub.padEnd(20)} ${v.files} files   ${linked}`);
}
console.log('');
if (topConnected.filter(n => (degree.get(n.id) ?? 0) > 0).length > 0) {
  console.log('Top connected nodes:');
  topConnected.filter(n => (degree.get(n.id) ?? 0) > 0).slice(0, 8).forEach(n => {
    const deg = degree.get(n.id) ?? 0;
    const synth = n.synthesized ? ' [synth]' : '';
    console.log(`  ${n.canonicalLabel.slice(0, 32).padEnd(32)} deg ${deg}${synth}`);
  });
  console.log('');
}
console.log(`docs/ baseline:  ${DOCS_BASELINE.files} files, ${DOCS_BASELINE.nodes} nodes, ${DOCS_BASELINE.edges} edges`);
console.log(`.monolith/ result: ${compiled.length} files, ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
console.log('');
console.log(`Verdict: ${verdict}`);
console.log(`Report:  ${relative(ROOT, MD_OUT)}`);
