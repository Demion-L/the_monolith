<script setup lang="ts">
import { computed, ref } from 'vue';
import CheckpointsPanel from './components/CheckpointsPanel.vue';
import CurrentMission from './components/CurrentMission.vue';
import DiagnosticsPanel from './components/DiagnosticsPanel.vue';
import ProjectOverview from './components/ProjectOverview.vue';
import RoadmapPanel from './components/RoadmapPanel.vue';
import { scenarioIds, scenarios } from './fixtures/dashboard';
import type { ScenarioId } from './types/dashboard';

function initialScenario(): ScenarioId {
  const q = new URLSearchParams(window.location.search).get('scenario');
  return scenarioIds.find((id) => id === q) ?? 'normal';
}

const scenario = ref<ScenarioId>(initialScenario());
const data = computed(() => scenarios[scenario.value]);
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <strong>MONOLITH</strong>
      <span class="muted">Mission Control</span>
    </div>
    <div class="project">{{ data.overview.name ?? 'UNKNOWN' }}</div>
    <div class="topbar-right">
      <label class="scenario">
        Scenario
        <select v-model="scenario" data-testid="scenario-select">
          <option v-for="id in scenarioIds" :key="id" :value="id">{{ id }}</option>
        </select>
      </label>
      <span class="demo-badge" data-testid="demo-badge">DEMO DATA</span>
    </div>
  </header>
  <nav class="nav" aria-label="Sections">
    <a href="#overview">Project Overview</a>
    <a href="#mission">Current Mission</a>
    <a href="#checkpoints">Checkpoints</a>
    <a href="#roadmap">Roadmap</a>
    <a href="#diagnostics">Diagnostics</a>
  </nav>
  <main class="content">
    <ProjectOverview :overview="data.overview" />
    <CurrentMission :missions="data.missions" />
    <CheckpointsPanel :checkpoints="data.checkpoints" />
    <RoadmapPanel :text="data.roadmapText" />
    <DiagnosticsPanel :data="data" />
  </main>
</template>
