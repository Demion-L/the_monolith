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
import { type DiscoveryResult } from './contracts.js';
/**
 * The one way an untrusted string enters the document: an inline code span. Inside a code span
 * Markdown and HTML are not interpreted. The fence is one backtick longer than the longest backtick
 * run in the text, so the text cannot close it; padding keeps leading/trailing backticks and spaces.
 */
declare function code(text: string): string;
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
export declare function renderProjectMapProposal(result: DiscoveryResult): string;
/** Internal (DISCOVERY-001C): the one safe way to place an untrusted string in Markdown, shared with the composer. */
export { code as markdownCodeSpan };
//# sourceMappingURL=render.d.ts.map