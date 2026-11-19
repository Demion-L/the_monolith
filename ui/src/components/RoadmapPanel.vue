<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { statusBadgeTone } from '../knowledge';
import type { RoadmapDiagnosticCode, RoadmapPhaseView, Section, StoryIndexItemView, StructuredRoadmapView, StructuredStoryIndexView } from '../types/dashboard';

/** UI display limit. Independent of the parser capacity: every phase stays reachable. */
const PAGE_SIZE = 10;
/** Stable selection contract: `?phase=<phase id as in the read model>`. */
const PHASE_PARAM = 'phase';
type SortOrder = 'newest' | 'oldest';

const props = defineProps<{ text: string | null; structured?: StructuredRoadmapView; storyIndex?: Section<StructuredStoryIndexView> }>();

// Stories per phase: Core's own phase containment (`phase.kind === 'matched'`, strict id match) and nothing else.
// Statuses are the story index's REPORTED claims; no lifecycle is derived here and the roadmap text is never consulted.
const storiesByPhase = computed(() => {
  const map = new Map<string, StoryIndexItemView[]>();
  const d = props.storyIndex?.data;
  if (d === undefined || d === null || d.state === 'error' || d.state === 'unrecognized') return map;
  for (const st of d.stories) {
    if (st.phase.kind !== 'matched') continue;
    map.set(st.phase.phaseId, [...(map.get(st.phase.phaseId) ?? []), st]);
  }
  return map;
});
const storyIndexUsable = computed(() => {
  const d = props.storyIndex?.data;
  return d !== undefined && d !== null && d.state !== 'error' && d.state !== 'unrecognized';
});
function storiesOf(p: RoadmapPhaseView): StoryIndexItemView[] {
  return p.id === null || duplicateIds.value.has(p.id) ? [] : (storiesByPhase.value.get(p.id) ?? []);
}

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

// ---- Navigator state (view-only; never written back to the roadmap) ----
const query = ref('');
const sort = ref<SortOrder>('newest');
/** The rendered window is [windowStart, windowStart + visibleCount) of the filtered list: never the whole roadmap. */
const windowStart = ref(0);
const visibleCount = ref(PAGE_SIZE);
const selectedId = ref<string | null>(null);
const notice = ref<string | null>(null);

interface Entry { phase: RoadmapPhaseView; index: number; haystack: string }
// Document (Read Model) order is the only ordering truth: never a parse of phase numbers.
const entries = computed<Entry[]>(() =>
  (view.value?.phases ?? []).map((phase, index) => ({
    phase,
    index,
    haystack: `${phase.id ?? ''}\n${phase.id === null ? '' : `phase ${phase.id}`}\n${phase.title ?? ''}`.toLowerCase(),
  })),
);
const filtered = computed<Entry[]>(() => {
  const q = query.value.trim().toLowerCase();
  const list = q === '' ? entries.value : entries.value.filter((e) => e.haystack.includes(q));
  return sort.value === 'oldest' ? list : list.slice().reverse();
});
const visible = computed(() => filtered.value.slice(windowStart.value, windowStart.value + visibleCount.value));
const remaining = computed(() => Math.max(0, filtered.value.length - windowStart.value - visibleCount.value));
const truncatedByParser = computed(() => view.value?.diagnostics.some((d) => d.code === 'PHASES_TRUNCATED') ?? false);
const currentPhase = computed(() => {
  const i = view.value?.activePhase.kind === 'phase' ? view.value.phases.findIndex((p) => p.id === activeId.value) : -1;
  return i === -1 ? null : entries.value[i];
});

// Per-phase diagnostics are shown inside their cards; only the global ones and a
// grouped count remain in the list below, so thousands of phases never become thousands of rows.
const phaseDiagnostics = computed(() => {
  const byPhase = new Map<number, RoadmapDiagnosticCode[]>();
  for (const d of view.value?.diagnostics ?? []) {
    if (d.phaseIndex === null) continue;
    byPhase.set(d.phaseIndex, [...(byPhase.get(d.phaseIndex) ?? []), d.code]);
  }
  return byPhase;
});
const globalDiagnostics = computed(() => (view.value?.diagnostics ?? []).filter((d) => d.phaseIndex === null));
const groupedDiagnostics = computed(() => {
  const groups = new Map<RoadmapDiagnosticCode, { severity: 'info' | 'warn'; count: number }>();
  for (const d of view.value?.diagnostics ?? []) {
    if (d.phaseIndex === null) continue;
    const g = groups.get(d.code);
    if (g === undefined) groups.set(d.code, { severity: d.severity, count: 1 });
    else g.count++;
  }
  return [...groups].map(([code, g]) => ({ code, ...g }));
});

function positionOf(index: number): number {
  return filtered.value.findIndex((e) => e.index === index);
}
function selectedEntry(): Entry | null {
  if (selectedId.value === null) return null;
  const hits = entries.value.filter((e) => e.phase.id === selectedId.value);
  return hits.length === 1 ? hits[0] : null;
}
/** Make the entry rendered: keep the window if it already holds it, else open one page around it. */
function reveal(index: number): boolean {
  const pos = positionOf(index);
  if (pos === -1) return false;
  const inside = pos >= windowStart.value && pos < windowStart.value + visibleCount.value;
  if (!inside) {
    windowStart.value = Math.max(0, Math.floor(pos / PAGE_SIZE) * PAGE_SIZE - PAGE_SIZE);
    visibleCount.value = Math.max(PAGE_SIZE, Math.ceil((pos + 1 + PAGE_SIZE - windowStart.value) / PAGE_SIZE) * PAGE_SIZE);
  }
  return true;
}
function showEarlier(): void {
  const step = Math.min(PAGE_SIZE, windowStart.value);
  windowStart.value -= step;
  visibleCount.value += step;
}
function resetWindow(): void {
  windowStart.value = 0;
  visibleCount.value = PAGE_SIZE;
  const sel = selectedEntry();
  if (sel !== null) reveal(sel.index); // the selection is never lost to a sort or a search
}
watch([query, sort], resetWindow);

function writeParam(id: string | null): void {
  try {
    const url = new URL(window.location.href);
    if (id === null) url.searchParams.delete(PHASE_PARAM);
    else url.searchParams.set(PHASE_PARAM, id);
    window.history.replaceState(window.history.state, '', url);
  } catch {
    /* navigation state is a convenience; the selection still works without it */
  }
}
function select(id: string | null): void {
  selectedId.value = id;
  writeParam(id);
}
async function scrollTo(index: number): Promise<void> {
  await nextTick();
  const el = document.querySelector<HTMLElement>(`[data-phase-index="${index}"]`);
  el?.scrollIntoView?.({ block: 'center' });
  el?.focus?.({ preventScroll: true });
}
function toggleSelect(e: Entry): void {
  notice.value = null;
  if (e.phase.id === null || duplicateIds.value.has(e.phase.id)) return;
  select(selectedId.value === e.phase.id ? null : e.phase.id);
}
const duplicateIds = computed(() => {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const p of view.value?.phases ?? []) {
    if (p.id === null) continue;
    if (seen.has(p.id)) dup.add(p.id);
    seen.add(p.id);
  }
  return dup;
});
async function goToCurrent(): Promise<void> {
  const cur = currentPhase.value;
  if (cur === null || cur.phase.id === null) {
    notice.value = 'Current phase could not be identified from the roadmap.';
    return;
  }
  notice.value = null;
  query.value = ''; // a search must not hide the target
  await nextTick();
  select(cur.phase.id);
  reveal(cur.index);
  await scrollTo(cur.index);
}
function showMore(): void {
  visibleCount.value += PAGE_SIZE;
}
function clearSearch(): void {
  query.value = '';
}

onMounted(() => {
  // Entering with `?phase=<id>` selects exactly that phase, if the roadmap has it exactly once.
  const wanted = new URLSearchParams(window.location.search).get(PHASE_PARAM);
  if (wanted === null || view.value === undefined) return;
  const hits = entries.value.filter((e) => e.phase.id === wanted);
  if (hits.length !== 1) {
    notice.value = 'The requested phase is not available in this roadmap.';
    return;
  }
  selectedId.value = wanted;
  reveal(hits[0].index);
  void scrollTo(hits[0].index);
});

/** Status / provenance / diagnostics are separate things; the long text is kept for the details. */
function statusParts(p: RoadmapPhaseView): { label: string; full: string | null } {
  const v = p.status.value;
  if (v === null) return { label: 'STATUS NOT STATED', full: null };
  const m = /^(.*?)\s*(?:\(|\s[—–-]\s|:)/.exec(v);
  if (m !== null && m[1] !== '') return { label: m[1], full: v };
  if (v.length > 32) return { label: `${v.slice(0, 32).trimEnd()}…`, full: v };
  return { label: v, full: null };
}

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

      <p v-if="truncatedByParser" class="muted" role="status" data-testid="roadmap-truncated">
        <span class="unknown">INCOMPLETE</span> This roadmap exceeds the parser's capacity; only the first {{ structured.phases.length }} phases were read. The list below is not the whole roadmap.
      </p>

      <div v-if="hasPhases" class="navigator" data-testid="roadmap-navigator">
        <p v-if="currentPhase" class="nav-current" data-testid="roadmap-current">
          <span class="muted">Current phase</span> {{ heading(currentPhase.phase) }}
        </p>
        <div class="nav-controls">
          <label class="nav-search">
            <span class="sr-only">Search phases</span>
            <input v-model="query" type="search" placeholder="Search phases by id, number or title…" autocomplete="off" data-testid="roadmap-search" />
          </label>
          <button v-if="query !== ''" type="button" class="btn" data-testid="roadmap-search-clear" @click="clearSearch">Clear</button>
          <label class="nav-sort">
            <span class="muted">Sort</span>
            <select v-model="sort" data-testid="roadmap-sort">
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </select>
          </label>
          <button type="button" class="btn btn-primary" data-testid="roadmap-go-current" @click="goToCurrent">Go to Current Phase</button>
        </div>
        <p v-if="notice" class="muted" role="status" data-testid="roadmap-notice">{{ notice }}</p>
      </div>

      <p v-if="hasPhases && filtered.length === 0" class="empty" role="status" data-testid="roadmap-no-results">No phases match "{{ query }}".</p>

      <ol v-if="hasPhases" class="phases" data-testid="roadmap-phases">
        <li
          v-for="e in visible"
          :key="e.index"
          class="phase"
          :class="{ 'phase-active': e.phase.id !== null && e.phase.id === activeId, 'phase-selected': e.phase.id !== null && e.phase.id === selectedId }"
          :data-phase-index="e.index"
          :data-phase-id="e.phase.id ?? undefined"
          tabindex="-1"
          data-testid="roadmap-phase"
        >
          <div class="phase-head">
            <h3 class="phase-title">{{ heading(e.phase) }}</h3>
            <button
              v-if="e.phase.id !== null && !duplicateIds.has(e.phase.id)"
              type="button"
              class="btn btn-quiet"
              :aria-pressed="e.phase.id === selectedId"
              data-testid="phase-select"
              @click="toggleSelect(e)"
            >{{ e.phase.id === selectedId ? 'Selected' : 'Select' }}</button>
          </div>
          <p class="phase-meta">
            <span class="status-badge" :class="[{ 'status-unrecognized': !e.phase.status.recognized }, `tone-${statusBadgeTone(e.phase.status.value, e.phase.status.recognized)}`]" data-testid="phase-status">{{ statusParts(e.phase).label }}</span>
            <span class="prov" data-testid="phase-provenance">{{ e.phase.status.provenance }}</span>
            <span v-if="e.phase.status.value !== null && !e.phase.status.recognized" class="diag-badge" data-testid="phase-unrecognized">UNRECOGNIZED</span>
            <span v-if="e.phase.id !== null && e.phase.id === activeId" class="tag" data-testid="phase-active">ACTIVE</span>
          </p>
          <div v-if="e.phase.goal !== null" class="phase-block phase-goal" data-testid="phase-goal">
            <h4 class="phase-k">Phase objective</h4>
            <p class="phase-v">{{ e.phase.goal }}<span v-if="e.phase.goalTruncated === true" class="tag tag-neutral" data-testid="goal-truncated"> Truncated</span></p>
          </div>
          <div class="phase-block phase-stories" data-testid="phase-stories">
            <h4 class="phase-k">Stories</h4>
            <p v-if="!storyIndexUsable" class="muted phase-v" data-testid="phase-stories-unavailable">Story index not available from this data source.</p>
            <p v-else-if="storiesOf(e.phase).length === 0" class="muted phase-v" data-testid="phase-stories-none">No story-index entry is placed under this phase.</p>
            <ul v-else class="story-rows">
              <li v-for="st in storiesOf(e.phase)" :key="`${st.id}-${st.title}`" data-testid="phase-story">
                <code class="story-id">{{ st.id }}</code>
                <span class="story-title">{{ st.title ?? 'Untitled' }}</span>
                <span class="status-badge story-status" :class="[{ 'status-unrecognized': !st.status.recognized }, `tone-${statusBadgeTone(st.status.value, st.status.recognized)}`]">{{ st.status.value ?? 'STATUS NOT STATED' }}</span>
                <span class="story-date muted">{{ st.date ?? 'date not reported' }}</span>
              </li>
            </ul>
            <p v-if="storyIndexUsable && storiesOf(e.phase).length > 0" class="muted phase-note">Statuses and dates are as reported by the story index; they are not verified.</p>
          </div>
          <details v-if="e.phase.details !== null || statusParts(e.phase).full !== null || phaseDiagnostics.has(e.index)" class="phase-details" data-testid="phase-details">
            <summary>Historical notes &amp; evidence</summary>
            <p v-if="statusParts(e.phase).full !== null" class="phase-full-status" data-testid="phase-full-status"><span class="muted">Reported status:</span> {{ statusParts(e.phase).full }}</p>
            <ul v-if="phaseDiagnostics.has(e.index)" class="diag" data-testid="phase-diagnostics">
              <li v-for="(c, k) in phaseDiagnostics.get(e.index)" :key="k" class="sev-warning">{{ DIAGNOSTIC_LABELS[c] ?? c }}</li>
            </ul>
            <pre v-if="e.phase.details !== null" class="roadmap">{{ e.phase.details }}</pre>
          </details>
        </li>
      </ol>

      <div v-if="hasPhases && filtered.length > 0" class="nav-footer" data-testid="roadmap-footer">
        <button v-if="windowStart > 0" type="button" class="btn" data-testid="roadmap-earlier" @click="showEarlier">Show {{ Math.min(PAGE_SIZE, windowStart) }} earlier</button>
        <p class="muted" data-testid="roadmap-count">
          Showing {{ windowStart > 0 ? `${windowStart + 1}–${windowStart + visible.length}` : visible.length }} of {{ filtered.length }} phases<template v-if="filtered.length !== entries.length"> (filtered from {{ entries.length }})</template><template v-if="truncatedByParser"> · roadmap truncated</template>
        </p>
        <button v-if="remaining > 0" type="button" class="btn" data-testid="roadmap-more" @click="showMore">Show {{ Math.min(PAGE_SIZE, remaining) }} more</button>
        <p v-else class="muted" data-testid="roadmap-end">End of the list.</p>
      </div>

      <ul v-if="globalDiagnostics.length > 0 || groupedDiagnostics.length > 0" class="diag roadmap-diag" data-testid="roadmap-diagnostics">
        <li v-for="(d, i) in globalDiagnostics" :key="`g${i}`" :class="d.severity === 'warn' ? 'sev-warning' : 'sev-info'">
          <span class="sev">{{ d.severity === 'warn' ? 'warn' : 'info' }}</span>{{ DIAGNOSTIC_LABELS[d.code] ?? d.code }}
        </li>
        <li v-for="g in groupedDiagnostics" :key="g.code" :class="g.severity === 'warn' ? 'sev-warning' : 'sev-info'" data-testid="roadmap-diagnostic-group">
          <span class="sev">{{ g.severity === 'warn' ? 'warn' : 'info' }}</span>{{ DIAGNOSTIC_LABELS[g.code] ?? g.code }} ({{ g.count }} {{ g.count === 1 ? 'phase' : 'phases' }}; see the phase details)
        </li>
      </ul>

      <details class="raw" data-testid="roadmap-raw">
        <summary>View original Markdown</summary>
        <pre class="roadmap" data-testid="roadmap-text">{{ text }}</pre>
      </details>
    </template>
  </section>
</template>
