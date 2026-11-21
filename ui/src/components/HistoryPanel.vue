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

// Long final summaries are clamped in the card; the full text stays in the page and one click shows it. View state only.
const LONG_SUMMARY = 320;
const isLong = (t: string): boolean => t.length > LONG_SUMMARY;
const expanded = ref<Set<string>>(new Set());
function toggle(id: string): void {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}
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
        <div class="hist-toolbar" role="search" aria-label="Filter missions">
          <label class="hist-field hist-field-status">
            <span class="hist-field-k">Status</span>
            <select v-model="statusFilter" data-testid="history-status">
              <option value="all">All statuses</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label class="hist-field hist-field-search">
            <span class="hist-field-k">Search</span>
            <input v-model="query" type="search" data-testid="history-search" placeholder="Mission id, title, summary or story" />
          </label>
          <p class="hist-shown muted" data-testid="history-shown">Showing {{ shown.length }} of {{ data.missions.length }}</p>
        </div>
        <p v-if="shown.length === 0" class="empty" data-testid="history-no-match">No mission matches the filter.</p>
        <ul class="hist-list">
          <li v-for="m in shown" :key="m.id" class="card hist-card" :data-status="m.status" data-testid="history-mission">
            <header class="hist-head">
              <code class="hist-id">{{ m.id }}</code>
              <StatusPill :tone="STATUS_TONE[m.status]" :label="STATUS_LABEL[m.status]" />
            </header>
            <h3 class="hist-title">{{ m.title }}</h3>
            <p class="hist-meta" data-testid="history-story">
              <span class="hist-meta-k">Story</span>
              <code v-if="m.storyId !== null" class="hist-chip">{{ m.storyId }}</code>
              <span v-else class="hist-nostory">none recorded</span>
              <span class="hist-meta-sep" aria-hidden="true">·</span>
              <span class="hist-meta-k">System</span>
              <span class="hist-chip hist-chip-plain">{{ m.system }}</span>
            </p>
            <p v-if="m.owner" class="hist-meta" data-testid="history-owner" :title="`Recorded owner (coordination metadata, not authentication). Worktree: ${m.owner.worktree}`">
              <span class="hist-meta-k">Owner</span>
              <span class="hist-chip hist-chip-plain">{{ m.owner.agent }}</span>
              <span class="hist-meta-sep" aria-hidden="true">·</span>
              <span class="hist-meta-k">Worktree</span>
              <code class="hist-chip">{{ m.owner.worktree.split('/').filter(Boolean).pop() }}</code>
              <template v-if="m.owner.branch"><span class="hist-meta-sep" aria-hidden="true">·</span><span class="hist-meta-k">Branch</span><code class="hist-chip">{{ m.owner.branch }}</code></template>
            </p>

            <h4 class="hist-section">Timeline</h4>
            <ol class="hist-timeline" data-testid="history-timeline">
              <li class="hist-event ev-started" data-testid="history-event">
                <span class="hist-dot" aria-hidden="true"></span>
                <div class="hist-event-body">
                  <span class="tag hist-badge">STARTED</span> <time class="hist-time">{{ m.startedAt }}</time>
                </div>
              </li>
              <li v-for="c in m.checkpoints" :key="c.id" class="hist-event ev-checkpoint" data-testid="history-event">
                <span class="hist-dot" aria-hidden="true"></span>
                <div class="hist-event-body">
                  <span class="tag hist-badge">CHECKPOINT</span> <code class="hist-ckpt-id">{{ c.id }}</code> <time class="hist-time">{{ c.createdAt }}</time>
                  <div class="hist-ckpt-sum">{{ c.summary }}</div>
                  <details v-if="c.remainingSteps.length > 0 || c.context" class="hist-details">
                    <summary>Details</summary>
                    <p v-if="c.context" class="muted">{{ c.context }}</p>
                    <h5>Remaining steps <span class="tag">historical record as of this checkpoint, not the current plan</span></h5>
                    <ul>
                      <li v-for="(st, i) in c.remainingSteps" :key="i">{{ st }}</li>
                    </ul>
                  </details>
                </div>
              </li>
              <li v-if="m.checkpointsTruncated" class="hist-note muted" data-testid="history-ckpt-truncated">
                Showing the first {{ m.checkpoints.length }} of {{ m.checkpointCount }} checkpoints.
              </li>
              <li v-if="m.status !== 'in_progress'" class="hist-event" :class="`ev-${m.status}`" data-testid="history-event">
                <span class="hist-dot" aria-hidden="true"></span>
                <div class="hist-event-body">
                  <span class="tag hist-badge">{{ STATUS_LABEL[m.status] }}</span> <time class="hist-time">{{ m.updatedAt }}</time>
                </div>
              </li>
            </ol>
            <p v-if="m.checkpointCount === 0" class="hist-info" data-testid="history-no-checkpoints">No checkpoints recorded.</p>

            <section class="hist-result" :class="{ 'hist-result-empty': m.summary === null }" aria-label="Final summary">
              <h4 class="hist-section">Final summary</h4>
              <template v-if="m.summary !== null">
                <p class="hist-summary" :class="{ 'hist-clamp': isLong(m.summary) && !expanded.has(m.id) }" data-testid="history-summary">{{ m.summary }}</p>
                <button v-if="isLong(m.summary)" type="button" class="hist-toggle" :aria-expanded="expanded.has(m.id)" data-testid="history-summary-toggle" @click="toggle(m.id)">
                  {{ expanded.has(m.id) ? 'Show less' : 'Show full summary' }}
                </button>
              </template>
              <p v-else class="muted hist-summary" data-testid="history-summary">{{ m.status === 'in_progress' ? 'Not finished yet.' : 'No final summary recorded.' }}</p>
            </section>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>
