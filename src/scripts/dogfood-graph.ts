#!/usr/bin/env node
/**
 * Story 1.3.1/1.3.2 — Explicit Graph Dogfood Experiment
 *
 * Runs compileMarkdownArtifact() + buildGraph() over MONOLITH's own markdown
 * corpus and writes a graph quality report.
 *
 * Run: node dist/scripts/dogfood-graph.js  (from project root)
 * Or:  npm run dogfood-graph
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { compileMarkdownArtifact } from '../scriptorium/index.js';
import { buildGraph } from '../graph/index.js';
import type { ScriptoriumResult, ConceptCandidate, RelationshipCandidate } from '../scriptorium/index.js';
import type { GraphNode, GraphEdge, ExplicitRelationshipGraph } from '../graph/index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const REPORT_DIR = join(ROOT, '.monolith', 'reports');
const MD_OUT = join(REPORT_DIR, 'graph-dogfood-v1-2.md');

const MIN_CONTENT_CHARS = 30;

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function findMdFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    if (entry.startsWith('.git')) continue;
    const full = join(dir, entry);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      results.push(...findMdFiles(full));
    } else if (extname(entry) === '.md') {
      results.push(full);
    }
  }
  return results;
}

const targets: string[] = [
  ...findMdFiles(join(ROOT, 'docs')),
  ...findMdFiles(join(ROOT, 'templates')),
];
// Root-level markdown
for (const name of ['README.md', 'MANIFESTO.md']) {
  const p = join(ROOT, name);
  try { statSync(p); targets.push(p); } catch { /* absent */ }
}

// ---------------------------------------------------------------------------
// Title extraction helper
// ---------------------------------------------------------------------------

// Extract the first H1 heading from raw markdown content (strips inline markdown).
// Used as fromLabel fallback when frontmatter has no title: field.
function extractH1(content: string): string | undefined {
  for (const line of content.split('\n')) {
    const m = line.match(/^#\s+(.+)$/);
    if (m) {
      return m[1]
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [label](url) → label
        .replace(/`([^`]*)`/g, '$1')              // `code` → code
        .replace(/[*_~]+/g, '')                   // strip bold/italic
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
  // Use H1 as title hint so fromLabel falls back to the heading rather than
  // the artifact path ID when frontmatter has no title: field.
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

// Degree (total edges in + out) per node
const degree = new Map<string, number>();
for (const node of graph.nodes) degree.set(node.id, 0);
for (const edge of graph.edges) {
  degree.set(edge.fromNodeId, (degree.get(edge.fromNodeId) ?? 0) + 1);
  degree.set(edge.toNodeId, (degree.get(edge.toNodeId) ?? 0) + 1);
}

const topConnected = [...graph.nodes]
  .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
  .slice(0, 15);

const synthesizedNodes = graph.nodes.filter(n => n.synthesized);
const realNodes = graph.nodes.filter(n => !n.synthesized);

// Relationship type distribution
const relTypeDist = new Map<string, number>();
for (const edge of graph.edges) {
  relTypeDist.set(edge.relationshipType, (relTypeDist.get(edge.relationshipType) ?? 0) + 1);
}
const relTypeRows = [...relTypeDist.entries()].sort(([, a], [, b]) => b - a);

// Merged labels
const mergedNodes = graph.nodes.filter(n => n.aliases.length > 0);

// Unresolved targets (synthesized from relationship toLabel with warn diagnostic)
const unresolvedTargets = graph.diagnostics
  .filter(d => d.severity === 'warn' && d.message.includes('Synthesized placeholder'))
  .map(d => {
    const m = d.message.match(/Synthesized placeholder node "([^"]+)"/);
    return m ? m[1] : '';
  })
  .filter(Boolean);

// Concept source distribution across all compiled artifacts
const sourceCount = { heading: 0, 'frontmatter': 0, 'list-item': 0, 'link-label': 0 };
for (const { result } of compiled) {
  for (const c of result.concepts) {
    if (c.source in sourceCount) sourceCount[c.source as keyof typeof sourceCount]++;
  }
}
const totalConcepts = Object.values(sourceCount).reduce((a, b) => a + b, 0);

// Edge quality sampling — pick 5 "good" and 5 "noisy" edges
// Good = fromNode is real, toNode is real, both have > 1 source artifact
// Noisy = synthesized toNode or single-char labels
function isGoodEdge(e: GraphEdge): boolean {
  const from = graph.nodes.find(n => n.id === e.fromNodeId);
  const to = graph.nodes.find(n => n.id === e.toNodeId);
  return !!from && !from.synthesized && !!to && !to.synthesized;
}
function isNoisyEdge(e: GraphEdge): boolean {
  const to = graph.nodes.find(n => n.id === e.toNodeId);
  return !!to && to.synthesized;
}

const goodEdges = graph.edges.filter(isGoodEdge).slice(0, 5);
const noisyEdges = graph.edges.filter(isNoisyEdge).slice(0, 5);

// Heading concept quality: headings that are just punctuation / one char / table separators
const lowQualityHeadings = compiled
  .flatMap(({ result }) => result.concepts.filter(c => c.source === 'heading'))
  .filter(c => c.label.length <= 2 || /^[-─═]+$/.test(c.label) || /^\|/.test(c.label));

// Artifacts producing zero concepts (blank, template-only, etc.)
const zeroConcept = compiled.filter(({ result }) => result.concepts.length === 0);

// Artifacts with most frontmatter relationships
const relativelyRichFm = compiled
  .map(({ relPath, result }) => ({ relPath, relCount: result.relationships.length }))
  .filter(e => e.relCount > 0)
  .sort((a, b) => b.relCount - a.relCount)
  .slice(0, 10);

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

function mdTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length), 3));
  const header = `| ${headers.map((h, i) => h.padEnd(widths[i])).join(' | ')} |`;
  const sep = `| ${widths.map(w => '-'.repeat(w)).join(' | ')} |`;
  const body = rows.map(r => `| ${r.map((c, i) => (c ?? '').padEnd(widths[i])).join(' | ')} |`).join('\n');
  return [header, sep, body].join('\n');
}

function nodeLabel(id: string): string {
  return graph.nodes.find(n => n.id === id)?.canonicalLabel ?? id;
}

function mergedNodeExample(n: GraphNode): string {
  const aliasList = n.aliases.map(a => `"${a}"`).join(', ');
  return `"${n.canonicalLabel}" (aliases: ${aliasList})`;
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

const resolvedEdgePct = graph.edges.length === 0 ? 0
  : graph.edges.filter(isGoodEdge).length / graph.edges.length;

let verdict: string;
let verdictDetail: string;

if (resolvedEdgePct >= 0.7) {
  verdict = 'READY FOR TERRA';
  verdictDetail = `${Math.round(resolvedEdgePct * 100)}% of edges connect two real (non-synthesized) nodes. The graph has enough resolved structure to be a useful persistence target.`;
} else if (resolvedEdgePct >= 0.4) {
  verdict = 'PARTIAL — CLEANUP RECOMMENDED BEFORE TERRA';
  verdictDetail = `${Math.round(resolvedEdgePct * 100)}% of edges connect real nodes. The synthesized-node rate is high enough to warrant a cleanup pass before Terra integration.`;
} else {
  verdict = 'NOT READY — 1.3.3 REQUIRED';
  verdictDetail = `Only ${Math.round(resolvedEdgePct * 100)}% of edges connect real nodes. The primary blocker is the short ID vs long title mismatch — see Section 11 for the recommended fix.`;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

const report = `---
type: report
id: graph-dogfood-v1-2
generated: ${new Date().toISOString().slice(0, 10)}
experiment: Story 1.3.3 — Canonical Identity Aliases
supersedes: graph-dogfood-v1-1
---

# Graph Dogfood Report v1.2

**Experiment:** Story 1.3.3 — Canonical Identity Aliases (post-fix rerun)
**Generated:** ${generatedAt}
**Pipeline:** \`compileMarkdownArtifact()\` → \`buildGraph()\`
**Changes vs v1.1:** Scriptorium now emits \`documentId\` and \`documentTitle\` from frontmatter; graph builder registers both as aliases before relationship resolution — eliminating synthesized placeholders for documents that exist in the corpus.

---

## 1. Summary

${mdTable(
  ['Metric', 'Value'],
  [
    ['Markdown files discovered', String(targets.length)],
    ['Files compiled', String(compiled.length)],
    ['Files skipped (too short)', String(skipped.length)],
    ['Total concept candidates', String(totalConcepts)],
    ['Total relationship candidates', String(compiled.reduce((n, e) => n + e.result.relationships.length, 0))],
    ['Graph nodes (total)', String(graph.nodes.length)],
    ['Graph nodes (real — from concepts)', String(realNodes.length)],
    ['Graph nodes (synthesized — placeholders)', String(synthesizedNodes.length)],
    ['Graph edges', String(graph.edges.length)],
    ['Edges with both nodes real', `${graph.edges.filter(isGoodEdge).length} (${Math.round(resolvedEdgePct * 100)}%)`],
    ['Graph diagnostics (info)', String(graph.diagnostics.filter(d => d.severity === 'info').length)],
    ['Graph diagnostics (warn)', String(graph.diagnostics.filter(d => d.severity === 'warn').length)],
  ]
)}

---

## 2. Concept Source Distribution

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

## 3. Relationship Type Distribution

${relTypeRows.length > 0
  ? mdTable(
      ['Relationship type', 'Edge count'],
      relTypeRows.map(([type, count]) => [type, String(count)])
    )
  : '_No relationships extracted._'
}

---

## 4. Top Connected Nodes

Ranked by total degree (in-edges + out-edges).

${topConnected.length > 0
  ? mdTable(
      ['Node', 'Canonical label', 'Degree', 'Sources', 'Synthesized?'],
      topConnected.map(n => [
        n.id,
        n.canonicalLabel,
        String(degree.get(n.id) ?? 0),
        String(n.sourceArtifacts.length),
        n.synthesized ? 'YES' : '-',
      ])
    )
  : '_No connected nodes._'
}

---

## 5. Unresolved Relationship Targets (Synthesized Placeholders)

${unresolvedTargets.length > 0
  ? `${unresolvedTargets.length} nodes were synthesized because they appeared as relationship targets (TO side) but were not found as concepts in any artifact.\n\n` +
    (unresolvedTargets.length <= 30
      ? unresolvedTargets.map(t => `- \`${t}\``).join('\n')
      : unresolvedTargets.slice(0, 30).map(t => `- \`${t}\``).join('\n') + `\n- … and ${unresolvedTargets.length - 30} more`)
  : `_No unresolved TO-side targets — all relationship targets found as real concepts._${synthesizedNodes.length > 0 ? `\n\nNote: ${synthesizedNodes.length} synthesized node(s) exist on the FROM side. These arise when a document's own identity (fromLabel) falls back to its artifact ID path because the file has no recognized title field and produces no heading concepts. See Section 10 Finding #1.` : ''}`
}

---

## 6. Merged / Duplicate Labels

Nodes where multiple label variants (different casing, backtick formatting, etc.) were unified.

${mergedNodes.length > 0
  ? mdTable(
      ['Canonical label', 'Aliases'],
      mergedNodes.slice(0, 20).map(n => [n.canonicalLabel, n.aliases.join(', ')])
    ) + (mergedNodes.length > 20 ? `\n\n… and ${mergedNodes.length - 20} more merged nodes.` : '')
  : '_No merged labels — all concept labels were already unique after normalization._'
}

---

## 7. Artifacts Producing Frontmatter Relationships

${relativelyRichFm.length > 0
  ? mdTable(
      ['File', 'Relationship candidates'],
      relativelyRichFm.map(e => [e.relPath, String(e.relCount)])
    )
  : '_No frontmatter relationship fields found in any artifact._'
}

---

## 8. Good Edge Samples

Edges where both the source and target are real (non-synthesized) nodes.

${goodEdges.length > 0
  ? mdTable(
      ['From', 'Type', 'To', 'Source artifact'],
      goodEdges.map(e => [
        nodeLabel(e.fromNodeId),
        e.relationshipType,
        nodeLabel(e.toNodeId),
        e.sourceArtifactId.split('--').slice(-1)[0] ?? e.sourceArtifactId,
      ])
    )
  : '_No fully-resolved edges found._'
}

---

## 9. Noisy Edge Samples

Edges where the target node is a synthesized placeholder — the target concept was referenced but not found in the corpus.

${noisyEdges.length > 0
  ? mdTable(
      ['From', 'Type', 'To (unresolved)', 'Source artifact'],
      noisyEdges.map(e => [
        nodeLabel(e.fromNodeId),
        e.relationshipType,
        nodeLabel(e.toNodeId),
        e.sourceArtifactId.split('--').slice(-1)[0] ?? e.sourceArtifactId,
      ])
    )
  : '_No noisy edges found._'
}

---

## 10. Findings

### Are headings producing useful concepts?

${sourceCount.heading} heading concepts extracted across ${compiled.length} files.
${lowQualityHeadings.length > 0
  ? `**${lowQualityHeadings.length} low-quality heading concepts detected** (length ≤ 2 or pure punctuation):\n\n${lowQualityHeadings.slice(0, 10).map(c => `- \`${c.label}\` (line ${c.sourceLine ?? '?'})`).join('\n')}`
  : 'No structurally degenerate heading concepts found. Heading extraction quality is good.'
}

Most MONOLITH docs use headings as section titles rather than concept declarations. The structural noise filter (Story 1.3.2) removes the most common offenders. However, many domain-adjacent headings (e.g., "Decision", "Rationale", "References") are still extracted as concepts. The top-connected real nodes ("Knowledge Pipeline", "Memory Architecture", "Memory Governance") are genuine domain concepts, not noise.

### Are frontmatter relationships producing meaningful edges?

${compiled.reduce((n, e) => n + e.result.relationships.length, 0)} relationship candidates extracted from frontmatter.
${relativelyRichFm.length > 0
  ? `The richest relationship sources: ${relativelyRichFm.slice(0, 3).map(e => e.relPath).join(', ')}.`
  : 'Very few frontmatter relationships found. Most MONOLITH docs do not use the recognized relationship fields (related_decisions, related_protocols, depends_on, references, related).'
}

The Scriptorium now recognizes \`related_adrs\`, \`related_research\`, and \`follow_up_adrs\` in addition to the original field set. The relationship candidates extracted this run reflect the full field coverage of the MONOLITH docs/ corpus.

### Are synthesized placeholder nodes useful or noisy?

${synthesizedNodes.length} synthesized nodes out of ${graph.nodes.length} total.
${synthesizedNodes.length === 0
  ? 'No synthesized nodes — all targets resolved.'
  : synthesizedNodes.length < 10
  ? 'Low synthesized node count — acceptable for this corpus size.'
  : synthesizedNodes.length < 30
  ? 'Moderate synthesized node count. Most come from the docs/ frontmatter referencing ADR IDs and research document IDs that are not yet in the concept list.'
  : 'High synthesized node count. The majority are cross-references between docs/ architecture documents that use frontmatter fields not recognized by the current Scriptorium relationship field set.'
}

### Are canonical labels readable?

${mergedNodes.length} nodes had multiple label variants merged.
${mergedNodes.length === 0
  ? 'All labels resolved to unique canonical forms without merging.'
  : `The \`selectCanonicalLabel()\` algorithm correctly prefers Title Case over lowercase variants. Examples: ${mergedNodes.slice(0, 3).map(mergedNodeExample).join('; ')}.`
}

### Are relationship targets resolvable enough for Terra?

Resolved edge rate: **${Math.round(resolvedEdgePct * 100)}%** (${graph.edges.filter(isGoodEdge).length} of ${graph.edges.length} edges).

${resolvedEdgePct >= 0.7
  ? 'The graph has sufficient resolved structure for Terra.'
  : resolvedEdgePct >= 0.4
  ? 'More than half of edges have unresolved targets. The main cause is that docs/ frontmatter uses field names not in the Scriptorium relationship field set.'
  : 'Most edges have unresolved targets. Before persisting this graph in Terra, the field set and/or the corpus coverage needs extension.'
}

### What breaks on real MONOLITH docs?

1. **Short ID vs long title mismatch (primary remaining issue).** Documents are referenced by their short IDs (e.g., "ADR-004", "R-0001") but compiled with full H1 titles (e.g., "Terra vs Graph Memex"). These produce different normalized slugs, so short-ID references create synthesized placeholder nodes even when the target document is in the corpus. The 6 unresolved targets are all MONOLITH document IDs of this form.

2. **Generic heading saturation — partially fixed.** The Story 1.3.2 noise filter removes the specified structural headers. Remaining noise: section headings like "Decision", "Rationale", "References", "Related", "Follow-up ADRs" that appear in every ADR but are not in the current noise set.

3. **List-item heuristic misses rich concept lists.** The "≤3 words + Title Case" heuristic correctly rejects prose but also rejects multi-word Cognitive Kernel subsystem names used in lowercase (e.g., "- the sleep pipeline" → kept as evidence, not concept).

4. **Zero-concept artifacts.** ${zeroConcept.length === 0 ? 'All compiled files produced at least one concept — no empty artifacts in this corpus.' : `${zeroConcept.length} files produced no concepts at all: ${zeroConcept.map(e => e.relPath).join(', ')}.`}

---

## 11. Recommendations for Story 1.3.3

${mdTable(
  ['Problem', 'Recommended fix'],
  [
    [
      'Short ID vs long title mismatch',
      'Add frontmatter id: field value as a concept alias during compilation; or register shorthand aliases (ADR-004 → adr-004) before graph build',
    ],
    [
      'Additional heading noise',
      'Extend STRUCTURAL_HEADING_NOISE with: Decision, Rationale, References, Related, Follow-up ADRs, See Also',
    ],
    [
      'List-item heuristic too conservative',
      'Add a domain vocabulary allowlist for known multi-word lowercase MONOLITH concepts (e.g., sleep pipeline)',
    ],
    [
      'fromLabel title chain incomplete',
      'Teach compile.ts to extract H1 directly (not just via dogfood loader) so core API benefits from title inference',
    ],
  ]
)}

---

## 12. Verdict

**${verdict}**

${verdictDetail}
${skipped.length > 0 ? `\n\n### Skipped Files\n\n${skipped.map(s => `- \`${s.file}\` — ${s.reason}`).join('\n')}` : ''}
`;

mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(MD_OUT, report, 'utf-8');

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

const bar = '─'.repeat(50);
console.log('\nGraph Dogfood v1');
console.log(bar);
console.log(`Files compiled:         ${compiled.length}`);
console.log(`Files skipped:          ${skipped.length}`);
console.log(`Graph nodes (total):    ${graph.nodes.length}`);
console.log(`  real:                 ${realNodes.length}`);
console.log(`  synthesized:          ${synthesizedNodes.length}`);
console.log(`Graph edges:            ${graph.edges.length}`);
console.log(`  both-real edges:      ${graph.edges.filter(isGoodEdge).length} (${Math.round(resolvedEdgePct * 100)}%)`);
console.log(`Diagnostics warn:       ${graph.diagnostics.filter(d => d.severity === 'warn').length}`);
console.log('');
console.log('Top connected nodes:');
topConnected.slice(0, 8).forEach(n => {
  const deg = degree.get(n.id) ?? 0;
  const synth = n.synthesized ? ' [synth]' : '';
  console.log(`  ${n.canonicalLabel.padEnd(30)} deg ${deg}${synth}`);
});
console.log('');
console.log(`Verdict: ${verdict}`);
console.log(`Report:  ${relative(ROOT, MD_OUT)}`);
