<script setup lang="ts">
import type { KnowledgeInfo, KnowledgeItem } from '../types/dashboard';
import KnowledgeCard from './KnowledgeCard.vue';
import KnowledgeNotice from './KnowledgeNotice.vue';

// `undefined`: the data source offers no such section; `null`: it could not be read; `[]`: none exist.
defineProps<{ items?: KnowledgeItem[] | null; demo: boolean; info?: KnowledgeInfo }>();
</script>

<template>
  <section id="decisions" class="panel" aria-labelledby="decisions-h">
    <h2 id="decisions-h">Architecture Decisions</h2>
    <p class="muted">Overview of ADRs; read-only, statuses as declared</p>
    <p v-if="items === undefined" class="empty" role="status" data-testid="knowledge-unprovided">
      <span class="unknown">NOT PROVIDED</span> The live data source has no architecture decisions yet, so nothing is shown. Nothing is guessed or substituted.
    </p>
    <KnowledgeNotice v-else-if="items === null" :info="info" />
    <p v-else-if="items.length === 0" class="empty" data-testid="knowledge-empty">No architecture decisions recorded.</p>
    <template v-else>
      <KnowledgeNotice v-if="info && (!info.complete || info.issues.length > 0)" :info="info" />
      <p v-if="demo" class="muted" data-testid="knowledge-demo">Demonstration data (fictional project), not real records.</p>
      <ul class="cards">
        <KnowledgeCard v-for="(it, i) in items" :key="`${it.id ?? 'no-id'}-${i}`" :item="it" kind="adr" />
      </ul>
    </template>
  </section>
</template>
