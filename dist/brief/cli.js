/* eslint-disable no-console */
/**
 * `monolith brief` CLI command handler.
 *
 * stdout carries only the brief's own content; CLI diagnostics and the
 * INCOMPLETE warning go to stderr (section 12). Exit codes (DEC-CONTEXT-002):
 *   0 — brief formed (COMPLETE or INCOMPLETE)
 *   1 — CLI usage error (thrown as a plain Error, caught by src/cli/index.ts's main())
 *   2 — --strict and the result is INCOMPLETE
 *
 * `--reconcile` (SELF-AWARENESS-002) prints the State Reconciliation Report
 * instead of the brief: what a Freshness verdict rests on and what a person
 * should check. Same read-only contract, same exit codes (a report is formed
 * -> 0, whatever the Freshness; usage error -> 1). It does not combine with
 * `--strict`, whose meaning (Completeness) belongs to the brief.
 */
import { collect } from './collect.js';
import { render, DEFAULT_MAX_CHARS } from './render.js';
import { reconcile, renderReconciliation } from './reconcile.js';
const USAGE = 'Usage: monolith brief [--max-chars N] [--strict]\n       monolith brief --reconcile [--max-chars N]';
export function parseBriefArgs(args) {
    let maxChars = DEFAULT_MAX_CHARS;
    let strict = false;
    let reconcileMode = false;
    const unknown = [];
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === '--strict') {
            strict = true;
            i++;
            continue;
        }
        if (arg === '--reconcile') {
            reconcileMode = true;
            i++;
            continue;
        }
        if (arg === '--max-chars') {
            const value = args[i + 1];
            if (value === undefined) {
                return { ok: false, message: `--max-chars requires a value.\n\n${USAGE}` };
            }
            const n = Number(value);
            if (!Number.isInteger(n) || n <= 0) {
                return { ok: false, message: `--max-chars must be a positive integer, got "${value}".\n\n${USAGE}` };
            }
            maxChars = n;
            i += 2;
            continue;
        }
        unknown.push(arg);
        i++;
    }
    if (unknown.length > 0) {
        return { ok: false, message: `Unknown argument(s) for 'monolith brief': ${unknown.join(' ')}\n\n${USAGE}` };
    }
    if (reconcileMode && strict) {
        return { ok: false, message: `--strict cannot be combined with --reconcile.\n\n${USAGE}` };
    }
    return reconcileMode ? { ok: true, maxChars, strict, reconcile: true } : { ok: true, maxChars, strict };
}
export async function runBrief(args, targetDir = process.cwd()) {
    const parsed = parseBriefArgs(args);
    if (!parsed.ok) {
        throw new Error(parsed.message);
    }
    const model = await collect(targetDir);
    if (parsed.reconcile) {
        if (!model.freshness || !model.freshnessEvidence) {
            throw new Error('monolith brief --reconcile: no freshness evidence could be collected.');
        }
        process.stdout.write(renderReconciliation(reconcile(model.freshnessEvidence, model.freshness), parsed.maxChars).text);
        process.exit(0);
    }
    const { text, completeness } = render(model, parsed.maxChars);
    process.stdout.write(text);
    if (completeness === 'INCOMPLETE') {
        console.error('monolith brief: result is INCOMPLETE — see the Diagnostics section above.');
    }
    if (parsed.strict && completeness === 'INCOMPLETE') {
        process.exit(2);
    }
    process.exit(0);
}
