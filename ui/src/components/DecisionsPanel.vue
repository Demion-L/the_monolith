<script setup lang="ts">
import { computed, toRef } from 'vue';
import { LIST_PAGE_SIZE, useSearchableList } from '../list-controls';
import type { KnowledgeInfo, KnowledgeItem } from '../types/dashboard';
import KnowledgeCard from './KnowledgeCard.vue';
import KnowledgeNotice from './KnowledgeNotice.vue';

// `undefined`: the data source offers no such section; `null`: it could not be read; `[]`: none exist.
const props = defineProps<{ items?: KnowledgeItem[] | null; demo: boolean; info?: KnowledgeInfo }>();

// View-only search by ADR id, title and (verbatim) status; case-insensitive. Pages of 10, like the Roadmap.
const list = useSearchableList(
  computed(() => props.items ?? []),
  (it) => [it.id, it.title, it.status],
);
const { query, filtered, visible, remaining } = list;
const total = toRef(() => props.items?.length ?? 0);
</script>

<template>
  <section id="decisions" class="panel" aria-labelledby="decisions-h">
    <h2 id="decisions-h">Architecture Decisions</h2>
    <p class="muted">Overview of ADRs; read-only, statuses as declared</p>
    <p v-if="items === undefined" class="empty" role="status" data-testid="knowledge-unprovided">
      <span class="unknown">NOT PROVIDED</span> The live data source has no architecture decisions yet, so nothing is shown. Nothing is guessed or substituted.
    </p>
    <KnowledgeNotice v-else-if="items === null" :info="info" />
    <template v-else-if="items.length === 0">
      <KnowledgeNotice v-if="info && (!info.complete || info.issues.length > 0)" :info="info" />
      <p v-if="info && !info.complete" class="empty" data-testid="knowledge-empty-incomplete">No architecture decision could be listed; some documents were not interpretable (see above).</p>
      <p v-else class="empty" data-testid="knowledge-empty">No architecture decisions recorded.</p>
    </template>
    <template v-else>
      <KnowledgeNotice v-if="info && (!info.complete || info.issues.length > 0)" :info="info" />
      <p v-if="demo" class="muted" data-testid="knowledge-demo">Demonstration data (fictional project), not real records.</p>
      <div class="navigator" data-testid="decisions-navigator">
        <div class="nav-controls">
          <label class="nav-search">
            <span class="sr-only">Search architecture decisions</span>
            <input v-model="query" type="search" placeholder="Search decisions by id, title or status…" autocomplete="off" data-testid="decisions-search" />
          </label>
          <button v-if="query !== ''" type="button" class="btn" data-testid="decisions-search-clear" @click="list.clear">Clear</button>
        </div>
      </div>
      <p v-if="filtered.length === 0" class="empty" role="status" data-testid="decisions-no-results">No decisions match "{{ query }}".</p>
      <ul v-else class="cards" data-testid="decisions-list">
        <KnowledgeCard v-for="it in visible" :key="`${it.id ?? 'no-id'}-${items.indexOf(it)}`" :item="it" kind="adr" />
      </ul>
      <div v-if="filtered.length > 0" class="nav-footer" data-testid="decisions-footer">
        <p class="muted" data-testid="decisions-count">
          Showing {{ visible.length }} of {{ filtered.length }} decisions<template v-if="filtered.length !== total"> (filtered from {{ total }})</template>
        </p>
        <button v-if="remaining > 0" type="button" class="btn" data-testid="decisions-more" @click="list.showMore">Show {{ Math.min(LIST_PAGE_SIZE, remaining) }} more</button>
        <p v-else class="muted" data-testid="decisions-end">End of the list.</p>
      </div>
    </template>
  </section>
</template>
