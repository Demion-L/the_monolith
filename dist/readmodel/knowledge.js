/**
 * Hypotheses and ADRs for Mission Control (UI-004B).
 *
 * Core reads and interprets; the UI only presents. Strictly read-only: every file
 * goes through `readProjectFile` (ADR-014: no symlink in any component, one hard
 * link, regular file, bounded, strict UTF-8). Nothing is written, executed or fetched.
 *
 * The set of sources is closed:
 *  - `<monolithRoot>/memory/long-term/hypotheses.md`
 *  - `docs/adr/ADR-*.md` (the directory is listed, never walked recursively;
 *    `docs/adr/README.md` is an index that restates the frontmatter and is NOT a source:
 *    the frontmatter is authoritative, a second reading would create a second truth).
 *
 * Interpretation rules (never guess):
 *  - Hypothesis = a level-2 heading `## Title {#HYP-NNN}`; headings, status lines and text
 *    inside code fences or HTML comments are invisible (`maskNonContent`).
 *  - ADR = frontmatter `id`, `title`, `status`, `supersedes`, `superseded_by`, as declared.
 *    Links are never derived or cross-checked against other ADRs.
 *  - Duplicate ids are ambiguous: none of the duplicates is shown, an issue is reported.
 *  - A status is verbatim; the UI decides how to present an unknown one.
 *  - Failures are DATA (fixed codes + project-relative paths), never exception text.
 */
import { lstatSync, readdirSync } from 'fs';
import { join } from 'path';
import { maskNonContent } from '../brief/markdown-context.js';
import { readProjectFile } from '../root/index.js';
import { parseFrontmatter } from '../scriptorium/frontmatter.js';
import { sourceFailure } from './source-failure.js';
export const HYPOTHESES_REL = 'memory/long-term/hypotheses.md';
export const ADR_DIR_REL = 'docs/adr';
export const MAX_HYPOTHESES_BYTES = 256 * 1024;
export const MAX_ADR_BYTES = 256 * 1024;
export const MAX_KNOWLEDGE_ITEMS = 200;
export const MAX_SUMMARY_CHARS = 600;
const MAX_TITLE_CHARS = 300;
const MAX_STATUS_CHARS = 80;
const MAX_ISSUES = 100;
const HYP_HEADING_RE = /^##[ \t]+(.*?)[ \t]*\{#(HYP-\d{3,})\}[ \t]*$/;
const STATUS_RE = /^\*\*Status:\*\*[ \t]*(.*?)\s*$/;
const LABEL_RE = /^\*\*[^*]{1,40}:\*\*[ \t]*/;
const ADR_ID_RE = /^ADR-\d{3,}$/;
const ADR_FILE_RE = /^ADR-.*\.md$/;
const ADR_FILE_ID_RE = /^(ADR-\d{3,})(?:-|\.md$)/;
const SAFE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
function cap(s, max) {
    return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
function norm(text) {
    return text.replace(/\r\n?/g, '\n');
}
export class Issues {
    list = [];
    dropped = false;
    add(code, severity, path, id = null, reason = null) {
        if (this.list.length >= MAX_ISSUES) {
            this.dropped = true;
            return;
        }
        this.list.push({ code, severity, path, id: id !== null && SAFE_ID_RE.test(id) ? id : null, reason });
    }
    /** Issues beyond the cap are not listed, so the result can no longer claim completeness. */
    finish() {
        if (this.dropped)
            this.list.push({ code: 'ITEMS_TRUNCATED', severity: 'warn', path: null, id: null, reason: null });
        return this.list;
    }
}
function dataOf(items, issues) {
    const list = issues.finish();
    return { items, issues: list, complete: !list.some((i) => i.severity === 'warn') };
}
/** Plain-text excerpt: leading `**Label:**` removed, whitespace collapsed, bounded. */
function excerpt(lines) {
    let i = 0;
    while (i < lines.length) {
        while (i < lines.length && lines[i].trim() === '')
            i++;
        const para = [];
        while (i < lines.length && lines[i].trim() !== '')
            para.push(lines[i++].trim());
        if (para.length === 0)
            return null;
        const text = para.join(' ').replace(LABEL_RE, '').replace(/^[-*]\s+/, '').replace(/\s+/g, ' ').trim();
        if (text !== '')
            return cap(text, MAX_SUMMARY_CHARS);
        // A label-only paragraph: the text continues in the next one.
    }
    return null;
}
export function parseHypotheses(text, path) {
    const issues = new Issues();
    if (text.trim() === '') {
        issues.add('DOCUMENT_EMPTY', 'info', path);
        return dataOf([], issues);
    }
    const lines = maskNonContent(norm(text)).split('\n');
    const drafts = [];
    let open = null;
    for (let n = 0; n < lines.length; n++) {
        const line = lines[n];
        if (/^#{1,2}[ \t]/.test(line)) {
            if (open)
                open.end = n;
            open = null;
            const m = HYP_HEADING_RE.exec(line);
            if (m) {
                open = { id: m[2], title: m[1].trim() === '' ? null : cap(m[1].trim(), MAX_TITLE_CHARS), start: n + 1, end: lines.length };
                drafts.push(open);
            }
            else if (/^##[ \t]/.test(line) && /\{#HYP/i.test(line)) {
                issues.add('HYP_HEADING_MALFORMED', 'warn', path);
            }
        }
    }
    const counts = new Map();
    for (const d of drafts)
        counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
    const duplicated = new Set([...counts].filter(([, c]) => c > 1).map(([id]) => id));
    for (const id of duplicated)
        issues.add('HYP_ID_DUPLICATE', 'warn', path, id);
    const items = [];
    for (const d of drafts) {
        if (duplicated.has(d.id))
            continue;
        if (items.length >= MAX_KNOWLEDGE_ITEMS) {
            issues.add('ITEMS_TRUNCATED', 'warn', path);
            break;
        }
        const body = lines.slice(d.start, d.end);
        const statuses = [];
        const rest = [];
        let sawStatusLine = false;
        for (const l of body) {
            const m = STATUS_RE.exec(l.trim());
            if (m) {
                sawStatusLine = true;
                const v = m[1].replace(/^`+|`+$/g, '').replace(/\s+/g, ' ').trim();
                if (v !== '')
                    statuses.push(cap(v, MAX_STATUS_CHARS));
                rest.push('');
            }
            else
                rest.push(l);
        }
        let status = null;
        if (new Set(statuses).size > 1)
            issues.add('HYP_STATUS_CONFLICT', 'warn', path, d.id);
        else if (statuses.length > 0)
            status = statuses[0];
        else
            issues.add(sawStatusLine ? 'HYP_STATUS_EMPTY' : 'HYP_STATUS_MISSING', 'info', path, d.id);
        items.push({ id: d.id, title: d.title, status, summary: excerpt(rest), path });
    }
    return dataOf(items, issues);
}
function fieldValues(fm, key) {
    return fm.fields.filter((f) => f.key === key).map((f) => f.values);
}
function links(fm, key, path, issues) {
    const occ = fieldValues(fm, key);
    if (occ.length === 0)
        return undefined;
    if (occ.length > 1) {
        issues.add('ADR_FIELD_DUPLICATE', 'warn', path);
        return undefined;
    }
    const ok = [];
    for (const v of occ[0]) {
        if (ADR_ID_RE.test(v)) {
            if (!ok.includes(v))
                ok.push(v);
        }
        else
            issues.add('ADR_LINK_INVALID', 'warn', path);
    }
    return ok.length > 0 ? ok : undefined;
}
/** One ADR file. `null` item = not shown (an issue says why). */
export function parseAdr(text, fileName, path, issues = new Issues()) {
    const fileId = ADR_FILE_ID_RE.exec(fileName)?.[1] ?? null;
    const lines = norm(text).split('\n');
    const fm = parseFrontmatter(lines);
    if (fm === null) {
        // A file that is not shown is a real loss of data: both cases make the list incomplete (warn).
        issues.add(lines[0]?.trim() === '---' ? 'ADR_FRONTMATTER_MALFORMED' : 'ADR_FRONTMATTER_MISSING', 'warn', path);
        return { item: null, issues };
    }
    const single = (key) => {
        const occ = fieldValues(fm, key);
        if (occ.length > 1) {
            issues.add('ADR_FIELD_DUPLICATE', 'warn', path);
            return null;
        }
        return occ.length === 1 ? occ[0][0] : null;
    };
    const id = single('id');
    if (id === null) {
        issues.add('ADR_ID_MISSING', 'warn', path);
        return { item: null, issues };
    }
    if (!SAFE_ID_RE.test(id)) {
        issues.add('ADR_ID_INVALID', 'warn', path);
        return { item: null, issues };
    }
    // The declared id is shown as declared; a disagreement with the file name is reported, never corrected.
    if (fileId !== null && id !== fileId)
        issues.add('ADR_ID_MISMATCH', 'warn', path, id);
    let title = single('title');
    if (title === null) {
        const body = maskNonContent(lines.slice(fm.bodyStartLine).join('\n')).split('\n');
        title = body.map((l) => /^#[ \t]+(.+?)\s*$/.exec(l)?.[1] ?? null).find((t) => t !== null) ?? null;
    }
    const status = single('status');
    if (status === null)
        issues.add('ADR_STATUS_MISSING', 'info', path, id);
    const item = {
        id,
        title: title === null ? null : cap(title, MAX_TITLE_CHARS),
        status: status === null ? null : cap(status, MAX_STATUS_CHARS),
        summary: null,
        path,
    };
    const supersedes = links(fm, 'supersedes', path, issues);
    const supersededBy = links(fm, 'superseded_by', path, issues);
    if (supersedes)
        item.supersedes = supersedes;
    if (supersededBy)
        item.supersededBy = supersededBy;
    return { item, issues };
}
function report(id, path, status, code) {
    return { id, path, status, code };
}
function readText(projectRoot, rel, maxBytes) {
    try {
        let read = readProjectFile(projectRoot, rel, { maxBytes, allowEmpty: true, strictUtf8: true });
        for (let i = 1; i < 3 && !read.ok && read.code === 'FILE_CHANGED'; i++) {
            read = readProjectFile(projectRoot, rel, { maxBytes, allowEmpty: true, strictUtf8: true });
        }
        if (read.ok)
            return { ok: true, content: read.content };
        const [status, code] = sourceFailure(read.code);
        return { ok: false, status, code };
    }
    catch {
        return { ok: false, status: 'unreadable', code: 'INTERNAL' };
    }
}
export function readHypotheses(projectRoot, monolithRoot) {
    const rel = `${monolithRoot}/${HYPOTHESES_REL}`;
    const read = readText(projectRoot, rel, MAX_HYPOTHESES_BYTES);
    if (!read.ok)
        return { data: null, sources: [report('hypotheses', rel, read.status, read.code)] };
    try {
        return { data: parseHypotheses(read.content, rel), sources: [report('hypotheses', rel, 'available', null)] };
    }
    catch {
        // A parser fault is an error, never an empty list.
        return { data: null, sources: [report('hypotheses', rel, 'corrupt', 'INTERNAL')] };
    }
}
/** Lists `docs/adr` without following any symlink; returns file names, or a source failure. */
function listAdrDir(projectRoot) {
    try {
        let cur = projectRoot;
        for (const seg of ADR_DIR_REL.split('/')) {
            cur = join(cur, seg);
            let st;
            try {
                st = lstatSync(cur);
            }
            catch (err) {
                if (err.code === 'ENOENT')
                    return { ok: false, status: 'absent', code: 'SOURCE_ABSENT' };
                return { ok: false, status: 'unreadable', code: 'SOURCE_UNREADABLE' };
            }
            if (st.isSymbolicLink())
                return { ok: false, status: 'forbidden', code: 'SOURCE_SYMLINK' };
            if (!st.isDirectory())
                return { ok: false, status: 'forbidden', code: 'SOURCE_NOT_REGULAR' };
        }
        const names = readdirSync(cur, { withFileTypes: true })
            .filter((e) => !e.isDirectory() && ADR_FILE_RE.test(e.name))
            .map((e) => e.name)
            .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        return { ok: true, names };
    }
    catch {
        return { ok: false, status: 'unreadable', code: 'SOURCE_UNREADABLE' };
    }
}
export function readDecisions(projectRoot) {
    const listing = listAdrDir(projectRoot);
    if (!listing.ok)
        return { data: null, sources: [report('decisions', ADR_DIR_REL, listing.status, listing.code)] };
    try {
        const issues = new Issues();
        const parsed = [];
        let names = listing.names;
        if (names.length > MAX_KNOWLEDGE_ITEMS) {
            issues.add('ITEMS_TRUNCATED', 'warn', ADR_DIR_REL);
            names = names.slice(0, MAX_KNOWLEDGE_ITEMS);
        }
        for (const name of names) {
            const path = `${ADR_DIR_REL}/${name}`;
            if (ADR_FILE_ID_RE.exec(name) === null) {
                issues.add('ADR_FILENAME_UNRECOGNIZED', 'warn', path);
                continue;
            }
            const read = readText(projectRoot, path, MAX_ADR_BYTES);
            if (!read.ok) {
                issues.add('ADR_FILE_UNREADABLE', 'warn', path, null, read.code);
                continue;
            }
            const { item } = parseAdr(read.content, name, path, issues);
            if (item !== null)
                parsed.push(item);
        }
        // Two documents declaring the same id are ambiguous: neither is shown as "the" ADR.
        const counts = new Map();
        for (const it of parsed)
            counts.set(it.id, (counts.get(it.id) ?? 0) + 1);
        const items = [];
        const reported = new Set();
        for (const it of parsed) {
            if ((counts.get(it.id) ?? 0) > 1) {
                if (!reported.has(it.id)) {
                    reported.add(it.id);
                    issues.add('ADR_ID_DUPLICATE', 'warn', null, it.id);
                }
                continue;
            }
            items.push(it);
        }
        items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return { data: dataOf(items, issues), sources: [report('decisions', ADR_DIR_REL, 'available', null)] };
    }
    catch {
        return { data: null, sources: [report('decisions', ADR_DIR_REL, 'corrupt', 'INTERNAL')] };
    }
}
export function readKnowledge(projectRoot, monolithRoot) {
    return { hypotheses: readHypotheses(projectRoot, monolithRoot), decisions: readDecisions(projectRoot) };
}
