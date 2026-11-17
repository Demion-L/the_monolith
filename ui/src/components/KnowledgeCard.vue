<script setup lang="ts">
import { computed } from 'vue';
import { describeStatus, safeDocPath } from '../knowledge';
import type { KnowledgeItem } from '../types/dashboard';
import ValueOrUnknown from './ValueOrUnknown.vue';

const props = defineProps<{ item: KnowledgeItem; kind: 'hypothesis' | 'adr' }>();

const status = computed(() => describeStatus(props.kind, props.item.status));
const path = computed(() => safeDocPath(props.item.path));
const hasDetails = computed(
  () => props.item.summary !== null || props.item.path !== null
    || (props.item.supersededBy?.length ?? 0) > 0 || (props.item.supersedes?.length ?? 0) > 0,
);
</script>

<template>
  <li class="card knowledge" data-testid="knowledge-item">
    <div class="card-head">
      <code data-testid="knowledge-id"><ValueOrUnknown :value="item.id" /></code>
      <span v-if="status" class="tag" :class="`tone-${status.tone}`" data-testid="knowledge-status">
        {{ status.label }}<template v-if="!status.recognized"> (unrecognized status)</template>
      </span>
      <span v-else class="unknown" data-testid="knowledge-status">STATUS UNKNOWN</span>
    </div>
    <h3 class="knowledge-title" data-testid="knowledge-title"><ValueOrUnknown :value="item.title" /></h3>
    <p v-if="item.summary" class="knowledge-summary muted">{{ item.summary }}</p>
    <details v-if="hasDetails" class="knowledge-details">
      <summary>Details</summary>
      <dl class="facts">
        <template v-if="item.summary">
          <dt>Summary</dt>
          <dd class="knowledge-full" data-testid="knowledge-full">{{ item.summary }}</dd>
        </template>
        <dt>Source document</dt>
        <dd data-testid="knowledge-path">
          <code v-if="path">{{ path }}</code>
          <span v-else-if="item.path !== null" class="unknown">PATH REJECTED (not a project-relative path)</span>
          <span v-else class="unknown">UNKNOWN</span>
        </dd>
        <template v-if="item.supersededBy?.length">
          <dt>Superseded by (as declared)</dt>
          <dd data-testid="knowledge-superseded-by">{{ item.supersededBy.join(', ') }}</dd>
        </template>
        <template v-if="item.supersedes?.length">
          <dt>Supersedes (as declared)</dt>
          <dd data-testid="knowledge-supersedes">{{ item.supersedes.join(', ') }}</dd>
        </template>
      </dl>
    </details>
    <p v-else class="muted" data-testid="knowledge-nodetails">No further details in the source.</p>
  </li>
</template>
