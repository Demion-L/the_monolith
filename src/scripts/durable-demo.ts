/* eslint-disable no-console */
/**
 * Durable State demonstration: a task survives the death of the process that
 * started it and is continued, days later, by a different process.
 *
 *   node dist/scripts/durable-demo.js run --dir <empty dir> --scenario direct|adaptive|recovery
 *
 * `run` orchestrates four OS processes, each of which is a separate invocation
 * of this file (so nothing is shared but the directory):
 *
 *   1. agent     starts a task "prepare commercial proposals for 3 prospects", records plan,
 *                assumptions and decisions, sends 3 research requests to "SphynX" (an outbox
 *                directory standing in for the real system) — and is KILLED (SIGKILL) while
 *                sending the third request, after the request left but before the agent
 *                could record that it did.
 *   2. sphynx    "three days later" answers the requests: out of order, one answer delivered
 *                twice, one contradicted by a second answer. No agent process exists.
 *   3. world     (adaptive/recovery scenarios) another agent changes something the plan relied on.
 *   4. agent     the same program starts again. It does not know it is a restart: it re-runs its
 *                own procedure, every step of which is idempotent, and the library tells it
 *                what already happened, what is in doubt, and whether it may simply continue.
 *
 * The domain (proposals, SphynX, CRM) lives only in this file. The library knows
 * tasks, events, assumptions, effects, awaits and deliveries.
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DurableTasks, FsEventStore, newOwnerId, type Fence, type Json } from '../durable/index.js';

const TASK_ID = 'proposals-q4';
const PROSPECTS = ['acme', 'globex', 'initech'] as const;
const DAY = 86_400_000;

type Scenario = 'direct' | 'adaptive' | 'recovery';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dir = arg('--dir') as string;
const scenario = (arg('--scenario') ?? 'direct') as Scenario;
const clockOffsetMs = Number(arg('--clock-offset-days') ?? 0) * DAY;

function openRuntime(): DurableTasks {
  const store = new FsEventStore({ target: { scope: 'trusted-directory', dir: join(dir, 'durable') } });
  // This program is an explicit, operator-run demonstration over a store of its own: it initializes it (a no-op when
  // already initialized). A real deployment does this once, deliberately, never as a side effect of opening the store.
  store.initializeProtocolSync();
  return new DurableTasks({
    store,
    now: () => new Date(Date.now() + clockOffsetMs),
    defaultLeaseMs: 60_000,
  });
}

const outbox = (): string => join(dir, 'sphynx-outbox');
const crmFile = (): string => join(dir, 'crm.json');
const say = (who: string, msg: string): void => console.log(`[${who.padEnd(6)}] ${msg}`);

// --- the "external systems" -----------------------------------------------------------------

/** Sending is idempotent on the request id, like a real API with an Idempotency-Key header. */
function sendToSphynx(requestId: string, body: Json, replyToken: string): void {
  mkdirSync(outbox(), { recursive: true });
  const file = join(outbox(), `${requestId}.json`);
  if (!existsSync(file)) writeFileSync(file, JSON.stringify({ requestId, body, replyToken }));
}

function readCrm(): { budget: { min: number }; tone: string } {
  return JSON.parse(readFileSync(crmFile(), 'utf8'));
}

// --- the agent's procedure: written to be re-run from the top, any number of times -----------

async function agentProcedure(rt: DurableTasks, owner: string, crashDuringThirdSend: boolean): Promise<{ outcome: string; mode?: string }> {
  const crm = readCrm();
  await rt.createTask({ taskId: TASK_ID, kind: 'commercial-proposals', goal: 'Prepare commercial proposals for 3 prospects', input: { prospects: [...PROSPECTS] } });

  let fence: Fence;
  try {
    fence = await rt.claim(TASK_ID, { owner });
  } catch (err) {
    say('agent', `cannot claim the task: ${(err as Error).message}`);
    return { outcome: 'not-claimed' };
  }
  say('agent', `claimed ${TASK_ID} as ${owner} (epoch ${fence.epoch})`);

  await rt.declarePlan(fence, [
    { id: 'research', title: 'research all prospects with SphynX' },
    { id: 'draft', title: 'draft proposals', dependsOn: ['research'] },
    { id: 'send', title: 'send proposals', dependsOn: ['draft'] },
  ]);
  // Assumptions are stated once, with the value they were based on. A restarted run must not
  // re-state them with today's values: the whole point is to compare them with today's values.
  const known = (await rt.getState(TASK_ID)).assumptions;
  if (!known['crm.budget']) await rt.recordAssumption(fence, { key: 'crm.budget', statement: 'prospects can spend at least 10k', value: crm.budget, criticality: 'blocking', evidence: [{ ref: 'crm:snapshot/2026-10-20' }] });
  if (!known['crm.tone']) await rt.recordAssumption(fence, { key: 'crm.tone', statement: 'formal tone is preferred', value: crm.tone, criticality: 'advisory' });
  await rt.recordDecision(fence, { id: 'd-research', summary: 'research every prospect with SphynX before drafting', rationale: 'proposals must cite facts', basedOn: ['crm.budget'] });

  // 1. ask — every call below is a no-op if it already happened
  let sent = 0;
  for (const company of PROSPECTS) {
    const w = await rt.registerAwait(fence, { awaitId: `research-${company}`, purpose: `research ${company}`, stepId: 'research', request: { company }, deadlineAt: new Date(Date.now() + clockOffsetMs + 7 * DAY) });
    const out = await rt.runEffect(
      fence,
      `send-research-${company}`,
      async () => {
        sendToSphynx(`research-${company}`, { company }, w.token);
        sent++;
        if (crashDuringThirdSend && company === 'initech') {
          say('agent', 'request sent; the process is killed before it can write that down (SIGKILL)');
          process.kill(process.pid, 'SIGKILL');
        }
        return { requestId: `research-${company}` };
      },
      {
        description: `send research request for ${company}`,
        // "did it go out?" — answered by looking at the external system, by the effect key
        reconcile: async () =>
          existsSync(join(outbox(), `research-${company}.json`))
            ? { status: 'completed', result: { requestId: `research-${company}` } }
            : { status: 'not-executed' },
      },
    );
    say('agent', `research request for ${company}: ${out.replayed ? 'already sent earlier (not sent again)' : 'sent'}`);
  }
  void sent;

  // 2. may I continue?
  const a = await rt.assess(TASK_ID, { observations: { 'crm.budget': crm.budget, 'crm.tone': crm.tone } });
  say('agent', `assessment: mode=${a.mode}; results=${a.results.length}; pending=${a.pendingAwaits.length}; reasons=${a.reasons.filter((r) => r.severity !== 'info').map((r) => r.code).join(',') || '-'}`);

  if (a.mode === 'waiting') {
    await rt.release(fence);
    say('agent', 'nothing to do until more results arrive; exiting');
    return { outcome: 'waiting', mode: a.mode };
  }

  if (a.mode === 'recovery') {
    const packet = await rt.resumePacket(TASK_ID, { observations: { 'crm.budget': crm.budget, 'crm.tone': crm.tone } });
    say('agent', `RECOVERY: the plan cannot be trusted. Resume packet: ${packet.decisions.length} decision(s), ${packet.assumptions.length} assumption(s), ${packet.timeline.length} events, ${packet.sinceSend[0]?.changes.length ?? 0} change(s) since the requests were sent`);
    for (const c of a.assumptionChanges) say('agent', `  broken assumption ${c.key}: was ${JSON.stringify(c.was)}, now ${JSON.stringify(c.now)}`);
    // This is where a Reasoning Projector would be handed `packet`. The demo applies a fixed policy instead.
    await rt.retractAssumption(fence, 'crm.budget', 'budget fell below the threshold');
    await rt.recordDecision(fence, { id: 'd-stop', summary: 'do not send proposals: prospects no longer meet the budget threshold', rationale: 'blocking assumption crm.budget failed', basedOn: ['crm.budget'] });
    await rt.cancel(TASK_ID, 'recovery: budget assumption failed; operator review required', owner);
    return { outcome: 'recovered-and-stopped', mode: a.mode };
  }

  // direct / adaptive: consume results and finish
  const facts = a.results.map((r) => r.payload);
  if (a.mode === 'adaptive') {
    const why = a.assumptionChanges.map((c) => `${c.key}: ${JSON.stringify(c.was)} -> ${JSON.stringify(c.now)}`).join('; ');
    await rt.recordDecision(fence, { id: 'd-adapt', summary: `continue and adapt: ${why}`, rationale: 'only advisory assumptions changed', basedOn: a.assumptionChanges.map((c) => c.key) });
    say('agent', `ADAPTIVE: continuing, taking into account ${why}`);
  } else {
    say('agent', 'DIRECT: continuing without further reasoning');
  }
  await rt.completeStep(fence, 'research', { results: facts.length });
  await rt.completeStep(fence, 'draft', { tone: scenario === 'adaptive' ? readCrm().tone : crm.tone });
  const mail = await rt.runEffect(fence, 'send-proposals', async () => ({ sent: PROSPECTS.length }), { description: 'send the proposals' });
  await rt.completeStep(fence, 'send', mail.result);
  await rt.complete(fence, { proposals: PROSPECTS.length, mode: a.mode });
  say('agent', `task completed (${mail.result.sent} proposals)`);
  return { outcome: 'completed', mode: a.mode };
}

// --- processes ------------------------------------------------------------------------------------

async function phaseAgent(): Promise<void> {
  const rt = openRuntime();
  const crash = process.argv.includes('--crash');
  const r = await agentProcedure(rt, newOwnerId(), crash);
  console.log(`RESULT ${JSON.stringify(r)}`);
}

async function phaseSphynx(): Promise<void> {
  const rt = openRuntime(); // a different process; it has never seen the task
  const files = readdirSync(outbox()).sort();
  // answer in reverse order, deliver one answer twice, and contradict one
  const order = [...files].reverse();
  for (const f of order) {
    const req = JSON.parse(readFileSync(join(outbox(), f), 'utf8')) as { requestId: string; body: { company: string }; replyToken: string };
    const answer = { company: req.body.company, employees: req.body.company.length * 100 };
    const r = await rt.deliver(req.replyToken, answer, { idempotencyKey: `sphynx:${req.requestId}:v1`, source: 'sphynx' });
    say('sphynx', `answer for ${req.body.company}: ${r.kind}`);
    if (req.body.company === 'globex') {
      const dup = await rt.deliver(req.replyToken, answer, { idempotencyKey: `sphynx:${req.requestId}:v1`, source: 'sphynx' });
      say('sphynx', `answer for globex redelivered: ${dup.kind}`);
      const other = await rt.deliver(req.replyToken, { ...answer, employees: 1 }, { idempotencyKey: `sphynx:${req.requestId}:v2`, source: 'sphynx' });
      say('sphynx', `contradicting answer for globex: ${other.kind}`);
    }
  }
}

async function phaseWorld(): Promise<void> {
  const rt = openRuntime();
  const crm = readCrm();
  if (scenario === 'adaptive') crm.tone = 'casual';
  if (scenario === 'recovery') crm.budget = { min: 2000 };
  writeFileSync(crmFile(), JSON.stringify(crm));
  await rt.observe(TASK_ID, { key: 'crm.budget', value: crm.budget, source: 'crm-agent' });
  await rt.observe(TASK_ID, { key: 'crm.tone', value: crm.tone, source: 'crm-agent' });
  say('world', `CRM now says: budget ${JSON.stringify(crm.budget)}, tone ${crm.tone}`);
}

function child(phase: string, extra: string[] = []): { status: number | null; signal: NodeJS.Signals | null; stdout: string } {
  const r = spawnSync(process.execPath, [process.argv[1] as string, phase, '--dir', dir, '--scenario', scenario, ...extra], { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return { status: r.status, signal: r.signal, stdout: r.stdout };
}

async function run(): Promise<number> {
  mkdirSync(dir, { recursive: true });
  writeFileSync(crmFile(), JSON.stringify({ budget: { min: 10000 }, tone: 'formal' }));
  console.log(`Scenario: ${scenario}\n`);

  console.log('--- process 1: the agent starts the task and dies mid-way ---');
  const first = child('agent', ['--crash']);
  console.log(`(process 1 ended: signal=${first.signal}, exit=${first.status})\n`);
  if (first.signal !== 'SIGKILL') return fail('the first agent was expected to be killed');

  console.log('--- process 2: three days later, SphynX answers (no agent is running) ---');
  child('sphynx', ['--clock-offset-days', '3']);
  console.log('');

  if (scenario !== 'direct') {
    console.log('--- process 3: meanwhile another agent changed the world ---');
    child('world', ['--clock-offset-days', '3']);
    console.log('');
  }

  console.log('--- process 4: the agent is started again (it does not know it is a restart) ---');
  const second = child('agent', ['--clock-offset-days', '3']);
  const result = /RESULT (.*)/.exec(second.stdout);
  const outcome = result ? (JSON.parse(result[1] as string) as { outcome: string; mode?: string }) : null;

  const rt = openRuntime();
  const report = await rt.verify(TASK_ID);
  const state = await rt.getState(TASK_ID);
  console.log(`\nFinal state: status=${state.status}, events=${state.eventCount}, log verified=${report[0]?.ok}`);
  console.log(`DEMO ${JSON.stringify({ scenario, outcome, status: state.status, verified: report[0]?.ok === true, events: state.eventCount })}`);
  const expected: Record<Scenario, [string, string]> = { direct: ['completed', 'direct'], adaptive: ['completed', 'adaptive'], recovery: ['recovered-and-stopped', 'recovery'] };
  const [expOutcome, expMode] = expected[scenario];
  return outcome?.outcome === expOutcome && outcome.mode === expMode && report[0]?.ok ? 0 : fail('unexpected outcome');
}

function fail(msg: string): number {
  console.error(`DEMO FAILED: ${msg}`);
  return 1;
}

const phase = process.argv[2];
const main = phase === 'run' ? run : phase === 'agent' ? () => phaseAgent().then(() => 0) : phase === 'sphynx' ? () => phaseSphynx().then(() => 0) : phase === 'world' ? () => phaseWorld().then(() => 0) : null;
if (!main || !dir) {
  console.error('usage: durable-demo run --dir <dir> --scenario direct|adaptive|recovery');
  process.exit(2);
} else {
  main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
}
