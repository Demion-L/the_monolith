<script setup lang="ts">
import { ref } from 'vue';
import { currentSkin, isSkinId, setSkin, SKINS } from '../skin';
import type { SkinId } from '../skin';

const labels: Record<SkinId, string> = {
  classic: 'Classic',
  'cosmic-glass': 'Cosmic Glass',
};

const selected = ref<SkinId>(currentSkin());

function onChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (!isSkinId(value)) return;
  selected.value = value;
  setSkin(value);
}
</script>

<template>
  <label class="skin-switcher">
    Skin
    <select :value="selected" data-testid="skin-select" aria-label="Skin" @change="onChange">
      <option v-for="id in SKINS" :key="id" :value="id">{{ labels[id] }}</option>
    </select>
  </label>
</template>

<style scoped>
.skin-switcher { color: var(--muted); font-size: 13px; display: flex; gap: 6px; align-items: center; }
.skin-switcher select {
  background: var(--surface-2); color: var(--text);
  border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px;
}
</style>
