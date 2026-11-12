<script setup lang="ts">
import { computed } from 'vue';
import type { ProjectOverview, StoryState } from '../types/dashboard';
import ValueOrUnknown from './ValueOrUnknown.vue';

const props = defineProps<{ overview: ProjectOverview }>();

const SOURCE_LABEL: Record<Extract<StoryState, { kind: 'source' }>['status'], string> = {
  absent: 'Source absent',
  corrupt: 'Source corrupt',
  forbidden: 'Source forbidden',
  unreadable: 'Source unreadable',
  unavailable: 'Source unavailable',
};

const story = computed<StoryState | null>(() => props.overview.story ?? null);
const hasMissions = computed(
  () => props.overview.activeMissionCount !== undefined || props.overview.finishedMissionCount !== undefined,
);
</script>

<template>
  <section id="overview" class="panel" aria-labelledby="overview-h">
    <h2 id="overview-h">Project Overview</h2>

    <div class="ov-block" data-testid="ov-identity">
      <h3>Project</h3>
      <dl class="facts">
        <dt>Name</dt>
        <dd><ValueOrUnknown :value="overview.name" /></dd>
        <template v-if="overview.description !== undefined">
          <dt>Description</dt>
          <dd><ValueOrUnknown :value="overview.description" /></dd>
        </template>
        <dt>State revision</dt>
        <dd><ValueOrUnknown :value="overview.stateRevision" /></dd>
      </dl>
    </div>

    <!-- Untrusted project text: interpolation only, never HTML. -->
    <div v-if="story !== null" class="ov-block" data-testid="ov-focus">
      <h3>Current focus</h3>
      <dl class="facts">
        <dt>Story</dt>
        <dd :data-story-kind="story.kind">
          <template v-if="story.kind === 'active'">
            <span class="tag" data-testid="story-state">Active</span>
            <span data-testid="story-ids">{{ story.ids.join(', ') }}</span>
          </template>
          <span v-else-if="story.kind === 'none'" data-testid="story-state">No active story recorded</span>
          <span v-else-if="story.kind === 'unknown'" class="unknown" data-testid="story-state">UNKNOWN — the section could not be classified</span>
          <span v-else-if="story.kind === 'no_section'" class="unknown" data-testid="story-state">UNKNOWN — no usable “Current Story” section</span>
          <span v-else class="unknown" data-testid="story-state">NOT AVAILABLE — {{ SOURCE_LABEL[story.status] }}<template v-if="story.code !== null"> [{{ story.code }}]</template></span>
        </dd>
      </dl>
      <pre
        v-if="(story.kind === 'active' || story.kind === 'none' || story.kind === 'unknown') && story.excerpt"
        class="story"
        data-testid="current-story"
      >{{ story.excerpt }}</pre>
    </div>
    <!-- Legacy source without structured story state: excerpt only, no classification. -->
    <div v-else-if="overview.currentStory !== undefined" class="ov-block" data-testid="ov-focus">
      <h3>Current focus</h3>
      <dl class="facts">
        <dt>Story</dt>
        <dd><pre v-if="overview.currentStory" class="story" data-testid="current-story">{{ overview.currentStory }}</pre><ValueOrUnknown v-else :value="null" /></dd>
      </dl>
    </div>

    <div v-if="hasMissions" class="ov-block" data-testid="ov-missions">
      <h3>Missions</h3>
      <dl class="facts">
        <dt>Active</dt>
        <dd data-testid="mission-active"><ValueOrUnknown :value="overview.activeMissionCount ?? null" /></dd>
        <dt>Finished</dt>
        <dd data-testid="mission-finished"><ValueOrUnknown :value="overview.finishedMissionCount ?? null" /></dd>
      </dl>
    </div>
  </section>
</template>
