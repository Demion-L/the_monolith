import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { ReconciliationResultDto, ValidationResultDto } from '../../../src/readmodel/diagnostics-types';
import type { StateProvenanceView } from '../../../src/readmodel/types';
import DiagnosticsPanel from '../components/DiagnosticsPanel.vue';
import OperationalState from '../components/OperationalState.vue';
import ReconciliationCard from '../components/ReconciliationCard.vue';
import ValidationCard from '../components/ValidationCard.vue';
import { normalScenario } from '../fixtures/dashboard';
import {
  DiagnosticsError,
  RECONCILE_ENDPOINT,
  VALIDATE_ENDPOINT,
  createRunner,
  isReconciliationResult,
  isValidationResult,
  runValidationRequest,
} from '../live/diagnostics';

const check = (id: 'configuration' | 'instance' | 'templates', passed: boolean, message: string | null = null) => ({
  id, label: id[0].toUpperCase() + id.slice(1), passed, message, note: null as string | null,
});
const PASS: ValidationResultDto = { result: 'PASS', checks: [check('configuration', true), check('instance', true), check('templates', true)], warning: null };
const FAIL: ValidationResultDto = {
  result: 'FAIL',
  checks: [check('configuration', true), check('instance', false, 'missing .monolith/protocols/'), check('templates', true)],
  warning: null,
};

const RECON: ReconciliationResultDto = {
  evidence: 'COMPLETE', freshness: 'FRESH', lastStateUpdate: null, conflicts: [], unrecordedWork: [], unattributed: [],
  evidenceIssues: [], documents: [], actions: [], limitations: ['A commit is not evidence that a work item is complete.'], truncated: false,
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const pill = (w: ReturnType<typeof mount>) => w.get('[data-testid="pill"]').text();

describe('Project validation card', () => {
  it('starts as NOT RUN and shows no PASS before a run', () => {
    const w = mount(ValidationCard, { props: { runner: createRunner(() => Promise.resolve(PASS)) } });
    expect(pill(w)).toBe('NOT RUN');
    expect(w.text()).not.toContain('PASS');
    expect(w.get('[data-testid="run-validation"]').text()).toBe('Run Validation');
    expect(w.find('[data-testid="validation-time"]').exists()).toBe(false);
  });

  it('shows RUNNING, disables the button and sends one request for repeated clicks', async () => {
    const d = deferred<ValidationResultDto>();
    const request = vi.fn(() => d.promise);
    const w = mount(ValidationCard, { props: { runner: createRunner(request) } });
    const button = w.get('[data-testid="run-validation"]');
    await button.trigger('click');
    await button.trigger('click');
    await button.trigger('click');
    expect(request).toHaveBeenCalledTimes(1);
    expect(pill(w)).toBe('RUNNING');
    expect(button.attributes('disabled')).toBeDefined();
    expect(w.get('section, article').attributes('aria-busy')).toBe('true');
    d.resolve(PASS);
    await flushPromises();
    expect(pill(w)).toBe('PASS');
    expect(button.attributes('disabled')).toBeUndefined();
  });

  it('shows the three checks, the count and the time of the last run on PASS', async () => {
    const w = mount(ValidationCard, { props: { runner: createRunner(() => Promise.resolve(PASS)) } });
    await w.get('[data-testid="run-validation"]').trigger('click');
    await flushPromises();
    expect(w.findAll('[data-testid="validation-check"]').map((c) => c.find('strong').text())).toEqual(['Configuration', 'Instance', 'Templates']);
    expect(w.get('[data-testid="validation-summary"]').text()).toBe('3 of 3 checks passed');
    expect(w.get('[data-testid="validation-time"]').text()).toMatch(/^Last run \d\d:\d\d:\d\d$/);
    expect(w.get('[data-testid="run-validation"]').text()).toBe('Run Validation again');
  });

  it('shows FAIL with a plain-language reason for the failed check only', async () => {
    const w = mount(ValidationCard, { props: { runner: createRunner(() => Promise.resolve(FAIL)) } });
    await w.get('[data-testid="run-validation"]').trigger('click');
    await flushPromises();
    expect(pill(w)).toBe('FAIL');
    expect(w.get('[data-testid="validation-summary"]').text()).toBe('2 of 3 checks passed');
    const reasons = w.findAll('[data-testid="validation-reason"]');
    expect(reasons).toHaveLength(1);
    expect(reasons[0].text()).toBe('Problem: missing .monolith/protocols/');
  });

  it('a repeated run drops the previous result: nothing stale is shown while RUNNING', async () => {
    const second = deferred<ValidationResultDto>();
    const results = [Promise.resolve(PASS), second.promise];
    const w = mount(ValidationCard, { props: { runner: createRunner(() => results.shift()!) } });
    await w.get('[data-testid="run-validation"]').trigger('click');
    await flushPromises();
    expect(pill(w)).toBe('PASS');
    await w.get('[data-testid="run-validation"]').trigger('click');
    expect(pill(w)).toBe('RUNNING');
    expect(w.text()).not.toContain('PASS');
    second.resolve(FAIL);
    await flushPromises();
    expect(pill(w)).toBe('FAIL');
  });

  it('a failed request is ERROR, never PASS or FAIL, and can be retried', async () => {
    const request = vi.fn<() => Promise<ValidationResultDto>>()
      .mockRejectedValueOnce(new DiagnosticsError('The MONOLITH API is unreachable.'))
      .mockResolvedValueOnce(PASS);
    const w = mount(ValidationCard, { props: { runner: createRunner(request) } });
    await w.get('[data-testid="run-validation"]').trigger('click');
    await flushPromises();
    expect(pill(w)).toBe('ERROR');
    expect(w.get('[data-testid="validation-error"]').text()).toContain('The MONOLITH API is unreachable.');
    expect(w.findAll('[data-testid="validation-check"]')).toHaveLength(0);
    await w.get('[data-testid="run-validation"]').trigger('click');
    await flushPromises();
    expect(pill(w)).toBe('PASS');
  });
});

describe('diagnostic client', () => {
  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  it('POSTs a fixed endpoint with an empty JSON body and no credentials', async () => {
    const f = vi.fn(() => ok(PASS)) as unknown as typeof fetch;
    await runValidationRequest(f);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(VALIDATE_ENDPOINT);
    expect(RECONCILE_ENDPOINT).toBe('/api/diagnostics/reconcile');
    expect(init).toMatchObject({ method: 'POST', body: '{}', credentials: 'omit', redirect: 'error' });
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('turns server error codes into fixed human text and never echoes the response', async () => {
    const f = (() => Promise.resolve(new Response(JSON.stringify({ error: { kind: 'diagnostics', code: 'DIAGNOSTICS_FAILED', message: '/home/secret' } }), { status: 500 }))) as unknown as typeof fetch;
    await expect(runValidationRequest(f)).rejects.toThrow(/could not be completed/);
    await expect(runValidationRequest(f)).rejects.not.toThrow(/secret/);
  });

  it('rejects an unreachable server, invalid JSON and a wrong shape', async () => {
    await expect(runValidationRequest((() => Promise.reject(new Error('x'))) as unknown as typeof fetch)).rejects.toThrow(/unreachable/);
    await expect(runValidationRequest((() => Promise.resolve(new Response('nope', { status: 200 }))) as unknown as typeof fetch)).rejects.toThrow(/not valid JSON/);
    await expect(runValidationRequest((() => ok({ result: 'PASS' })) as unknown as typeof fetch)).rejects.toThrow(/unexpected data shape/);
  });

  it('never trusts an overall PASS that its own checks contradict', () => {
    expect(isValidationResult(PASS)).toBe(true);
    expect(isValidationResult({ ...FAIL, result: 'PASS' })).toBe(false);
    expect(isValidationResult({ ...PASS, checks: [] })).toBe(false);
    expect(isReconciliationResult(RECON)).toBe(true);
    expect(isReconciliationResult({ ...RECON, freshness: 'MAYBE' })).toBe(false);
  });
});

describe('State reconciliation card', () => {
  async function run(result: ReconciliationResultDto) {
    const w = mount(ReconciliationCard, { props: { runner: createRunner(() => Promise.resolve(result)) } });
    await w.get('[data-testid="run-reconciliation"]').trigger('click');
    await flushPromises();
    return w;
  }

  it('starts as NOT RUN with its own button', () => {
    const w = mount(ReconciliationCard, { props: { runner: createRunner(() => Promise.resolve(RECON)) } });
    expect(pill(w)).toBe('NOT RUN');
    expect(w.get('[data-testid="run-reconciliation"]').text()).toBe('Run Reconciliation');
  });

  it('shows RUNNING while the request is open', async () => {
    const d = deferred<ReconciliationResultDto>();
    const w = mount(ReconciliationCard, { props: { runner: createRunner(() => d.promise) } });
    await w.get('[data-testid="run-reconciliation"]').trigger('click');
    expect(pill(w)).toBe('RUNNING');
    expect(w.get('[data-testid="run-reconciliation"]').attributes('disabled')).toBeDefined();
    d.resolve(RECON);
    await flushPromises();
    expect(pill(w)).toBe('COMPLETE');
  });

  it('shows a confirmed conflict as the two sources side by side, not as a text wall', async () => {
    const w = await run({
      ...RECON, freshness: 'STALE',
      conflicts: [{ summary: 'long sentence', sources: [{ document: 'active.md', claim: 'No active story' }, { document: 'roadmap-index.md', claim: 'Active Story: SUPPORT-003' }] }],
    });
    const c = w.get('[data-testid="conflict"]');
    expect(c.get('.conflict-title').text()).toBe('STATE CONFLICT');
    expect(c.findAll('.conflict-source').map((s) => [s.get('code').text(), s.get('span').text()])).toEqual([
      ['active.md', 'No active story'],
      ['roadmap-index.md', 'Active Story: SUPPORT-003'],
    ]);
    expect(c.text()).not.toContain('long sentence');
  });

  it('UNKNOWN evidence and UNKNOWN freshness are shown as unknown, never as STALE or as a finding', async () => {
    const w = await run({
      ...RECON, evidence: 'UNKNOWN', freshness: 'UNKNOWN',
      evidenceIssues: [{ code: 'GIT_UNAVAILABLE', summary: 'Cannot compare state with history: the project is not inside a git repository.', evidence: [] }],
    });
    expect(pill(w)).toBe('UNKNOWN');
    expect(w.get('[data-testid="reconciliation-freshness"]').text()).toContain('UNKNOWN');
    expect(w.text()).not.toContain('STALE');
    expect(w.find('[data-testid="conflict"]').exists()).toBe(false);
    expect(w.find('[data-testid="reconciliation-nothing"]').exists()).toBe(false);
    expect(w.get('[data-testid="reconciliation-issues"]').text()).toContain('not inside a git repository');
  });

  it('INCOMPLETE evidence is yellow and says that absence of findings proves little', async () => {
    const w = await run({ ...RECON, evidence: 'INCOMPLETE', evidenceIssues: [{ code: 'GIT_HISTORY_TRUNCATED', summary: 'cut', evidence: [] }] });
    expect(pill(w)).toBe('INCOMPLETE');
    expect(w.get('[data-testid="pill"]').classes()).toContain('pill-warn');
    expect(w.get('[data-testid="reconciliation-evidence"]').text()).toContain('Absence of findings proves little');
  });

  it('keeps confirmed, suspected and missing-evidence findings apart, and labels suspicion as not confirmed', async () => {
    const w = await run({
      ...RECON, freshness: 'STALE',
      unrecordedWork: [{ id: 'ZZZ-042', totalCommits: 2, commits: [{ sha: 'abc1234', subject: 'feat: ZZZ-042 thing' }] }],
      unattributed: [{ code: 'UNATTRIBUTED_ACTIVITY', summary: '3 commit(s) change files without naming a work item', evidence: ['abc1234 chore: x'] }],
      actions: ['Verify the status of ZZZ-042 and record it if appropriate.'],
    });
    expect(w.get('[data-testid="reconciliation-unrecorded"]').text()).toContain('Referenced is not the same as complete');
    expect(w.get('[data-testid="reconciliation-unattributed"] h4').text()).toContain('not confirmed');
    expect(w.find('[data-testid="conflict"]').exists()).toBe(false);
    expect(w.get('[data-testid="reconciliation-actions"] h4').text()).toContain('none is applied');
    expect(w.findAll('button').map((b) => b.text())).toEqual(['Run Reconciliation again']);
  });

  it('COMPLETE with nothing found says so without claiming correctness; limitations are collapsed', async () => {
    const w = await run(RECON);
    expect(w.get('[data-testid="reconciliation-nothing"]').text()).toContain('not a guarantee');
    expect(w.get('details[data-testid="reconciliation-limitations"]').attributes('open')).toBeUndefined();
  });

  it('ERROR on a failed request', async () => {
    const w = mount(ReconciliationCard, { props: { runner: createRunner(() => Promise.reject(new DiagnosticsError('The MONOLITH API is unreachable.'))) } });
    await w.get('[data-testid="run-reconciliation"]').trigger('click');
    await flushPromises();
    expect(pill(w)).toBe('ERROR');
  });
});

describe('Operational state', () => {
  const base: StateProvenanceView = {
    mode: 'shared', location: 'git-common-dir', localReason: null, statePath: '<git-common-dir>/monolith/state.json',
    revision: 21, schemaVersion: 3, monolithVersion: '0.2.0-beta.1', repositoryIdentity: 'abc123', worktreeCount: 3,
    splitBrain: { detected: false, canonicalMissingWithLocalData: false, localStates: [] },
  };
  const text = (w: ReturnType<typeof mount>, id: string) => w.get(`[data-testid="${id}"]`).text();

  it('shows the provenance Core reports, with the symbolic path as given', () => {
    const w = mount(OperationalState, { props: { provenance: base } });
    expect(text(w, 'opstate-mode')).toBe('SHARED');
    expect(text(w, 'opstate-revision')).toBe('21');
    expect(text(w, 'opstate-schema')).toBe('v3');
    expect(text(w, 'opstate-worktrees')).toBe('3');
    expect(text(w, 'opstate-path')).toBe('<git-common-dir>/monolith/state.json');
    expect(text(w, 'opstate-consistency')).toContain('NOT CHECKED');
    expect(text(w, 'opstate-consistency')).toContain('State consistency has not been independently verified.');
    expect(text(w, 'opstate-consistency')).not.toMatch(/PASS|VERIFIED\b(?<!NOT VERIFIED)/);
    expect(w.find('[data-testid="opstate-initialization"]').exists()).toBe(false);
    expect(w.find('[data-testid="split-brain"]').exists()).toBe(false);
  });

  it('unknown values are UNKNOWN, not 0 and not blank', () => {
    const w = mount(OperationalState, { props: { provenance: { ...base, revision: null, schemaVersion: null, worktreeCount: null, repositoryIdentity: null } } });
    expect(text(w, 'opstate-revision')).toBe('UNKNOWN');
    expect(text(w, 'opstate-schema')).toBe('UNKNOWN');
    expect(text(w, 'opstate-worktrees')).toBe('UNKNOWN');
    expect(text(w, 'opstate-repo')).toBe('Not a git repository');
  });

  describe('canonical state absent (normal for a fresh project)', () => {
    const absent = { ...base, revision: null, schemaVersion: null };
    it('shows NOT INITIALIZED with dashes, only for status absent', () => {
      const w = mount(OperationalState, { props: { provenance: absent, stateSource: 'absent' } });
      expect(text(w, 'opstate-initialization')).toContain('NOT INITIALIZED');
      expect(text(w, 'opstate-initialization')).toContain('No operational state has been recorded yet.');
      expect(text(w, 'opstate-revision')).toContain('—');
      expect(text(w, 'opstate-revision')).toContain('Values become available after the first state write.');
      expect(text(w, 'opstate-schema')).toBe('—');
      expect(text(w, 'opstate-revision')).not.toContain('UNKNOWN');
    });
    it('does not present anything else as NOT INITIALIZED', () => {
      for (const s of [undefined, 'available', 'corrupt', 'unreadable', 'forbidden'] as const) {
        const w = mount(OperationalState, { props: { provenance: absent, stateSource: s } });
        expect(w.find('[data-testid="opstate-initialization"]').exists()).toBe(false);
        expect(text(w, 'opstate-revision')).toBe('UNKNOWN');
        expect(text(w, 'opstate-schema')).toBe('UNKNOWN');
      }
    });
    it('shows real values when the state file is available', () => {
      const w = mount(OperationalState, { props: { provenance: base, stateSource: 'available' } });
      expect(text(w, 'opstate-revision')).toBe('21');
      expect(text(w, 'opstate-schema')).toBe('v3');
      expect(w.find('[data-testid="opstate-initialization"]').exists()).toBe(false);
    });
    it('keeps the split-brain warning and never claims NOT INITIALIZED over local state', () => {
      const provenance = { ...absent, splitBrain: { detected: true, canonicalMissingWithLocalData: true, localStates: [
        { path: '.monolith/state.json', status: 'ok' as const, schemaVersion: 3, revision: 7, missionCount: 2, checkpointCount: 5, currentWorktree: true },
      ] } };
      const w = mount(OperationalState, { props: { provenance, stateSource: 'absent' } });
      expect(w.find('[data-testid="split-brain"]').exists()).toBe(true);
      expect(w.find('[data-testid="opstate-initialization"]').exists()).toBe(false);
      expect(text(w, 'opstate-consistency')).toContain('SPLIT-BRAIN');
    });
    it('does not turn a not-performed validation into a pass', () => {
      const w = mount(OperationalState, { props: { provenance: absent, stateSource: 'absent' } });
      expect(w.text()).not.toMatch(/\bPASS\b|\bOK\b|VALID\b/);
    });
  });

  it('warns about split-brain, points to the CLI and offers no merge or adopt action', () => {
    const w = mount(OperationalState, {
      props: {
        provenance: {
          ...base, mode: 'local', location: 'project-local', localReason: 'ISOLATED_MODE',
          splitBrain: {
            detected: true, canonicalMissingWithLocalData: false,
            localStates: [
              { path: '.monolith/state.json', status: 'ok', schemaVersion: 3, revision: 7, missionCount: 2, checkpointCount: 5, currentWorktree: true },
              { path: '../other/.monolith/state.json', status: 'corrupt', schemaVersion: null, revision: null, missionCount: null, checkpointCount: null, currentWorktree: false },
            ],
          },
        },
      },
    });
    const sb = w.get('[data-testid="split-brain"]');
    expect(sb.attributes('role')).toBe('alert');
    expect(sb.text()).toContain('Independent states were found (2)');
    expect(sb.text()).toContain('monolith state status');
    expect(sb.text()).toContain('never merges');
    expect(sb.findAll('li')).toHaveLength(2);
    expect(text(w, 'opstate-consistency')).toContain('SPLIT-BRAIN');
    expect(w.findAll('button')).toHaveLength(0);
  });

  it('states plainly when the data source does not report the location', () => {
    const w = mount(OperationalState, { props: { provenance: undefined } });
    expect(w.find('[data-testid="opstate-unavailable"]').exists()).toBe(true);
  });
});

describe('Diagnostics section', () => {
  const live = { ...normalScenario, isDemo: false };
  const runners = () => ({
    validation: createRunner(() => Promise.resolve(PASS)),
    reconciliation: createRunner(() => Promise.resolve(RECON)),
  });

  it('keeps source availability apart from validation, with its own question', () => {
    const w = mount(DiagnosticsPanel, { props: { data: live, runners: runners() } });
    const src = w.get('[data-testid="source-availability"]').text();
    expect(src).toContain('Can MONOLITH read the sources it needs?');
    expect(src).toContain('This is not a validation result');
    expect(w.get('[data-testid="validation-card"]').text()).toContain("Did the project pass MONOLITH's existing checks?");
    expect(w.get('[data-testid="reconciliation-card"]').text()).toContain('contradictions between the sources');
    expect(w.text()).not.toMatch(/health score/i);
  });

  describe('absent state source', () => {
    const msg = (m: string) => ({ severity: 'warning' as const, message: m });
    const withSources = (extra: object, problems: { severity: 'warning'; message: string }[], available: number) =>
      ({ ...live, sources: { total: 4, available }, diagnostics: problems, ...extra }) as typeof live;
    const note = (w: ReturnType<typeof mount>) => w.find('[data-testid="state-absent-note"]');

    it('explains the absent state source and keeps 3/4, PARTIAL and the problem line', () => {
      const data = withSources({ stateSource: 'absent' }, [msg('state (<git-common-dir>/monolith/state.json): absent [SOURCE_ABSENT]')], 3);
      const w = mount(DiagnosticsPanel, { props: { data, runners: runners() } });
      expect(note(w).text()).toContain('expected');
      expect(note(w).text()).toContain('first state write');
      expect(w.get('[data-testid="source-summary"]').text()).toBe('3/4 sources available');
      expect(w.get('[data-testid="source-availability"] [data-testid="pill"]').text()).toBe('PARTIAL');
      expect(w.get('[data-testid="source-problems"]').text()).toContain('SOURCE_ABSENT');
      expect(w.get('[data-testid="source-availability"]').text()).not.toMatch(/4\/4|\bPASS\b/);
    });
    it('does not explain other absent sources, and keeps their problems', () => {
      const data = withSources({ stateSource: 'available' }, [msg('roadmap (docs/roadmap.md): absent [SOURCE_ABSENT]')], 3);
      const w = mount(DiagnosticsPanel, { props: { data, runners: runners() } });
      expect(note(w).exists()).toBe(false);
      expect(w.get('[data-testid="source-problems"]').text()).toContain('roadmap');
    });
    it('keeps other problems visible next to an absent state', () => {
      const data = withSources({ stateSource: 'absent' }, [msg('state (x): absent [SOURCE_ABSENT]'), msg('roadmap (y): absent [SOURCE_ABSENT]')], 2);
      const w = mount(DiagnosticsPanel, { props: { data, runners: runners() } });
      expect(w.get('[data-testid="source-problems"]').text()).toContain('2 problems');
      expect(w.get('[data-testid="source-problems"]').text()).toContain('roadmap');
    });
    it('is silent for other state statuses, an unreported status and demo data', () => {
      for (const st of ['corrupt', 'unreadable', 'forbidden', undefined] as const) {
        const data = withSources(st === undefined ? {} : { stateSource: st }, [msg('state (x): problem')], 3);
        expect(note(mount(DiagnosticsPanel, { props: { data, runners: runners() } })).exists()).toBe(false);
      }
      const demo = { ...withSources({ stateSource: 'absent' }, [], 3), isDemo: true } as typeof live;
      expect(note(mount(DiagnosticsPanel, { props: { data: demo } })).exists()).toBe(false);
    });
  });

  it('running one diagnostic does not run, or change the state of, the other', async () => {
    const w = mount(DiagnosticsPanel, { props: { data: live, runners: runners() } });
    await w.get('[data-testid="run-validation"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="validation-card"] [data-testid="pill"]').text()).toBe('PASS');
    expect(w.get('[data-testid="reconciliation-card"] [data-testid="pill"]').text()).toBe('NOT RUN');
  });

  it('offers no runs for demo data', () => {
    const w = mount(DiagnosticsPanel, { props: { data: normalScenario } });
    expect(w.find('[data-testid="run-validation"]').exists()).toBe(false);
    expect(w.find('[data-testid="run-reconciliation"]').exists()).toBe(false);
    expect(w.find('[data-testid="runs-unavailable"]').exists()).toBe(true);
    expect(w.find('[data-testid="operational-state"]').exists()).toBe(false);
  });
});
