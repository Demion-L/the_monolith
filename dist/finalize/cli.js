/* eslint-disable no-console */
/**
 * `monolith finalize plan|apply` (DOCSYNC-001, ADR-022).
 *
 * `plan` is read-only. `apply` writes only with `--approve <digest>` taken from
 * a `plan` the owner reviewed. Exit codes: 0 ok / already finalized; 1 usage or
 * unreadable proposal; 2 not ready / refused (nothing written); 3 incomplete
 * (partially applied — see the output).
 */
import { lstatSync, readFileSync } from 'fs';
import { applyFinalization, planFinalization } from './core.js';
import { parseProposal } from './proposal.js';
const USAGE = `Usage:
  monolith finalize plan  --proposal <file|-> [--json]
  monolith finalize apply --proposal <file|-> --approve <digest> [--json]`;
const MAX_PROPOSAL_BYTES = 4 * 1024 * 1024;
// eslint-disable-next-line no-control-regex
const printable = (s) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
function parseFlags(args, allowApprove) {
    const f = { json: false };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--json')
            f.json = true;
        else if (a === '--proposal' || (allowApprove && a === '--approve')) {
            const v = args[i + 1];
            if (v === undefined || v.startsWith('--'))
                throw new Error(`${a} needs a value.\n${USAGE}`);
            const key = a === '--proposal' ? 'proposal' : 'approve';
            if (f[key] !== undefined)
                throw new Error(`${a} was given more than once.\n${USAGE}`);
            f[key] = v;
            i++;
        }
        else
            throw new Error(`Unexpected argument ${JSON.stringify(printable(a))}.\n${USAGE}`);
    }
    if (f.proposal === undefined)
        throw new Error(`--proposal is required.\n${USAGE}`);
    if (allowApprove && f.approve === undefined)
        throw new Error(`--approve <digest> is required: run \`monolith finalize plan\`, review it, then pass its digest.\n${USAGE}`);
    return f;
}
async function readProposal(src) {
    let raw;
    if (src === '-') {
        const chunks = [];
        let n = 0;
        for await (const c of process.stdin) {
            n += c.length;
            if (n > MAX_PROPOSAL_BYTES)
                throw new Error('proposal on stdin is too large.');
            chunks.push(c);
        }
        raw = Buffer.concat(chunks).toString('utf8');
    }
    else {
        const st = lstatSync(src);
        if (!st.isFile())
            throw new Error(`${src} is not a regular file.`);
        if (st.size > MAX_PROPOSAL_BYTES)
            throw new Error(`${src} is too large.`);
        raw = readFileSync(src, 'utf8');
    }
    let json;
    try {
        json = JSON.parse(raw);
    }
    catch (err) {
        throw new Error(`proposal is not valid JSON: ${err.message}`);
    }
    const parsed = parseProposal(json);
    if (!parsed.ok)
        throw new Error(`invalid proposal:\n${parsed.errors.map((e) => `  - ${e}`).join('\n')}`);
    return parsed.proposal;
}
function printPlan(pl) {
    console.log(`Finalization plan for ${printable(pl.storyId)}: ${pl.status}${pl.partial ? ' (PARTIAL: an earlier run was interrupted; apply rolls it forward)' : ''}`);
    console.log('\nPreconditions:');
    for (const c of pl.checks)
        console.log(`  [${c.status}] ${c.id}: ${printable(c.detail)}\n         source: ${printable(c.source)}`);
    console.log('\nTargets (in write order, active.md last):');
    for (const t of pl.targets)
        console.log(`  [${t.state}] ${t.id} → ${printable(t.path)}${t.state === 'done' ? '' : ` — ${printable(t.reason)}`}`);
    for (const d of pl.diagnostics)
        console.log(`\nNote: ${printable(d)}`);
    if (pl.status === 'READY')
        console.log(`\nDigest: ${pl.digest}\nOwner approval: monolith finalize apply --proposal <same file> --approve ${pl.digest}`);
}
function printApply(r) {
    console.log(`Finalization of ${printable(r.storyId)}: ${r.status}`);
    if (r.applied.length > 0)
        console.log(`  written: ${r.applied.join(', ')}`);
    if (r.status !== 'FINALIZED' && r.pending.length > 0)
        console.log(`  not written: ${r.pending.join(', ')}`);
    if (r.failed)
        console.log(`  failed: ${r.failed.target}${r.failed.publication ? ` [${r.failed.publication}]` : ''}: ${printable(r.failed.message)}`);
    for (const d of r.diagnostics)
        console.log(`  ${printable(d)}`);
    if (r.status === 'REFUSED')
        for (const c of r.plan.checks.filter((x) => x.status !== 'PASS'))
            console.log(`  [${c.status}] ${c.id}: ${printable(c.detail)}`);
}
export async function runFinalizeCommand(args, targetDir = process.cwd()) {
    const sub = args[0];
    try {
        if (sub === 'plan') {
            const f = parseFlags(args.slice(1), false);
            const pl = planFinalization(targetDir, await readProposal(f.proposal));
            if (f.json)
                console.log(JSON.stringify(pl, null, 2));
            else
                printPlan(pl);
            return pl.status === 'NOT_READY' ? 2 : 0;
        }
        if (sub === 'apply') {
            const f = parseFlags(args.slice(1), true);
            const r = await applyFinalization(targetDir, await readProposal(f.proposal), f.approve, {
                onWarning: (w) => console.error(`warning: ${printable(w.message)}`),
            });
            if (f.json)
                console.log(JSON.stringify(r, null, 2));
            else
                printApply(r);
            return r.status === 'FINALIZED' || r.status === 'ALREADY_FINALIZED' ? 0 : r.status === 'REFUSED' ? 2 : 3;
        }
        console.error(`Unknown finalize subcommand: ${sub === undefined ? '(none)' : printable(sub)}\n${USAGE}`);
        return 1;
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        return 1;
    }
}
