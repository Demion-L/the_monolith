/**
 * Semantic terminal colour (CLI-UX-001). Presentation only.
 *
 * Colour never carries meaning alone: every status word (PASS, FAIL, FRESH, …)
 * is printed as text first and merely tinted. ANSI is emitted only to an
 * interactive terminal; `NO_COLOR` (any non-empty value), `TERM=dumb`, pipes,
 * redirects and `--json` output stay plain. No dependency, no state.
 */

export type Tone = 'good' | 'warn' | 'bad' | 'dim' | 'head';

const CODES: Record<Tone, string> = {
  good: '32', // green
  warn: '33', // yellow
  bad: '31', // red
  dim: '90', // grey
  head: '1;35', // bold purple
};

/** Status word → tone. Words not listed are never tinted. */
export const STATUS_TONE: Readonly<Record<string, Tone>> = {
  PASS: 'good',
  COMPLETE: 'good',
  COMPLETED: 'good',
  FRESH: 'good',
  READY: 'good',
  FINALIZED: 'good',
  ALREADY_FINALIZED: 'good',
  CONSISTENT: 'good',
  done: 'good',
  NOT_VERIFIED: 'warn',
  UNKNOWN: 'warn',
  WARNING: 'warn',
  UPDATE: 'warn',
  INCOMPLETE: 'warn',
  pending: 'warn',
  FAIL: 'bad',
  CONFLICT: 'bad',
  conflict: 'bad',
  STALE: 'bad',
  INCONSISTENT: 'bad',
  REFUSED: 'bad',
  NOT_READY: 'bad',
  missing: 'bad',
  unreadable: 'bad',
  UNCHANGED: 'dim',
  SKIP: 'dim',
};

export interface TextStream {
  isTTY?: boolean;
}

/** True only for an interactive terminal that has not opted out. */
export function colorEnabled(stream: TextStream = process.stdout, env: NodeJS.ProcessEnv = process.env): boolean {
  if (stream.isTTY !== true) return false;
  if ((env.NO_COLOR ?? '') !== '') return false;
  if (env.TERM === 'dumb') return false;
  return true;
}

export function paint(text: string, tone: Tone, enabled: boolean): string {
  return enabled ? `\u001b[${CODES[tone]}m${text}\u001b[0m` : text;
}

/** Tints a bare status word; unknown words and a disabled style return it unchanged. */
export function statusWord(word: string, enabled: boolean): string {
  const tone = STATUS_TONE[word];
  return tone === undefined ? word : paint(word, tone, enabled);
}

/**
 * Tints status tokens in a block of already-rendered text: the value after
 * `Label: ` on the given labels, and `[STATUS]` markers at line start. Text is
 * otherwise untouched, so disabling colour returns the input byte for byte.
 */
export function tintStatuses(text: string, enabled: boolean, labels: readonly string[] = []): string {
  if (!enabled) return text;
  let out = text.replace(/^(\s*)\[([A-Za-z_]+)\]/gm, (m, sp: string, w: string) => (STATUS_TONE[w] ? `${sp}[${statusWord(w, true)}]` : m));
  for (const label of labels) {
    out = out.replace(new RegExp(`^(${label}: )([A-Za-z_]+)`, 'gm'), (_m, pre: string, w: string) => `${pre}${statusWord(w, true)}`);
  }
  return out;
}
