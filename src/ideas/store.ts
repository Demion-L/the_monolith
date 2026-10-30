/**
 * Idea store (IDEA-001A): one Markdown file per idea in `<monolithRoot>/memory/long-term/ideas/`.
 *
 * - Writes go through the safe-write primitive in `src/root/` (PROJECT scope:
 *   a symlink anywhere below the project root is refused; the file is created
 *   exclusively via `link()`, so an existing file is never overwritten).
 * - Reads go through the unified bounded reader (`readBoundedFile`).
 * - Ids are allocated by exclusive creation, not by trusting a counter: the
 *   next number is only a candidate, and a lost race (`WRITE_TARGET_EXISTS`)
 *   re-scans and tries again. Two processes can therefore never publish the same id.
 *
 * - Ids are permanently reserved (IDEA-001D): before an idea file is written, an
 *   empty-ish marker `ideas/.ids/IDEA-NNN` is created exclusively. The next id is
 *   `max(idea files, markers) + 1`, so deleting an idea file never frees its id.
 *   A crash between marker and file leaves an orphaned marker: that id is simply
 *   burned (a gap), never reused. Existing ideas without a marker (created before
 *   IDEA-001D) get one on the next `add`. No shared counter, no lock.
 *
 * Not defended: a local actor swapping directories concurrently (SEC-001B.3,
 * TM-C unsupported). Deleting the `.ids` directory by hand forgets the
 * reservations of ideas that no longer have a file.
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
  type ParentRef,
  type ProjectFileRead,
  type WriteBoundary,
  type WriteWarning,
} from '../root/index.js';
import type { FsOps } from '../root/index.js';
import { formatIdeaId, ideaFileName, ideaIdFromFileName, ideaNumber, isIdeaId, parseIdea, serializeIdea, validateNewIdea } from './format.js';
import { IDEA_LIMITS, IdeaError, type Idea, type IdeaEntry, type NewIdea } from './types.js';

const IDEAS_REL = 'memory/long-term/ideas';
const IDS_DIR = '.ids';
const MARKER_RE = /^(IDEA-\d{3,9})$/;
const MAX_IDEA_NUMBER = 999_999_999;
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

/** Ids with a reservation marker in `ideas/.ids/`. Missing directory -> empty. Names that are not `IDEA-NNN` are ignored. */
function scanReservedIds(store: IdeaStore): string[] {
  let names: string[];
  try {
    names = readdirSync(join(store.dirAbs, IDS_DIR));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const ids: string[] = [];
  for (const name of names) {
    const m = MARKER_RE.exec(name);
    if (m !== null) ids.push(m[1]);
  }
  return ids;
}

/** Highest number that is in use or reserved (0 when none). */
function highestNumber(ids: string[]): number {
  return ids.reduce((max, id) => Math.max(max, ideaNumber(id)), 0);
}

/** Create the marker for `id`. Returns false when it already exists (never overwritten). */
function reserveId(markers: ParentRef, id: string, createdAt: string, opts: AddIdeaOptions): boolean {
  try {
    const outcome = createFile(markers, id, `reserved ${createdAt}\n`, {
      mode: 0o666,
      exactMode: false,
      durability: 'full',
      maxBytes: 256,
      ops: opts.ops,
    });
    for (const w of outcome.warnings) opts.onWarning?.(w);
    return true;
  } catch (err) {
    if (err instanceof SafeWriteError && err.code === 'WRITE_TARGET_EXISTS') return false;
    throw err;
  }
}

export function addIdea(store: IdeaStore, input: NewIdea, opts: AddIdeaOptions = {}): AddIdeaResult {
  validateNewIdea(input);

  // `add` only creates `memory/long-term/ideas` inside an existing instance; it never invents `.monolith/`.
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

  let markers;
  try {
    markers = openParent(store.boundary, join(store.dirAbs, IDS_DIR), { create: true, ops: opts.ops });
  } catch (err) {
    if (err instanceof SafeWriteError) throw unsafe(err);
    throw err;
  }

  const createdAt = (opts.now ?? (() => new Date()))().toISOString();
  try {
    // Ideas created before IDEA-001D have no marker: protect them from now on.
    for (const existing of scanIds(store)) reserveId(markers, existing, createdAt, opts);
  } catch (err) {
    if (err instanceof SafeWriteError) throw unsafe(err);
    throw err;
  }

  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt++) {
    const next = Math.max(highestNumber(scanIds(store)), highestNumber(scanReservedIds(store))) + 1;
    if (next > MAX_IDEA_NUMBER) throw new IdeaError('IDEA_ID_EXHAUSTED', 'the idea id space is exhausted; nothing was written.');
    const id = formatIdeaId(next);
    const idea: Idea = { id, title: input.title, description: input.description, createdAt, status: 'inbox' };
    if (input.context !== undefined) idea.context = input.context;
    const text = serializeIdea(idea);
    // The character limits do not bound the file (UTF-8 and JSON escaping expand text), and the reader refuses
    // files over `fileBytes`: refuse here, before an id is reserved, so nothing is saved that cannot be read back.
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > IDEA_LIMITS.fileBytes) {
      throw new IdeaError('IDEA_INVALID_INPUT', `the idea is too large once stored (${bytes} > ${IDEA_LIMITS.fileBytes} bytes in UTF-8); shorten the description or context. Nothing was written.`);
    }
    // Reserve first: once the marker exists the id is never handed out again, whatever happens next.
    try {
      if (!reserveId(markers, id, createdAt, opts)) continue; // lost the race for this number
    } catch (err) {
      if (err instanceof SafeWriteError) throw unsafe(err);
      throw err;
    }
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
