<script setup lang="ts">
import { computed, ref } from 'vue';
import { LIST_PAGE_SIZE, useSearchableList } from '../list-controls';
import { safeDocPath } from '../knowledge';
import type { IdeasData, IdeaView, KnowledgeInfo, KnowledgeItem, Section } from '../types/dashboard';
import HypothesesPanel from './HypothesesPanel.vue';

/**
 * Knowledge Lab (GOV-EVOLUTION Phase 4): Ideas and Hypotheses side by side, from two independent
 * sources. Read-only presentation of Core's read model; no editing, no Idea → Hypothesis lifecycle.
 * Idea text is untrusted user data and is rendered only through Vue's escaping.
 */
const props = defineProps<{
  ideas?: Section<IdeasData>;
  hypotheses?: KnowledgeItem[] | null;
  hypothesesInfo?: KnowledgeInfo;
  demo: boolean;
}>();

const tab = ref<'ideas' | 'hypotheses'>('ideas');
const statusFilter = ref<'all' | IdeaView['status']>('all');
const selectedId = ref<string | null>(null);

const items = computed<IdeaView[]>(() => props.ideas?.data?.items ?? []);
const byStatus = computed(() => items.value.filter((i) => statusFilter.value === 'all' || i.status === statusFilter.value));
const list = useSearchableList(byStatus, (i) => [i.id, i.title, i.status, i.description, i.context, ...i.tags]);
const { query, filtered, visible, remaining } = list;
const selected = computed(() => items.value.find((i) => i.id === selectedId.value) ?? null);

const source = computed(() => props.ideas?.sources[0] ?? null);
const absent = computed(() => props.ideas !== undefined && props.ideas.data === null && source.value?.status === 'absent');
const failed = computed(() => props.ideas !== undefined && props.ideas.data === null && source.value?.status !== 'absent');

function toggle(id: string): void {
  selectedId.value = selectedId.value === id ? null : id;
}
</script>

<template>
  <section id="knowledge" class="panel" aria-labelledby="knowledge-h">
    <h2 id="knowledge-h">Knowledge Lab</h2>
    <p class="muted">Ideas and hypotheses, read-only, from separate sources. Nothing here is edited, linked or promoted.</p>
    <div class="tabs" role="tablist" aria-label="Knowledge Lab">
      <button type="button" role="tab" class="btn" :aria-selected="tab === 'ideas'" data-testid="tab-ideas" @click="tab = 'ideas'">Ideas</button>
      <button type="button" role="tab" class="btn" :aria-selected="tab === 'hypotheses'" data-testid="tab-hypotheses" @click="tab = 'hypotheses'">Hypotheses</button>
    </div>

    <div v-if="tab === 'ideas'" role="tabpanel" data-testid="ideas-panel">
      <h3 class="kl-h">Ideas</h3>
      <p v-if="ideas === undefined" class="empty" role="status" data-testid="ideas-unprovided">
        <span class="unknown">NOT PROVIDED</span> This data source has no ideas section. Nothing is guessed or substituted.
      </p>
      <p v-else-if="absent" class="empty" role="status" data-testid="ideas-absent">
        No idea has been captured yet: the ideas directory does not exist <code v-if="source?.path">({{ source.path }})</code>.
      </p>
      <p v-else-if="failed" class="empty" role="status" data-testid="ideas-error">
        <span class="unknown">{{ source?.status === 'forbidden' ? 'REFUSED' : 'ERROR' }}</span>
        The ideas source could not be read<template v-if="source?.code"> [{{ source.code }}]</template>. Nothing is shown rather than a partial list.
      </p>
      <template v-else-if="ideas?.data">
        <div v-if="!ideas.data.complete" class="notice" role="status" data-testid="ideas-incomplete">
          <p class="muted"><span class="unknown">INCOMPLETE</span> Some idea files could not be read; this list may not show every idea.</p>
          <ul class="issues">
            <li v-for="x in ideas.data.issues" :key="x.id" data-testid="ideas-issue"><code>{{ x.code }}</code> · <code>{{ x.id }}</code></li>
          </ul>
          <p v-if="ideas.data.truncated" class="muted" data-testid="ideas-truncated">The list was cut at the display limit.</p>
        </div>
        <p v-if="items.length === 0" class="empty" data-testid="ideas-empty">No ideas recorded.</p>
        <template v-else>
          <div class="navigator">
            <div class="nav-controls">
              <label class="nav-search">
                <span class="sr-only">Search ideas</span>
                <input v-model="query" type="search" placeholder="Search ideas by id, title, text or tag…" autocomplete="off" data-testid="ideas-search" />
              </label>
              <label>
                Status
                <select v-model="statusFilter" data-testid="ideas-status">
                  <option value="all">all</option>
                  <option value="inbox">inbox</option>
                  <option value="planned">planned</option>
                  <option value="archived">archived</option>
                </select>
              </label>
              <button v-if="query !== ''" type="button" class="btn" data-testid="ideas-search-clear" @click="list.clear">Clear</button>
            </div>
          </div>
          <p v-if="filtered.length === 0" class="empty" role="status" data-testid="ideas-no-results">No ideas match the filter.</p>
          <ul v-else class="cards" data-testid="ideas-list">
            <li v-for="i in visible" :key="i.id" class="card" data-testid="idea">
              <div class="card-head">
                <code>{{ i.id }}</code>
                <span class="tag" data-testid="idea-status">{{ i.status }}</span>
              </div>
              <h3>{{ i.title }}</h3>
              <p class="muted">Captured <time>{{ i.createdAt }}</time> · <code>{{ safeDocPath(i.path) ?? 'PATH REJECTED' }}</code></p>
              <button type="button" class="btn" :aria-expanded="selectedId === i.id" data-testid="idea-toggle" @click="toggle(i.id)">
                {{ selectedId === i.id ? 'Hide details' : 'Show details' }}
              </button>
              <div v-if="selected && selected.id === i.id" class="idea-detail" data-testid="idea-detail">
                <p class="idea-text" data-testid="idea-description">{{ i.description }}</p>
                <p v-if="i.descriptionTruncated" class="muted">The description was shortened; the full text is in the source file.</p>
                <p v-if="i.context" class="muted">Context: {{ i.context }}</p>
                <p v-if="i.tags.length > 0" class="muted">Tags: {{ i.tags.join(', ') }}</p>
                <p v-if="i.paths.length > 0" class="muted">Registered paths: {{ i.paths.join(', ') }}</p>
              </div>
            </li>
          </ul>
          <div v-if="filtered.length > 0" class="nav-footer">
            <p class="muted" data-testid="ideas-count">Showing {{ visible.length }} of {{ filtered.length }} ideas<template v-if="filtered.length !== items.length"> (filtered from {{ items.length }})</template></p>
            <button v-if="remaining > 0" type="button" class="btn" data-testid="ideas-more" @click="list.showMore">Show {{ Math.min(LIST_PAGE_SIZE, remaining) }} more</button>
          </div>
        </template>
      </template>
    </div>

    <div v-else role="tabpanel" data-testid="hypotheses-panel">
      <HypothesesPanel embedded :items="hypotheses" :info="hypothesesInfo" :demo="demo" />
    </div>
  </section>
</template>
