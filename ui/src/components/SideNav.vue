<script setup lang="ts">
import { ref } from 'vue';
import { SECTIONS } from '../sections';
import type { SectionId } from '../sections';
import SkinSwitcher from './SkinSwitcher.vue';

// Section links exist only while a dashboard is rendered, so they follow `sections`.
defineProps<{ sections: boolean; active?: SectionId }>();
const emit = defineEmits<{ select: [id: SectionId] }>();

// Plain left clicks switch the section in place; modified clicks keep the browser's
// default (e.g. open the #hash URL in a new tab).
function choose(event: MouseEvent, id: SectionId): void {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  emit('select', id);
  open.value = false;
}

// Only meaningful on narrow screens; on desktop the panel is always visible.
const open = ref(false);
const toggle = ref<HTMLButtonElement | null>(null);

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open.value) {
    open.value = false;
    toggle.value?.focus();
  }
}
</script>

<template>
  <aside class="sidebar" :class="{ open }" @keydown="onKeydown">
    <div class="sidebar-head">
      <div class="brand">
        <strong>MONOLITH</strong>
        <span class="muted">Mission Control</span>
      </div>
      <button
        ref="toggle"
        type="button"
        class="nav-toggle"
        data-testid="nav-toggle"
        aria-controls="sidebar-panel"
        :aria-expanded="open"
        @click="open = !open"
      >
        {{ open ? 'Close menu' : 'Menu' }}
      </button>
    </div>
    <div id="sidebar-panel" class="sidebar-panel" data-testid="sidebar-panel">
      <nav v-if="sections" class="nav" aria-label="Sections">
        <a
          v-for="link in SECTIONS"
          :key="link.id"
          :href="`#${link.id}`"
          :aria-current="link.id === active ? 'location' : undefined"
          @click="choose($event, link.id)"
          >{{ link.label }}</a
        >
      </nav>
      <SkinSwitcher />
    </div>
  </aside>
</template>
