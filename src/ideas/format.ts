/**
 * Idea file format: Markdown with a small frontmatter block.
 *
 *   ---
 *   type: idea
 *   id: "IDEA-001"
 *   title: "..."            (JSON string: any character survives a round trip)
 *   status: inbox
 *   createdAt: "2026-..."
 *   context: "..."          (optional)
 *   tags: ["a", "b"]        (optional)
 *   ---
 *
 *   ## Description
 *
 *   <description, verbatim>
 *
 * Strings are written as JSON strings, which are also valid YAML double-quoted
 * scalars, so ERG/Scriptorium read the file too. The reader additionally accepts
 * a plain unquoted value, because a person edits these files by hand.
 * The description is the body: no escaping, no trimming.
 */

import { IDEA_LIMITS, IDEA_STATUSES, IdeaError, type Idea, type IdeaStatus, type NewIdea } from './types.js';

const BODY_HEADING = '\n## Description\n\n';
const ID_RE = /^IDEA-(\d{3,9})$/;
const FILE_RE = /^(IDEA-\d{3,9})\.md$/;
// C0 controls, DEL and C1 controls (a title is shown in a terminal).
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export function isIdeaId(value: string): boolean {
  return ID_RE.test(value);
}

export function ideaNumber(id: string): number {
  const m = ID_RE.exec(id);
  if (!m) throw new IdeaError('IDEA_INVALID_ID', `"${id}" is not an idea id (expected IDEA-NNN).`);
  return Number(m[1]);
}

export function formatIdeaId(n: number): string {
  return `IDEA-${String(n).padStart(3, '0')}`;
}

/** `IDEA-007.md` -> `IDEA-007`; anything else (temp files, other documents) -> null. */
export function ideaIdFromFileName(name: string): string | null {
  const m = FILE_RE.exec(name);
  return m ? m[1] : null;
}

export function ideaFileName(id: string): string {
  ideaNumber(id);
  return `${id}.md`;
}

function invalid(message: string): IdeaError {
  return new IdeaError('IDEA_INVALID_INPUT', message);
}

const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** An unpaired surrogate would be rewritten to U+FFFD by UTF-8 encoding: not lossless. */
function wellFormed(s: string): boolean {
  return !LONE_SURROGATE_RE.test(s);
}

/** Validates user input; returns it unchanged (content is never trimmed or rewritten). */
export function validateNewIdea(input: NewIdea): NewIdea {
  const { title, description, context } = input;
  if (typeof title !== 'string' || title.trim() === '') throw invalid('title must not be empty.');
  if (typeof description !== 'string' || description.trim() === '') throw invalid('description must not be empty.');
  if (CONTROL_RE.test(title)) throw invalid('title must be a single line without control characters.');
  if (title.length > IDEA_LIMITS.title) throw invalid(`title is too long (${title.length} > ${IDEA_LIMITS.title} characters).`);
  if (description.length > IDEA_LIMITS.description) {
    throw invalid(`description is too long (${description.length} > ${IDEA_LIMITS.description} characters).`);
  }
  if (context !== undefined) {
    if (typeof context !== 'string' || context.trim() === '') throw invalid('context, when given, must not be empty.');
    if (context.length > IDEA_LIMITS.context) {
      throw invalid(`context is too long (${context.length} > ${IDEA_LIMITS.context} characters).`);
    }
  }
  for (const [name, v] of [['title', title], ['description', description], ['context', context]] as const) {
    if (v !== undefined && !wellFormed(v)) throw invalid(`${name} contains an unpaired surrogate and cannot be stored losslessly.`);
  }
  return input;
}

export function serializeIdea(idea: Idea): string {
  const lines = [
    '---',
    'type: idea',
    `id: ${JSON.stringify(idea.id)}`,
    `title: ${JSON.stringify(idea.title)}`,
    `status: ${idea.status}`,
    `createdAt: ${JSON.stringify(idea.createdAt)}`,
  ];
  if (idea.context !== undefined) lines.push(`context: ${JSON.stringify(idea.context)}`);
  if (idea.tags !== undefined && idea.tags.length > 0) lines.push(`tags: ${JSON.stringify(idea.tags)}`);
  lines.push('---');
  return `${lines.join('\n')}\n${BODY_HEADING}${idea.description}\n`;
}

function corrupt(id: string, reason: string): IdeaError {
  return new IdeaError('IDEA_CORRUPT', `${id}: ${reason}`);
}

function scalar(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(v);
    } catch {
      throw new Error('malformed quoted string');
    }
    if (typeof parsed !== 'string') throw new Error('malformed quoted string');
    return parsed;
  }
  return v;
}

/**
 * Parse an idea file. `expectedId` is the id implied by the file name; a
 * mismatch with the `id:` field is corruption, never silently "fixed".
 */
export function parseIdea(expectedId: string, text: string): Idea {
  const normalized = text.startsWith('﻿') ? text.slice(1) : text;
  if (!normalized.startsWith('---\n')) throw corrupt(expectedId, 'missing frontmatter.');
  const end = normalized.indexOf('\n---\n', 3);
  if (end === -1) throw corrupt(expectedId, 'frontmatter is not terminated.');

  const fm: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const line of normalized.slice(4, end).split('\n')) {
    if (line.trim() === '') continue;
    const colon = line.indexOf(':');
    if (colon <= 0) throw corrupt(expectedId, `unreadable frontmatter line ${JSON.stringify(line.slice(0, 60))}.`);
    const key = line.slice(0, colon).trim();
    if (key in fm) throw corrupt(expectedId, `duplicate frontmatter key "${key}".`);
    fm[key] = line.slice(colon + 1);
  }

  const field = (key: string): string => {
    if (!(key in fm)) throw corrupt(expectedId, `missing "${key}".`);
    try {
      return scalar(fm[key]);
    } catch (err) {
      throw corrupt(expectedId, `"${key}": ${(err as Error).message}.`);
    }
  };

  if ('type' in fm && field('type') !== 'idea') throw corrupt(expectedId, `type is "${field('type')}", expected "idea".`);
  const id = field('id');
  if (id !== expectedId) throw corrupt(expectedId, `file name says ${expectedId} but the id field says ${JSON.stringify(id)}.`);
  const title = field('title');
  if (title.trim() === '') throw corrupt(expectedId, 'title is empty.');
  const status = field('status');
  if (!(IDEA_STATUSES as readonly string[]).includes(status)) {
    throw corrupt(expectedId, `unknown status ${JSON.stringify(status)} (expected ${IDEA_STATUSES.join(' | ')}).`);
  }
  const createdAt = field('createdAt');
  if (Number.isNaN(Date.parse(createdAt))) throw corrupt(expectedId, `createdAt ${JSON.stringify(createdAt)} is not a date.`);

  const body = normalized.slice(end + 5); // right after the closing "---\n"
  if (!body.startsWith(BODY_HEADING)) throw corrupt(expectedId, 'missing "## Description" section.');
  let description = body.slice(BODY_HEADING.length);
  if (description.endsWith('\n')) description = description.slice(0, -1);
  if (description.trim() === '') throw corrupt(expectedId, 'description is empty.');

  const idea: Idea = { id, title, description, createdAt, status: status as IdeaStatus };
  if ('context' in fm) idea.context = field('context');
  if ('tags' in fm) {
    let tags: unknown;
    try {
      tags = JSON.parse(fm.tags);
    } catch {
      throw corrupt(expectedId, '"tags" is not a JSON array of strings.');
    }
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) {
      throw corrupt(expectedId, '"tags" is not a JSON array of strings.');
    }
    idea.tags = tags as string[];
  }
  return idea;
}
