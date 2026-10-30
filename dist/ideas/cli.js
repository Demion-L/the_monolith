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
import { IDEA_LIMITS, IdeaError } from './types.js';
const ADD_USAGE = 'Usage: monolith idea add --title "..." (--description "..." | --description-stdin) [--context "..."]';
/** UTF-8 needs at most 4 bytes per UTF-16 code unit's worth of text; anything larger cannot fit the description limit. */
const STDIN_MAX_BYTES = IDEA_LIMITS.description * 4;
const LIST_USAGE = 'Usage: monolith idea list';
const SHOW_USAGE = 'Usage: monolith idea show <id>';
/** Escape control characters so project-controlled text cannot forge terminal output. */
function printable(s) {
    // eslint-disable-next-line no-control-regex
    return s.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
const ADD_FLAGS = ['--title', '--description', '--context'];
const STDIN_FLAG = '--description-stdin';
const KNOWN_FLAGS = [...ADD_FLAGS, STDIN_FLAG];
/** Strict: every flag needs a value, none may repeat, unknown flags and stray arguments are errors. */
export function parseAddArgs(args) {
    const out = {};
    for (let i = 0; i < args.length; i++) {
        const flag = args[i];
        if (!KNOWN_FLAGS.includes(flag)) {
            throw new IdeaError('IDEA_INVALID_INPUT', `Unexpected argument ${JSON.stringify(printable(flag))}.\n${ADD_USAGE}`);
        }
        if (flag === STDIN_FLAG) {
            if (out.descriptionStdin)
                throw new IdeaError('IDEA_INVALID_INPUT', `${flag} was given more than once.\n${ADD_USAGE}`);
            out.descriptionStdin = true;
            continue;
        }
        const key = flag.slice(2);
        if (key in out)
            throw new IdeaError('IDEA_INVALID_INPUT', `${flag} was given more than once.\n${ADD_USAGE}`);
        const value = args[i + 1];
        if (value === undefined || KNOWN_FLAGS.includes(value)) {
            throw new IdeaError('IDEA_INVALID_INPUT', `${flag} needs a value.\n${ADD_USAGE}`);
        }
        out[key] = value;
        i++;
    }
    if (out.descriptionStdin && out.description !== undefined) {
        throw new IdeaError('IDEA_INVALID_INPUT', `--description and ${STDIN_FLAG} cannot be combined.\n${ADD_USAGE}`);
    }
    if (out.title === undefined || (out.description === undefined && !out.descriptionStdin)) {
        throw new IdeaError('IDEA_INVALID_INPUT', `--title and --description (or ${STDIN_FLAG}) are required.\n${ADD_USAGE}`);
    }
    return out;
}
/**
 * Read all of `input` as UTF-8, byte for byte (no trimming, BOM kept). Refuses
 * more than STDIN_MAX_BYTES, invalid UTF-8 and a read error; nothing is
 * interpreted. A terminal is refused instead of waiting for typed input.
 */
export async function readStdinText(input = process.stdin) {
    if (input.isTTY) {
        throw new IdeaError('IDEA_INVALID_INPUT', `${STDIN_FLAG} needs piped input, but stdin is a terminal.\n${ADD_USAGE}`);
    }
    const chunks = [];
    let total = 0;
    try {
        for await (const chunk of input) {
            const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
            total += buf.length;
            if (total > STDIN_MAX_BYTES) {
                input.destroy();
                throw new IdeaError('IDEA_INVALID_INPUT', `stdin is too large (more than ${STDIN_MAX_BYTES} bytes); nothing was written.`);
            }
            chunks.push(buf);
        }
    }
    catch (err) {
        if (err instanceof IdeaError)
            throw err;
        throw new IdeaError('IDEA_INVALID_INPUT', `could not read stdin: ${err.message}; nothing was written.`, { cause: err });
    }
    try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
    }
    catch (err) {
        throw new IdeaError('IDEA_INVALID_INPUT', 'stdin is not valid UTF-8; nothing was written.', { cause: err });
    }
}
export async function runIdeaAdd(args, targetDir = process.cwd(), stdin = process.stdin) {
    const flags = parseAddArgs(args);
    const description = flags.descriptionStdin ? await readStdinText(stdin) : flags.description;
    const store = ideaStore(targetDir);
    const { idea, path } = addIdea(store, { title: flags.title, description, context: flags.context }, { onWarning: (w) => reportWriteWarning(w) });
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
