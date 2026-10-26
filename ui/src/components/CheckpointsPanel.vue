<script setup lang="ts">
import type { Checkpoint } from '../types/dashboard';
import ValueOrUnknown from './ValueOrUnknown.vue';

defineProps<{ checkpoints: Checkpoint[] | null }>();
</script>

<template>
  <section id="checkpoints" class="panel" aria-labelledby="checkpoints-h">
    <h2 id="checkpoints-h">Checkpoints</h2>
    <p class="muted">Latest checkpoint per active mission</p>
    <p v-if="checkpoints === null" class="empty"><span class="unknown">NOT AVAILABLE</span></p>
    <p v-else-if="checkpoints.length === 0" class="empty">No checkpoints recorded.</p>
    <ul v-else class="cards">
      <li v-for="c in checkpoints" :key="c.id" class="card" data-testid="checkpoint">
        <div class="card-head">
          <code>{{ c.id }}</code>
          <span class="muted"><ValueOrUnknown :value="c.createdAt" /></span>
        </div>
        <p v-if="c.recordedCount !== undefined" class="muted" data-testid="checkpoint-count">
          {{ c.recordedCount }} recorded {{ c.recordedCount === 1 ? 'checkpoint' : 'checkpoints' }}
        </p>
        <p><ValueOrUnknown :value="c.summary" /></p>
        <div class="steps">
          <h4>Remaining steps <span class="tag">historical record as of this checkpoint, not the current plan</span></h4>
          <p v-if="c.remainingSteps === null"><span class="unknown">UNKNOWN</span></p>
          <p v-else-if="c.remainingSteps.length === 0" class="muted">None recorded.</p>
          <ul v-else>
            <li v-for="(s, i) in c.remainingSteps" :key="i">{{ s }}</li>
          </ul>
        </div>
      </li>
    </ul>
  </section>
</template>
