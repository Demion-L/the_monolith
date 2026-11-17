/**
 * Semantic terminal colour (CLI-UX-001). Presentation only.
 *
 * Colour never carries meaning alone: every status word (PASS, FAIL, FRESH, …)
 * is printed as text first and merely tinted. ANSI is emitted only to an
 * interactive terminal; `NO_COLOR` (any non-empty value), `TERM=dumb`, pipes,
 * redirects and `--json` output stay plain. No dependency, no state.
 */
export type Tone = 'good' | 'warn' | 'bad' | 'dim' | 'head' | 'info';
/** Status word → tone. Words not listed are never tinted. */
export declare const STATUS_TONE: Readonly<Record<string, Tone>>;
export interface TextStream {
    isTTY?: boolean;
}
/** True only for an interactive terminal that has not opted out. */
export declare function colorEnabled(stream?: TextStream, env?: NodeJS.ProcessEnv): boolean;
export declare function paint(text: string, tone: Tone, enabled: boolean): string;
/** Tints a bare status word; unknown words and a disabled style return it unchanged. */
export declare function statusWord(word: string, enabled: boolean): string;
/**
 * Tints status tokens in a block of already-rendered text: the value after
 * `Label: ` on the given labels, and `[STATUS]` markers at line start. Text is
 * otherwise untouched, so disabling colour returns the input byte for byte.
 */
export declare function tintStatuses(text: string, enabled: boolean, labels?: readonly string[]): string;
/**
 * Output width for wrapped text: the terminal's column count on an interactive
 * terminal (clamped to 40..100), otherwise `undefined` — pipes and redirects
 * are never re-wrapped, so machine consumers keep one logical line per line.
 */
export declare function wrapWidth(stream?: TextStream & {
    columns?: number;
}, env?: NodeJS.ProcessEnv): number | undefined;
/**
 * Wraps one logical line at word boundaries to `width` columns (a word longer
 * than the line is hard-split). `first` prefixes the first line, `rest` every
 * continuation line (hanging indent). `width` undefined returns `first + text`.
 */
export declare function wrapLine(text: string, width: number | undefined, first?: string, rest?: string): string;
//# sourceMappingURL=style.d.ts.map