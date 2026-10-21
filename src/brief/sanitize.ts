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

// C0 controls other than \t (0x09), \n (0x0A), \r (0x0D), plus DEL (0x7F).
const OTHER_CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function escapeChar(ch: string): string {
  return `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`;
}

/**
 * For fields rendered as a single logical line (mission title, checkpoint
 * summary, a remaining-step entry, a doc title): collapses any real
 * newline to a visible `\n` escape sequence and escapes other control
 * characters, so the field can never break out of its line.
 */
export function sanitizeSingleLine(s: string): string {
  return s.replace(/\r\n|\r|\n/g, '\\n').replace(OTHER_CONTROL_CHARS_RE, escapeChar);
}

/**
 * For fields allowed to span multiple lines (the Story excerpt): keeps
 * real newlines (that is the field's legitimate internal structure) but
 * still escapes other control characters so nothing unprintable reaches
 * stdout raw.
 */
export function sanitizeMultiLine(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(OTHER_CONTROL_CHARS_RE, escapeChar);
}
