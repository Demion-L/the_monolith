/* eslint-disable no-console */
/**
 * `monolith governance check [--json] [--strict]` (GOV-EVOLUTION Phase 5).
 *
 * Read-only: writes nothing, creates no state file, never executes project code, needs no LLM.
 * Core defines the rules; this command only invokes them and prints the result.
 *
 * Exit codes (additive; `monolith validate` and `monolith brief` keep theirs):
 *   0 — the check ran. Findings are printed; they do not change the exit code unless --strict.
 *   1 — usage error.
 *   2 — --strict and at least one WARNING or ERROR was found (INFO never counts).
 *   3 — the check itself could not be executed (unexpected fault).
 */
import { colorEnabled, paint } from '../cli/style.js';
import { buildGovernanceReport } from './check.js';
export const GOVERNANCE_USAGE = 'Usage: monolith governance check [--json] [--strict]';
export function parseGovernanceArgs(args) {
    if (args[0] !== 'check')
        return { ok: false, message: `Unknown governance subcommand: ${args[0] ?? '(none)'}\n${GOVERNANCE_USAGE}` };
    let json = false;
    let strict = false;
    for (const a of args.slice(1)) {
        if (a === '--json')
            json = true;
        else if (a === '--strict')
            strict = true;
        else
            return { ok: false, message: `Unknown option: ${a}\n${GOVERNANCE_USAGE}` };
    }
    return { ok: true, json, strict };
}
const STATUS_TEXT = {
    PASS: 'PASS',
    EMPTY: 'EMPTY',
    AVAILABLE: 'AVAILABLE',
    ABSENT: 'ABSENT',
    ISSUES: 'ISSUES',
    NOT_CHECKED: 'NOT CHECKED',
};
export function renderGovernanceReport(r, color = false) {
    const tone = (sev) => {
        const label = `[${sev}]`.padEnd(9);
        return paint(label, sev === 'ERROR' ? 'bad' : sev === 'WARNING' ? 'warn' : 'dim', color);
    };
    const lines = ['GOVERNANCE CHECK', '', `Project: ${r.project ?? '(unnamed)'}`, ''];
    for (const a of r.areas)
        lines.push(`- ${a.label}: ${STATUS_TEXT[a.status]}`);
    lines.push('');
    if (r.findings.length > 0) {
        lines.push(`Findings (${r.findings.length}):`);
        for (const f of r.findings)
            lines.push(`  ${tone(f.severity)} ${f.area} ${f.code}${f.path ? ` — ${f.path}` : ''}`, `            ${f.message}`);
        lines.push('');
    }
    lines.push(`Result: ${r.result === 'ISSUES_FOUND' ? 'ISSUES FOUND' : 'NO ISSUES'} (${r.counts.error} error, ${r.counts.warning} warning, ${r.counts.info} info)`);
    return lines.join('\n');
}
export async function runGovernanceCommand(args, cwd = process.cwd()) {
    const parsed = parseGovernanceArgs(args);
    if (!parsed.ok) {
        console.error(parsed.message);
        return 1;
    }
    let report;
    try {
        report = buildGovernanceReport(cwd);
    }
    catch {
        console.error('monolith governance check: the check could not be executed.');
        return 3;
    }
    if (parsed.json)
        console.log(JSON.stringify(report, null, 2));
    else
        console.log(renderGovernanceReport(report, colorEnabled(process.stdout)));
    return parsed.strict && report.result === 'ISSUES_FOUND' ? 2 : 0;
}
