/**
 * Independent knowledge attribution (KA-001).
 *
 * A project may keep knowledge that belongs to no work item — a strategy
 * paper, a vision note — without that being "unattributed activity" and
 * without pretending it is part of the active story. The registration is an
 * idea of the Idea Store (`IDEA-NNN`) that declares the artifact's `paths`.
 *
 * A commit is attributed to independent knowledge only when ALL hold:
 *   1. its subject names no work item (a work item keeps its own semantics);
 *   2. it names at least one `IDEA-NNN` that is a valid idea file **in the
 *      tree of that very commit** (so registering an idea later never
 *      legalises older commits, and a commit that registers or edits the idea
 *      is itself never attributed — its own files are not covered);
 *   3. the ideas it names declare `paths`, and EVERY file the commit changed
 *      (other than state documents) is covered by those paths;
 *   4. no changed file lies inside the MONOLITH root.
 * Anything else stays exactly what it was: unattributed activity. Nothing here
 * activates a story, touches the roadmap or marks anything done; it only
 * decides whether a commit is *explained*. No LLM, no network, read-only git.
 */
import { artifactPathsCover, isIdeaId, parseIdea } from '../ideas/format.js';
export const EMPTY_KNOWLEDGE = { attributed: new Map(), rejected: new Map() };
/** Upper bound of commits examined; beyond it the rest simply stay unattributed. */
export const MAX_KNOWLEDGE_COMMITS = 200;
const IDEA_REF_RE = /(?<![A-Za-z0-9-])IDEA-\d{3,9}(?![A-Za-z0-9]|\.\d|-[A-Z0-9])/g;
export function ideaIdsInSubject(subject) {
    return [...new Set(subject.match(IDEA_REF_RE) ?? [])].filter(isIdeaId);
}
export function attributeKnowledge(git, opts) {
    if (git.status !== 'ok')
        return EMPTY_KNOWLEDGE;
    const attributed = new Map();
    const rejected = new Map();
    const root = opts.monolithRoot.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    const rootPrefix = root === '' || root === '.' ? '' : `${root}/`;
    let examined = 0;
    for (const c of git.commitsSince) {
        const files = c.files.filter((f) => !opts.stateFiles.has(f));
        if (files.length === 0)
            continue; // not activity
        if (opts.hasWorkItem(c.subject))
            continue; // work items keep their own semantics
        const named = ideaIdsInSubject(c.subject);
        if (named.length === 0)
            continue;
        if (++examined > MAX_KNOWLEDGE_COMMITS)
            break;
        const verdict = judge(c, files, named, rootPrefix, root, opts.readBlob);
        if ('ideaIds' in verdict)
            attributed.set(c.sha, verdict);
        else
            rejected.set(c.sha, verdict);
    }
    return { attributed, rejected };
}
function judge(c, files, named, rootPrefix, monolithRoot, readBlob) {
    const unjudgeable = files.find((f) => f.startsWith('"') || /^\.?\.?\//.test(f));
    if (unjudgeable !== undefined)
        return { reason: `a changed path (${unjudgeable.slice(0, 40)}) is quoted by git or not project-relative and cannot be judged` };
    const inRoot = (rootPrefix === '' ? files[0] : files.find((f) => f.toLowerCase().startsWith(rootPrefix.toLowerCase())));
    if (inRoot !== undefined)
        return { reason: `it changes ${inRoot}, inside the MONOLITH root; knowledge attribution never covers that` };
    const valid = [];
    const paths = [];
    const problems = [];
    for (const id of named) {
        const text = readBlob(c.sha, `${monolithRoot}/memory/long-term/ideas/${id}.md`);
        if (text === null) {
            problems.push(`${id} is not a registered idea in this commit`);
            continue;
        }
        try {
            const idea = parseIdea(id, text);
            if (idea.paths === undefined || idea.paths.length === 0)
                problems.push(`${id} declares no paths`);
            else {
                valid.push(id);
                paths.push(...idea.paths);
            }
        }
        catch {
            problems.push(`${id} is not a readable idea in this commit`);
        }
    }
    // Strict: every idea the subject names must be valid; a bad id is never silently ignored.
    if (problems.length > 0)
        return { reason: problems.join('; ') };
    const outside = files.filter((f) => !artifactPathsCover(paths, f));
    if (outside.length > 0) {
        const shown = outside.slice(0, 3).join(', ');
        return { reason: `${shown}${outside.length > 3 ? ` and ${outside.length - 3} more` : ''} not covered by the declared paths of ${valid.join(', ')}` };
    }
    return { ideaIds: valid };
}
