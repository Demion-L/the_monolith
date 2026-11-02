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
import { type DiscoveryResult } from './contracts.js';
import { type DocumentationResult } from './docs.js';
/**
 * Composes the unified Project Map. Throws `DiscoveryError('RESULT_INVALID')` if either input fails
 * its own validator (the message names which input and the first violations, never a value).
 */
export declare function composeProjectMap(discovery: DiscoveryResult, documentation: DocumentationResult): string;
//# sourceMappingURL=compose.d.ts.map