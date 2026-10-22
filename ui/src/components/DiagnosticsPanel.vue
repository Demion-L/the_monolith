<script setup lang="ts">
import { computed } from 'vue';
import type { DashboardData } from '../types/dashboard';

const props = defineProps<{ data: DashboardData }>();

const missing = computed(() => {
  const d = props.data;
  const out: string[] = [];
  if (d.overview.name === null) out.push('overview.name');
  if (d.overview.description === null) out.push('overview.description');
  if (d.overview.stateRevision === null) out.push('overview.stateRevision');
  if (d.roadmapText === null) out.push('roadmapText');
  for (const m of d.missions) {
    for (const k of ['title', 'summary', 'startedAt', 'updatedAt'] as const) {
      if (m[k] === null) out.push(`mission ${m.id}.${k}`);
    }
  }
  for (const c of d.checkpoints) {
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
    <dl class="facts">
      <dt>Data source</dt>
      <dd>{{ data.isDemo ? 'Synthetic demo fixtures (available)' : 'UNKNOWN' }}</dd>
    </dl>
    <p class="muted">
      No runtime checks of a real project are performed. Security status of MONOLITH Core is not
      reported here.
    </p>

    <h3>Messages</h3>
    <p v-if="data.diagnostics.length === 0" class="empty">No diagnostic messages.</p>
    <ul v-else class="diag">
      <li v-for="(d, i) in data.diagnostics" :key="i" :class="`sev-${d.severity}`" data-testid="diagnostic">
        <span class="sev">{{ d.severity }}</span> {{ d.message }}
      </li>
    </ul>

    <h3>Missing values</h3>
    <p v-if="missing.length === 0" class="empty">None.</p>
    <ul v-else class="diag" data-testid="missing">
      <li v-for="m in missing" :key="m"><code>{{ m }}</code></li>
    </ul>
  </section>
</template>
