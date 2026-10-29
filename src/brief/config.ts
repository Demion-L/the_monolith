/**
 * Minimal `monolith.config.json` reader for the brief subsystem.
 *
 * Mirrors the existing `readMonolithRoot()` duplicated in
 * `src/coordinatorium/cli.ts` and `src/validate/index.ts` — same
 * "duplicate rather than couple CLI layers together" precedent. Adds one
 * new, explicit, optional field: `contextGateway.adrDirs` (DEC-CONTEXT-003 /
 * section 8 — the existing config contract had no way to name additional
 * ADR directories, so this is the minimal extension to it, not a new
 * configuration subsystem).
 *
 * Review finding F-6: a missing config file is a legitimate, silent
 * default (no project has been configured yet). A *present but corrupted*
 * config file is not the same thing and must not be masked as "healthy
 * project, defaults apply" — it is reported via CONFIG_UNREADABLE and
 * forces Completeness: INCOMPLETE, same severity model as STATE_UNREADABLE.
 * Likewise, a present-but-wrong-shape `contextGateway.adrDirs` (not an
 * array) is reported via CONFIG_ADR_DIRS_INVALID rather than silently
 * collapsing to `[]`. Non-string entries *within* an otherwise-valid array
 * are dropped with a lower-severity (warn) note — a partially-junk list is
 * a lesser problem than the field having the wrong shape entirely.
 */

import { readConfigFile, resolveMonolithRoot, DEFAULT_MONOLITH_ROOT } from '../root/index.js';
import { DEFAULT_ADR_DIR } from './constants.js';
import type { BriefDiagnostic } from './types.js';

const DEFAULT_PROJECT_NAME = 'project';

export interface BriefConfig {
  monolithRoot: string;
  projectName: string;
  /**
   * ADR directories to scan, relative to targetDir. Defaults to the canonical
   * `docs/adr`; `monolith.config.json`'s `contextGateway.adrDirs` replaces
   * (does not extend) that default. No legacy directory is scanned implicitly.
   */
  adrDirs: string[];
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Throws RootContainmentError when `monolithRoot` violates the SEC-001A
 * containment policy (see src/root) — the brief never degrades to a default
 * root in that case.
 */
export function readBriefConfig(targetDir: string, diagnostics: BriefDiagnostic[] = []): BriefConfig {
  const defaults: BriefConfig = { monolithRoot: DEFAULT_MONOLITH_ROOT, projectName: DEFAULT_PROJECT_NAME, adrDirs: [DEFAULT_ADR_DIR] };
  const read = readConfigFile(targetDir);

  if (read.status === 'absent') {
    // Absent config is a legitimate, unconfigured project — not an error.
    return defaults;
  }
  if (read.status !== 'ok') {
    const message =
      read.status === 'unreadable'
        ? `monolith.config.json exists but could not be read: ${read.detail}. Proceeding with defaults.`
        : read.status === 'invalid-json'
          ? `monolith.config.json is not valid JSON: ${read.detail}. Proceeding with defaults.`
          : 'monolith.config.json does not contain a JSON object. Proceeding with defaults.';
    diagnostics.push({ code: 'CONFIG_UNREADABLE', severity: 'error', message });
    return defaults;
  }
  const cfg = read.cfg;

  const monolithRoot = resolveMonolithRoot(targetDir, read).monolithRoot;

  let projectName = DEFAULT_PROJECT_NAME;
  const project = cfg.project;
  if (typeof project === 'object' && project !== null && !Array.isArray(project)) {
    const name = (project as Record<string, unknown>).name;
    if (typeof name === 'string' && name.length > 0) projectName = name;
  }

  let adrDirs: string[] = [DEFAULT_ADR_DIR];
  const contextGateway = cfg.contextGateway;
  if (typeof contextGateway === 'object' && contextGateway !== null && !Array.isArray(contextGateway)) {
    const configured = (contextGateway as Record<string, unknown>).adrDirs;
    if (configured !== undefined) {
      if (!Array.isArray(configured)) {
        diagnostics.push({
          code: 'CONFIG_ADR_DIRS_INVALID',
          severity: 'error',
          message: 'monolith.config.json#contextGateway.adrDirs is present but is not an array; using the default ADR directory.',
        });
      } else {
        const stringEntries = configured.filter((d): d is string => typeof d === 'string' && d.length > 0);
        if (stringEntries.length !== configured.length) {
          diagnostics.push({
            code: 'CONFIG_ADR_DIRS_INVALID',
            severity: 'warn',
            message: 'monolith.config.json#contextGateway.adrDirs contains non-string entries; they were dropped.',
          });
        }
        adrDirs = stringEntries;
      }
    }
  }

  return { monolithRoot, projectName, adrDirs };
}
