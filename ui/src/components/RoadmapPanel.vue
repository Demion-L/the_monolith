<script setup lang="ts">
import { computed } from 'vue';
import type { RoadmapDiagnosticCode, StructuredRoadmapView } from '../types/dashboard';

const props = defineProps<{ text: string | null; structured?: StructuredRoadmapView }>();

// Fixed labels for Core's fixed diagnostic codes. Nothing from the document is echoed here.
const DIAGNOSTIC_LABELS: Record<RoadmapDiagnosticCode, string> = {
  DOCUMENT_EMPTY: 'The roadmap document is empty.',
  PHASES_SECTION_MISSING: 'No "Phases" section was found.',
  PHASES_SECTION_DUPLICATED: 'More than one "Phases" section; only the first was read.',
  NO_PHASES_FOUND: 'The "Phases" section contains no recognisable phase.',
  PHASE_HEADING_MALFORMED: 'A phase heading could not be read and was skipped.',
  PHASES_TRUNCATED: 'Too many phases; the list was truncated.',
  PHASE_STATUS_MISSING: 'The phase states no status.',
  PHASE_STATUS_EMPTY: 'The phase has an empty status field.',
  PHASE_STATUS_CONFLICT: 'The phase states contradicting statuses; none is shown.',
  PHASE_STATUS_UNRECOGNIZED: 'The phase status is not a recognised value.',
  PHASE_DETAILS_TRUNCATED: 'The phase details were truncated.',
  PHASE_ID_DUPLICATE: 'The phase id is used more than once.',
  ACTIVE_PHASE_CONFLICT: 'The document names different active phases.',
  ACTIVE_PHASE_UNMATCHED: 'The active-phase pointer names no recognised phase.',
  ACTIVE_PHASE_AMBIGUOUS_ID: 'The active-phase pointer names a duplicated phase id.',
  ACTIVE_PHASE_REPORTED_COMPLETE: 'The active phase reports itself as complete.',
  INTERNAL: 'The roadmap could not be interpreted (internal error).',
};

const STATE_MESSAGES: Record<'empty' | 'no_phases' | 'unrecognized' | 'error', string> = {
  empty: 'The roadmap document is available but empty.',
  no_phases: 'The roadmap document has a "Phases" section, but no phase could be read from it.',
  unrecognized: 'The roadmap document is available, but its structure was not recognised.',
  error: 'The roadmap could not be interpreted. The structure below is unavailable; see the original Markdown.',
};

const ACTIVE_NOTES: Record<string, string> = {
  none: 'The document states that there is no active phase.',
  not_declared: 'The document does not declare an active phase.',
  unmatched: 'The document points to an active phase that is not among the recognised phases.',
  ambiguous: 'The document\'s active-phase indication is ambiguous or contradictory; no phase is marked active.',
};

const view = computed(() => props.structured);
const activeId = computed(() => (view.value?.activePhase.kind === 'phase' ? view.value.activePhase.id : null));
const activeNote = computed(() => {
  const k = view.value?.activePhase.kind;
  return k === undefined || k === 'phase' ? null : ACTIVE_NOTES[k];
});
const hasPhases = computed(() => (view.value?.phases.length ?? 0) > 0);
const stateMessage = computed(() => {
  const st = view.value?.state;
  return st === 'empty' || st === 'no_phases' || st === 'unrecognized' || st === 'error' ? STATE_MESSAGES[st] : null;
});

function heading(p: { id: string | null; title: string | null }): string {
  const id = p.id === null ? '' : `Phase ${p.id}`;
  if (p.title === null) return id === '' ? 'Untitled phase' : id;
  return id === '' ? p.title : `${id} · ${p.title}`;
}
</script>

<template>
  <section id="roadmap" class="panel" aria-labelledby="roadmap-h">
    <h2 id="roadmap-h">Roadmap</h2>

    <!-- Source unavailable: nothing structured is shown as if it were reliable. -->
    <p v-if="text === null" class="empty"><span class="unknown">NOT AVAILABLE</span></p>

    <!-- Legacy DTO / demo: no structured field. Fall back to the raw text; no phases are invented. -->
    <template v-else-if="structured === undefined">
      <p v-if="text.trim() !== ''" class="muted" data-testid="roadmap-legacy">
        Structured roadmap is not provided by this data source; showing the original Markdown.
      </p>
      <p v-if="text.trim() === ''" class="empty">Roadmap is empty.</p>
      <!-- Plain text interpolation only: Vue escapes it, <pre> keeps line breaks. -->
      <pre v-else class="roadmap" data-testid="roadmap-text">{{ text }}</pre>
    </template>

    <template v-else>
      <p v-if="stateMessage" class="empty" role="status" data-testid="roadmap-state">
        <span class="unknown">{{ structured.state.toUpperCase().replace('_', ' ') }}</span> {{ stateMessage }}
      </p>
      <p v-else-if="structured.state === 'partial'" class="muted" role="status" data-testid="roadmap-state">
        <span class="unknown">PARTIAL</span> Only part of the roadmap could be read; see the diagnostics and the original Markdown.
      </p>

      <p v-if="hasPhases && activeNote" class="muted" data-testid="roadmap-active-note">{{ activeNote }}</p>

      <ol v-if="hasPhases" class="phases" data-testid="roadmap-phases">
        <li
          v-for="(p, i) in structured.phases"
          :key="i"
          class="phase"
          :class="{ 'phase-active': p.id !== null && p.id === activeId }"
          data-testid="roadmap-phase"
        >
          <h3 class="phase-title">{{ heading(p) }}</h3>
          <p class="phase-meta">
            <span v-if="p.status.value !== null" class="status-badge" :class="{ 'status-unrecognized': !p.status.recognized }" data-testid="phase-status">
              {{ p.status.value }} · REPORTED<template v-if="!p.status.recognized"> · UNRECOGNIZED</template>
            </span>
            <span v-else class="status-badge status-unrecognized" data-testid="phase-status">STATUS NOT STATED</span>
            <span v-if="p.id !== null && p.id === activeId" class="tag" data-testid="phase-active">ACTIVE</span>
          </p>
          <p v-if="p.goal !== null" class="phase-goal" data-testid="phase-goal"><span class="muted">Goal:</span> {{ p.goal }}<span v-if="p.goalTruncated === true" class="tag tag-neutral" data-testid="goal-truncated"> Truncated</span></p>
          <details v-if="p.details !== null" class="phase-details" data-testid="phase-details">
            <summary>Details</summary>
            <pre class="roadmap">{{ p.details }}</pre>
          </details>
        </li>
      </ol>

      <ul v-if="structured.diagnostics.length > 0" class="diag roadmap-diag" data-testid="roadmap-diagnostics">
        <li v-for="(d, i) in structured.diagnostics" :key="i" :class="d.severity === 'warn' ? 'sev-warning' : 'sev-info'">
          <span class="sev">{{ d.severity === 'warn' ? 'warn' : 'info' }}</span>
          <template v-if="d.phaseIndex !== null && structured.phases[d.phaseIndex]">{{ heading(structured.phases[d.phaseIndex]) }}: </template>{{ DIAGNOSTIC_LABELS[d.code] ?? d.code }}
        </li>
      </ul>

      <details class="raw" data-testid="roadmap-raw">
        <summary>View original Markdown</summary>
        <pre class="roadmap" data-testid="roadmap-text">{{ text }}</pre>
      </details>
    </template>
  </section>
</template>
