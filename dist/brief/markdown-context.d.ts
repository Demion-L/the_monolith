/**
 * Markdown context shared by the Brief, Freshness, Reconcile and DOCSYNC
 * readers of the project state documents. Pure, deterministic, no I/O.
 */
/**
 * True when the first visible line of a Current Story excerpt (outside code
 * fences and HTML comments) declares that there is no active story. Shared by
 * the Brief and DOCSYNC (PSC-004A): such a declaration next to a structural
 * `**Story:**` field is a contradiction, never a confirmed "none" and never
 * a confirmed identity.
 */
export declare function declaresNoActiveStory(excerpt: string): boolean;
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