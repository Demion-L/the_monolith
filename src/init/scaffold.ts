/* eslint-disable no-console */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import type { ProjectConfig } from './types.js';

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

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath: string, content: string): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, content, 'utf8');
}

function stripTemplateSuffix(p: string): string {
  return p.endsWith('.template') ? p.slice(0, -'.template'.length) : p;
}

function copyTemplate(templatePath: string, targetPath: string, vars: Vars): void {
  const content = readFileSync(templatePath, 'utf8');
  writeFile(targetPath, substitute(content, vars));
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

function createEmptyDirs(targetRoot: string, r: string): void {
  const gitkeepDirs = [
    `${r}/memory/working/phases`,
    `${r}/memory/execution/traces`,
    `${r}/protocols/engineering`,
    `${r}/learning/mistakes/architecture`,
    `${r}/learning/mistakes/dependencies`,
    `${r}/learning/mistakes/nonexistent-api`,
    `${r}/learning/mistakes/context-sync`,
    `${r}/learning/mistakes/workflow`,
    `${r}/learning/mistakes/typescript`,
    `${r}/learning/mistakes/documentation`,
    `${r}/adr`,
  ];
  for (const rel of gitkeepDirs) {
    const full = join(targetRoot, rel);
    ensureDir(full);
    writeFileSync(join(full, '.gitkeep'), '', 'utf8');
  }
}

export interface ScaffoldResult {
  filesCreated: number;
  dirsCreated: string[];
}

export async function scaffoldInstance(
  targetDir: string,
  config: ProjectConfig,
): Promise<ScaffoldResult> {
  const vars = buildVars(config);
  const r = config.monolithRoot;
  let filesCreated = 0;
  const dirsCreated: string[] = [];

  // --- Project root files ---
  const projectrootTemplates = join(TEMPLATES_ROOT, 'projectroot');
  if (existsSync(projectrootTemplates)) {
    for (const tplFile of walkDir(projectrootTemplates)) {
      const relPath = relative(projectrootTemplates, tplFile);
      const targetPath = join(targetDir, stripTemplateSuffix(relPath));
      copyTemplate(tplFile, targetPath, vars);
      filesCreated++;
    }
  }

  // --- Monolith instance files ---
  const monolithTemplates = join(TEMPLATES_ROOT, 'monolith');
  if (existsSync(monolithTemplates)) {
    for (const tplFile of walkDir(monolithTemplates)) {
      const relPath = relative(monolithTemplates, tplFile);
      const targetPath = join(targetDir, r, stripTemplateSuffix(relPath));
      copyTemplate(tplFile, targetPath, vars);
      filesCreated++;
    }
  }

  // --- AI tool instruction file (CLAUDE.md / .cursorrules / .windsurfrules) ---
  const instructionFileName = INSTRUCTION_FILE_MAP[config.aiTool];
  if (instructionFileName) {
    const tplPath = join(TEMPLATES_ROOT, 'instruction', instructionFileName);
    if (existsSync(tplPath)) {
      copyTemplate(tplPath, join(targetDir, instructionFileName), vars);
      filesCreated++;
    }
  }

  // --- Empty dirs + .gitkeep ---
  createEmptyDirs(targetDir, r);

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

  console.log(`  ✓ ${filesCreated} files generated`);
  console.log(`  ✓ ${dirsCreated.length + 11} directories created`);

  return { filesCreated, dirsCreated };
}
