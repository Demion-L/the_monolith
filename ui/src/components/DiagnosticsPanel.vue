<script setup lang="ts">
import { computed } from 'vue';
import type { DashboardData } from '../types/dashboard';
import type { DiagnosticRunners } from '../live/diagnostics';
import OperationalState from './OperationalState.vue';
import ReconciliationCard from './ReconciliationCard.vue';
import ValidationCard from './ValidationCard.vue';

// `runners` exists only for LIVE data: DEMO has no project to check.
const props = defineProps<{ data: DashboardData; runners?: DiagnosticRunners }>();

const missing = computed(() => {
  const d = props.data;
  const out: string[] = [];
  if (d.overview.name === null) out.push('overview.name');
  if (d.overview.description === null) out.push('overview.description');
  if (d.overview.stateRevision === null) out.push('overview.stateRevision');
  if (d.overview.currentStory === null) out.push('overview.currentStory');
  if (d.roadmapText === null) out.push('roadmapText');
  if (d.missions === null) out.push('missions');
  if (d.checkpoints === null) out.push('checkpoints');
  for (const m of d.missions ?? []) {
    for (const k of ['title', 'summary', 'startedAt', 'updatedAt'] as const) {
      if (m[k] === null) out.push(`mission ${m.id}.${k}`);
    }
  }
  for (const c of d.checkpoints ?? []) {
    for (const k of ['createdAt', 'summary', 'remainingSteps'] as const) {
      if (c[k] === null) out.push(`checkpoint ${c.id}.${k}`);
    }
  }
  return out;
});
</script>

<template>
  <section id="diagnostics" class="panel" aria-labelledby="diagnostics-h">
    <h2 id="diagnostics-h">Diagnostics</h2>
    <p class="muted">
      Three separate questions, answered by three separate checks. They are not combined into one score.
    </p>

    <div class="dgrid">
      <template v-if="runners">
        <ValidationCard :runner="runners.validation" />
        <ReconciliationCard :runner="runners.reconciliation" />
      </template>
      <article v-else class="dcard" data-testid="runs-unavailable">
        <header class="dcard-head"><h3>Validation and reconciliation</h3></header>
        <p class="empty">These checks run against a real project. They are not available for demo data.</p>
      </article>

      <OperationalState v-if="!data.isDemo" :provenance="data.provenance" />

      <article class="dcard" data-testid="source-availability" aria-labelledby="sources-h">
        <header class="dcard-head"><h3 id="sources-h">Source availability</h3></header>
        <p class="muted dcard-q">Can MONOLITH read the sources it needs?</p>
        <dl class="facts compact">
          <dt>Data source</dt>
          <dd>{{ data.isDemo ? 'Synthetic demo fixtures (available)' : 'MONOLITH HTTP API (GET /api/dashboard)' }}</dd>
        </dl>
        <p v-if="data.isDemo" class="muted">
          No runtime checks of a real project are performed. Security status of MONOLITH Core is not
          reported here.
        </p>
        <p v-else class="muted">
          Only the availability of the fixed source files is reported. This is not a validation result:
          project validity and the security status of MONOLITH Core are not reported here.
        </p>

        <h4>Messages</h4>
        <p v-if="data.diagnostics.length === 0" class="empty">No diagnostic messages.</p>
        <ul v-else class="diag" data-testid="diagnostic-list">
          <li v-for="(d, i) in data.diagnostics" :key="i" :class="`sev-${d.severity}`" data-testid="diagnostic">
            <span class="sev">{{ d.severity }}</span> {{ d.message }}
          </li>
        </ul>

        <h4>Missing values</h4>
        <p v-if="missing.length === 0" class="empty">None.</p>
        <ul v-else class="diag" data-testid="missing">
          <li v-for="m in missing" :key="m"><code>{{ m }}</code></li>
        </ul>
      </article>
    </div>
  </section>
</template>
