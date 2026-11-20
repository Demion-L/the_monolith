/**
 * Presentation-only classification of a status text a project document stated (REPORTED).
 * It never changes the status: the verbatim value stays available; this only picks a colour
 * and a short label. A lifecycle state is kept apart from diagnostics and from "finalized".
 */
export type LifecycleTone = 'ok' | 'progress' | 'planned' | 'unknown';

export function lifecycleTone(value: string | null): LifecycleTone {
  if (value === null) return 'unknown';
  const v = value.trim();
  if (/^complet/i.test(v)) return 'ok';
  if (/^in[ _-]?progress\b/i.test(v)) return 'progress';
  if (/^planned\b/i.test(v)) return 'planned';
  return 'unknown';
}

/** The state word(s) before any parenthetical or " — " remark: `COMPLETED (finalized …)` → `COMPLETED`. */
export function leadingStatus(value: string | null): string | null {
  if (value === null) return null;
  const head = value.split(/\s*[(—–]\s*|\s+-\s+/)[0]?.trim() ?? '';
  return head === '' ? value : head;
}

/** True only when the status text itself says "finalized" (and not "not finalized"). A REPORTED claim, not a confirmation. */
export function statesFinalized(value: string | null): boolean {
  if (value === null) return false;
  return /\bfinalized\b/i.test(value) && !/\bnot\s+finalized\b/i.test(value);
}
