<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import CheckpointsPanel from './components/CheckpointsPanel.vue';
import CurrentMission from './components/CurrentMission.vue';
import DiagnosticsPanel from './components/DiagnosticsPanel.vue';
import ProjectOverview from './components/ProjectOverview.vue';
import RoadmapPanel from './components/RoadmapPanel.vue';
import SideNav from './components/SideNav.vue';
import { scenarioIds, scenarios } from './fixtures/dashboard';
import { toDashboardData } from './live/adapter';
import { DashboardLoadError, fetchDashboard } from './live/client';
import type { DashboardLoadState } from './live/client';
import type { ScenarioId } from './types/dashboard';

const params = new URLSearchParams(window.location.search);

// LIVE is the default. DEMO is only ever entered explicitly (`?mode=demo`) and
// is never a fallback: a failed LIVE load stays an error, see `load()`.
const demo = params.get('mode') === 'demo';

function initialScenario(): ScenarioId {
  return scenarioIds.find((id) => id === params.get('scenario')) ?? 'normal';
}
const scenario = ref<ScenarioId>(initialScenario());

const live = ref<DashboardLoadState>({ status: 'loading' });
let request = 0;

async function load(): Promise<void> {
  const mine = ++request;
  // Drop the previous snapshot first: after a failure no old data may remain on screen.
  live.value = { status: 'loading' };
  try {
    const data = await fetchDashboard();
    if (mine === request) live.value = { status: 'ready', data };
  } catch (e) {
    if (mine !== request) return;
    const message = e instanceof DashboardLoadError ? e.message : 'The dashboard could not be loaded.';
    live.value = { status: 'error', message };
  }
}

onMounted(() => {
  if (!demo) void load();
});

const data = computed(() => {
  if (demo) return scenarios[scenario.value];
  return live.value.status === 'ready' ? toDashboardData(live.value.data) : null;
});
const loading = computed(() => !demo && live.value.status === 'loading');
</script>

<template>
  <div class="shell">
    <SideNav :sections="data !== null" />
    <div class="shell-main">
      <header class="topbar">
        <div class="project">{{ data?.overview.name ?? 'UNKNOWN' }}</div>
        <div class="topbar-right">
          <label v-if="demo" class="scenario">
            Scenario
            <select v-model="scenario" data-testid="scenario-select">
              <option v-for="id in scenarioIds" :key="id" :value="id">{{ id }}</option>
            </select>
          </label>
          <button v-else type="button" data-testid="refresh" :disabled="loading" @click="load">Refresh</button>
          <span v-if="demo" class="demo-badge" data-testid="demo-badge">DEMO DATA</span>
          <span v-else-if="data" class="live-badge" data-testid="live-badge">LIVE DATA</span>
          <span v-else class="live-badge live-badge-off" data-testid="live-badge">LIVE · NO DATA</span>
        </div>
      </header>
      <main v-if="data" class="content">
        <ProjectOverview :overview="data.overview" />
        <CurrentMission :missions="data.missions" />
        <CheckpointsPanel :checkpoints="data.checkpoints" />
        <RoadmapPanel :text="data.roadmapText" />
        <DiagnosticsPanel :data="data" />
      </main>
      <main v-else class="content">
        <section v-if="live.status === 'error'" class="panel" role="alert" data-testid="load-error">
          <h2>Live data could not be loaded</h2>
          <p>{{ live.message }}</p>
          <p class="muted">No data is shown. Demo data is never substituted for live data.</p>
          <button type="button" data-testid="retry" @click="load">Retry</button>
        </section>
        <section v-else class="panel" role="status" data-testid="loading">
          <p class="muted">Loading live data…</p>
        </section>
      </main>
    </div>
  </div>
</template>
