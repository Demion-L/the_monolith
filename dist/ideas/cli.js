/* eslint-disable no-console */
/**
 * `monolith idea ...` command handlers (IDEA-001A).
 *
 * Thin layer: strict flag parsing, store calls, output. No LLM, no network;
 * `add` writes exactly one new file under `<monolithRoot>/memory/long-term/ideas/` and
 * touches no other state (not `active.md`, not `state.json`); `list` and `show` write nothing.
 */
import { reportWriteWarning } from '../root/index.js';
import { addIdea, getIdea, ideaStore, listIdeas } from './store.js';
import { IdeaError } from './types.js';
const ADD_USAGE = 'Usage: monolith idea add --title "..." --description "..." [--context "..."]';
const LIST_USAGE = 'Usage: monolith idea list';
const SHOW_USAGE = 'Usage: monolith idea show <id>';
/** Escape control characters so project-controlled text cannot forge terminal output. */
function printable(s) {
    // eslint-disable-next-line no-control-regex
    return s.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
const ADD_FLAGS = ['--title', '--description', '--context'];
/** Strict: every flag needs a value, none may repeat, unknown flags and stray arguments are errors. */
export function parseAddArgs(args) {
    const out = {};
    for (let i = 0; i < args.length; i++) {
        const flag = args[i];
        if (!ADD_FLAGS.includes(flag)) {
            throw new IdeaError('IDEA_INVALID_INPUT', `Unexpected argument ${JSON.stringify(printable(flag))}.\n${ADD_USAGE}`);
        }
        const key = flag.slice(2);
        if (key in out)
            throw new IdeaError('IDEA_INVALID_INPUT', `${flag} was given more than once.\n${ADD_USAGE}`);
        const value = args[i + 1];
        if (value === undefined || ADD_FLAGS.includes(value)) {
            throw new IdeaError('IDEA_INVALID_INPUT', `${flag} needs a value.\n${ADD_USAGE}`);
        }
        out[key] = value;
        i++;
    }
    if (out.title === undefined || out.description === undefined) {
        throw new IdeaError('IDEA_INVALID_INPUT', `--title and --description are required.\n${ADD_USAGE}`);
    }
    return out;
}
export async function runIdeaAdd(args, targetDir = process.cwd()) {
    const flags = parseAddArgs(args);
    const store = ideaStore(targetDir);
    const { idea, path } = addIdea(store, { title: flags.title, description: flags.description, context: flags.context }, { onWarning: (w) => reportWriteWarning(w) });
    console.log(`Saved ${idea.id} [${idea.status}]: ${printable(idea.title)}`);
    console.log(`  file: ${path}`);
    console.log('Current task and focus are unchanged. Recall with `monolith idea list` / `monolith idea show ' + idea.id + '`.');
}
export async function runIdeaList(args, targetDir = process.cwd()) {
    if (args.length > 0)
        throw new IdeaError('IDEA_INVALID_INPUT', `Unexpected argument ${JSON.stringify(printable(args[0]))}.\n${LIST_USAGE}`);
    const entries = listIdeas(ideaStore(targetDir));
    if (entries.length === 0) {
        console.log('No ideas. Capture one with `monolith idea add --title "..." --description "..."`.');
        return;
    }
    console.log(`Ideas (${entries.length}):`);
    let unreadable = 0;
    for (const e of entries) {
        if (e.ok) {
            console.log(`  ${e.idea.id}  [${e.idea.status}]  ${printable(e.idea.title)}`);
        }
        else {
            unreadable++;
            console.log(`  ${e.id}  [unreadable]  ${printable(e.reason)}`);
        }
    }
    if (unreadable > 0) {
        console.error(`${unreadable} idea file(s) could not be read; they were left untouched. Inspect them with \`monolith idea show <id>\`.`);
        process.exitCode = 2;
    }
}
function formatIdea(i) {
    const lines = [
        `  id:         ${i.id}`,
        `  title:      ${printable(i.title)}`,
        `  status:     ${i.status}`,
        `  createdAt:  ${i.createdAt}`,
    ];
    if (i.tags !== undefined && i.tags.length > 0)
        lines.push(`  tags:       ${i.tags.map(printable).join(', ')}`);
    lines.push('  context:    ' + (i.context === undefined ? '(none)' : ''));
    if (i.context !== undefined)
        lines.push(...i.context.split('\n').map((l) => `    ${l}`));
    lines.push('  description:');
    lines.push(...i.description.split('\n').map((l) => `    ${l}`));
    return lines.join('\n');
}
export async function runIdeaShow(args, targetDir = process.cwd()) {
    if (args.length !== 1)
        throw new IdeaError('IDEA_INVALID_INPUT', SHOW_USAGE);
    console.log(formatIdea(getIdea(ideaStore(targetDir), args[0])));
}
/** Dispatcher used by the CLI entrypoint. */
export async function runIdeaCommand(args, targetDir = process.cwd()) {
    const [sub, ...rest] = args;
    switch (sub) {
        case 'add':
            return runIdeaAdd(rest, targetDir);
        case 'list':
            return runIdeaList(rest, targetDir);
        case 'show':
            return runIdeaShow(rest, targetDir);
        default:
            throw new IdeaError('IDEA_INVALID_INPUT', `Unknown idea subcommand: ${sub === undefined ? '(none)' : JSON.stringify(printable(sub))}\n${ADD_USAGE}\n       ${LIST_USAGE.slice(7)}\n       ${SHOW_USAGE.slice(7)}`);
    }
}
