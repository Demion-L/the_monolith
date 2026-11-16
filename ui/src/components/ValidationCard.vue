<script setup lang="ts">
import { computed } from 'vue';
import type { ValidationResultDto } from '../../../src/readmodel/diagnostics-types';
import type { DiagnosticRunner } from '../live/diagnostics';
import { formatTime } from '../live/time';
import StatusPill from './StatusPill.vue';
import type { Tone } from './StatusPill.vue';

const props = defineProps<{ runner: DiagnosticRunner<ValidationResultDto> }>();

/** What each existing check establishes, in plain words. */
const ABOUT: Record<string, string> = {
  configuration: 'monolith.config.json and project.definition.mjs are present and safe to read. The definition file is not executed.',
  instance: 'The MONOLITH directory exists and has its required folders.',
  templates: 'No placeholders from project setup were left unreplaced.',
};

const view = computed((): { label: string; tone: Tone } => {
  const s = props.runner.state;
  if (s.status === 'idle') return { label: 'NOT RUN', tone: 'neutral' };
  if (s.status === 'running') return { label: 'RUNNING', tone: 'info' };
  if (s.status === 'error') return { label: 'ERROR', tone: 'err' };
  return s.result.result === 'PASS' ? { label: 'PASS', tone: 'ok' } : { label: 'FAIL', tone: 'err' };
});
const running = computed(() => props.runner.state.status === 'running');
const done = computed(() => (props.runner.state.status === 'done' ? props.runner.state : null));
const passedCount = computed(() => done.value?.result.checks.filter((c) => c.passed).length ?? 0);
const lastRun = computed(() => {
  const s = props.runner.state;
  return s.status === 'done' || s.status === 'error' ? formatTime(s.at) : null;
});
</script>

<template>
  <article class="dcard" data-testid="validation-card" aria-labelledby="validation-h" :aria-busy="running">
    <header class="dcard-head">
      <h3 id="validation-h">Project validation</h3>
      <StatusPill :tone="view.tone" :label="view.label" />
    </header>
    <p class="muted dcard-q">Did the project pass MONOLITH's existing checks?</p>

    <p v-if="runner.state.status === 'idle'" class="empty" data-testid="validation-idle">
      Not run in this session. Source availability is not a validation result.
    </p>
    <p v-else-if="runner.state.status === 'running'" role="status" data-testid="validation-running">Checking the project…</p>
    <p v-else-if="runner.state.status === 'error'" role="alert" class="dcard-error" data-testid="validation-error">
      The validation could not be run. {{ runner.state.message }}
    </p>

    <template v-if="done">
      <p class="dcard-summary" data-testid="validation-summary">
        {{ passedCount }} of {{ done.result.checks.length }} checks passed
      </p>
      <ul class="checks">
        <li v-for="c in done.result.checks" :key="c.id" :class="c.passed ? 'check-pass' : 'check-fail'" data-testid="validation-check">
          <div class="check-row">
            <strong>{{ c.label }}</strong>
            <StatusPill :tone="c.passed ? 'ok' : 'err'" :label="c.passed ? 'PASS' : 'FAIL'" />
          </div>
          <p class="muted check-about">{{ ABOUT[c.id] }}</p>
          <p v-if="c.message !== null" class="check-reason" data-testid="validation-reason">Problem: {{ c.message }}</p>
        </li>
      </ul>
      <details v-if="done.result.checks.some((c) => c.note !== null) || done.result.warning !== null" class="more">
        <summary>Details</summary>
        <p v-for="c in done.result.checks.filter((x) => x.note !== null)" :key="c.id" class="muted">{{ c.label }}: {{ c.note }}</p>
        <p v-if="done.result.warning !== null" class="muted">Warning: {{ done.result.warning }}</p>
      </details>
    </template>

    <footer class="dcard-foot">
      <button type="button" data-testid="run-validation" :disabled="running" @click="runner.run()">
        {{ running ? 'Running…' : runner.state.status === 'idle' ? 'Run Validation' : 'Run Validation again' }}
      </button>
      <span v-if="lastRun" class="muted" data-testid="validation-time">Last run {{ lastRun }}</span>
    </footer>
  </article>
</template>
