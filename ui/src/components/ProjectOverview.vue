<script setup lang="ts">
import { computed } from 'vue';
import type {
  ActivePhaseView,
  Checkpoint,
  DevelopmentHistory,
  Diagnostic,
  Mission,
  ProjectOverview,
  Section,
  StateProvenanceView,
  StoryState,
  StructuredRoadmapView,
  StructuredStoryIndexView,
} from '../types/dashboard';
import type { SectionId } from '../sections';
import { stripDecorativeMarkers } from '../knowledge';
import { extractStoryFields } from '../storyFields';
import ValueOrUnknown from './ValueOrUnknown.vue';
import ContinuityPanel from './ContinuityPanel.vue';
import { lastCompleted, nextStep } from '../continuity';

/**
 * Mission Command Overview (UI-009). Presentation only: every value is a Core
 * read-model field shown as given. Nothing is parsed from Markdown, no status is
 * derived, no severity is assigned, and nothing is invented when Core is silent.
 */
const props = defineProps<{
  overview: ProjectOverview;
  roadmap?: StructuredRoadmapView;
  storyIndex?: Section<StructuredStoryIndexView>;
  diagnostics?: Diagnostic[];
  sources?: { total: number; available: number };
  provenance?: StateProvenanceView;
  checkpoints?: Checkpoint[] | null;
  /** Core's Development History; Recent Activity reads its `recent` events. `undefined` = not provided (block hidden). */
  history?: Section<DevelopmentHistory>;
  /** Operational missions (Core's Coordinatorium model). Listed here only when there are active ones. */
  missions?: Mission[] | null;
}>();
const emit = defineEmits<{ (e: 'navigate', id: SectionId): void }>();
const go = (id: SectionId): void => emit('navigate', id);

const SOURCE_LABEL: Record<Extract<StoryState, { kind: 'source' }>['status'], string> = {
  absent: 'Source absent',
  corrupt: 'Source corrupt',
  forbidden: 'Source forbidden',
  unreadable: 'Source unreadable',
  unavailable: 'Source unavailable',
};

const PREVIEW_CHARS = 280;
// Preview only: decorative `**`/backtick pairs are dropped for reading; the full text is always the raw source.
const preview = (text: string): { short: string; truncated: boolean } => {
  const shown = stripDecorativeMarkers(text);
  return shown.length > PREVIEW_CHARS
    ? { short: `${shown.slice(0, PREVIEW_CHARS).trimEnd()}…`, truncated: true }
    : { short: shown, truncated: text.length > PREVIEW_CHARS };
};

const story = computed<StoryState | null>(() => props.overview.story ?? null);

/** The raw text Core carries for the current story: structured excerpt first, legacy excerpt otherwise. */
const storyText = computed<string | null>(() => {
  const s = story.value;
  if (s !== null) return s.kind === 'active' || s.kind === 'none' || s.kind === 'unknown' ? s.excerpt : null;
  return props.overview.currentStory ? props.overview.currentStory : null;
});
const storyPreview = computed(() => (storyText.value ? preview(storyText.value) : null));
/** Known labelled lines of the excerpt, or null (unknown format → plain source preview). Extracted text, not a Core fact. */
const fields = computed(() => extractStoryFields(storyText.value));
const activeMissions = computed(() => (props.missions ?? []).filter((m) => m.status === 'in_progress'));

const hasMissions = computed(
  () => props.overview.activeMissionCount !== undefined || props.overview.finishedMissionCount !== undefined,
);

// ---- Active phase (ActivePhaseView; CURRENT only for a confirmed `phase`) ----
const phase = computed(() => {
  const r = props.roadmap;
  if (r === undefined) return { state: 'unavailable' as const, title: null, label: 'Unavailable' };
  const a: ActivePhaseView = r.activePhase;
  if (a.kind === 'phase') {
    const match = r.phases.find((p) => p.id === a.id);
    return { state: 'current' as const, title: match?.title ?? null, label: `Phase ${a.id}` };
  }
  const label: Record<Exclude<ActivePhaseView['kind'], 'phase'>, string> = {
    none: 'No active phase declared',
    not_declared: 'Not declared',
    unmatched: 'Uncertain — pointer matches no phase',
    ambiguous: 'Uncertain — contradictory pointers',
  };
  return { state: a.kind, title: null, label: label[a.kind] };
});

// ---- Story index (Core's StructuredStoryIndexView) ----
const stories = computed(() => {
  const si = props.storyIndex;
  if (si === undefined || si.data === null || si.data.state === 'error' || si.data.state === 'unrecognized') return null;
  return si.data;
});
const storyIndexReason = computed(() => {
  const si = props.storyIndex;
  if (si === undefined) return 'Not provided by this data source';
  if (si.data === null) {
    const s = si.sources[0];
    return s ? `Source ${s.status}${s.code ? ` [${s.code}]` : ''}` : 'Source not available';
  }
  if (si.data.state === 'error' || si.data.state === 'unrecognized') return `Core could not interpret it (${si.data.state})`;
  return null;
});

// ---- Recent Activity: Core's latest recorded events (Development History), nothing derived here ----
const EVENT_LABEL = { mission_started: 'Mission started', checkpoint: 'Checkpoint', mission_finished: 'Mission finished' } as const;
const recentEvents = computed(() => props.history?.data?.recent ?? []);

// ---- Diagnostics: Core's own list, severity untouched ----
const problems = computed(() => (props.diagnostics ?? []).filter((d) => d.severity !== 'info'));
const errorCount = computed(() => problems.value.filter((d) => d.severity === 'error').length);
const warningCount = computed(() => problems.value.filter((d) => d.severity === 'warning').length);

const continuityInput = computed(() => ({
  roadmap: props.roadmap,
  storyIndex: props.storyIndex,
  history: props.history,
  missions: props.missions,
  activeMissionCount: props.overview.activeMissionCount ?? null,
  story: story.value,
}));
const last = computed(() => lastCompleted(continuityInput.value));
const next = computed(() => nextStep(continuityInput.value));
/** The mission card is the working context only when there is something active; otherwise Last Completed → What's Next lead. */
const showMission = computed(() => {
  if (activeMissions.value.length > 0 || (props.overview.activeMissionCount ?? 0) > 0) return true;
  const st = story.value;
  if (st === null) return props.overview.currentStory !== undefined; // legacy DTO: the excerpt only
  // "No active story recorded" is a normal state: the pulse says it. An unclassifiable story is shown on the card.
  return st.kind !== 'none';
});
const splitBrain = computed(() => props.provenance?.splitBrain.detected === true);
</script>

<template>
  <section id="overview" class="panel mc" aria-labelledby="overview-h">
    <h2 id="overview-h">Project Overview</h2>

    <!-- 1. Project identity -->
    <div class="ov-block mc-identity" data-testid="ov-identity">
      <h3 class="mc-eyebrow">Project</h3>
      <p class="mc-name" data-testid="ov-name"><ValueOrUnknown :value="overview.name" /></p>
      <p v-if="overview.description" class="muted mc-desc">{{ overview.description }}</p>
      <ul class="mc-chips" aria-label="Project state">
        <li data-testid="chip-phase">
          <span class="mc-chip-k">Phase</span>
          <span v-if="phase.state === 'current'">{{ phase.label }}</span>
          <span v-else class="muted">{{ phase.label }}</span>
        </li>
        <li data-testid="chip-revision">
          <span class="mc-chip-k">Revision</span>
          <span v-if="overview.stateRevision !== null">{{ overview.stateRevision }}</span>
          <span v-else class="muted" data-testid="revision-unavailable">Revision unavailable</span>
        </li>
        <li v-if="sources" data-testid="chip-sources">
          <span class="mc-chip-k">Sources</span>
          <span>{{ sources.available }} / {{ sources.total }} available</span>
        </li>
      </ul>
      <p v-if="overview.stateRevision === null" class="muted mc-note" data-testid="revision-note">
        Core did not report a state revision. This is not an error by itself; the revision is never derived in the browser.
        <button type="button" class="mc-link" data-testid="go-diagnostics-rev" @click="go('diagnostics')">Check Diagnostics</button>
      </p>
    </div>

    <ContinuityPanel v-if="!showMission" :last="last" :next="next" @navigate="go" />

    <div class="mc-grid" :class="{ 'mc-grid-single': !showMission }">
      <!-- 2. Current mission. Untrusted project text: interpolation only, never HTML. -->
      <div v-if="showMission" class="ov-block mc-card mc-mission" data-testid="ov-focus">
        <h3 class="mc-eyebrow">Current mission</h3>
        <p v-if="story !== null && story.kind === 'active'" class="mc-hero" data-testid="story-ids">{{ story.ids.join(', ') }}</p>
        <p v-if="fields !== null && fields.title !== null" class="mc-title" data-testid="story-title">{{ fields.title }}</p>
        <p v-if="fields !== null && fields.status !== null" class="mc-statusrow">
          <span class="mc-status" data-testid="story-status-text">{{ fields.status }}</span>
          <span class="muted mc-prov">as written in the source text</span>
        </p>
        <dl class="facts mc-storystate">
          <dt>Story</dt>
          <dd v-if="story !== null" :data-story-kind="story.kind">
            <template v-if="story.kind === 'active'">
              <span class="tag" data-testid="story-state">Active</span>
              <span class="muted"> as recorded in the working memory</span>
            </template>
            <span v-else-if="story.kind === 'none'" data-testid="story-state">No active story recorded</span>
            <span v-else-if="story.kind === 'unknown'" class="unknown" data-testid="story-state">UNKNOWN — the section could not be classified</span>
            <span v-else-if="story.kind === 'no_section'" class="unknown" data-testid="story-state">UNKNOWN — no usable “Current Story” section</span>
            <span v-else class="unknown" data-testid="story-state">NOT AVAILABLE — {{ SOURCE_LABEL[story.status] }}<template v-if="story.code !== null"> [{{ story.code }}]</template></span>
          </dd>
          <dd v-else data-story-kind="legacy"><span v-if="storyText === null" class="unknown">UNKNOWN</span><span v-else class="muted">Source excerpt only; not classified</span></dd>
        </dl>

        <template v-if="fields !== null">
          <div v-if="fields.objective !== null" class="mc-field" data-testid="story-objective">
            <h4 class="mc-fk">Mission objective</h4>
            <p class="mc-fv">{{ fields.objective }}</p>
          </div>
          <div v-if="fields.milestone !== null" class="mc-field mc-milestone" data-testid="story-milestone">
            <h4 class="mc-fk">Current milestone</h4>
            <p class="mc-fv">{{ fields.milestone }}</p>
          </div>
          <div v-if="fields.branch !== null" class="mc-field mc-branch" data-testid="story-branch">
            <h4 class="mc-fk">Development branch</h4>
            <p class="mc-fv"><code>{{ fields.branch }}</code></p>
          </div>
          <p class="muted mc-note" data-testid="story-fields-note">
            Title, objective, status, milestone and branch are read from the Current Story text. Core confirms only the story identity.
          </p>
          <details v-if="storyText !== null" class="more" data-testid="story-full">
            <summary>Show full source text</summary>
            <pre class="story mc-excerpt-full" data-testid="current-story-full">{{ storyText }}</pre>
          </details>
        </template>
        <template v-else-if="storyPreview !== null">
          <p class="mc-srclabel muted">Source excerpt (preview) — format not recognised</p>
          <pre class="story mc-excerpt" data-testid="current-story">{{ storyPreview.short }}</pre>
          <details v-if="storyPreview.truncated" class="more" data-testid="story-full">
            <summary>Show full source text</summary>
            <pre class="story mc-excerpt-full" data-testid="current-story-full">{{ storyText }}</pre>
          </details>
        </template>
        <p class="mc-actions">
          <button type="button" class="mc-link" data-testid="go-graph" @click="go('graph')">Open Execution Graph</button>
        </p>
      </div>

      <!-- 3. Project pulse -->
      <div class="ov-block mc-card mc-pulse" data-testid="ov-pulse">
        <h3 class="mc-eyebrow">Project pulse</h3>
        <dl class="facts">
          <dt>Active phase</dt>
          <dd data-testid="pulse-phase">
            <template v-if="phase.state === 'current'">
              <span class="tag">CURRENT</span> {{ phase.label }}<template v-if="phase.title"> — {{ phase.title }}</template>
            </template>
            <span v-else class="muted">{{ phase.label }}</span>
          </dd>
          <dt>Active story</dt>
          <dd data-testid="pulse-story">
            <span v-if="story === null" class="muted">Unavailable</span>
            <template v-else-if="story.kind === 'active'">{{ story.ids.join(', ') }}</template>
            <span v-else-if="story.kind === 'none'" class="muted">None recorded</span>
            <span v-else class="unknown">Unresolved</span>
          </dd>
          <dt>Story index entries</dt>
          <dd data-testid="pulse-stories">
            <template v-if="stories !== null">
              {{ stories.stories.length }}
              <span class="muted">· listed in the story index; not overall project completion</span>
            </template>
            <template v-else>
              <span class="muted">Unavailable</span>
              <span v-if="storyIndexReason" class="muted"> — {{ storyIndexReason }}</span>
            </template>
          </dd>
          <div v-if="hasMissions" class="mc-contents" data-testid="ov-missions">
            <dt>Active missions</dt>
            <dd data-testid="mission-active"><ValueOrUnknown :value="overview.activeMissionCount ?? null" /></dd>
            <dt>Finished missions</dt>
            <dd data-testid="mission-finished"><ValueOrUnknown :value="overview.finishedMissionCount ?? null" /></dd>
          </div>
          <div v-if="activeMissions.length > 0" class="mc-contents" data-testid="ov-mission-list">
            <dt>Operational missions</dt>
            <dd>
              <ul class="mc-mlist">
                <li v-for="m in activeMissions" :key="m.id" data-testid="mission">
                  <code>{{ m.id }}</code> <ValueOrUnknown :value="m.title" />
                  <span class="muted mc-prov"> · {{ m.status }}<template v-if="m.updatedAt !== null"> · updated {{ m.updatedAt }}</template></span>
                </li>
              </ul>
            </dd>
          </div>
          <dt>Diagnostics</dt>
          <dd data-testid="pulse-diagnostics">
            <span v-if="diagnostics === undefined" class="muted">Unavailable</span>
            <span v-else-if="problems.length === 0" class="muted">No problems reported</span>
            <template v-else>
              <span v-if="errorCount > 0" class="mc-ind mc-ind-err" data-testid="pulse-errors">{{ errorCount }} error(s)</span>
              <span v-if="warningCount > 0" class="mc-ind mc-ind-warn" data-testid="pulse-warnings">{{ warningCount }} warning(s)</span>
            </template>
          </dd>
          <template v-if="splitBrain">
            <dt>State</dt>
            <dd data-testid="pulse-splitbrain"><span class="mc-ind mc-ind-warn">Split-brain detected</span> <span class="muted">— MONOLITH does not choose between the states.</span></dd>
          </template>
          <dt>Freshness</dt>
          <dd data-testid="pulse-freshness" class="muted">Not reported by Core</dd>
        </dl>
        <p class="mc-actions">
          <button type="button" class="mc-link" data-testid="go-diagnostics" @click="go('diagnostics')">Open Diagnostics</button>
        </p>
      </div>
    </div>

    <ContinuityPanel v-if="showMission" :last="last" :next="next" @navigate="go" />

    <!-- 6. Recent activity: the latest recorded mission events (same model as Development History) -->
    <div v-if="history !== undefined" class="ov-block mc-card mc-activity" data-testid="ov-recent">
      <h3 class="mc-eyebrow">Recent activity</h3>
      <p v-if="history.data === null" class="empty" data-testid="recent-unavailable">Mission history is not available from Core.</p>
      <p v-else-if="recentEvents.length === 0" class="empty" data-testid="recent-empty">No mission activity recorded.</p>
      <ul v-else class="mc-act-list" data-testid="recent-list">
        <li v-for="(e, i) in recentEvents" :key="`${e.kind}-${e.missionId}-${e.checkpointId ?? ''}-${i}`" data-testid="recent-event">
          <span class="mc-act-k">{{ EVENT_LABEL[e.kind] }}<template v-if="e.result"> · {{ e.result }}</template></span>
          <code class="mc-act-id">{{ e.checkpointId ?? e.missionId }}</code>
          <span class="mc-act-sum">{{ e.summary ? preview(e.summary).short : e.missionTitle }}</span>
          <span class="mc-act-date">{{ e.at }}</span>
        </li>
      </ul>
      <p class="mc-actions">
        <button type="button" class="mc-link" data-testid="go-history" @click="go('history')">Open Development History</button>
      </p>
    </div>
  </section>
</template>
