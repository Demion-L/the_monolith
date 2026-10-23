<script setup lang="ts">
defineProps<{ text: string | null }>();
</script>

<template>
  <section id="roadmap" class="panel" aria-labelledby="roadmap-h">
    <h2 id="roadmap-h">Roadmap</h2>
    <p v-if="text === null" class="empty"><span class="unknown">NOT AVAILABLE</span></p>
    <p v-else-if="text.trim() === ''" class="empty">Roadmap is empty.</p>
    <!-- Plain text interpolation only: Vue escapes it, <pre> keeps line breaks. -->
    <pre v-else class="roadmap" data-testid="roadmap-text">{{ text }}</pre>
  </section>
</template>
