/* eslint-disable no-console */
/**
 * `monolith update [--apply]` handler (DX-UPDATE-001). Preview is read-only.
 * Exit codes: 0 ok (preview, or apply with integration complete), 1 error,
 * 2 apply finished but manual actions remain (integration incomplete).
 */

import { reportWriteWarning } from '../root/index.js';
import { applyPlan, integrationComplete, planUpdate, type UpdateItem, type UpdatePlan } from './index.js';

export const UPDATE_USAGE = `Usage: monolith update [--apply]

Brings an existing MONOLITH instance up to the current agent integration: a
stable entry point (<root>/AGENT.md), the idea-capture skill, its routing and the
pointer in your AI instruction files.
  (no flag)  Preview: shows the plan, writes nothing.
  --apply    Performs the plan: ADD creates a missing MONOLITH file, UPDATE adds
             or refreshes a managed block inside a file of yours.

What is written, and what is not:
  - MONOLITH text goes only into checksummed managed blocks
    (<!-- monolith:begin ... -->). Appending leaves every existing byte in place;
    refreshing replaces only an unedited block.
  - A block you edited, a malformed block, a clashing section of yours, an
    unclosed code fence (backticks or tildes) or HTML comment that would hide the block, a file that is not
    valid UTF-8 (no encoding is converted) or an unreadable file is CONFLICT: nothing is written there and the plan says how
    to resolve it. SKIP means left alone on purpose (e.g. your own skill).
  - Your existing skills, memory, state.json, ideas and text are never overwritten.
    Nothing is executed.
Instances carry no template version, so state is read from the files. Safe to
re-run. Not transactional and not coordinated between simultaneous runs: apply
re-checks each file just before writing and skips one that changed. Exit code 2
after --apply means the integration is not complete (conflicts or skipped
changes remain).`;

function printable(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function printPlan(plan: UpdatePlan): void {
  const width = Math.max(...plan.items.map((i) => i.action.length));
  for (const i of plan.items) console.log(`  ${i.action.padEnd(width)}  ${printable(i.path)}\n  ${' '.repeat(width)}  ${i.reason}`);
}

function printEffects(items: UpdateItem[]): void {
  const todo = items.filter((i) => i.action === 'ADD' || i.action === 'UPDATE');
  if (todo.length === 0) return;
  console.log('\nWhy this is safe: ADD only creates files that do not exist; UPDATE only adds or refreshes a');
  console.log('managed block and is checked to leave all other text unchanged. Nothing else is written.');
  console.log('After --apply:');
  for (const i of todo) console.log(`  - ${printable(i.path)}: ${i.effect ?? ''}`);
}

function printProposals(items: UpdateItem[]): void {
  for (const i of items.filter((x) => x.action === 'CONFLICT' && x.proposal)) {
    console.log(`\n--- Manual fallback for ${printable(i.path)}: add this block yourself ---\n${i.proposal}--- end ---`);
  }
}

function printChain(plan: UpdatePlan): void {
  console.log('\nConsistency (instructions → routing → skill → CLI → storage):');
  for (const c of plan.chain) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.link}: ${printable(c.detail)}`);
}

function verdict(plan: UpdatePlan, stale: string[] = []): string {
  const pending = plan.items.filter((i) => i.action === 'ADD' || i.action === 'UPDATE').length;
  const manual = plan.items.filter((i) => i.action === 'CONFLICT').length;
  const broken = plan.chain.filter((c) => !c.ok).length;
  if (pending === 0 && manual === 0 && broken === 0 && stale.length === 0) return 'Idea Capture integration: COMPLETE (the managed components are installed and pass the structural check; how an AI assistant behaves is not verified).';
  const parts = [];
  if (pending > 0) parts.push(`${pending} change(s) to apply`);
  if (manual > 0) parts.push(`${manual} manual action(s)`);
  if (stale.length > 0) parts.push(`${stale.length} change(s) skipped because the file changed meanwhile`);
  if (broken > 0 && parts.length === 0) parts.push(`${broken} consistency check(s) failing`);
  return `Idea Capture integration: INCOMPLETE (${parts.join(', ')}). A partly installed integration is not active.`;
}

export async function runUpdate(args: string[], targetDir = process.cwd()): Promise<number> {
  let apply = false;
  for (const a of args) {
    if (a === '--apply') apply = true;
    else {
      console.error(`Unexpected argument ${JSON.stringify(printable(a))}.\n${UPDATE_USAGE}`);
      return 1;
    }
  }

  const plan = planUpdate(targetDir);
  console.log(`monolith update — ${apply ? 'apply' : 'preview (nothing is written)'}`);
  console.log(`Instance root: ${plan.monolithRoot}/\n`);
  printPlan(plan);

  if (!apply) {
    printEffects(plan.items);
    printProposals(plan.items);
    printChain(plan);
    console.log(`\n${verdict(plan)}`);
    if (plan.items.some((i) => i.action === 'ADD' || i.action === 'UPDATE')) console.log('Run `monolith update --apply` to perform the ADD / UPDATE items.');
    return 0;
  }

  const result = applyPlan(targetDir, plan);
  for (const w of result.warnings) reportWriteWarning(w);
  const list = (xs: string[]): string => (xs.length ? ': ' + xs.map(printable).join(', ') : '');
  console.log(`\nCreated ${result.created.length} file(s)${list(result.created)}.`);
  console.log(`Updated ${result.updated.length} file(s)${list(result.updated)}.`);
  if (result.stale.length > 0) console.log(`Skipped (changed since planning)${list(result.stale)}. Re-run to plan again.`);

  const after = planUpdate(targetDir);
  printProposals(after.items);
  printChain(after);
  console.log(`\n${verdict(after, result.stale)}`);
  return integrationComplete(after) && result.stale.length === 0 ? 0 : 2;
}
