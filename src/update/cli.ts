/* eslint-disable no-console */
/**
 * `monolith update [--apply]` handler (DX-UPDATE-001). Preview is read-only.
 * Exit codes: 0 ok (preview, or apply with integration complete), 1 error,
 * 2 apply finished but manual actions remain (integration incomplete).
 */

import { reportWriteWarning } from '../root/index.js';
import { applyPlan, integrationComplete, planUpdate, type UpdateItem, type UpdatePlan } from './index.js';

export const UPDATE_USAGE = `Usage: monolith update [--apply]

Brings an existing MONOLITH instance up to Idea Capture & Recall.
  (no flag)  Preview: shows the plan, writes nothing.
  --apply    Creates the files marked ADD. Nothing else is written.

Never overwrites or edits an existing file: CLAUDE.md, AGENTS.md, the routing
map, the skills index, memory, state.json and your own skills are only read.
Where they lack the wiring, the plan shows CONFLICT with the exact text to add
by hand. Instances carry no template version, so components are detected by
content. Safe to re-run. Not transactional and not coordinated between
simultaneous runs. Exit code 2 after --apply means manual actions remain.`;

function printable(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function printPlan(plan: UpdatePlan): void {
  const width = Math.max(...plan.items.map((i) => i.action.length));
  for (const i of plan.items) console.log(`  ${i.action.padEnd(width)}  ${printable(i.path)}\n  ${' '.repeat(width)}  ${i.reason}`);
}

function printProposals(items: UpdateItem[]): void {
  for (const i of items.filter((x) => x.action === 'CONFLICT' && x.proposal)) {
    console.log(`\n--- Add to ${printable(i.path)} ---\n${i.proposal}\n--- end ---`);
  }
}

function verdict(plan: UpdatePlan): string {
  const pending = plan.items.filter((i) => i.action === 'ADD').length;
  const manual = plan.items.filter((i) => i.action === 'CONFLICT').length;
  if (pending === 0 && manual === 0) return 'Idea Capture integration: COMPLETE (skill, routing, instructions are all in place).';
  const parts = [];
  if (pending > 0) parts.push(`${pending} file(s) to add`);
  if (manual > 0) parts.push(`${manual} manual action(s)`);
  return `Idea Capture integration: INCOMPLETE (${parts.join(', ')}). A skill without its routing and instructions is not active.`;
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
    printProposals(plan.items);
    console.log(`\n${verdict(plan)}`);
    if (plan.items.some((i) => i.action === 'ADD')) console.log('Run `monolith update --apply` to create the files marked ADD.');
    return 0;
  }

  const result = applyPlan(targetDir, plan);
  for (const w of result.warnings) reportWriteWarning(w);
  console.log(`\nCreated ${result.created.length} file(s)${result.created.length ? ': ' + result.created.map(printable).join(', ') : ''}.`);

  const after = planUpdate(targetDir);
  printProposals(after.items);
  console.log(`\n${verdict(after)}`);
  return integrationComplete(after) ? 0 : 2;
}
