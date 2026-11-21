/**
 * Conservative classification of a host tool call (Claude Code PreToolUse) for Managed Execution.
 *
 * This is NOT a shell parser. File tools are classified by name; a Bash command is "read-only" only when it is a
 * single simple command (or a plain `|` pipeline of them) made of tokens that can be checked by exact comparison
 * against a short allowlist. Anything else — redirections, substitutions, `&&`, `;`, quoting, environment prefixes,
 * unknown programs — is UNCLASSIFIED and, in managed mode, treated as a potential write. False positives merely
 * enrol a Mission earlier; a false negative is never produced for the shapes handled here.
 *
 * Boundary: only calls the host routes through the hook are classified. A write made by a program that a command
 * runs (a build, a test run, an editor) is invisible to this layer; it is why such commands count as unclassified.
 */
import { existsSync, realpathSync } from 'fs';
import { dirname, isAbsolute, relative, resolve } from 'path';
const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set([
    'Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'TodoWrite', 'Task', 'Agent', 'ToolSearch', 'AskUserQuestion',
    'EnterPlanMode', 'ExitPlanMode', 'BashOutput', 'KillShell', 'TaskOutput', 'TaskStop', 'NotebookRead', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
]);
/** Programs that cannot modify files when used as `prog args...` without any shell metacharacter. */
const READ_ONLY_PROGRAMS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'pwd', 'echo', 'grep', 'rg', 'which', 'whoami', 'stat', 'file', 'tree', 'diff', 'basename', 'dirname', 'realpath', 'uname', 'id', 'true', 'false', 'printf', 'test']);
const READ_ONLY_GIT = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame', 'describe', 'shortlog', 'rev-list', 'cat-file', 'ls-tree', 'merge-base', 'name-rev']);
const FIND_WRITE_FLAGS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls']);
/** Any of these makes a command un-analysable here. Quotes are included on purpose: no quoting rules are re-implemented. */
const META = /[;&<>$`\\\n\r(){}*?~"'!#=]/;
function isReadOnlySimple(tokens) {
    const [prog, ...rest] = tokens;
    if (prog === undefined)
        return false;
    if (rest.some((t) => t.startsWith('--output')))
        return false;
    if (prog === 'git')
        return rest[0] !== undefined && READ_ONLY_GIT.has(rest[0]);
    if (prog === 'find')
        return !rest.some((t) => FIND_WRITE_FLAGS.has(t));
    return READ_ONLY_PROGRAMS.has(prog);
}
export function classifyBashCommand(command) {
    const c = command.trim();
    if (c === '')
        return { action: 'read', reason: 'empty command' };
    if (META.test(c))
        return { action: 'implementation', reason: 'shell syntax this layer does not analyse (conservative)' };
    const segments = c.split('|').map((s) => s.trim());
    if (segments.some((s) => s === ''))
        return { action: 'implementation', reason: 'unparsable pipeline (conservative)' };
    const programs = segments.map((s) => s.split(/\s+/));
    if (programs.length === 1 && programs[0][0] === 'monolith')
        return { action: 'governed', reason: 'MONOLITH CLI: governed by its own contracts' };
    if (programs.every(isReadOnlySimple))
        return { action: 'read', reason: 'allowlisted read-only command' };
    return { action: 'implementation', reason: `command not on the read-only allowlist (${programs[0][0]?.slice(0, 40) ?? '?'})` };
}
function realpathOfNearestAncestor(p) {
    let cur = p;
    for (let i = 0; i < 64; i++) {
        if (existsSync(cur)) {
            try {
                return resolve(realpathSync(cur), relative(cur, p));
            }
            catch {
                return p;
            }
        }
        const up = dirname(cur);
        if (up === cur)
            break;
        cur = up;
    }
    return p;
}
/** True when `target` (resolved against `cwd`) lies inside `worktree`. Symlinks of existing ancestors are resolved. */
export function isInsideWorktree(target, cwd, worktree) {
    const abs = realpathOfNearestAncestor(isAbsolute(target) ? resolve(target) : resolve(cwd, target));
    const rel = relative(worktree, abs);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
export function classifyToolUse(toolName, toolInput, cwd, worktree) {
    if (typeof toolName !== 'string' || toolName === '')
        return { action: 'uncontrolled', reason: 'no tool name in the hook input' };
    const input = typeof toolInput === 'object' && toolInput !== null ? toolInput : {};
    if (FILE_WRITE_TOOLS.has(toolName)) {
        const p = input.file_path ?? input.notebook_path;
        if (typeof p !== 'string' || p === '')
            return { action: 'implementation', reason: `${toolName} without a readable path (conservative)` };
        return isInsideWorktree(p, cwd, worktree)
            ? { action: 'implementation', reason: `${toolName} inside the worktree` }
            : { action: 'external', reason: `${toolName} outside the worktree` };
    }
    if (toolName === 'Bash') {
        return typeof input.command === 'string' ? classifyBashCommand(input.command) : { action: 'implementation', reason: 'Bash without a readable command (conservative)' };
    }
    if (READ_TOOLS.has(toolName))
        return { action: 'read', reason: `${toolName} does not modify the project` };
    return { action: 'uncontrolled', reason: `tool "${toolName.slice(0, 60)}" is not understood by this layer` };
}
