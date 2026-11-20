<script setup lang="ts">
import { computed } from 'vue';
import type { DoneSlot, LastCompleted, NextStep } from '../continuity';
import type { SectionId } from '../sections';

/**
 * Last Completed Work + What's Next (UX-003). Presentation only: both are computed in `continuity.ts`
 * from Core's records; nothing here is a verified fact or an AI plan. A completed mission, a finalized
 * story and a completed phase are three independent facts and are shown as such.
 */
const props = defineProps<{ last: LastCompleted; next: NextStep }>();
const emit = defineEmits<{ (e: 'navigate', id: SectionId): void }>();

const slots = computed<{ key: string; label: string; slot: DoneSlot; testid: string }[]>(() => [
  { key: 'mission', label: 'Completed mission', slot: props.last.mission, testid: 'last-mission' },
  { key: 'story', label: 'Finalized story', slot: props.last.story, testid: 'last-story' },
  { key: 'phase', label: 'Completed phase', slot: props.last.phase, testid: 'last-phase' },
]);
const KIND_TAG: Record<NextStep['kind'], string> = {
  continue_mission: 'ACTIVE MISSION',
  continue_story: 'ACTIVE STORY',
  resolve_conflict: 'NEEDS ATTENTION',
  continue_phase: 'IN PROGRESS',
  next_phase: 'NEXT PHASE',
  no_next: 'NOTHING PLANNED',
  start: 'GETTING STARTED',
  unknown: 'UNKNOWN',
};
</script>

<template>
  <div class="mc-grid mc-continuity">
    <div class="ov-block mc-card mc-last" data-testid="ov-last-completed">
      <h3 class="mc-eyebrow">Last completed work</h3>
      <ul class="mc-done-list">
        <li v-for="s in slots" :key="s.key" :data-testid="s.testid" :data-kind="s.slot.kind">
          <span class="mc-done-k">{{ s.label }}</span>
          <template v-if="s.slot.kind === 'found'">
            <span class="mc-done-title"><code>{{ s.slot.item.id }}</code><template v-if="s.slot.item.title"> — {{ s.slot.item.title }}</template></span>
            <span class="mc-done-meta">
              <span class="mc-done-status">{{ s.slot.item.status }}</span>
              · <time v-if="s.slot.item.at !== null">{{ s.slot.item.at }}</time><span v-else class="muted">date not reported</span>
              · <span class="muted" data-testid="last-source">{{ s.slot.item.source }}</span>
            </span>
            <span v-if="s.slot.note" class="muted mc-done-note">{{ s.slot.note }}</span>
          </template>
          <span v-else-if="s.slot.kind === 'unknown'" class="mc-done-unknown mc-done-title">UNKNOWN — {{ s.slot.text }}</span>
          <span v-else class="muted mc-done-title">{{ s.slot.text }}</span>
        </li>
      </ul>
      <p class="muted mc-note">Three independent facts: a completed mission does not finalize a story, and a finalized story does not complete a phase.</p>
      <p class="mc-actions">
        <button type="button" class="mc-link" data-testid="last-go-history" @click="emit('navigate', 'history')">Open Development History</button>
      </p>
    </div>

    <div class="ov-block mc-card mc-next" :data-next-kind="next.kind" data-testid="ov-next">
      <h3 class="mc-eyebrow">What's next?</h3>
      <p><span class="mc-next-tag" :class="`mc-next-${next.kind}`" data-testid="next-kind">{{ KIND_TAG[next.kind] }}</span></p>
      <p class="mc-next-head" data-testid="next-headline">{{ next.headline }}</p>
      <p class="mc-next-reason" data-testid="next-reason">{{ next.reason }}</p>
      <p class="muted mc-note" data-testid="next-source">Source: {{ next.source }}. A suggestion from the recorded data, not a plan.</p>
      <p class="mc-actions">
        <button v-for="a in next.actions" :key="a.target" type="button" class="mc-link" :data-testid="`next-go-${a.target}`" @click="emit('navigate', a.target)">{{ a.label }}</button>
      </p>
    </div>
  </div>
</template>
