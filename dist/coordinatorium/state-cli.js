/* eslint-disable no-console */
/**
 * `monolith state ...` — where the operational state lives, and explicit adoption.
 */
import { adoptState, formatPlan } from './adopt.js';
import { resolveStateLocation, collectStateProvenance, describeFile, formatSplitBrain } from './state-location.js';
import { reportWriteWarning } from '../root/index.js';
const STATE_USAGE = `Usage:
  monolith state status
  monolith state adopt <source> [--upgrade-v2] [--apply]
    <source> is a state.json file or a directory containing one. Without --apply it only previews.`;
export async function runStateStatus(args, targetDir = process.cwd()) {
    if (args.length > 0)
        throw new Error(`Unexpected argument ${JSON.stringify(args[0].slice(0, 40))}.\n${STATE_USAGE}`);
    const loc = resolveStateLocation(targetDir);
    const p = collectStateProvenance(loc);
    console.log('State provenance');
    console.log(`  MONOLITH version:     ${p.monolithVersion}`);
    console.log(`  project root:         ${p.projectRoot}`);
    console.log(`  repository identity:  ${p.repositoryIdentity ?? '(not a git repository)'}`);
    console.log(`  git common dir:       ${p.gitCommonDir ?? '(none)'}`);
    console.log(`  mode:                 ${p.kind === 'git-common-dir' ? 'shared' : p.mode === 'isolated' ? 'isolated' : 'local'}${p.localReason ? ` (${p.localReason})` : ''}`);
    console.log(`  canonical state:      ${p.canonicalStatePath}`);
    console.log(`  state:                ${describeFile(p.canonical)}`);
    console.log(`  worktrees:            ${p.worktreeCount === null ? '(unknown)' : p.worktreeCount}`);
    const sb = formatSplitBrain(p);
    if (sb.length === 0) {
        console.log('  split-brain:          none detected (this is not a verification of consistency)');
    }
    else {
        console.log('');
        for (const l of sb)
            console.log(l);
    }
    const quiet = p.splitBrain.candidates.filter((c) => !c.mayHoldUserData);
    for (const c of quiet)
        console.log(`  note: empty local scaffold ${c.path} (${describeFile(c)}) is not counted as a competing state.`);
}
export async function runStateAdopt(args, targetDir = process.cwd()) {
    let apply = false;
    let upgradeV2 = false;
    const positional = [];
    for (const a of args) {
        if (a === '--apply')
            apply = true;
        else if (a === '--upgrade-v2')
            upgradeV2 = true;
        else if (a.startsWith('--'))
            throw new Error(`Unknown option ${JSON.stringify(a.slice(0, 40))}.\n${STATE_USAGE}`);
        else
            positional.push(a);
    }
    if (positional.length !== 1)
        throw new Error(STATE_USAGE);
    const loc = resolveStateLocation(targetDir);
    const result = await adoptState(loc, positional[0], { apply, upgradeV2, onWarning: (w) => reportWriteWarning(w) }, targetDir);
    for (const l of formatPlan(result.plan, result.applied, result.backupPath))
        console.log(l);
    if (!apply && !result.plan.canApply)
        process.exitCode = 1;
}
export async function runState(args, targetDir = process.cwd()) {
    const [sub, ...rest] = args;
    if (sub === 'status')
        return runStateStatus(rest, targetDir);
    if (sub === 'adopt')
        return runStateAdopt(rest, targetDir);
    throw new Error(`Unknown state subcommand: ${sub ?? '(none)'}\n${STATE_USAGE}`);
}
