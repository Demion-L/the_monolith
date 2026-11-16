<script setup lang="ts">
export type Tone = 'ok' | 'err' | 'warn' | 'info' | 'neutral';
defineProps<{ tone: Tone; label: string }>();
</script>

<template>
  <!-- The word carries the meaning; colour only reinforces it. -->
  <span class="pill" :class="`pill-${tone}`" data-testid="pill">{{ label }}</span>
</template>
