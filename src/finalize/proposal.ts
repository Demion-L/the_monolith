/**
 * Finalization proposal (DOCSYNC-001): the typed, strictly validated input an
 * AI assistant or developer prepares. It carries the *content* of the
 * finalization; MONOLITH decides whether and where it may be applied.
 *
 * Validation is structural and syntactic only. Whether the content is *true*
 * (the summary matches the code) is the owner's judgement, taken when they
 * approve the plan digest — never something this module claims to check.
 */

export const PROPOSAL_SCHEMA_VERSION = 1;

/**
 * What the Current Story section of active.md must hold before the transition.
 * There is deliberately no "any": a proposal cannot switch the guard off and
 * silently replace somebody else's active story. `contains` must name the
 * story being finalized (checked in `parseProposal`).
 */
export type ExpectedCurrentStory = 'none' | { contains: string };

export interface FinalizationProposal {
  schemaVersion: 1;
  story: {
    /** Story identifier, e.g. `DOCSYNC-001` or `1.3`. Used as the idempotency key. */
    id: string;
    title: string;
    /** Phase directory name under `memory/working/phases/`, e.g. `phase-1`. */
    phase: string;
    /** Text of the `## ` heading in story-index.md the entry belongs to. */
    phaseHeading: string;
    /** Capsule file base name (without `.md`), e.g. `story-docsync-001-finalization`. */
    slug: string;
    /** `YYYY-MM-DD`. Supplied by the caller: MONOLITH never invents a finalization date. */
    date: string;
  };
  /** What the Current Story section of active.md must look like before the transition. */
  expectedCurrentStory: ExpectedCurrentStory;
  work: {
    objective: string;
    implementationSummary: string;
    filesChanged: string[];
    tests: string;
    keyDecisions: string;
    adrs: string[];
    lessons: string;
  };
  /** One-paragraph summary for story-index.md. */
  summary: string;
  keyOutputs: string[];
  history: { phaseName: string; decision: string; build: string };
  /** Complete replacement of HANDOFF.md. Optional: omitted means HANDOFF.md is not touched. */
  handoff?: { content: string };
  /** Extra documentation edits; each path must be allowed by `monolith.config.json` `finalization`. */
  docUpdates?: Array<{ path: string; newContent: string; reason: string }>;
}

export type ProposalParse = { ok: true; proposal: FinalizationProposal } | { ok: false; errors: string[] };

export const LIMITS = {
  idLen: 64,
  titleLen: 200,
  lineLen: 1000,
  blockLen: 20000,
  listItems: 200,
  docUpdates: 20,
  docBytes: 1024 * 1024,
} as const;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * True when `text` holds `id` as a whole Story ID token (case-insensitive).
 * Tokens are maximal runs of the Story ID alphabet [A-Za-z0-9._-]; trailing
 * `.`/`_`/`-` (sentence punctuation) are dropped. So `S-1` is a token of
 * "S-1 in progress" or "(S-1)", but never of "S-10", "XS-1", "1.10" or "11.1".
 */
export function hasStoryIdToken(text: string, id: string): boolean {
  const want = id.toLowerCase();
  return (text.match(/[A-Za-z0-9._-]+/g) ?? []).some((t) => t.replace(/[._-]+$/, '').toLowerCase() === want);
}
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const PHASE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function noUnknown(obj: Record<string, unknown>, allowed: string[], where: string, errors: string[]): void {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`${where}: unknown field "${k}".`);
}

export function validDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (m === null) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function text(v: unknown, where: string, errors: string[], opts: { multiline: boolean; max: number; allowEmpty?: boolean }): string {
  if (typeof v !== 'string') {
    errors.push(`${where}: must be a string.`);
    return '';
  }
  if (v.includes('\0')) errors.push(`${where}: must not contain NUL.`);
  if (!opts.allowEmpty && v.trim().length === 0) errors.push(`${where}: must not be empty.`);
  if (v.length > opts.max) errors.push(`${where}: longer than ${opts.max} characters.`);
  if (!opts.multiline && /[\r\n\u2028\u2029]/.test(v)) errors.push(`${where}: must be a single line.`);
  return v;
}

function lines(v: unknown, where: string, errors: string[]): string[] {
  if (!Array.isArray(v)) {
    errors.push(`${where}: must be an array of strings.`);
    return [];
  }
  if (v.length > LIMITS.listItems) errors.push(`${where}: more than ${LIMITS.listItems} items.`);
  return v.map((x, i) => text(x, `${where}[${i}]`, errors, { multiline: false, max: LIMITS.lineLen }));
}

/**
 * Lexical validation of a project-relative document path (R4). Rejects
 * absolute paths, `..`, backslashes, NUL, empty segments and VCS internals.
 * Symlinks are NOT decided here: they are refused by the safe read/write
 * primitives, which look at the real file system.
 */
export function validateRelPath(p: unknown): string | null {
  if (typeof p !== 'string' || p.length === 0 || p.length > 260) return 'path must be a non-empty string of at most 260 characters';
  if (p.includes('\0') || p.includes('\\')) return 'path must not contain NUL or backslashes';
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return 'path must be relative to the project root';
  const segs = p.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) return 'path must not contain empty, "." or ".." segments';
  // `.git` at ANY depth (nested repositories, submodule checkouts), any case
  // (case-insensitive file systems), and trailing dot/space (Windows aliases).
  if (segs.some((s) => /^\.git[. ]*$/i.test(s)) || segs.includes('node_modules')) return 'path must not contain a .git (any case, any depth) or node_modules component';
  return null;
}

export function parseProposal(raw: unknown): ProposalParse {
  const errors: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ['proposal must be a JSON object.'] };
  noUnknown(raw, ['schemaVersion', 'story', 'expectedCurrentStory', 'work', 'summary', 'keyOutputs', 'history', 'handoff', 'docUpdates'], 'proposal', errors);
  if (raw.schemaVersion !== PROPOSAL_SCHEMA_VERSION) errors.push(`schemaVersion: must be ${PROPOSAL_SCHEMA_VERSION}.`);

  const story = isObject(raw.story) ? raw.story : (errors.push('story: must be an object.'), {});
  noUnknown(story, ['id', 'title', 'phase', 'phaseHeading', 'slug', 'date'], 'story', errors);
  const id = text(story.id, 'story.id', errors, { multiline: false, max: LIMITS.idLen });
  if (id && !ID_RE.test(id)) errors.push('story.id: must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}.');
  const title = text(story.title, 'story.title', errors, { multiline: false, max: LIMITS.titleLen });
  const phase = text(story.phase, 'story.phase', errors, { multiline: false, max: 32 });
  if (phase && !PHASE_RE.test(phase)) errors.push('story.phase: must match [a-z0-9][a-z0-9-]{0,31}.');
  const phaseHeading = text(story.phaseHeading, 'story.phaseHeading', errors, { multiline: false, max: LIMITS.titleLen });
  if (phaseHeading.startsWith('#')) errors.push('story.phaseHeading: give the heading text without leading "#".');
  const slug = text(story.slug, 'story.slug', errors, { multiline: false, max: 100 });
  if (slug && !SLUG_RE.test(slug)) errors.push('story.slug: must match [a-z0-9][a-z0-9._-]{0,99}.');
  const date = text(story.date, 'story.date', errors, { multiline: false, max: 10 });
  if (date && !validDate(date)) errors.push('story.date: must be a real date YYYY-MM-DD.');

  let expected: ExpectedCurrentStory = 'none';
  const e = raw.expectedCurrentStory;
  if (e === 'none') expected = e;
  else if (isObject(e) && typeof e.contains === 'string' && e.contains.trim() !== '' && Object.keys(e).length === 1 && e.contains.length <= LIMITS.lineLen) {
    expected = { contains: e.contains };
    if (id && !hasStoryIdToken(e.contains, id)) {
      errors.push(`expectedCurrentStory.contains: must contain the story id "${id}" as a whole token (not as part of a longer id), so the guard cannot match another story.`);
    }
  } else if (e === 'any') {
    errors.push('expectedCurrentStory: "any" is not accepted (it would allow replacing an unrelated active story). Use "none" or {"contains": "<text containing the story id>"}.');
  } else errors.push('expectedCurrentStory: must be "none" or {"contains": "<text containing the story id>"}.');

  const w = isObject(raw.work) ? raw.work : (errors.push('work: must be an object.'), {});
  noUnknown(w, ['objective', 'implementationSummary', 'filesChanged', 'tests', 'keyDecisions', 'adrs', 'lessons'], 'work', errors);
  const block = (v: unknown, name: string): string => text(v, `work.${name}`, errors, { multiline: true, max: LIMITS.blockLen });
  const work = {
    objective: block(w.objective, 'objective'),
    implementationSummary: block(w.implementationSummary, 'implementationSummary'),
    filesChanged: lines(w.filesChanged, 'work.filesChanged', errors),
    tests: block(w.tests, 'tests'),
    keyDecisions: block(w.keyDecisions, 'keyDecisions'),
    adrs: lines(w.adrs, 'work.adrs', errors),
    lessons: block(w.lessons, 'lessons'),
  };

  const summary = text(raw.summary, 'summary', errors, { multiline: false, max: LIMITS.blockLen });
  const keyOutputs = lines(raw.keyOutputs, 'keyOutputs', errors);

  const h = isObject(raw.history) ? raw.history : (errors.push('history: must be an object.'), {});
  noUnknown(h, ['phaseName', 'decision', 'build'], 'history', errors);
  const history = {
    phaseName: text(h.phaseName, 'history.phaseName', errors, { multiline: false, max: LIMITS.titleLen }),
    decision: text(h.decision, 'history.decision', errors, { multiline: false, max: LIMITS.blockLen }),
    build: text(h.build, 'history.build', errors, { multiline: false, max: LIMITS.lineLen }),
  };

  let handoff: FinalizationProposal['handoff'];
  if (raw.handoff !== undefined) {
    if (!isObject(raw.handoff)) errors.push('handoff: must be an object {"content": "..."}.');
    else {
      noUnknown(raw.handoff, ['content'], 'handoff', errors);
      const content = text(raw.handoff.content, 'handoff.content', errors, { multiline: true, max: LIMITS.docBytes });
      handoff = { content };
    }
  }

  let docUpdates: FinalizationProposal['docUpdates'];
  if (raw.docUpdates !== undefined) {
    if (!Array.isArray(raw.docUpdates)) errors.push('docUpdates: must be an array.');
    else {
      if (raw.docUpdates.length > LIMITS.docUpdates) errors.push(`docUpdates: more than ${LIMITS.docUpdates} entries.`);
      docUpdates = [];
      const seen = new Set<string>();
      raw.docUpdates.forEach((d: unknown, i: number) => {
        const where = `docUpdates[${i}]`;
        if (!isObject(d)) {
          errors.push(`${where}: must be an object.`);
          return;
        }
        noUnknown(d, ['path', 'newContent', 'reason'], where, errors);
        const bad = validateRelPath(d.path);
        if (bad !== null) errors.push(`${where}.path: ${bad}.`);
        const path = typeof d.path === 'string' ? d.path : '';
        if (seen.has(path)) errors.push(`${where}.path: "${path}" is listed twice.`);
        seen.add(path);
        docUpdates!.push({
          path,
          newContent: text(d.newContent, `${where}.newContent`, errors, { multiline: true, max: LIMITS.docBytes }),
          reason: text(d.reason, `${where}.reason`, errors, { multiline: false, max: LIMITS.lineLen }),
        });
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  const proposal: FinalizationProposal = {
    schemaVersion: 1,
    story: { id, title, phase, phaseHeading, slug, date },
    expectedCurrentStory: expected,
    work,
    summary,
    keyOutputs,
    history,
  };
  if (handoff) proposal.handoff = handoff;
  if (docUpdates && docUpdates.length > 0) proposal.docUpdates = docUpdates;
  return { ok: true, proposal };
}
