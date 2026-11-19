<script setup lang="ts">
import { computed } from 'vue';
import type { DashboardData } from '../types/dashboard';
import type { DiagnosticRunners } from '../live/diagnostics';
import OperationalState from './OperationalState.vue';
import ReconciliationCard from './ReconciliationCard.vue';
import StatusPill from './StatusPill.vue';
import type { Tone } from './StatusPill.vue';
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

// Anything other than a plain "available" must be visible while the details are collapsed.
const problems = computed(() => props.data.diagnostics.filter((d) => d.severity !== 'info'));
const sourceTone = computed((): { label: string; tone: Tone } | null => {
  const src = props.data.sources;
  if (src === undefined) return null;
  if (problems.value.some((p) => p.severity === 'error')) return { label: 'UNAVAILABLE', tone: 'err' };
  if (src.available < src.total) return { label: 'PARTIAL', tone: 'warn' };
  if (problems.value.length > 0) return { label: 'WARNING', tone: 'warn' };
  return { label: 'AVAILABLE', tone: 'ok' };
});
</script>

<template>
  <section id="diagnostics" class="panel diagnostics" aria-labelledby="diagnostics-h">
    <h2 id="diagnostics-h">Diagnostics</h2>
    <p class="muted dintro">
      Run checks, inspect project state and identify inconsistencies. Three separate questions, answered by
      separate checks. They are not combined into one score.
    </p>

    <!-- Two independent columns: a short card never leaves a gap by being stretched to match a tall neighbour. -->
    <div class="dcols">
     <div class="dcol">
      <ValidationCard v-if="runners" :runner="runners.validation" />
      <article v-else class="dcard" data-testid="runs-unavailable">
        <header class="dcard-head"><h3>Validation and reconciliation</h3></header>
        <p class="empty">These checks run against a real project. They are not available for demo data.</p>
      </article>
      <OperationalState v-if="!data.isDemo" :provenance="data.provenance" :state-source="data.stateSource" />
     </div>
     <div class="dcol">
      <ReconciliationCard v-if="runners" :runner="runners.reconciliation" />

      <article class="dcard dcard-secondary" data-testid="source-availability" aria-labelledby="sources-h">
        <header class="dcard-head">
          <h3 id="sources-h">Source availability</h3>
          <StatusPill v-if="sourceTone" :tone="sourceTone.tone" :label="sourceTone.label" />
        </header>
        <p class="muted dcard-q">Can MONOLITH read the sources it needs?</p>
        <p v-if="data.sources" class="dcard-summary" data-testid="source-summary">
          {{ data.sources.available }}/{{ data.sources.total }} sources available
        </p>
        <p v-if="problems.length > 0" class="source-problem" data-testid="source-problems">
          {{ problems.length }} problem{{ problems.length === 1 ? '' : 's' }}: {{ problems.map((p) => p.message).join('; ') }}
        </p>
        <!-- Explanation only: the count, the pill and the problem line above stay exactly as Core reported them. -->
        <p v-if="!data.isDemo && data.stateSource === 'absent'" class="muted" data-testid="state-absent-note">
          The missing <code>state</code> source is expected: operational state is created on the first state write, so its absence before then is normal.
        </p>

        <details class="more">
          <summary>Show details</summary>
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
        </details>
      </article>
     </div>
    </div>
  </section>
</template>
