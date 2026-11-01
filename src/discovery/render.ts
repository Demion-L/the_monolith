/**
 * DISCOVERY-001B-3 — deterministic Markdown renderer for a `DiscoveryResult` (ADR-021). Internal.
 *
 * A pure transformation: it takes a result that `validateDiscoveryResult` accepts and returns text.
 * It reads no file, opens no connection, starts no process, calls no model, keeps no clock and writes
 * nothing. It reports what the result contains and nothing else; in particular it draws no
 * architectural conclusion. A valid result is not independent evidence of what the project contains,
 * so every statement is phrased as an observation, a declaration, a candidate or a report.
 *
 * Markdown safety. Every string that comes from the scanned project or from the result (paths,
 * names, languages, rules, messages, codes) goes through `code()` and is only ever placed inside an
 * inline code span in a list item. Headings, list structure and section titles are fixed text, so
 * project data cannot create a heading, a list item, a link, HTML, a code fence or a new section.
 */

import {
  DEPENDENCY_SECTIONS,
  DiscoveryError,
  EXTRACTION_DIAGNOSTIC_AFFECTS_COMPLETENESS,
  FACT_LEVEL_BY_KIND,
  sourceCoverage,
  validateDiscoveryResult,
  type DiscoveryDiagnostic,
  type DiscoveryFact,
  type DiscoveryFactKind,
  type DiscoveryLimits,
  type DiscoveryResult,
  type DiscoverySource,
  type ExtractionDiagnosticCode,
} from './contracts.js';

/**
 * Longest untrusted string shown, in code points. Not a new limit: it is the contract's own maximum
 * for a project-relative path (`isSafeRelativePath` in contracts.ts, 4096). Dependency and script names are already
 * bounded by `limits.maxNameLength`; this bound covers the strings the contract leaves free
 * (diagnostic messages, language names, rule names).
 */
const MAX_SHOWN_CODE_POINTS = 4096;

// Control, format (bidirectional marks and overrides, zero-width, soft hyphen, tags), line and paragraph
// separators, and surrogates. Shown as `[U+XXXX]` so that they cannot reorder, hide or break text.
const NOT_SHOWN_AS_IS = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]$/u;

function visible(text: string): string {
  let out = '';
  let n = 0;
  for (const ch of text) {
    if (n === MAX_SHOWN_CODE_POINTS) {
      out += `…[truncated; ${text.length} UTF-16 units in total]`;
      break;
    }
    n++;
    if (NOT_SHOWN_AS_IS.test(ch)) out += `[U+${(ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}]`;
    else out += ch;
  }
  return out;
}

/**
 * The one way an untrusted string enters the document: an inline code span. Inside a code span
 * Markdown and HTML are not interpreted. The fence is one backtick longer than the longest backtick
 * run in the text, so the text cannot close it; padding keeps leading/trailing backticks and spaces.
 */
function code(text: string): string {
  const shown = visible(text);
  if (shown.length === 0) return '(empty)';
  let longest = 0;
  for (const run of shown.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(longest + 1);
  // CommonMark strips one space from each side only when the content is not all spaces, so a
  // spaces-only value gets no padding: it is shown with exactly the spaces it has.
  const pad = !/^ +$/.test(shown) && /^[` ]|[` ]$/.test(shown) ? ' ' : '';
  return `${fence}${pad}${shown}${pad}${fence}`;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function sourceText(s: DiscoverySource): string {
  return s.field === undefined ? code(s.path) : `${code(s.path)} at ${code(s.field)}`;
}

const LIMIT_LABELS: Record<keyof DiscoveryLimits, string> = {
  maxDirectoryFacts: 'directory facts',
  maxDirectoryDepth: 'directory depth',
  maxLanguageFacts: 'language facts',
  maxManifestFacts: 'manifest facts',
  maxManifestReads: 'manifest reads',
  maxManifestBytes: 'manifest size, bytes',
  maxDependenciesPerManifest: 'dependency facts per manifest',
  maxScriptsPerManifest: 'script facts per manifest',
  maxEntrypointFacts: 'entrypoint candidate facts',
  maxFacts: 'facts in total',
  maxDiagnostics: 'diagnostics',
  maxNameLength: 'dependency or script name length',
  maxSourcesPerFact: 'sources listed for a language aggregate',
};

const KIND_ORDER: readonly DiscoveryFactKind[] = Object.keys(FACT_LEVEL_BY_KIND) as DiscoveryFactKind[];

function ofKind(facts: readonly DiscoveryFact[], kind: DiscoveryFactKind): DiscoveryFact[] {
  return facts.filter((f) => f.kind === kind);
}

/** Groups facts by subject, keeping the (already canonical) order of first appearance. */
function bySubject(facts: readonly DiscoveryFact[]): Map<string, DiscoveryFact[]> {
  const groups = new Map<string, DiscoveryFact[]>();
  for (const f of facts) {
    const g = groups.get(f.subject);
    if (g) g.push(f);
    else groups.set(f.subject, [f]);
  }
  return groups;
}

function diagnosticLine(d: DiscoveryDiagnostic): string {
  const known = Object.prototype.hasOwnProperty.call(EXTRACTION_DIAGNOSTIC_AFFECTS_COMPLETENESS, d.code);
  const origin = d.code.startsWith('TRAVERSAL_')
    ? 'reported by the traversal'
    : known && EXTRACTION_DIAGNOSTIC_AFFECTS_COMPLETENESS[d.code as ExtractionDiagnosticCode]
      ? 'extraction; makes the result PARTIAL'
      : 'extraction; does not by itself make the result PARTIAL';
  const parts = [`${code(d.code)} (${origin})`];
  if (d.path !== undefined) parts.push(`path ${code(d.path)}`);
  if (d.count !== undefined) parts.push(`count ${d.count}`);
  return `- ${parts.join(', ')}: ${code(d.message)}`;
}

/**
 * Renders a Project Map Proposal for a `DiscoveryResult`.
 *
 * Throws `DiscoveryError('RESULT_INVALID')` if the result does not satisfy `validateDiscoveryResult`
 * (which includes the canonical order of facts, sources and diagnostics). The message carries the
 * first violations, which by the validator's own design name a location and a rule and never repeat
 * a value from the input. The input is not modified.
 *
 * The size of the output is linear in the size of the (bounded) result: every untrusted string is cut
 * at `MAX_SHOWN_CODE_POINTS` and no section lists more than the result holds.
 */
export function renderProjectMapProposal(result: DiscoveryResult): string {
  const violations = validateDiscoveryResult(result);
  if (violations.length > 0) {
    throw new DiscoveryError('RESULT_INVALID', `cannot render: the result failed validation (${violations.length} violation(s)): ${violations.slice(0, 3).join('; ')}`);
  }

  const { facts, diagnostics, stats, limits } = result;
  const partial = result.completeness === 'PARTIAL';
  const out: string[] = [];
  const line = (s = ''): void => void out.push(s);

  line('# Project Map Proposal');
  line();
  line(
    'This document reports the contents of a Discovery result. It lists observed, declared and candidate items; it is a proposal for a reader to review, not a verified description of the project. A valid result is not independent evidence of what the project contains.',
  );

  // ---------------------------------------------------------------- status
  line();
  line('## Discovery Status');
  line();
  line(`- Completeness: ${result.completeness}`);
  line(
    partial
      ? '  - Some information may have been skipped. Facts that were extracted are shown below; see Limitations for the diagnostics.'
      : '  - The scan covered the scope it declared. This does not mean that every aspect of the project was examined.',
  );
  line(`- Reproducible: ${result.reproducible ? 'Yes' : 'No'}`);
  if (!result.reproducible) line('  - A second scan of the unchanged tree might not return this result.');
  line(`- Traversal: completeness ${result.traversal.completeness}, reproducible ${result.traversal.reproducible ? 'Yes' : 'No'}`);
  line(`- Schema version: ${result.schemaVersion}`);
  line('- Analysed manifest format: package.json only.');
  line('  - Other recognised manifest names are reported as present; their content was not analysed. Documentation files were not analysed.');
  line(`- Traversal entries received: ${stats.inputEntries} (${stats.excludedEntries} did not reach extraction)`);
  line(`- Manifests found: ${stats.manifestsFound}; package.json reads attempted: ${stats.manifestsRead} (an attempt may have failed; see Limitations)`);
  line(`- Facts recorded: ${stats.facts}`);

  // ------------------------------------------------------------- structure
  line();
  line('## Project Structure');
  line();
  const directories = ofKind(facts, 'DIRECTORY');
  if (directories.length === 0) line('- No directory entries were observed.');
  else {
    line(`- Observed directories (${directories.length}, down to depth ${limits.maxDirectoryDepth}):`);
    for (const f of directories) line(`  - ${code(f.subject)}`);
  }

  // ------------------------------------------------------------- languages
  line();
  line('## Observed Languages');
  line();
  const languages = ofKind(facts, 'LANGUAGE_BY_EXTENSION');
  if (languages.length === 0) line('- No language-by-extension observations were recorded.');
  for (const f of languages) {
    const count = Number(f.value);
    const full = sourceCoverage(f) === 'FULL';
    line(`- ${code(f.subject)} (extension ${code(f.object as string)}): ${plural(count, 'observed file', 'observed files')}; source coverage ${full ? 'FULL' : 'SAMPLE'}`);
    line(full ? `  - Sources (all ${plural(f.sources.length, 'file', 'files')}):` : `  - Source examples (${f.sources.length} listed of ${count} observed files; not a complete list):`);
    for (const s of f.sources) line(`    - ${sourceText(s)}`);
  }
  if (languages.length > 0) {
    line();
    line('- Language is derived from the file extension only; file contents were not inspected.');
    if (partial) line('- The result is PARTIAL: counts are lower bounds and some languages may be missing.');
  }
  if (stats.filesWithoutKnownLanguage > 0) {
    if (languages.length === 0) line();
    line(`- ${plural(stats.filesWithoutKnownLanguage, 'file has', 'files have')} an extension with no known language mapping (reported, not guessed).`);
  }

  // ------------------------------------------------------------- manifests
  line();
  line('## Detected Manifests');
  line();
  const manifests = ofKind(facts, 'MANIFEST_PRESENT');
  if (manifests.length === 0) line('- No known manifest file names were observed.');
  for (const f of manifests) {
    const analysed = f.subject.slice(f.subject.lastIndexOf('/') + 1) === 'package.json';
    line(`- ${code(f.subject)} (ecosystem hint ${code(f.object ?? '')}): file name observed; ${analysed ? 'content analysis is supported for this format; whether it was read is shown by the diagnostics' : 'content not analysed in this version'}`);
  }

  // ---------------------------------------------------------- dependencies
  line();
  line('## Declared Dependencies');
  line();
  const dependencies = ofKind(facts, 'DEPENDENCY_DECLARED');
  if (dependencies.length === 0) line('- No dependency declarations were observed.');
  else {
    line('- These are names declared in a manifest. They are not resolved, not installed and not checked against use in the code.');
    for (const [manifest, group] of bySubject(dependencies)) {
      line(`- Declared in ${code(manifest)}:`);
      for (const section of DEPENDENCY_SECTIONS) {
        const inSection = group.filter((f) => f.value === section);
        if (inSection.length === 0) continue;
        line(`  - ${code(section)} (${inSection.length}):`);
        for (const f of inSection) line(`    - ${code(f.object as string)} — ${sourceText(f.sources[0])}`);
      }
    }
  }

  // --------------------------------------------------------------- scripts
  line();
  line('## Declared Scripts');
  line();
  const scripts = ofKind(facts, 'SCRIPT_DECLARED');
  if (scripts.length === 0) line('- No script declarations were observed.');
  else {
    line('- Only script names are recorded. Commands are neither stored nor run.');
    for (const [manifest, group] of bySubject(scripts)) {
      line(`- Declared in ${code(manifest)} (${group.length}):`);
      for (const f of group) line(`  - ${code(f.object as string)} — ${sourceText(f.sources[0])}`);
    }
  }

  // ----------------------------------------------------------- entrypoints
  line();
  line('## Entrypoint Candidates');
  line();
  const entrypoints = ofKind(facts, 'ENTRYPOINT_CANDIDATE');
  if (entrypoints.length === 0) line('- No entrypoint candidates were observed.');
  else {
    line('- A candidate is a file whose name follows a common convention. It is not confirmed to start the program.');
    for (const f of entrypoints) line(`  - Candidate: ${code(f.subject)} (interpreted by rule ${code(f.rule)} from a file observed at this path)`);
  }

  // -------------------------------------------------------------- evidence
  line();
  line('## Evidence & Provenance');
  line();
  line('- Fact counts by kind:');
  for (const kind of KIND_ORDER) {
    const note = kind === 'FILE_PRESENT' ? ' (file evidence for entrypoint candidates only; not a count of project files)' : '';
    line(`  - ${kind} (${FACT_LEVEL_BY_KIND[kind]}): ${ofKind(facts, kind).length}${note}`);
  }
  const sampled = languages.filter((f) => sourceCoverage(f) === 'SAMPLE').length;
  line(`- Source coverage: ${plural(languages.length - sampled, 'aggregate is', 'aggregates are')} FULL and ${plural(sampled, 'aggregate is', 'aggregates are')} SAMPLE. Every other fact rests on exactly the source listed with it.`);
  line('- DETECTED: observed in the project’s file names, directory entries or manifest fields. INTERPRETED: derived from DETECTED facts by a named rule.');
  line('- Source paths are project-relative as reported by the result; none was checked again while rendering.');

  // ----------------------------------------------------------- limitations
  line();
  line('## Limitations');
  line();
  line('- Not observing something is not evidence that it does not exist in the project.');
  line('- Only package.json content is analysed; other manifest formats and documentation are not.');
  line('- Dependencies and scripts are declarations; entrypoints are name-based candidates.');
  line(`- Configured limits: ${(Object.keys(LIMIT_LABELS) as (keyof DiscoveryLimits)[]).map((k) => `${LIMIT_LABELS[k]} ${limits[k]}`).join('; ')}.`);
  line();
  line('### Diagnostics');
  line();
  if (diagnostics.length === 0) line('- No diagnostics were reported.');
  for (const d of diagnostics) line(diagnosticLine(d));

  return `${out.join('\n')}\n`;
}

/** Internal (DISCOVERY-001C): the one safe way to place an untrusted string in Markdown, shared with the composer. */
export { code as markdownCodeSpan };
