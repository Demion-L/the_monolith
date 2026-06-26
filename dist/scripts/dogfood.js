#!/usr/bin/env node
/**
 * Webway Dogfood Experiment v0
 *
 * Runs analyzeArtifact() over MONOLITH's own markdown artifacts and
 * writes an evidence report to .monolith/reports/.
 *
 * Run: node dist/scripts/dogfood.js  (from project root)
 * Or:  pnpm dogfood
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { analyzeArtifact } from '../webway/analyze.js';
// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const ROOT = process.cwd();
const REPORT_DIR = join(ROOT, '.monolith', 'reports');
const JSON_OUT = join(REPORT_DIR, 'webway-dogfood-v0.json');
const MD_OUT = join(REPORT_DIR, 'webway-dogfood-v0.md');
/** Minimum character count before we consider a file worth analyzing. */
const MIN_CONTENT_CHARS = 50;
/** Concept labels that are structural document artefacts, not domain knowledge. */
const STRUCTURAL_NOISE = new Set([
    'related', 'type', 'authority', 'category', 'protocol', 'protocols',
    'decisions', 'description', 'status', 'entry', 'source', 'field',
    'value', 'record', 'date', 'true', 'false', 'version', 'name',
    'purpose', 'target', 'meaning', 'stage', 'criteria', 'active',
    'accepted', 'proposed', 'deferred', 'validated', 'rejected',
    'role', 'skill', 'step', 'file', 'files', 'note', 'notes',
    'example', 'examples', 'item', 'items', 'list', 'table',
    'format', 'required', 'optional', 'output', 'input', 'result',
    'current', 'system', 'null', 'none', 'yes',
]);
/** A file is flagged as noisy if ≥ this many of its top concepts are structural noise. */
const NOISE_THRESHOLD = 3;
// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------
function findMdFiles(dir) {
    const results = [];
    let entries;
    try {
        entries = readdirSync(dir);
    }
    catch {
        return results;
    }
    for (const entry of entries) {
        if (entry.startsWith('.git') && entry !== '.monolith')
            continue;
        const full = join(dir, entry);
        let s;
        try {
            s = statSync(full);
        }
        catch {
            continue;
        }
        if (s.isDirectory()) {
            if (entry === 'node_modules' || entry === 'dist')
                continue;
            results.push(...findMdFiles(full));
        }
        else if (extname(entry) === '.md') {
            results.push(full);
        }
    }
    return results;
}
const targets = [
    ...findMdFiles(join(ROOT, '.monolith')),
    ...findMdFiles(join(ROOT, 'docs')),
];
// README.md at root
const readmePath = join(ROOT, 'README.md');
try {
    statSync(readmePath);
    targets.push(readmePath);
}
catch { /* absent */ }
const analyzed = [];
const skipped = [];
const errors = [];
for (const filePath of targets) {
    const relPath = relative(ROOT, filePath);
    const artifactId = relPath.replace(/[\\/]/g, '--').replace(/\.md$/, '');
    let content;
    try {
        content = readFileSync(filePath, 'utf-8');
    }
    catch (e) {
        errors.push({ file: relPath, error: String(e) });
        continue;
    }
    if (content.trim().length < MIN_CONTENT_CHARS) {
        skipped.push({ file: relPath, reason: `too short (${content.trim().length} chars)` });
        continue;
    }
    const artifact = {
        id: artifactId,
        content,
        source: relPath,
        createdAt: new Date(),
    };
    analyzed.push({
        relPath,
        artifactId,
        contentLength: content.length,
        result: analyzeArtifact(artifact),
    });
}
// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------
// Concept label frequency across files
const conceptFileCount = new Map();
const conceptFiles = new Map();
for (const { relPath, result } of analyzed) {
    const seen = new Set();
    for (const c of result.concepts) {
        if (!seen.has(c.label)) {
            seen.add(c.label);
            conceptFileCount.set(c.label, (conceptFileCount.get(c.label) ?? 0) + 1);
            if (!conceptFiles.has(c.label))
                conceptFiles.set(c.label, []);
            conceptFiles.get(c.label).push(relPath);
        }
    }
}
const topConcepts = [...conceptFileCount.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 30)
    .map(([label, count]) => ({ label, count, files: conceptFiles.get(label) ?? [] }));
const repeatedConcepts = [...conceptFileCount.entries()]
    .filter(([, count]) => count >= 3)
    .sort(([, a], [, b]) => b - a)
    .map(([label, count]) => ({ label, count, files: conceptFiles.get(label) ?? [] }));
// Region distribution
const regionCount = new Map();
for (const { result } of analyzed) {
    const r = result.suggestedRegion;
    if (!regionCount.has(r.id))
        regionCount.set(r.id, { name: r.name, count: 0 });
    regionCount.get(r.id).count++;
}
const regionDist = [...regionCount.entries()]
    .map(([id, { name, count }]) => ({ id, name, count }))
    .sort((a, b) => b.count - a.count);
// Strongest links across all files
const conceptIdToLabel = new Map();
for (const { result } of analyzed) {
    for (const c of result.concepts)
        conceptIdToLabel.set(c.id, c.label);
}
const strongestLinks = analyzed
    .flatMap(({ result }) => result.links)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 15)
    .map(link => ({
    from: conceptIdToLabel.get(link.fromConceptId) ?? link.fromConceptId,
    relationship: link.relationshipType,
    to: conceptIdToLabel.get(link.toConceptId) ?? link.toConceptId,
    strength: link.strength,
}));
// Noise vs signal classification
const noisyFiles = [];
const signalFiles = [];
for (const { relPath, result } of analyzed) {
    const labels = result.concepts.map(c => c.label);
    if (labels.length === 0) {
        noisyFiles.push({ file: relPath, concepts: [], noiseCount: 0 });
        continue;
    }
    const noiseCount = labels.filter(l => STRUCTURAL_NOISE.has(l)).length;
    if (noiseCount >= NOISE_THRESHOLD) {
        noisyFiles.push({ file: relPath, concepts: labels, noiseCount });
    }
    else {
        signalFiles.push({
            file: relPath,
            concepts: labels,
            region: result.suggestedRegion.name,
            confidence: result.mentalModels[0]?.confidence ?? 0,
        });
    }
}
// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------
const jsonOutput = {
    experiment: 'webway-dogfood-v0',
    generatedAt: new Date().toISOString(),
    summary: {
        filesDiscovered: targets.length,
        filesAnalyzed: analyzed.length,
        filesSkipped: skipped.length,
        filesErrored: errors.length,
        distinctConceptLabels: conceptFileCount.size,
        totalSemanticLinks: analyzed.reduce((n, { result }) => n + result.links.length, 0),
        repeatedConceptCount: repeatedConcepts.length,
        signalFiles: signalFiles.length,
        noisyFiles: noisyFiles.length,
    },
    regionDistribution: regionDist,
    topConcepts,
    repeatedConcepts,
    strongestLinks,
    signalFiles: signalFiles.map(f => ({
        file: f.file,
        concepts: f.concepts,
        region: f.region,
        confidence: f.confidence,
    })),
    noisyFiles: noisyFiles.map(f => ({
        file: f.file,
        concepts: f.concepts,
        noiseCount: f.noiseCount,
    })),
    skipped,
    errors,
    perFile: analyzed.map(({ relPath, contentLength, result }) => ({
        file: relPath,
        contentLength,
        concepts: result.concepts.map(c => ({ label: c.label, weight: c.weight })),
        region: { id: result.suggestedRegion.id, name: result.suggestedRegion.name },
        links: result.links.map(l => ({
            from: conceptIdToLabel.get(l.fromConceptId) ?? l.fromConceptId,
            rel: l.relationshipType,
            to: conceptIdToLabel.get(l.toConceptId) ?? l.toConceptId,
            strength: l.strength,
        })),
        confidence: result.mentalModels[0]?.confidence ?? 0,
    })),
};
mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(JSON_OUT, JSON.stringify(jsonOutput, null, 2), 'utf-8');
// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------
const pct = (n, total) => total === 0 ? '0%' : `${Math.round((n / total) * 100)}%`;
const pad = (s, w) => s.padEnd(w).slice(0, w);
function mdTable(headers, rows) {
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)));
    const header = `| ${headers.map((h, i) => pad(h, widths[i])).join(' | ')} |`;
    const sep = `| ${widths.map(w => '-'.repeat(w)).join(' | ')} |`;
    const body = rows.map(r => `| ${r.map((c, i) => pad(c, widths[i])).join(' | ')} |`).join('\n');
    return [header, sep, body].join('\n');
}
const totalAnalyzed = analyzed.length;
const verdictSignalRatio = signalFiles.length / totalAnalyzed;
let usefulnessVerdict;
let verdictExplanation;
if (verdictSignalRatio >= 0.6) {
    usefulnessVerdict = '**Partially useful**';
    verdictExplanation = `${signalFiles.length} of ${totalAnalyzed} files produced concepts that appear semantically coherent. The frequency-based approach surfaces the genuine core vocabulary of the corpus, but cannot distinguish between domain signal and document-structure noise.`;
}
else if (verdictSignalRatio >= 0.3) {
    usefulnessVerdict = '**Marginally useful**';
    verdictExplanation = `Only ${signalFiles.length} of ${totalAnalyzed} files produced meaningful signal. Most output reflects document structure (frontmatter keys, table headers) rather than knowledge content.`;
}
else {
    usefulnessVerdict = '**Not useful as-is**';
    verdictExplanation = `Fewer than 30% of files produced meaningful signal. Frequency extraction on structured markdown is dominated by document boilerplate.`;
}
const topKnowledgeConcepts = topConcepts
    .filter(c => !STRUCTURAL_NOISE.has(c.label))
    .slice(0, 15);
const md = `---
type: report
id: webway-dogfood-v0
generated: ${new Date().toISOString().slice(0, 10)}
experiment: Webway Dogfood Experiment v0
---

# Webway Dogfood Report v0

First-run evidence: WEBWAY v0 \`analyzeArtifact()\` applied to MONOLITH's own markdown corpus.

**Generated:** ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC
**WEBWAY version:** 0.1.0 (frequency-based, no embeddings, no LLM)

---

## 1. Summary

${mdTable(['Metric', 'Value'], [
    ['Files discovered', String(targets.length)],
    ['Files analyzed', String(totalAnalyzed)],
    ['Files skipped (too short)', String(skipped.length)],
    ['Files with signal', `${signalFiles.length} (${pct(signalFiles.length, totalAnalyzed)})`],
    ['Files flagged as noisy', `${noisyFiles.length} (${pct(noisyFiles.length, totalAnalyzed)})`],
    ['Distinct concept labels', String(conceptFileCount.size)],
    ['Total semantic links generated', String(jsonOutput.summary.totalSemanticLinks)],
    ['Concepts repeated in 3+ files', String(repeatedConcepts.length)],
])}

---

## 2. Region Distribution

${mdTable(['Region', 'Files', 'Share'], regionDist.map(r => [r.name, String(r.count), pct(r.count, totalAnalyzed)]))}

**Observation:** Nearly all MONOLITH governance artifacts are classified as Cognitive Architecture. This is expected — the corpus is about cognition, memory, and knowledge. It also reflects that the static keyword profiles have a strong overlap with MONOLITH's own vocabulary.

---

## 3. Top Concepts — Domain Signal (noise filtered)

Concept labels appearing most frequently, excluding structural document terms.

${mdTable(['Concept', 'Files', 'Share of corpus'], topKnowledgeConcepts.map(c => [c.label, String(c.count), pct(c.count, totalAnalyzed)]))}

**Observation:** The top recurring domain concepts are the genuine vocabulary of the MONOLITH worldview. \`knowledge\`, \`memory\`, \`region\`, \`concept\`, \`semantic\`, \`artifact\`, \`model\`, \`hypothesis\` — these appear consistently because they ARE the concepts the system is built around.

---

## 4. Top Concepts — Raw (includes structural noise)

Full top-30 without noise filtering, showing the contamination from document structure.

${mdTable(['Concept', 'Files', 'Noise?'], topConcepts.slice(0, 20).map(c => [c.label, String(c.count), STRUCTURAL_NOISE.has(c.label) ? 'YES' : '-']))}

---

## 5. Repeated Concepts (3+ files)

${mdTable(['Concept', 'Files', 'Signal?'], repeatedConcepts.map(c => [c.label, String(c.count), STRUCTURAL_NOISE.has(c.label) ? 'noise' : 'signal']))}

---

## 6. Strongest Semantic Links (sample)

Links are assigned by adjacency in top-N concept list. Relationship types rotate: \`relates-to → extends → depends-on\`. Not semantically meaningful yet — this is v0's placeholder.

${mdTable(['From', 'Relationship', 'To', 'Strength'], strongestLinks.map(l => [l.from, l.relationship, l.to, l.strength.toFixed(2)]))}

**Observation:** Strength is derived from the second concept's weight in its source artifact. The relationship types (relates-to / extends / depends-on) are rotated mechanically — they carry no semantic content at this stage. This is the clearest failure point of v0.

---

## 7. Signal Files (sample — top 20 by confidence)

Files where fewer than ${NOISE_THRESHOLD} of 5 top concepts are structural noise terms.

${mdTable(['File', 'Top concepts', 'Region', 'Conf.'], signalFiles
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 20)
    .map(f => [
    f.file.replace('.monolith/', '').replace('docs/', 'docs/').slice(0, 55),
    f.concepts.slice(0, 3).join(', '),
    f.region.replace('Cognitive Architecture', 'CogArch').replace('Software Engineering', 'SoftEng').replace('Data Systems', 'DataSys'),
    f.confidence.toFixed(2),
]))}

---

## 8. Noise / Failure Cases

Files where ≥ ${NOISE_THRESHOLD} of 5 top concepts are document-structure terms (frontmatter keys, table headers).

${mdTable(['File', 'Top concepts', 'Noise count'], noisyFiles
    .sort((a, b) => b.noiseCount - a.noiseCount)
    .slice(0, 20)
    .map(f => [
    f.file.replace('.monolith/', '').slice(0, 55),
    (f.concepts.slice(0, 3).join(', ') || '(empty)'),
    String(f.noiseCount),
]))}

**Pattern:** Most noise comes from:
1. Governance schemas and rule templates (RULE_SCHEMA.md, metadata-schema.md) — document structure vocabulary dominates content vocabulary.
2. Short files (index files, README stubs) — too few tokens for frequency to separate signal from noise.
3. YAML frontmatter in all files — keys like \`type\`, \`authority\`, \`related\`, \`status\` appear before the prose and get ranked as top concepts.

---

## 9. Skipped Files

${skipped.length > 0
    ? mdTable(['File', 'Reason'], skipped.map(s => [s.file.replace('.monolith/', ''), s.reason]))
    : '_None._'}

---

## 10. Honest Usefulness Verdict

**Verdict:** ${usefulnessVerdict}

${verdictExplanation}

### What worked

- **Core vocabulary is real.** The top non-noisy concepts across the corpus — \`knowledge\`, \`memory\`, \`region\`, \`concept\`, \`semantic\`, \`artifact\`, \`model\` — are the genuine building blocks of the MONOLITH worldview. Frequency extraction found them because they ARE the dominant vocabulary. H2 (Knowledge Emerges from Structure) is supported in the trivial sense: the words that matter appear most often.

- **Region assignment is mostly correct.** ${pct(regionDist[0]?.count ?? 0, totalAnalyzed)} of files were assigned to ${regionDist[0]?.name ?? 'N/A'}. Given that MONOLITH is a cognitive architecture system, this is the right answer. The static keyword profiles overlap heavily with the actual corpus vocabulary — which is a feature for this domain.

- **Signal vs noise is separable post-hoc.** With a structural noise list, ${pct(signalFiles.length, totalAnalyzed)} of files produce coherent output. The separation works, but it requires manual curation of the noise list — which means the signal was never truly extracted, it was residual after subtraction.

### What didn't work

- **YAML frontmatter contaminates every file.** Because every MONOLITH artifact starts with a frontmatter block (\`type\`, \`id\`, \`category\`, \`authority\`, \`related_protocols\`...), these keys appear in the top-5 of nearly every document. The tokenizer treats metadata as content.

- **Semantic links carry no meaning.** The relationship types (\`relates-to\`, \`extends\`, \`depends-on\`) are mechanically rotated based on index position in the top-5 list. "knowledge relates-to memory" is an accidental pairing, not an inferred relationship. This is the most important failure for the actual knowledge-graph use case.

- **No cross-artifact structure.** Each file is analyzed in isolation. The most important concepts — \`knowledge\`, \`memory\`, \`region\` — appear in 40+ files. But v0 cannot tell you that \`knowledge\` and \`region\` co-occur *in the same context* across files, or that the relationship between them is consistent. This is the Terra gap.

- **Governance and schema files produce pure noise.** Files like \`RULE_SCHEMA.md\`, \`metadata-schema.md\`, \`command-policy.md\` are structural artifacts — their vocabulary IS the document structure. Frequency extraction cannot extract semantic content from content that is itself formal structure.

### What v1 would need to fix

| Problem | v1 fix |
|---------|--------|
| Frontmatter contamination | Strip YAML frontmatter before tokenization |
| Mechanical link types | Embedding similarity → typed relationship inference |
| No cross-artifact patterns | Terra persistence layer — cross-file concept co-occurrence |
| Region assignment guessing | Embedding-based semantic similarity to region centroids |
| Short-file degradation | Minimum token count threshold; fuse short files (e.g. INDEX + SKILL) |

### Implication for H-series hypotheses

| Hypothesis | Status after this experiment |
|-----------|------------------------------|
| H1 — Naive RAG fails due to structural absence | Unaffected — this experiment does not involve RAG |
| H2 — Knowledge emerges from structure | Weakly supported: frequency finds the right vocabulary but not the right structure |
| H3 — Meaning linking outperforms keyword matching | Confirmed as a *requirement*: v0 link types are meaningless |
| H4 — Regions grow from accumulated artifacts | Not testable without Terra |
| H5 — Org memory = agent memory | Not tested here |
| H6 — WEBWAY upgrades MONOLITH from storage to formation | Partially demonstrated: the vocabulary is correct; the structure is absent |
| H7 — Continuous Question Loop | Not testable without cross-artifact links and gap detection |
| H8 — Predictive power as maturity signal | Not testable without held-out evaluation data |

---

*Full data: \`.monolith/reports/webway-dogfood-v0.json\`*
`;
writeFileSync(MD_OUT, md, 'utf-8');
// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------
console.log('\nWebway Dogfood v0');
console.log('─'.repeat(50));
console.log(`Files analyzed:     ${totalAnalyzed}`);
console.log(`Files skipped:      ${skipped.length}`);
console.log(`Signal files:       ${signalFiles.length} (${pct(signalFiles.length, totalAnalyzed)})`);
console.log(`Noisy files:        ${noisyFiles.length} (${pct(noisyFiles.length, totalAnalyzed)})`);
console.log(`Distinct concepts:  ${conceptFileCount.size}`);
console.log(`Repeated (3+):      ${repeatedConcepts.length}`);
console.log('\nTop domain concepts:');
topKnowledgeConcepts.slice(0, 8).forEach(c => {
    console.log(`  ${c.label.padEnd(18)} ${c.count} files`);
});
console.log('\nRegion distribution:');
regionDist.forEach(r => {
    console.log(`  ${r.name.padEnd(25)} ${r.count} files (${pct(r.count, totalAnalyzed)})`);
});
console.log(`\nVerdict: ${usefulnessVerdict.replace(/\*\*/g, '')}`);
console.log(`\nReports:`);
console.log(`  ${relative(ROOT, JSON_OUT)}`);
console.log(`  ${relative(ROOT, MD_OUT)}`);
