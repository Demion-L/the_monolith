/**
 * Generic, deterministic markdown-frontmatter discovery used for both
 * Mandatory Protocols (section 7) and ADR Discovery (section 8). Reuses
 * Scriptorium's existing frontmatter parser (per the brief contract) — does
 * NOT use `compileMarkdownArtifact()` or the ERG graph builder, both of
 * which are explicitly out of scope here.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { parseFrontmatter } from '../scriptorium/frontmatter.js';
import { compareStrings } from './selectors.js';
const H1_RE = /^#\s+(.+?)\s*$/;
/** All `.md` files under `dir`, sorted deterministically (not FS traversal order). */
function walkMarkdownFilesSorted(dir) {
    const results = [];
    if (!existsSync(dir))
        return results;
    function walk(d) {
        const entries = readdirSync(d).sort(compareStrings);
        for (const entry of entries) {
            const full = join(d, entry);
            const st = statSync(full);
            if (st.isDirectory()) {
                walk(full);
            }
            else if (entry.endsWith('.md')) {
                results.push(full);
            }
        }
    }
    walk(dir);
    return results.sort(compareStrings);
}
function firstH1(bodyLines) {
    for (const line of bodyLines) {
        const match = H1_RE.exec(line.trim());
        if (match)
            return match[1];
    }
    return undefined;
}
function parseDoc(absPath, targetDir) {
    let content;
    try {
        content = readFileSync(absPath, 'utf8');
    }
    catch {
        return null;
    }
    const lines = content.split('\n');
    const fm = parseFrontmatter(lines);
    if (!fm)
        return null;
    const fields = new Map();
    let frontmatterTitle;
    let id;
    for (const field of fm.fields) {
        if (field.values[0] !== undefined)
            fields.set(field.key, field.values[0]);
        if (field.key === 'title' && field.values[0])
            frontmatterTitle = field.values[0];
        if (field.key === 'id' && field.values[0])
            id = field.values[0];
    }
    return {
        relPath: relative(targetDir, absPath).split('\\').join('/'),
        id,
        frontmatterTitle,
        fields,
    };
}
function resolveTitle(doc, absPath) {
    if (doc.frontmatterTitle)
        return doc.frontmatterTitle;
    try {
        const content = readFileSync(absPath, 'utf8');
        const lines = content.split('\n');
        const fm = parseFrontmatter(lines);
        const bodyLines = lines.slice(fm?.bodyStartLine ?? 0);
        const h1 = firstH1(bodyLines);
        if (h1)
            return h1;
    }
    catch {
        // fall through
    }
    return doc.id ?? doc.relPath;
}
/**
 * Discover documents under `dirs` (relative to targetDir, deduplicated,
 * each walked recursively) whose frontmatter matches `predicate`. Only
 * documents with a usable frontmatter `id:` are included — a markdown file
 * without one isn't a candidate ADR/protocol record, it's silently excluded
 * from this listing (not an error).
 */
export function discoverDocs(targetDir, dirs, predicate) {
    const seenAbsDirs = new Set();
    const refs = [];
    for (const relDir of dirs) {
        const absDir = join(targetDir, relDir);
        if (seenAbsDirs.has(absDir))
            continue;
        seenAbsDirs.add(absDir);
        for (const absPath of walkMarkdownFilesSorted(absDir)) {
            const doc = parseDoc(absPath, targetDir);
            if (!doc || !doc.id)
                continue;
            if (!predicate(doc.fields))
                continue;
            refs.push({ id: doc.id, title: resolveTitle(doc, absPath), path: doc.relPath });
        }
    }
    return refs.sort((a, b) => compareStrings(a.id, b.id) || compareStrings(a.path, b.path));
}
