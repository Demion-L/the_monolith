/* eslint-disable no-console */
import { resolve } from 'path';
import { promptProjectConfig } from './prompts.js';
import { scaffoldInstance, planScaffoldConflicts } from './scaffold.js';
import type { InitOptions } from './types.js';
import { reportWriteWarning } from '../root/index.js';

const CONFLICT_LIST_LIMIT = 20;

/**
 * Thrown when `monolith init` would overwrite existing tracked files.
 * Raised strictly before any write — see planScaffoldConflicts. Carries a
 * non-zero exit via the CLI's top-level main().catch handler.
 */
export class InitConflictError extends Error {
  readonly conflicts: string[];

  constructor(conflicts: string[]) {
    const shown = conflicts.slice(0, CONFLICT_LIST_LIMIT);
    const more = conflicts.length - shown.length;
    const list = shown.map((c) => `    - ${c}`).join('\n');
    super(
      `Refusing to initialize: ${conflicts.length} existing or unsafe path(s) (already present, or a symlink / special file that must not be written through):\n` +
        `${list}\n` +
        (more > 0 ? `    ...and ${more} more\n` : '') +
        '\n' +
        '  monolith init always scaffolds the current working directory and never\n' +
        '  overwrites existing tracked files (re-running it is not an upgrade/force\n' +
        '  mechanism). --yes only skips interactive prompts for a clean directory;\n' +
        '  it does not authorize overwriting existing data.\n' +
        '  Remove, rename, or back up the conflicting file(s) yourself, or run init\n' +
        '  in an empty directory, then re-run.',
    );
    this.name = 'InitConflictError';
    this.conflicts = conflicts;
  }
}

export async function runInit(options: InitOptions = { targetDir: process.cwd() }): Promise<void> {
  const targetDir = resolve(options.targetDir);

  console.log('  Initializing MONOLITH instance...');
  console.log('');

  let config;
  if (options.yes) {
    // Non-interactive: use all defaults
    const { basename } = await import('path');
    config = {
      projectName: basename(targetDir),
      language: 'typescript' as const,
      packageManager: 'pnpm' as const,
      aiTool: 'claude' as const,
      finalizationProtocol: 'finalize-story',
      protocols: ['finalize-story', 'failure-memory-logging', 'governance-evaluation', 'integrity-verification'],
      monolithRoot: '.monolith',
    };
    console.log(`  Project:  ${config.projectName} (defaults applied)`);
    console.log('');
  } else {
    config = await promptProjectConfig();
  }

  // Preflight: must run — and find zero conflicts — before any write, so a
  // conflict is never discovered after half the instance has already been
  // scaffolded (see LESSON-2026-0006 / TD-007).
  const conflicts = planScaffoldConflicts(targetDir, config);
  if (conflicts.length > 0) {
    throw new InitConflictError(conflicts);
  }

  console.log('  Scaffolding instance...');
  console.log('');

  const result = await scaffoldInstance(targetDir, config);
  for (const w of result.warnings) reportWriteWarning(w);

  console.log('');
  console.log('  ✅ MONOLITH instance initialized!');
  console.log('');
  console.log(`  Project:       ${config.projectName}`);
  console.log(`  Root:          ${config.monolithRoot}/`);
  console.log(`  Files created: ${result.filesCreated}`);
  console.log('');
  const instructionFileMap: Partial<Record<string, string>> = {
    claude: 'CLAUDE.md',
    cursor: '.cursorrules',
    windsurf: '.windsurfrules',
  };
  const instructionFile = instructionFileMap[config.aiTool] ?? 'AGENTS.md';

  console.log(`  AI tool:       ${config.aiTool} → ${instructionFile}`);
  console.log('');
  console.log('  Next steps:');
  console.log(`    1. Edit ${instructionFile} — verify skill triggers and paths`);
  console.log('    2. Edit AGENTS.md — add project description');
  console.log(`    3. Edit ${config.monolithRoot}/context/maps/project-map.md — describe your structure`);
  console.log(`    4. Edit ${config.monolithRoot}/context/maps/roadmap-index.md — add your phases`);
  console.log(`    5. Edit ${config.monolithRoot}/protocols/governance/core-invariants.md — set Current Focus`);
  console.log(`    6. Start first story: edit ${config.monolithRoot}/memory/working/active.md`);
  console.log('');
}
