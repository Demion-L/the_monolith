/* eslint-disable no-console */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, relative, basename } from 'path';
import { fileURLToPath } from 'url';
import type { ProjectConfig } from './types.js';
import {
  SafeWriteError,
  createFile,
  openParent,
  probeTarget,
  projectBoundary,
  resolveMonolithRootValue,
  type WriteBoundary,
  type WriteWarning,
} from '../root/index.js';

const INSTRUCTION_FILE_MAP: Partial<Record<ProjectConfig['aiTool'], string>> = {
  claude: 'CLAUDE.md',
  cursor: '.cursorrules',
  windsurf: '.windsurfrules',
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Works both from dist/init/ (compiled) and src/init/ (tsx)
const TEMPLATES_ROOT = resolve(__dirname, '..', '..', 'templates', 'default-instance');

type Vars = Record<string, string>;

function substitute(content: string, vars: Vars): string {
  return content.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

function stripTemplateSuffix(p: string): string {
  return p.endsWith('.template') ? p.slice(0, -'.template'.length) : p;
}

/**
 * Everything init writes goes through the safe-write primitive (SEC-001B.2,
 * ADR-012), against a PROJECT boundary: `targetDir` is the project root, every
 * component below it must be a real directory (a symlink is refused even when
 * it stays inside the project), and a file is created without overwriting
 * anything — a symlink (also a dangling one), FIFO or file at the target is
 * refused. Each file becomes visible only once completely written. Init as a
 * whole is NOT atomic and NOT coordinated between processes (SEC-001B.3).
 */
interface Writer {
  boundary: WriteBoundary;
  warnings: WriteWarning[];
  /** Every file published (templates and .gitkeep placeholders). */
  created: number;
  /** Template files only — what `filesCreated` has always counted. */
  templates: number;
}

/** Documents follow the umask (as before); the runtime state file is owner-only. */
function writeNew(w: Writer, targetPath: string, content: string, asState: boolean): void {
  const parent = openParent(w.boundary, dirname(targetPath), { create: true });
  const outcome = createFile(parent, basename(targetPath), content, {
    ...(asState ? { mode: 0o600 } : { mode: 0o666, exactMode: false }),
    durability: 'file',
  });
  w.warnings.push(...outcome.warnings);
  w.created++;
}

function copyTemplate(w: Writer, templatePath: string, targetPath: string, vars: Vars, asState = false): void {
  writeNew(w, targetPath, substitute(readFileSync(templatePath, 'utf8'), vars), asState);
  w.templates++;
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkDir(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

function buildVars(config: ProjectConfig): Vars {
  const r = config.monolithRoot;
  return {
    PROJECT_NAME: config.projectName,
    LANGUAGE: config.language,
    PACKAGE_MANAGER: config.packageManager,
    AI_TOOL: config.aiTool,
    MONOLITH_ROOT: r,
    FINALIZATION_PROTOCOL: config.finalizationProtocol,
    PROTOCOLS_JSON: JSON.stringify(config.protocols, null, 2)
      .split('\n')
      .join('\n  '),
    MISTAKE_ROOTS_JSON: JSON.stringify(
      [`${r}/learning/mistakes`, `${r}/memory/errors`],
      null,
      2,
    )
      .split('\n')
      .join('\n  '),
    DRIFT_LOG_PATH: `${r}/enforcement/drift-log.json`,
  };
}

// Relative to config.monolithRoot (`r`). Shared between createEmptyDirs
// (what init writes) and planScaffoldConflicts (what init must refuse to
// overwrite) so the two can never drift apart — see gitkeepTargets().
const GITKEEP_DIRS = [
  'memory/working/phases',
  'memory/execution/traces',
  'protocols/engineering',
  'learning/mistakes/architecture',
  'learning/mistakes/dependencies',
  'learning/mistakes/nonexistent-api',
  'learning/mistakes/context-sync',
  'learning/mistakes/workflow',
  'learning/mistakes/typescript',
  'learning/mistakes/documentation',
];

/** `.gitkeep` paths (relative to targetDir) that init creates for `r`. */
function gitkeepTargets(r: string): string[] {
  return GITKEEP_DIRS.map((rel) => `${r}/${rel}/.gitkeep`);
}

function createEmptyDirs(w: Writer, targetRoot: string, r: string): void {
  for (const rel of GITKEEP_DIRS) {
    const full = join(targetRoot, r, rel);
    // An existing .gitkeep (possibly user-authored, non-empty) must never be
    // overwritten. planScaffoldConflicts() is expected to have already
    // refused the run in this case; this is the authoritative second guard:
    // creation is exclusive, so an existing entry of any kind is an error.
    writeNew(w, join(full, '.gitkeep'), '', false);
  }
}

export interface ScaffoldResult {
  filesCreated: number;
  dirsCreated: string[];
  /** Non-fatal write findings (e.g. best-effort platform). */
  warnings: WriteWarning[];
}

/**
 * Preflight: compute every tracked template target path scaffoldInstance
 * would write, and return the ones that already exist on disk — or that cannot
 * be written safely (a symlink, including a dangling one, at the target or in
 * a parent component; a FIFO or other special file). Must be called — and
 * found empty — before scaffoldInstance runs, so a conflict is caught before
 * any file is written (no half-scaffolded instance). This is advice for a
 * clean error message; the exclusive creation in scaffoldInstance is the
 * authoritative check.
 *
 * `state.json` is intentionally excluded when it is a regular file:
 * scaffoldInstance never overwrites it (mutable Coordinatorium runtime data,
 * ADR-008), so its presence is not a conflict. A symlink there still is.
 */
export function planScaffoldConflicts(targetDir: string, config: ProjectConfig): string[] {
  // SEC-001A: the programmatic API enforces the same root policy as the CLI.
  const r = resolveMonolithRootValue(targetDir, config.monolithRoot).monolithRoot;
  const conflicts: string[] = [];

  const boundary = projectBoundary(targetDir);
  const check = (targetPath: string, regularFileIsFine = false): void => {
    const probe = probeTarget(boundary, targetPath);
    if (probe.state === 'free') return;
    if (probe.state === 'exists' && regularFileIsFine) return;
    const rel = relative(targetDir, probe.path);
    if (!conflicts.includes(rel)) conflicts.push(rel);
  };

  const projectrootTemplates = join(TEMPLATES_ROOT, 'projectroot');
  if (existsSync(projectrootTemplates)) {
    for (const tplFile of walkDir(projectrootTemplates)) {
      const relPath = relative(projectrootTemplates, tplFile);
      check(join(targetDir, stripTemplateSuffix(relPath)));
    }
  }

  const monolithTemplates = join(TEMPLATES_ROOT, 'monolith');
  if (existsSync(monolithTemplates)) {
    for (const tplFile of walkDir(monolithTemplates)) {
      const relPath = relative(monolithTemplates, tplFile);
      const strippedRelPath = stripTemplateSuffix(relPath);
      check(join(targetDir, r, strippedRelPath), strippedRelPath === 'state.json');
    }
  }

  const instructionFileName = INSTRUCTION_FILE_MAP[config.aiTool];
  if (instructionFileName) check(join(targetDir, instructionFileName));

  for (const rel of gitkeepTargets(r)) check(join(targetDir, rel));

  return conflicts;
}

export async function scaffoldInstance(
  targetDir: string,
  config: ProjectConfig,
): Promise<ScaffoldResult> {
  // SEC-001A: validate before any write; throws RootContainmentError.
  const r = resolveMonolithRootValue(targetDir, config.monolithRoot).monolithRoot;
  const vars = buildVars({ ...config, monolithRoot: r });
  const dirsCreated: string[] = [];

  // `targetDir` is the project root the user pointed init at (it must exist,
  // as resolveMonolithRootValue already requires). Everything below it is checked.
  const w: Writer = { boundary: projectBoundary(targetDir), warnings: [], created: 0, templates: 0 };

  try {
    // --- Project root files ---
    const projectrootTemplates = join(TEMPLATES_ROOT, 'projectroot');
    if (existsSync(projectrootTemplates)) {
      for (const tplFile of walkDir(projectrootTemplates)) {
        const relPath = relative(projectrootTemplates, tplFile);
        copyTemplate(w, tplFile, join(targetDir, stripTemplateSuffix(relPath)), vars);
      }
    }

    // --- Monolith instance files ---
    const monolithTemplates = join(TEMPLATES_ROOT, 'monolith');
    if (existsSync(monolithTemplates)) {
      for (const tplFile of walkDir(monolithTemplates)) {
        const relPath = relative(monolithTemplates, tplFile);
        const strippedRelPath = stripTemplateSuffix(relPath);
        const targetPath = join(targetDir, r, strippedRelPath);
        const isState = strippedRelPath === 'state.json';

        // Coordinatorium state (ADR-008) is mutable runtime data, not a
        // document template — re-running init must never clobber missions
        // an existing instance has already recorded. Only a regular file is
        // left alone; a symlink or special file there is still refused.
        if (isState && probeTarget(w.boundary, targetPath).state === 'exists') continue;

        copyTemplate(w, tplFile, targetPath, vars, isState);
      }
    }

    // --- AI tool instruction file (CLAUDE.md / .cursorrules / .windsurfrules) ---
    const instructionFileName = INSTRUCTION_FILE_MAP[config.aiTool];
    if (instructionFileName) {
      const tplPath = join(TEMPLATES_ROOT, 'instruction', instructionFileName);
      if (existsSync(tplPath)) copyTemplate(w, tplPath, join(targetDir, instructionFileName), vars);
    }

    // --- Empty dirs + .gitkeep ---
    createEmptyDirs(w, targetDir, r);
  } catch (err) {
    if (err instanceof SafeWriteError && w.created > 0) {
      throw new SafeWriteError(
        `${err.message} ${w.created} file(s) had already been created before this failure; ` +
          'init is not transactional and does not roll them back.',
        { code: err.code, phase: err.phase, publication: err.publication, path: err.path, tmp: err.tmp, cause: err.cause },
      );
    }
    throw err;
  }

  // Track dirs created
  dirsCreated.push(
    r,
    `${r}/memory`,
    `${r}/context`,
    `${r}/protocols`,
    `${r}/skills`,
    `${r}/governance`,
    `${r}/learning`,
    `${r}/tests`,
    `${r}/adr`,
  );

  console.log(`  ✓ ${w.templates} files generated`);
  console.log(`  ✓ ${dirsCreated.length + 11} directories created`);

  return { filesCreated: w.templates, dirsCreated, warnings: w.warnings };
}
