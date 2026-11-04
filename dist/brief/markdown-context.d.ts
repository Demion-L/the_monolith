/**
 * Markdown context shared by the Brief, Freshness, Reconcile and DOCSYNC
 * readers of the project state documents. Pure, deterministic, no I/O.
 */
/**
 * Blanks every line (or part of a line) that sits inside a fenced code block
 * or an HTML comment, keeping the line count. Fence grammar matches DOCSYNC's
 * `activeStoryIdentity()`: a line that starts with ``` or ~~~ opens a fence,
 * and only a line made of the same character, at least as long, closes it.
 * An unterminated fence or comment hides the rest of the text — an example
 * that cannot be delimited is never read as a claim.
 */
export declare function maskNonContent(text: string): string;
//# sourceMappingURL=markdown-context.d.ts.map