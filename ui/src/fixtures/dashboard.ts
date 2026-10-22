import type { DashboardData, ScenarioId } from '../types/dashboard';

/**
 * SYNTHETIC DEMO DATA. The project below ("Tidewatch") is fictional and is
 * unrelated to MONOLITH, SPHINX, or any real project state.
 */

const roadmap = `# Tidewatch roadmap (demo text)

Phase 1 - Ingest
- Sensor adapter for harbor gauges
- Draft: <phase> parser (HTML-like text is shown as plain text)

Phase 2 - Reporting
- Daily tide summary
- Export to CSV

Phase 3 - Alerts
- Threshold notifications`;

export const normalScenario: DashboardData = {
  isDemo: true,
  overview: {
    name: 'Tidewatch (demo)',
    description: 'Fictional harbor tide-logging service used to exercise the dashboard.',
    stateRevision: 14,
  },
  missions: [
    {
      id: 'MIS-0003',
      title: 'Add gauge calibration import',
      status: 'in_progress',
      summary: 'Import calibration offsets from a CSV file.',
      startedAt: '2026-03-02T09:15:00.000Z',
      updatedAt: '2026-03-04T16:40:00.000Z',
    },
    {
      id: 'MIS-0004',
      title: 'Fix timezone drift in daily summary',
      status: 'in_progress',
      summary: 'Summaries cross midnight incorrectly for UTC+13.',
      startedAt: '2026-03-03T11:00:00.000Z',
      updatedAt: '2026-03-03T11:00:00.000Z',
    },
    {
      id: 'MIS-0002',
      title: 'Initial ingest adapter',
      status: 'completed',
      summary: 'Adapter shipped.',
      startedAt: '2026-02-10T08:00:00.000Z',
      updatedAt: '2026-02-20T18:30:00.000Z',
    },
  ],
  checkpoints: [
    {
      id: 'MIS-0003-CKPT-0002',
      missionId: 'MIS-0003',
      createdAt: '2026-03-04T16:40:00.000Z',
      summary: 'CSV parser done; offset validation pending.',
      remainingSteps: ['Validate offset ranges', 'Write import tests', 'Document CSV format'],
    },
    {
      id: 'MIS-0003-CKPT-0001',
      missionId: 'MIS-0003',
      createdAt: '2026-03-03T10:05:00.000Z',
      summary: 'Scoped the CSV format.',
      remainingSteps: ['Implement parser', 'Validate offset ranges'],
    },
  ],
  roadmapText: roadmap,
  diagnostics: [
    { severity: 'info', message: 'Fixture "normal" loaded.' },
    { severity: 'warning', message: 'Sample warning: fixture state revision is older than expected.' },
  ],
};

export const partialScenario: DashboardData = {
  isDemo: true,
  overview: { name: 'Tidewatch (demo)', description: null, stateRevision: null },
  missions: [
    {
      id: 'MIS-0007',
      title: null,
      status: 'in_progress',
      summary: null,
      startedAt: '2026-03-05T09:00:00.000Z',
      updatedAt: null,
    },
  ],
  checkpoints: [
    {
      id: 'MIS-0007-CKPT-0001',
      missionId: 'MIS-0007',
      createdAt: null,
      summary: null,
      remainingSteps: null,
    },
  ],
  roadmapText: null,
  diagnostics: [
    { severity: 'info', message: 'Fixture "partial" loaded.' },
    { severity: 'error', message: 'Sample error: roadmap source could not be read.' },
  ],
};

export const emptyScenario: DashboardData = {
  isDemo: true,
  overview: { name: 'Tidewatch (demo)', description: 'Fictional project with no recorded work.', stateRevision: 0 },
  missions: [],
  checkpoints: [],
  roadmapText: '',
  diagnostics: [{ severity: 'info', message: 'Fixture "empty" loaded.' }],
};

export const scenarios: Record<ScenarioId, DashboardData> = {
  normal: normalScenario,
  partial: partialScenario,
  empty: emptyScenario,
};

export const scenarioIds = Object.keys(scenarios) as ScenarioId[];
