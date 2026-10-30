/**
 * Idea store (IDEA-001A): one Markdown file per idea in `<monolithRoot>/memory/ideas/`.
 *
 * - Writes go through the safe-write primitive in `src/root/` (PROJECT scope:
 *   a symlink anywhere below the project root is refused; the file is created
 *   exclusively via `link()`, so an existing file is never overwritten).
 * - Reads go through the unified bounded reader (`readBoundedFile`).
 * - Ids are allocated by exclusive creation, not by trusting a counter: the
 *   next number is only a candidate, and a lost race (`WRITE_TARGET_EXISTS`)
 *   re-scans and tries again. Two processes can therefore never publish the same id.
 *
 * Not defended: a local actor swapping directories concurrently (SEC-001B.3,
 * TM-C unsupported). Ids are not reused while their file exists; if a person
 * deletes the highest-numbered file, its number can be handed out again
 * (archive an idea with `status: archived` instead of deleting it).
 */

import { lstatSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  RootContainmentError,
  SafeWriteError,
  assertContainedFile,
  createFile,
  openParent,
  projectBoundary,
  readBoundedFile,
  resolveMonolithRoot,
  type ProjectFileRead,
  type WriteBoundary,
  type WriteWarning,
} from '../root/index.js';
import type { FsOps } from '../root/index.js';
import { formatIdeaId, ideaFileName, ideaIdFromFileName, ideaNumber, isIdeaId, parseIdea, serializeIdea, validateNewIdea } from './format.js';
import { IDEA_LIMITS, IdeaError, type Idea, type IdeaEntry, type NewIdea } from './types.js';

const IDEAS_REL = 'memory/ideas';
const MAX_ALLOCATION_ATTEMPTS = 64;

export interface IdeaStore {
  projectRoot: string;
  rootAbs: string;
  dirAbs: string;
  boundary: WriteBoundary;
}

/** Resolve (and contain) the ideas directory of the instance rooted at `targetDir`. */
export function ideaStore(targetDir: string): IdeaStore {
  let root;
  try {
    root = resolveMonolithRoot(targetDir);
    assertContainedFile(root, IDEAS_REL);
  } catch (err) {
    if (err instanceof RootContainmentError) throw new IdeaError('IDEA_UNSAFE_PATH', err.message, { cause: err });
    throw err;
  }
  return {
    projectRoot: root.projectRoot,
    rootAbs: root.rootAbs,
    dirAbs: join(root.rootAbs, IDEAS_REL),
    boundary: projectBoundary(root.projectRoot),
  };
}

export interface AddIdeaOptions {
  /** Clock seam for tests. */
  now?: () => Date;
  /** Fault-injection seam for tests (forwarded to the safe-write primitive). */
  ops?: Partial<FsOps>;
  /** Receives post-publication findings (the idea IS saved when these fire). */
  onWarning?: (w: WriteWarning) => void;
}

export interface AddIdeaResult {
  idea: Idea;
  path: string;
}

function unsafe(err: SafeWriteError): IdeaError {
  return new IdeaError('IDEA_UNSAFE_PATH', err.message, { cause: err });
}

/** Ids of the idea files in the ideas directory, ordered by number. Missing directory -> empty. */
function scanIds(store: IdeaStore): string[] {
  let names: string[];
  try {
    names = readdirSync(store.dirAbs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const ids: string[] = [];
  for (const name of names) {
    const id = ideaIdFromFileName(name);
    if (id !== null) ids.push(id);
  }
  return ids.sort((a, b) => ideaNumber(a) - ideaNumber(b) || (a < b ? -1 : a > b ? 1 : 0));
}

export function addIdea(store: IdeaStore, input: NewIdea, opts: AddIdeaOptions = {}): AddIdeaResult {
  validateNewIdea(input);

  // `add` only creates `memory/ideas` inside an existing instance; it never invents `.monolith/`.
  let rootStat;
  try {
    rootStat = lstatSync(store.rootAbs);
  } catch {
    rootStat = null;
  }
  if (rootStat === null || !rootStat.isDirectory()) {
    throw new IdeaError('IDEA_NOT_INITIALIZED', `"${store.rootAbs}" is not a MONOLITH instance directory. Run \`monolith init\` first.`);
  }

  let parent;
  try {
    parent = openParent(store.boundary, store.dirAbs, { create: true, ops: opts.ops });
  } catch (err) {
    if (err instanceof SafeWriteError) throw unsafe(err);
    throw err;
  }

  const createdAt = (opts.now ?? (() => new Date()))().toISOString();
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt++) {
    const ids = scanIds(store);
    const id = formatIdeaId(ids.length === 0 ? 1 : ideaNumber(ids[ids.length - 1]) + 1);
    const idea: Idea = { id, title: input.title, description: input.description, createdAt, status: 'inbox' };
    if (input.context !== undefined) idea.context = input.context;
    const text = serializeIdea(idea);
    try {
      const outcome = createFile(parent, ideaFileName(id), text, {
        mode: 0o666,
        exactMode: false,
        durability: 'full',
        maxBytes: IDEA_LIMITS.fileBytes,
        ops: opts.ops,
      });
      for (const w of outcome.warnings) opts.onWarning?.(w);
      return { idea, path: join(store.dirAbs, ideaFileName(id)) };
    } catch (err) {
      // Lost the race for this number (or a stray entry holds it): take the next one.
      if (err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS') continue;
      throw err;
    }
  }
  throw new IdeaError('IDEA_ID_EXHAUSTED', `could not allocate an idea id after ${MAX_ALLOCATION_ATTEMPTS} attempts; nothing was written.`);
}

function readIdeaFile(store: IdeaStore, id: string): ProjectFileRead {
  const abs = join(store.dirAbs, ideaFileName(id));
  return readBoundedFile(abs, id, { boundary: store.projectRoot, maxBytes: IDEA_LIMITS.fileBytes }, true) as ProjectFileRead;
}

function loadIdea(store: IdeaStore, id: string): IdeaEntry | { missing: true } {
  const read = readIdeaFile(store, id);
  if (!read.ok) {
    if (read.code === 'FILE_MISSING') return { missing: true };
    const security = ['FILE_SYMLINK', 'FILE_HARDLINKED', 'FILE_NOT_REGULAR', 'FILE_OUTSIDE_PROJECT', 'READ_BOUNDARY_INVALID', 'READ_UNSUPPORTED_PLATFORM'];
    return { ok: false, id, code: security.includes(read.code) ? 'IDEA_UNSAFE_PATH' : 'IDEA_CORRUPT', reason: `${read.code}: ${read.detail}` };
  }
  try {
    return { ok: true, idea: parseIdea(id, read.content) };
  } catch (err) {
    if (err instanceof IdeaError) return { ok: false, id, code: 'IDEA_CORRUPT', reason: err.message };
    throw err;
  }
}

/** Read one idea. Throws IDEA_INVALID_ID / IDEA_NOT_FOUND / IDEA_UNSAFE_PATH / IDEA_CORRUPT. Never writes. */
export function getIdea(store: IdeaStore, id: string): Idea {
  if (!isIdeaId(id)) throw new IdeaError('IDEA_INVALID_ID', `"${id}" is not an idea id (expected IDEA-NNN, e.g. IDEA-001).`);
  const loaded = loadIdea(store, id);
  if ('missing' in loaded) throw new IdeaError('IDEA_NOT_FOUND', `No idea ${id}.`);
  if (!loaded.ok) throw new IdeaError(loaded.code, loaded.reason);
  return loaded.idea;
}

/**
 * All ideas, ordered by number. A file that cannot be read as an idea appears as
 * a non-ok entry instead of aborting the listing. A symlinked ideas directory
 * is refused as a whole. Never writes.
 */
export function listIdeas(store: IdeaStore): IdeaEntry[] {
  try {
    openParent(store.boundary, store.dirAbs); // every component below the project root: a real directory
  } catch (err) {
    if (err instanceof SafeWriteError) {
      if (err.code === 'WRITE_PARENT_MISSING') return [];
      throw unsafe(err);
    }
    throw err;
  }
  const entries: IdeaEntry[] = [];
  for (const id of scanIds(store)) {
    const loaded = loadIdea(store, id);
    if ('missing' in loaded) continue; // vanished between readdir and read
    entries.push(loaded);
  }
  return entries;
}
