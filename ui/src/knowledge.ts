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
