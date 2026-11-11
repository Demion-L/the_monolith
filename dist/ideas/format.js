/**
 * Idea file format: Markdown with a small frontmatter block.
 *
 *   ---
 *   type: idea
 *   id: "IDEA-001"
 *   title: "..."            (JSON string: any character survives a round trip)
 *   status: inbox
 *   createdAt: "2026-..."
 *   context: "..."          (optional)
 *   tags: ["a", "b"]        (optional)
 *   paths: ["docs/x.md"]  (optional, KA-001: exact document files of the registered artifact; see attributionPathProblem)
 *   ---
 *
 *   ## Description
 *
 *   <description, verbatim>
 *
 * Strings are written as JSON strings, which are also valid YAML double-quoted
 * scalars, so ERG/Scriptorium read the file too. The reader additionally accepts
 * a plain unquoted value, because a person edits these files by hand.
 * The description is the body: no escaping, no trimming.
 */
import { IDEA_LIMITS, IDEA_STATUSES, IdeaError } from './types.js';
const BODY_HEADING = '\n## Description\n\n';
const ID_RE = /^IDEA-(\d{3,9})$/;
const FILE_RE = /^(IDEA-\d{3,9})\.md$/;
// C0 controls, DEL and C1 controls (a title is shown in a terminal).
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
/**
 * KA-001: a registered artifact path. Project-relative, `/`-separated, no
 * traversal, no globs; a trailing `/` makes it a directory prefix. Returns the
 * reason it is invalid, or null.
 */
export function invalidArtifactPath(p) {
    if (typeof p !== 'string' || p === '')
        return 'path must be a non-empty string';
    if (p.length > IDEA_LIMITS.pathLength)
        return `path is too long (> ${IDEA_LIMITS.pathLength} characters)`;
    if (CONTROL_RE.test(p))
        return 'path must not contain control characters';
    if (p.includes('"'))
        return 'path must not contain a double quote';
    if (p.includes('\\'))
        return 'path must use "/" separators';
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p))
        return 'path must be project-relative';
    if (/[*?[\]{}]/.test(p))
        return 'path must not contain glob characters';
    if (p !== p.trim())
        return 'path must not start or end with whitespace';
    const segments = p.endsWith('/') ? p.slice(0, -1).split('/') : p.split('/');
    if (segments.some((x) => x === '' || x === '.' || x === '..'))
        return 'path must not contain empty, "." or ".." segments';
    return null;
}
/** True when `file` is covered by one of the registered `paths` (exact file, or `dir/` prefix). */
export function artifactPathsCover(paths, file) {
    return paths.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));
}
/**
 * Extensions of documents that can be registered as independent knowledge.
 * Deliberately an allow-list of *document* formats, not of directories: a
 * strategy paper may live anywhere, but source code, configuration and
 * scripts never qualify, whatever directory they are in.
 */
export const KNOWLEDGE_DOCUMENT_EXTENSIONS = ['.md', '.mdx', '.markdown', '.adoc'];
/** Directories whose documents steer tools, agents or dependencies; never knowledge (compared lower-case). */
const KNOWLEDGE_DENIED_DIRS = ['.git', '.claude', '.cursor', '.github', '.vscode', '.husky', 'node_modules'];
/** Agent-instruction file names (compared lower-case): changing them changes agent behaviour. */
const KNOWLEDGE_DENIED_NAMES = ['agents.md', 'agent.md', 'claude.md', 'gemini.md', 'skill.md', 'conventions.md', 'codeowners.md', 'copilot-instructions.md', '.cursorrules', '.windsurfrules.md'];
/**
 * A4-SEC-03: the policy for a path that is to ATTRIBUTE commits to independent
 * knowledge (stricter than `invalidArtifactPath`, which only says the path is
 * well-formed). A registered path must be
 *  - one exact file: a `dir/` prefix would turn every later change under it into
 *    "knowledge" (`src/`, the project root, ...);
 *  - a document (`KNOWLEDGE_DOCUMENT_EXTENSIONS`): registering `src/pay.ts` would
 *    let an idea id launder ordinary code;
 *  - outside the MONOLITH root (case-insensitive; `.monolith` is always refused
 *    too): governance state is never independent knowledge.
 * Returns the reason a path is refused, or null. Registration says WHICH file a
 * commit may be explained by; it does not say the change was reviewed or allowed.
 */
export function attributionPathProblem(p, monolithRoot) {
    const syntax = invalidArtifactPath(p);
    if (syntax !== null)
        return syntax;
    if (p.endsWith('/'))
        return 'a directory prefix is not allowed; register the exact document file';
    const lower = p.toLowerCase();
    for (const root of new Set(['.monolith', (monolithRoot ?? '.monolith').replace(/^(\.\/)+/, '').replace(/\/+$/, '').toLowerCase()])) {
        if (root !== '' && root !== '.' && (lower === root || lower.startsWith(`${root}/`)))
            return `a path inside the MONOLITH root (${root}) is never independent knowledge`;
    }
    if (/[\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff\u00a0]/.test(p))
        return 'path must not contain invisible or look-alike whitespace characters';
    const segs = lower.split('/');
    const hiddenDir = segs.slice(0, -1).find((x) => x.startsWith('.') || KNOWLEDGE_DENIED_DIRS.includes(x));
    if (hiddenDir !== undefined)
        return `a path under ${hiddenDir}/ (hidden or tool/dependency directory) configures tools or dependencies and is never independent knowledge`;
    if (KNOWLEDGE_DENIED_NAMES.includes(segs[segs.length - 1]))
        return 'agent-instruction files cannot be registered as independent knowledge';
    if (!KNOWLEDGE_DOCUMENT_EXTENSIONS.some((e) => lower.endsWith(e))) {
        return `only document files (${KNOWLEDGE_DOCUMENT_EXTENSIONS.join(', ')}) can be registered, not source code or configuration`;
    }
    return null;
}
export function isIdeaId(value) {
    return ID_RE.test(value);
}
export function ideaNumber(id) {
    const m = ID_RE.exec(id);
    if (!m)
        throw new IdeaError('IDEA_INVALID_ID', `"${id}" is not an idea id (expected IDEA-NNN).`);
    return Number(m[1]);
}
export function formatIdeaId(n) {
    return `IDEA-${String(n).padStart(3, '0')}`;
}
/** `IDEA-007.md` -> `IDEA-007`; anything else (temp files, other documents) -> null. */
export function ideaIdFromFileName(name) {
    const m = FILE_RE.exec(name);
    return m ? m[1] : null;
}
export function ideaFileName(id) {
    ideaNumber(id);
    return `${id}.md`;
}
function invalid(message) {
    return new IdeaError('IDEA_INVALID_INPUT', message);
}
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** An unpaired surrogate would be rewritten to U+FFFD by UTF-8 encoding: not lossless. */
function wellFormed(s) {
    return !LONE_SURROGATE_RE.test(s);
}
/** Validates user input; returns it unchanged (content is never trimmed or rewritten). */
export function validateNewIdea(input, monolithRoot) {
    const { title, description, context } = input;
    if (typeof title !== 'string' || title.trim() === '')
        throw invalid('title must not be empty.');
    if (typeof description !== 'string' || description.trim() === '')
        throw invalid('description must not be empty.');
    if (CONTROL_RE.test(title))
        throw invalid('title must be a single line without control characters.');
    if (title.length > IDEA_LIMITS.title)
        throw invalid(`title is too long (${title.length} > ${IDEA_LIMITS.title} characters).`);
    if (description.length > IDEA_LIMITS.description) {
        throw invalid(`description is too long (${description.length} > ${IDEA_LIMITS.description} characters).`);
    }
    if (context !== undefined) {
        if (typeof context !== 'string' || context.trim() === '')
            throw invalid('context, when given, must not be empty.');
        if (context.length > IDEA_LIMITS.context) {
            throw invalid(`context is too long (${context.length} > ${IDEA_LIMITS.context} characters).`);
        }
    }
    if (input.paths !== undefined) {
        if (!Array.isArray(input.paths) || input.paths.length === 0)
            throw invalid('paths, when given, must be a non-empty list.');
        if (input.paths.length > IDEA_LIMITS.paths)
            throw invalid(`too many paths (${input.paths.length} > ${IDEA_LIMITS.paths}).`);
        for (const p of input.paths) {
            const bad = attributionPathProblem(p, monolithRoot);
            if (bad !== null)
                throw invalid(`paths: ${bad} (${JSON.stringify(String(p).slice(0, 80))}).`);
        }
        if (new Set(input.paths).size !== input.paths.length)
            throw invalid('paths must not repeat.');
    }
    for (const [name, v] of [['title', title], ['description', description], ['context', context]]) {
        if (v !== undefined && !wellFormed(v))
            throw invalid(`${name} contains an unpaired surrogate and cannot be stored losslessly.`);
    }
    return input;
}
export function serializeIdea(idea) {
    const lines = [
        '---',
        'type: idea',
        `id: ${JSON.stringify(idea.id)}`,
        `title: ${JSON.stringify(idea.title)}`,
        `status: ${idea.status}`,
        `createdAt: ${JSON.stringify(idea.createdAt)}`,
    ];
    if (idea.context !== undefined)
        lines.push(`context: ${JSON.stringify(idea.context)}`);
    if (idea.tags !== undefined && idea.tags.length > 0)
        lines.push(`tags: ${JSON.stringify(idea.tags)}`);
    if (idea.paths !== undefined && idea.paths.length > 0)
        lines.push(`paths: ${JSON.stringify(idea.paths)}`);
    lines.push('---');
    return `${lines.join('\n')}\n${BODY_HEADING}${idea.description}\n`;
}
function corrupt(id, reason) {
    return new IdeaError('IDEA_CORRUPT', `${id}: ${reason}`);
}
function scalar(raw) {
    const v = raw.trim();
    if (v.startsWith('"')) {
        let parsed;
        try {
            parsed = JSON.parse(v);
        }
        catch {
            throw new Error('malformed quoted string');
        }
        if (typeof parsed !== 'string')
            throw new Error('malformed quoted string');
        return parsed;
    }
    return v;
}
/**
 * Parse an idea file. `expectedId` is the id implied by the file name; a
 * mismatch with the `id:` field is corruption, never silently "fixed".
 */
export function parseIdea(expectedId, text) {
    const normalized = text.startsWith('﻿') ? text.slice(1) : text;
    if (!normalized.startsWith('---\n'))
        throw corrupt(expectedId, 'missing frontmatter.');
    const end = normalized.indexOf('\n---\n', 3);
    if (end === -1)
        throw corrupt(expectedId, 'frontmatter is not terminated.');
    const fm = Object.create(null);
    for (const line of normalized.slice(4, end).split('\n')) {
        if (line.trim() === '')
            continue;
        const colon = line.indexOf(':');
        if (colon <= 0)
            throw corrupt(expectedId, `unreadable frontmatter line ${JSON.stringify(line.slice(0, 60))}.`);
        const key = line.slice(0, colon).trim();
        if (key in fm)
            throw corrupt(expectedId, `duplicate frontmatter key "${key}".`);
        fm[key] = line.slice(colon + 1);
    }
    const field = (key) => {
        if (!(key in fm))
            throw corrupt(expectedId, `missing "${key}".`);
        try {
            return scalar(fm[key]);
        }
        catch (err) {
            throw corrupt(expectedId, `"${key}": ${err.message}.`);
        }
    };
    if ('type' in fm && field('type') !== 'idea')
        throw corrupt(expectedId, `type is "${field('type')}", expected "idea".`);
    const id = field('id');
    if (id !== expectedId)
        throw corrupt(expectedId, `file name says ${expectedId} but the id field says ${JSON.stringify(id)}.`);
    const title = field('title');
    if (title.trim() === '')
        throw corrupt(expectedId, 'title is empty.');
    const status = field('status');
    if (!IDEA_STATUSES.includes(status)) {
        throw corrupt(expectedId, `unknown status ${JSON.stringify(status)} (expected ${IDEA_STATUSES.join(' | ')}).`);
    }
    const createdAt = field('createdAt');
    if (Number.isNaN(Date.parse(createdAt)))
        throw corrupt(expectedId, `createdAt ${JSON.stringify(createdAt)} is not a date.`);
    const body = normalized.slice(end + 5); // right after the closing "---\n"
    if (!body.startsWith(BODY_HEADING))
        throw corrupt(expectedId, 'missing "## Description" section.');
    let description = body.slice(BODY_HEADING.length);
    if (description.endsWith('\n'))
        description = description.slice(0, -1);
    if (description.trim() === '')
        throw corrupt(expectedId, 'description is empty.');
    const idea = { id, title, description, createdAt, status: status };
    if ('context' in fm)
        idea.context = field('context');
    if ('tags' in fm) {
        let tags;
        try {
            tags = JSON.parse(fm.tags);
        }
        catch {
            throw corrupt(expectedId, '"tags" is not a JSON array of strings.');
        }
        if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) {
            throw corrupt(expectedId, '"tags" is not a JSON array of strings.');
        }
        idea.tags = tags;
    }
    if ('paths' in fm) {
        let paths;
        try {
            paths = JSON.parse(fm.paths);
        }
        catch {
            throw corrupt(expectedId, '"paths" is not a JSON array of strings.');
        }
        if (!Array.isArray(paths) || paths.length > IDEA_LIMITS.paths || !paths.every((x) => invalidArtifactPath(x) === null)) {
            throw corrupt(expectedId, '"paths" is not a JSON array of valid project-relative paths.');
        }
        idea.paths = paths;
    }
    return idea;
}
