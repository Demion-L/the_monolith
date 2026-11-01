/**
 * DISCOVERY-001C — unified Project Map composer (ADR-021). Internal.
 *
 * A pure transformation of TWO finished results into one Markdown text: a `DiscoveryResult`
 * (structural facts, evidence OBSERVED_FILE-class) and a `DocumentationResult` (what documents
 * claim, evidence DOCUMENT_TEXT). It reads no file, starts no analyzer, calls no model, opens no
 * connection, keeps no clock and modifies neither input.
 *
 * Identity. Neither contract carries a project identity (no id, no root, no digest); both only say
 * that they were derived from "a traversal". So the composer cannot confirm that the two results
 * describe the same project and says so in the output. It does not guess from paths or names.
 *
 * Trust. The two sources are never merged: structure comes from the existing renderer, unchanged;
 * documentation gets its own section, and every statement made by a document is shown as an
 * unverified claim. The statuses of the two analyzers are shown side by side, never combined.
 *
 * Markdown safety. Every untrusted string goes through the renderer's `markdownCodeSpan` (control and
 * bidi characters are shown as [U+XXXX], an inline code span cannot be closed by its content) and sits
 * in a list item; headings and structure are fixed text. Document text is never interpreted.
 */

import { DiscoveryError } from './contracts.js';
import { validateDiscoveryResult, type DiscoveryDiagnostic, type DiscoveryResult } from './contracts.js';
import {
  DOCUMENTATION_DIAGNOSTIC_AFFECTS_COMPLETENESS,
  validateDocumentationResult,
  type DocumentationDiagnosticCode,
  type DocumentationObservation,
  type DocumentationResult,
  type TextStatus,
} from './docs.js';
import { markdownCodeSpan as code, renderProjectMapProposal } from './render.js';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function textShown(text: string, status: TextStatus): string {
  if (status === 'WITHHELD') return '(withheld: contains unsafe characters)';
  return status === 'TRUNCATED' ? `${code(text)} (truncated)` : code(text);
}

function lines(o: DocumentationObservation): string {
  const { startLine, endLine } = o.source;
  if (startLine === undefined) return 'whole file';
  return endLine === undefined || endLine === startLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`;
}

function docDiagnosticLine(d: DiscoveryDiagnostic): string {
  const known = Object.prototype.hasOwnProperty.call(DOCUMENTATION_DIAGNOSTIC_AFFECTS_COMPLETENESS, d.code);
  const origin = d.code.startsWith('TRAVERSAL_')
    ? 'reported by the traversal'
    : known && DOCUMENTATION_DIAGNOSTIC_AFFECTS_COMPLETENESS[d.code as DocumentationDiagnosticCode]
      ? 'documentation analysis; makes the result PARTIAL'
      : 'documentation analysis; does not by itself make the result PARTIAL';
  const parts = [`${code(d.code)} (${origin})`];
  if (d.path !== undefined) parts.push(`path ${code(d.path)}`);
  if (d.count !== undefined) parts.push(`count ${d.count}`);
  return `- ${parts.join(', ')}: ${code(d.message)}`;
}

/** Lowers every heading of the (trusted, fixed-text) renderer output by two levels. Project data cannot start a line with `#`: it only appears inside code spans, and line breaks inside it are escaped. */
const demote = (markdown: string): string => markdown.replace(/^(#+) /gm, '##$1 ');

/**
 * Composes the unified Project Map. Throws `DiscoveryError('RESULT_INVALID')` if either input fails
 * its own validator (the message names which input and the first violations, never a value).
 */
export function composeProjectMap(discovery: DiscoveryResult, documentation: DocumentationResult): string {
  const dv = validateDiscoveryResult(discovery);
  if (dv.length > 0) throw new DiscoveryError('RESULT_INVALID', `cannot compose: the DiscoveryResult failed validation (${dv.length} violation(s)): ${dv.slice(0, 3).join('; ')}`);
  const cv = validateDocumentationResult(documentation);
  if (cv.length > 0) throw new DiscoveryError('RESULT_INVALID', `cannot compose: the DocumentationResult failed validation (${cv.length} violation(s)): ${cv.slice(0, 3).join('; ')}`);

  const out: string[] = [];
  const line = (s = ''): void => void out.push(s);

  line('# PROJECT MAP');
  line();
  line('This document puts two separate results side by side: structure observed in the project tree, and what the project’s Markdown documents say. They are not merged and not compared with each other. It is a proposal for a reader to review.');

  // ------------------------------------------------------------ structure
  line();
  line('## Observed Project Structure');
  line();
  line('- Source: a Discovery result (evidence from the traversal: directory entries, file names, package.json fields).');
  line('- Where the text below says documentation was not analysed, it refers to this Discovery result only; see Documentation Overview for the separate documentation result.');
  line();
  out.push(demote(renderProjectMapProposal(discovery)).replace(/\n+$/, ''));

  // ---------------------------------------------------------------- docs
  const { stats, observations } = documentation;
  line();
  line('## Documentation Overview');
  line();
  line('- Source: a Documentation result. Everything below is the content of documents as written by their authors. It is UNVERIFIED: it has not been compared with the code and may be wrong or out of date.');
  line(`- Analysis completeness: ${documentation.completeness}`);
  line(
    documentation.completeness === 'PARTIAL'
      ? '  - Some documentation information was not extracted; see Diagnostics below. Counts are lower bounds.'
      : '  - Everything inside the declared scope was handled. COMPLETE does not mean that every Markdown construct was recognised; see the supported subset in Trust & Coverage Notes.',
  );
  line(`- Reproducible: ${documentation.reproducible ? 'Yes' : 'No'}`);
  line(`- Traversal behind it: completeness ${documentation.traversal.completeness}, reproducible ${documentation.traversal.reproducible ? 'Yes' : 'No'}`);
  line(`- Schema version: ${documentation.schemaVersion}`);
  line(`- Documents listed as present: ${stats.candidateDocuments}; analysed: ${stats.documentsAnalyzed}; present but not analysed: ${stats.documentsNotAnalyzed}`);
  line(`- Bytes read: ${stats.bytesRead}; observations recorded: ${stats.observations}`);

  const byPath = new Map<string, DocumentationObservation[]>();
  for (const o of observations) {
    const g = byPath.get(o.source.path);
    if (g) g.push(o);
    else byPath.set(o.source.path, [o]);
  }

  line();
  line('### Documents');
  line();
  if (byPath.size === 0) line('- No documents were recorded.');
  for (const [path, group] of byPath) {
    line(`- ${code(path)}`);
    for (const o of group) {
      if (o.kind === 'DOCUMENT_PRESENT') {
        const size = [o.bytes === undefined ? '' : plural(o.bytes, 'byte', 'bytes'), o.lines === undefined ? '' : plural(o.lines, 'line', 'lines')].filter(Boolean).join(', ');
        line(`  - File observed (evidence ${o.evidence}); ${o.analysis === 'ANALYZED' ? 'content analysed' : 'content NOT analysed'}${size ? `; ${size}` : ''}`);
      }
    }
    const headings = group.filter((o) => o.kind === 'HEADING');
    const sections = group.filter((o) => o.kind === 'SECTION');
    const links = group.filter((o) => o.kind === 'LINK');
    if (headings.length > 0) {
      line(`  - Headings written in the document (${headings.length} recorded; evidence ${headings[0].evidence}):`);
      for (const o of headings) if (o.kind === 'HEADING') line(`    - ${lines(o)}, level ${o.level}: ${textShown(o.text, o.textStatus)}`);
    }
    if (sections.length > 0) {
      line(`  - Text ranges between headings (${sections.length} recorded; evidence ${sections[0].evidence}):`);
      for (const o of sections) if (o.kind === 'SECTION') line(`    - ${lines(o)}, opened by heading ${o.headingOrdinal}${o.parentHeadingOrdinal === undefined ? '' : ` under heading ${o.parentHeadingOrdinal}`}: ${plural(o.ownTextLineGroups, 'text line group', 'text line groups')} of its own`);
    }
    if (links.length > 0) {
      line(`  - Inline links written in the document (${links.length} recorded, not necessarily all; evidence ${links[0].evidence}; targets are not resolved or checked):`);
      for (const o of links) if (o.kind === 'LINK') line(`    - ${lines(o)}, ${o.linkType}: target ${code(o.target)}, text ${textShown(o.text, o.textStatus)}`);
    }
  }

  line();
  line('### Documentation Diagnostics');
  line();
  if (documentation.diagnostics.length === 0) line('- No diagnostics were reported.');
  for (const d of documentation.diagnostics) line(docDiagnosticLine(d));

  // --------------------------------------------------------------- trust
  const limits = documentation.limits;
  line();
  line('## Trust & Coverage Notes');
  line();
  line('- Structural facts in Observed Project Structure were obtained by observing the file tree and, for package.json, declared fields. They are observations, not verified descriptions of how the project works.');
  line('- Everything in Documentation Overview is unverified document content (evidence DOCUMENT_TEXT). The only observed item there is that a document file exists (evidence OBSERVED_FILE). No documentary statement has been confirmed by the code.');
  line('- Common origin of the two results is NOT confirmed: neither result carries a project identity, so this document cannot tell whether they describe the same project or the same moment. No such link is asserted.');
  line('- The two analyzers keep separate statuses and they are not combined:');
  line(`  - Structural Discovery: completeness ${discovery.completeness}, reproducible ${discovery.reproducible ? 'Yes' : 'No'}`);
  line(`  - Documentation Analysis: completeness ${documentation.completeness}, reproducible ${documentation.reproducible ? 'Yes' : 'No'}`);
  line('- COMPLETE refers only to the scope each analyzer declares. It is not a statement that the project or its documents were fully understood.');
  line('- Documentation scope: README.md at the project root and *.md files under docs/ that the traversal listed. Supported Markdown subset: ATX headings; one-line inline links; fenced code blocks, front matter, HTML comment lines and indented lines are skipped. Not recognised: setext headings, reference-style links, autolinks, images, raw HTML, constructs split over lines, headings or links inside quotes or lists.');
  line('- Link and heading counts are counts of recognised constructs, not the number of links or headings in a document.');
  line(`- Documentation limits: documents ${limits.maxDocuments}; bytes per document ${limits.maxDocumentBytes}; total bytes ${limits.maxTotalBytes}; headings per document ${limits.maxHeadingsPerDocument}; links per document ${limits.maxLinksPerDocument}; text length ${limits.maxTextLength}; link target length ${limits.maxTargetLength}; line length ${limits.maxLineLength}; observations ${limits.maxObservations}; diagnostics ${limits.maxDiagnostics}.`);
  line('- Not observing something is not evidence that it does not exist.');

  return `${out.join('\n')}\n`;
}
