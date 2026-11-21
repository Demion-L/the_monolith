/**
 * What MONOLITH can honestly say about Managed Execution for a project (read-only, host-neutral inputs).
 *
 * It never claims that enforcement "works": it reports the configured mode and whether the project's own Claude Code
 * settings contain the PreToolUse hook. User-level (global) settings are NOT inspected, so a missing project hook is
 * reported as "not found in project settings", never as proof that no hook exists anywhere.
 */
import { readProjectFile } from '../root/index.js';
import { readExecutionConfig } from '../coordinatorium/execution-config.js';
const SETTINGS_FILES = ['.claude/settings.json', '.claude/settings.local.json'];
const HOOK_MARK = 'monolith hook pre-tool-use';
function settingsHasHook(text) {
    try {
        const parsed = JSON.parse(text);
        const groups = parsed.hooks?.PreToolUse;
        if (!Array.isArray(groups))
            return false;
        return groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(HOOK_MARK)));
    }
    catch {
        return null;
    }
}
export function findPreToolUseHook(projectRoot) {
    let unreadable = false;
    for (const rel of SETTINGS_FILES) {
        const r = readProjectFile(projectRoot, rel, { allowEmpty: true });
        if (!r.ok) {
            if (r.code !== 'FILE_MISSING')
                unreadable = true;
            continue;
        }
        const has = settingsHasHook('content' in r ? r.content : '');
        if (has === null)
            unreadable = true;
        else if (has)
            return { installation: 'found', where: rel, note: `PreToolUse hook found in ${rel}` };
    }
    return unreadable
        ? { installation: 'unreadable', where: null, note: 'a project Claude Code settings file could not be read; the hook cannot be confirmed' }
        : { installation: 'not-found', where: null, note: 'no PreToolUse hook found in .claude/settings.json or .claude/settings.local.json (user-level settings are not inspected)' };
}
export function buildExecutionStatus(projectRoot) {
    const config = readExecutionConfig(projectRoot);
    if (config.status !== 'ok') {
        return { config, hook: { installation: 'not-applicable', where: null, note: 'not checked' }, enforcement: 'config-problem', summary: `Execution mode could not be determined (${config.detail}); NOT managed until the configuration is fixed.` };
    }
    if (config.mode === 'off') {
        return { config, hook: { installation: 'not-applicable', where: null, note: 'managed mode is off' }, enforcement: 'inactive-off', summary: 'Managed Execution: off (no enrolment is required; missions are registered manually).' };
    }
    const hook = findPreToolUseHook(projectRoot);
    if (hook.installation === 'found') {
        return { config, hook, enforcement: 'configured-hook-found', summary: `Managed Execution: configured (on enrolment failure: ${config.onEnrollmentFailure}); ${hook.note}. Covers only the file tools and Bash calls the host routes through the hook.` };
    }
    return { config, hook, enforcement: 'configured-hook-not-found', summary: `Managed Execution is configured but ENFORCEMENT IS NOT CONFIRMED: ${hook.note}. Without the hook nothing enrols or blocks anything. Generate it with \`monolith hook print-config --managed\`.` };
}
