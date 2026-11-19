// Presentation helpers for hypotheses and ADRs (UI-004). Pure and read-only: no I/O, no Markdown parsing.

export type StatusTone = 'ok' | 'warn' | 'bad' | 'neutral';

interface StatusInfo { label: string; tone: StatusTone }

// Statuses MONOLITH itself declares: hypotheses.md "Status Legend" and docs/adr/README.md "ADR Statuses".
const HYPOTHESIS_STATUSES: Record<string, StatusTone> = {
  active: 'warn', validated: 'ok', rejected: 'bad', deferred: 'neutral',
};
const ADR_STATUSES: Record<string, StatusTone> = {
  proposed: 'warn', accepted: 'ok', superseded: 'neutral', deprecated: 'neutral',
};

/** `recognized` is false for any value the project's own legend does not define; it is then shown verbatim and neutral. */
export function describeStatus(kind: 'hypothesis' | 'adr', raw: string | null): (StatusInfo & { recognized: boolean }) | null {
  if (raw === null || raw.trim() === '') return null;
  const key = raw.trim().toLowerCase();
  const table = kind === 'hypothesis' ? HYPOTHESIS_STATUSES : ADR_STATUSES;
  const tone = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
  return tone === undefined
    ? { label: raw.trim(), tone: 'neutral', recognized: false }
    : { label: key, tone, recognized: true };
}

/**
 * Only a plain project-relative, `/`-separated path is shown as a path. Anything absolute, with `..`,
 * a scheme, a backslash or a control character is rejected (returns null): the UI never presents
 * a location outside the project root. The path is text only; nothing is opened or fetched.
 */
export function safeDocPath(raw: string | null): string | null {
  if (raw === null) return null;
  const p = raw.trim();
  if (p === '' || p.length > 300) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(p)) return null;
  if (p.startsWith('/') || p.startsWith('~') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p)) return null;
  if (p.split('/').some((seg) => seg === '..' || seg === '')) return null;
  return p;
}

/**
 * Preview-only cosmetics (UI-009): removes paired `**bold**` and `` `code` `` markers from a single line of text.
 * Deliberately NOT a Markdown parser. A marker is removed only when it is a matched pair on one line with
 * non-space content directly inside it, so unpaired text (`src/**` + `/*.ts`, `2 ** 3`, a lone backtick) is
 * left untouched. Italics, headings, lists and links are never rewritten. The source data is never modified;
 * full-text views keep showing the original string.
 */
export function stripDecorativeMarkers(text: string): string {
  return text
    .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '$1')
    .replace(/`(?=[^`\s])([^`\n]*?[^`\s]|[^`\s])`/g, '$1');
}

/**
 * Border/text colour for a roadmap or story-index status badge (UI-009B). Presentation only: it colours the
 * document's own wording and never changes or derives a status. Unrecognised or missing values stay neutral.
 */
export type BadgeTone = 'progress' | 'undefined' | 'done' | 'planned' | 'neutral';
export function statusBadgeTone(value: string | null, recognized: boolean): BadgeTone {
  if (value === null || !recognized) return 'neutral';
  const v = value.trim().toUpperCase();
  if (v.startsWith('IN PROGRESS')) return 'progress';
  if (v.startsWith('NOT DEFINED')) return 'undefined';
  if (v.startsWith('COMPLETE')) return 'done';
  if (v.startsWith('PLANNED')) return 'planned';
  return 'neutral';
}
