/**
 * `monolith update` (DX-UPDATE-001): bring an existing instance up to the
 * Idea Capture & Recall infrastructure without touching project memory.
 *
 * Contract (see docs/reference/cli.md → `monolith update`):
 *  - No template version is stored in an instance, so components are detected
 *    by content (does the file already carry the Idea Capture wiring?).
 *  - The only thing `--apply` ever does is CREATE a missing, MONOLITH-owned
 *    file (the `idea-capture` skill). Nothing that exists is overwritten,
 *    appended to or rewritten — mixed files (CLAUDE.md, AGENTS.md, routing-map,
 *    skills index) are reported as CONFLICT with the exact text to add.
 *  - Writes go through the safe-write primitive (project boundary, no symlinks,
 *    exclusive create). Reads use the unified bounded safe read. Not
 *    transactional and not coordinated between processes (SEC-001B.3); a
 *    re-run is the recovery.
 */

import { lstatSync, readFileSync } from 'fs';
import { dirname, join, basename, resolve } from 'path';
import {
  SafeWriteError,
  RootContainmentError,
  createFile,
  openParent,
  projectBoundary,
  readConfigFile,
  readProjectFile,
  resolveMonolithRoot,
  type WriteWarning,
} from '../root/index.js';
import { TEMPLATES_ROOT, substitute } from '../init/scaffold.js';

export type UpdateAction = 'ADD' | 'UNCHANGED' | 'CONFLICT' | 'SKIP';

export interface UpdateItem {
  /** Path relative to the project root, `/`-separated. */
  path: string;
  action: UpdateAction;
  /** Why, in one line. */
  reason: string;
  /** For CONFLICT: the text the user needs to add by hand. */
  proposal?: string;
  /** For ADD: what will be created. */
  content?: string;
}

export interface UpdatePlan {
  monolithRoot: string;
  items: UpdateItem[];
}

const INSTRUCTION_FILES = ['CLAUDE.md', '.cursorrules', '.windsurfrules'] as const;
const AI_TOOL_FILE: Record<string, string> = { claude: 'CLAUDE.md', cursor: '.cursorrules', windsurf: '.windsurfrules' };

function readTemplate(rel: string, vars: Record<string, string>): string {
  return substitute(readFileSync(join(TEMPLATES_ROOT, rel), 'utf8'), vars);
}

/** Text from the first line matching `start` up to (excluding) the first later line matching `end`, or the end. */
function section(text: string, start: RegExp, end: RegExp | null): string | null {
  const lines = text.split('\n');
  const from = lines.findIndex((l) => start.test(l));
  if (from < 0) return null;
  let to = lines.length;
  if (end) {
    for (let i = from + 1; i < lines.length; i++) {
      if (end.test(lines[i])) {
        to = i;
        break;
      }
    }
  }
  return lines.slice(from, to).join('\n').replace(/\s+$/, '');
}

/** The Idea Capture text an existing instruction file (CLAUDE.md, …) is missing. */
function instructionProposal(template: string): string {
  const parts = [
    section(template, /^## Capturing Ideas/, /^---/),
    section(template, /idea-capture\/SKILL\.md/, /^(?!\|)/),
    section(template, /^\*\*Idea Capture\.\*\*/, /^\s*$/),
  ].filter((p): p is string => p !== null);
  return parts.join('\n\n');
}

function agentsProposal(template: string): string {
  return section(template, /^## Idea Capture/, /^---/) ?? '';
}

function routingProposal(template: string): string {
  return section(template, /^## Table 8/, null) ?? '';
}

function indexProposal(template: string): string {
  return section(template, /^\| idea-capture/, /^(?!\|)/) ?? '';
}

type Read = { kind: 'missing' } | { kind: 'ok'; content: string } | { kind: 'unsafe'; detail: string };

function readInstanceFile(projectRoot: string, rel: string): Read {
  const r = readProjectFile(projectRoot, rel, { allowEmpty: true });
  if (r.ok) return { kind: 'ok', content: r.content };
  if (r.code === 'FILE_MISSING') return { kind: 'missing' };
  return { kind: 'unsafe', detail: `${r.code}: ${r.detail}` };
}

/** A mixed (user-owned) file: satisfied when it already carries every marker, otherwise CONFLICT with a proposal. Never ADD, never edited. */
function mixedItem(projectRoot: string, rel: string, markers: RegExp[], proposal: string, what: string): UpdateItem {
  const read = readInstanceFile(projectRoot, rel);
  if (read.kind === 'unsafe') return { path: rel, action: 'CONFLICT', reason: `cannot be read safely (${read.detail}); not inspected or changed` };
  if (read.kind === 'missing') {
    return { path: rel, action: 'CONFLICT', reason: `missing; update does not recreate it. Restore the file, then add ${what}`, proposal };
  }
  if (markers.every((m) => m.test(read.content))) return { path: rel, action: 'UNCHANGED', reason: `${what} present` };
  return { path: rel, action: 'CONFLICT', reason: `your file lacks ${what}; it is yours, so update does not edit it. Add the text below`, proposal };
}

/**
 * Read-only. Throws RootContainmentError when the root/config is unusable and
 * `Error` when the directory is not a MONOLITH instance.
 */
export function planUpdate(target: string): UpdatePlan {
  const targetDir = resolve(target);
  const config = readConfigFile(targetDir);
  const root = resolveMonolithRoot(targetDir, config);
  const r = root.monolithRoot;

  let isDir = false;
  try {
    isDir = lstatSync(root.rootAbs).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    throw new Error(`Not a MONOLITH instance: "${r}/" does not exist in ${root.projectRoot}. Run \`monolith init\` first; \`monolith update\` only updates an existing instance.`);
  }

  const vars = { MONOLITH_ROOT: r };
  const items: UpdateItem[] = [];

  // 1. The skill: a MONOLITH-owned file, created when absent. An existing one is the user's, whatever it contains.
  const skillRel = `${r}/skills/idea-capture/SKILL.md`;
  const skillTemplate = readTemplate('monolith/skills/idea-capture/SKILL.md', vars);
  const skill = readInstanceFile(root.projectRoot, skillRel);
  if (skill.kind === 'unsafe') {
    items.push({ path: skillRel, action: 'CONFLICT', reason: `cannot be read safely (${skill.detail}); not inspected or changed` });
  } else if (skill.kind === 'missing') {
    items.push({ path: skillRel, action: 'ADD', reason: 'new file from the current template', content: skillTemplate });
  } else if (skill.content === skillTemplate) {
    items.push({ path: skillRel, action: 'UNCHANGED', reason: 'identical to the current template' });
  } else {
    items.push({ path: skillRel, action: 'SKIP', reason: 'exists and differs from the current template (customized or older); not overwritten' });
  }

  // 2. The wiring that makes an agent use it.
  items.push(
    mixedItem(root.projectRoot, `${r}/skills/INDEX.md`, [/idea-capture/], indexProposal(readTemplate('monolith/skills/INDEX.md', vars)), 'the idea-capture row'),
  );
  items.push(
    mixedItem(
      root.projectRoot,
      `${r}/context/maps/routing-map.md`,
      [/CAPTURE_IDEA/],
      routingProposal(readTemplate('monolith/context/maps/routing-map.md', vars)),
      'the CAPTURE_IDEA route (Table 8)',
    ),
  );

  const aiTool = config.status === 'ok' && typeof config.cfg.project === 'object' && config.cfg.project !== null
    ? (config.cfg.project as Record<string, unknown>).aiTool
    : undefined;
  const known = typeof aiTool === 'string' ? AI_TOOL_FILE[aiTool] : undefined;
  const instructionFiles = known
    ? [known]
    : INSTRUCTION_FILES.filter((f) => readInstanceFile(root.projectRoot, f).kind !== 'missing');
  for (const f of instructionFiles.length > 0 ? instructionFiles : [AI_TOOL_FILE.claude]) {
    // Placeholders other than MONOLITH_ROOT are left as written: the proposal is pasted into an existing file.
    const tpl = readTemplate(`instruction/${f}`, { ...vars, PROJECT_NAME: basename(root.projectRoot) });
    items.push(
      mixedItem(root.projectRoot, f, [/idea-capture\/SKILL\.md/, /monolith idea add/], instructionProposal(tpl), 'the Idea Capture trigger and rules'),
    );
  }

  const agentsTpl = readTemplate('projectroot/AGENTS.md', { ...vars, PROJECT_NAME: basename(root.projectRoot), LANGUAGE: 'your language', AI_TOOL: 'your AI tool' });
  items.push(mixedItem(root.projectRoot, 'AGENTS.md', [/idea-capture\/SKILL\.md/, /monolith idea add/], agentsProposal(agentsTpl), 'the Idea Capture section'));

  // 3. Optional documentation row: never a reason to call the integration incomplete.
  const semRel = `${r}/context/maps/semantic-map.md`;
  const sem = readInstanceFile(root.projectRoot, semRel);
  if (sem.kind === 'ok' && /monolith idea/.test(sem.content)) items.push({ path: semRel, action: 'UNCHANGED', reason: 'ideas rows present' });
  else items.push({ path: semRel, action: 'SKIP', reason: 'optional: ideas rows in the semantic map are documentation only; not required for Idea Capture' });

  return { monolithRoot: r, items };
}

/** Integration is complete only when nothing is left to add or to resolve by hand. */
export function integrationComplete(plan: UpdatePlan): boolean {
  return plan.items.every((i) => i.action !== 'ADD' && i.action !== 'CONFLICT');
}

export interface ApplyResult {
  created: string[];
  warnings: WriteWarning[];
}

/** Create every ADD item, exclusively. Stops at the first failure (earlier files stay; re-running continues). */
export function applyPlan(target: string, plan: UpdatePlan): ApplyResult {
  const targetDir = resolve(target);
  const boundary = projectBoundary(targetDir);
  const out: ApplyResult = { created: [], warnings: [] };
  for (const item of plan.items) {
    if (item.action !== 'ADD' || item.content === undefined) continue;
    const abs = join(targetDir, item.path);
    try {
      const parent = openParent(boundary, dirname(abs), { create: true });
      const outcome = createFile(parent, basename(abs), item.content, { mode: 0o666, exactMode: false, durability: 'file' });
      out.warnings.push(...outcome.warnings);
      out.created.push(item.path);
    } catch (err) {
      // Another `update` (or the user) created it first: exclusive create refused, nothing was overwritten.
      if (err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS') continue;
      throw err;
    }
  }
  return out;
}

export { RootContainmentError };
