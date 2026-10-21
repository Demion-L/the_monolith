/* eslint-disable no-console */
/**
 * `monolith brief` CLI command handler.
 *
 * stdout carries only the brief's own content; CLI diagnostics and the
 * INCOMPLETE warning go to stderr (section 12). Exit codes (DEC-CONTEXT-002):
 *   0 — brief formed (COMPLETE or INCOMPLETE)
 *   1 — CLI usage error (thrown as a plain Error, caught by src/cli/index.ts's main())
 *   2 — --strict and the result is INCOMPLETE
 */

import { collect } from './collect.js';
import { render, DEFAULT_MAX_CHARS } from './render.js';

export interface BriefArgsOk {
  ok: true;
  maxChars: number;
  strict: boolean;
}

export interface BriefArgsErr {
  ok: false;
  message: string;
}

export type BriefArgsResult = BriefArgsOk | BriefArgsErr;

const USAGE = 'Usage: monolith brief [--max-chars N] [--strict]';

export function parseBriefArgs(args: string[]): BriefArgsResult {
  let maxChars = DEFAULT_MAX_CHARS;
  let strict = false;
  const unknown: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--strict') {
      strict = true;
      i++;
      continue;
    }
    if (arg === '--max-chars') {
      const value = args[i + 1];
      if (value === undefined) {
        return { ok: false, message: `--max-chars requires a value.\n\n${USAGE}` };
      }
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0) {
        return { ok: false, message: `--max-chars must be a positive integer, got "${value}".\n\n${USAGE}` };
      }
      maxChars = n;
      i += 2;
      continue;
    }
    unknown.push(arg);
    i++;
  }

  if (unknown.length > 0) {
    return { ok: false, message: `Unknown argument(s) for 'monolith brief': ${unknown.join(' ')}\n\n${USAGE}` };
  }

  return { ok: true, maxChars, strict };
}

export async function runBrief(args: string[], targetDir = process.cwd()): Promise<void> {
  const parsed = parseBriefArgs(args);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }

  const model = await collect(targetDir);
  const { text, completeness } = render(model, parsed.maxChars);

  process.stdout.write(text);

  if (completeness === 'INCOMPLETE') {
    console.error('monolith brief: result is INCOMPLETE — see the Diagnostics section above.');
  }

  if (parsed.strict && completeness === 'INCOMPLETE') {
    process.exit(2);
  }
  process.exit(0);
}
