/**
 * Managed blocks (DX-UPDATE-003): the one mechanism by which `monolith init`
 * and `monolith update` put MONOLITH-owned text into a file the user also owns
 * (CLAUDE.md, AGENTS.md, routing-map, skills index) or into a MONOLITH-owned
 * file the user may extend (`AGENT.md`).
 *
 *   <!-- monolith:begin <id> sha256=<16 hex of the body> -->
 *   ...body...
 *   <!-- monolith:end <id> -->
 *
 * The checksum is what makes a refresh safe without a stored template version:
 * a block whose body still matches its own checksum was never edited, so it is
 * ours to refresh; a block that does not match carries a user edit and is left
 * alone (CONFLICT). Everything outside the markers is never read for meaning
 * and never changed. Markers inside fenced code blocks are examples, not blocks.
 * This is not a Markdown parser: it knows lines, fences and these markers.
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
// Works from src/managed/ and dist/managed/ alike.
const MANAGED_TEMPLATES = resolve(__dirname, '..', '..', 'templates', 'default-instance', 'managed');
export const BLOCK_IDS = ['bootstrap', 'agent', 'routing-idea', 'index-idea'];
/** `{{MANAGED_<ID>}}` placeholder name used by the init templates. */
export function placeholderFor(id) {
    return `MANAGED_${id.toUpperCase().replace(/-/g, '_')}`;
}
export function bodyHash(body) {
    return createHash('sha256').update(normalize(body)).digest('hex').slice(0, 16);
}
function normalize(s) {
    return s.replace(/\r\n/g, '\n').replace(/\s+$/, '');
}
/** The body of a block for a given instance root. */
export function blockBody(id, monolithRoot) {
    const raw = readFileSync(join(MANAGED_TEMPLATES, `${id}.md`), 'utf8');
    return normalize(raw.replace(/\{\{MONOLITH_ROOT\}\}/g, monolithRoot));
}
/** The block as it is written to a file (markers + body), ending in a newline. */
export function renderBlock(id, body, eol = '\n') {
    const lines = [`<!-- monolith:begin ${id} sha256=${bodyHash(body)} -->`, ...normalize(body).split('\n'), `<!-- monolith:end ${id} -->`];
    return lines.join(eol) + eol;
}
const MARKER = /^<!-- monolith:(begin|end) ([a-z-]+)(?: sha256=([0-9a-f]{16}))? -->$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
function splitLines(text) {
    return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}
/**
 * Per line: is it a fence line or inside a fenced code block? Same rules as
 * CommonMark for the cases that matter here: a fence is 3+ backticks or tildes
 * (at most 3 spaces of indent), it closes on the same character with at least
 * the same length and nothing after it, and a block left open runs to the end
 * of the file. `open` tells whether the text ends inside such a block.
 */
function scanFences(lines) {
    const hidden = [];
    let fence = null;
    for (const l of lines) {
        const t = l.replace(/\r?\n$/, '');
        if (fence === null) {
            const o = FENCE_OPEN.exec(t);
            if (o && !(o[1][0] === '`' && o[2].includes('`'))) {
                fence = { ch: o[1][0], len: o[1].length };
                hidden.push(true);
            }
            else
                hidden.push(false);
        }
        else {
            const c = FENCE_CLOSE.exec(t);
            if (c && c[1][0] === fence.ch && c[1].length >= fence.len)
                fence = null;
            hidden.push(true);
        }
    }
    return { hidden, open: fence !== null };
}
function markers(lines) {
    const out = [];
    const { hidden } = scanFences(lines);
    lines.forEach((l, i) => {
        if (hidden[i])
            return;
        const t = l.replace(/\r?\n$/, '');
        const m = MARKER.exec(t.trim());
        if (m)
            out.push({ kind: m[1], id: m[2], hash: m[3], line: i });
    });
    return out;
}
/** Classify `id` in `text` against the template body `desired`. */
export function inspectBlock(text, id, desired) {
    const lines = splitLines(text);
    const all = markers(lines);
    const mine = all.filter((m) => m.id === id);
    if (mine.length === 0)
        return { state: 'absent' };
    const begins = mine.filter((m) => m.kind === 'begin');
    const ends = mine.filter((m) => m.kind === 'end');
    if (begins.length !== 1 || ends.length !== 1) {
        return { state: 'malformed', detail: `${begins.length} begin and ${ends.length} end marker(s) for "${id}"; exactly one of each is required` };
    }
    const [b] = begins;
    const [e] = ends;
    if (e.line < b.line)
        return { state: 'malformed', detail: `the "${id}" end marker precedes its begin marker` };
    if (all.some((m) => m !== b && m !== e && m.line > b.line && m.line < e.line)) {
        return { state: 'malformed', detail: `another managed marker sits inside the "${id}" block` };
    }
    if (b.hash === undefined)
        return { state: 'malformed', detail: `the "${id}" begin marker has no checksum` };
    const body = lines.slice(b.line + 1, e.line).join('');
    if (bodyHash(body) !== b.hash) {
        return { state: 'edited', detail: `the text inside the "${id}" block was edited after MONOLITH wrote it` };
    }
    return { state: 'pristine', current: normalize(body) === normalize(desired), from: b.line, to: e.line, lines };
}
function eolOf(text) {
    return text.includes('\r\n') ? '\r\n' : '\n';
}
/** `text` plus the block, appended; every existing byte stays in place. */
export function appendBlock(text, id, body) {
    const eol = eolOf(text);
    const sep = text.length === 0 ? '' : text.endsWith('\n') ? eol : eol + eol;
    return text + sep + renderBlock(id, body, eol);
}
/** `text` with only the lines of the block replaced. */
export function refreshBlock(text, state, id, body) {
    const eol = eolOf(text);
    const rendered = renderBlock(id, body, eol);
    // The end-marker line may be the unterminated last line of the file: keep it that way.
    const unterminated = !/\n$/.test(state.lines[state.to]);
    const block = unterminated ? rendered.slice(0, -eol.length) : rendered;
    return state.lines.slice(0, state.from).join('') + block + state.lines.slice(state.to + 1).join('');
}
/**
 * `text` with the block appended, or the reason that is not safe. Safe means the
 * result, read back by `inspectBlock`, shows exactly one well-formed, unedited
 * block that equals the template, and every original byte is still in place.
 * An unclosed code fence in `text` swallows the new markers (the next run would
 * not see the block and append another), so it is refused up front.
 */
export function planAppend(text, id, body) {
    if (scanFences(splitLines(text)).open) {
        return { ok: false, detail: 'the file ends inside an unclosed fenced code block (``` or ~~~), which would hide the new block' };
    }
    const content = appendBlock(text, id, body);
    if (!content.startsWith(text))
        return { ok: false, detail: 'the append would not keep the existing bytes in place' };
    return verified(content, id, body);
}
/** `text` with the block refreshed in place, or the reason that is not safe (see `planAppend`). */
export function planRefresh(text, state, id, body) {
    const content = refreshBlock(text, state, id, body);
    const head = state.lines.slice(0, state.from).join('');
    const tail = state.lines.slice(state.to + 1).join('');
    if (!content.startsWith(head) || !content.endsWith(tail))
        return { ok: false, detail: 'the refresh would change text outside the block' };
    return verified(content, id, body);
}
function verified(content, id, body) {
    const st = inspectBlock(content, id, body);
    if (st.state === 'pristine' && st.current)
        return { ok: true, content };
    return { ok: false, detail: `the written block would not be recognised as current (${st.state === 'pristine' ? 'stale' : st.state})` };
}
/** Text with fenced code blocks and HTML comments removed: what an assistant reads as instructions. */
export function prose(text) {
    const lines = splitLines(text);
    const { hidden } = scanFences(lines);
    return lines.filter((_, i) => !hidden[i]).join('').replace(/<!--[\s\S]*?-->/g, '');
}
