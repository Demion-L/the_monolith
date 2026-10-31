/**
 * `monolith update` (DX-UPDATE-001/003): bring an existing instance up to the
 * current agent integration (stable `AGENT.md` entry point, Idea Capture)
 * without touching project memory.
 *
 * Ownership model (no template version is stored in an instance, so state is
 * read from the files themselves):
 *  - MONOLITH-owned, created when absent: `<root>/AGENT.md`, the `idea-capture`
 *    skill. An existing skill is never overwritten, whatever it contains.
 *  - Mixed (user-owned file + MONOLITH text): CLAUDE.md / AGENTS.md /
 *    .cursorrules / .windsurfrules, routing-map, skills index. MONOLITH text
 *    lives only in checksummed managed blocks (src/managed). A missing block is
 *    appended; an unedited block is refreshed in place; an edited, malformed or
 *    competing one is a CONFLICT and nothing is written. Bytes outside a block
 *    are never changed (asserted before every write).
 *  - User memory (state.json, memory/, ideas): never touched.
 *
 * Reads use the bounded safe read; writes use the safe-write primitives
 * (project boundary, no symlinks, exclusive create / atomic replace). Update is
 * not transactional and not coordinated between processes (SEC-001B.3): apply
 * re-plans just before writing and refuses a change whose preconditions moved;
 * a re-run is the recovery. Nothing is executed and no user text is interpreted
 * as code.
 */
import { createHash } from 'crypto';
import { lstatSync, readFileSync } from 'fs';
import { dirname, join, basename, resolve } from 'path';
import { SafeWriteError, RootContainmentError, createFile, openParent, projectBoundary, readConfigFile, readProjectFile, replaceFile, resolveMonolithRoot, } from '../root/index.js';
import { TEMPLATES_ROOT, substitute } from '../init/scaffold.js';
import { listIdeas, ideaStore } from '../ideas/store.js';
import { blockBody, inspectBlock, planAppend, planRefresh, prose, renderBlock } from '../managed/index.js';
const INSTRUCTION_FILES = ['CLAUDE.md', '.cursorrules', '.windsurfrules'];
const AI_TOOL_FILE = { claude: 'CLAUDE.md', cursor: '.cursorrules', windsurf: '.windsurfrules' };
const sha = (s) => createHash('sha256').update(s).digest('hex');
function readTemplate(rel, vars) {
    return substitute(readFileSync(join(TEMPLATES_ROOT, rel), 'utf8'), vars);
}
/** `strict`: the text will be written back, so anything but valid UTF-8 is refused instead of being decoded lossily. */
function readInstanceFile(projectRoot, rel, strict = false) {
    const r = readProjectFile(projectRoot, rel, { allowEmpty: true, strictUtf8: strict });
    if (r.ok)
        return { kind: 'ok', content: r.content };
    if (r.code === 'FILE_MISSING')
        return { kind: 'missing' };
    return { kind: 'unsafe', detail: `${r.code}: ${r.detail}` };
}
function manualBlock(id, root) {
    return renderBlock(id, blockBody(id, root));
}
/** A managed block in a file: ADD / UPDATE / UNCHANGED / CONFLICT, never an overwrite. */
function blockItem(projectRoot, root, spec) {
    const { id, rel, what } = spec;
    const body = blockBody(id, root);
    const manual = manualBlock(id, root);
    const read = readInstanceFile(projectRoot, rel, true);
    if (read.kind === 'unsafe')
        return { path: rel, action: 'CONFLICT', reason: `cannot be read safely (${read.detail}); not inspected or changed` };
    if (read.kind === 'missing') {
        if (spec.whenMissing === 'create') {
            return { path: rel, action: 'ADD', reason: `new file with the managed ${what}`, content: renderBlock(id, body), effect: spec.effect };
        }
        return { path: rel, action: 'CONFLICT', reason: `missing; update does not recreate your file. Restore it, then re-run (or add ${what} by hand)`, proposal: manual };
    }
    const text = read.content;
    const st = inspectBlock(text, id, body);
    const conflict = (reason) => ({ path: rel, action: 'CONFLICT', reason, proposal: manual });
    switch (st.state) {
        case 'malformed':
            return conflict(`managed block "${id}" is malformed (${st.detail}); not changed. Fix or remove the markers, then re-run`);
        case 'edited':
            return conflict(`${st.detail}; your edit is kept and the block is not refreshed. Restore the block text, or delete the whole block (markers included) and re-run`);
        case 'pristine': {
            if (st.current)
                return { path: rel, action: 'UNCHANGED', reason: `${what} present and current` };
            const next = planRefresh(text, st, id, body);
            if (!next.ok)
                return conflict(`cannot refresh managed block "${id}" safely: ${next.detail}; not changed`);
            return { path: rel, action: 'UPDATE', reason: `refresh the unedited managed ${what} to the current text`, content: next.content, before: sha(text), effect: spec.effect };
        }
        case 'absent': {
            const visible = prose(text);
            if (spec.legacy && spec.legacy.every((re) => re.test(visible)))
                return { path: rel, action: 'UNCHANGED', reason: `${what} already present (unmanaged text)` };
            if (spec.clash && spec.clash.re.test(visible))
                return conflict(spec.clash.why);
            if (spec.whenMissing === 'create') {
                return conflict(`exists but is not managed by MONOLITH; update does not take over your file. Add the managed ${what} by hand or rename it`);
            }
            const next = planAppend(text, id, body);
            if (!next.ok)
                return conflict(`cannot add the managed ${what} safely: ${next.detail}; not changed. Close the fence (or add the block by hand) and re-run`);
            return { path: rel, action: 'UPDATE', reason: `append the managed ${what}; the ${Buffer.byteLength(text)} bytes already in the file stay as they are`, content: next.content, before: sha(text), effect: spec.effect };
        }
    }
}
/**
 * Read-only. Throws RootContainmentError when the root/config is unusable and
 * `Error` when the directory is not a MONOLITH instance.
 */
export function planUpdate(target) {
    const targetDir = resolve(target);
    const config = readConfigFile(targetDir);
    const root = resolveMonolithRoot(targetDir, config);
    const r = root.monolithRoot;
    let isDir = false;
    try {
        isDir = lstatSync(root.rootAbs).isDirectory();
    }
    catch {
        isDir = false;
    }
    if (!isDir) {
        throw new Error(`Not a MONOLITH instance: "${r}/" does not exist in ${root.projectRoot}. Run \`monolith init\` first; \`monolith update\` only updates an existing instance.`);
    }
    const vars = { MONOLITH_ROOT: r };
    const items = [];
    const pr = root.projectRoot;
    // 1. MONOLITH-owned files, created when absent.
    const skillRel = `${r}/skills/idea-capture/SKILL.md`;
    const skillTemplate = readTemplate('monolith/skills/idea-capture/SKILL.md', vars);
    const skill = readInstanceFile(pr, skillRel);
    const skillEffect = 'the idea-capture procedure';
    let skillText = null;
    if (skill.kind === 'unsafe') {
        items.push({ path: skillRel, action: 'CONFLICT', reason: `cannot be read safely (${skill.detail}); not inspected or changed` });
    }
    else if (skill.kind === 'missing') {
        items.push({ path: skillRel, action: 'ADD', reason: 'new file from the current template', content: skillTemplate, effect: skillEffect });
    }
    else if (skill.content === skillTemplate) {
        skillText = skill.content;
        items.push({ path: skillRel, action: 'UNCHANGED', reason: 'identical to the current template' });
    }
    else {
        skillText = skill.content;
        items.push({ path: skillRel, action: 'SKIP', reason: 'exists and differs from the current template (customized or older); not overwritten' });
    }
    items.push(blockItem(pr, r, {
        id: 'agent',
        rel: `${r}/AGENT.md`,
        what: 'agent entry point',
        effect: 'one stable place where an assistant finds the skills and the Idea Capture rules',
        whenMissing: 'create',
    }));
    // 2. Routing and skills index (documents the user may have extended).
    items.push(blockItem(pr, r, {
        id: 'index-idea',
        rel: `${r}/skills/INDEX.md`,
        what: 'idea-capture skills-index row',
        effect: 'the idea-capture trigger is listed in the skills index',
        legacy: [/^\|\s*idea-capture\s*\|[^\n]*idea-capture\/SKILL\.md/m],
        whenMissing: 'conflict',
    }), blockItem(pr, r, {
        id: 'routing-idea',
        rel: `${r}/context/maps/routing-map.md`,
        what: 'CAPTURE_IDEA route (Table 8)',
        effect: 'the CAPTURE_IDEA intent has a canonical destination',
        legacy: [/^\|\s*`CAPTURE_IDEA`\s*\|[^\n]*monolith idea add/m],
        clash: { re: /^##\s+Table 8\b/m, why: 'has its own "Table 8" without the CAPTURE_IDEA route; appending a second one would duplicate the heading. Add the CAPTURE_IDEA row to your Table 8 by hand' },
        whenMissing: 'conflict',
    }));
    // 3. Root instruction files: one managed pointer to AGENT.md, so a new skill never edits them again.
    const aiTool = config.status === 'ok' && typeof config.cfg.project === 'object' && config.cfg.project !== null
        ? config.cfg.project.aiTool
        : undefined;
    const known = typeof aiTool === 'string' ? AI_TOOL_FILE[aiTool] : undefined;
    const wanted = new Set(['AGENTS.md']);
    if (known)
        wanted.add(known);
    else
        for (const f of INSTRUCTION_FILES)
            if (readInstanceFile(pr, f).kind !== 'missing')
                wanted.add(f);
    if (wanted.size === 1 && !known)
        wanted.add(AI_TOOL_FILE.claude);
    const instruction = [...wanted].map((f) => blockItem(pr, r, {
        id: 'bootstrap',
        rel: f,
        what: 'agent entry-point pointer',
        effect: 'the assistant is told to read AGENT.md at session start',
        whenMissing: 'conflict',
    }));
    items.push(...instruction);
    // 4. Optional documentation row: never a reason to call the integration incomplete.
    const semRel = `${r}/context/maps/semantic-map.md`;
    const sem = readInstanceFile(pr, semRel);
    if (sem.kind === 'ok' && /monolith idea/.test(sem.content))
        items.push({ path: semRel, action: 'UNCHANGED', reason: 'ideas rows present' });
    else
        items.push({ path: semRel, action: 'SKIP', reason: 'optional: ideas rows in the semantic map are documentation only; not required for Idea Capture' });
    return { monolithRoot: r, items, chain: chainChecks(pr, r, items, skillText) };
}
/** Static check of the whole chain. Only files MONOLITH can reason about; nothing is executed. */
function chainChecks(projectRoot, r, items, skillText) {
    const state = (path) => items.find((i) => i.path === path);
    const ok = (i) => i?.action === 'UNCHANGED';
    const instruction = items.filter((i) => i.path !== `${r}/AGENT.md` && !i.path.startsWith(`${r}/`));
    const checks = [];
    const add = (link, good, okMsg, badMsg) => {
        checks.push({ link, ok: good, detail: good ? okMsg : badMsg });
    };
    add('instructions → AGENT.md', instruction.length > 0 && instruction.every((i) => ok(i)), 'root instruction files point to AGENT.md', 'a root instruction file does not (yet) point to AGENT.md');
    add('AGENT.md → skills', ok(state(`${r}/AGENT.md`)) && ok(state(`${r}/skills/INDEX.md`)), 'AGENT.md and the skills index are current', 'AGENT.md or the skills index is missing, edited or not current');
    add('routing', ok(state(`${r}/context/maps/routing-map.md`)), 'CAPTURE_IDEA is routed', 'the CAPTURE_IDEA route is not in place');
    const skillItem = state(`${r}/skills/idea-capture/SKILL.md`);
    const skillPresent = skillItem?.action === 'UNCHANGED' || skillItem?.action === 'SKIP';
    add('skill', skillPresent, 'the idea-capture skill exists', 'the idea-capture skill is missing or unreadable');
    add('skill → CLI', skillPresent && skillText !== null && /monolith idea add/.test(prose(skillText)), 'the skill calls `monolith idea add`', 'the skill does not call `monolith idea add` (a customized skill may have dropped it)');
    let storage = '';
    try {
        listIdeas(ideaStore(projectRoot));
    }
    catch (err) {
        storage = err instanceof Error ? err.message : String(err);
    }
    add('CLI → storage', storage === '', 'the ideas store is usable (it is created on the first `idea add`)', `the ideas store cannot be used safely: ${storage}`);
    return checks;
}
/**
 * "Complete" is a structural statement: every managed component is installed,
 * unedited-or-current, and the static chain checks out. It says nothing about
 * what an AI model will do with the text. Integration is complete only when nothing is left to add, change or resolve AND every link of the chain checks out. */
export function integrationComplete(plan) {
    return plan.items.every((i) => i.action !== 'ADD' && i.action !== 'UPDATE' && i.action !== 'CONFLICT') && plan.chain.every((c) => c.ok);
}
/** Apply order: MONOLITH-owned files first, the pointer in the root instruction files last. */
function rank(item, r) {
    if (item.path.startsWith(`${r}/skills/idea-capture/`))
        return 0;
    if (item.path === `${r}/AGENT.md`)
        return 1;
    if (item.path.startsWith(`${r}/`))
        return 2;
    return 3;
}
/**
 * Write every ADD and UPDATE of `plan`. The tree is re-planned first and an
 * item is applied only if the file is exactly as planned: an `ADD` target that
 * appeared is skipped, an `UPDATE` whose file changed is reported as stale and
 * left alone. Stops at the first write failure (earlier files stay; re-run).
 */
export function applyPlan(target, plan) {
    const targetDir = resolve(target);
    const boundary = projectBoundary(targetDir);
    const out = { created: [], updated: [], stale: [], warnings: [] };
    const fresh = planUpdate(targetDir);
    const work = plan.items.filter((i) => (i.action === 'ADD' || i.action === 'UPDATE') && i.content !== undefined).sort((a, b) => rank(a, plan.monolithRoot) - rank(b, plan.monolithRoot));
    for (const item of work) {
        const now = fresh.items.find((i) => i.path === item.path);
        if (now?.action === 'UNCHANGED')
            continue; // someone else already did exactly this
        if (!now || now.action !== item.action || now.content !== item.content || now.before !== item.before) {
            out.stale.push(item.path);
            continue;
        }
        const abs = join(targetDir, item.path);
        try {
            const parent = openParent(boundary, dirname(abs), { create: item.action === 'ADD' });
            if (item.action === 'ADD') {
                const outcome = createFile(parent, basename(abs), item.content, { mode: 0o666, exactMode: false, durability: 'file' });
                out.warnings.push(...outcome.warnings);
                out.created.push(item.path);
            }
            else {
                // Last look: the file must still be the one planned against (narrows, does not close, the TOCTOU window).
                const cur = readInstanceFile(targetDir, item.path, true);
                if (cur.kind !== 'ok' || sha(cur.content) !== item.before) {
                    out.stale.push(item.path);
                    continue;
                }
                const outcome = replaceFile(parent, basename(abs), item.content, { mode: 0o666, exactMode: false, durability: 'file' });
                out.warnings.push(...outcome.warnings);
                out.updated.push(item.path);
            }
        }
        catch (err) {
            // Another `update` (or the user) created it first: exclusive create refused, nothing was overwritten.
            if (err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS')
                continue;
            throw err;
        }
    }
    return out;
}
export { RootContainmentError };
