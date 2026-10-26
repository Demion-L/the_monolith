<script setup lang="ts">
import type { ProjectOverview } from '../types/dashboard';
import ValueOrUnknown from './ValueOrUnknown.vue';

defineProps<{ overview: ProjectOverview }>();
</script>

<template>
  <section id="overview" class="panel" aria-labelledby="overview-h">
    <h2 id="overview-h">Project Overview</h2>
    <dl class="facts">
      <dt>Name</dt>
      <dd><ValueOrUnknown :value="overview.name" /></dd>
      <template v-if="overview.description !== undefined">
        <dt>Description</dt>
        <dd><ValueOrUnknown :value="overview.description" /></dd>
      </template>
      <dt>State revision</dt>
      <dd><ValueOrUnknown :value="overview.stateRevision" /></dd>
      <template v-if="overview.currentStory !== undefined">
        <dt>Current story</dt>
        <!-- Untrusted project text: interpolation only, never HTML. -->
        <dd><pre v-if="overview.currentStory" class="story" data-testid="current-story">{{ overview.currentStory }}</pre><ValueOrUnknown v-else :value="null" /></dd>
      </template>
    </dl>
  </section>
</template>
