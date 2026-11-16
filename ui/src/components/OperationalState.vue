<script setup lang="ts">
import { computed } from 'vue';
import type { StateProvenanceView } from '../../../src/readmodel/types';
import StatusPill from './StatusPill.vue';

const props = defineProps<{ provenance: StateProvenanceView | undefined }>();

const LOCAL_REASON: Record<string, string> = {
  ISOLATED_MODE: 'Per-worktree state was chosen explicitly.',
  NOT_A_GIT_REPOSITORY: 'The project is not in a git repository, so state cannot be shared.',
  PROJECT_NOT_AT_WORKTREE_ROOT: 'The project is not at the root of its worktree, so state cannot be shared.',
};
const LOCAL_STATE: Record<string, string> = {
  ok: 'readable',
  'incompatible-schema': 'incompatible schema',
  corrupt: 'corrupt',
  unreadable: 'unreadable',
};

const sb = computed(() => props.provenance?.splitBrain);
</script>

<template>
  <article class="dcard" data-testid="operational-state" aria-labelledby="opstate-h">
    <header class="dcard-head">
      <h3 id="opstate-h">Operational state</h3>
    </header>
    <p class="muted dcard-q">Where does MONOLITH keep its working state, and is there more than one copy?</p>

    <p v-if="provenance === undefined" class="empty" data-testid="opstate-unavailable">
      The location of the operational state is not reported by this data source.
    </p>
    <template v-else>
      <dl class="facts compact">
        <dt>Mode</dt>
        <dd data-testid="opstate-mode">{{ provenance.mode.toUpperCase() }}
          <span v-if="provenance.localReason !== null" class="muted">— {{ LOCAL_REASON[provenance.localReason] ?? provenance.localReason }}</span>
        </dd>
        <dt>Revision</dt>
        <dd data-testid="opstate-revision">{{ provenance.revision ?? 'UNKNOWN' }}</dd>
        <dt>Schema</dt>
        <dd data-testid="opstate-schema">{{ provenance.schemaVersion === null ? 'UNKNOWN' : `v${provenance.schemaVersion}` }}</dd>
        <dt>Worktrees</dt>
        <dd data-testid="opstate-worktrees">{{ provenance.worktreeCount ?? 'UNKNOWN' }}</dd>
        <dt>MONOLITH</dt>
        <dd>{{ provenance.monolithVersion }}</dd>
        <dt>Repository</dt>
        <dd data-testid="opstate-repo">{{ provenance.repositoryIdentity ?? 'Not a git repository' }}</dd>
        <dt>Canonical state</dt>
        <dd><code data-testid="opstate-path">{{ provenance.statePath }}</code></dd>
        <dt>Consistency</dt>
        <dd data-testid="opstate-consistency">
          <template v-if="sb?.detected"><StatusPill tone="warn" label="SPLIT-BRAIN" /></template>
          <template v-else>
            <StatusPill tone="neutral" label="NOT VERIFIED" />
            <span class="muted"> No independent state copies were found. The contents of the state are not cross-checked.</span>
          </template>
        </dd>
      </dl>

      <div v-if="sb?.detected" class="splitbrain" role="alert" data-testid="split-brain">
        <strong>Independent states were found ({{ sb.localStates.length }}).</strong>
        <p>
          <template v-if="sb.canonicalMissingWithLocalData">The canonical state does not exist yet, but worktree-local state with data does. </template>
          MONOLITH never merges or chooses between them. To inspect them, run <code>monolith state status</code> in a terminal.
          Adopting a state is a deliberate command-line operation; Mission Control does not offer it.
        </p>
        <ul class="plain" data-testid="split-brain-list">
          <li v-for="l in sb.localStates" :key="l.path">
            <code>{{ l.path }}</code>
            <span class="muted">
              {{ LOCAL_STATE[l.status] ?? l.status }}<template v-if="l.revision !== null">, revision {{ l.revision }}</template><template v-if="l.missionCount !== null">, {{ l.missionCount }} mission(s)</template><template v-if="l.currentWorktree">, this worktree</template>
            </span>
          </li>
        </ul>
      </div>
    </template>
  </article>
</template>
