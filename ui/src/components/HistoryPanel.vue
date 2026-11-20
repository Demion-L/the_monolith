<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DevelopmentHistory, HistoryMissionView, Section } from '../types/dashboard';
import StatusPill from './StatusPill.vue';
import type { Tone } from './StatusPill.vue';

/**
 * Development History (GOV-EVOLUTION Phase 3). Presentation only: every fact is a Core
 * read-model field shown as recorded. A missing checkpoint, summary or story link is
 * stated as missing; nothing is inferred, merged or reordered by time.
 */
const props = defineProps<{ history: Section<DevelopmentHistory> }>();

const STATUS_TONE: Record<HistoryMissionView['status'], Tone> = {
  in_progress: 'info',
  completed: 'ok',
  failed: 'err',
  cancelled: 'neutral',
};
const STATUS_LABEL: Record<HistoryMissionView['status'], string> = {
  in_progress: 'IN PROGRESS',
  completed: 'COMPLETED',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
};

const statusFilter = ref<'all' | HistoryMissionView['status']>('all');
const query = ref('');

const data = computed(() => props.history.data);
const unavailableReason = computed(() => {
  const s = props.history.sources[0];
  return s ? `${s.status}${s.code ? ` [${s.code}]` : ''}` : 'unknown';
});

const shown = computed(() => {
  const d = data.value;
  if (d === null) return [];
  const q = query.value.trim().toLowerCase();
  return d.missions.filter((m) => {
    if (statusFilter.value !== 'all' && m.status !== statusFilter.value) return false;
    if (q === '') return true;
    return [m.id, m.title, m.summary ?? '', m.storyId ?? '', m.system].some((t) => t.toLowerCase().includes(q));
  });
});
</script>

<template>
  <section id="history" class="panel" aria-labelledby="history-h">
    <h2 id="history-h">Development History</h2>
    <p class="muted">Missions and checkpoints as recorded in the operational state. Nothing is inferred.</p>

    <p v-if="data === null" class="empty" role="status" data-testid="history-unavailable">
      <span class="unknown">NOT AVAILABLE</span> The mission state could not be read ({{ unavailableReason }}).
    </p>
    <template v-else>
      <p class="muted" data-testid="history-counts">
        {{ data.totalMissions }} {{ data.totalMissions === 1 ? 'mission' : 'missions' }}
        ({{ data.counts.in_progress }} in progress, {{ data.counts.completed }} completed, {{ data.counts.failed }} failed,
        {{ data.counts.cancelled }} cancelled) · {{ data.totalCheckpoints }} recorded
        {{ data.totalCheckpoints === 1 ? 'checkpoint' : 'checkpoints' }}
      </p>
      <p v-if="data.truncated" class="empty" role="status" data-testid="history-truncated">
        <span class="unknown">INCOMPLETE</span> Only the {{ data.missions.length }} most recent missions of {{ data.totalMissions }} are listed.
      </p>
      <p v-if="data.orphanCheckpoints > 0" class="muted" data-testid="history-orphans">
        {{ data.orphanCheckpoints }} recorded {{ data.orphanCheckpoints === 1 ? 'checkpoint belongs' : 'checkpoints belong' }} to no recorded mission and
        {{ data.orphanCheckpoints === 1 ? 'is' : 'are' }} not shown.
      </p>

      <p v-if="data.totalMissions === 0" class="empty" data-testid="history-empty">No missions recorded.</p>
      <template v-else>
        <div class="list-controls">
          <label>
            Status
            <select v-model="statusFilter" data-testid="history-status">
              <option value="all">all</option>
              <option value="in_progress">in progress</option>
              <option value="completed">completed</option>
              <option value="failed">failed</option>
              <option value="cancelled">cancelled</option>
            </select>
          </label>
          <label>
            Search
            <input v-model="query" type="search" data-testid="history-search" placeholder="id, title, summary, story" />
          </label>
        </div>
        <p v-if="shown.length === 0" class="empty" data-testid="history-no-match">No mission matches the filter.</p>
        <ul class="cards">
          <li v-for="m in shown" :key="m.id" class="card" data-testid="history-mission">
            <div class="card-head">
              <code>{{ m.id }}</code>
              <StatusPill :tone="STATUS_TONE[m.status]" :label="STATUS_LABEL[m.status]" />
            </div>
            <h3>{{ m.title }}</h3>
            <p class="muted" data-testid="history-story">
              Story:
              <code v-if="m.storyId !== null">{{ m.storyId }}</code>
              <template v-else>none recorded</template>
              · system {{ m.system }}
            </p>

            <h4>Timeline</h4>
            <ol class="timeline" data-testid="history-timeline">
              <li data-testid="history-event">
                <span class="tag">STARTED</span> <time>{{ m.startedAt }}</time>
              </li>
              <li v-for="c in m.checkpoints" :key="c.id" data-testid="history-event">
                <span class="tag">CHECKPOINT</span> <code>{{ c.id }}</code> <time>{{ c.createdAt }}</time>
                <div>{{ c.summary }}</div>
                <details v-if="c.remainingSteps.length > 0 || c.context">
                  <summary>Details</summary>
                  <p v-if="c.context" class="muted">{{ c.context }}</p>
                  <h5>Remaining steps <span class="tag">historical record as of this checkpoint, not the current plan</span></h5>
                  <ul>
                    <li v-for="(s, i) in c.remainingSteps" :key="i">{{ s }}</li>
                  </ul>
                </details>
              </li>
              <li v-if="m.checkpointCount === 0" class="muted" data-testid="history-no-checkpoints">No checkpoints recorded.</li>
              <li v-if="m.checkpointsTruncated" class="muted" data-testid="history-ckpt-truncated">
                Showing the first {{ m.checkpoints.length }} of {{ m.checkpointCount }} checkpoints.
              </li>
              <li v-if="m.status !== 'in_progress'" data-testid="history-event">
                <span class="tag">{{ STATUS_LABEL[m.status] }}</span> <time>{{ m.updatedAt }}</time>
              </li>
            </ol>

            <h4>Final summary</h4>
            <p v-if="m.summary !== null" data-testid="history-summary">{{ m.summary }}</p>
            <p v-else class="muted" data-testid="history-summary">{{ m.status === 'in_progress' ? 'Not finished yet.' : 'No final summary recorded.' }}</p>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>
