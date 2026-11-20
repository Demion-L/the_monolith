<script setup lang="ts">
import type { KnowledgeInfo, KnowledgeItem } from '../types/dashboard';
import KnowledgeCard from './KnowledgeCard.vue';
import KnowledgeNotice from './KnowledgeNotice.vue';

// `undefined`: the data source offers no such section; `null`: it could not be read; `[]`: none exist.
defineProps<{ items?: KnowledgeItem[] | null; demo: boolean; info?: KnowledgeInfo; embedded?: boolean }>();
</script>

<template>
  <component :is="embedded ? 'div' : 'section'" :id="embedded ? undefined : 'hypotheses'" :class="embedded ? 'kl-embedded' : 'panel'" :aria-labelledby="embedded ? undefined : 'hypotheses-h'">
    <h2 v-if="!embedded" id="hypotheses-h">Hypotheses</h2>
    <h3 v-else class="kl-h">Hypotheses</h3>
    <p class="muted">Overview of hypotheses; statuses are those the documents declare</p>
    <p v-if="items === undefined" class="empty" role="status" data-testid="knowledge-unprovided">
      <span class="unknown">NOT PROVIDED</span> The live data source has no hypotheses yet, so nothing is shown. Nothing is guessed or substituted.
    </p>
    <KnowledgeNotice v-else-if="items === null" :info="info" />
    <template v-else-if="items.length === 0">
      <KnowledgeNotice v-if="info && (!info.complete || info.issues.length > 0)" :info="info" />
      <p v-if="info && !info.complete" class="empty" data-testid="knowledge-empty-incomplete">No hypothesis could be listed; some entries were not interpretable (see above).</p>
      <p v-else class="empty" data-testid="knowledge-empty">No hypotheses recorded.</p>
    </template>
    <template v-else>
      <KnowledgeNotice v-if="info && (!info.complete || info.issues.length > 0)" :info="info" />
      <p v-if="demo" class="muted" data-testid="knowledge-demo">Demonstration data (fictional project), not real records.</p>
      <ul class="cards">
        <KnowledgeCard v-for="(it, i) in items" :key="`${it.id ?? 'no-id'}-${i}`" :item="it" kind="hypothesis" />
      </ul>
    </template>
  </component>
</template>
