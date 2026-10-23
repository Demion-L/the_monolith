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
      <dt>Description</dt>
      <dd><ValueOrUnknown :value="overview.description" /></dd>
      <dt>State revision</dt>
      <dd><ValueOrUnknown :value="overview.stateRevision" /></dd>
    </dl>
  </section>
</template>
