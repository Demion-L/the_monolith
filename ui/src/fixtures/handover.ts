import type { HandoverReport } from '../../../src/handover/types';

/** DEMO data only (shown with the DEMO badge). It exercises every evidence level so the visual semantics can be reviewed. */
export const demoHandover: HandoverReport = {
  schema: 1,
  status: 'REVIEW_WITH_ISSUES',
  statusReasons: ['COMPLETION_UNVERIFIED', 'EVIDENCE_STALE', 'MISSIONS_FAILED'],
  project: { name: 'KAIROS (demo)', activePhase: { kind: 'phase', id: '2' }, currentStory: { kind: 'ids', ids: ['S-4'] }, governance: { result: 'ISSUES_FOUND', errors: 0, warnings: 2 } },
  progress: {
    planned: 2, active: 1, finalized: 3, listedNotFinal: 1, awaitingReview: ['S-3'], unknown: 0, storiesTruncated: false,
    stories: [
      { id: 'S-1', planned: 'PLANNED', active: 'NOT_ACTIVE', finalization: 'FINALIZED', indexStatus: 'COMPLETED', consistency: 'CONSISTENT', missions: { total: 1, inProgress: 0, completed: 1, failed: 0, cancelled: 0 }, evidence: { verified: 1, reported: 0, stale: 0, unknown: 0, failed: 0 } },
      { id: 'S-3', planned: 'PLANNED', active: 'NOT_ACTIVE', finalization: 'LISTED_NOT_FINAL', indexStatus: 'READY FOR REVIEW', consistency: 'CONSISTENT', missions: { total: 1, inProgress: 0, completed: 1, failed: 0, cancelled: 0 }, evidence: { verified: 0, reported: 1, stale: 1, unknown: 0, failed: 0 } },
      { id: 'S-4', planned: 'PLANNED', active: 'ACTIVE', finalization: 'NOT_FINALIZED', indexStatus: null, consistency: 'INCOMPLETE', missions: { total: 2, inProgress: 1, completed: 0, failed: 1, cancelled: 0 }, evidence: { verified: 0, reported: 0, stale: 0, unknown: 1, failed: 1 } },
    ],
  },
  missions: { total: 4, inProgress: 1, completed: 2, failed: 1, cancelled: 0, checkpoints: 5, orphanCheckpoints: 0, withoutStoryLink: 0, activeWithoutCheckpoint: [], failedMissions: [{ id: 'MIS-9001', title: 'Import pipeline', storyId: 'S-4', checkpointCount: 1 }], active: [{ id: 'MIS-9002', title: 'Retry import', storyId: 'S-4', checkpointCount: 1 }], truncated: false },
  architecture: { available: true, total: 4, accepted: 2, proposed: 1, other: [{ status: 'superseded', count: 1 }], unrecognized: 0, missingMetadata: 0, complete: true },
  verification: {
    git: { available: true, head: '0123456789abcdef0123456789abcdef01234567', dirty: false },
    counts: { verified: 1, reported: 1, stale: 1, unknown: 1, failed: 1 },
    unreadableRecords: 0, recordsTruncated: false, storiesWithoutVerifiedEvidence: ['S-3'],
    items: [
      { id: 'EVD-0001', storyId: 'S-1', command: 'pnpm test', result: 'pass', provenance: 'OBSERVED', level: 'VERIFIED', freshness: 'REVISION_MATCH', freshnessReason: 'HEAD_MATCH_CLEAN', recordedAt: '2026-02-01T10:00:00.000Z', gitHead: '0123456789abcdef0123456789abcdef01234567', dirty: false, source: '.monolith/memory/long-term/verification/EVD-0001.json' },
      { id: 'EVD-0002', storyId: 'S-3', command: 'pnpm test', result: 'pass', provenance: 'REPORTED', level: 'REPORTED', freshness: 'REVISION_MATCH', freshnessReason: 'HEAD_MATCH_CLEAN', recordedAt: '2026-02-02T10:00:00.000Z', gitHead: '0123456789abcdef0123456789abcdef01234567', dirty: false, source: '.monolith/memory/long-term/verification/EVD-0002.json' },
      { id: 'EVD-0003', storyId: 'S-3', command: 'pnpm build', result: 'pass', provenance: 'OBSERVED', level: 'STALE', freshness: 'POTENTIALLY_STALE', freshnessReason: 'HEAD_CHANGED', recordedAt: '2026-01-20T10:00:00.000Z', gitHead: 'fedcba9876543210fedcba9876543210fedcba98', dirty: false, source: '.monolith/memory/long-term/verification/EVD-0003.json' },
      { id: 'EVD-0004', storyId: 'S-4', command: 'pnpm test', result: 'pass', provenance: 'OBSERVED', level: 'UNKNOWN', freshness: 'REVISION_MATCH_DIRTY', freshnessReason: 'DIRTY_AT_RECORD', recordedAt: '2026-02-03T10:00:00.000Z', gitHead: '0123456789abcdef0123456789abcdef01234567', dirty: true, source: '.monolith/memory/long-term/verification/EVD-0004.json' },
      { id: 'EVD-0005', storyId: 'S-4', command: 'pnpm test', result: 'fail', provenance: 'OBSERVED', level: 'FAILED', freshness: 'REVISION_MATCH', freshnessReason: 'HEAD_MATCH_CLEAN', recordedAt: '2026-02-03T11:00:00.000Z', gitHead: '0123456789abcdef0123456789abcdef01234567', dirty: false, source: '.monolith/memory/long-term/verification/EVD-0005.json' },
    ],
  },
  execution: {
    mode: 'off',
    enforcement: 'inactive-off',
    summary: 'Managed Execution: off (no enrolment is required; missions are registered manually).',
    activeContexts: [],
    untrackedImplementation: null,
  },
  outstanding: {
    issues: [
      { code: 'ACTIVE_AND_FINALIZED', kind: 'conflict', message: '[activeStory] The story is both active and finalized (demo).', basis: '.monolith/memory/working/active.md' },
      { code: 'COMPLETION_UNVERIFIED', kind: 'unverified', message: 'Story S-3 has completed mission(s) but no VERIFIED evidence.', basis: 'monolith evidence list' },
      { code: 'EVIDENCE_STALE', kind: 'attention', message: '1 recorded check(s) predate later changes (potentially stale); re-run them.', basis: '.monolith/memory/long-term/verification' },
    ],
    ownerDecisions: [{ code: 'FINALIZE_STORY', subject: 'S-3', message: '1 mission(s) completed on S-3, but story-index.md does not report it finalized.', basis: '.monolith/memory/working/story-index.md' }],
  },
  sources: ['.monolith/context/maps/roadmap-index.md'],
  limitations: ['This report restates what the project documents, Development History and recorded evidence say; it runs no tests.', 'REPORTED evidence is somebody\'s statement and is not verification.'],
};
