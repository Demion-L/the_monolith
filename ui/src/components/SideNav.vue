<script setup lang="ts">
import { ref } from 'vue';
import SkinSwitcher from './SkinSwitcher.vue';

// Section anchors exist only while a dashboard is rendered, so the links follow `sections`.
defineProps<{ sections: boolean }>();

const links = [
  { href: '#overview', label: 'Project Overview' },
  { href: '#mission', label: 'Current Mission' },
  { href: '#checkpoints', label: 'Checkpoints' },
  { href: '#roadmap', label: 'Roadmap' },
  { href: '#diagnostics', label: 'Diagnostics' },
];

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
        <a v-for="link in links" :key="link.href" :href="link.href" @click="open = false">{{ link.label }}</a>
      </nav>
      <SkinSwitcher />
    </div>
  </aside>
</template>
