/**
 * Read-only diagnostics for files an interrupted write can leave behind
 * (SEC-001B.2, DEC-B2-02, FS-CLEAN-001).
 *
 * This only LISTS names. It never opens, reads, follows, repairs or deletes
 * anything, and a name that matches does NOT mean the file is an orphan:
 * every running `mission` command has exactly such a file for a moment. Safe
 * cleanup needs an owner/liveness criterion that does not exist yet.
 */

import { readdirSync } from 'fs';

export type WriteArtifactKind = 'state-temp' | 'lock-staging' | 'recovery-mutex';

export interface WriteArtifact {
  /** Directory entry name (project-controlled text: escape before printing). */
  name: string;
  kind: WriteArtifactKind;
}

const PATTERNS: ReadonlyArray<readonly [RegExp, WriteArtifactKind]> = [
  [/^state\.json\.tmp\./, 'state-temp'],
  [/^state\.json\.lock\.creating\./, 'lock-staging'],
  [/^state\.json\.lock\.recovery(\.creating\..*)?$/, 'recovery-mutex'],
];

/** Entries of the instance directory `rootAbs` that look like write leftovers. Never throws. */
export function findWriteArtifacts(rootAbs: string): WriteArtifact[] {
  let names: string[];
  try {
    names = readdirSync(rootAbs);
  } catch {
    return [];
  }
  const found: WriteArtifact[] = [];
  for (const name of names) {
    for (const [re, kind] of PATTERNS) {
      if (re.test(name)) {
        found.push({ name, kind });
        break;
      }
    }
  }
  return found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** One-line, bounded, human-readable summary; names are JSON-escaped so control characters cannot forge output. */
export function describeWriteArtifacts(artifacts: readonly WriteArtifact[], where: string, maxNames = 3): string {
  const shown = artifacts.slice(0, maxNames).map((a) => JSON.stringify(a.name));
  const more = artifacts.length - shown.length;
  return (
    `${artifacts.length} leftover-looking write file(s) in "${where}": ${shown.join(', ')}${more > 0 ? `, and ${more} more` : ''}. ` +
    'They are present and may belong to a command that is still running; MONOLITH never deletes them (FS-CLEAN-001).'
  );
}
