<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { HandoverReport } from '../../../src/handover/types';
import { fetchHandover } from '../live/handover';
import type { HandoverLoadState } from '../live/handover';
import StatusPill from './StatusPill.vue';
import type { Tone } from './StatusPill.vue';

/**
 * Handover (ACCOUNTABILITY-001). Presentation of Core's `HandoverReport` exactly as served by `GET /api/handover`;
 * nothing is derived here. Evidence levels are kept visually apart: only VERIFIED is green, REPORTED is a statement
 * (blue, "not verification"), STALE and UNKNOWN are cautions, FAILED and conflicts are red. The overall status is a
 * reviewability status and is never green: nothing here says the project is correct.
 * Fetched when the section opens or on Refresh — never on dashboard refresh. In demo mode the report is supplied.
 */
const props = defineProps<{ demoReport?: HandoverReport | null }>();
const emit = defineEmits<{ (e: 'navigate', id: 'history' | 'roadmap' | 'decisions' | 'diagnostics'): void }>();

const state = ref<HandoverLoadState>(props.demoReport ? { status: 'ready', data: props.demoReport } : { status: 'idle' });
const isDemo = props.demoReport !== undefined;
let request = 0;
async function load(): Promise<void> {
  if (isDemo) return;
  const mine = ++request;
  state.value = { status: 'loading' };
  try {
    const data = await fetchHandover();
    if (mine === request) state.value = { status: 'ready', data };
  } catch (e) {
    if (mine === request) state.value = { status: 'error', message: e instanceof Error ? e.message : 'The handover report could not be loaded.' };
  }
}
onMounted(() => void load());

const r = computed(() => (state.value.status === 'ready' ? state.value.data : null));

const STATUS_TONE: Record<HandoverReport['status'], Tone> = { READY_FOR_REVIEW: 'info', REVIEW_WITH_ISSUES: 'warn', INCOMPLETE: 'warn', UNKNOWN: 'neutral' };
const STATUS_LABEL: Record<HandoverReport['status'], string> = { READY_FOR_REVIEW: 'READY FOR REVIEW', REVIEW_WITH_ISSUES: 'REVIEW WITH ISSUES', INCOMPLETE: 'INCOMPLETE', UNKNOWN: 'UNKNOWN' };
const LEVEL_TONE: Record<string, Tone> = { VERIFIED: 'ok', REPORTED: 'info', STALE: 'warn', UNKNOWN: 'neutral', FAILED: 'err' };
const ISSUE_TONE: Record<string, Tone> = { conflict: 'err', unverified: 'warn', attention: 'neutral' };

function storyLabel(s: HandoverReport['progress']['stories'][number]): string {
  if (s.finalization === 'FINALIZED') return 'FINALIZED';
  if (s.active === 'ACTIVE') return 'ACTIVE';
  if (s.finalization === 'LISTED_NOT_FINAL') return `LISTED · ${s.indexStatus ?? 'status unknown'}`;
  if (s.planned === 'PLANNED') return 'PLANNED';
  return 'NOT CLASSIFIED';
}
</script>

<template>
  <section id="handover" class="panel" aria-labelledby="handover-h">
    <h2 id="handover-h">Handover</h2>
    <p class="muted">
      What autonomous work left behind, restated from project documents, mission history and recorded evidence — with provenance. This view runs no tests.
    </p>
    <p v-if="demoReport === null" class="muted" data-testid="handover-demo-none">This demo scenario has no handover report.</p>
    <button v-else-if="!isDemo" type="button" data-testid="handover-refresh" :disabled="state.status === 'loading'" @click="load">Refresh handover</button>

    <p v-if="demoReport === null"></p>
    <p v-else-if="state.status === 'loading' || state.status === 'idle'" class="muted" role="status" data-testid="handover-loading">Loading handover…</p>
    <p v-else-if="state.status === 'error'" class="empty" role="alert" data-testid="handover-error">
      <span class="unknown">NOT AVAILABLE</span> {{ state.message }}
    </p>

    <template v-else-if="r !== null">
      <div class="card" data-testid="handover-status">
        <div class="card-head">
          <h3>Status</h3>
          <StatusPill :tone="STATUS_TONE[r.status]" :label="STATUS_LABEL[r.status]" />
        </div>
        <p class="muted">A reviewability status. It does not say the project is correct or production-ready.</p>
        <p v-if="r.statusReasons.length > 0" class="muted" data-testid="handover-reasons">Because: <template v-for="(c, i) in r.statusReasons.slice(0, 10)" :key="c"><template v-if="i > 0">, </template><code>{{ c }}</code></template></p>
        <p>
          Project <strong>{{ r.project.name ?? 'UNKNOWN' }}</strong> · active phase
          <code>{{ r.project.activePhase.kind === 'phase' ? r.project.activePhase.id : r.project.activePhase.kind === 'none' ? 'none declared' : r.project.activePhase.kind }}</code> · current story
          <code>{{ r.project.currentStory.kind === 'ids' ? r.project.currentStory.ids.join(', ') : r.project.currentStory.kind === 'none' ? 'none recorded' : 'UNKNOWN' }}</code>
        </p>
        <p data-testid="handover-governance">
          Governance:
          <template v-if="r.project.governance.result === 'NOT_CHECKED'">not checked</template>
          <template v-else-if="r.project.governance.result === 'NO_ISSUES'">no findings (not a proof of correctness)</template>
          <template v-else>{{ r.project.governance.errors }} error(s), {{ r.project.governance.warnings }} warning(s)</template>
          <button type="button" class="link" @click="emit('navigate', 'diagnostics')">Diagnostics</button>
        </p>
      </div>

      <h3>Development progress <span class="tag">REPORTED by the project documents</span></h3>
      <p data-testid="handover-progress">
        Planned {{ r.progress.planned }} · Active {{ r.progress.active }} · Finalized {{ r.progress.finalized }} · Listed, not final {{ r.progress.listedNotFinal }} · Unclassified {{ r.progress.unknown }}
        <button type="button" class="link" @click="emit('navigate', 'roadmap')">Roadmap</button>
      </p>
      <p v-if="r.progress.awaitingReview.length > 0" data-testid="handover-awaiting">Awaiting review (story-index says so): {{ r.progress.awaitingReview.join(', ') }}</p>
      <p v-if="r.progress.stories.length === 0" class="empty" data-testid="handover-no-stories">No story is known from the documents or missions.</p>
      <ul v-else class="cards">
        <li v-for="s in r.progress.stories" :key="s.id" class="card" data-testid="handover-story">
          <div class="card-head">
            <code>{{ s.id }}</code>
            <StatusPill :tone="s.consistency === 'CONFLICT' ? 'err' : 'neutral'" :label="storyLabel(s)" />
          </div>
          <p class="muted">
            Missions: {{ s.missions.completed }} completed · {{ s.missions.inProgress }} open · {{ s.missions.failed }} failed
            <template v-if="s.consistency !== 'CONSISTENT'"> · documents {{ s.consistency }}</template>
          </p>
          <p class="muted">Evidence: {{ s.evidence.verified }} verified · {{ s.evidence.reported }} reported · {{ s.evidence.stale }} stale · {{ s.evidence.unknown }} unknown · {{ s.evidence.failed }} failed</p>
        </li>
      </ul>
      <p v-if="r.progress.storiesTruncated" class="empty" role="status"><span class="unknown">INCOMPLETE</span> The story list was cut.</p>

      <h3>Mission history</h3>
      <p data-testid="handover-missions">
        {{ r.missions.total }} total: {{ r.missions.completed }} completed · {{ r.missions.failed }} failed · {{ r.missions.cancelled }} cancelled · {{ r.missions.inProgress }} active ·
        {{ r.missions.checkpoints }} checkpoint(s) · {{ r.missions.withoutStoryLink }} without a story link
        <button type="button" class="link" @click="emit('navigate', 'history')">Development History</button>
      </p>
      <ul v-if="r.missions.active.length > 0">
        <li v-for="m in r.missions.active" :key="m.id" data-testid="handover-active-mission"><code>{{ m.id }}</code> {{ m.title }} — {{ m.checkpointCount }} checkpoint(s)</li>
      </ul>

      <h3>Architecture decisions</h3>
      <p data-testid="handover-adr">
        <template v-if="!r.architecture.available"><span class="unknown">UNKNOWN</span> docs/adr is not available.</template>
        <template v-else>
          {{ r.architecture.total }} ADR(s): {{ r.architecture.accepted }} accepted · {{ r.architecture.proposed }} proposed
          <template v-for="o in r.architecture.other" :key="o.status"> · {{ o.count }} {{ o.status }}</template>
          · {{ r.architecture.unrecognized }} unrecognised · {{ r.architecture.missingMetadata }} with missing metadata<template v-if="!r.architecture.complete"> (list incomplete)</template>
        </template>
        <button type="button" class="link" @click="emit('navigate', 'decisions')">Architecture Decisions</button>
      </p>

      <template v-if="r.execution">
        <h3>Execution discipline</h3>
        <p data-testid="handover-execution">
          <StatusPill :tone="r.execution.enforcement === 'configured-hook-found' ? 'info' : r.execution.enforcement === 'inactive-off' ? 'neutral' : 'warn'" :label="`${r.execution.mode.toUpperCase()} · ${r.execution.enforcement}`" />
          {{ r.execution.summary }}
        </p>
        <ul v-if="r.execution.activeContexts.length > 0" class="list" data-testid="handover-contexts">
          <li v-for="c in r.execution.activeContexts" :key="c.missionId">
            <code>{{ c.missionId }}</code>
            <template v-if="c.relation === 'unowned'"> — no owner recorded (manual/legacy mission)</template>
            <template v-else> — {{ c.relation }}, owner {{ c.agent }}; owner liveness {{ c.liveness.toUpperCase() }}</template>
          </li>
        </ul>
        <p v-if="r.execution.untrackedImplementation === true" class="muted" data-testid="handover-untracked">UNTRACKED IMPLEMENTATION: uncommitted changes exist and no active mission is owned by this worktree.</p>
      </template>

      <h3>Verification evidence</h3>
      <p class="muted" data-testid="handover-git">
        Git:
        <template v-if="!r.verification.git.available">unavailable — freshness is UNKNOWN</template>
        <template v-else>HEAD <code>{{ r.verification.git.head?.slice(0, 12) ?? '(none)' }}</code>, working tree {{ r.verification.git.dirty === null ? 'UNKNOWN' : r.verification.git.dirty ? 'DIRTY' : 'clean' }}</template>
      </p>
      <p data-testid="handover-evidence-counts">
        <StatusPill tone="ok" :label="`VERIFIED ${r.verification.counts.verified}`" />
        <StatusPill tone="info" :label="`REPORTED ${r.verification.counts.reported}`" />
        <StatusPill tone="warn" :label="`STALE ${r.verification.counts.stale}`" />
        <StatusPill tone="neutral" :label="`UNKNOWN ${r.verification.counts.unknown}`" />
        <StatusPill tone="err" :label="`FAILED ${r.verification.counts.failed}`" />
      </p>
      <p class="muted">VERIFIED: MONOLITH ran the command, it passed, and the revision still equals HEAD on a clean tree. REPORTED is somebody's statement, not verification.</p>
      <p v-if="r.verification.items.length === 0" class="empty" data-testid="handover-no-evidence"><span class="unknown">NONE</span> No verification evidence is recorded.</p>
      <ul v-else class="cards">
        <li v-for="e in r.verification.items" :key="e.id" class="card" data-testid="handover-evidence">
          <div class="card-head">
            <code>{{ e.id }}</code>
            <StatusPill :tone="LEVEL_TONE[e.level] ?? 'neutral'" :label="e.level" />
          </div>
          <p><code>{{ e.command }}</code></p>
          <p class="muted">{{ e.provenance }} · {{ e.result }} · {{ e.freshness }} ({{ e.freshnessReason }}) · story {{ e.storyId ?? 'none' }} · {{ e.recordedAt }}</p>
        </li>
      </ul>
      <p v-if="r.verification.storiesWithoutVerifiedEvidence.length > 0" data-testid="handover-unverified">
        <span class="unknown">UNVERIFIED</span> Completed missions without VERIFIED evidence: {{ r.verification.storiesWithoutVerifiedEvidence.join(', ') }}
      </p>

      <h3>Outstanding issues</h3>
      <p v-if="r.outstanding.issues.length === 0" class="empty" data-testid="handover-no-issues">None listed. This does not mean the project is correct.</p>
      <ul v-else class="cards">
        <li v-for="(i, n) in r.outstanding.issues" :key="n" class="card" data-testid="handover-issue">
          <div class="card-head">
            <code>{{ i.code }}</code>
            <StatusPill :tone="ISSUE_TONE[i.kind] ?? 'neutral'" :label="i.kind.toUpperCase()" />
          </div>
          <p>{{ i.message }}</p>
          <p v-if="i.basis" class="muted">Basis: <code>{{ i.basis }}</code></p>
        </li>
      </ul>

      <h3>Owner decisions required</h3>
      <p v-if="r.outstanding.ownerDecisions.length === 0" class="empty" data-testid="handover-no-decisions">None established from the sources.</p>
      <ul v-else>
        <li v-for="(d, n) in r.outstanding.ownerDecisions" :key="n" data-testid="handover-decision"><strong>{{ d.code }}</strong> <code>{{ d.subject }}</code> — {{ d.message }} <span class="muted">(basis: {{ d.basis }})</span></li>
      </ul>

      <h3>Not established by this report</h3>
      <ul class="muted" data-testid="handover-limitations">
        <li v-for="(l, n) in r.limitations" :key="n">{{ l }}</li>
      </ul>
    </template>
  </section>
</template>
