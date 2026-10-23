<script setup lang="ts">
import { computed } from 'vue';
import type { Mission } from '../types/dashboard';
import ValueOrUnknown from './ValueOrUnknown.vue';

const props = defineProps<{ missions: Mission[] }>();

const active = computed(() => props.missions.filter((m) => m.status === 'in_progress'));
</script>

<template>
  <section id="mission" class="panel" aria-labelledby="mission-h">
    <h2 id="mission-h">Current Mission</h2>
    <p v-if="active.length === 0" class="empty">No active missions.</p>
    <ul v-else class="cards">
      <li v-for="m in active" :key="m.id" class="card" data-testid="mission">
        <div class="card-head">
          <code>{{ m.id }}</code>
          <span class="status status-active">{{ m.status }}</span>
        </div>
        <h3><ValueOrUnknown :value="m.title" /></h3>
        <p><ValueOrUnknown :value="m.summary" /></p>
        <dl class="facts compact">
          <dt>Started</dt>
          <dd><ValueOrUnknown :value="m.startedAt" /></dd>
          <dt>Updated</dt>
          <dd><ValueOrUnknown :value="m.updatedAt" /></dd>
        </dl>
      </li>
    </ul>
  </section>
</template>
