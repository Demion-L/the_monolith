/**
 * Review finding F-7 (data/instruction boundary): `monolith brief` output
 * is AI-facing. Project data — a Mission title, a checkpoint summary, a
 * Story excerpt, a document title from frontmatter — is free text that a
 * contributor (or an attacker with ordinary write access to the project)
 * fully controls. Without escaping, a crafted value containing real
 * newlines could fake a brief-native line such as `Completeness: COMPLETE`
 * or a `## Section` heading, making project data visually indistinguishable
 * from the brief's own structure to a reader (human or AI) skimming the
 * raw text.
 *
 * This is deterministic, non-LLM hygiene only — it does not attempt to
 * detect or block prompt injection as a concept, and makes no claim that
 * it does. It guarantees two narrower, checkable properties:
 *   - a field rendered as a single line can never introduce a newline
 *     (so it can never start what looks like a new brief line/section);
 *   - control characters (escape codes, NUL, etc.) are never written to
 *     stdout raw, in single-line or multi-line fields alike.
 * The Story excerpt is the one legitimately multi-line field (it is a
 * verbatim block from active.md, already bounded by its own header and
 * `(source: ...)` footer) — its internal newlines are preserved, only
 * other control characters are escaped.
 */
/**
 * For fields rendered as a single logical line (mission title, checkpoint
 * summary, a remaining-step entry, a doc title): collapses any real
 * newline to a visible `\n` escape sequence and escapes other control
 * characters, so the field can never break out of its line.
 */
export declare function sanitizeSingleLine(s: string): string;
/**
 * For fields allowed to span multiple lines (the Story excerpt): keeps
 * real newlines (that is the field's legitimate internal structure) but
 * still escapes other control characters so nothing unprintable reaches
 * stdout raw.
 */
export declare function sanitizeMultiLine(s: string): string;
//# sourceMappingURL=sanitize.d.ts.map