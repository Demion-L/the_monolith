import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFileErrorCode } from '../root/index.js';

// Drives every Core ProjectFileErrorCode through the read model by replacing ONLY
// Core's reader; classification (isReadSecurityViolation) stays the real one.
let forced: ProjectFileErrorCode | null = null;
vi.mock('../root/index.js', async (orig) => {
  const real = await orig<typeof import('../root/index.js')>();
  return {
    ...real,
    readProjectFile: (...args: Parameters<typeof real.readProjectFile>) =>
      forced === null
        ? real.readProjectFile(...args)
        : { ok: false as const, code: forced, detail: `RAW-DETAIL /abs/secret/path ${args[1]}` },
  };
});

const { readDashboardModel, FILE_CODE_MAP: MAP } = await import('./dashboard.js');
const { READ_SECURITY_CODES, isReadSecurityViolation } = await import('../root/index.js');

const ALL_CODES = [
  'FILE_MISSING', 'FILE_OUTSIDE_PROJECT', 'FILE_UNRESOLVABLE', 'FILE_NOT_REGULAR', 'FILE_EMPTY', 'FILE_TOO_LARGE',
  'FILE_CHANGED', 'FILE_UNREADABLE', 'FILE_SYMLINK', 'FILE_HARDLINKED', 'READ_BOUNDARY_INVALID', 'READ_UNSUPPORTED_PLATFORM',
] as const satisfies readonly ProjectFileErrorCode[];

// Compile-time: ALL_CODES must list every Core code (a new code fails here too).
type Missing = Exclude<ProjectFileErrorCode, (typeof ALL_CODES)[number]>;
const _exhaustive: [Missing] extends [never] ? true : never = true;
void _exhaustive;

beforeEach(() => { forced = null; });

describe('FILE_CODE_MAP — all 12 Core codes', () => {
  it('has an entry for exactly the 12 Core codes', () => {
    expect(Object.keys(MAP).sort()).toEqual([...ALL_CODES].sort());
    expect(ALL_CODES).toHaveLength(12);
  });

  it.each(ALL_CODES)('%s: status agrees with Core isReadSecurityViolation', (code) => {
    const [status] = MAP[code];
    expect(status === 'forbidden').toBe(isReadSecurityViolation(code));
  });

  it('every Core security code is forbidden, never absent', () => {
    for (const code of READ_SECURITY_CODES) expect(MAP[code][0]).toBe('forbidden');
  });

  it('only FILE_MISSING is absent', () => {
    expect(ALL_CODES.filter((c) => MAP[c][0] === 'absent')).toEqual(['FILE_MISSING']);
  });

  it.each(ALL_CODES)('%s reaches every source as a typed, leak-free report', (code) => {
    forced = code;
    const m = readDashboardModel('/not/used/because/reader/is/replaced');
    const [status, sourceCode] = MAP[code];
    const config = m.diagnostics.sources.find((s) => s.id === 'config')!;
    expect(config).toMatchObject({ status, code: sourceCode });
    // A config that cannot be read fails closed for the rest; none is 'available'.
    expect(m.diagnostics.sources.every((s) => s.status !== 'available')).toBe(true);
    // Only a missing config is a legitimate fresh project; every other code fails closed.
    if (code !== 'FILE_MISSING') expect(m.projectOverview.data).toBeNull();
    const json = JSON.stringify(m);
    expect(json).not.toContain('RAW-DETAIL');
    expect(json).not.toContain('/abs/secret/path');
  });
});
