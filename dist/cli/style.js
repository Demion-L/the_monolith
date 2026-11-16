/**
 * Semantic terminal colour (CLI-UX-001). Presentation only.
 *
 * Colour never carries meaning alone: every status word (PASS, FAIL, FRESH, …)
 * is printed as text first and merely tinted. ANSI is emitted only to an
 * interactive terminal; `NO_COLOR` (any non-empty value), `TERM=dumb`, pipes,
 * redirects and `--json` output stay plain. No dependency, no state.
 */
const CODES = {
    good: '32', // green
    warn: '33', // yellow
    bad: '31', // red
    dim: '90', // grey
    head: '1;35', // bold purple
    info: '36', // cyan
};
/** Status word → tone. Words not listed are never tinted. */
export const STATUS_TONE = {
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
    ADD: 'info',
    UPDATE: 'info',
    INCOMPLETE: 'warn',
    pending: 'warn',
    FAIL: 'bad',
    ok: 'good',
    FAILING: 'bad',
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
/** True only for an interactive terminal that has not opted out. */
export function colorEnabled(stream = process.stdout, env = process.env) {
    if (stream.isTTY !== true)
        return false;
    if ((env.NO_COLOR ?? '') !== '')
        return false;
    if (env.TERM === 'dumb')
        return false;
    return true;
}
export function paint(text, tone, enabled) {
    return enabled ? `\u001b[${CODES[tone]}m${text}\u001b[0m` : text;
}
/** Tints a bare status word; unknown words and a disabled style return it unchanged. */
export function statusWord(word, enabled) {
    const tone = STATUS_TONE[word];
    return tone === undefined ? word : paint(word, tone, enabled);
}
/**
 * Tints status tokens in a block of already-rendered text: the value after
 * `Label: ` on the given labels, and `[STATUS]` markers at line start. Text is
 * otherwise untouched, so disabling colour returns the input byte for byte.
 */
export function tintStatuses(text, enabled, labels = []) {
    if (!enabled)
        return text;
    let out = text.replace(/^(\s*)\[([A-Za-z_]+)\]/gm, (m, sp, w) => (STATUS_TONE[w] ? `${sp}[${statusWord(w, true)}]` : m));
    for (const label of labels) {
        out = out.replace(new RegExp(`^(${label}: )([A-Za-z_]+)`, 'gm'), (_m, pre, w) => `${pre}${statusWord(w, true)}`);
    }
    return out;
}
/**
 * Output width for wrapped text: the terminal's column count on an interactive
 * terminal (clamped to 40..100), otherwise `undefined` — pipes and redirects
 * are never re-wrapped, so machine consumers keep one logical line per line.
 */
export function wrapWidth(stream = process.stdout, env = process.env) {
    if (stream.isTTY !== true)
        return undefined;
    const fromEnv = Number.parseInt(env.COLUMNS ?? '', 10);
    const cols = typeof stream.columns === 'number' && stream.columns > 0 ? stream.columns : Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 80;
    return Math.min(100, Math.max(40, cols));
}
/**
 * Wraps one logical line at word boundaries to `width` columns (a word longer
 * than the line is hard-split). `first` prefixes the first line, `rest` every
 * continuation line (hanging indent). `width` undefined returns `first + text`.
 */
export function wrapLine(text, width, first = '', rest = first) {
    if (width === undefined)
        return first + text;
    const out = [];
    let prefix = first;
    let line = '';
    const room = () => Math.max(10, width - prefix.length);
    const flush = () => {
        out.push(prefix + line);
        prefix = rest;
        line = '';
    };
    for (const word of text.split(' ')) {
        let w = word;
        while (w.length > room()) {
            if (line !== '')
                flush();
            line = w.slice(0, room());
            w = w.slice(line.length);
            flush();
        }
        if (line === '')
            line = w;
        else if (line.length + 1 + w.length <= room())
            line += ` ${w}`;
        else {
            flush();
            line = w;
        }
    }
    if (line !== '' || out.length === 0)
        flush();
    return out.join('\n');
}
