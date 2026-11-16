<script setup lang="ts">
import { computed } from 'vue';
import type { ReconciliationResultDto } from '../../../src/readmodel/diagnostics-types';
import type { DiagnosticRunner } from '../live/diagnostics';
import { formatTime } from '../live/time';
import StatusPill from './StatusPill.vue';
import type { Tone } from './StatusPill.vue';

const props = defineProps<{ runner: DiagnosticRunner<ReconciliationResultDto> }>();

const EVIDENCE: Record<string, { tone: Tone; about: string }> = {
  COMPLETE: { tone: 'ok', about: 'The evidence needed to compare the sources could be gathered.' },
  INCOMPLETE: { tone: 'warn', about: 'Only part of the evidence could be gathered. Absence of findings proves little.' },
  UNKNOWN: { tone: 'neutral', about: 'Git history could not be compared with the state documents.' },
};
const FRESHNESS: Record<string, Tone> = { FRESH: 'ok', STALE: 'warn', UNKNOWN: 'neutral' };

const view = computed((): { label: string; tone: Tone } => {
  const s = props.runner.state;
  if (s.status === 'idle') return { label: 'NOT RUN', tone: 'neutral' };
  if (s.status === 'running') return { label: 'RUNNING', tone: 'info' };
  if (s.status === 'error') return { label: 'ERROR', tone: 'err' };
  return { label: s.result.evidence, tone: EVIDENCE[s.result.evidence].tone };
});
const running = computed(() => props.runner.state.status === 'running');
const done = computed(() => (props.runner.state.status === 'done' ? props.runner.state : null));
const nothingFound = computed(() => {
  const r = done.value?.result;
  return r !== undefined && r.conflicts.length === 0 && r.unrecordedWork.length === 0 && r.unattributed.length === 0 && r.evidenceIssues.length === 0;
});
const lastRun = computed(() => {
  const s = props.runner.state;
  return s.status === 'done' || s.status === 'error' ? formatTime(s.at) : null;
});
</script>

<template>
  <article class="dcard" data-testid="reconciliation-card" aria-labelledby="reconciliation-h" :aria-busy="running">
    <header class="dcard-head">
      <h3 id="reconciliation-h">State reconciliation</h3>
      <StatusPill :tone="view.tone" :label="view.label" />
    </header>
    <p class="muted dcard-q">Are there confirmed contradictions between the sources of project state?</p>

    <p v-if="runner.state.status === 'idle'" class="empty" data-testid="reconciliation-idle">Not run in this session.</p>
    <p v-else-if="runner.state.status === 'running'" role="status" data-testid="reconciliation-running">Comparing the state documents with git history…</p>
    <p v-else-if="runner.state.status === 'error'" role="alert" class="dcard-error" data-testid="reconciliation-error">
      The reconciliation could not be run. {{ runner.state.message }}
    </p>

    <template v-if="done">
      <dl class="facts compact">
        <dt>Evidence</dt>
        <dd data-testid="reconciliation-evidence">{{ done.result.evidence }} <span class="muted">— {{ EVIDENCE[done.result.evidence].about }}</span></dd>
        <dt>Freshness</dt>
        <dd data-testid="reconciliation-freshness">
          <StatusPill :tone="FRESHNESS[done.result.freshness]" :label="done.result.freshness" />
          <span v-if="done.result.lastStateUpdate" class="muted"> last state update {{ done.result.lastStateUpdate.sha }} ({{ done.result.lastStateUpdate.date }})</span>
        </dd>
      </dl>

      <p v-if="nothingFound" class="empty" data-testid="reconciliation-nothing">
        No discrepancy was found in the available evidence. This is not a guarantee that the state is correct.
      </p>

      <div v-if="done.result.conflicts.length > 0" class="rblock" data-testid="reconciliation-conflicts">
        <h4>Confirmed conflicts ({{ done.result.conflicts.length }})</h4>
        <article v-for="(c, i) in done.result.conflicts" :key="i" class="conflict" data-testid="conflict">
          <div class="conflict-title">STATE CONFLICT</div>
          <div v-if="c.sources.length > 0" class="conflict-sources">
            <div v-for="(s, j) in c.sources" :key="j" class="conflict-source">
              <code>{{ s.document }}</code>
              <span>{{ s.claim }}</span>
            </div>
          </div>
          <p v-else class="muted">{{ c.summary }}</p>
        </article>
      </div>

      <div v-if="done.result.unrecordedWork.length > 0" class="rblock" data-testid="reconciliation-unrecorded">
        <h4>Work in git that no state document mentions ({{ done.result.unrecordedWork.length }})</h4>
        <ul class="plain">
          <li v-for="u in done.result.unrecordedWork" :key="u.id">
            <strong>{{ u.id }}</strong> <span class="muted">{{ u.totalCommits }} commit(s). Referenced is not the same as complete.</span>
            <ul class="plain commits">
              <li v-for="c in u.commits" :key="c.sha"><code>{{ c.sha }}</code> {{ c.subject }}</li>
            </ul>
          </li>
        </ul>
      </div>

      <div v-if="done.result.unattributed.length > 0" class="rblock" data-testid="reconciliation-unattributed">
        <h4>Changes that cannot be attributed (not confirmed)</h4>
        <ul class="plain">
          <li v-for="(n, i) in done.result.unattributed" :key="i">
            {{ n.summary }}
            <ul v-if="n.evidence.length > 0" class="plain commits"><li v-for="(e, j) in n.evidence" :key="j"><code>{{ e }}</code></li></ul>
          </li>
        </ul>
      </div>

      <div v-if="done.result.evidenceIssues.length > 0" class="rblock" data-testid="reconciliation-issues">
        <h4>Evidence that is missing</h4>
        <ul class="plain">
          <li v-for="(n, i) in done.result.evidenceIssues" :key="i">{{ n.summary }}</li>
        </ul>
      </div>

      <div v-if="done.result.actions.length > 0" class="rblock" data-testid="reconciliation-actions">
        <h4>Suggested actions <span class="muted">(for a person to decide; none is applied)</span></h4>
        <ol class="plain"><li v-for="(a, i) in done.result.actions" :key="i">{{ a }}</li></ol>
      </div>

      <details class="more" data-testid="reconciliation-limitations">
        <summary>Limitations of this check ({{ done.result.limitations.length }})</summary>
        <ul class="plain"><li v-for="(l, i) in done.result.limitations" :key="i" class="muted">{{ l }}</li></ul>
        <p v-if="done.result.truncated" class="muted">Some lists were shortened to fit the display limit.</p>
      </details>
    </template>

    <footer class="dcard-foot">
      <button type="button" data-testid="run-reconciliation" :disabled="running" @click="runner.run()">
        {{ running ? 'Running…' : runner.state.status === 'idle' ? 'Run Reconciliation' : 'Run Reconciliation again' }}
      </button>
      <span v-if="lastRun" class="muted" data-testid="reconciliation-time">Last run {{ lastRun }}</span>
    </footer>
  </article>
</template>
