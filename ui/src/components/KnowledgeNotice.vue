<script setup lang="ts">
import { computed } from 'vue';
import { safeDocPath } from '../knowledge';
import type { KnowledgeInfo } from '../types/dashboard';

// Source state and issues exactly as Core reported them (fixed codes + project-relative paths). Nothing is derived here.
const props = defineProps<{ info?: KnowledgeInfo }>();
const unreadable = computed(() => props.info === undefined || props.info.availability !== 'available');
</script>

<template>
  <div v-if="unreadable" class="empty" role="status" data-testid="knowledge-unavailable">
    <template v-if="info && info.availability === 'error'">
      <span class="unknown">ERROR</span> The source exists but could not be read or interpreted<template v-if="info.code"> [{{ info.code }}]</template>. Nothing is shown rather than a partial list.
    </template>
    <template v-else><span class="unknown">NOT AVAILABLE</span> The source document was not found.</template>
  </div>
  <div v-else-if="info" class="notice" role="status" data-testid="knowledge-issues">
    <p v-if="!info.complete" class="muted" data-testid="knowledge-incomplete">
      <span class="unknown">INCOMPLETE</span> Some documents could not be interpreted; this list may not show every record.
    </p>
    <ul class="issues">
      <li v-for="(it, i) in info.issues" :key="i" data-testid="knowledge-issue">
        <code>{{ it.code }}</code>
        <template v-if="it.id"> · <code>{{ it.id }}</code></template>
        <template v-if="it.path"> — <code>{{ safeDocPath(it.path) ?? 'PATH REJECTED' }}</code></template>
        <span class="muted"> ({{ it.severity }})</span>
      </li>
    </ul>
  </div>
</template>
