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
export {};
//# sourceMappingURL=durable-demo.d.ts.map