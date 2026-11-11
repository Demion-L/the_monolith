/**
 * A4-CLI-01: `--path` belongs to `idea add`, not to `mission checkpoint`, and a
 * flag a command does not support is an error rather than silently ignored.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { runMissionCheckpoint } from '../coordinatorium/cli.js';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');
const usageLine = (prefix: string): string => source.split('\n').find((l) => l.trim().startsWith(prefix)) ?? '';

describe('A4-CLI-01 help placement', () => {
  it('lists --path under `idea add` and not under `mission checkpoint`', () => {
    expect(usageLine('monolith idea add')).toContain('--path');
    expect(usageLine('monolith mission checkpoint <missionId>')).not.toContain('--path');
    expect(usageLine('monolith mission checkpoint <missionId>')).toContain('--summary');
  });
});

describe('A4-CLI-01 strict flags on `mission checkpoint`', () => {
  it.each([['--path'], ['--paths'], ['--bogus']])('rejects unknown option %s instead of ignoring it', async (flag) => {
    await expect(runMissionCheckpoint(['m-1', '--summary', 's', flag, 'src/'], '/nonexistent-monolith-project')).rejects.toThrow(/Unknown option/);
  });

  it('a value that merely looks like a flag is a value, not an unknown option', async () => {
    // Fails later (no such project), but not with the unknown-option error.
    await expect(runMissionCheckpoint(['m-1', '--summary', '--not-a-flag'], '/nonexistent-monolith-project')).rejects.not.toThrow(/Unknown option/);
  });
});
